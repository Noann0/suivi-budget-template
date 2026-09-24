"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { cn } from "@/components/lib/cn";
import { formatCents, formatShare } from "@/components/lib/format";
import { hueStyle } from "@/components/lib/palette";
import type { ColorIntensity } from "@/lib/types";

export type DonutSlice = {
  id: string;
  label: string;
  /** null pour le regroupement "Autres", rendu en sable neutre. */
  hue: number | null;
  /**
   * Intensite propre a la categorie. Absente ou null = elle suit le reglage
   * global porte par `data-intensity` sur la coquille, ce qui reste le cas le
   * plus courant. Le mois ne passe rien, l'annee passe ce que le serveur rend.
   */
  intensity?: ColorIntensity | null;
  amountCents: number;
};

type OpeningBalanceMarker = {
  cents: number;
  label?: string;
};

type Props = {
  slices: readonly DonutSlice[];
  totalCents: number;
  /** Titre lu au-dessus du total central. */
  centerLabel: string;
  /** Titre lu au lecteur d'ecran. Le mois et l'annee ne parlent pas du meme perimetre. */
  srTitle?: string;
  /** Constat d'absence quand il n'y a aucune depense. Jamais un zero. */
  emptyMessage?: string;
  /**
   * Solde porte depuis les mois precedents. Il est trace comme un anneau pointille
   * hors du camembert : ce repere n'est jamais une part ni une depense.
   */
  openingBalance?: readonly OpeningBalanceMarker[] | OpeningBalanceMarker | null;
};

const SIZE = 200;
const STROKE = 26;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Anneau dans la bordure externe du donut, sans modifier ses secteurs. */
const OPENING_BALANCE_RADIUS = RADIUS + STROKE / 2 - 4;
/** Separateur de 2px entre secteurs, exprime en longueur d'arc. */
const GAP = 2;
/** En dessous de 3 % du total, la categorie part dans "Autres" (plan, section 6). */
const OTHERS_THRESHOLD = 0.03;

type Segment = DonutSlice & { length: number; offset: number };

export function DonutChart({
  slices,
  totalCents,
  centerLabel,
  srTitle = "Répartition des dépenses",
  emptyMessage = "Aucune dépense saisie pour l'instant. Le camembert apparaîtra dès la première.",
  openingBalance: openingBalanceInput = [],
}: Props) {
  const titleId = useId();
  const [active, setActive] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    // Un tick apres le montage : la transition part de l'etat masque.
    const id = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const grouped = useMemo(() => groupSmallSlices(slices, totalCents), [slices, totalCents]);
  // Le mois fournit encore un seul repere. L'annee fournit dette et revenu : les
  // deux formes sont des montants serveur, normalises ici sans les recalculer.
  const openingBalance = Array.isArray(openingBalanceInput)
    ? openingBalanceInput
    : openingBalanceInput === null
      ? []
      : [openingBalanceInput];

  const segments = useMemo<Segment[]>(() => {
    if (totalCents <= 0) return [];
    let cursor = 0;
    return grouped.map((slice) => {
      const share = slice.amountCents / totalCents;
      const raw = share * CIRCUMFERENCE;
      const segment: Segment = {
        ...slice,
        length: Math.max(raw - GAP, 0.5),
        offset: cursor,
      };
      cursor += raw;
      return segment;
    });
  }, [grouped, totalCents]);

  if (totalCents <= 0) {
    return (
      <section aria-labelledby={titleId} className="card px-4 py-6 text-center">
        <h2 id={titleId} className="sr-only">
          {srTitle}
        </h2>
        {openingBalance.length > 0 ? <OpeningBalanceGraphic balances={openingBalance} empty /> : null}
        <p className="text-base text-ink-soft">{emptyMessage}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby={titleId} className="card px-4 py-5">
      <h2 id={titleId} className="sr-only">
        {srTitle}
      </h2>

      <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          aria-hidden="true"
          className="block"
        >
          {openingBalance.map((balance, index) => (
            <OpeningBalanceRing key={`${balance.label}-${balance.cents}`} cents={balance.cents} index={index} />
          ))}
          {segments.map((segment, index) => {
            const dimmed = active !== null && active !== segment.id;
            return (
              <circle
                key={segment.id}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                strokeLinecap="butt"
                style={{
                  ...(segment.hue === null
                    ? {}
                    : hueStyle(segment.hue, segment.intensity ?? null)),
                  stroke: segment.hue === null ? "var(--color-line)" : "var(--cat-surface)",
                  strokeDasharray: `${segment.length} ${CIRCUMFERENCE}`,
                  strokeDashoffset: revealed ? 0 : segment.length,
                  transform: `rotate(${(segment.offset / CIRCUMFERENCE) * 360 - 90}deg)`,
                  transformOrigin: "center",
                  transition:
                    "stroke-dashoffset 500ms ease-out, opacity 180ms ease-out",
                  transitionDelay: revealed ? `${index * 40}ms` : "0ms",
                  opacity: dimmed ? 0.4 : 1,
                  cursor: "pointer",
                }}
                onClick={() => setActive(active === segment.id ? null : segment.id)}
              />
            );
          })}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <span className="text-sm text-ink-soft">{centerLabel}</span>
          <span className="amount font-display text-2xl font-bold text-ink">
            {formatCents(totalCents)}
          </span>
        </div>

        {openingBalance.length > 0 ? <OpeningBalanceGraphic balances={openingBalance} /> : null}
      </div>

      <ul className="mt-5 flex flex-col">
        {grouped.map((slice) => {
          const selected = active === slice.id;
          return (
            <li key={slice.id}>
              <button
                type="button"
                onClick={() => setActive(selected ? null : slice.id)}
                aria-pressed={selected}
                className={cn(
                  "tap flex w-full items-center gap-3 rounded-sm px-1 text-left",
                  "border-b border-line/70 last:border-b-0",
                  selected && "bg-bg",
                )}
              >
                <span
                  aria-hidden="true"
                  style={
                    slice.hue === null
                      ? undefined
                      : hueStyle(slice.hue, slice.intensity ?? null)
                  }
                  className={cn(
                    "inline-block size-3 shrink-0 rounded-full ring-1 ring-black/5",
                    slice.hue === null ? "bg-line" : "bg-[var(--cat-surface)]",
                  )}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-base",
                    selected ? "font-semibold text-ink" : "text-ink",
                  )}
                >
                  {slice.label}
                </span>
                <span className="amount shrink-0 text-base text-ink tabular-nums">
                  {formatCents(slice.amountCents)}
                </span>
                <span className="amount w-12 shrink-0 text-right text-sm text-ink-soft tabular-nums">
                  {formatShare(slice.amountCents, totalCents)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * L'anneau ne mesure volontairement aucune proportion : une dette ancienne ne doit
 * ni gonfler le total des depenses, ni sembler etre une categorie du camembert.
 */
function OpeningBalanceRing({ cents, index = 0 }: { cents: number; index?: number }) {
  const tone = cents < 0 ? "var(--color-negative)" : cents > 0 ? "var(--color-positive)" : "var(--color-line)";
  return (
    <circle
      cx={SIZE / 2}
      cy={SIZE / 2}
      r={OPENING_BALANCE_RADIUS - index * 5}
      fill="none"
      stroke={tone}
      strokeWidth={3}
      strokeDasharray="2 4"
      aria-hidden="true"
    />
  );
}

function OpeningBalanceGraphic({
  balances,
  empty = false,
}: {
  balances: readonly OpeningBalanceMarker[];
  empty?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-[19rem] items-center gap-3 text-left",
        empty ? "mb-4 flex-col" : "mt-4 border-t border-line/70 pt-3",
      )}
    >
      {empty ? (
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={88} height={88} aria-hidden="true" className="shrink-0">
          {balances.map((balance, index) => (
            <OpeningBalanceRing key={`${balance.label}-${balance.cents}`} cents={balance.cents} index={index} />
          ))}
        </svg>
      ) : (
        <span aria-hidden="true" className="flex shrink-0 flex-col gap-1">
          {balances.map((balance) => (
            <span
              key={`${balance.label}-${balance.cents}`}
              className={cn(
                "inline-block size-4 rounded-full border-[3px] border-dashed",
                balance.cents < 0 ? "border-negative" : "border-positive",
              )}
            />
          ))}
        </span>
      )}
      <div className="min-w-0 space-y-1">
        {balances.map((balance) => {
          const isDebt = balance.cents < 0;
          const label = balance.label ?? "Solde d'ouverture";
          const description = isDebt ? "Dette des mois précédents" : "Revenu des mois précédents";
          return (
            <p key={`${balance.label}-${balance.cents}`} className="text-sm text-ink-soft">
              <span className="font-semibold text-ink">{label}</span>{" "}
              <span className={cn("amount font-semibold tabular-nums", isDebt ? "text-negative" : "text-positive")}>
                {isDebt ? "-" : "+"}
                {formatCents(balance.cents, { absolute: true })}
              </span>{" "}
              <span>{description}</span>
            </p>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Regroupe les categories sous 3 % dans un secteur "Autres".
 * Un camembert lisible affiche 6 a 10 secteurs, pas seize : au dela, l'ecart
 * perceptif entre pastels voisines ne survit plus au daltonisme (plan, section 3).
 */
function groupSmallSlices(
  slices: readonly DonutSlice[],
  totalCents: number,
): DonutSlice[] {
  if (totalCents <= 0) return [];

  const kept: DonutSlice[] = [];
  const small: DonutSlice[] = [];

  for (const slice of slices) {
    if (slice.amountCents <= 0) continue;
    if (slice.amountCents / totalCents < OTHERS_THRESHOLD) small.push(slice);
    else kept.push(slice);
  }

  kept.sort((a, b) => b.amountCents - a.amountCents);

  if (small.length === 1) {
    // Une seule petite categorie : la masquer sous "Autres" lui ferait perdre son
    // nom sans rien simplifier. On la garde nominative.
    kept.push(small[0] as DonutSlice);
    return kept;
  }

  if (small.length > 1) {
    kept.push({
      id: "__others__",
      label: `Autres (${small.length} catégories)`,
      hue: null,
      amountCents: small.reduce((sum, slice) => sum + slice.amountCents, 0),
    });
  }

  return kept;
}
