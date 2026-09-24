"use client";

import { Check } from "lucide-react";
import { useMemo } from "react";

import { cn } from "@/components/lib/cn";
import { HUES, hueName, hueStyle } from "@/components/lib/palette";
import type { ColorIntensity, Hue } from "@/lib/types";

export type PreviewSlice = {
  id: string;
  label: string;
  hue: number;
  amountCents: number;
};

type Props = {
  value: number;
  onChange: (hue: Hue) => void;
  /** Intensite globale active, pour afficher les pastilles telles qu'elles seront. */
  intensity: ColorIntensity;
  /** Teintes deja prises par une autre categorie. Utilisables quand meme. */
  usedHues: readonly number[];
  /** Categories reelles, pour l'apercu. La teinte en cours de choix y est injectee. */
  previewSlices: readonly PreviewSlice[];
  previewSliceId: string;
};

/**
 * Choix de la teinte d'une categorie (plan, section 8).
 *
 * Seize pastilles, deux rangees de huit, dans l'ordre de la roue chromatique.
 * Pas de color picker libre : seize teintes plus un interrupteur, c'est tout
 * l'espace de choix. Chaque teinte porte un ecart mesure sous daltonisme qu'un
 * choix libre detruirait.
 */
export function HuePicker({
  value,
  onChange,
  intensity,
  usedHues,
  previewSlices,
  previewSliceId,
}: Props) {
  const used = new Set(usedHues);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-base text-ink-soft">Choisissez une couleur</p>
        <div className="grid grid-cols-8 gap-2">
          {HUES.map((definition) => {
            const selected = definition.hue === value;
            return (
              <button
                key={definition.hue}
                type="button"
                onClick={() => onChange(definition.hue)}
                aria-pressed={selected}
                aria-label={`Couleur ${definition.name}${used.has(definition.hue) ? ", déjà utilisée par une autre catégorie" : ""}`}
                style={hueStyle(definition.hue, intensity)}
                className={cn(
                  "tap relative flex items-center justify-center rounded-full",
                  "bg-[var(--cat-surface)] transition-transform duration-150",
                  selected ? "ring-2 ring-ink ring-offset-2 ring-offset-raised" : "ring-1 ring-black/5",
                )}
              >
                {selected ? (
                  <Check size={20} strokeWidth={3} className="text-[var(--cat-ink)]" aria-hidden="true" />
                ) : null}
                {used.has(definition.hue) && !selected ? (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-1.5 size-1.5 rounded-full bg-ink-soft"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          Couleur choisie : <span className="text-ink">{hueName(value)}</span>
        </p>
      </div>

      <div className="rounded-md border border-line bg-bg px-3 py-3">
        <p className="mb-2 text-sm text-ink-soft">Aperçu sur vos vraies catégories</p>
        <MiniDonut
          slices={previewSlices.map((slice) =>
            slice.id === previewSliceId ? { ...slice, hue: value } : slice,
          )}
          intensity={intensity}
        />
      </div>
    </div>
  );
}

const MINI_SIZE = 96;
const MINI_STROKE = 16;
const MINI_RADIUS = (MINI_SIZE - MINI_STROKE) / 2;
const MINI_CIRCUMFERENCE = 2 * Math.PI * MINI_RADIUS;

function MiniDonut({
  slices,
  intensity,
}: {
  slices: readonly PreviewSlice[];
  intensity: ColorIntensity;
}) {
  const total = slices.reduce((sum, slice) => sum + Math.max(slice.amountCents, 0), 0);

  // Les offsets cumules se calculent hors du rendu : muter un compteur pendant le
  // map rendrait le composant non idempotent, ce que le compilateur React refuse.
  const arcs = useMemo(() => {
    if (total <= 0) return [];
    let cursor = 0;
    return slices.map((slice) => {
      const raw = (Math.max(slice.amountCents, 0) / total) * MINI_CIRCUMFERENCE;
      const arc = { slice, raw, rotation: (cursor / MINI_CIRCUMFERENCE) * 360 - 90 };
      cursor += raw;
      return arc;
    });
  }, [slices, total]);

  if (total <= 0) {
    // Aucun montant : on montre les pastilles plutot qu'un camembert vide, qui
    // laisserait croire a une repartition egale inexistante.
    return (
      <ul className="flex flex-wrap gap-2">
        {slices.map((slice) => (
          <li key={slice.id} className="flex items-center gap-2 text-sm text-ink">
            <span
              aria-hidden="true"
              style={hueStyle(slice.hue, intensity)}
              className="inline-block size-4 rounded-full bg-[var(--cat-surface)] ring-1 ring-black/5"
            />
            {slice.label}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <svg
        width={MINI_SIZE}
        height={MINI_SIZE}
        viewBox={`0 0 ${MINI_SIZE} ${MINI_SIZE}`}
        aria-hidden="true"
        className="shrink-0"
      >
        {arcs.map(({ slice, raw, rotation }) => {
          return (
            <circle
              key={slice.id}
              cx={MINI_SIZE / 2}
              cy={MINI_SIZE / 2}
              r={MINI_RADIUS}
              fill="none"
              strokeWidth={MINI_STROKE}
              style={{
                ...hueStyle(slice.hue, intensity),
                stroke: "var(--cat-surface)",
                strokeDasharray: `${Math.max(raw - 1.5, 0.5)} ${MINI_CIRCUMFERENCE}`,
                transform: `rotate(${rotation}deg)`,
                transformOrigin: "center",
                transition: "stroke 200ms ease-out",
              }}
            />
          );
        })}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1">
        {slices.slice(0, 5).map((slice) => (
          <li key={slice.id} className="flex items-center gap-2 text-sm text-ink">
            <span
              aria-hidden="true"
              style={hueStyle(slice.hue, intensity)}
              className="inline-block size-3 shrink-0 rounded-full bg-[var(--cat-surface)] ring-1 ring-black/5"
            />
            <span className="truncate">{slice.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
