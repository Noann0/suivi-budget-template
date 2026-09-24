"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Pastille } from "@/components/ui/Pastille";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/components/lib/cn";
import { formatCents } from "@/components/lib/format";
import { useActionError } from "@/components/lib/useActionError";
import { getCarryOverPreview } from "@/actions/months";
import type {
  CarryOverEntryCandidate,
  CarryOverPreview,
  ColorIntensity,
  Hue,
} from "@/lib/types";

/** Ce qui part au serveur. Les deux listes sont independantes, voir `lib/types.ts`. */
export type CarryOverSelection = {
  subcategoryIds: string[];
  allocationIds: string[];
};

/**
 * Reponse du parent apres l'ecriture.
 *
 * Le succes ne rend pas la main : la feuille reste verrouillee et le parent decide de
 * la suite, rafraichissement complet de l'ecran ou remplacement en place. C'est la
 * regle posee le 2026-09-02 : aucun controle ne doit redevenir actif tant que ce qu'il
 * affiche n'est pas garanti.
 */
export type CarryOverSubmitOutcome = { ok: true } | { ok: false; message: string | null };

type Props = {
  /**
   * Mois CIBLE, celui qu'elle ouvre. Le mois source en est deduit par le serveur,
   * passage d'annee compris. Il n'a pas besoin d'exister.
   */
  year: number;
  month: number;
  /** Nom du mois d'ou viennent les montants, du type "juillet". */
  previousMonthName: string;
  onClose: () => void;
  /** Ecrit reellement. Le parent choisit l'action : creation ou rattrapage. */
  onSubmit: (selection: CarryOverSelection) => Promise<CarryOverSubmitOutcome>;
  /**
   * Sortie proposee quand il n'y a rien a reprendre. Sans elle, la feuille n'offrirait
   * que « Fermer », ce qui laisse devant un mois qui n'existe toujours pas.
   */
  emptyExit?: { label: string; onClick: () => void };
};

type Status = "loading" | "ready" | "failed";

type EntryGroup = {
  categoryId: string;
  categoryName: string;
  hue: Hue;
  intensity: ColorIntensity | null;
  lines: CarryOverEntryCandidate[];
};

/**
 * Choix des lignes reprises d'un mois sur l'autre.
 *
 * Le defaut qu'on ferme ici, dans ses mots a elle : « j'ai reussi a selectionner mais
 * je ne peux pas valider ». Aucune selection multiple n'existait. Ce qu'elle prenait
 * pour une selection, c'etaient les boutons de confirmation ligne par ligne, qui
 * enregistrent chacun immediatement. L'interface promettait donc un geste qu'elle
 * n'offrait pas, et la reprise restait binaire : tout, ou rien.
 *
 * Deux regles gouvernent cet ecran, et elles sont opposees a celles du reste de
 * l'application :
 *
 * 1. Une case a cocher n'ecrit RIEN. Tout attend le bouton du bas. C'est dit en toutes
 *    lettres en haut de la feuille, parce que partout ailleurs ici, toucher enregistre.
 * 2. Tout est coche a l'ouverture. Decocher trois lignes est plus court que d'en cocher
 *    dix-huit, et valider sans rien toucher redonne exactement le comportement d'avant.
 *
 * Le compte et les montants du bas se mettent a jour a chaque case : elle raisonne en
 * euros, pas en lignes, et doit voir ou sa selection la mene avant de valider, jamais
 * apres (post-mortem du 2026-09-02 sur le lien saisie / resultat).
 */
export function CarryOverPicker({
  year,
  month,
  previousMonthName,
  onClose,
  onSubmit,
  emptyExit,
}: Props) {
  const resolveError = useActionError();

  const [status, setStatus] = useState<Status>("loading");
  const [preview, setPreview] = useState<CarryOverPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Incremente par « Reessayer ». Relance l'effet de lecture sans remonter la feuille. */
  const [attempt, setAttempt] = useState(0);

  const [selectedEntries, setSelectedEntries] = useState<ReadonlySet<string>>(new Set());
  const [selectedAllocations, setSelectedAllocations] = useState<ReadonlySet<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /**
   * Verrou de double soumission. Un state ne suffit pas : deux appuis rapproches
   * atteignent le gestionnaire avant le rendu qui desactive le bouton. Meme motif que
   * dans `AddToAmount`.
   */
  const inFlight = useRef(false);

  // Le retour a « chargement » se fait dans le gestionnaire de « Réessayer », pas ici :
  // un setState synchrone dans le corps d'un effet declenche un rendu en cascade, et la
  // regle react-hooks/set-state-in-effect le refuse. L'etat de depart est deja
  // « loading », l'effet n'a donc rien a remettre a zero.
  useEffect(() => {
    let alive = true;

    void (async () => {
      const result = await getCarryOverPreview({ year, month });
      if (!alive) return;

      if (!result.ok) {
        // `resolveError` rend null quand la session est perdue : l'ecran part alors
        // vers la porte d'entree et il n'y a plus rien a afficher ici.
        setLoadError(resolveError(result.error));
        setStatus("failed");
        return;
      }

      // Tout coche, sauf ce qui est deja dans le mois cible : cocher une ligne qui ne
      // bougera pas ferait mentir le compteur et le total du bas.
      setPreview(result.data);
      setSelectedEntries(
        new Set(
          result.data.entries
            .filter((line) => !line.alreadyInTarget)
            .map((line) => line.subcategoryId),
        ),
      );
      setSelectedAllocations(
        new Set(
          result.data.allocations
            .filter((allocation) => !allocation.alreadyInTarget)
            .map((allocation) => allocation.id),
        ),
      );
      setStatus("ready");
    })();

    return () => {
      alive = false;
    };
  }, [year, month, attempt, resolveError]);

  /** Lignes reellement actionnables. Celles deja presentes sont comptees a part. */
  const entryList = useMemo(
    () => (preview?.entries ?? []).filter((line) => !line.alreadyInTarget),
    [preview],
  );
  const allocationList = useMemo(
    () => (preview?.allocations ?? []).filter((allocation) => !allocation.alreadyInTarget),
    [preview],
  );
  /**
   * Ce qui est deja dans le mois cible, compte a part et en DEUX nombres.
   *
   * Ces candidats ne figurent pas dans la liste a cocher : une ligne deja presente est
   * laissee telle quelle quoi qu'il arrive, la cocher ferait mentir le compteur et le
   * total. Elle doit savoir qu'ils existent, sans avoir a se demander pourquoi une case
   * ne change rien.
   *
   * Lignes et mises de côté ne s'additionnent pas : « 24 » ne se verifie nulle part a
   * l'ecran, « 22 lignes et 2 mises de côté » se verifie d'un coup d'oeil.
   */
  const alreadyThere = useMemo(
    () => ({
      entries: (preview?.entries ?? []).filter((line) => line.alreadyInTarget).length,
      allocations: (preview?.allocations ?? []).filter(
        (allocation) => allocation.alreadyInTarget,
      ).length,
    }),
    [preview],
  );

  const incomeGroups = useMemo(() => groupByCategory(entryList, "income"), [entryList]);
  const expenseGroups = useMemo(() => groupByCategory(entryList, "expense"), [entryList]);

  /**
   * Ce que la selection represente, en euros.
   *
   * Revenus et depenses sont comptes SEPAREMENT et ne sont jamais additionnes. Leur
   * somme ne veut rien dire : un total repris melangerait un salaire et un loyer.
   * Meme regle que partout ailleurs dans ce depot, une valeur affichee ne doit recouvrir
   * qu'une seule chose.
   */
  const chosen = useMemo(() => {
    let incomeCents = 0;
    let expenseCents = 0;
    let lines = 0;
    for (const line of entryList) {
      if (!selectedEntries.has(line.subcategoryId)) continue;
      lines += 1;
      if (line.categoryKind === "income") incomeCents += line.amountCents;
      else expenseCents += line.amountCents;
    }

    let savingsCents = 0;
    let debtCents = 0;
    let allocations = 0;
    for (const allocation of allocationList) {
      if (!selectedAllocations.has(allocation.id)) continue;
      allocations += 1;
      if (allocation.kind === "savings") savingsCents += allocation.amountCents;
      else debtCents += allocation.amountCents;
    }

    return { lines, incomeCents, expenseCents, allocations, savingsCents, debtCents };
  }, [entryList, allocationList, selectedEntries, selectedAllocations]);

  const toggleEntry = useCallback((subcategoryId: string) => {
    setSubmitError(null);
    setSelectedEntries((current) => {
      const next = new Set(current);
      if (next.has(subcategoryId)) next.delete(subcategoryId);
      else next.add(subcategoryId);
      return next;
    });
  }, []);

  const toggleAllocation = useCallback((id: string) => {
    setSubmitError(null);
    setSelectedAllocations((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSubmitError(null);
    setSelectedEntries(new Set(entryList.map((line) => line.subcategoryId)));
    setSelectedAllocations(new Set(allocationList.map((allocation) => allocation.id)));
  }, [entryList, allocationList]);

  const selectNone = useCallback(() => {
    setSubmitError(null);
    setSelectedEntries(new Set());
    setSelectedAllocations(new Set());
  }, []);

  const retry = useCallback(() => {
    setStatus("loading");
    setLoadError(null);
    setAttempt((value) => value + 1);
  }, []);

  const nothingChosen = chosen.lines === 0 && chosen.allocations === 0;

  const submit = useCallback(async () => {
    if (inFlight.current || nothingChosen) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);

    // L'ordre d'affichage est conserve : la liste envoyee se relit telle qu'elle a ete
    // cochee a l'ecran, ce qui rend un diagnostic possible si une reprise surprend.
    const selection: CarryOverSelection = {
      subcategoryIds: entryList
        .filter((line) => selectedEntries.has(line.subcategoryId))
        .map((line) => line.subcategoryId),
      allocationIds: allocationList
        .filter((allocation) => selectedAllocations.has(allocation.id))
        .map((allocation) => allocation.id),
    };

    try {
      const outcome = await onSubmit(selection);
      if (outcome.ok) return; // Verrouille : le parent prend la main.
      setSubmitError(outcome.message);
    } catch {
      setSubmitError("Quelque chose n'a pas fonctionné. Réessayez dans un instant.");
    }
    inFlight.current = false;
    setSubmitting(false);
  }, [
    nothingChosen,
    entryList,
    allocationList,
    selectedEntries,
    selectedAllocations,
    onSubmit,
  ]);

  const totalCandidates = entryList.length + allocationList.length;
  const chosenCount = chosen.lines + chosen.allocations;

  return (
    <Sheet open onClose={submitting ? () => undefined : onClose} title={`Que reprendre de ${previousMonthName} ?`}>
      {status === "loading" ? (
        <p role="status" className="py-6 text-center text-base text-ink-soft">
          Lecture de {previousMonthName}…
        </p>
      ) : null}

      {status === "failed" ? (
        <div>
          <p role="alert" className="rounded-sm border border-negative/40 bg-negative-soft px-3 py-2 text-base text-ink">
            {loadError ?? "La liste n'a pas pu être lue."}
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={retry}
              className="tap flex-1 rounded-sm bg-accent px-4 text-base font-semibold text-white"
            >
              Réessayer
            </button>
            <button
              type="button"
              onClick={onClose}
              className="tap rounded-sm border border-line px-4 text-base font-medium text-ink"
            >
              Fermer
            </button>
          </div>
        </div>
      ) : null}

      {status === "ready" && totalCandidates === 0 ? (
        <div>
          <p className="text-base text-ink">
            {emptyMessage(
              preview,
              alreadyThere.entries + alreadyThere.allocations,
              previousMonthName,
            )}
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            {emptyExit ? (
              <button
                type="button"
                onClick={emptyExit.onClick}
                className="tap rounded-sm bg-accent px-5 text-base font-semibold text-white"
              >
                {emptyExit.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="tap rounded-sm border border-line px-5 text-base font-medium text-ink"
            >
              Fermer
            </button>
          </div>
        </div>
      ) : null}

      {status === "ready" && totalCandidates > 0 ? (
        <div>
          {/* La regle d'or de cet ecran, dite avant la liste. Partout ailleurs dans
              l'application, toucher enregistre. Ici, non : il fallait le dire, et pas
              en petit. */}
          {/* La phrase suit l'etat reel. « Tout est coché » laisse en place apres trois
              decochages deviendrait faux, et une consigne fausse est pire qu'absente. */}
          <p className="text-base text-ink">
            {chosenCount === totalCandidates
              ? "Tout est coché. Décochez ce que vous ne voulez pas reprendre."
              : "Cochez ou décochez ce que vous voulez reprendre."}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            Cocher ou décocher n&apos;enregistre rien. Rien ne part tant que vous
            n&apos;avez pas touché le bouton en bas.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={selectAll}
              disabled={submitting || chosenCount === totalCandidates}
              className="tap rounded-sm border border-line bg-surface px-3 text-sm font-medium text-ink disabled:opacity-50"
            >
              Tout cocher
            </button>
            <button
              type="button"
              onClick={selectNone}
              disabled={submitting || chosenCount === 0}
              className="tap rounded-sm border border-line bg-surface px-3 text-sm font-medium text-ink disabled:opacity-50"
            >
              Tout décocher
            </button>
          </div>

          {alreadyThere.entries + alreadyThere.allocations > 0 ? (
            <p className="mt-3 rounded-sm border border-line bg-carried px-3 py-2 text-sm text-ink-soft">
              {alreadyThereMessage(alreadyThere)}
            </p>
          ) : null}

          <EntrySection
            title="Revenus"
            groups={incomeGroups}
            selected={selectedEntries}
            disabled={submitting}
            onToggle={toggleEntry}
          />
          <EntrySection
            title="Dépenses"
            groups={expenseGroups}
            selected={selectedEntries}
            disabled={submitting}
            onToggle={toggleEntry}
          />

          {allocationList.length > 0 ? (
            <section className="mt-5">
              <h3 className="font-display text-base font-semibold text-ink">
                Ce que vous mettez de côté
              </h3>
              <ul className="mt-1 flex flex-col">
                {allocationList.map((allocation) => (
                  <CheckRow
                    key={allocation.id}
                    id={`alloc-${allocation.id}`}
                    name={allocation.label}
                    hint={allocation.kind === "savings" ? "épargne" : "remboursement"}
                    amountCents={allocation.amountCents}
                    checked={selectedAllocations.has(allocation.id)}
                    disabled={submitting}
                    onToggle={() => toggleAllocation(allocation.id)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {submitError ? (
            <p
              role="alert"
              className="mt-4 rounded-sm border border-negative/40 bg-negative-soft px-3 py-2 text-base text-ink"
            >
              {submitError}
            </p>
          ) : null}

          {/* Le compte rendu colle au bas de la feuille : sur vingt-deux lignes, il
              serait sinon deux ecrans plus bas au moment ou elle decoche. */}
          <div className="sticky bottom-0 -mx-4 -mb-4 mt-4 border-t border-line bg-raised px-4 pt-3 pb-4">
            {/* Deux compteurs, jamais un seul. Une mise de côté n'est pas une ligne de
                budget : les confondre dans un « 20 sur 24 » donnerait un nombre
                invérifiable a l'ecran. */}
            <p className="text-base text-ink">
              {chosenCount === 0 ? (
                <span className="text-ink-soft">Rien de coché pour l&apos;instant.</span>
              ) : (
                <>
                  <strong className="font-semibold">
                    {chosen.lines} {chosen.lines === 1 ? "ligne" : "lignes"} sur{" "}
                    {entryList.length}
                  </strong>{" "}
                  {chosen.lines === 1 ? "reprise" : "reprises"}
                  {allocationList.length > 0 ? (
                    <>
                      , et{" "}
                      <strong className="font-semibold">
                        {chosen.allocations}{" "}
                        {chosen.allocations === 1 ? "mise de côté" : "mises de côté"} sur{" "}
                        {allocationList.length}
                      </strong>
                    </>
                  ) : null}
                  .
                </>
              )}
            </p>

            {/* Revenus et depenses restent separes : leur somme ne designerait rien.
                Une nature absente du mois source ne s'affiche pas non plus a 0,00 € :
                ce zero se lirait comme « aucun revenu repris » alors qu'il n'y avait
                aucun revenu a reprendre. */}
            <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-ink-soft">
              {incomeGroups.length > 0 ? (
                <span>
                  Revenus{" "}
                  <span className="amount font-medium text-ink tabular-nums">
                    {formatCents(chosen.incomeCents)}
                  </span>
                </span>
              ) : null}
              {expenseGroups.length > 0 ? (
                <span>
                  Dépenses{" "}
                  <span className="amount font-medium text-ink tabular-nums">
                    {formatCents(chosen.expenseCents)}
                  </span>
                </span>
              ) : null}
              {allocationList.length > 0 ? (
                <span>
                  De côté{" "}
                  <span className="amount font-medium text-ink tabular-nums">
                    {formatCents(chosen.savingsCents + chosen.debtCents)}
                  </span>
                </span>
              ) : null}
            </p>

            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting || nothingChosen}
                className={cn(
                  "tap flex-1 rounded-sm bg-accent px-4 text-base font-semibold text-white",
                  "transition-opacity duration-150 disabled:opacity-50",
                )}
              >
                {/* Le bouton ne recompte rien : des que des mises de côté entrent dans
                    la selection, un nombre unique contredirait les deux compteurs
                    affiches juste au-dessus. Il dit alors ce qu'il fait, pas combien. */}
                {submitting
                  ? "Un instant…"
                  : nothingChosen
                    ? "Cochez au moins une ligne"
                    : chosen.allocations > 0
                      ? "Reprendre ce qui est coché"
                      : `Reprendre ${chosen.lines === 1 ? "cette ligne" : `ces ${chosen.lines} lignes`}`}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="tap rounded-sm border border-line px-4 text-base font-medium text-ink disabled:opacity-50"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

function EntrySection({
  title,
  groups,
  selected,
  disabled,
  onToggle,
}: {
  title: string;
  groups: readonly EntryGroup[];
  selected: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (subcategoryId: string) => void;
}) {
  if (groups.length === 0) return null;

  return (
    <section className="mt-5">
      <h3 className="font-display text-base font-semibold text-ink">{title}</h3>

      {groups.map((group) => (
        <div key={group.categoryId} className="mt-1">
          {/* Un seul groupe dans la section : le titre de section suffit, repeter le
              nom de categorie juste en dessous n'apporte rien. */}
          {groups.length > 1 ? (
            <h4 className="flex items-center gap-2 px-1 pt-2 text-sm text-ink-soft">
              <Pastille hue={group.hue} intensity={group.intensity} />
              {group.categoryName}
            </h4>
          ) : null}
          <ul className="flex flex-col">
            {group.lines.map((line) => (
              <CheckRow
                key={line.subcategoryId}
                id={`line-${line.subcategoryId}`}
                name={line.subcategoryName}
                amountCents={line.amountCents}
                checked={selected.has(line.subcategoryId)}
                disabled={disabled}
                onToggle={() => onToggle(line.subcategoryId)}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * Une ligne a cocher.
 *
 * Vraie case a cocher native dans un <label> : le navigateur donne la barre d'espace,
 * la navigation clavier et l'annonce d'etat sans une ligne de JavaScript. Toute la
 * ligne est cliquable, et `tap` lui garantit les 44px du plan, cible confortable sur
 * telephone. La forme carree la distingue a vue des boutons ronds de l'ecran du mois,
 * qui eux enregistrent.
 */
function CheckRow({
  id,
  name,
  hint,
  amountCents,
  checked,
  disabled,
  onToggle,
}: {
  id: string;
  name: string;
  hint?: string;
  amountCents: number;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="border-b border-line/60 last:border-b-0">
      <label htmlFor={id} className="tap flex cursor-pointer items-center gap-3 px-1">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          className="size-6 shrink-0 accent-accent"
        />
        {/* L'attenuation porte sur le TEXTE seul, jamais sur la case.
            Mesure : encre #2a2118 sur #fffdf8 tombe a 4.23:1 a 60 % d'opacite, sous le
            seuil AA de 4.5 pour du texte courant ; a 70 % elle tient 5.8:1. Et attenuer
            la case elle-meme ferait passer son contour sous les 3:1 exiges d'un
            composant d'interface, alors que c'est justement le repere a lire. */}
        <span
          className={cn(
            "min-w-0 flex-1 py-2 transition-opacity duration-[180ms] ease-out",
            !checked && "opacity-70",
          )}
        >
          <span className="block truncate text-base text-ink">{name}</span>
          {hint ? <span className="block text-xs text-ink-soft">{hint}</span> : null}
        </span>
        <span
          className={cn(
            "amount shrink-0 text-[17px] font-medium text-ink tabular-nums",
            "transition-opacity duration-[180ms] ease-out",
            !checked && "opacity-70",
          )}
        >
          {formatCents(amountCents)}
        </span>
      </label>
    </li>
  );
}

/** Regroupe les candidats par categorie, dans l'ordre ou le serveur les a rendus. */
function groupByCategory(
  lines: readonly CarryOverEntryCandidate[],
  kind: "income" | "expense",
): EntryGroup[] {
  const groups: EntryGroup[] = [];
  const index = new Map<string, EntryGroup>();

  for (const line of lines) {
    if (line.categoryKind !== kind) continue;
    let group = index.get(line.categoryId);
    if (!group) {
      group = {
        categoryId: line.categoryId,
        categoryName: line.categoryName,
        hue: line.categoryHue,
        intensity: line.categoryIntensity,
        lines: [],
      };
      index.set(line.categoryId, group);
      groups.push(group);
    }
    group.lines.push(line);
  }

  return groups;
}

/**
 * Ce qui est deja en place, dit sans le compter comme un choix possible.
 *
 * Ces candidats sont absents de la liste a cocher : `alreadyInTarget` signifie que le
 * mois cible les porte deja, et la reprise les laisse intacts. Les afficher cochables
 * promettrait un effet qui n'aura pas lieu ; les taire laisserait un ecart inexplique
 * entre ce qu'elle voit dans juillet et ce que la feuille lui propose.
 */
function alreadyThereMessage(counts: { entries: number; allocations: number }): string {
  const parts: string[] = [];
  if (counts.entries > 0) {
    parts.push(counts.entries === 1 ? "1 ligne" : `${counts.entries} lignes`);
  }
  if (counts.allocations > 0) {
    parts.push(
      counts.allocations === 1 ? "1 mise de côté" : `${counts.allocations} mises de côté`,
    );
  }

  const subject = parts.join(" et ");
  const plural = counts.entries + counts.allocations > 1;
  return (
    `${subject} ${plural ? "sont déjà" : "est déjà"} dans ce mois : ` +
    `${plural ? "elles n'apparaissent" : "elle n'apparaît"} pas ici et ` +
    `${plural ? "ne seront pas touchées" : "ne sera pas touchée"}.`
  );
}

/**
 * Le vide a trois causes distinctes, et les confondre enverrait au mauvais endroit.
 *
 * Le mois precedent n'existe pas : rien n'a jamais pu etre repris. Il existe mais il
 * est vide : elle ne l'a pas rempli. Tout est deja la : c'est une bonne nouvelle, et
 * ca ne s'ecrit pas comme une panne.
 */
function emptyMessage(
  preview: CarryOverPreview | null,
  alreadyThere: number,
  previousMonthName: string,
): string {
  if (!preview || preview.source === null) {
    return `Il n'y a pas encore de mois de ${previousMonthName} à recopier.`;
  }
  if (alreadyThere > 0) {
    return `Tout ce qui vient de ${previousMonthName} est déjà dans ce mois. Il n'y a rien à ajouter.`;
  }
  return `Le mois de ${previousMonthName} ne contient aucun montant. Il n'y a rien à reprendre.`;
}
