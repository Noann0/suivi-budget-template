import assert from "node:assert/strict";
import { before, test } from "node:test";

import { execute } from "@/db/client";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { upsertEntry } from "@/server/repositories/months";
import { createEmptyMonth } from "@/server/services/months";
import { getYearSeries } from "@/server/services/stats";

import { useScratchDatabase } from "./helpers/scratch-db";

before(() => {
  useScratchDatabase("stats");
});

function seedLedger(slug: "joint" | "perso", sortOrder: number) {
  const now = nowIso();
  const userId = newId();
  const ledgerId = newId();
  const incomeCategoryId = newId();
  const expenseCategoryId = newId();
  const incomeSubcategoryId = newId();
  const expenseSubcategoryId = newId();
  execute("INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)", [userId, now]);
  execute(
    "INSERT INTO ledgers (id, user_id, slug, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [ledgerId, userId, slug, slug, sortOrder, now],
  );
  for (const [id, name, kind, hue] of [
    [incomeCategoryId, "Income", "income", 1],
    [expenseCategoryId, "Expense", "expense", 2],
  ] as const) {
    execute(
      "INSERT INTO categories (id, user_id, ledger_id, name, hue, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, userId, ledgerId, name, hue, kind, now],
    );
  }
  execute("INSERT INTO subcategories (id, category_id, name, created_at) VALUES (?, ?, 'Income', ?)", [incomeSubcategoryId, incomeCategoryId, now]);
  execute("INSERT INTO subcategories (id, category_id, name, created_at) VALUES (?, ?, 'Expense', ?)", [expenseSubcategoryId, expenseCategoryId, now]);
  return { userId, ledgerId, incomeSubcategoryId, expenseSubcategoryId };
}

function addMonth(
  ledger: ReturnType<typeof seedLedger>,
  month: number,
  incomeCents: number,
  expenseCents: number,
) {
  const view = createEmptyMonth({ userId: ledger.userId, ledgerId: ledger.ledgerId }, 2026, month);
  upsertEntry({ monthId: view.id, subcategoryId: ledger.incomeSubcategoryId, amountCents: incomeCents });
  upsertEntry({ monthId: view.id, subcategoryId: ledger.expenseSubcategoryId, amountCents: expenseCents });
  return view.id;
}

test("getYearSeries : le total annuel somme les flux, pas les soldes cumulatifs", () => {
  const joint = seedLedger("joint", 0);
  addMonth(joint, 1, 10000, 2000);
  addMonth(joint, 2, 5000, 1000);

  const series = getYearSeries({ userId: joint.userId, ledgerId: joint.ledgerId }, 2026);
  const january = series.points[0];
  const february = series.points[1];

  assert.ok(january);
  assert.ok(february);
  assert.equal(january.openingBalanceCents, 0);
  assert.equal(february.openingBalanceCents, 8000);
  assert.equal(february.balanceCents, 12000);
  assert.equal(series.totals.remainingCents, 12000);
});

test("getYearSeries : les soldes et totaux annuels restent isoles par budget", () => {
  const joint = seedLedger("joint", 0);
  const perso = seedLedger("perso", 1);
  addMonth(joint, 1, 10000, 2000);
  addMonth(perso, 1, 1000, 5000);
  addMonth(joint, 2, 0, 0);
  addMonth(perso, 2, 0, 0);

  const jointSeries = getYearSeries({ userId: joint.userId, ledgerId: joint.ledgerId }, 2026);
  const persoSeries = getYearSeries({ userId: perso.userId, ledgerId: perso.ledgerId }, 2026);
  const jointFebruary = jointSeries.points[1];
  const persoFebruary = persoSeries.points[1];

  assert.ok(jointFebruary);
  assert.ok(persoFebruary);
  assert.equal(jointFebruary.openingBalanceCents, 8000);
  assert.equal(persoFebruary.openingBalanceCents, -4000);
  assert.equal(jointSeries.totals.remainingCents, 8000);
  assert.equal(persoSeries.totals.remainingCents, -4000);
});

test("getYearSeries : porte la dette d'ouverture hors des depenses reelles", () => {
  const ledger = seedLedger("joint", 0);
  const scope = { userId: ledger.userId, ledgerId: ledger.ledgerId };
  const december = createEmptyMonth(scope, 2025, 12);
  upsertEntry({
    monthId: december.id,
    subcategoryId: ledger.expenseSubcategoryId,
    amountCents: 4000,
  });
  addMonth(ledger, 1, 0, 2000);

  const series = getYearSeries(scope, 2026);

  assert.equal(series.points[0]?.openingBalanceCents, -4000);
  assert.equal(series.totals.expenseCents, 2000);
  assert.equal(series.expenseByCategory[0]?.amountCents, 2000);
  assert.deepEqual(series.openingBalanceExpense, {
    kind: "opening-balance-debt",
    name: "Dette antérieure",
    amountCents: 4000,
    source: { year: 2025, month: 12 },
  });
  assert.equal(series.openingBalanceIncome, null);
});

test("getYearSeries : porte un revenu d'ouverture hors des flux annuels", () => {
  const ledger = seedLedger("joint", 0);
  const scope = { userId: ledger.userId, ledgerId: ledger.ledgerId };
  const december = createEmptyMonth(scope, 2025, 12);
  upsertEntry({
    monthId: december.id,
    subcategoryId: ledger.incomeSubcategoryId,
    amountCents: 5000,
  });
  addMonth(ledger, 1, 0, 2000);

  const series = getYearSeries(scope, 2026);

  assert.equal(series.points[0]?.openingBalanceCents, 5000);
  assert.equal(series.totals.expenseCents, 2000);
  assert.equal(series.totals.remainingCents, -2000);
  assert.deepEqual(series.openingBalanceIncome, {
    kind: "opening-balance-income",
    name: "Revenu antérieur",
    amountCents: 5000,
    source: { year: 2025, month: 12 },
  });
  assert.equal(series.openingBalanceExpense, null);
});

test("getYearSeries : ne porte aucun solde d'ouverture nul", () => {
  const ledger = seedLedger("joint", 0);
  const scope = { userId: ledger.userId, ledgerId: ledger.ledgerId };
  addMonth(ledger, 1, 1000, 1000);

  const series = getYearSeries(scope, 2026);

  assert.equal(series.points[0]?.openingBalanceCents, 0);
  assert.equal(series.openingBalanceIncome, null);
  assert.equal(series.openingBalanceExpense, null);
});
