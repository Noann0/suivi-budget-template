import { before, test } from "node:test";
import assert from "node:assert/strict";

import { execute } from "@/db/client";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { addToAllocation, addToEntry, findAllocation, findEntry } from "@/server/repositories/months";

import { runConcurrent } from "./helpers/run-concurrent";
import { seedAllocation, seedBudget, useScratchDatabase, type SeededBudget } from "./helpers/scratch-db";

/**
 * Preuve de l'atomicite revendiquee par le lot 4 : la borne ET l'addition vivent dans
 * la meme instruction SQL (`ON CONFLICT ... WHERE amount + excluded.amount <= ?` pour
 * les entrees, `UPDATE ... WHERE amount + ? <= ?` pour les allocations). Chaque test
 * de concurrence ouvre ses PROPRES connexions SQLite (voir helpers/run-concurrent.ts)
 * sur le meme fichier : c'est la seule maniere de faire vraiment se disputer deux
 * ecritures, le simple JS async du meme processus ne les fait jamais vraiment
 * chevaucher (mono-thread, chaque appel synchrone du driver va jusqu'au bout).
 *
 * Chaque test cree sa PROPRE ligne (sous-categorie ou allocation fraiche) : aucun etat
 * n'est partage entre tests, l'ordre d'execution ne doit rien changer au resultat.
 */

let budget: SeededBudget;
let databasePath: string;

before(() => {
  databasePath = useScratchDatabase("addto-atomic");
  budget = seedBudget();
});

/** Sous-categorie fraiche dans la categorie de depense du budget seede, pour isoler
 * chaque test d'entree sans toucher aux lignes des autres. */
function freshExpenseSubcategory(): string {
  const id = newId();
  execute(
    `INSERT INTO subcategories (id, category_id, name, created_at)
     SELECT ?, category_id, 'Sub isolee', ? FROM subcategories WHERE id = ?`,
    [id, nowIso(), budget.expenseSubcategoryId],
  );
  return id;
}

test("addToEntry cree la ligne quand elle n'existe pas encore : le delta devient le montant", () => {
  const subcategoryId = freshExpenseSubcategory();
  const entry = addToEntry({ monthId: budget.monthId, subcategoryId, deltaCents: 4000 });
  assert.ok(entry);
  assert.equal(entry.amountCents, 4000);
});

test("addToEntry ajoute au montant existant plutot que de l'ecraser", () => {
  const subcategoryId = freshExpenseSubcategory();
  addToEntry({ monthId: budget.monthId, subcategoryId, deltaCents: 4000 });
  const second = addToEntry({ monthId: budget.monthId, subcategoryId, deltaCents: 1000 });
  assert.ok(second);
  assert.equal(second.amountCents, 5000);
});

test("addToEntry refuse au franchissement du plafond, sans ecrire, sans exception", () => {
  const subcategoryId = freshExpenseSubcategory();
  const base = addToEntry({ monthId: budget.monthId, subcategoryId, deltaCents: MAX_AMOUNT_CENTS - 100 });
  assert.ok(base);
  assert.equal(base.amountCents, MAX_AMOUNT_CENTS - 100);

  const refused = addToEntry({ monthId: budget.monthId, subcategoryId, deltaCents: 200 });
  assert.equal(refused, null, "200 de plus franchirait le plafond de 100, doit etre refuse");

  const stillAtRefusalPoint = findEntry(budget.monthId, subcategoryId);
  assert.ok(stillAtRefusalPoint);
  assert.equal(stillAtRefusalPoint.amountCents, MAX_AMOUNT_CENTS - 100, "le refus ne doit rien avoir ecrit");

  const accepted = addToEntry({ monthId: budget.monthId, subcategoryId, deltaCents: 100 });
  assert.ok(accepted);
  assert.equal(accepted.amountCents, MAX_AMOUNT_CENTS, "pile au plafond, doit passer");
});

test("addToEntry sous vraie concurrence (connexions SQLite distinctes) : aucune addition perdue", async () => {
  const subcategoryId = freshExpenseSubcategory();
  const WORKERS = 20;
  const DELTA = 137;

  const outcomes = await runConcurrent(
    { kind: "entry", databasePath, monthId: budget.monthId, subcategoryId, deltaCents: DELTA },
    WORKERS,
  );

  assert.equal(
    outcomes.filter((o) => o.accepted).length,
    WORKERS,
    "aucune marge n'est franchie ici, les 20 ajouts doivent tous etre acceptes",
  );

  const final = findEntry(budget.monthId, subcategoryId);
  assert.ok(final);
  assert.equal(
    final.amountCents,
    WORKERS * DELTA,
    "la somme des 20 ecritures concurrentes doit se retrouver integralement : " +
      "c'est la preuve qu'aucune des deux ecritures parties au meme instant n'a ecrase l'autre",
  );
});

test("addToEntry au franchissement du plafond sous vraie concurrence : jamais de depassement, jamais plus d'une acceptation", async () => {
  const subcategoryId = freshExpenseSubcategory();
  // Marge de 150 avant plafond, delta de 100 par worker : au plus UNE tentative sur
  // cinq peut passer (150 / 100 = 1.5). Si la garde n'etait qu'en amont (testee sur
  // l'entree du client, pas sur l'etat reel en base), une course pourrait laisser
  // passer plus d'une acceptation et depasser le plafond.
  const seeded = addToEntry({ monthId: budget.monthId, subcategoryId, deltaCents: MAX_AMOUNT_CENTS - 150 });
  assert.ok(seeded);

  const WORKERS = 5;
  const DELTA = 100;
  const outcomes = await runConcurrent(
    { kind: "entry", databasePath, monthId: budget.monthId, subcategoryId, deltaCents: DELTA },
    WORKERS,
  );

  assert.equal(
    outcomes.filter((o) => o.accepted).length,
    1,
    "exactement une acceptation attendue a la marge de 150 pour un delta de 100",
  );

  const final = findEntry(budget.monthId, subcategoryId);
  assert.ok(final);
  assert.ok(final.amountCents <= MAX_AMOUNT_CENTS, "le plafond ne doit jamais avoir ete depasse, meme transitoirement");
  assert.equal(final.amountCents, MAX_AMOUNT_CENTS - 150 + DELTA);
});

test("addToAllocation ajoute au montant existant, retourne le nombre de lignes touchees", () => {
  const allocationId = seedAllocation(budget.monthId, "savings", 5000, "Livret");
  const changes = addToAllocation(allocationId, 3000);
  assert.equal(changes, 1);
  const updated = findAllocation(budget.userId, allocationId);
  assert.ok(updated);
  assert.equal(updated.amountCents, 8000);
});

test("addToAllocation refuse au franchissement du plafond sans exception, rend 0 ligne touchee", () => {
  const allocationId = seedAllocation(budget.monthId, "debt", MAX_AMOUNT_CENTS - 100, "Pret");
  const refused = addToAllocation(allocationId, 200);
  assert.equal(refused, 0);
  const untouched = findAllocation(budget.userId, allocationId);
  assert.ok(untouched);
  assert.equal(untouched.amountCents, MAX_AMOUNT_CENTS - 100, "le montant ne doit pas avoir bouge");

  const accepted = addToAllocation(allocationId, 100);
  assert.equal(accepted, 1);
});

test("addToAllocation sous vraie concurrence : aucune addition perdue", async () => {
  const allocationId = seedAllocation(budget.monthId, "savings", 0, "Epargne rafale");
  const WORKERS = 20;
  const DELTA = 137;
  const outcomes = await runConcurrent({ kind: "allocation", databasePath, allocationId, deltaCents: DELTA }, WORKERS);
  assert.equal(outcomes.filter((o) => o.accepted).length, WORKERS);

  const updated = findAllocation(budget.userId, allocationId);
  assert.ok(updated);
  assert.equal(updated.amountCents, WORKERS * DELTA, "la somme des 20 ecritures concurrentes doit se retrouver integralement");
});

test("addToAllocation au franchissement du plafond sous vraie concurrence : jamais plus d'une acceptation possible", async () => {
  const allocationId = seedAllocation(budget.monthId, "debt", MAX_AMOUNT_CENTS - 150, "Pret rafale");
  const WORKERS = 5;
  const DELTA = 100;
  const outcomes = await runConcurrent({ kind: "allocation", databasePath, allocationId, deltaCents: DELTA }, WORKERS);
  assert.equal(outcomes.filter((o) => o.accepted).length, 1);

  const updated = findAllocation(budget.userId, allocationId);
  assert.ok(updated);
  assert.ok(updated.amountCents <= MAX_AMOUNT_CENTS);
  assert.equal(updated.amountCents, MAX_AMOUNT_CENTS - 150 + DELTA);
});
