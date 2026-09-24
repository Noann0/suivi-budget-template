"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";

import { AddToAmount, type AddOutcome } from "@/components/AddToAmount";
import { AmountInput } from "@/components/AmountInput";
import { CarryOverBanner } from "@/components/CarryOverBanner";
import { CarryOverRecovery } from "@/components/CarryOverRecovery";
import { DeleteMonthCard } from "@/components/DeleteMonthCard";
import { CategoryAccordion, type LineState } from "@/components/CategoryAccordion";
import { DonutChart, type DonutSlice } from "@/components/DonutChart";
import { MonthHero } from "@/components/MonthHero";
import { Pastille } from "@/components/ui/Pastille";
import { cn } from "@/components/lib/cn";
import { useActionError } from "@/components/lib/useActionError";
import { formatCents, monthName } from "@/components/lib/format";
import {
  addToAllocation,
  createAllocation,
  deleteAllocation,
  updateAllocation,
} from "@/actions/allocations";
import { addToEntry, confirmCarriedEntries, upsertEntry } from "@/actions/entries";
import type { Allocation, MonthTotals, MonthView } from "@/lib/types";

type Props = {
  month: MonthView;
  /** null tant que l'affichage serveur reste desactive. Montant calcule par le serveur. */
  openingBalanceCents: number | null;
  /** Nom du mois d'ou viennent les reports, du type "juillet". */
  previousMonthName: string;
  /**
   * Faux quand le mois precedent n'existe pas : il n'y a alors rien a reprendre, et
   * proposer le geste ne menerait qu'a une erreur. On n'affiche pas un bouton dont on
   * sait deja qu'il echouera.
   */
  canCarryOver: boolean;
};

/**
 * Ecran du mois en cours. Elle l'ouvrira 95 % du temps.
 *
 * Les totaux ne sont JAMAIS recalcules ici. Chaque action serveur renvoie les
 * totaux recalcules, on se contente de les remplacer dans l'etat : une seule source
 * de verite, et pas d'aller-retour supplementaire apres chaque saisie.
 */
export function MonthBoard({
  month,
  openingBalanceCents,
  previousMonthName,
  canCarryOver,
}: Props) {
  const [totals, setTotals] = useState<MonthTotals>(month.totals);
  const [allocations, setAllocations] = useState<Allocation[]>(month.allocations);
  const [lines, setLines] = useState<Record<string, LineState>>(() => initialLines(month));
  /**
   * Les lignes telles que le SERVEUR les connait, a la derniere reponse recue.
   *
   * C'est la seule chose vers laquelle on puisse revenir quand un enregistrement
   * echoue. Revenir a l'etat du chargement de la page serait faux des qu'une reponse
   * a modifie les lignes depuis : apres une reprise du mois precedent, une saisie
   * ratee effacerait a l'ecran les vingt-deux lignes que le serveur vient pourtant
   * d'ecrire.
   *
   * Initialisee avec l'etat de depart des lignes, qui est justement ce que le serveur
   * a envoye. `useRef` ignore son argument des le second rendu : on lui passe la
   * valeur deja calculee plutot que de refaire `initialLines` a chaque rendu.
   */
  const serverLines = useRef<Record<string, LineState>>(lines);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [confirming, startConfirming] = useTransition();
  const resolveError = useActionError();

  const carriedCount = useMemo(
    () => Object.values(lines).filter((line) => line.carried).length,
    [lines],
  );

  const lineCounts = useMemo(() => {
    const values = Object.values(lines);
    return {
      total: values.length,
      filled: values.filter((line) => line.amountCents !== null).length,
    };
  }, [lines]);

  /**
   * Faut-il proposer de reprendre le mois precedent ?
   *
   * Trois conditions, et chacune retire un cas ou le bouton serait du bruit :
   * - le mois precedent existe, sinon il n'y a rien a reprendre ;
   * - aucune ligne n'est en attente de confirmation, sinon le report vient d'etre
   *   fait et le bandeau au-dessus le dit deja ;
   * - le mois est encore vide, ou a peine commence, c'est a dire moins d'un tiers de
   *   ses lignes remplies. Un mois deja rempli et confirme n'a que faire de l'offre.
   *
   * Le seuil n'est pas zero, volontairement : elle tape son salaire, puis realise que
   * tout le reste est vide. A zero, le recours aurait disparu au premier montant saisi,
   * exactement au moment ou elle en a besoin.
   */
  const offerCarryOver =
    canCarryOver &&
    carriedCount === 0 &&
    (lineCounts.filled === 0 || lineCounts.filled * 3 < lineCounts.total);

  const applyCarryOver = useCallback((view: MonthView) => {
    // La reponse porte la vue complete : lignes, allocations et totaux recalcules.
    // Rien n'est reconstruit ici, on remplace l'etat par ce que le serveur affirme.
    const next = initialLines(view);
    serverLines.current = next;
    setTotals(view.totals);
    setAllocations(view.allocations);
    setLines(next);
  }, []);

  const markPending = useCallback((id: string, pending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const commitEntry = useCallback(
    (subcategoryId: string, amountCents: number) => {
      setError(null);
      markPending(subcategoryId, true);
      // Optimiste sur la ligne seule : le montant vient d'elle, il ne peut pas
      // surprendre. Les totaux, eux, attendent la reponse du serveur.
      setLines((current) => ({
        ...current,
        [subcategoryId]: { amountCents, carried: false },
      }));

      void (async () => {
        const result = await upsertEntry({ monthId: month.id, subcategoryId, amountCents });
        markPending(subcategoryId, false);
        if (!result.ok) {
          setError(resolveError(result.error));
          // On remet la ligne telle que le serveur la connait encore.
          setLines((current) => ({
            ...current,
            [subcategoryId]: serverLines.current[subcategoryId] ?? {
              amountCents: null,
              carried: false,
            },
          }));
          return;
        }
        serverLines.current = {
          ...serverLines.current,
          [subcategoryId]: { amountCents, carried: false },
        };
        setTotals(result.data.totals);
      })();
    },
    [month, markPending, resolveError],
  );

  /**
   * Ajoute un montant a une ligne, revenu ou depense.
   *
   * Rien d'optimiste ici, a la difference de `commitEntry` : le nouveau montant n'est
   * pas connu avant la reponse, puisque c'est la base qui additionne. On envoie le
   * DELTA seul et on ecrit ce que le serveur affirme. Additionner ici partirait d'un
   * etat local deja ecrit sans confirmation : deux ajouts rapproches liraient la meme
   * base et le second effacerait le premier.
   *
   * Le refus n'alimente pas le bandeau du haut : il repart vers la feuille de saisie,
   * qui est ouverte devant elle. Un message laisse en haut de l'ecran survivrait au
   * geste suivant, reussi celui-la, et raconterait une panne qui n'existe plus.
   */
  const addToLine = useCallback(
    async (subcategoryId: string, deltaCents: number): Promise<AddOutcome> => {
      setError(null);
      markPending(subcategoryId, true);
      const result = await addToEntry({ monthId: month.id, subcategoryId, deltaCents });
      markPending(subcategoryId, false);

      if (!result.ok) return { ok: false, message: resolveError(result.error) };

      const amountCents = result.data.entry.amountCents;
      // Un ajout confirme la ligne reportee, cote base comme a l'ecran.
      const next: LineState = { amountCents, carried: false };
      serverLines.current = { ...serverLines.current, [subcategoryId]: next };
      setLines((current) => ({ ...current, [subcategoryId]: next }));
      setTotals(result.data.totals);
      return { ok: true, amountCents };
    },
    [month.id, markPending, resolveError],
  );

  const confirmAll = useCallback(() => {
    setError(null);
    startConfirming(async () => {
      const result = await confirmCarriedEntries({ monthId: month.id });
      if (!result.ok) {
        setError(resolveError(result.error));
        return;
      }
      setLines((current) => {
        const next: Record<string, LineState> = {};
        for (const [id, line] of Object.entries(current)) {
          next[id] = line.carried ? { ...line, carried: false } : line;
        }
        // Le serveur vient d'acter la confirmation : la reference de repli doit la
        // connaitre, sinon une saisie ratee plus tard rendrait a la ligne son badge
        // « reporté » alors qu'elle est confirmee en base.
        serverLines.current = next;
        return next;
      });
    });
  }, [month.id, resolveError]);

  const focusFirstCarried = useCallback(() => {
    const target = document.querySelector<HTMLElement>('[data-carried="true"]');
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.animate?.(
      [{ backgroundColor: "var(--color-positive-soft)" }, { backgroundColor: "transparent" }],
      { duration: 900, easing: "ease-out" },
    );
  }, []);

  const slices = useMemo<DonutSlice[]>(
    () =>
      month.expense.map((block) => ({
        id: block.category.id,
        label: block.category.name,
        hue: block.category.hue,
        amountCents: sumBlock(block.lines.map((line) => lines[line.subcategory.id])),
      })),
    [month.expense, lines],
  );

  const heaviestExpense = useMemo(() => {
    let best: { name: string; amountCents: number } | null = null;
    for (const slice of slices) {
      if (slice.amountCents <= 0) continue;
      if (!best || slice.amountCents > best.amountCents) {
        best = { name: slice.label, amountCents: slice.amountCents };
      }
    }
    return best;
  }, [slices]);

  // Aucun mois n'a encore la moindre saisie : on ouvre les categories, sinon elle
  // ouvre l'ecran sur une liste de titres fermes sans savoir ou taper.
  const monthIsUntouched = lineCounts.filled === 0;

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <p role="alert" className="rounded-md border border-negative/40 bg-negative-soft px-4 py-3 text-base text-ink">
          {error}
        </p>
      ) : null}

      <CarryOverBanner
        previousMonthName={previousMonthName}
        carriedCount={carriedCount}
        pending={confirming}
        onConfirmAll={confirmAll}
      />

      {/* Le rattrapage se place en tete, avant le verdict : sur un mois vide, le
          grand chiffre n'a rien a dire, alors que reprendre le mois precedent est la
          seule chose utile a faire. Des qu'elle a rempli, l'offre s'efface d'elle-meme
          et le verdict reprend sa place. */}
      <CarryOverRecovery
        year={month.year}
        month={month.month}
        previousMonthName={previousMonthName}
        eligible={offerCarryOver}
        onCarried={applyCarryOver}
      />

      {/* Sur telephone : hero, camembert, puis la saisie, dans cet ordre.
          Sur ordinateur : la saisie occupe la colonne large a gauche, le verdict et
          le camembert tiennent dans une colonne collante a droite, visibles en
          permanence pendant qu'elle remplit. Meme DOM, deux vraies mises en page. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-8">
        <aside className="order-1 flex flex-col gap-5 lg:order-none lg:col-start-2 lg:row-start-1 lg:sticky lg:top-24">
          <MonthHero
            totals={totals}
            monthKey={`${month.year}-${String(month.month).padStart(2, "0")}`}
            carriedCount={carriedCount}
            heaviestExpense={heaviestExpense}
            onFocusFirstCarried={focusFirstCarried}
          />

          <DonutChart
            slices={slices}
            totalCents={totals.expenseCents}
            centerLabel="Dépenses du mois"
            openingBalance={
              openingBalanceCents === null
                ? null
                : { cents: openingBalanceCents, label: "Solde d'ouverture" }
            }
          />
        </aside>

        <div className="order-2 flex flex-col gap-5 lg:order-none lg:col-start-1 lg:row-start-1">
      <section aria-labelledby="income-title" className="card px-3 py-3">
        <header className="flex items-baseline justify-between gap-3 px-1 pb-2">
          <h2 id="income-title" className="font-display text-lg font-semibold text-ink">
            Revenus
          </h2>
          <span className="amount text-lg font-semibold text-ink tabular-nums">
            {formatCents(totals.incomeCents)}
          </span>
        </header>

        {month.income.map((block) => (
          <div key={block.category.id} className="mb-2 last:mb-0">
            {month.income.length > 1 ? (
              <h3 className="flex items-center gap-2 px-1 py-1 text-sm text-ink-soft">
                <Pastille hue={block.category.hue} intensity={block.category.intensity} />
                {block.category.name}
              </h3>
            ) : null}
            <ul className="flex flex-col">
              {block.lines.map((line) => {
                const state = lines[line.subcategory.id] ?? { amountCents: null, carried: false };
                return (
                  <li
                    key={line.subcategory.id}
                    data-line-id={line.subcategory.id}
                    data-carried={state.carried ? "true" : undefined}
                    className={cn(
                      "flex items-center gap-2 border-b border-line/60 px-1 last:border-b-0",
                      "transition-colors duration-[180ms] ease-out",
                      state.carried && "bg-carried",
                    )}
                  >
                    <span className="min-w-0 flex-1 py-2">
                      <span className="block truncate text-base text-ink">
                        {line.subcategory.name}
                      </span>
                      {state.carried ? (
                        <span className="mt-0.5 inline-block rounded-full border border-line px-2 py-px text-xs text-ink-soft">
                          reporté
                        </span>
                      ) : null}
                    </span>
                    <AmountInput
                      valueCents={state.amountCents}
                      carried={state.carried}
                      pending={pendingIds.has(line.subcategory.id)}
                      label={`Montant de ${line.subcategory.name}`}
                      onCommit={(cents) => commitEntry(line.subcategory.id, cents)}
                    />
                    {/* Meme regle que sur les depenses : une colonne unique de largeur
                        fixe, « Garder » d'abord tant que la ligne est reportee, le "+"
                        ensuite, rien a ajouter sur une ligne encore vide. Le verbe a
                        remplace une coche seule, voir CategoryAccordion. */}
                    <span className="flex w-[4.5rem] shrink-0 justify-end">
                      {state.carried && state.amountCents !== null ? (
                        <button
                          type="button"
                          onClick={() => commitEntry(line.subcategory.id, state.amountCents ?? 0)}
                          disabled={pendingIds.has(line.subcategory.id)}
                          className="tap flex items-center justify-center rounded-sm border border-positive/40 bg-positive-soft px-2 text-sm font-semibold text-positive disabled:opacity-50"
                        >
                          Garder
                          <span className="sr-only">
                            {" "}
                            {formatCents(state.amountCents)} pour {line.subcategory.name}.
                            Enregistré tout de suite.
                          </span>
                        </button>
                      ) : state.amountCents !== null && state.amountCents > 0 ? (
                        <AddToAmount
                          currentCents={state.amountCents}
                          label={line.subcategory.name}
                          disabled={pendingIds.has(line.subcategory.id)}
                          onAdd={(deltaCents) => addToLine(line.subcategory.id, deltaCents)}
                        />
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <p className="mt-2 px-1 text-sm text-ink-soft">
          Pour ajouter ou renommer une ligne de revenu, passez par les Réglages. Vos
          lignes y restent d&apos;un mois sur l&apos;autre.
        </p>
      </section>

      <section aria-labelledby="expense-title" className="card px-3 py-3">
        <header className="flex items-baseline justify-between gap-3 px-1 pb-2">
          <h2 id="expense-title" className="font-display text-lg font-semibold text-ink">
            Dépenses
          </h2>
          <span className="amount text-lg font-semibold text-ink tabular-nums">
            {formatCents(totals.expenseCents)}
          </span>
        </header>

        <div>
          {month.expense.map((block) => (
            <CategoryAccordion
              key={block.category.id}
              block={block}
              lines={lines}
              subtotalCents={sumBlock(block.lines.map((line) => lines[line.subcategory.id]))}
              pendingIds={pendingIds}
              onCommit={commitEntry}
              onConfirm={commitEntry}
              onAdd={addToLine}
              defaultOpen={
                monthIsUntouched ||
                block.lines.some((line) => lines[line.subcategory.id]?.carried === true)
              }
            />
          ))}
        </div>
      </section>

      <AllocationsSection
        monthId={month.id}
        allocations={allocations}
        totals={totals}
        onChange={(next, nextTotals) => {
          setAllocations(next);
          if (nextTotals) setTotals(nextTotals);
        }}
        onError={setError}
      />

      <p className="px-1 text-sm text-ink-soft">
        Mois de {monthName(month.month)} {month.year}. Tout est enregistré au fur et à mesure.
      </p>

      <DeleteMonthCard
        year={month.year}
        month={month.month}
        totals={totals}
        filledLines={lineCounts.filled}
        allocationCount={allocations.length}
      />
        </div>
      </div>
    </div>
  );
}

/**
 * La phrase sous le titre "Ce que vous mettez de côté".
 *
 * `unallocatedCents` vaut `remaining - savings - debt`. Une seule valeur negative y
 * recouvre DEUX situations opposees, et les confondre produisait un mensonge :
 *
 * - elle a affecte plus que son reste. Le reproche est fonde.
 * - le mois etait deja negatif avant toute affectation. Elle n'a rien mis de cote,
 *   et l'application lui reprochait pourtant une épargne impossible. C'est faux,
 *   et ca doublait le hero qui disait deja
 *   correctement "Il manque".
 *
 * On separe donc par ce qu'elle a REELLEMENT affecte, pas par le signe du solde.
 */
function AllocationsNote({ totals }: { totals: MonthTotals }) {
  const allocatedCents = totals.savingsCents + totals.debtCents;
  const monthIsNegative = totals.remainingCents < 0;

  // Rien d'affecte : cette carte n'a aucun reproche a formuler. Si le mois est dans
  // le rouge, le hero le dit deja, le repeter ici ne l'aiderait pas.
  if (allocatedCents === 0) {
    return (
      <p className="mt-1 text-sm text-ink-soft">
        {monthIsNegative
          ? "Rien n'est mis de côté ce mois-ci."
          : `Il reste ${formatCents(totals.remainingCents)} à répartir, si vous le souhaitez.`}
      </p>
    );
  }

  if (totals.unallocatedCents >= 0) {
    return (
      <p className="mt-1 text-sm text-ink-soft">
        Il reste {formatCents(totals.unallocatedCents)} non affecté.
      </p>
    );
  }

  // Sur-affecter est un choix legitime, pas une erreur de saisie : elle a le droit
  // d'entamer autre chose. On l'informe, on ne la bloque pas, et on n'emploie ni
  // role="alert" ni le vocabulaire de la panne.
  return (
    <p className="mt-2 rounded-sm border border-negative/30 bg-negative-soft px-3 py-2 text-sm text-ink">
      {monthIsNegative ? (
        <>
          Ce mois-ci il manque déjà{" "}
          <span className="amount tabular-nums">
            {formatCents(totals.remainingCents, { absolute: true })}
          </span>
          , et vous mettez{" "}
          <span className="amount tabular-nums">{formatCents(allocatedCents)}</span> de
          côté en plus. Il faudra prendre{" "}
          <span className="amount tabular-nums">
            {formatCents(totals.unallocatedCents, { absolute: true })}
          </span>{" "}
          ailleurs.
        </>
      ) : (
        <>
          Vous mettez de côté{" "}
          <span className="amount tabular-nums">
            {formatCents(totals.unallocatedCents, { absolute: true })}
          </span>{" "}
          de plus qu&apos;il ne vous reste ce mois-ci. C&apos;est possible, mais il
          faudra prendre la différence ailleurs.
        </>
      )}
    </p>
  );
}

function AllocationsSection({
  monthId,
  allocations,
  totals,
  onChange,
  onError,
}: {
  monthId: string;
  allocations: readonly Allocation[];
  totals: MonthTotals;
  onChange: (next: Allocation[], totals: MonthTotals | null) => void;
  onError: (message: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();

  const resolveError = useActionError();

  const add = (kind: "savings" | "debt") => {
    onError(null);
    startTransition(async () => {
      const result = await createAllocation({
        monthId,
        kind,
        amountCents: 0,
        label: kind === "savings" ? "Épargne" : "Remboursement",
      });
      if (!result.ok) {
        onError(resolveError(result.error));
        return;
      }
      onChange([...allocations, result.data.allocation], result.data.totals);
    });
  };

  const update = (id: string, amountCents: number) => {
    onError(null);
    startTransition(async () => {
      const result = await updateAllocation({ id, amountCents });
      if (!result.ok) {
        onError(resolveError(result.error));
        return;
      }
      onChange(
        allocations.map((item) => (item.id === id ? result.data.allocation : item)),
        result.data.totals,
      );
    });
  };

  /**
   * Ajoute a une mise de cote : 50 EUR epargnes en debut de mois, puis 30 de plus.
   *
   * Volontairement hors `startTransition`, contrairement aux autres ecritures de cette
   * section : `pending` desactive tous les champs de la carte, ce qui n'a pas de sens
   * pendant qu'une feuille de saisie est ouverte par-dessus, avec son propre etat
   * d'attente et son propre bouton a griser.
   */
  const addAmount = async (id: string, deltaCents: number): Promise<AddOutcome> => {
    onError(null);
    const result = await addToAllocation({ id, deltaCents });
    if (!result.ok) return { ok: false, message: resolveError(result.error) };

    onChange(
      allocations.map((item) => (item.id === id ? result.data.allocation : item)),
      result.data.totals,
    );
    return { ok: true, amountCents: result.data.allocation.amountCents };
  };

  const remove = (id: string) => {
    onError(null);
    startTransition(async () => {
      const result = await deleteAllocation({ id });
      if (!result.ok) {
        onError(resolveError(result.error));
        return;
      }
      onChange(
        allocations.filter((item) => item.id !== id),
        result.data.totals,
      );
    });
  };

  return (
    <section aria-labelledby="alloc-title" className="card px-3 py-3">
      <header className="px-1 pb-2">
        <h2 id="alloc-title" className="font-display text-lg font-semibold text-ink">
          Ce que vous mettez de côté
        </h2>
        <AllocationsNote totals={totals} />
      </header>

      <ul className="flex flex-col">
        {allocations.map((allocation) => (
          <li
            key={allocation.id}
            className="flex items-center gap-2 border-b border-line/60 px-1 last:border-b-0"
          >
            <span className="min-w-0 flex-1 py-2">
              <span className="block truncate text-base text-ink">{allocation.label}</span>
              <span className="text-sm text-ink-soft">
                {allocation.kind === "savings" ? "épargne" : "remboursement"}
              </span>
            </span>
            <AmountInput
              valueCents={allocation.amountCents}
              label={`Montant de ${allocation.label}`}
              disabled={pending}
              onCommit={(cents) => update(allocation.id, cents)}
            />
            {/* Une mise de cote s'alimente en plusieurs fois elle aussi. A zero, il n'y
                a rien a quoi ajouter : le montant se saisit directement, et la place
                reste reservee pour que les colonnes ne dansent pas d'une ligne a
                l'autre. */}
            {allocation.amountCents > 0 ? (
              <AddToAmount
                currentCents={allocation.amountCents}
                label={allocation.label}
                disabled={pending}
                onAdd={(deltaCents) => addAmount(allocation.id, deltaCents)}
              />
            ) : (
              <span aria-hidden="true" className="w-11 shrink-0" />
            )}
            <button
              type="button"
              onClick={() => remove(allocation.id)}
              disabled={pending}
              className="tap flex shrink-0 items-center justify-center rounded-sm text-ink-soft disabled:opacity-50"
            >
              <Trash2 size={18} aria-hidden="true" />
              <span className="sr-only">Retirer {allocation.label}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => add("savings")}
          disabled={pending}
          className="tap flex items-center gap-2 rounded-sm px-2 text-base font-medium text-accent-ink disabled:opacity-50"
        >
          <Plus size={18} aria-hidden="true" />
          Ajouter une épargne
        </button>
        <button
          type="button"
          onClick={() => add("debt")}
          disabled={pending}
          className="tap flex items-center gap-2 rounded-sm px-2 text-base font-medium text-accent-ink disabled:opacity-50"
        >
          <Plus size={18} aria-hidden="true" />
          Ajouter un remboursement
        </button>
      </div>
    </section>
  );
}

/** Etat initial des lignes, tel que le serveur le decrit. */
function initialLines(month: MonthView): Record<string, LineState> {
  const lines: Record<string, LineState> = {};
  for (const block of [...month.income, ...month.expense]) {
    for (const line of block.lines) {
      lines[line.subcategory.id] = {
        // entry a null veut dire "jamais saisi", ce qui n'est pas zero.
        amountCents: line.entry === null ? null : line.amountCents,
        carried: line.entry?.isCarried ?? false,
      };
    }
  }
  return lines;
}

/**
 * Sous-total d'un bloc a partir de l'etat local.
 *
 * Ce n'est PAS un recalcul de total metier : les totaux du mois viennent du
 * serveur et ne sont jamais reconstruits ici. Cette somme sert uniquement a
 * l'affichage d'un sous-total de categorie entre deux reponses serveur, sur des
 * entiers de centimes, sans flottant.
 */
function sumBlock(states: readonly (LineState | undefined)[]): number {
  let total = 0;
  for (const state of states) {
    if (state?.amountCents) total += state.amountCents;
  }
  return total;
}
