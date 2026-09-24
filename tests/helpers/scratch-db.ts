import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execute } from "@/db/client";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";

/**
 * Base SQLite jetable pour la suite de tests.
 *
 * `DATABASE_PATH` n'est JAMAIS laisse a sa valeur par defaut (`./data/budget.db`) :
 * c'est exactement l'oubli qui a migre la base locale par accident le 2026-09-04.
 * Chaque fichier de test tourne dans son propre processus (`node --test` isole les
 * fichiers), donc chacun peut poser cette variable sans se marcher dessus, mais
 * l'appel doit rester le premier contact avec la base : `getEnv()` met sa lecture en
 * cache au premier appel.
 */
export function useScratchDatabase(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `suivi-budget-test-${prefix}-`));
  const path = join(dir, "test.db");
  process.env.DATABASE_PATH = path;
  return path;
}

export type SeededBudget = {
  userId: string;
  ledgerId: string;
  monthId: string;
  expenseSubcategoryId: string;
  incomeSubcategoryId: string;
};

/**
 * Semis minimal mais valide vis-a-vis des cles etrangeres : une utilisatrice, un
 * budget, une categorie de chaque nature avec sa sous-categorie, un mois. Les
 * repositories testes (`addToEntry`, `addToAllocation`, `upsertEntry`) ne verifient
 * eux-memes aucune cle etrangere, mais `PRAGMA foreign_keys = ON` (voir db/client.ts)
 * la fait respecter par SQLite : un test qui viserait un mois ou une sous-categorie
 * inexistante echouerait sur la contrainte, pas sur la logique visee.
 */
export function seedBudget(): SeededBudget {
  const now = nowIso();
  const userId = newId();
  const ledgerId = newId();
  const expenseCategoryId = newId();
  const incomeCategoryId = newId();
  const expenseSubcategoryId = newId();
  const incomeSubcategoryId = newId();
  const monthId = newId();

  execute(`INSERT INTO users (id, created_at) VALUES (?, ?)`, [userId, now]);
  execute(
    `INSERT INTO ledgers (id, user_id, slug, name, sort_order, created_at)
     VALUES (?, ?, 'joint', 'Joint', 0, ?)`,
    [ledgerId, userId, now],
  );
  execute(
    `INSERT INTO categories (id, user_id, ledger_id, name, hue, kind, created_at)
     VALUES (?, ?, ?, 'Dépenses test', 1, 'expense', ?)`,
    [expenseCategoryId, userId, ledgerId, now],
  );
  execute(
    `INSERT INTO categories (id, user_id, ledger_id, name, hue, kind, created_at)
     VALUES (?, ?, ?, 'Revenus test', 2, 'income', ?)`,
    [incomeCategoryId, userId, ledgerId, now],
  );
  execute(
    `INSERT INTO subcategories (id, category_id, name, created_at) VALUES (?, ?, 'Sub dépense', ?)`,
    [expenseSubcategoryId, expenseCategoryId, now],
  );
  execute(
    `INSERT INTO subcategories (id, category_id, name, created_at) VALUES (?, ?, 'Sub revenu', ?)`,
    [incomeSubcategoryId, incomeCategoryId, now],
  );
  execute(
    `INSERT INTO months (id, user_id, ledger_id, year, month, created_at) VALUES (?, ?, ?, 2026, 9, ?)`,
    [monthId, userId, ledgerId, now],
  );

  return { userId, ledgerId, monthId, expenseSubcategoryId, incomeSubcategoryId };
}

/** Cree directement une allocation (épargne ou remboursement) a un montant de depart. */
export function seedAllocation(
  monthId: string,
  kind: "savings" | "debt",
  amountCents: number,
  label: string,
): string {
  const id = newId();
  execute(
    `INSERT INTO allocations (id, month_id, kind, amount_cents, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, monthId, kind, amountCents, label, nowIso()],
  );
  return id;
}
