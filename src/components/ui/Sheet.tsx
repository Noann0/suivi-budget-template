"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/components/lib/cn";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Texte lu sous le titre, pour poser le contexte sans jargon. */
  description?: string;
};

/**
 * Feuille qui monte du bas de l'ecran.
 *
 * `<dialog>` natif : le navigateur gere le piege a focus, la touche Echap et
 * l'inertie du fond, sans une ligne de JavaScript de plus et sans dependance.
 */
export function Sheet({ open, onClose, title, children, description }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Un clic hors du panneau ferme. Le panneau lui-meme stoppe la propagation.
        if (event.target === ref.current) onClose();
      }}
      aria-label={title}
      className={cn(
        // `hidden open:flex` : un <dialog> ferme doit rester en display:none,
        // on ne peut donc pas lui poser flex en permanence.
        "fixed inset-0 m-0 hidden h-full max-h-none w-full max-w-none",
        "items-end justify-center bg-transparent p-0 backdrop:bg-ink/35 open:flex",
      )}
    >
      {open ? (
        <div
          className="bud-sheet-in w-full max-w-[var(--container-reading)] rounded-t-lg bg-raised shadow-sheet"
          style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-start gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
              {description ? (
                <p className="mt-1 text-sm text-ink-soft">{description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="tap -mr-2 -mt-1 flex items-center justify-center rounded-sm text-ink-soft"
            >
              <X size={22} aria-hidden="true" />
              <span className="sr-only">Fermer</span>
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
