"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/components/lib/cn";
import { centsToInputValue, formatCents, parseAmount } from "@/components/lib/format";

type Props = {
  /** null signifie "jamais saisi". Ce n'est pas zero, et ca ne s'affiche pas comme zero. */
  valueCents: number | null;
  onCommit: (cents: number) => void;
  /** Libelle lu par le lecteur d'ecran, du type "Montant de Courses". */
  label: string;
  /** Ligne reportee du mois precedent, pas encore confirmee. */
  carried?: boolean;
  pending?: boolean;
  disabled?: boolean;
  className?: string;
};

/**
 * Saisie d'un montant.
 *
 * Repos : un bouton qui affiche le montant mis en forme, ou "a saisir" quand rien
 * n'a jamais ete entre. Le plan interdit d'ecrire "0,00 €" pour une donnee absente :
 * un zero affiche doit vouloir dire "zero saisi".
 *
 * Edition : un vrai <input>, `inputMode="decimal"` pour que Chrome Android ouvre le
 * pave numerique, et la virgule acceptee comme separateur decimal. Elle tapera
 * "1250,50", et c'est le format francais qui est juste, pas le point.
 */
export function AmountInput({
  valueCents,
  onCommit,
  label,
  carried = false,
  pending = false,
  disabled = false,
  className,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Selection complete : elle retape le montant sans avoir a effacer d'abord.
    input.select();
  }, [editing]);

  function startEditing() {
    if (disabled) return;
    setDraft(valueCents === null ? "" : centsToInputValue(valueCents));
    setInvalid(false);
    setEditing(true);
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setEditing(false);
      setInvalid(false);
      return;
    }
    const cents = parseAmount(trimmed);
    if (cents === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setEditing(false);
    onCommit(cents);
  }

  if (editing) {
    return (
      <span className={cn("flex flex-col items-end", className)}>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={label}
          aria-invalid={invalid}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (invalid) setInvalid(false);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setInvalid(false);
              setEditing(false);
            }
          }}
          className={cn(
            "amount tap w-[7.5rem] rounded-sm border bg-raised px-2 text-right text-[17px]",
            "font-medium text-ink tabular-nums",
            invalid ? "border-negative" : "border-accent-ink",
          )}
        />
        {invalid ? (
          <span role="alert" className="mt-1 text-sm text-negative">
            Montant illisible
          </span>
        ) : null}
      </span>
    );
  }

  const empty = valueCents === null;
  const displayed = valueCents === null ? null : formatCents(valueCents);

  return (
    <button
      type="button"
      onClick={startEditing}
      disabled={disabled}
      aria-label={
        displayed === null
          ? `${label}, rien de saisi. Toucher pour saisir.`
          : `${label}, ${displayed}. Toucher pour modifier.`
      }
      className={cn(
        "tap flex items-center justify-end rounded-sm px-2 text-[17px] font-medium",
        // Largeur reservee pour "9 999,99 €" : jamais de troncature ni de saut de colonne.
        "min-w-[7.5rem] transition-colors duration-150",
        empty && "font-normal text-ink-soft italic",
        !empty && carried && "text-ink-soft",
        !empty && !carried && "text-ink",
        pending && "opacity-60",
        className,
      )}
    >
      <span className={cn(!empty && "amount")}>
        {displayed ?? "à saisir"}
      </span>
    </button>
  );
}
