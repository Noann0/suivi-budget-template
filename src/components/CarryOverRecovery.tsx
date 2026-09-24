"use client";

import { useCallback, useState } from "react";

import {
  CarryOverPicker,
  type CarryOverSelection,
  type CarryOverSubmitOutcome,
} from "@/components/CarryOverPicker";
import { cn } from "@/components/lib/cn";
import { useActionError } from "@/components/lib/useActionError";
import { carryOverPreviousMonth } from "@/actions/months";
import type { MonthView } from "@/lib/types";

type Props = {
  year: number;
  month: number;
  /** Nom du mois d'ou viennent les montants, du type "juillet". */
  previousMonthName: string;
  /**
   * Vrai tant que le mois vaut la peine d'etre repris : encore vide ou a peine
   * commence. Calcule par MonthBoard, qui seul connait l'etat des lignes.
   */
  eligible: boolean;
  onCarried: (view: MonthView) => void;
};

/**
 * Rattrapage : reprendre le mois precedent sur un mois deja ouvert.
 *
 * Le piege qu'on ferme ici. Le report n'etait propose qu'a la creation du mois. Un
 * clic sur « Commencer un mois vide » condamnait a retaper vingt-deux lignes a la
 * main, sans aucun recours : ni bouton, ni retour en arriere, rien. C'est une part
 * du « ca ne garde rien en memoire d'un mois sur l'autre » qu'elle a rapporte.
 *
 * L'action serveur n'ecrase jamais rien, elle ne fait qu'ajouter ce qui manque, et la
 * rejouer ne duplique rien. Le bouton est donc sans danger : c'est ce qui permet de
 * l'ecrire en clair, sans confirmation ni avertissement, la ou une operation
 * destructrice aurait exige les deux.
 *
 * Depuis le 2026-09-13, le bouton ouvre la liste des lignes reprenables plutot que de
 * tout reprendre d'un bloc. Les lignes deja remplies ici n'y figurent pas : elles ne
 * bougeraient pas de toute facon, les cocher ferait mentir le compteur.
 */
export function CarryOverRecovery({
  year,
  month,
  previousMonthName,
  eligible,
  onCarried,
}: Props) {
  const [picking, setPicking] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const resolveError = useActionError();

  const carryOverSelection = useCallback(
    async (selection: CarryOverSelection): Promise<CarryOverSubmitOutcome> => {
      const result = await carryOverPreviousMonth({ year, month, ...selection });
      if (!result.ok) return { ok: false, message: resolveError(result.error) };

      const { carriedEntries, carriedAllocations, view } = result.data;
      // Le compte rendu d'abord, la feuille ensuite : l'ecran derriere est deja remis
      // a jour par `onCarried` quand la feuille se retire.
      setOutcome(outcomeMessage(carriedEntries, carriedAllocations, previousMonthName));
      setPicking(false);
      onCarried(view);
      return { ok: true };
    },
    [year, month, previousMonthName, onCarried, resolveError],
  );

  /**
   * Le compte rendu survit a la disparition de l'offre. Reprendre le mois remplit les
   * lignes, donc le mois cesse aussitot d'etre eligible : sans cette sortie, la carte
   * disparaitrait a l'instant du clic et elle n'apprendrait jamais ce qui s'est passe.
   */
  if (outcome) {
    return (
      <p
        role="status"
        className="rounded-md border border-positive/30 bg-positive-soft px-4 py-3 text-base text-ink"
      >
        {outcome}
      </p>
    );
  }

  if (!eligible) return null;

  return (
    <div className="rounded-md border border-line bg-carried px-4 py-3">
      <p className="text-base text-ink">
        Vous pouvez repartir de vos montants de {previousMonthName}. Vous choisirez les
        lignes à garder, et ce que vous avez déjà saisi ici reste tel quel.
      </p>

      <button
        type="button"
        onClick={() => setPicking(true)}
        className={cn(
          "tap mt-3 rounded-sm bg-accent px-4 text-base font-semibold text-white",
          "transition-opacity duration-150 disabled:opacity-60",
        )}
      >
        Reprendre {previousMonthName}
      </button>

      {picking ? (
        <CarryOverPicker
          year={year}
          month={month}
          previousMonthName={previousMonthName}
          onClose={() => setPicking(false)}
          onSubmit={carryOverSelection}
        />
      ) : null}
    </div>
  );
}

/**
 * Le compte rendu, en francais et en deux comptes separes.
 *
 * « 22 lignes et 2 mises de côté reprises de juillet » se verifie d'un coup d'oeil sur
 * l'ecran. « 24 lignes reprises » ne se verifie nulle part : elle chercherait ou sont
 * passees les deux lignes manquantes.
 *
 * Le cas zero n'est pas une panne et ne s'ecrit pas comme telle : tout etait deja la,
 * c'est une bonne nouvelle.
 */
function outcomeMessage(entries: number, allocations: number, previous: string): string {
  const entryPart = entries === 1 ? "1 ligne" : `${entries} lignes`;
  const allocationPart = allocations === 1 ? "1 mise de côté" : `${allocations} mises de côté`;

  if (entries > 0 && allocations > 0) {
    return `${entryPart} et ${allocationPart} reprises de ${previous}.`;
  }
  if (entries > 0) {
    return `${entryPart} ${entries === 1 ? "reprise" : "reprises"} de ${previous}.`;
  }
  if (allocations > 0) {
    return `${allocationPart} ${allocations === 1 ? "reprise" : "reprises"} de ${previous}.`;
  }
  return `Tout ce qui vient de ${previous} était déjà là, il n'y avait rien à ajouter.`;
}
