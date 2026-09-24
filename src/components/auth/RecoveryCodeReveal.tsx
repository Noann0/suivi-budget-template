"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AuthButton } from "@/components/auth/AuthCard";
import { cn } from "@/components/lib/cn";

type Props = {
  code: string;
  onDone: () => void;
  /** Vrai pendant l'appel d'acquittement, pour ne pas valider deux fois. */
  pending?: boolean;
};

/**
 * Le code de secours, affiche une seule fois dans la vie du compte.
 *
 * C'est le moment le plus fragile de tout le parcours : le serveur ne le stocke que
 * hache, il ne pourra jamais le reafficher. D'ou les protections, toutes
 * intentionnelles :
 * - aucune croix, aucun clic hors du panneau, la touche Echap est neutralisee ;
 * - une case a cocher explicite avant que le bouton ne s'active ;
 * - un garde-fou sur la fermeture d'onglet tant que la case n'est pas cochee.
 *
 * Le texte s'adresse a elle mais designe l'administrateur comme destinataire du code : c'est lui
 * qui saura quoi en faire le jour ou le telephone sera perdu.
 */
export function RecoveryCodeReveal({ code, onDone, pending = false }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (acknowledged) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [acknowledged]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Presse-papiers refuse par le navigateur : le code reste lisible et
      // selectionnable a l'ecran, elle peut le recopier a la main.
      setCopied(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      // Echap ne ferme pas : ce panneau ne se quitte que par la case cochee.
      onCancel={(event) => event.preventDefault()}
      aria-labelledby="recovery-title"
      className="fixed inset-0 m-0 hidden h-full max-h-none w-full max-w-none items-center justify-center bg-transparent p-0 backdrop:bg-ink/60 open:flex"
    >
      <div className="max-h-full w-full max-w-[var(--container-reading)] overflow-y-auto p-4">
        <div className="rounded-lg bg-raised px-5 py-6 shadow-sheet">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-positive-soft text-positive"
            >
              <KeyRound size={22} />
            </span>
            <h2 id="recovery-title" className="font-display text-xl font-bold text-ink">
              C&apos;est fait, votre budget est prêt
            </h2>
          </div>

          <p className="mt-4 text-base text-ink">
            Voici votre code de secours. Il sert une seule fois, le jour où vous
            n&apos;auriez plus votre téléphone.
          </p>

          <p
            className="amount mt-4 rounded-md border-2 border-dashed border-accent-ink/40 bg-bg px-4 py-4 text-center text-2xl font-semibold tracking-[0.12em] text-ink select-all"
            // Selectionnable d'un geste : elle peut le recopier sans viser au doigt.
          >
            {code}
          </p>

          <button
            type="button"
            onClick={copy}
            className="tap mt-3 flex w-full items-center justify-center gap-2 rounded-sm border border-line bg-surface text-base font-medium text-ink"
          >
            {copied ? (
              <>
                <Check size={18} aria-hidden="true" className="text-positive" />
                Code copié
              </>
            ) : (
              <>
                <Copy size={18} aria-hidden="true" />
                Copier le code
              </>
            )}
          </button>

          <div className="mt-5 rounded-md border border-line bg-carried px-4 py-3">
            <p className="text-base text-ink">
              <strong className="font-semibold">Ce code est pour l&apos;administrateur.</strong> Envoyez-le
              lui, ou notez-le sur un papier que vous rangez avec vos documents
              importants.
            </p>
            <p className="mt-2 text-base text-ink">
              Si vous rechargez cette page, un <strong className="font-semibold">nouveau
              code</strong> sera créé et celui-ci ne fonctionnera plus. Notez-le
              maintenant, avant de faire autre chose.
            </p>
          </div>

          <label className="tap mt-5 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-1 size-6 shrink-0 accent-[var(--color-accent)]"
            />
            <span className="text-base text-ink">
              J&apos;ai noté ce code, ou je l&apos;ai envoyé à l&apos;administrateur.
            </span>
          </label>

          <div className={cn("mt-5", !acknowledged && "opacity-60")}>
            <AuthButton onClick={onDone} disabled={!acknowledged || pending}>
              {pending ? "Un instant..." : "C'est noté, continuer"}
            </AuthButton>
          </div>

          {!acknowledged ? (
            <p className="mt-2 text-center text-sm text-ink-soft">
              Cochez la case ci-dessus pour continuer.
            </p>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
