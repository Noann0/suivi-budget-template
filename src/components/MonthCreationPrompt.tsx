"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import {
  CarryOverPicker,
  type CarryOverSelection,
  type CarryOverSubmitOutcome,
} from "@/components/CarryOverPicker";
import { cn } from "@/components/lib/cn";
import { useActionError } from "@/components/lib/useActionError";
import { monthLabel, monthName } from "@/components/lib/format";
import { createMonth, createMonthFromPrevious } from "@/actions/months";

type Props = {
  year: number;
  month: number;
  previousYear: number;
  previousMonth: number;
  /** Faux quand le mois precedent n'existe pas : le report n'a alors rien a copier. */
  canCarryOver: boolean;
};

/**
 * Ecran d'un mois qui n'existe pas encore.
 *
 * Le chemin propose en premier est le report. C'est le geste qui decide si elle
 * utilise encore l'application dans six mois : retaper trente lignes chaque mois,
 * elle abandonne au deuxieme.
 *
 * Le report n'est plus binaire. Il ouvre la liste des lignes reprenables, tout coche,
 * et elle decoche ce qu'elle ne veut pas. Valider sans rien toucher rend exactement le
 * comportement d'avant : « tout reprendre » reste le chemin le plus court.
 */
export function MonthCreationPrompt({
  year,
  month,
  previousYear,
  previousMonth: previous,
  canCarryOver,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const resolveError = useActionError();

  const createEmpty = useCallback(() => {
    setError(null);
    setPicking(false);
    startTransition(async () => {
      const result = await createMonth({ year, month });
      if (!result.ok) {
        setError(resolveError(result.error));
        return;
      }
      router.refresh();
    });
  }, [year, month, router, resolveError]);

  /**
   * Cree le mois avec les seules lignes cochees.
   *
   * Le succes ne ferme pas la feuille et ne rend pas la main : le mois existe
   * desormais, tout l'ecran va etre remplace par le rafraichissement. Fermer d'abord
   * exposerait, une seconde, un ecran qui affirme « ce mois n'est pas encore commencé »
   * alors qu'il vient d'etre cree. C'est la fenetre decrite au post-mortem du
   * 2026-09-02, et elle se ferme en gardant le controle verrouille.
   */
  const carryOverSelection = useCallback(
    async (selection: CarryOverSelection): Promise<CarryOverSubmitOutcome> => {
      setError(null);
      const result = await createMonthFromPrevious({ year, month, ...selection });
      if (!result.ok) return { ok: false, message: resolveError(result.error) };
      startTransition(() => {
        router.refresh();
      });
      return { ok: true };
    },
    [year, month, router, resolveError],
  );

  return (
    <div className="card px-4 py-5">
      <h2 className="font-display text-xl font-bold text-ink">
        {monthLabel(year, month)} n&apos;est pas encore commencé
      </h2>
      <p className="mt-2 text-base text-ink-soft">
        {canCarryOver
          ? `On peut repartir de vos montants de ${monthName(previous)}. Vous choisirez les lignes à garder, et vous n'aurez qu'à ajuster ce qui a changé.`
          : `Il n'y a pas encore de mois de ${monthName(previous)} ${previousYear} à recopier. On part d'une page vierge.`}
      </p>

      {error ? (
        <p role="alert" className="mt-3 rounded-sm border border-negative/40 bg-negative-soft px-3 py-2 text-base text-ink">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        {canCarryOver ? (
          <button
            type="button"
            onClick={() => setPicking(true)}
            disabled={pending}
            className={cn(
              "tap rounded-sm bg-accent px-5 text-base font-semibold text-white",
              "transition-opacity duration-150 disabled:opacity-60",
            )}
          >
            {pending ? "Un instant..." : `Reprendre ${monthName(previous)}`}
          </button>
        ) : null}
        <button
          type="button"
          onClick={createEmpty}
          disabled={pending}
          className="tap rounded-sm border border-line px-5 text-base font-medium text-ink disabled:opacity-60"
        >
          Commencer un mois vide
        </button>
      </div>

      {/* Montee a la demande : la liste se lit a l'ouverture, jamais au chargement de
          l'ecran, et elle reflete donc l'etat du mois precedent a cet instant-la. */}
      {picking ? (
        <CarryOverPicker
          year={year}
          month={month}
          previousMonthName={monthName(previous)}
          onClose={() => setPicking(false)}
          onSubmit={carryOverSelection}
          emptyExit={{ label: "Commencer un mois vide", onClick: createEmpty }}
        />
      ) : null}
    </div>
  );
}
