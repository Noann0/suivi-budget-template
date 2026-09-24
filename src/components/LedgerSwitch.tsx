"use client";

import { User, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useActionError } from "@/components/lib/useActionError";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { setActiveLedger } from "@/actions/preferences";
import type { Ledger, LedgerSlug } from "@/lib/types";

type Props = {
  /** Budgets de l'utilisatrice, deja ordonnes par le serveur : Joint puis Perso. */
  ledgers: readonly Ledger[];
  active: LedgerSlug;
};

/**
 * Bascule entre ses deux budgets, « Joint » pour le foyer et « Perso » pour son compte.
 *
 * POSE DANS LA COQUILLE, DONC VISIBLE SUR LES TROIS ECRANS, y compris les Reglages :
 * les categories appartiennent au budget ouvert. Sans ce reperage sur l'ecran des
 * categories, basculer donnerait l'impression d'avoir perdu ses categories.
 *
 * LE RISQUE A TRAITER N'EST PAS LA BASCULE, C'EST LA SAISIE A L'AVEUGLE : taper
 * un salaire dans le budget du foyer en se croyant sur son compte a elle. Un
 * chiffre range au mauvais endroit ne se voit pas, il fausse les deux budgets a la
 * fois et se retrouve des semaines plus tard. Trois garde-fous, aucun ne reposant sur
 * la couleur :
 * - le nom du budget ouvert est ECRIT en haut de chaque ecran, en permanence, en gras
 *   sur une pastille surelevee, l'autre reste en gris ;
 * - le mot « Budget » a gauche dit de quoi il s'agit, un interrupteur non nomme se
 *   confond avec un filtre ;
 * - une icone par budget, une silhouette pour le sien, deux pour le foyer : la forme
 *   se reconnait avant meme la lecture.
 *
 * Pendant la bascule, l'interrupteur est verrouille et grise. C'est la fenetre
 * dangereuse : l'ecran porte encore les chiffres de l'ancien budget alors que le
 * nouveau est deja selectionne. On ne la laisse pas cliquable.
 */
export function LedgerSwitch({ ledgers, active }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const resolveError = useActionError();

  // Etat local plutot qu'un optimiste, meme raison que IntensityToggle : la valeur
  // serveur n'arrive qu'avec le rafraichissement, un optimiste ferait reculer
  // l'interrupteur sous son doigt en fin de transition.
  const [shown, setShown] = useState<LedgerSlug>(active);

  // Un seul budget : rien a choisir, et un interrupteur a une position n'est pas un
  // choix, c'est un decor qui prend la place du contenu.
  if (ledgers.length < 2) return null;

  const options: SegmentedOption<LedgerSlug>[] = ledgers.map((ledger) => ({
    value: ledger.slug,
    label: (
      <span className="flex items-center justify-center gap-2">
        {ledger.slug === "joint" ? (
          <Users size={16} aria-hidden="true" className="shrink-0" />
        ) : (
          <User size={16} aria-hidden="true" className="shrink-0" />
        )}
        {ledger.name}
      </span>
    ),
  }));

  const change = (next: LedgerSlug) => {
    if (next === shown) return;
    setError(null);
    setShown(next);
    startTransition(async () => {
      const result = await setActiveLedger({ slug: next });
      if (!result.ok) {
        setError(resolveError(result.error));
        setShown(active);
        return;
      }
      // Le serveur revalide bien le layout, mais sans navigation le client garde son
      // rendu : c'est le rafraichissement qui va chercher les ecrans du nouveau
      // budget. Meme geste que MonthCreationPrompt.
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* Redondant pour le lecteur d'ecran, qui entend deja la legende du groupe. */}
        <span aria-hidden="true" className="shrink-0 text-base text-ink-soft">
          Budget
        </span>
        <SegmentedControl
          label="Budget affiché sur tous les écrans"
          options={options}
          value={shown}
          disabled={pending}
          onChange={change}
          className="min-w-0 flex-1 transition-opacity duration-150 disabled:opacity-60 sm:max-w-[360px]"
        />
      </div>

      <p role="status" className="sr-only">
        {pending
          ? "Changement de budget en cours."
          : `Budget ouvert : ${ledgers.find((ledger) => ledger.slug === shown)?.name ?? ""}.`}
      </p>

      {error ? (
        <p role="alert" className="rounded-sm border border-negative/40 bg-negative-soft px-3 py-2 text-base text-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
