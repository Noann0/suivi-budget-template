"use client";

import { cn } from "@/components/lib/cn";

type Props = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  hint?: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
};

/**
 * Champ de saisie d'un code court, tape a la main sur un Android.
 *
 * `autoCapitalize="characters"` : Chrome Android met une minuscule par defaut, et
 * elle ne verrait pas la difference avec le code majuscule qu'on lui a donne.
 * `autoCorrect` et la correction orthographique sont coupes, sinon le clavier
 * "corrige" un code en mot du dictionnaire au moment de valider.
 */
export function CodeInput({
  value,
  onChange,
  label,
  hint,
  invalid = false,
  disabled = false,
  autoFocus = false,
}: Props) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-base font-medium text-ink">{label}</span>
      {hint ? <span className="text-sm text-ink-soft">{hint}</span> : null}
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        aria-invalid={invalid}
        className={cn(
          "amount h-14 w-full rounded-sm border bg-surface px-4 text-xl tracking-[0.15em] text-ink",
          "uppercase placeholder:tracking-normal placeholder:text-ink-soft/60 placeholder:normal-case",
          invalid ? "border-negative" : "border-line focus:border-accent-ink",
        )}
        placeholder="Le code que l'administrateur vous a donné"
      />
    </label>
  );
}
