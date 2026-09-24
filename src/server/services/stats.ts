import { MAX_YEAR, MIN_YEAR } from "@/lib/dates";
import { validation } from "@/lib/result";
import type { MonthTotals, YearPoint, YearSeries } from "@/lib/types";
import type { LedgerScope } from "@/server/repositories/ledgers";
import { listMonthRows, listYearExpenseByCategory } from "@/server/repositories/months";

import { buildMonthView } from "./months";

/**
 * Serie annuelle alimentant la courbe.
 *
 * Le champ `exists` n'est pas decoratif. Un mois jamais cree rend des zeros, exactement
 * comme un mois cree et rempli de zeros, et ce ne sont pas la meme chose. Sans ce
 * drapeau, l'interface afficherait "0 EUR de depenses" comme un constat rassurant
 * alors que la donnee est simplement absente. La courbe doit interrompre son trace.
 *
 * La serie porte aussi la repartition annuelle des depenses par categorie, qui alimente
 * le camembert de l'annee. Elle vit ici et non dans une seconde action : l'ecran fait
 * deja une lecture, lui en imposer deux le ferait attendre deux fois.
 */
export function getYearSeries(scope: LedgerScope, year: number): YearSeries {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw validation(`L'année doit être comprise entre ${MIN_YEAR} et ${MAX_YEAR}.`, "year");
  }

  // Serie d'un seul budget : melanger le foyer et le compte perso sur une meme
  // courbe additionnerait deux realites sans rapport.
  // Tous les mois du ledger sont charges une fois. La precedente implementation
  // recalculait l'historique a chaque tour via getOpeningBalance, soit un cout
  // quadratique et une relecture repetee des memes mois.
  const rows = listMonthRows(scope).sort(
    (left, right) => left.year - right.year || left.month - right.month,
  );
  const totalsByMonth = new Map<number, MonthTotals>();
  let openingBalanceCents = 0;
  let openingBalanceSource: { year: number; month: number } | null = null;

  for (const row of rows) {
    if (row.year > year) break;

    const totals = buildMonthView(scope.userId, row).totals;
    if (row.year < year) {
      openingBalanceCents += totals.unallocatedCents;
      openingBalanceSource = { year: row.year, month: row.month };
      continue;
    }
    totalsByMonth.set(row.month, totals);
  }

  const openingBalanceExpense =
    openingBalanceCents < 0 && openingBalanceSource
      ? {
          kind: "opening-balance-debt" as const,
          name: "Dette antérieure" as const,
          amountCents: Math.abs(openingBalanceCents),
          source: openingBalanceSource,
        }
      : null;
  const openingBalanceIncome =
    openingBalanceCents > 0 && openingBalanceSource
      ? {
          kind: "opening-balance-income" as const,
          name: "Revenu antérieur" as const,
          amountCents: openingBalanceCents,
          source: openingBalanceSource,
        }
      : null;

  const points: YearPoint[] = [];
  let cumulativeSavings = 0;
  let cumulativeDebt = 0;

  for (let month = 1; month <= 12; month += 1) {
    const totals = totalsByMonth.get(month);
    const openingBalance = openingBalanceCents;

    if (!totals) {
      points.push({
        month,
        exists: false,
        incomeCents: 0,
        expenseCents: 0,
        remainingCents: 0,
        openingBalanceCents: openingBalance,
        balanceCents: openingBalance,
        savingsCents: 0,
        debtCents: 0,
        // Le cumul ne progresse pas sur un mois inexistant, mais il ne retombe pas
        // a zero non plus : la courbe reprend a son niveau au mois suivant.
        cumulativeSavingsCents: cumulativeSavings,
        cumulativeDebtCents: cumulativeDebt,
      });
      continue;
    }

    cumulativeSavings += totals.savingsCents;
    cumulativeDebt += totals.debtCents;

    points.push({
      month,
      exists: true,
      incomeCents: totals.incomeCents,
      expenseCents: totals.expenseCents,
      remainingCents: totals.remainingCents,
      openingBalanceCents: openingBalance,
      balanceCents: openingBalance + totals.unallocatedCents,
      savingsCents: totals.savingsCents,
      debtCents: totals.debtCents,
      cumulativeSavingsCents: cumulativeSavings,
      cumulativeDebtCents: cumulativeDebt,
    });

    openingBalanceCents += totals.unallocatedCents;
  }

  const existing = points.filter((point) => point.exists);

  // Une agregation SQL, pas une relecture des douze vues de mois : la boucle ci-dessus
  // a deja reconstruit l'arbre categories/sous-categories douze fois, en repasser par
  // la pour un sous-total par categorie doublerait ce cout pour rien. Le perimetre est
  // le meme que celui des points, donc la somme des parts vaut exactement
  // `totals.expenseCents`.
  const expenseByCategory = listYearExpenseByCategory(scope, year);

  return {
    year,
    points,
    expenseByCategory,
    openingBalanceExpense,
    openingBalanceIncome,
    totals: {
      incomeCents: existing.reduce((sum, point) => sum + point.incomeCents, 0),
      expenseCents: existing.reduce((sum, point) => sum + point.expenseCents, 0),
      remainingCents: existing.reduce((sum, point) => sum + point.remainingCents, 0),
      savingsCents: existing.reduce((sum, point) => sum + point.savingsCents, 0),
      debtCents: existing.reduce((sum, point) => sum + point.debtCents, 0),
    },
  };
}
