"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/components/lib/cn";

export type SegmentedOption<T extends string> = {
  value: T;
  /**
   * Un texte, ou un texte accompagne d'une icone. Le libelle reste toujours ecrit :
   * une icone seule ne nomme rien, et le lecteur d'ecran lit le contenu du label.
   */
  label: ReactNode;
};

type Props<T extends string> = {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Interrupteur a deux positions ou plus.
 *
 * Implemente en groupe de boutons radio : le lecteur d'ecran annonce le choix, et
 * les fleches du clavier fonctionnent nativement sur l'ordinateur secondaire.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  className,
}: Props<T>) {
  const name = useId();

  return (
    <fieldset className={cn("min-w-0", className)} disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      <div className="flex rounded-sm border border-line bg-bg p-1">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                "tap relative flex flex-1 cursor-pointer items-center justify-center",
                "rounded-[6px] px-3 text-base transition-colors duration-150",
                // Le bouton radio est en sr-only : sans cette regle, l'anneau de
                // focus global se dessine sur un element invisible et le clavier
                // avance a l'aveugle. On le reporte sur l'etiquette, qui est ce
                // qu'on voit.
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                "has-[:focus-visible]:outline-accent-ink",
                checked
                  ? "bg-surface font-semibold text-ink shadow-raised"
                  : "text-ink-soft hover:text-ink",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
