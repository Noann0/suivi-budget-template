import { transaction } from "@/db/client";
import { isValidYearMonth, previousMonth } from "@/lib/dates";
import { conflict, notFound, validation } from "@/lib/result";
import type {
  Allocation,
  CarryOverPreview,
  CategoryBlock,
  Entry,
  MonthLine,
  MonthSummary,
  MonthTotals,
  MonthView,
  OpeningBalance,
  Subcategory,
} from "@/lib/types";
import { listCategories, listSubcategories } from "@/server/repositories/categories";
import type { LedgerScope } from "@/server/repositories/ledgers";
import {
  copyAllocationsFromMonth,
  copyEntriesFromMonth,
  findMonth,
  insertMonth,
  listAllocations,
  listCarryOverAllocationCandidates,
  listCarryOverEntryCandidates,
  listEntries,
  listMonthRows,
  type MonthRow,
} from "@/server/repositories/months";

/**
 * Logique metier des mois. Tous les totaux sont calcules ici, cote serveur, et jamais
 * dans le navigateur : une seule source de verite evite qu'un ecran affiche un total
 * different d'un autre.
 */

export function computeTotals(
  income: CategoryBlock[],
  expense: CategoryBlock[],
  allocations: Allocation[],
): MonthTotals {
  const incomeCents = income.reduce((sum, block) => sum + block.subtotalCents, 0);
  const expenseCents = expense.reduce((sum, block) => sum + block.subtotalCents, 0);
  const remainingCents = incomeCents - expenseCents;

  const savingsCents = allocations
    .filter((allocation) => allocation.kind === "savings")
    .reduce((sum, allocation) => sum + allocation.amountCents, 0);
  const debtCents = allocations
    .filter((allocation) => allocation.kind === "debt")
    .reduce((sum, allocation) => sum + allocation.amountCents, 0);

  return {
    incomeCents,
    expenseCents,
    remainingCents,
    savingsCents,
    debtCents,
    // Peut etre negatif : elle a le droit d'allouer plus que son reste. Le serveur
    // calcule, il n'interdit pas. Le frontend peut le signaler visuellement.
    unallocatedCents: remainingCents - savingsCents - debtCents,
  };
}

/**
 * Assemble la vue complete d'un mois.
 *
 * Regle d'historique : une categorie ou une sous-categorie archivee reste affichee sur
 * un mois passe si elle y porte une entree non nulle. C'est ce qui rend l'historique
 * fidele : un mois de 2026 continue de montrer une categorie archivee en 2027.
 *
 * Le budget n'est pas un parametre : il est lu sur le mois lui-meme. Un mois ne peut
 * donc jamais etre assemble avec les categories d'un autre budget, meme si l'appelant
 * se trompe de perimetre.
 */
export function buildMonthView(userId: string, monthRow: MonthRow): MonthView {
  const scope: LedgerScope = { userId, ledgerId: monthRow.ledgerId };
  const categories = listCategories(scope, true);
  const subcategories = listSubcategories(scope, true);
  const entries = listEntries(monthRow.id);
  const allocations = listAllocations(monthRow.id);

  const entriesBySubcategory = new Map<string, Entry>();
  for (const entry of entries) entriesBySubcategory.set(entry.subcategoryId, entry);

  const subsByCategory = new Map<string, Subcategory[]>();
  for (const subcategory of subcategories) {
    const bucket = subsByCategory.get(subcategory.categoryId);
    if (bucket) bucket.push(subcategory);
    else subsByCategory.set(subcategory.categoryId, [subcategory]);
  }

  const income: CategoryBlock[] = [];
  const expense: CategoryBlock[] = [];

  for (const category of categories) {
    const subs = (subsByCategory.get(category.id) ?? []).slice().sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "fr"),
    );

    const lines: MonthLine[] = [];
    for (const subcategory of subs) {
      const entry = entriesBySubcategory.get(subcategory.id) ?? null;
      const amountCents = entry?.amountCents ?? 0;

      // Une sous-categorie archivee ne s'affiche que si elle porte encore un montant
      // sur ce mois-la. Sinon elle disparait, c'est le but de l'archivage.
      if (subcategory.isArchived && amountCents === 0) continue;

      lines.push({ subcategory, entry, amountCents });
    }

    const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);

    // Meme regle au niveau de la categorie.
    if (category.isArchived && subtotalCents === 0) continue;

    const block: CategoryBlock = { category, subtotalCents, lines };
    if (category.kind === "income") income.push(block);
    else expense.push(block);
  }

  const sortBlocks = (blocks: CategoryBlock[]) =>
    blocks.sort(
      (a, b) =>
        a.category.sortOrder - b.category.sortOrder ||
        a.category.name.localeCompare(b.category.name, "fr"),
    );

  sortBlocks(income);
  sortBlocks(expense);

  return {
    id: monthRow.id,
    year: monthRow.year,
    month: monthRow.month,
    note: monthRow.note,
    income,
    expense,
    allocations,
    totals: computeTotals(income, expense, allocations),
    carriedCount: entries.filter((entry) => entry.isCarried).length,
  };
}

/** Recharge la vue d'un mois a partir de son identifiant, apres une ecriture. */
export function reloadTotals(userId: string, monthRow: MonthRow): MonthTotals {
  return buildMonthView(userId, monthRow).totals;
}

export function getMonthView(
  scope: LedgerScope,
  year: number,
  month: number,
): MonthView | null {
  if (!isValidYearMonth(year, month)) {
    throw validation("Date invalide : le mois doit être compris entre 1 et 12.", "month");
  }
  const row = findMonth(scope, year, month);
  return row ? buildMonthView(scope.userId, row) : null;
}

/**
 * Solde d'ouverture calcule en direct pour un mois. Modifier un mois ancien propage
 * donc naturellement son effet a toute la suite lors de la prochaine lecture.
 */
export function getOpeningBalance(
  scope: LedgerScope,
  year: number,
  month: number,
): OpeningBalance {
  if (!isValidYearMonth(year, month)) {
    throw validation("Date invalide : le mois doit être compris entre 1 et 12.", "month");
  }

  const previousRows = listMonthRows(scope)
    .filter((row) => row.year < year || (row.year === year && row.month < month))
    .sort((left, right) => left.year - right.year || left.month - right.month);
  const source = previousRows.at(-1);

  return {
    cents: previousRows.reduce(
      (sum, row) => sum + buildMonthView(scope.userId, row).totals.unallocatedCents,
      0,
    ),
    source: source ? { year: source.year, month: source.month } : null,
  };
}

export function listMonthSummaries(scope: LedgerScope): MonthSummary[] {
  return listMonthRows(scope).map((row) => {
    const view = buildMonthView(scope.userId, row);
    return {
      id: row.id,
      year: row.year,
      month: row.month,
      totalIncomeCents: view.totals.incomeCents,
      totalExpenseCents: view.totals.expenseCents,
      remainingCents: view.totals.remainingCents,
    };
  });
}

export function createEmptyMonth(scope: LedgerScope, year: number, month: number): MonthView {
  if (!isValidYearMonth(year, month)) {
    throw validation("Date invalide : le mois doit être compris entre 1 et 12.", "month");
  }
  if (findMonth(scope, year, month)) {
    throw conflict("Ce mois existe déjà.");
  }
  const row = insertMonth(scope, year, month);
  return buildMonthView(scope.userId, row);
}

/**
 * Selection des lignes reprises, telle qu'elle arrive du navigateur.
 *
 * Chaque champ est independant, et ABSENT veut dire « tout » : c'est ce qui garde le
 * comportement d'origine pour tous les appels qui ne parlent pas de selection. Present
 * et vide veut dire « rien », intention parfaitement legitime : elle cree le mois en
 * n'en gardant aucune ligne.
 *
 * Deux listes plutot qu'une, parce que ce sont deux natures d'objets sans cle commune :
 * une ligne s'identifie par sa sous-categorie, une allocation par son identifiant
 * propre. Voir `CarryOverEntryCandidate` dans `@/lib/types`.
 */
export type CarryOverSelection = {
  /** Sous-categories des lignes a garder. Absent : toutes. */
  subcategoryIds?: readonly string[];
  /** Identifiants des allocations SOURCE a garder. Absent : toutes. */
  allocationIds?: readonly string[];
};

/**
 * Verifie qu'une selection ne designe que des lignes reellement reprenables, et la
 * convertit en ensemble.
 *
 * Ces identifiants viennent du navigateur et une Server Action est joignable en POST
 * direct : ils ne sont jamais utilises tels quels. Chacun doit figurer parmi les
 * candidats du mois source, lui-meme deja retrouve dans le perimetre de l'utilisatrice
 * et de son budget. Un identifiant inconnu, d'un autre mois ou d'un autre budget,
 * echoue donc ici, avant la moindre ecriture.
 *
 * Le refus est explicite plutot que silencieux : reprendre moins de lignes que celles
 * cochees, sans rien dire, laisserait croire a une perte de donnees.
 */
function resolveSelection(
  requested: readonly string[] | undefined,
  available: readonly string[],
  field: string,
): ReadonlySet<string> | undefined {
  if (requested === undefined) return undefined;

  const allowed = new Set(available);
  for (const id of requested) {
    if (!allowed.has(id)) {
      throw validation(
        "Certaines lignes sélectionnées ne font plus partie du mois précédent. " +
          "Rouvrez la liste et réessayez.",
        field,
      );
    }
  }
  return new Set(requested);
}

/**
 * Ce qu'une reprise apporterait, sans rien creer.
 *
 * `year` et `month` designent le mois CIBLE, celui qu'elle est en train d'ouvrir, comme
 * pour les deux actions de reprise. Le mois source en est deduit, passage d'annee
 * compris. C'est ce qui permet a l'interface de proposer les lignes a cocher avant meme
 * que le mois cible n'existe.
 *
 * `source: null` n'est pas une erreur : c'est l'etat « le mois precedent n'existe pas,
 * il n'y a rien a reprendre », et l'interface doit alors proposer un mois vide. Meme
 * philosophie que `getMonthView`, qui rend null sur un mois jamais cree.
 */
export function getCarryOverPreview(
  scope: LedgerScope,
  year: number,
  month: number,
): CarryOverPreview {
  if (!isValidYearMonth(year, month)) {
    throw validation("Date invalide : le mois doit être compris entre 1 et 12.", "month");
  }

  const previous = previousMonth(year, month);
  const source = findMonth(scope, previous.year, previous.month);
  const target = findMonth(scope, year, month);

  if (!source) {
    return { source: null, targetExists: target !== null, entries: [], allocations: [] };
  }

  const targetId = target?.id ?? null;
  return {
    source: { year: source.year, month: source.month },
    targetExists: target !== null,
    entries: listCarryOverEntryCandidates(source.id, targetId),
    allocations: listCarryOverAllocationCandidates(source.id, targetId),
  };
}

/**
 * Reporte le mois precedent sur un mois cible, en le creant s'il n'existe pas.
 *
 * Deux choses sont recopiees, et la seconde manquait :
 * - les montants non nuls des entrees, marques comme reportes ;
 * - les allocations, epargne et remboursements, sur leur cle naturelle (libelle, nature).
 *
 * Idempotente et non destructrice. Une ligne deja presente dans le mois cible, meme
 * modifiee a la main, est laissee telle quelle : les entrees par
 * `ON CONFLICT DO NOTHING`, les allocations par leur cle naturelle. C'est ce qui permet
 * d'appliquer le report sur un mois deja commence sans rien ecraser.
 *
 * `options.selection` restreint ce qui est repris. Absente, tout l'est, exactement comme
 * avant. La verification d'appartenance se fait a l'interieur de la transaction, sur le
 * mois source deja resolu : une selection est donc validee contre l'etat exact sur
 * lequel la copie va travailler, et non contre un apercu lu plus tot.
 *
 * Le tout dans une seule transaction : soit le mois existe avec ses reports, soit rien.
 */
function carryOver(
  scope: LedgerScope,
  year: number,
  month: number,
  options: { createTarget: boolean; selection?: CarryOverSelection },
): CarryOverResult {
  if (!isValidYearMonth(year, month)) {
    throw validation("Date invalide : le mois doit être compris entre 1 et 12.", "month");
  }

  // Passage d'annee gere par previousMonth : janvier 2027 a pour precedent
  // decembre 2026, et non un mois zero.
  const previous = previousMonth(year, month);

  return transaction(() => {
    const source = findMonth(scope, previous.year, previous.month);
    if (!source) {
      // Deux messages, parce que les deux situations n'offrent pas la meme issue :
      // a la creation, partir d'un mois vide reste une sortie possible ; sur un mois
      // deja ouvert, la proposer n'aurait aucun sens.
      throw notFound(
        options.createTarget
          ? "Le mois précédent n'existe pas encore, il n'y a rien à reporter. " +
              "Créez-le d'abord, ou partez d'un mois vide."
          : "Le mois précédent n'existe pas encore, il n'y a rien à reprendre.",
      );
    }

    const existing = findMonth(scope, year, month);
    if (!existing && !options.createTarget) {
      throw notFound("Ce mois n'existe pas.");
    }
    const target = existing ?? insertMonth(scope, year, month);

    // Les candidats sont relus ici, et non repris de l'apercu : c'est l'etat de la base
    // au moment de l'ecriture qui fait foi.
    const entrySelection = resolveSelection(
      options.selection?.subcategoryIds,
      listCarryOverEntryCandidates(source.id, null).map((line) => line.subcategoryId),
      "subcategoryIds",
    );
    const allocationSelection = resolveSelection(
      options.selection?.allocationIds,
      listCarryOverAllocationCandidates(source.id, null).map((allocation) => allocation.id),
      "allocationIds",
    );

    const carriedEntries = copyEntriesFromMonth(source.id, target.id, entrySelection);
    const carriedAllocations = copyAllocationsFromMonth(
      source.id,
      target.id,
      allocationSelection,
    );

    const view = buildMonthView(scope.userId, target);
    return {
      view,
      totals: view.totals,
      carriedEntries,
      carriedAllocations,
      carried: carriedEntries + carriedAllocations,
    };
  });
}

/**
 * Resultat d'un report. `carried` est le total des lignes effectivement ajoutees,
 * jamais le nombre de lignes examinees : une ligne deja saisie n'est pas comptee,
 * puisqu'elle n'a pas ete touchee.
 */
export type CarryOverResult = {
  view: MonthView;
  totals: MonthTotals;
  carried: number;
  carriedEntries: number;
  carriedAllocations: number;
};

/**
 * Cree le mois demande a partir du precedent. Chemin de la creation, propose sur
 * l'ecran d'un mois qui n'existe pas encore.
 *
 * `selection` omise : tout le mois precedent est repris, comme depuis toujours. Fournie,
 * elle limite la reprise aux lignes cochees dans l'apercu (`getCarryOverPreview`).
 */
export function createMonthFromPrevious(
  scope: LedgerScope,
  year: number,
  month: number,
  selection?: CarryOverSelection,
): CarryOverResult {
  return carryOver(scope, year, month, { createTarget: true, selection });
}

/**
 * Applique le report sur un mois DEJA existant.
 *
 * Raison d'etre, et elle est concrete : jusqu'ici le report n'etait propose qu'a la
 * creation du mois. Un clic sur « Commencer un mois vide » condamnait a retaper les
 * vingt-deux lignes du mois precedent, sans aucun moyen de revenir en arriere. Le
 * report devait donc exister aussi comme geste de rattrapage, a tout moment.
 *
 * Rien n'est ecrase : seules les lignes absentes du mois cible sont ajoutees.
 *
 * `selection` s'y applique comme a la creation : omise, tout est repris ; fournie, elle
 * limite la reprise aux lignes cochees.
 */
export function carryOverIntoExistingMonth(
  scope: LedgerScope,
  year: number,
  month: number,
  selection?: CarryOverSelection,
): CarryOverResult {
  return carryOver(scope, year, month, { createTarget: false, selection });
}
