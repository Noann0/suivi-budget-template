"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/components/lib/cn";
import { formatCents, monthLabel } from "@/components/lib/format";
import { useActionError } from "@/components/lib/useActionError";
import { deleteMonth } from "@/actions/months";
import type { MonthTotals } from "@/lib/types";

type Props = {
  year: number;
  month: number;
  totals: MonthTotals;
  /** Nombre de lignes reellement saisies, revenus et depenses confondus. */
  filledLines: number;
  allocationCount: number;
};

/**
 * Suppression d'un mois.
 *
 * Le besoin est concret : l'administrateur saisira des montants fictifs pour lui montrer
 * l'outil, et ces chiffres n'ont rien a faire dans son budget ensuite.
 *
 * C'est une action destructrice sur des donnees financieres, avec cascade sur les
 * entrees et les allocations. Elle se merite donc en deux gestes, et le second
 * annonce le decompte exact de ce qui part. Un ecran qui dit seulement "etes-vous
 * sur" ne dit rien : il faut nommer ce qu'on perd.
 */
export function DeleteMonthCard({ year, month, totals, filledLines, allocationCount }: Props) {
  const router = useRouter();
  const resolveError = useActionError();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = () => {
    setError(null);
    startTransition(async () => {
      const result = await deleteMonth({ year, month });
      if (!result.ok) {
        setError(resolveError(result.error));
        return;
      }
      router.replace("/");
      router.refresh();
    });
  };

  if (!confirming) {
    return (
      <div className="px-1 pb-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="tap flex items-center gap-2 rounded-sm text-base font-medium text-negative"
        >
          <Trash2 size={18} aria-hidden="true" />
          Effacer tout le mois de {monthLabel(year, month).toLowerCase()}
        </button>
        <p className="mt-1 text-sm text-ink-soft">
          Utile si vous avez fait des essais et que vous voulez repartir de zéro.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-negative/40 bg-negative-soft px-4 py-4">
      <h2 className="font-display text-lg font-bold text-ink">
        Effacer {monthLabel(year, month)} ?
      </h2>

      <p className="mt-2 text-base text-ink">Voici ce qui sera perdu, définitivement :</p>

      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-base text-ink">
        <li>
          {filledLines === 0
            ? "aucun montant saisi"
            : filledLines === 1
              ? "1 montant saisi"
              : `${filledLines} montants saisis`}
        </li>
        <li>
          revenus :{" "}
          <span className="amount tabular-nums">{formatCents(totals.incomeCents)}</span>, dépenses :{" "}
          <span className="amount tabular-nums">{formatCents(totals.expenseCents)}</span>
        </li>
        <li>
          {allocationCount === 0
            ? "aucune épargne ni remboursement"
            : allocationCount === 1
              ? "1 ligne d'épargne ou de remboursement"
              : `${allocationCount} lignes d'épargne ou de remboursement`}
        </li>
      </ul>

      <p className="mt-3 text-base text-ink-soft">
        Vos autres mois ne bougent pas, et vos catégories non plus. Seul ce mois-ci
        disparaît, et il ne pourra pas être récupéré.
      </p>

      {error ? (
        <p role="alert" className="mt-3 rounded-sm border border-negative/40 bg-surface px-3 py-2 text-base text-ink">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className={cn(
            "tap rounded-sm bg-negative px-5 text-base font-semibold text-white",
            "transition-opacity duration-150 disabled:opacity-60",
          )}
        >
          {pending ? "Suppression..." : "Oui, effacer ce mois"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={pending}
          className="tap rounded-sm border border-line bg-surface px-5 text-base font-medium text-ink"
        >
          Annuler, je garde ce mois
        </button>
      </div>
    </div>
  );
}
