"use server";

import { revalidatePath } from "next/cache";

import { notFound, validation, type ActionResult } from "@/lib/result";
import type {
  CarryOverPreview,
  LedgerSlug,
  MonthSummary,
  MonthTotals,
  MonthView,
} from "@/lib/types";
import { withSession } from "@/server/action-helpers";
import {
  deleteMonth as deleteMonthRow,
  findMonth,
  updateMonthNote as updateMonthNoteRow,
} from "@/server/repositories/months";
import { resolveScope } from "@/server/services/ledgers";
import {
  carryOverIntoExistingMonth,
  createEmptyMonth,
  createMonthFromPrevious as createFromPrevious,
  getCarryOverPreview as getCarryOverPreviewView,
  getMonthView,
  listMonthSummaries,
  type CarryOverSelection,
} from "@/server/services/months";

const MAX_NOTE_LENGTH = 2000;

/**
 * Garde-fou de volume sur une selection. Le budget le plus fourni compte une trentaine
 * de lignes ; cette borne n'est pas une regle metier mais un plafond de forme, pour
 * qu'un POST direct ne puisse pas faire tourner une boucle de verification sur un
 * tableau d'un million d'entrees.
 */
const MAX_SELECTION_LENGTH = 500;

/** Longueur maximale d'un identifiant. Ceux du depot en font 21 (voir `newId`). */
const MAX_ID_LENGTH = 64;

/**
 * Valide la FORME d'une liste d'identifiants venue du navigateur, et la dedoublonne.
 *
 * Ce qui se joue ici n'est que la forme : le contenu, lui, est verifie par le service
 * contre les lignes reellement reprenables du mois source, dans la meme transaction que
 * la copie. Les deux controles sont necessaires et aucun ne remplace l'autre.
 *
 * `undefined` traverse tel quel : c'est ce qui dit « je ne parle pas de selection »,
 * donc « reprends tout », et c'est ce qui laisse intacts les appels existants. Un
 * tableau vide, lui, est une intention : ne rien reprendre.
 */
function cleanIdSelection(raw: unknown, field: string): string[] | undefined {
  if (raw === undefined) return undefined;

  if (!Array.isArray(raw)) {
    throw validation("La sélection des lignes est invalide.", field);
  }
  if (raw.length > MAX_SELECTION_LENGTH) {
    throw validation("La sélection des lignes est trop longue.", field);
  }
  for (const id of raw) {
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LENGTH) {
      throw validation("La sélection des lignes est invalide.", field);
    }
  }
  // Un doublon n'est pas une erreur de la part de l'interface, juste une redite : la
  // copie ne se declenche qu'une fois par ligne de toute facon.
  return [...new Set(raw as string[])];
}

/**
 * Assemble la selection a transmettre au service.
 *
 * Les cles absentes ne sont pas posees a `undefined` : `subcategoryIds` omis et
 * `subcategoryIds: undefined` veulent dire la meme chose cote service, mais l'objet
 * reste minimal, comme partout ailleurs dans le depot.
 */
function readSelection(input: SelectionInput): CarryOverSelection {
  const subcategoryIds = cleanIdSelection(input.subcategoryIds, "subcategoryIds");
  const allocationIds = cleanIdSelection(input.allocationIds, "allocationIds");
  return {
    ...(subcategoryIds === undefined ? {} : { subcategoryIds }),
    ...(allocationIds === undefined ? {} : { allocationIds }),
  };
}

/**
 * Budget vise par l'action.
 *
 * Absent, ce qui est le cas normal : le budget actif des preferences. L'interface n'a
 * donc rien a transporter, et les adresses /mois/2026/8 restent identiques d'un budget
 * a l'autre. Fourni : un slug, jamais un identifiant, et il est verifie comme
 * appartenant a l'utilisatrice connectee avant le moindre acces.
 */
type LedgerInput = { ledger?: LedgerSlug };

/**
 * Choix des lignes reprises du mois precedent.
 *
 * Les deux listes sont independantes et chacune obeit a la meme regle : ABSENTE veut
 * dire « tout reprendre », ce qui est le comportement d'origine et reste celui de tout
 * appel qui n'en parle pas. PRESENTE, elle limite la reprise a ce qu'elle enumere, et
 * un tableau vide ne reprend donc rien du tout, sans empecher la creation du mois.
 *
 * `subcategoryIds` porte des sous-categories et non des entrees : d'un mois a l'autre,
 * l'entree du mois source n'est pas deplacee, seul son montant est recopie sur une
 * ligne neuve. La sous-categorie est la seule cle qui survit au passage, c'est aussi
 * celle que porte la contrainte UNIQUE(month_id, subcategory_id).
 *
 * `allocationIds` porte les identifiants des allocations DU MOIS SOURCE. Une allocation
 * n'est rattachee ni a une entree ni a une sous-categorie : elle n'a aucune cle commune
 * avec les lignes, d'ou deux listes plutot qu'une.
 */
type SelectionInput = {
  subcategoryIds?: string[];
  allocationIds?: string[];
};

/**
 * Lit un mois complet. Rend null si le mois n'a jamais ete cree : ce n'est pas une
 * erreur, c'est l'etat "ce mois n'existe pas encore", et l'interface doit alors
 * proposer de le creer.
 */
export async function getMonth(
  input: { year: number; month: number } & LedgerInput,
): Promise<ActionResult<MonthView | null>> {
  return withSession(({ userId }) =>
    getMonthView(resolveScope(userId, input.ledger), input.year, input.month),
  );
}

export async function listMonths(input?: LedgerInput): Promise<ActionResult<MonthSummary[]>> {
  return withSession(({ userId }) => listMonthSummaries(resolveScope(userId, input?.ledger)));
}

export async function createMonth(
  input: { year: number; month: number } & LedgerInput,
): Promise<ActionResult<MonthView>> {
  return withSession(({ userId }) => {
    const view = createEmptyMonth(resolveScope(userId, input.ledger), input.year, input.month);
    revalidatePath("/");
    return view;
  });
}

/**
 * Lignes reprenables du mois precedent, avant toute creation.
 *
 * `year` et `month` designent le mois CIBLE, celui qu'elle ouvre, comme dans les deux
 * actions de reprise ci-dessous. Le mois source en est deduit, passage d'annee compris.
 * Rien n'est cree ni modifie : c'est une lecture, et c'est precisement ce qui permet a
 * l'interface de proposer des cases a cocher sur un mois qui n'existe pas encore.
 *
 * `source: null` n'est pas une erreur : le mois precedent n'existe pas, il n'y a rien a
 * reprendre, et l'interface doit alors proposer un mois vide.
 */
export async function getCarryOverPreview(
  input: { year: number; month: number } & LedgerInput,
): Promise<ActionResult<CarryOverPreview>> {
  return withSession(({ userId }) =>
    getCarryOverPreviewView(resolveScope(userId, input.ledger), input.year, input.month),
  );
}

/**
 * Cree le mois demande a partir du precedent. Piece maitresse du produit.
 * Idempotente : un second appel ne duplique rien et n'ecrase aucune saisie manuelle.
 * Reporte les montants ET les allocations, epargne et remboursements compris.
 *
 * `subcategoryIds` et `allocationIds` limitent la reprise aux lignes cochees. Omis, ce
 * qui reste le cas de tout appel ecrit avant eux : tout le mois precedent est repris.
 */
export async function createMonthFromPrevious(
  input: { year: number; month: number } & LedgerInput & SelectionInput,
): Promise<ActionResult<MonthView>> {
  return withSession(({ userId }) => {
    const { view } = createFromPrevious(
      resolveScope(userId, input.ledger),
      input.year,
      input.month,
      readSelection(input),
    );
    revalidatePath("/");
    return view;
  });
}

/**
 * Reprend le mois precedent sur un mois DEJA ouvert. Geste de rattrapage.
 *
 * Le report n'etait propose qu'a la creation du mois : passer par « Commencer un mois
 * vide » condamnait a retaper vingt-deux lignes, definitivement. Cette action rend le
 * geste disponible a tout moment.
 *
 * Rien n'est ecrase. Seules les lignes absentes sont ajoutees : une entree deja saisie
 * garde son montant, une allocation deja presente sous le meme libelle et la meme
 * nature n'est pas dupliquee. Rejouer l'action une seconde fois rend `carried: 0`.
 *
 * `subcategoryIds` et `allocationIds` limitent la reprise aux lignes cochees, comme a la
 * creation. Omis : tout est repris.
 */
export async function carryOverPreviousMonth(
  input: { year: number; month: number } & LedgerInput & SelectionInput,
): Promise<
  ActionResult<{
    /** Total des lignes reellement ajoutees. Zero si tout etait deja la. */
    carried: number;
    carriedEntries: number;
    carriedAllocations: number;
    totals: MonthTotals;
    view: MonthView;
  }>
> {
  return withSession(({ userId }) => {
    const result = carryOverIntoExistingMonth(
      resolveScope(userId, input.ledger),
      input.year,
      input.month,
      readSelection(input),
    );
    revalidatePath("/");
    return {
      carried: result.carried,
      carriedEntries: result.carriedEntries,
      carriedAllocations: result.carriedAllocations,
      totals: result.totals,
      view: result.view,
    };
  });
}

export async function updateMonthNote(
  input: { year: number; month: number; note: string | null } & LedgerInput,
): Promise<ActionResult<{ ok: true }>> {
  return withSession(({ userId }) => {
    const scope = resolveScope(userId, input.ledger);
    const row = findMonth(scope, input.year, input.month);
    if (!row) throw notFound("Ce mois n'existe pas.");

    if (input.note !== null && typeof input.note !== "string") {
      throw validation("La note doit être du texte.", "note");
    }
    const note = input.note === null ? null : input.note.trim().slice(0, MAX_NOTE_LENGTH);

    updateMonthNoteRow(userId, row.id, note === "" ? null : note);
    revalidatePath("/");
    return { ok: true } as const;
  });
}

/** Supprime le mois, ses entrees et ses allocations. Cascade assumee et documentee. */
export async function deleteMonth(
  input: { year: number; month: number } & LedgerInput,
): Promise<ActionResult<{ ok: true }>> {
  return withSession(({ userId }) => {
    const scope = resolveScope(userId, input.ledger);
    const row = findMonth(scope, input.year, input.month);
    if (!row) throw notFound("Ce mois n'existe pas.");
    deleteMonthRow(userId, row.id);
    revalidatePath("/");
    return { ok: true } as const;
  });
}
