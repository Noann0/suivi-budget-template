import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/components/lib/cn";
import { stepLink, type NextStep } from "@/components/lib/authMessages";

type Props = {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Carte des ecrans d'entree. Une seule chose a l'ecran a la fois : elle est seule
 * devant son telephone, sans personne pour lui dire ou regarder.
 */
export function AuthCard({ title, intro, children, className }: Props) {
  return (
    <div className={cn("card px-5 py-6", className)}>
      <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
      {intro ? <div className="mt-2 text-base text-ink-soft">{intro}</div> : null}
      <div className="mt-5">{children}</div>
    </div>
  );
}

/**
 * Message d'erreur : une phrase comprehensible, jamais un code technique.
 *
 * `step` est facultatif, et n'ajoute un lien que lorsque la suite se joue sur un
 * AUTRE ecran. Quand elle se joue sur place, le bouton deja present suffit : deux
 * propositions concurrentes pour un seul geste laissent le choix a quelqu'un qui
 * cherche justement qu'on lui dise quoi faire.
 */
export function AuthError({ message, step }: { message: string; step?: NextStep }) {
  const link = step === undefined ? null : stepLink(step);
  return (
    <div
      role="alert"
      className="mt-4 rounded-md border border-negative/40 bg-negative-soft px-4 py-3 text-base text-ink"
    >
      <p>{message}</p>
      {link ? (
        <p className="mt-2">
          <Link
            href={link.href}
            className="font-medium text-accent-ink underline underline-offset-4"
          >
            {link.label}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export function AuthButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "quiet";
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "tap flex w-full items-center justify-center rounded-sm px-5 text-lg font-semibold",
        "transition-opacity duration-150 disabled:opacity-60",
        variant === "primary"
          ? "bg-accent text-white"
          : "border border-line bg-surface text-ink font-medium",
      )}
    >
      {children}
    </button>
  );
}
