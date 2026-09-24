import { before, test } from "node:test";
import assert from "node:assert/strict";

import { addToEntry, findEntry, upsertEntry } from "@/server/repositories/months";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { execute } from "@/db/client";

import { seedBudget, useScratchDatabase, type SeededBudget } from "./helpers/scratch-db";

/**
 * Preuve de la semantique a trois intentions sur `note` (`entries.note`), le bug
 * d'origine du 2026-09-04 : une saisie de montant qui ne parle pas de la note ne doit
 * plus jamais l'effacer.
 *
 * IMPORTANT, constate en lisant `src/lib/types.ts` : `Allocation` n'a PAS de champ
 * `note` (seulement `id`, `monthId`, `kind`, `amountCents`, `label`). Le brief demande
 * de verifier cette semantique "sur les quatre sortes de lignes concernees" (depenses,
 * revenus, epargne, remboursement), mais seules les deux premieres passent par la
 * table `entries`, qui porte la colonne `note`. Epargne et remboursement passent par
 * `allocations`, qui n'a jamais eu de note et n'est donc pas concernee par ce bug ni
 * par son correctif. Voir le rapport de fin de tache pour le detail de cette
 * correction apportee au brief.
 */

let budget: SeededBudget;

before(() => {
  useScratchDatabase("note-semantics");
  budget = seedBudget();
});

function freshSubcategory(parentId: string): string {
  const id = newId();
  execute(
    `INSERT INTO subcategories (id, category_id, name, created_at)
     SELECT ?, category_id, 'Sub note', ? FROM subcategories WHERE id = ?`,
    [id, nowIso(), parentId],
  );
  return id;
}

test("upsertEntry : note omise (undefined) a la creation laisse la note a null", () => {
  const subcategoryId = freshSubcategory(budget.expenseSubcategoryId);
  const entry = upsertEntry({ monthId: budget.monthId, subcategoryId, amountCents: 1000 });
  assert.equal(entry.note, null);
});

test("upsertEntry : note fournie a la creation est ecrite", () => {
  const subcategoryId = freshSubcategory(budget.expenseSubcategoryId);
  const entry = upsertEntry({
    monthId: budget.monthId,
    subcategoryId,
    amountCents: 1000,
    note: "Cadeau anniversaire",
  });
  assert.equal(entry.note, "Cadeau anniversaire");
});

test("upsertEntry : une saisie de montant SANS parler de la note (undefined) preserve la note existante  -  c'est le bug d'origine", () => {
  const subcategoryId = freshSubcategory(budget.expenseSubcategoryId);
  upsertEntry({ monthId: budget.monthId, subcategoryId, amountCents: 1000, note: "Régularisation" });

  // Exactement le geste qui effacait la note avant le correctif : l'ecran de saisie du
  // montant renvoie amountCents SEUL, sans jamais transmettre `note`.
  const afterAmountEdit = upsertEntry({ monthId: budget.monthId, subcategoryId, amountCents: 1400 });

  assert.equal(afterAmountEdit.amountCents, 1400, "le montant doit bien avoir change");
  assert.equal(
    afterAmountEdit.note,
    "Régularisation",
    "la note doit survivre a une saisie de montant qui ne la mentionne pas",
  );
});

test("upsertEntry : note: null efface explicitement une note existante", () => {
  const subcategoryId = freshSubcategory(budget.expenseSubcategoryId);
  upsertEntry({ monthId: budget.monthId, subcategoryId, amountCents: 1000, note: "A effacer" });

  const erased = upsertEntry({ monthId: budget.monthId, subcategoryId, amountCents: 1000, note: null });
  assert.equal(erased.note, null, "note: null doit effacer explicitement");
});

test("upsertEntry : note: valeur remplace une note existante par une nouvelle", () => {
  const subcategoryId = freshSubcategory(budget.expenseSubcategoryId);
  upsertEntry({ monthId: budget.monthId, subcategoryId, amountCents: 1000, note: "Premiere note" });

  const replaced = upsertEntry({
    monthId: budget.monthId,
    subcategoryId,
    amountCents: 1000,
    note: "Deuxieme note",
  });
  assert.equal(replaced.note, "Deuxieme note");
});

test("upsertEntry : trois appels successifs (set, omission, set) valident les trois intentions dans l'ordre", () => {
  const subcategoryId = freshSubcategory(budget.incomeSubcategoryId);

  const first = upsertEntry({ monthId: budget.monthId, subcategoryId, amountCents: 500, note: "Prime" });
  assert.equal(first.note, "Prime");

  const second = upsertEntry({ monthId: budget.monthId, subcategoryId, amountCents: 800 }); // undefined
  assert.equal(second.note, "Prime", "note doit survivre, aucune intention exprimee");

  const third = upsertEntry({ monthId: budget.monthId, subcategoryId, amountCents: 800, note: "Prime corrigée" });
  assert.equal(third.note, "Prime corrigée");
});

test("addToEntry (ajout par delta) ne touche jamais la note, quel que soit son etat", () => {
  const subcategoryId = freshSubcategory(budget.expenseSubcategoryId);
  upsertEntry({ monthId: budget.monthId, subcategoryId, amountCents: 1000, note: "Loyer" });

  const afterAdd = addToEntry({ monthId: budget.monthId, subcategoryId, deltaCents: 200 });
  assert.ok(afterAdd);
  assert.equal(afterAdd.amountCents, 1200);
  assert.equal(afterAdd.note, "Loyer", "addToEntry ne doit jamais effacer ni modifier la note");
});

test("addToEntry sur une ligne inexistante cree la ligne avec note null (jamais de note fantome)", () => {
  const subcategoryId = freshSubcategory(budget.incomeSubcategoryId);
  const created = addToEntry({ monthId: budget.monthId, subcategoryId, deltaCents: 300 });
  assert.ok(created);
  assert.equal(created.note, null);
});

test("relecture par findEntry confirme la persistance de la note (pas seulement la valeur de retour de l'upsert)", () => {
  const subcategoryId = freshSubcategory(budget.expenseSubcategoryId);
  upsertEntry({ monthId: budget.monthId, subcategoryId, amountCents: 1000, note: "Persistee" });
  upsertEntry({ monthId: budget.monthId, subcategoryId, amountCents: 1500 }); // undefined, ne doit rien changer

  const reread = findEntry(budget.monthId, subcategoryId);
  assert.ok(reread);
  assert.equal(reread.note, "Persistee");
  assert.equal(reread.amountCents, 1500);
});
