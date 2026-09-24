"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { AddToAmount, type AddOutcome } from "@/components/AddToAmount";
import { AmountInput } from "@/components/AmountInput";
import { cn } from "@/components/lib/cn";
import { formatCents } from "@/components/lib/format";
import { hueStyle } from "@/components/lib/palette";
import type { CategoryBlock } from "@/lib/types";

export type LineState = {
  /** null = aucune saisie pour cette sous-categorie ce mois. Ce n'est pas zero. */
  amountCents: number | null;
  /** Vrai tant que la ligne reportee du mois precedent n'a pas ete confirmee. */
  carried: boolean;
};

type Props = {
  block: CategoryBlock;
  lines: Readonly<Record<string, LineState>>;
  subtotalCents: number;
  pendingIds: ReadonlySet<string>;
  onCommit: (subcategoryId: string, amountCents: number) => void;
  onConfirm: (subcategoryId: string, amountCents: number) => void;
  /** Envoie un DELTA au serveur, qui fait l'addition. Voir `AddToAmount`. */
  onAdd: (subcategoryId: string, deltaCents: number) => Promise<AddOutcome>;
  defaultOpen?: boolean;
};

export function CategoryAccordion({
  block,
  lines,
  subtotalCents,
  pendingIds,
  onCommit,
  onConfirm,
  onAdd,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `cat-panel-${block.category.id}`;
  const carriedInBlock = block.lines.filter((line) => lines[line.subcategory.id]?.carried).length;

  return (
    <div
      style={hueStyle(block.category.hue, block.category.intensity)}
      className="border-b border-line last:border-b-0"
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="tap flex w-full items-center gap-3 py-2 pr-1 pl-1 text-left"
        >
          <span
            aria-hidden="true"
            className="inline-block size-3 shrink-0 rounded-full bg-[var(--cat-surface)] ring-1 ring-black/5"
          />
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
            {block.category.name}
            {carriedInBlock > 0 ? (
              <span className="ml-2 align-middle text-sm font-normal text-ink-soft">
                ({carriedInBlock} à garder)
              </span>
            ) : null}
          </span>
          <span className="amount shrink-0 text-[17px] font-medium text-ink tabular-nums">
            {formatCents(subtotalCents)}
          </span>
          <ChevronDown
            size={20}
            aria-hidden="true"
            className={cn(
              "shrink-0 text-ink-soft transition-transform duration-[220ms] ease-out",
              open && "rotate-180",
            )}
          />
        </button>
      </h3>

      {/* 0fr vers 1fr : la hauteur s'anime en CSS pur, sans mesure JavaScript. */}
      <div
        id={panelId}
        className={cn(
          "grid transition-[grid-template-rows] duration-[220ms] ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          {/* Filet gauche 2px dans la teinte du parent (plan §3 et §6.6, arbitrage
              du 2026-08-30). Le fond des sous-lignes reste NEUTRE : une teinte a 55 %
              d'opacite fait tomber le texte secondaire a 2.66 de contraste en
              intensite franche, et l'opacite maximale AA serait 20 %, un voile
              invisible. Le filet rattache au parent hors de la zone de texte, donc
              a cout de contraste nul. */}
          <ul className="mb-2 ml-6 flex flex-col rounded-r-sm border-l-2 border-l-[var(--cat-surface)] bg-surface pl-1">
            {block.lines.map((line) => {
              const state = lines[line.subcategory.id] ?? { amountCents: null, carried: false };
              return (
                <LineRow
                  key={line.subcategory.id}
                  subcategoryId={line.subcategory.id}
                  name={line.subcategory.name}
                  state={state}
                  pending={pendingIds.has(line.subcategory.id)}
                  onCommit={onCommit}
                  onConfirm={onConfirm}
                  onAdd={onAdd}
                />
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function LineRow({
  subcategoryId,
  name,
  state,
  pending,
  onCommit,
  onConfirm,
  onAdd,
}: {
  subcategoryId: string;
  name: string;
  state: LineState;
  pending: boolean;
  onCommit: (subcategoryId: string, amountCents: number) => void;
  onConfirm: (subcategoryId: string, amountCents: number) => void;
  onAdd: (subcategoryId: string, deltaCents: number) => Promise<AddOutcome>;
}) {
  return (
    <li
      data-line-id={subcategoryId}
      data-carried={state.carried ? "true" : undefined}
      className={cn(
        "flex items-center gap-2 border-b border-line/60 px-2 last:border-b-0",
        "transition-colors duration-[180ms] ease-out",
        state.carried && "bg-carried",
      )}
    >
      <span className="min-w-0 flex-1 py-2">
        <span className="block truncate text-base text-ink">{name}</span>
        {state.carried ? (
          <span className="mt-0.5 inline-block rounded-full border border-line px-2 py-px text-xs text-ink-soft">
            reporté
          </span>
        ) : null}
      </span>

      <AmountInput
        valueCents={state.amountCents}
        carried={state.carried}
        pending={pending}
        label={`Montant de ${name}`}
        onCommit={(cents) => onCommit(subcategoryId, cents)}
      />

      {/* Une seule colonne a droite du montant, de largeur fixe, jamais deux boutons a
          la fois. Ligne reportee : « Garder » prime, car le montant affiche vient encore
          de juillet, ajouter dessus melerait deux gestes. Ligne jamais saisie : rien a
          quoi ajouter, elle tape le montant directement. Sinon : le "+" d'ajout. La
          colonne garde sa largeur dans tous les cas, les montants restent alignes.

          Le mot « Garder » a remplace une coche seule le 2026-09-13. Une coche ronde et
          verte se lit comme un ETAT selectionne : elle cherchait ensuite ou valider sa
          selection, et il n'y avait rien a valider puisque chaque coche enregistrait
          deja. Un verbe visible ne laisse pas ce doute. Le comportement, lui, est
          inchange : l'enregistrement reste immediat. */}
      <span className="flex w-[4.5rem] shrink-0 justify-end">
        {state.carried && state.amountCents !== null ? (
          <button
            type="button"
            onClick={() => onConfirm(subcategoryId, state.amountCents ?? 0)}
            disabled={pending}
            className={cn(
              "tap flex items-center justify-center rounded-sm px-2",
              "border border-positive/40 bg-positive-soft text-sm font-semibold text-positive",
              "transition-colors duration-[180ms] ease-out disabled:opacity-50",
            )}
          >
            Garder
            <span className="sr-only">
              {" "}
              {formatCents(state.amountCents)} pour {name}. Enregistré tout de suite.
            </span>
          </button>
        ) : state.amountCents !== null && state.amountCents > 0 ? (
          <AddToAmount
            currentCents={state.amountCents}
            label={name}
            disabled={pending}
            onAdd={(deltaCents) => onAdd(subcategoryId, deltaCents)}
          />
        ) : null}
      </span>
    </li>
  );
}
