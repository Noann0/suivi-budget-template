"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/components/lib/cn";
import { formatCents } from "@/components/lib/format";
import { useCountUp } from "@/components/lib/useCountUp";
import type { MonthTotals } from "@/lib/types";

type Props = {
  totals: MonthTotals;
  /** Cle de session du compteur, du type "2026-08". */
  monthKey: string;
  carriedCount: number;
  /** Poste le plus lourd du mois, affiche quand le mois est dans le rouge. */
  heaviestExpense: { name: string; amountCents: number } | null;
  onFocusFirstCarried: () => void;
};

/**
 * Carte "reste a la fin du mois" (plan, section 6).
 *
 * Le verdict n'est jamais porte par la seule couleur : "Il reste" ou "Il manque",
 * en toutes lettres, avant le montant. Le mois negatif est un etat de premier
 * ordre avec sa propre mise en page, pas un signe moins colle devant un chiffre.
 *
 * DEUX MONTANTS POSSIBLES EN GRAND, ET UN LIBELLE QUI DIT LEQUEL (retour du
 * 2026-09-02) : `remainingCents` vaut revenus moins depenses et ignore totalement
 * l'epargne et le remboursement. Tant qu'elle n'a rien mis de cote les deux valeurs
 * sont egales, mais des qu'elle saisit une epargne, le grand chiffre ne bougeait
 * pas d'un centime : pour elle, l'application ne comptait pas ce qu'elle venait
 * d'ecrire. On affiche donc `unallocatedCents` des qu'il y a une affectation reelle,
 * avec un libelle qui nomme sans ambiguite le montant montre, et le chemin de calcul
 * juste dessous. Aucune valeur n'est recalculee ici : les deux viennent du serveur,
 * on choisit laquelle repond a la question du moment.
 */
export function MonthHero({
  totals,
  monthKey,
  carriedCount,
  heaviestExpense,
  onFocusFirstCarried,
}: Props) {
  // Meme predicat que AllocationsNote : ce qu'elle a REELLEMENT mis de cote. Une
  // ligne d'epargne fraichement ajoutee, encore a 0 €, n'est pas une affectation
  // et ne doit donc rien changer a l'ecran tant qu'elle n'a pas tape de montant.
  const allocatedCents = totals.savingsCents + totals.debtCents;
  const hasAllocations = allocatedCents > 0;

  // Le mois lui-meme dans le rouge : etat de premier ordre du plan (fond doux,
  // lisere, poste le plus lourd). Sur-affecter un mois positif est un choix
  // legitime, pas un mois rouge : on ne repeint pas la carte pour ca, le mot et
  // la couleur du montant disent deja ce qu'il faut.
  const monthIsNegative = totals.remainingCents < 0;

  const heroCents = hasAllocations ? totals.unallocatedCents : totals.remainingCents;
  const heroIsShort = heroCents < 0;

  const animated = useCountUp(heroCents, monthKey);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(entry ? !entry.isIntersecting : false),
      { rootMargin: "-56px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const displayed = formatCents(animated, { absolute: true });

  // "a la fin du mois" et "apres ce que vous mettez de cote" ne sont pas la meme
  // phrase, et c'est exactement la confusion a lever : le libelle nomme toujours
  // le montant affiche juste en dessous.
  const title = hasAllocations
    ? heroIsShort
      ? "Il manque après ce que vous mettez de côté"
      : "Il reste après ce que vous mettez de côté"
    : monthIsNegative
      ? "Il manque à la fin du mois"
      : "Il reste à la fin du mois";

  // Le bandeau replie tient sur une ligne de telephone : meme sens, phrase courte.
  const collapsedLabel = hasAllocations
    ? heroIsShort
      ? "Il manque après mise de côté"
      : "Il reste après mise de côté"
    : monthIsNegative
      ? "Il manque"
      : "Il reste";

  return (
    <>
      <section
        aria-labelledby="hero-title"
        className={cn(
          "relative overflow-hidden rounded-lg border px-5 py-5",
          monthIsNegative
            ? "border-negative/30 bg-negative-soft"
            : "border-line bg-surface",
        )}
      >
        {monthIsNegative ? (
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-negative" />
        ) : null}

        <h2 id="hero-title" className="text-base text-ink-soft">
          {title}
        </h2>

        <p
          className={cn(
            "amount mt-1 font-display text-[40px] leading-tight font-bold tabular-nums",
            heroIsShort ? "text-negative" : "text-positive",
          )}
        >
          {displayed}
        </p>

        {carriedCount > 0 ? (
          <p className="mt-1 text-[13px] text-ink-soft">
            estimation, {carriedCount === 1 ? "une ligne reste" : `${carriedCount} lignes restent`} à garder
          </p>
        ) : null}

        {monthIsNegative ? (
          <NegativeDetail
            totals={totals}
            hasAllocations={hasAllocations}
            heaviestExpense={heaviestExpense}
          />
        ) : (
          <PositiveDetail totals={totals} hasAllocations={hasAllocations} />
        )}

        {carriedCount > 0 ? (
          <button
            type="button"
            onClick={onFocusFirstCarried}
            className="tap mt-3 flex items-center rounded-sm text-base font-medium text-accent-ink underline underline-offset-4"
          >
            {carriedCount === 1
              ? "1 ligne à garder"
              : `${carriedCount} lignes à garder`}
          </button>
        ) : null}
      </section>

      <div ref={sentinelRef} aria-hidden="true" className="h-px" />

      {/* Bandeau replie : sur telephone, le reste ne quitte jamais l'ecran pendant
          la saisie. Inutile sur ordinateur, ou le hero reste visible dans sa colonne
          collante : un second bandeau ferait doublon. */}
      <div
        aria-hidden={!collapsed}
        className={cn(
          "pointer-events-none fixed inset-x-0 top-0 z-30 flex h-12 items-center justify-center lg:hidden",
          "border-b border-line bg-bg/95 backdrop-blur-sm transition-all duration-200",
          collapsed ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
        )}
      >
        <p className="mx-auto flex w-full max-w-[var(--container-reading)] items-baseline gap-2 px-4 text-lg">
          <span className={cn("text-ink-soft", hasAllocations && "text-base")}>
            {collapsedLabel}
          </span>
          <span
            className={cn(
              "amount font-semibold tabular-nums",
              heroIsShort ? "text-negative" : "text-positive",
            )}
          >
            {formatCents(heroCents, { absolute: true })}
          </span>
        </p>
      </div>
    </>
  );
}

/**
 * Le chemin de calcul, ligne a ligne.
 *
 * Revenus moins depenses donne le solde, l'epargne et le remboursement s'en
 * retirent, et le total de bas de bloc est exactement le grand montant affiche
 * au-dessus. Sans cette echelle, le grand chiffre tombe du ciel et rien ne relie
 * ce qu'elle vient de taper dans "Ce que vous mettez de côté" au haut de l'ecran.
 *
 * Les valeurs affichees sont celles du serveur, telles quelles. Le signe moins
 * devant l'epargne et le remboursement est une mise en forme de la soustraction,
 * pas un calcul : on passe l'oppose a `formatCents` pour rester sur son trait
 * d'union ASCII, present dans les deux fontes, et sur son groupement de milliers.
 *
 * Aucun message n'est branche sur le signe de `unallocatedCents` : un solde negatif
 * y recouvre deux situations opposees (sur-affectation, ou mois deja negatif avant
 * toute affectation, voir Erreurs & Solutions du 2026-08-30). Ici on ne dit rien
 * d'autre que le montant et le mot qui le nomme. Le commentaire, lui, reste dans
 * AllocationsNote, qui separe correctement les deux cas.
 */
function AllocationLedger({ totals }: { totals: MonthTotals }) {
  const short = totals.unallocatedCents < 0;

  return (
    <dl className="mt-4 flex flex-col gap-1 text-base">
      <LedgerRow
        label="Revenus moins dépenses"
        value={formatCents(totals.remainingCents)}
      />
      <LedgerRow
        label="Épargne"
        dotClassName="bg-positive"
        value={formatCents(-totals.savingsCents)}
      />
      <LedgerRow
        label="Remboursement"
        dotClassName="bg-accent-ink"
        value={formatCents(-totals.debtCents)}
      />
      {/* Filet plutot qu'une surface teintee : un trait fin se voit a coup sur et
          ne touche pas au contraste du texte (Erreurs & Solutions du 2026-08-30). */}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-2">
        <dt className="font-medium text-ink">{short ? "Il manque" : "Il reste"}</dt>
        <dd
          className={cn(
            "amount font-semibold tabular-nums",
            short ? "text-negative" : "text-positive",
          )}
        >
          {formatCents(totals.unallocatedCents, { absolute: true })}
        </dd>
      </div>
    </dl>
  );
}

function LedgerRow({
  label,
  value,
  dotClassName,
}: {
  label: string;
  value: string;
  dotClassName?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex items-center gap-2 text-ink-soft">
        {dotClassName ? (
          <span
            aria-hidden="true"
            className={cn("inline-block size-3 shrink-0 rounded-full", dotClassName)}
          />
        ) : null}
        {label}
      </dt>
      <dd className="amount font-medium text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function PositiveDetail({
  totals,
  hasAllocations,
}: {
  totals: MonthTotals;
  hasAllocations: boolean;
}) {
  const { savingsCents, debtCents, remainingCents } = totals;
  const allocated = savingsCents + debtCents;
  const base = Math.max(remainingCents, allocated, 1);
  const savingsPart = (savingsCents / base) * 100;
  const debtPart = (debtCents / base) * 100;

  // Rien de mis de cote : l'ecran ne dit rien de plus qu'avant. Le solde EST le
  // disponible, un libelle ou une echelle qui apparaitraient seuls la perdraient.
  if (!hasAllocations) {
    return (
      <div className="mt-4">
        <div
          aria-hidden="true"
          className="flex h-3 w-full overflow-hidden rounded-full bg-bg"
        >
          <span className="bg-positive" style={{ width: `${savingsPart}%` }} />
          <span className="bg-accent-ink" style={{ width: `${debtPart}%` }} />
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-base">
          <div className="flex items-baseline gap-2">
            <dt className="flex items-center gap-2 text-ink-soft">
              <span aria-hidden="true" className="inline-block size-3 rounded-full bg-positive" />
              Épargne
            </dt>
            <dd className="amount font-medium text-ink tabular-nums">{formatCents(savingsCents)}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="flex items-center gap-2 text-ink-soft">
              <span aria-hidden="true" className="inline-block size-3 rounded-full bg-accent-ink" />
              Remboursement
            </dt>
            <dd className="amount font-medium text-ink tabular-nums">{formatCents(debtCents)}</dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <>
      <AllocationLedger totals={totals} />
      {/* La barre reste, sous l'echelle dont elle reprend les deux couleurs : elle
          donne en un coup d'oeil la part de son solde qui part de cote. */}
      <div
        aria-hidden="true"
        className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-bg"
      >
        <span className="bg-positive" style={{ width: `${savingsPart}%` }} />
        <span className="bg-accent-ink" style={{ width: `${debtPart}%` }} />
      </div>
    </>
  );
}

function NegativeDetail({
  totals,
  hasAllocations,
  heaviestExpense,
}: {
  totals: MonthTotals;
  hasAllocations: boolean;
  heaviestExpense: { name: string; amountCents: number } | null;
}) {
  const heaviest = heaviestExpense ? (
    <p className="text-ink-soft">
      Poste le plus élevé : {heaviestExpense.name},{" "}
      <span className="amount tabular-nums">{formatCents(heaviestExpense.amountCents)}</span>
    </p>
  ) : null;

  // Mois dans le rouge ET quelque chose mis de cote : l'echelle montre les deux
  // dans le meme mouvement, sans reproche, et le poste le plus lourd reste dessous.
  if (hasAllocations) {
    return (
      <div className="text-base text-ink">
        <AllocationLedger totals={totals} />
        {heaviest ? <div className="mt-3">{heaviest}</div> : null}
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-1 text-base text-ink">
      <p>
        Épargne ce mois :{" "}
        <span className="amount font-medium tabular-nums">{formatCents(totals.savingsCents)}</span>
      </p>
      {heaviest}
    </div>
  );
}
