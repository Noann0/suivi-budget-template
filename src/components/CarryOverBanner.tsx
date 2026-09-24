"use client";

import { cn } from "@/components/lib/cn";

type Props = {
  /** Nom du mois d'origine, du type "juillet". */
  previousMonthName: string;
  carriedCount: number;
  pending: boolean;
  onConfirmAll: () => void;
};

/**
 * Bandeau du geste central : le mois arrive pre-rempli avec les montants du mois
 * precedent, elle n'ajuste que ce qui a bouge.
 *
 * Le ton compte autant que la fonction. Ce n'est pas une liste d'erreurs a corriger,
 * c'est une avance qu'on lui a faite. D'ou le fond sable et non un fond d'alerte,
 * et une phrase qui dit ce qui a ete fait avant de demander quoi que ce soit.
 *
 * La seconde phrase repare une ambiguite qu'elle a signalee : elle croyait
 * SELECTIONNER des lignes avec les boutons de droite, et cherchait ensuite ou valider
 * sa selection. Ces boutons enregistrent chacun sur-le-champ. On le dit, plutot que de
 * la laisser le deduire.
 */
export function CarryOverBanner({
  previousMonthName,
  carriedCount,
  pending,
  onConfirmAll,
}: Props) {
  if (carriedCount === 0) return null;

  return (
    <div className="rounded-md border border-line bg-carried px-4 py-3">
      <p className="text-base text-ink">
        Pré-rempli avec vos montants de {previousMonthName}. Gardez ou modifiez chaque ligne.
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        Le bouton « Garder » à droite d&apos;une ligne l&apos;enregistre aussitôt : il
        n&apos;y a rien à valider ensuite. Celui ci-dessous fait la même chose pour
        toutes les lignes d&apos;un coup.
      </p>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={onConfirmAll}
          disabled={pending}
          className={cn(
            "tap rounded-sm bg-accent px-4 text-base font-semibold text-white",
            "transition-opacity duration-150 disabled:opacity-60",
          )}
        >
          {pending ? "Un instant..." : "Tout garder"}
        </button>
        <span className="text-base text-ink-soft">
          {carriedCount === 1 ? "1 ligne concernée" : `${carriedCount} lignes concernées`}
        </span>
      </div>
    </div>
  );
}
