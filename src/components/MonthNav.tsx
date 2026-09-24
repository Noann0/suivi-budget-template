import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { monthLabel } from "@/components/lib/format";
import { nextMonth, previousMonth } from "@/lib/dates";

type Props = {
  year: number;
  month: number;
};

/**
 * En-tete de l'ecran du mois : deux chevrons de 44px et le mois en toutes lettres.
 * Pas de barre de navigation lourde, le fond reste le creme general.
 */
export function MonthNav({ year, month }: Props) {
  const before = previousMonth(year, month);
  const after = nextMonth(year, month);

  return (
    <header className="flex items-center justify-between gap-2 py-2">
      <Link
        href={`/mois/${before.year}/${before.month}`}
        className="tap flex items-center justify-center rounded-sm text-ink-soft"
      >
        <ChevronLeft size={24} aria-hidden="true" />
        <span className="sr-only">Mois précédent, {monthLabel(before.year, before.month)}</span>
      </Link>

      <h1 className="font-display text-xl font-bold text-ink">{monthLabel(year, month)}</h1>

      <Link
        href={`/mois/${after.year}/${after.month}`}
        className="tap flex items-center justify-center rounded-sm text-ink-soft"
      >
        <ChevronRight size={24} aria-hidden="true" />
        <span className="sr-only">Mois suivant, {monthLabel(after.year, after.month)}</span>
      </Link>
    </header>
  );
}
