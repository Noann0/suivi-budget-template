import { execute, query, queryOne, fromSqlBool } from "@/db/client";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import type {
  Allocation,
  AllocationKind,
  CarryOverAllocationCandidate,
  CarryOverEntryCandidate,
  CategoryKind,
  ColorIntensity,
  Entry,
  Hue,
  YearCategorySlice,
} from "@/lib/types";

import type { LedgerScope } from "./ledgers";

/**
 * Acces aux mois, entrees et allocations. SQL et mapping uniquement.
 *
 * Un mois appartient a un budget : aout 2026 existe une fois dans le joint et une fois
 * dans le perso, sans que les deux ne se voient. Les recherches par periode prennent
 * donc un `LedgerScope`. Les recherches par identifiant restent scopees par la seule
 * utilisatrice, et rapportent le budget du mois trouve : c'est ce `ledgerId` qui sert
 * de perimetre a la suite du traitement, jamais une valeur venue du navigateur.
 */

export type MonthRow = {
  id: string;
  ledgerId: string;
  year: number;
  month: number;
  note: string | null;
};

type MonthDbRow = {
  id: string;
  ledger_id: string;
  year: number;
  month: number;
  note: string | null;
};

const MONTH_COLUMNS = "id, ledger_id, year, month, note";

function toMonthRow(row: MonthDbRow): MonthRow {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    year: row.year,
    month: row.month,
    note: row.note,
  };
}

type EntryRow = {
  id: string;
  month_id: string;
  subcategory_id: string;
  amount_cents: number;
  is_carried: number;
  note: string | null;
};

type AllocationRow = {
  id: string;
  month_id: string;
  kind: string;
  amount_cents: number;
  label: string;
};

function toEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    monthId: row.month_id,
    subcategoryId: row.subcategory_id,
    amountCents: row.amount_cents,
    isCarried: fromSqlBool(row.is_carried),
    note: row.note,
  };
}

function toAllocation(row: AllocationRow): Allocation {
  return {
    id: row.id,
    monthId: row.month_id,
    kind: row.kind as AllocationKind,
    amountCents: row.amount_cents,
    label: row.label,
  };
}

export function findMonth(scope: LedgerScope, year: number, month: number): MonthRow | null {
  const row = queryOne<MonthDbRow>(
    `SELECT ${MONTH_COLUMNS} FROM months
      WHERE user_id = ? AND ledger_id = ? AND year = ? AND month = ?`,
    [scope.userId, scope.ledgerId, year, month],
  );
  return row ? toMonthRow(row) : null;
}

export function findMonthById(userId: string, monthId: string): MonthRow | null {
  const row = queryOne<MonthDbRow>(
    `SELECT ${MONTH_COLUMNS} FROM months WHERE id = ? AND user_id = ?`,
    [monthId, userId],
  );
  return row ? toMonthRow(row) : null;
}

export function listMonthRows(scope: LedgerScope): MonthRow[] {
  return query<MonthDbRow>(
    `SELECT ${MONTH_COLUMNS} FROM months
      WHERE user_id = ? AND ledger_id = ? ORDER BY year DESC, month DESC`,
    [scope.userId, scope.ledgerId],
  ).map(toMonthRow);
}

export function listMonthRowsForYear(scope: LedgerScope, year: number): MonthRow[] {
  return query<MonthDbRow>(
    `SELECT ${MONTH_COLUMNS} FROM months
      WHERE user_id = ? AND ledger_id = ? AND year = ? ORDER BY month ASC`,
    [scope.userId, scope.ledgerId, year],
  ).map(toMonthRow);
}

type YearCategoryTotalRow = {
  category_id: string;
  name: string;
  hue: number;
  intensity: string | null;
  is_archived: number;
  amount_cents: number;
};

/**
 * Ventilation des depenses d'une annee entiere par categorie, en UNE seule agregation.
 *
 * Le detour par les vues de mois etait tentant, les totaux y sont deja calcules. Il
 * aurait coute douze reconstructions completes de l'arbre categories/sous-categories
 * pour n'en garder qu'un sous-total par categorie. Ici SQLite fait la somme sur place.
 *
 * Trois filtres portent le sens :
 * - le perimetre est celui des mois (utilisatrice ET budget) : melanger le foyer et le
 *   compte perso sur un meme camembert additionnerait deux realites sans rapport ;
 * - `c.ledger_id = m.ledger_id` est correle au mois plutot que repete en parametre, ce
 *   qui rend impossible qu'une entree soit comptee sous une categorie d'un autre
 *   budget, exactement la regle que `buildMonthView` applique de son cote ;
 * - `HAVING > 0` ecarte les categories sans depense sur l'annee. Les archivees qui
 *   portent encore un montant, elles, restent : l'historique doit rester fidele.
 *
 * Le tri decroissant est rendu par le SQL, le camembert se dessine dans cet ordre. Le
 * nom ne sert que de departage, pour que deux montants egaux ne s'inversent pas d'un
 * appel a l'autre.
 */
export function listYearExpenseByCategory(
  scope: LedgerScope,
  year: number,
): YearCategorySlice[] {
  return query<YearCategoryTotalRow>(
    `SELECT c.id          AS category_id,
            c.name        AS name,
            c.hue         AS hue,
            c.intensity   AS intensity,
            c.is_archived AS is_archived,
            SUM(e.amount_cents) AS amount_cents
       FROM entries e
       JOIN months m        ON m.id = e.month_id
       JOIN subcategories s ON s.id = e.subcategory_id
       JOIN categories c    ON c.id = s.category_id AND c.ledger_id = m.ledger_id
      WHERE m.user_id = ? AND m.ledger_id = ? AND m.year = ?
        AND c.kind = 'expense'
      GROUP BY c.id
     HAVING SUM(e.amount_cents) > 0
      ORDER BY amount_cents DESC, c.name ASC`,
    [scope.userId, scope.ledgerId, year],
  ).map((row) => ({
    // Meme convention qu'ailleurs dans les repositories : ces colonnes ne sont ecrites
    // que par ce depot, sous contrainte CHECK, on leur fait confiance a la lecture.
    categoryId: row.category_id,
    name: row.name,
    hue: row.hue as Hue,
    intensity: (row.intensity as ColorIntensity | null) ?? null,
    isArchived: fromSqlBool(row.is_archived),
    amountCents: row.amount_cents,
  }));
}

export function insertMonth(scope: LedgerScope, year: number, month: number): MonthRow {
  const id = newId();
  execute(
    `INSERT INTO months (id, user_id, ledger_id, year, month, note, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [id, scope.userId, scope.ledgerId, year, month, nowIso()],
  );
  return { id, ledgerId: scope.ledgerId, year, month, note: null };
}

export function updateMonthNote(userId: string, monthId: string, note: string | null): void {
  execute(`UPDATE months SET note = ? WHERE id = ? AND user_id = ?`, [note, monthId, userId]);
}

/** La suppression cascade sur entries et allocations via les cles etrangeres. */
export function deleteMonth(userId: string, monthId: string): number {
  return execute(`DELETE FROM months WHERE id = ? AND user_id = ?`, [monthId, userId]).changes;
}

export function listEntries(monthId: string): Entry[] {
  return query<EntryRow>(
    `SELECT id, month_id, subcategory_id, amount_cents, is_carried, note
       FROM entries WHERE month_id = ?`,
    [monthId],
  ).map(toEntry);
}

export function findEntry(monthId: string, subcategoryId: string): Entry | null {
  const row = queryOne<EntryRow>(
    `SELECT id, month_id, subcategory_id, amount_cents, is_carried, note
       FROM entries WHERE month_id = ? AND subcategory_id = ?`,
    [monthId, subcategoryId],
  );
  return row ? toEntry(row) : null;
}

/**
 * Upsert sur la contrainte UNIQUE(month_id, subcategory_id).
 * `is_carried` retombe systematiquement a 0 : l'acte de confirmation compte autant
 * que le changement de chiffre, meme si le montant ecrit est identique au report.
 *
 * `note` distingue trois intentions, et cette distinction repare une perte de donnees
 * silencieuse : `undefined` veut dire « je ne parle pas de la note », `null` veut dire
 * « efface-la ». L'ecriture inconditionnelle `note = excluded.note` faisait des deux le
 * meme geste, si bien que chaque saisie de montant, qui ne transmet aucune note,
 * effacait celle qui existait sans que rien ne l'annonce.
 */
export function upsertEntry(input: {
  monthId: string;
  subcategoryId: string;
  amountCents: number;
  note?: string | null;
}): Entry {
  const now = nowIso();
  // La condition est portee par un parametre plutot que par deux requetes : une seule
  // instruction, donc un seul plan d'execution a relire quand il faudra y revenir.
  const writeNote = input.note === undefined ? 0 : 1;
  const row = queryOne<EntryRow>(
    `INSERT INTO entries
       (id, month_id, subcategory_id, amount_cents, is_carried, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT (month_id, subcategory_id) DO UPDATE SET
       amount_cents = excluded.amount_cents,
       is_carried   = 0,
       note         = CASE WHEN ? = 1 THEN excluded.note ELSE entries.note END,
       updated_at   = excluded.updated_at
     RETURNING id, month_id, subcategory_id, amount_cents, is_carried, note`,
    [
      newId(),
      input.monthId,
      input.subcategoryId,
      input.amountCents,
      input.note ?? null,
      now,
      now,
      writeNote,
    ],
  );
  // RETURNING sur un upsert rend toujours une ligne : le cas nul est impossible ici.
  return toEntry(row as EntryRow);
}

/**
 * Ajoute un delta au montant d'une entree, en une seule instruction.
 *
 * L'addition appartient a SQLite, jamais a l'appelant. L'ecran ecrit son etat de
 * maniere optimiste, avant meme la reponse du serveur : deux ajouts rapproches
 * partiraient donc de la meme valeur lue et le second effacerait le premier. Ici la
 * valeur de depart est celle qui se trouve en base au moment de l'ecriture.
 *
 * Entree absente : la ligne est creee avec le delta pour montant. Ajouter 40 a rien
 * donne 40, l'appelant n'a aucune lecture prealable a faire.
 *
 * La borne haute est portee par le `WHERE` de la branche de conflit, pas par un test
 * en amont : entre une lecture et une ecriture separees, la valeur peut changer. Quand
 * elle serait franchie, aucune ligne n'est touchee, `RETURNING` ne rend rien, et c'est
 * ce `null` que l'appelant traduit en refus. La contrainte `CHECK` de la table ne sort
 * ainsi jamais en exception brute devant l'utilisatrice.
 *
 * La branche d'insertion, elle, n'a pas de garde : `deltaCents` est valide en amont
 * dans les bornes, donc une creation ne peut pas les franchir.
 *
 * `is_carried` retombe a 0 comme pour un upsert : ajouter a une ligne reportee, c'est
 * la confirmer, et le montant de depart est bien celui qu'elle a sous les yeux.
 */
export function addToEntry(input: {
  monthId: string;
  subcategoryId: string;
  deltaCents: number;
}): Entry | null {
  const now = nowIso();
  const row = queryOne<EntryRow>(
    `INSERT INTO entries
       (id, month_id, subcategory_id, amount_cents, is_carried, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
     ON CONFLICT (month_id, subcategory_id) DO UPDATE SET
       amount_cents = entries.amount_cents + excluded.amount_cents,
       is_carried   = 0,
       updated_at   = excluded.updated_at
     WHERE entries.amount_cents + excluded.amount_cents <= ?
     RETURNING id, month_id, subcategory_id, amount_cents, is_carried, note`,
    [
      newId(),
      input.monthId,
      input.subcategoryId,
      input.deltaCents,
      now,
      now,
      MAX_AMOUNT_CENTS,
    ],
  );
  // La note n'est pas dans le SET : un ajout de montant ne parle pas de la note.
  return row ? toEntry(row) : null;
}

export function deleteEntry(monthId: string, subcategoryId: string): number {
  return execute(`DELETE FROM entries WHERE month_id = ? AND subcategory_id = ?`, [
    monthId,
    subcategoryId,
  ]).changes;
}

export function confirmCarriedEntries(monthId: string): number {
  return execute(
    `UPDATE entries SET is_carried = 0, updated_at = ? WHERE month_id = ? AND is_carried = 1`,
    [nowIso(), monthId],
  ).changes;
}

type CarryOverEntryCandidateRow = {
  subcategory_id: string;
  subcategory_name: string;
  category_id: string;
  category_name: string;
  kind: string;
  hue: number;
  intensity: string | null;
  amount_cents: number;
  already_in_target: number;
};

/**
 * Lignes reprenables d'un mois source, pour l'apercu propose avant la reprise.
 *
 * Les filtres sont EXACTEMENT ceux de `copyEntriesFromMonth` : montant strictement
 * positif, sous-categorie et categorie non archivees. C'est la condition pour que
 * l'apercu ne propose rien qui serait ensuite ecarte en silence, et la seule raison
 * pour laquelle les deux requetes se ressemblent a ce point. Toute modification de
 * l'une appelle la meme modification de l'autre.
 *
 * `targetMonthId` peut etre null : le mois cible n'existe pas encore, cas normal de la
 * creation. Le comparer a NULL ne ramene alors aucune ligne, donc `already_in_target`
 * vaut 0 partout, sans branche SQL separee.
 *
 * L'ordre des parametres suit l'ordre des `?` dans le texte SQL, pas l'ordre des
 * arguments de la fonction : le mois cible apparait d'abord, dans le EXISTS du SELECT.
 */
export function listCarryOverEntryCandidates(
  sourceMonthId: string,
  targetMonthId: string | null,
): CarryOverEntryCandidate[] {
  return query<CarryOverEntryCandidateRow>(
    `SELECT e.subcategory_id         AS subcategory_id,
            s.name                   AS subcategory_name,
            c.id                     AS category_id,
            c.name                   AS category_name,
            c.kind                   AS kind,
            c.hue                    AS hue,
            c.intensity              AS intensity,
            e.amount_cents           AS amount_cents,
            EXISTS (
              SELECT 1 FROM entries t
               WHERE t.month_id = ? AND t.subcategory_id = e.subcategory_id
            )                        AS already_in_target
       FROM entries e
       JOIN subcategories s ON s.id = e.subcategory_id
       JOIN categories   c ON c.id = s.category_id
      WHERE e.month_id = ?
        AND e.amount_cents > 0
        AND s.is_archived = 0
        AND c.is_archived = 0
      ORDER BY (c.kind = 'income') DESC, c.sort_order ASC, c.name ASC,
               s.sort_order ASC, s.name ASC`,
    [targetMonthId, sourceMonthId],
  ).map((row) => ({
    subcategoryId: row.subcategory_id,
    subcategoryName: row.subcategory_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    // Meme convention qu'ailleurs dans ce depot : ces colonnes ne sont ecrites que par
    // ce code, sous contrainte CHECK, on leur fait confiance a la lecture.
    categoryKind: row.kind as CategoryKind,
    categoryHue: row.hue as Hue,
    categoryIntensity: (row.intensity as ColorIntensity | null) ?? null,
    amountCents: row.amount_cents,
    alreadyInTarget: fromSqlBool(row.already_in_target),
  }));
}

type CarryOverAllocationCandidateRow = {
  id: string;
  kind: string;
  label: string;
  amount_cents: number;
  already_in_target: number;
};

/**
 * Allocations reprenables d'un mois source. Pendant exact de la fonction ci-dessus,
 * avec la cle naturelle de `copyAllocationsFromMonth` pour juger de la presence dans le
 * mois cible : le couple (libelle, nature), casse ignoree.
 *
 * L'identifiant rendu est celui de l'allocation SOURCE. C'est la seule cle stable dont
 * l'interface dispose pour designer une allocation : la table n'a aucune contrainte
 * d'unicite, deux epargnes de meme libelle y sont legitimes.
 */
export function listCarryOverAllocationCandidates(
  sourceMonthId: string,
  targetMonthId: string | null,
): CarryOverAllocationCandidate[] {
  return query<CarryOverAllocationCandidateRow>(
    `SELECT a.id           AS id,
            a.kind         AS kind,
            a.label        AS label,
            a.amount_cents AS amount_cents,
            EXISTS (
              SELECT 1 FROM allocations t
               WHERE t.month_id = ?
                 AND t.kind = a.kind
                 AND LOWER(t.label) = LOWER(a.label)
            )              AS already_in_target
       FROM allocations a
      WHERE a.month_id = ?
        AND a.amount_cents > 0
      ORDER BY a.created_at ASC`,
    [targetMonthId, sourceMonthId],
  ).map((row) => ({
    id: row.id,
    kind: row.kind as AllocationKind,
    label: row.label,
    amountCents: row.amount_cents,
    alreadyInTarget: fromSqlBool(row.already_in_target),
  }));
}

/**
 * Recopie les entrees non nulles d'un mois vers un autre, marquees comme reportees.
 *
 * Trois garde-fous portes par le SQL lui-meme :
 * - `amount_cents > 0` : reporter un zero n'apporte rien et encombre l'ecran ;
 * - la jointure sur subcategories et categories exclut ce qui a ete archive depuis ;
 * - `ON CONFLICT DO NOTHING` rend l'operation idempotente. Une ligne deja presente
 *   dans le mois cible, meme modifiee a la main, n'est jamais ecrasee.
 *
 * Les notes de ligne ne sont volontairement pas reportees : une note du type
 * "regularisation" ne vaut que pour son mois.
 *
 * `selectedSubcategoryIds` restreint la copie aux seules lignes choisies. Absent, ce
 * qui reste le cas de tous les appels historiques : tout le mois est repris, exactement
 * comme avant. Ensemble vide : aucune ligne, ce qui est une intention legitime et non
 * un appel a ignorer.
 *
 * Le filtrage se fait sur l'ensemble deja lu plutot que par une clause `IN` construite
 * a la volee : une liste de `?` generee depuis une longueur reste parametree, mais elle
 * fabrique un texte SQL different a chaque appel, donc un plan de plus dans le cache a
 * chaque taille de selection. Le volume est d'une trentaine de lignes et la boucle
 * d'insertion existait deja.
 */
export function copyEntriesFromMonth(
  sourceMonthId: string,
  targetMonthId: string,
  selectedSubcategoryIds?: ReadonlySet<string>,
): number {
  const now = nowIso();

  // Les lignes a reporter sont d'abord selectionnees, puis inserees une a une.
  // L'insertion ensembliste generait l'identifiant en SQL via lower(hex(randomblob(16))),
  // soit 32 caracteres hexadecimaux, alors que tout le reste du depot utilise newId()
  // et ses 21 caracteres annonces au contrat. Aucune consequence fonctionnelle, mais
  // une deviation silencieuse d'un contrat publie finit toujours par surprendre
  // quelqu'un. Le volume est d'une trentaine de lignes et l'appelant tient deja une
  // transaction : le cout de la boucle est nul.
  const sources = query<{ subcategory_id: string; amount_cents: number }>(
    `SELECT e.subcategory_id, e.amount_cents
       FROM entries e
       JOIN subcategories s ON s.id = e.subcategory_id
       JOIN categories   c ON c.id = s.category_id
      WHERE e.month_id = ?
        AND e.amount_cents > 0
        AND s.is_archived = 0
        AND c.is_archived = 0`,
    [sourceMonthId],
  );

  let inserted = 0;
  for (const source of sources) {
    if (selectedSubcategoryIds && !selectedSubcategoryIds.has(source.subcategory_id)) {
      continue;
    }
    // ON CONFLICT DO NOTHING : une ligne deja presente dans le mois cible, meme
    // modifiee a la main, n'est jamais ecrasee. C'est ce qui rend l'operation
    // rejouable sans effet.
    const { changes } = execute(
      `INSERT INTO entries
         (id, month_id, subcategory_id, amount_cents, is_carried, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NULL, ?, ?)
       ON CONFLICT (month_id, subcategory_id) DO NOTHING`,
      [newId(), targetMonthId, source.subcategory_id, source.amount_cents, now, now],
    );
    inserted += changes;
  }
  return inserted;
}

/**
 * Recopie les allocations d'un mois vers un autre : epargne et remboursements.
 *
 * Le bug qui a motive cette fonction. Le report ne copiait que les `entries`, jamais
 * les allocations : juillet portait 150 EUR d'epargne et 50 EUR de remboursement, aout
 * a ete cree par report et n'en a herite aucune. Vu de l'utilisatrice, l'application
 * « ne gardait rien en memoire ». Ces lignes sont pourtant les plus stables du mois :
 * un virement d'epargne se reconduit, il ne se resaisit pas.
 *
 * Idempotence, et c'est le point delicat : `allocations` n'a aucune contrainte UNIQUE,
 * donc `ON CONFLICT` n'a rien sur quoi s'appuyer. La cle naturelle retenue est le
 * couple (libelle, nature), compare sans tenir compte de la casse, comme partout
 * ailleurs dans le depot pour les noms. Une allocation deja presente sous ce libelle
 * et cette nature n'est ni dupliquee ni ecrasee, meme si son montant a ete ajuste a la
 * main. Rejouer le report est donc sans effet.
 *
 * Le choix alternatif, « ne copier que si le mois cible est vierge », a ete ecarte :
 * il aurait rendu le report inoperant des qu'une seule allocation aurait ete saisie,
 * exactement le cas du mois deja commence que vise la reprise manuelle.
 *
 * `selectedAllocationIds` designe des allocations du mois SOURCE, par identifiant.
 * Absent : toutes sont reprises, comportement historique inchange. Cette selection est
 * independante de celle des lignes : une allocation n'est rattachee ni a une entree ni
 * a une sous-categorie, seulement a son mois.
 */
export function copyAllocationsFromMonth(
  sourceMonthId: string,
  targetMonthId: string,
  selectedAllocationIds?: ReadonlySet<string>,
): number {
  const now = nowIso();

  const sources = query<{ id: string; kind: string; amount_cents: number; label: string }>(
    `SELECT a.id, a.kind, a.amount_cents, a.label
       FROM allocations a
      WHERE a.month_id = ?
        AND a.amount_cents > 0
        AND NOT EXISTS (
          SELECT 1 FROM allocations t
           WHERE t.month_id = ?
             AND t.kind = a.kind
             AND LOWER(t.label) = LOWER(a.label)
        )
      ORDER BY a.created_at ASC`,
    [sourceMonthId, targetMonthId],
  );

  let inserted = 0;
  for (const source of sources) {
    if (selectedAllocationIds && !selectedAllocationIds.has(source.id)) continue;
    const { changes } = execute(
      `INSERT INTO allocations (id, month_id, kind, amount_cents, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), targetMonthId, source.kind, source.amount_cents, source.label, now],
    );
    inserted += changes;
  }
  return inserted;
}

export function listAllocations(monthId: string): Allocation[] {
  return query<AllocationRow>(
    `SELECT id, month_id, kind, amount_cents, label
       FROM allocations WHERE month_id = ? ORDER BY created_at ASC`,
    [monthId],
  ).map(toAllocation);
}

export function findAllocation(userId: string, id: string): Allocation | null {
  const row = queryOne<AllocationRow>(
    `SELECT a.id, a.month_id, a.kind, a.amount_cents, a.label
       FROM allocations a
       JOIN months m ON m.id = a.month_id
      WHERE a.id = ? AND m.user_id = ?`,
    [id, userId],
  );
  return row ? toAllocation(row) : null;
}

export function insertAllocation(input: {
  monthId: string;
  kind: AllocationKind;
  amountCents: number;
  label: string;
}): Allocation {
  const id = newId();
  execute(
    `INSERT INTO allocations (id, month_id, kind, amount_cents, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.monthId, input.kind, input.amountCents, input.label, nowIso()],
  );
  return { id, monthId: input.monthId, kind: input.kind, amountCents: input.amountCents, label: input.label };
}

export function updateAllocation(
  id: string,
  fields: { amountCents?: number; label?: string },
): void {
  execute(
    `UPDATE allocations
        SET amount_cents = COALESCE(?, amount_cents),
            label        = COALESCE(?, label)
      WHERE id = ?`,
    [fields.amountCents ?? null, fields.label ?? null, id],
  );
}

/**
 * Ajoute un delta au montant d'une allocation deja creee. Meme besoin que pour les
 * entrees : elle met 50 de cote en debut de mois, puis 30 de plus, sans refaire
 * l'addition de tete.
 *
 * Pas d'upsert ici, et c'est deliberement une autre operation plutot qu'une
 * generalisation de `addToEntry` : `allocations` n'a aucune contrainte UNIQUE sur
 * laquelle un `ON CONFLICT` pourrait s'appuyer, deux epargnes de meme libelle y sont
 * legitimes. La ligne visee est donc toujours une ligne existante, designee par son
 * identifiant, exactement comme le fait deja `updateAllocation`. L'atomicite ne vient
 * pas du conflit mais du fait que la lecture et l'addition vivent dans le meme UPDATE.
 *
 * Rend le nombre de lignes touchees : 0 signifie soit ligne absente, soit borne haute
 * franchie. L'appelant releve la ligne pour trancher entre les deux, une lecture qui ne
 * sert qu'a rediger le refus et n'entre dans aucun calcul.
 */
export function addToAllocation(id: string, deltaCents: number): number {
  return execute(
    `UPDATE allocations
        SET amount_cents = amount_cents + ?
      WHERE id = ?
        AND amount_cents + ? <= ?`,
    [deltaCents, id, deltaCents, MAX_AMOUNT_CENTS],
  ).changes;
}

export function deleteAllocation(id: string): number {
  return execute(`DELETE FROM allocations WHERE id = ?`, [id]).changes;
}
