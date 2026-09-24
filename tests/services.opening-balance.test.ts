import assert from "node:assert/strict";
import { before, test } from "node:test";

import { execute } from "@/db/client";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { createEmptyMonth, getOpeningBalance } from "@/server/services/months";
import { insertAllocation, upsertEntry } from "@/server/repositories/months";

import { useScratchDatabase } from "./helpers/scratch-db";

before(() => {
  useScratchDatabase("opening-balance");
});

type Budget = {
  userId: string;
  joint: { ledgerId: string; incomeSubcategoryId: string; expenseSubcategoryId: string };
  perso: { ledgerId: string; incomeSubcategoryId: string; expenseSubcategoryId: string };
};

function createBudget(): Budget {
  const userId = newId();
  const now = nowIso();
  execute("INSERT INTO users (id, created_at) VALUES (?, ?)", [userId, now]);

  const makeLedger = (slug: "joint" | "perso", sortOrder: number) => {
    const ledgerId = newId();
    const incomeCategoryId = newId();
    const expenseCategoryId = newId();
    const incomeSubcategoryId = newId();
    const expenseSubcategoryId = newId();
    execute(
      `INSERT INTO ledgers (id, user_id, slug, name, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ledgerId, userId, slug, slug, sortOrder, now],
    );
    execute(
      `INSERT INTO categories (id, user_id, ledger_id, name, hue, kind, created_at)
       VALUES (?, ?, ?, 'Income', 1, 'income', ?)`,
      [incomeCategoryId, userId, ledgerId, now],
    );
    execute(
      `INSERT INTO categories (id, user_id, ledger_id, name, hue, kind, created_at)
       VALUES (?, ?, ?, 'Expense', 2, 'expense', ?)`,
      [expenseCategoryId, userId, ledgerId, now],
    );
    execute("INSERT INTO subcategories (id, category_id, name, created_at) VALUES (?, ?, 'Income', ?)", [
      incomeSubcategoryId,
      incomeCategoryId,
      now,
    ]);
    execute("INSERT INTO subcategories (id, category_id, name, created_at) VALUES (?, ?, 'Expense', ?)", [
      expenseSubcategoryId,
      expenseCategoryId,
      now,
    ]);
    return { ledgerId, incomeSubcategoryId, expenseSubcategoryId };
  };

  return { userId, joint: makeLedger("joint", 0), perso: makeLedger("perso", 1) };
}

function addMonth(
  budget: Budget,
  ledger: Budget["joint"],
  year: number,
  month: number,
  incomeCents: number,
  expenseCents: number,
): string {
  const scope = { userId: budget.userId, ledgerId: ledger.ledgerId };
  const view = createEmptyMonth(scope, year, month);
  upsertEntry({ monthId: view.id, subcategoryId: ledger.incomeSubcategoryId, amountCents: incomeCents });
  upsertEntry({ monthId: view.id, subcategoryId: ledger.expenseSubcategoryId, amountCents: expenseCents });
  return view.id;
}

test("getOpeningBalance : le premier mois n'a aucun solde d'ouverture", () => {
  const budget = createBudget();
  addMonth(budget, budget.joint, 2026, 1, 10000, 2000);

  assert.deepEqual(getOpeningBalance({ userId: budget.userId, ledgerId: budget.joint.ledgerId }, 2026, 1), {
    cents: 0,
    source: null,
  });
});

test("getOpeningBalance : cumule les mois positifs et negatifs precedents", () => {
  const budget = createBudget();
  addMonth(budget, budget.joint, 2026, 1, 10000, 2000);
  addMonth(budget, budget.joint, 2026, 2, 1000, 4000);
  addMonth(budget, budget.joint, 2026, 3, 0, 0);

  assert.deepEqual(getOpeningBalance({ userId: budget.userId, ledgerId: budget.joint.ledgerId }, 2026, 3), {
    cents: 5000,
    source: { year: 2026, month: 2 },
  });
});

test("getOpeningBalance : integre epargne et remboursement dans le montant source", () => {
  const budget = createBudget();
  const monthId = addMonth(budget, budget.joint, 2026, 1, 10000, 2000);
  insertAllocation({ monthId, kind: "savings", amountCents: 3000, label: "Savings" });
  insertAllocation({ monthId, kind: "debt", amountCents: 1500, label: "Debt" });
  addMonth(budget, budget.joint, 2026, 2, 0, 0);

  assert.equal(
    getOpeningBalance({ userId: budget.userId, ledgerId: budget.joint.ledgerId }, 2026, 2).cents,
    3500,
  );
});

test("getOpeningBalance : une correction ancienne recalcule toute la cascade a la relecture", () => {
  const budget = createBudget();
  const januaryId = addMonth(budget, budget.joint, 2026, 1, 10000, 2000);
  addMonth(budget, budget.joint, 2026, 2, 5000, 1000);
  addMonth(budget, budget.joint, 2026, 3, 0, 0);
  const scope = { userId: budget.userId, ledgerId: budget.joint.ledgerId };

  assert.equal(getOpeningBalance(scope, 2026, 3).cents, 12000);
  upsertEntry({ monthId: januaryId, subcategoryId: budget.joint.expenseSubcategoryId, amountCents: 5000 });
  assert.equal(getOpeningBalance(scope, 2026, 3).cents, 9000);
});

test("getOpeningBalance : traverse decembre vers janvier sans melanger les budgets", () => {
  const budget = createBudget();
  addMonth(budget, budget.joint, 2026, 12, 10000, 2000);
  addMonth(budget, budget.perso, 2026, 12, 1000, 6000);
  addMonth(budget, budget.joint, 2027, 1, 0, 0);
  addMonth(budget, budget.perso, 2027, 1, 0, 0);

  assert.equal(
    getOpeningBalance({ userId: budget.userId, ledgerId: budget.joint.ledgerId }, 2027, 1).cents,
    8000,
  );
  assert.equal(
    getOpeningBalance({ userId: budget.userId, ledgerId: budget.perso.ledgerId }, 2027, 1).cents,
    -5000,
  );
});
