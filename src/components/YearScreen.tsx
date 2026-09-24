import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { YearCharts } from "@/components/YearCharts";
import { formatCents, monthLabel, monthName } from "@/components/lib/format";
import { SESSION_EXPIRED_PATH, isUnauthorized, screenErrorMessage } from "@/components/lib/screenErrors";
import { getYearSeries } from "@/actions/stats";
import { getPreferences } from "@/actions/preferences";

type Props = {
  year: number;
};

/**
 * Ecran 2 : l'annee, en deux registres separes par le titre « Où est passé
 * l'argent » (arbitrage du 2026-09-02, design/PLAN-ANNEE-GRAPHES.md).
 *
 * Au-dessus de ce titre, le verdict : cartes chiffres, reste par mois, epargne
 * cumulee. Vert et rouge, aucune teinte de categorie, aucune pastille. En
 * dessous, l'analyse : camembert des depenses et batons revenus/depenses, qui
 * portent les teintes. Ce n'est pas l'ecran qui doit rester monochrome, c'est le
 * verdict ; un camembert place apres lui ne le contamine pas, il l'explique.
 *
 * Un mois vide y est une porte, pas un trou. Remplir un mois passe etait deja
 * possible par les chevrons de l'ecran du mois, mais rien ne le disait ici :
 * elle voyait douze mois dont dix vides et aucun chemin. Les listes de mois
 * ci-dessous sont ce chemin, avec des cibles de 44px, la ou les colonnes du
 * graphe n'en font que 27 de large.
 */
export async function YearScreen({ year }: Props) {
  const [result, preferences] = await Promise.all([getYearSeries({ year }), getPreferences()]);

  if (!result.ok) {
    if (isUnauthorized(result.error)) redirect(SESSION_EXPIRED_PATH);

    return (
      <p role="alert" className="card px-4 py-4 text-base text-ink">
        {screenErrorMessage(result.error)}
      </p>
    );
  }

  const series = result.data;
  const filledMonths = series.points.filter((point) => point.exists);
  const redMonths = filledMonths.filter((point) => point.remainingCents < 0).length;
  const openingBalanceStart = preferences.ok ? preferences.data.openingBalanceStart : null;
  // Le contrat annuel contient deja les deux analyses. L'ecran ne les derive ni
  // ne les additionne : cette garde ne decide que si elles peuvent etre lues.
  const openingBalanceProps = annualOpeningBalanceProps(
    openingBalanceStart,
    year,
    series.openingBalanceExpense,
    series.openingBalanceIncome,
  );

  // Le calendrier est resolu ici, sur le serveur, et descendu en prop : un
  // `new Date()` dans le composant client des graphes ferait diverger le rendu
  // serveur du rendu client. Un mois a venir n'est pas propose au remplissage,
  // c'est le seul cas ou le vide est normal.
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const fillableThroughMonth = year < currentYear ? 12 : year > currentYear ? 0 : currentMonth;

  const missingMonths = series.points
    .filter((point) => !point.exists && point.month <= fillableThroughMonth)
    .map((point) => point.month);

  // Le mois mis en avant quand rien n'existe : celui qu'elle vit si l'annee est
  // en cours, sinon le premier de l'annee. On ne la fait pas commencer par un
  // mois au hasard.
  const suggestedMonth =
    year === currentYear ? currentMonth : (missingMonths[0] ?? null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-2 py-2">
        <Link
          href={`/annee/${year - 1}`}
          className="tap flex items-center rounded-sm px-1 text-base font-medium text-accent-ink"
        >
          {year - 1}
        </Link>
        <h1 className="font-display text-2xl font-bold text-ink">{year}</h1>
        <Link
          href={`/annee/${year + 1}`}
          className="tap flex items-center rounded-sm px-1 text-base font-medium text-accent-ink"
        >
          {year + 1}
        </Link>
      </header>

      {filledMonths.length === 0 ? (
        /* Aucun mois rempli : ni camembert ni batons, il n'y a rien a analyser.
           Un graphe vide ne serait pas une information, seulement un decor. */
        <EmptyYearCard
          year={year}
          months={missingMonths}
          suggestedMonth={suggestedMonth}
          currentYear={currentYear}
        />
      ) : (
        <YearCharts
          year={year}
          points={series.points}
          fillableThroughMonth={fillableThroughMonth}
          expenseSlices={series.expenseByCategory}
          expenseTotalCents={series.totals.expenseCents}
          {...openingBalanceProps}
          scopeLabel={scopeLabel(filledMonths.map((point) => point.month))}
          statsCards={
            <div className="grid grid-cols-3 gap-3 lg:gap-5">
              <StatCard label="Épargné" value={formatCents(series.totals.savingsCents)} />
              <StatCard label="Remboursé" value={formatCents(series.totals.debtCents)} />
              <StatCard
                label="Mois dans le rouge"
                value={String(redMonths)}
                tone={redMonths > 0 ? "negative" : "neutral"}
                suffix={`sur ${filledMonths.length} rempli${filledMonths.length > 1 ? "s" : ""}`}
              />
            </div>
          }
          completionCard={
            missingMonths.length > 0 ? (
              <section className="card px-4 py-4">
                <h2 className="font-display text-lg font-bold text-ink">Compléter {year}</h2>
                <p className="mt-1 text-base text-ink-soft">
                  {missingMonths.length === 1
                    ? "Ce mois n'est pas encore rempli. Vous pouvez le faire quand vous voulez, il rejoindra les graphiques."
                    : "Ces mois ne sont pas encore remplis. Vous pouvez les faire quand vous voulez, dans l'ordre qui vous arrange."}
                </p>
                <MonthLinkGrid year={year} months={missingMonths} />
              </section>
            ) : null
          }
        />
      )}
    </div>
  );
}

/** Les props analytiques restent masquees jusqu'a l'annee qui suit le point de depart. */
export function annualOpeningBalanceProps<TDebt, TIncome>(
  start: { year: number; month: number } | null,
  year: number,
  openingBalanceDebt: TDebt,
  openingBalanceIncome: TIncome,
) {
  const shouldShow = start !== null && year > start.year;

  return {
    openingBalanceDebt: shouldShow ? openingBalanceDebt : null,
    openingBalanceIncome: shouldShow ? openingBalanceIncome : null,
    openingBalanceStart: start,
  };
}

/**
 * Perimetre du bloc analyse, en une phrase.
 *
 * Elle doit pouvoir lire le camembert sans se demander sur quoi il porte : un
 * camembert d'un seul mois rempli est exact, mais il ne dit pas l'annee. Au-dela
 * de six mois la liste nominative cesse d'aider et on donne la proportion.
 */
function scopeLabel(months: readonly number[]): string {
  if (months.length >= 12) return "Sur les 12 mois.";
  if (months.length <= 6) {
    const names = months.map((month) => monthName(month)).join(", ");
    return `Sur ${months.length} mois rempli${months.length > 1 ? "s" : ""} : ${names}.`;
  }
  return `Sur ${months.length} des 12 mois de l'année.`;
}

/**
 * Annee sans aucun mois. C'etait un cul-de-sac : un constat, et rien a faire.
 * C'est desormais l'ecran de depart, avec un mois mis en avant et les autres
 * juste dessous.
 */
function EmptyYearCard({
  year,
  months,
  suggestedMonth,
  currentYear,
}: {
  year: number;
  months: readonly number[];
  suggestedMonth: number | null;
  currentYear: number;
}) {
  if (suggestedMonth === null || months.length === 0) {
    return (
      <section className="card px-4 py-5">
        <p className="text-base text-ink-soft">
          {year} n&apos;a pas encore commencé. Les graphiques apparaîtront dès le premier
          mois rempli.
        </p>
        <Link
          href={`/annee/${currentYear}`}
          className="tap mt-2 inline-flex items-center text-base font-medium text-accent-ink underline underline-offset-4"
        >
          Revenir à {currentYear}
        </Link>
      </section>
    );
  }

  const others = months.filter((month) => month !== suggestedMonth);

  return (
    <section className="card px-4 py-5">
      <h2 className="font-display text-xl font-bold text-ink">
        Aucun mois rempli en {year}, pour l&apos;instant
      </h2>
      <p className="mt-2 text-base text-ink-soft">
        Les graphiques apparaîtront dès le premier mois. Vous pouvez remplir n&apos;importe
        lequel, même un mois déjà passé, dans l&apos;ordre qui vous arrange.
      </p>

      <Link
        href={`/mois/${year}/${suggestedMonth}`}
        className="tap mt-4 inline-flex items-center justify-center rounded-sm bg-accent px-5 text-base font-semibold text-white"
      >
        Commencer par {monthName(suggestedMonth)}
      </Link>

      {others.length > 0 ? (
        <>
          <p className="mt-5 text-sm text-ink-soft">Ou un autre mois de {year} :</p>
          <MonthLinkGrid year={year} months={others} />
        </>
      ) : null}
    </section>
  );
}

/**
 * Grille de mois a ouvrir. Chaque lien tient les 44px du plan, ce que les 27px
 * d'une colonne de graphe ne permettent pas : le graphe montre ou sont les
 * trous, cette grille donne la prise.
 */
function MonthLinkGrid({ year, months }: { year: number; months: readonly number[] }) {
  return (
    <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {months.map((month) => (
        <li key={month}>
          <Link
            href={`/mois/${year}/${month}`}
            aria-label={`Remplir ${monthLabel(year, month)}`}
            className="tap flex w-full items-center justify-center gap-1 rounded-sm border border-line bg-carried px-2 text-base font-medium text-accent-ink capitalize"
          >
            <Plus size={16} aria-hidden="true" />
            {monthName(month)}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
  prefix,
  suffix,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
  prefix?: string;
  suffix?: string;
}) {
  const color =
    tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-ink";

  return (
    <div className="card flex flex-col gap-1 px-3 py-3">
      <span className="text-sm text-ink-soft">{label}</span>
      {prefix ? <span className="text-xs text-ink-soft">{prefix}</span> : null}
      <span className={`amount text-xl font-semibold tabular-nums ${color}`}>{value}</span>
      {suffix ? <span className="text-xs text-ink-soft">{suffix}</span> : null}
    </div>
  );
}
