"use client";

import { Check, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/components/lib/cn";
import { MAX_AMOUNT_CENTS, formatCents, parseAmount } from "@/components/lib/format";

/**
 * Reponse attendue de l'appelant apres l'ecriture serveur.
 *
 * `amountCents` est le montant que le SERVEUR affirme apres addition, jamais une
 * somme reconstruite ici. `message` a null veut dire qu'il n'y a plus rien a
 * afficher : la session est perdue et l'ecran part vers la porte d'entree.
 */
export type AddOutcome =
  | { ok: true; amountCents: number }
  | { ok: false; message: string | null };

type Props = {
  /** Montant deja note sur la ligne, en centimes. */
  currentCents: number;
  /** Nom de la ligne, tel qu'il s'affiche : "Vêtements", "Épargne". */
  label: string;
  /** Envoie le DELTA au serveur. L'addition n'est jamais faite ici. */
  onAdd: (deltaCents: number) => Promise<AddOutcome>;
  disabled?: boolean;
};

/**
 * Le petit "+" a cote du montant, et la feuille de saisie qu'il ouvre.
 *
 * Le besoin : 40 EUR de vetements en debut de mois, 100 de plus quatre jours apres.
 * Aujourd'hui elle efface 40 et tape 140 apres avoir fait l'addition de tete. Ici
 * elle tape 100, et c'est la base qui additionne.
 *
 * Trois contraintes ont dicte cette forme.
 *
 * 1. Le montant de la ligne reste modifiable exactement comme avant. C'est son moyen
 *    de corriger une erreur, il ne devait ni disparaitre ni changer de comportement.
 *    L'ajout passe donc par un champ SEPARE, vide a l'ouverture : le champ du montant
 *    presente sa valeur pre-selectionnee, ou toute frappe remplace tout, ce qui est
 *    juste pour corriger et impossible a concilier avec un ajout.
 * 2. Le pave numerique d'Android n'a pas de touche "+". Une fonctionnalite qui exige
 *    une touche absente du clavier n'existe pas. D'ou un bouton, et un champ qui
 *    reste en `inputMode="decimal"` : elle tape un nombre, rien d'autre.
 * 3. La ligne est deja pleine sur un telephone. Le bouton se loge dans la colonne de
 *    44px deja reservee a droite du montant, la largeur de la ligne ne bouge pas.
 *
 * Le delta seul part au serveur, l'addition est faite par SQLite. L'ecran ecrit son
 * etat avant la reponse : deux ajouts rapproches partiraient sinon de la meme base et
 * le second ecraserait le premier.
 */
export function AddToAmount({ currentCents, label, onAdd, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /**
   * Le resultat, fige au moment de la reponse serveur.
   *
   * `before` est copie a la soumission plutot que relu de `currentCents` : la prop a
   * deja change quand cet ecran s'affiche, et relire donnerait "140 + 100 = 140".
   */
  const [done, setDone] = useState<{ before: number; added: number; total: number } | null>(
    null,
  );

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Verrou de double soumission. Un state ne suffit pas : deux appuis rapproches
   * peuvent atteindre le gestionnaire avant le rendu qui desactive le bouton. Une
   * ref se lit et s'ecrit dans le meme tour, elle, et bloque le second appui.
   */
  const inFlight = useRef(false);
  /** Ce qu'il reste a faire une fois la feuille reellement retiree du document. */
  const afterClose = useRef<{ focus: boolean; flash: boolean }>({
    focus: false,
    flash: false,
  });

  const fieldId = useId();
  const hintId = `${fieldId}-hint`;

  // Le focus arrive apres l'ouverture de la feuille : `showModal()` deplace le focus
  // lui-meme, et le fait depuis l'effet du parent, donc APRES celui-ci. Le delai zero
  // repasse derriere lui, sinon le focus retomberait sur la croix de fermeture.
  useEffect(() => {
    if (!open || done) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, done]);

  const trimmed = draft.trim();
  const parsed = trimmed === "" ? null : parseAmount(trimmed);
  const overflow = parsed !== null && currentCents + parsed > MAX_AMOUNT_CENTS;
  const valid = parsed !== null && parsed > 0 && !overflow;

  /**
   * Apercu du total, AFFICHAGE UNIQUEMENT.
   *
   * Cette somme ne part jamais au serveur et n'ecrit rien : c'est le lien visible
   * entre ce qu'elle tape et ce a quoi ca aboutit, montre avant de valider. Le
   * montant reellement enregistre est toujours celui que la base renvoie.
   */
  const previewCents = valid && parsed !== null ? currentCents + parsed : null;

  function hint(): string | null {
    if (trimmed === "") return null;
    if (parsed === null) return "Montant illisible. Tapez par exemple 100 ou 12,50.";
    if (parsed === 0) return "Tapez un montant plus grand que zéro.";
    if (overflow) {
      return "Avec cet ajout, cette ligne dépasserait 10 000 000 €. Corrigez plutôt le montant directement.";
    }
    return null;
  }

  const hintText = hint();

  function openSheet() {
    if (disabled) return;
    setDraft("");
    setRefusal(null);
    setDone(null);
    setOpen(true);
  }

  function closeSheet() {
    // Le surlignage de la ligne et le retour du focus attendent que la feuille soit
    // demontee : tant que le <dialog> modal est la, tout ce qui est derriere est inerte
    // et un `focus()` sur le bouton n'aboutirait pas.
    afterClose.current = { focus: true, flash: done !== null };
    setOpen(false);
  }

  useEffect(() => {
    if (open) return;
    const { focus, flash } = afterClose.current;
    if (!focus && !flash) return;
    afterClose.current = { focus: false, flash: false };

    // Le montant de la ligne vient de changer derriere la feuille. Un bref surlignage
    // au retour raccroche le geste a son resultat, plutot que de la laisser devant un
    // chiffre qui aurait bouge tout seul pendant qu'elle regardait ailleurs.
    const row = flash ? triggerRef.current?.closest("li") : null;
    // Repli, pas suppression : sans animation le montant est deja a jour a l'ecran.
    if (row && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      row.animate?.(
        [{ backgroundColor: "var(--color-positive-soft)" }, { backgroundColor: "transparent" }],
        { duration: 900, easing: "ease-out" },
      );
    }
    // Le focus revient au bouton d'ou elle est partie, pour l'usage clavier.
    if (focus) triggerRef.current?.focus();
  }, [open]);

  async function submit() {
    if (inFlight.current || !valid || parsed === null) return;
    inFlight.current = true;
    setSubmitting(true);
    setRefusal(null);
    const before = currentCents;

    try {
      const outcome = await onAdd(parsed);
      if (!outcome.ok) {
        // La feuille reste ouverte avec sa saisie : le refus se lit la ou le geste
        // a ete fait, et elle peut reessayer sans tout retaper.
        setRefusal(outcome.message);
        return;
      }
      setDone({ before, added: parsed, total: outcome.amountCents });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openSheet}
        disabled={disabled}
        className={cn(
          "tap flex shrink-0 items-center justify-center rounded-full",
          "border border-accent-ink/35 bg-raised text-accent-ink",
          "transition-colors duration-[180ms] ease-out disabled:opacity-50",
        )}
      >
        <Plus size={20} aria-hidden="true" />
        <span className="sr-only">Ajouter un montant à {label}</span>
      </button>

      {/* Montee a la demande : une trentaine de lignes a l'ecran, autant de <dialog>
          permanents dans le document ne serviraient a rien. */}
      {open ? (
        <Sheet
          open
          onClose={closeSheet}
          title={`Ajouter à ${label}`}
          description={
            done
              ? undefined
              : "Tapez seulement ce que vous ajoutez, l'application fait l'addition."
          }
        >
          {done ? (
            <div role="status" className="bud-fade-up">
              <p className="flex items-center gap-2 text-base font-semibold text-positive">
                <span className="bud-check-pop flex size-8 shrink-0 items-center justify-center rounded-full bg-positive-soft">
                  <Check size={20} aria-hidden="true" />
                </span>
                C&apos;est ajouté.
              </p>

              {/* L'operation entiere reste a l'ecran. Un montant qui change tout seul
                  sans montrer d'ou il vient est une source d'inquietude, pas de
                  confort (post-mortem du 2026-09-02). */}
              <p className="mt-3 text-lg text-ink">
                <span className="amount tabular-nums">{formatCents(done.before)}</span>
                {" + "}
                <span className="amount tabular-nums">{formatCents(done.added)}</span>
                {" = "}
                <span className="amount font-semibold tabular-nums">
                  {formatCents(done.total)}
                </span>
              </p>

              <p className="mt-2 text-sm text-ink-soft">
                {label} affiche maintenant {formatCents(done.total)}. Si ce n&apos;est pas
                le bon montant, touchez-le dans la liste pour le corriger.
              </p>

              <button
                type="button"
                onClick={closeSheet}
                className="tap mt-5 w-full rounded-sm bg-accent px-4 text-base font-semibold text-white"
              >
                Terminé
              </button>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <p className="text-base text-ink-soft">
                Déjà noté :{" "}
                <span className="amount font-medium text-ink tabular-nums">
                  {formatCents(currentCents)}
                </span>
              </p>

              <label htmlFor={fieldId} className="mt-4 block text-base font-medium text-ink">
                Montant à ajouter
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  ref={inputRef}
                  id={fieldId}
                  type="text"
                  // Le pave numerique d'Android, comme pour la saisie normale. La
                  // virgule francaise passe, le "+" n'est jamais demande a personne.
                  inputMode="decimal"
                  enterKeyHint="done"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-describedby={hintId}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (refusal) setRefusal(null);
                  }}
                  className={cn(
                    "amount tap w-full rounded-sm border bg-raised px-3 text-right",
                    "text-[20px] font-medium text-ink tabular-nums",
                    hintText ? "border-negative" : "border-accent-ink",
                  )}
                />
                <span aria-hidden="true" className="text-lg text-ink-soft">
                  €
                </span>
              </div>

              <p id={hintId} className="mt-2 text-sm text-negative empty:mt-0">
                {hintText}
              </p>

              {/* Le total avant validation : elle voit ou son ajout la mene, elle ne
                  le decouvre pas apres coup. */}
              <p className="mt-3 rounded-sm border border-line bg-surface px-3 py-2 text-base text-ink">
                {previewCents === null || parsed === null ? (
                  <span className="text-ink-soft">
                    Le nouveau total s&apos;affichera ici pendant que vous tapez.
                  </span>
                ) : (
                  <>
                    <span className="amount tabular-nums">{formatCents(currentCents)}</span>
                    {" + "}
                    <span className="amount tabular-nums">{formatCents(parsed)}</span>
                    {" = "}
                    <span className="amount font-semibold tabular-nums">
                      {formatCents(previewCents)}
                    </span>
                  </>
                )}
              </p>

              {refusal ? (
                <p role="alert" className="mt-3 rounded-sm border border-negative/40 bg-negative-soft px-3 py-2 text-sm text-ink">
                  {refusal}
                </p>
              ) : null}

              <div className="mt-5 flex gap-3">
                <button
                  type="submit"
                  disabled={!valid || submitting}
                  className="tap flex-1 rounded-sm bg-accent px-4 text-base font-semibold text-white disabled:opacity-50"
                >
                  {submitting
                    ? "Ajout en cours…"
                    : valid && parsed !== null
                      ? `Ajouter ${formatCents(parsed)}`
                      : "Ajouter"}
                </button>
                <button
                  type="button"
                  onClick={closeSheet}
                  disabled={submitting}
                  className="tap rounded-sm border border-line px-4 text-base font-medium text-ink disabled:opacity-50"
                >
                  Annuler
                </button>
              </div>
            </form>
          )}
        </Sheet>
      ) : null}
    </>
  );
}
