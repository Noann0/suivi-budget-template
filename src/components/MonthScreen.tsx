import { redirect } from "next/navigation";

import { MonthBoard } from "@/components/MonthBoard";
import { MonthCreationPrompt } from "@/components/MonthCreationPrompt";
import { MonthNav } from "@/components/MonthNav";
import { monthName } from "@/components/lib/format";
import { getMonth } from "@/actions/months";
import { getPreferences } from "@/actions/preferences";
import { getYearSeries } from "@/actions/stats";
import { SESSION_EXPIRED_PATH, isUnauthorized, screenErrorMessage } from "@/components/lib/screenErrors";
import { previousMonth } from "@/lib/dates";

type Props = {
  year: number;
  month: number;
};

/**
 * Ecran 1 : le mois. Server Component, il ne fait que chercher la donnee et
 * deleguer l'interaction. Toute la mise en forme d'un montant reste cote client
 * dans `MonthBoard`, mais aucun total n'y est recalcule.
 */
export async function MonthScreen({ year, month }: Props) {
  const before = previousMonth(year, month);

  // Lectures independantes : elles partent ensemble, jamais en cascade. La serie
  // annuelle porte le solde d'ouverture calcule par le serveur. Le composant ne
  // l'additionne jamais a partir des lignes du mois.
  const [current, previous, preferences, yearSeries] = await Promise.all([
    getMonth({ year, month }),
    getMonth({ year: before.year, month: before.month }),
    getPreferences(),
    getYearSeries({ year }),
  ]);

  if (!current.ok) {
    // Une session absente de la base (expiree, purgee, ou appareil revoque par
    // l'administrateur) ramene a la connexion. L'afficher comme un message laisserait un ecran
    // mort : les trois onglets rendraient la meme erreur, sans aucune sortie.
    if (isUnauthorized(current.error)) redirect(SESSION_EXPIRED_PATH);

    return (
      <>
        <MonthNav year={year} month={month} />
        <p role="alert" className="card px-4 py-4 text-base text-ink">
          {screenErrorMessage(current.error)}
        </p>
      </>
    );
  }

  if (current.data === null) {
    return (
      <>
        <MonthNav year={year} month={month} />
        <MonthCreationPrompt
          year={year}
          month={month}
          previousYear={before.year}
          previousMonth={before.month}
          canCarryOver={previous.ok && previous.data !== null}
        />
      </>
    );
  }

  return (
    <>
      <MonthNav year={year} month={month} />
      {/* key=month.id (QA fast-fix) : sans elle, MonthBoard garde son etat local
          (totals, lines) d'un budget a l'autre. Bascule Joint -> Perso sur le meme
          /mois/annee/mois : l'ancien total restait affiche, fuite confirmee par
          reproduction. Deux mois, meme annee/mois, budgets differents, ont toujours
          des id distincts : la cle force le remount et repart des props fraiches. */}
      <MonthBoard
        key={current.data.id}
        month={current.data}
        previousMonthName={monthName(before.month)}
        canCarryOver={previous.ok && previous.data !== null}
        openingBalanceCents={
          preferences.ok &&
          yearSeries.ok &&
          shouldShowOpeningBalance(preferences.data.openingBalanceStart, year, month)
            ? (yearSeries.data.points[month - 1]?.openingBalanceCents ?? null)
            : null
        }
      />
    </>
  );
}

/** Le reglage ouvre l'affichage a partir d'un mois precis, calcul deja fait par le serveur. */
function shouldShowOpeningBalance(
  start: { year: number; month: number } | null,
  year: number,
  month: number,
): boolean {
  if (start === null) return false;
  return year > start.year || (year === start.year && month >= start.month);
}
