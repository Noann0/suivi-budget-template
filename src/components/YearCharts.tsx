"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { DonutChart, type DonutSlice } from "@/components/DonutChart";
import { cn } from "@/components/lib/cn";
import { MONTH_INITIALS, formatCents, formatCentsRounded, monthName } from "@/components/lib/format";
import { useElementWidth } from "@/components/lib/useElementWidth";
import type { ColorIntensity } from "@/lib/types";

export type YearPointView = {
  month: number;
  exists: boolean;
  incomeCents: number;
  expenseCents: number;
  remainingCents: number;
  openingBalanceCents: number;
  balanceCents: number;
  savingsCents: number;
  debtCents: number;
  cumulativeSavingsCents: number;
};

/** Une part du camembert de l'annee, telle que le serveur la rend. */
export type YearSliceView = {
  categoryId: string;
  name: string;
  hue: number;
  intensity: ColorIntensity | null;
  isArchived: boolean;
  amountCents: number;
};

type OpeningBalanceSliceView = {
  name: "Dette antérieure" | "Revenu antérieur";
  amountCents: number;
  source: { year: number; month: number };
};

type Props = {
  year: number;
  points: readonly YearPointView[];
  /**
   * Dernier mois qu'il est utile de proposer a remplir, de 1 a 12. Vaut 12 pour
   * une annee passee, le mois courant pour l'annee en cours, 0 pour une annee a
   * venir. Calcule sur le serveur et passe en prop : un `new Date()` ici
   * ferait diverger le rendu serveur du rendu client a chaque changement de
   * fuseau ou de minuit.
   */
  fillableThroughMonth: number;
  /** Deja triee decroissante par le serveur. On ne retrie pas. */
  expenseSlices: readonly YearSliceView[];
  /**
   * `totals.expenseCents`, jamais une somme des parts recalculee ici. Le serveur
   * garantit l'egalite ; la recalculer rouvrirait l'ecart d'un centime entre le
   * centre du camembert et les cartes chiffres (meme piege que `remaining` et
   * `unallocated`, post-mortem du 2026-09-02).
   */
  expenseTotalCents: number;
  /** Perimetre du bloc analyse, phrase construite sur le serveur. */
  scopeLabel: string;
  /** Cartes chiffres de l'annee, rendues sur le serveur et placees ici. */
  statsCards: ReactNode;
  /** Carte « Compléter {annee} », absente quand il ne manque aucun mois. */
  completionCard?: ReactNode;
  /** Dette anterieure, analytique et distincte des depenses reelles. */
  openingBalanceDebt: OpeningBalanceSliceView | null;
  /** Revenu anterieur, analytique et distinct des revenus reels. */
  openingBalanceIncome: OpeningBalanceSliceView | null;
  /** null tant que l'affichage serveur reste desactive. */
  openingBalanceStart: { year: number; month: number } | null;
};

const BARS_HEIGHT = 160;
const CURVE_HEIGHT = 140;
const FLOW_HEIGHT = 140;
const BAR_WIDTH = 14;
const AXIS_HEIGHT = 22;
/** Emplacement d'un mois a remplir : plus large qu'une barre, et centre sur le zero. */
const SLOT_WIDTH = BAR_WIDTH + 6;
const SLOT_HEIGHT = 48;
/** Batons apparies du bloc « Revenus et dépenses » : 8px chacun, 2px d'ecart. */
const FLOW_BAR = 8;
const FLOW_GAP = 2;
const FLOW_FLOOR = FLOW_HEIGHT - 8;
const FLOW_TOP = 8;

/**
 * Vue annuelle (plan, section 7, complete par design/PLAN-ANNEE-GRAPHES.md).
 *
 * Deux registres sur un meme ecran, separes par le titre « Où est passé
 * l'argent ». Au-dessus, le verdict : monochrome, vert et rouge, aucune teinte de
 * categorie. En dessous, l'analyse : camembert et batons, qui expliquent le
 * verdict sans le contaminer.
 *
 * Douze mois sur environ 360px : une colonne dispose de 27px. Les graphes empiles
 * partagent le meme axe X plutot qu'un double axe Y, illisible a cette densite. La
 * zone tactile d'un mois couvre toute la hauteur du graphe, ce qui la porte bien
 * au-dela du minimum de 24px du WCAG 2.2 en surface utile.
 *
 * Un mois `exists: false` n'est jamais dessine comme un zero : pas de barre, pas
 * de baton, la courbe s'interrompt et le sol des batons passe en pointille. Un
 * mois jamais cree et un mois rempli de zeros ne se ressemblent pas.
 *
 * Mais absent ne veut pas dire ferme : un mois vide encore remplissable recoit un
 * emplacement sable a bord pointille, centre sur la ligne du zero et strictement
 * symetrique. Une barre part du zero dans UNE direction ; une forme symetrique ne
 * porte donc aucune magnitude lisible, elle ne peut pas etre prise pour une valeur
 * ni pour un zero. Le bord pointille et le + au centre disent qu'il y a quelque
 * chose a y mettre. Une teinte seule aurait ete invisible (post-mortem du
 * 2026-08-30 sur les surfaces teintees) et une bande pleine hauteur ecrasait
 * visuellement les vrais mois quand un seul est rempli (rendu compare). Cette
 * invitation vit une seule fois, dans la carte « Mois de l'année » : la repeter
 * sous les batons ferait douze appels a l'action pour un seul geste.
 *
 * Ce composant porte aussi la mise en page de l'ecran, et c'est ce qui justifie
 * qu'il recoive des noeuds rendus sur le serveur : l'etat `selected` est partage
 * entre la carte des mois (colonne gauche sur ordinateur) et les batons (colonne
 * droite). Toucher aout ici surligne aout la-bas, dans les deux sens.
 */
export function YearCharts({
  year,
  points,
  fillableThroughMonth,
  expenseSlices,
  expenseTotalCents,
  scopeLabel,
  statsCards,
  completionCard,
  openingBalanceDebt,
  openingBalanceIncome,
  openingBalanceStart,
}: Props) {
  const [selected, setSelected] = useState<number | null>(null);

  const isFillable = (month: number) => month <= fillableThroughMonth;
  const toggle = (month: number) => setSelected(selected === month ? null : month);

  const donutSlices = useMemo<DonutSlice[]>(
    () =>
      expenseSlices.map((slice) => ({
        id: slice.categoryId,
        // Une categorie archivee garde sa part et sa teinte : elle a bien porte
        // cette depense, effacer la ligne rendrait l'annee passee infidele.
        label: slice.isArchived ? `${slice.name} (archivée)` : slice.name,
        hue: slice.hue,
        intensity: slice.intensity,
        amountCents: slice.amountCents,
      })),
    [expenseSlices],
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-8">
      {/* Colonne gauche sur ordinateur, tete de page sur telephone : le verdict. */}
      <div className="flex flex-col gap-5 lg:col-start-1 lg:row-start-1">
        {statsCards}
        <MonthsCard
          year={year}
          points={points}
          selected={selected}
          onToggle={toggle}
          isFillable={isFillable}
          openingBalanceStart={openingBalanceStart}
        />
      </div>

      {/* Colonne droite sur ordinateur, sous le verdict sur telephone : l'analyse.
          Le titre et la ligne de perimetre forment la frontiere entre les deux
          registres, c'est la que les teintes de categorie commencent. */}
      <div
        className={cn(
          "flex flex-col gap-5 lg:col-start-2 lg:row-start-1",
          // Sans carte « Compléter », la deuxieme ligne n'existe pas : la reserver
          // ajouterait une gouttiere fantome en bas de page.
          completionCard && "lg:row-span-2",
        )}
      >
        <header className="px-1 pt-1">
          <h2 className="font-display text-xl font-bold text-ink">Où est passé l&apos;argent</h2>
          <p className="mt-1 text-sm text-ink-soft">{scopeLabel}</p>
        </header>

        <DonutChart
          slices={donutSlices}
          totalCents={expenseTotalCents}
          centerLabel={`Dépenses ${year}`}
          srTitle="Répartition des dépenses de l'année"
          emptyMessage={`Aucune dépense saisie sur ${year} pour l'instant. Le camembert apparaîtra dès la première.`}
          openingBalance={
            openingBalanceDebt || openingBalanceIncome
              ? [
                  ...(openingBalanceDebt
                    ? [{ cents: -openingBalanceDebt.amountCents, label: openingBalanceDebt.name }]
                    : []),
                  ...(openingBalanceIncome
                    ? [{ cents: openingBalanceIncome.amountCents, label: openingBalanceIncome.name }]
                    : []),
                ]
              : []
          }
        />

        <FlowBarsCard
          points={points}
          selected={selected}
          onToggle={toggle}
          isFillable={isFillable}
        />
      </div>

      {completionCard ? (
        <div className="lg:col-start-1 lg:row-start-2">{completionCard}</div>
      ) : null}
    </div>
  );
}

type CardProps = {
  points: readonly YearPointView[];
  selected: number | null;
  onToggle: (month: number) => void;
  isFillable: (month: number) => boolean;
};

/**
 * Bloc 3 : reste par mois, epargne cumulee, et le detail du mois touche.
 * Monochrome sans exception : c'est la carte du verdict.
 */
function MonthsCard({
  year,
  points,
  selected,
  onToggle,
  isFillable,
  openingBalanceStart,
}: CardProps & {
  year: number;
  openingBalanceStart: { year: number; month: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const columnWidth = width / 12;

  const existing = useMemo(() => points.filter((point) => point.exists), [points]);

  const barsScale = useMemo(
    () => Math.max(1, ...existing.map((point) => Math.abs(point.remainingCents))),
    [existing],
  );

  const curveScale = useMemo(() => {
    const values = existing.map((point) => point.cumulativeSavingsCents);
    const max = Math.max(1, ...values, 0);
    const min = Math.min(0, ...values);
    return { max, min };
  }, [existing]);

  const zeroY = BARS_HEIGHT / 2;
  const selectedPoint = selected === null ? null : (points[selected - 1] ?? null);
  const showSelectedOpeningBalance =
    selectedPoint !== null && shouldShowOpeningBalance(openingBalanceStart, year, selectedPoint.month);

  const curvePoints = points.map((point, index) => {
    if (!point.exists) return null;
    const span = curveScale.max - curveScale.min || 1;
    const ratio = (point.cumulativeSavingsCents - curveScale.min) / span;
    return {
      month: point.month,
      x: columnWidth * index + columnWidth / 2,
      y: CURVE_HEIGHT - 8 - ratio * (CURVE_HEIGHT - 20),
    };
  });

  // Segments continus : la courbe se coupe sur chaque mois absent au lieu de
  // relier deux points de part et d'autre d'un trou.
  const runs: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const point of curvePoints) {
    if (point === null) {
      if (current.length > 0) runs.push(current);
      current = [];
    } else {
      current.push({ x: point.x, y: point.y });
    }
  }
  if (current.length > 0) runs.push(current);

  return (
    <section className="card px-2 py-4" aria-label="Mois de l'année">
      <div ref={containerRef} className="relative w-full">
        {/* Graphe A : reste par mois */}
        <h3 className="mb-1 px-2 text-base font-semibold text-ink">Reste par mois</h3>
        <svg
          width={width}
          height={BARS_HEIGHT}
          viewBox={`0 0 ${width} ${BARS_HEIGHT}`}
          aria-hidden="true"
          className="block"
        >
          {/* Emplacements a remplir, dessines sous la ligne du zero. */}
          {points.map((point, index) => {
            if (point.exists || !isFillable(point.month)) return null;
            const cx = columnWidth * index + columnWidth / 2;
            return (
              <rect
                key={`slot-${point.month}`}
                x={cx - SLOT_WIDTH / 2}
                y={zeroY - SLOT_HEIGHT / 2}
                width={SLOT_WIDTH}
                height={SLOT_HEIGHT}
                rx={SLOT_WIDTH / 2}
                fill="var(--color-carried)"
                stroke="var(--color-line)"
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={selected !== null && selected !== point.month ? 0.5 : 1}
                style={{ transition: "opacity 180ms ease-out" }}
              />
            );
          })}

          <line
            x1={0}
            y1={zeroY}
            x2={width}
            y2={zeroY}
            stroke="var(--color-line)"
            strokeWidth={1}
          />

          {/* Le + au centre de l'emplacement. Il couvre la ligne du zero a cet
              endroit : il n'y a pas de zero ici, il n'y a rien. */}
          {points.map((point, index) => {
            if (point.exists || !isFillable(point.month)) return null;
            const cx = columnWidth * index + columnWidth / 2;
            return (
              <g key={`plus-${point.month}`}>
                <circle cx={cx} cy={zeroY} r={11} fill="var(--color-carried)" />
                <line
                  x1={cx - 5}
                  y1={zeroY}
                  x2={cx + 5}
                  y2={zeroY}
                  stroke="var(--color-accent-ink)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                <line
                  x1={cx}
                  y1={zeroY - 5}
                  x2={cx}
                  y2={zeroY + 5}
                  stroke="var(--color-accent-ink)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </g>
            );
          })}

          {points.map((point, index) => {
            if (!point.exists) return null;
            const cx = columnWidth * index + columnWidth / 2;
            const height = (Math.abs(point.remainingCents) / barsScale) * (zeroY - 6);
            const positive = point.remainingCents >= 0;
            const dimmed = selected !== null && selected !== point.month;
            return (
              <rect
                key={point.month}
                x={cx - BAR_WIDTH / 2}
                y={positive ? zeroY - height : zeroY}
                width={BAR_WIDTH}
                height={Math.max(height, 1)}
                rx={2}
                fill={positive ? "var(--color-positive)" : "var(--color-negative)"}
                opacity={dimmed ? 0.35 : 1}
                style={{ transition: "opacity 180ms ease-out" }}
              />
            );
          })}
        </svg>

        <MonthAxis
          points={points}
          width={width}
          columnWidth={columnWidth}
          selected={selected}
          isFillable={isFillable}
        />

        {/* Graphe B : epargne cumulee */}
        <h3 className="mt-2 mb-1 px-2 text-base font-semibold text-ink">Épargne cumulée</h3>
        <svg
          width={width}
          height={CURVE_HEIGHT}
          viewBox={`0 0 ${width} ${CURVE_HEIGHT}`}
          aria-hidden="true"
          className="block"
        >
          {runs.map((run, runIndex) => {
            const first = run[0];
            const last = run[run.length - 1];
            if (!first || !last) return null;
            const line = run.map((p) => `${p.x},${p.y}`).join(" ");
            const area = `${first.x},${CURVE_HEIGHT} ${line} ${last.x},${CURVE_HEIGHT}`;
            return (
              <g key={runIndex}>
                <polygon points={area} fill="var(--color-positive)" opacity={0.12} />
                <polyline
                  points={line}
                  fill="none"
                  stroke="var(--color-positive)"
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            );
          })}
          {curvePoints.map((point) =>
            point === null ? null : (
              <circle
                key={point.month}
                cx={point.x}
                cy={point.y}
                r={selected === point.month ? 6 : 5}
                fill="var(--color-positive)"
                stroke="var(--color-surface)"
                strokeWidth={1.5}
              />
            ),
          )}
        </svg>

        <TouchColumns
          points={points}
          selected={selected}
          onToggle={onToggle}
          describe={(point) =>
            point.exists
              ? `, reste ${formatCents(point.remainingCents)}, épargné ${formatCents(point.savingsCents)}, remboursé ${formatCents(point.debtCents)}, épargne cumulée ${formatCents(point.cumulativeSavingsCents)}`
              : isFillable(point.month)
                ? ", pas encore rempli, à remplir quand vous voulez"
                : ", mois à venir"
          }
        />
      </div>

      <p className="mt-2 px-2 text-sm text-ink-soft">
        Les emplacements pointillés marqués d&apos;un + ne sont pas encore remplis. Ils
        sont absents des courbes, ils ne valent pas zéro. Touchez-en un pour l&apos;ouvrir.
      </p>

      <div aria-live="polite" className="mt-3 px-2">
        {selectedPoint === null ? (
          <p className="text-base text-ink-soft">Touchez un mois pour voir son détail.</p>
        ) : selectedPoint.exists ? (
          <div className="rounded-md border border-line bg-bg px-3 py-3">
            <p className="text-base text-ink">
              <span className="font-semibold capitalize">{monthName(selectedPoint.month)}</span> :{" "}
              {selectedPoint.remainingCents >= 0 ? "il reste" : "il manque"}{" "}
              <span className="amount tabular-nums">
                {formatCentsRounded(selectedPoint.remainingCents, { absolute: true })}
              </span>
              , revenus{" "}
              <span className="amount tabular-nums">
                {formatCentsRounded(selectedPoint.incomeCents)}
              </span>
              , dépenses{" "}
              <span className="amount tabular-nums">
                {formatCentsRounded(selectedPoint.expenseCents)}
              </span>
              , épargné{" "}
              <span className="amount tabular-nums">
                {formatCentsRounded(selectedPoint.savingsCents)}
              </span>
              , remboursé{" "}
              <span className="amount tabular-nums">
              {formatCentsRounded(selectedPoint.debtCents)}
              </span>
              .
            </p>
            {showSelectedOpeningBalance ? (
              <OpeningBalanceDetail cents={selectedPoint.openingBalanceCents} />
            ) : null}
            <Link
              href={`/mois/${year}/${selectedPoint.month}`}
              className="tap mt-2 inline-flex items-center text-base font-medium text-accent-ink underline underline-offset-4"
            >
              Voir {monthName(selectedPoint.month)}
            </Link>
          </div>
        ) : isFillable(selectedPoint.month) ? (
          <div className="rounded-md border border-line bg-carried px-3 py-3">
            <p className="text-base text-ink-soft">
              <span className="font-semibold text-ink capitalize">
                {monthName(selectedPoint.month)}
              </span>{" "}
              n&apos;est pas encore rempli. Il n&apos;y a rien à zéro, il n&apos;y a rien du
              tout. Vous pouvez le remplir maintenant, il rejoindra les graphiques.
            </p>
            <Link
              href={`/mois/${year}/${selectedPoint.month}`}
              className="tap mt-3 inline-flex items-center justify-center rounded-sm bg-accent px-5 text-base font-semibold text-white"
            >
              Remplir {monthName(selectedPoint.month)}
            </Link>
          </div>
        ) : (
          <div className="rounded-md border border-line bg-bg px-3 py-3">
            <p className="text-base text-ink-soft">
              <span className="font-semibold text-ink capitalize">
                {monthName(selectedPoint.month)}
              </span>{" "}
              n&apos;a pas encore commencé.
            </p>
            <Link
              href={`/mois/${year}/${selectedPoint.month}`}
              className="tap mt-2 inline-flex items-center text-base font-medium text-accent-ink underline underline-offset-4"
            >
              L&apos;ouvrir quand même
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

function shouldShowOpeningBalance(
  start: { year: number; month: number } | null,
  year: number,
  month: number,
): boolean {
  if (start === null) return false;
  return year > start.year || (year === start.year && month >= start.month);
}

function OpeningBalanceDetail({ cents }: { cents: number }) {
  const isDebt = cents < 0;
  return (
    <p className="mt-2 border-t border-line pt-2 text-sm text-ink-soft">
      Solde d&apos;ouverture :{" "}
      <span className={cn("amount font-semibold tabular-nums", isDebt ? "text-negative" : "text-positive")}>
        {isDebt ? "-" : "+"}
        {formatCentsRounded(cents, { absolute: true })}
      </span>
      {isDebt ? " de dette issue des mois précédents." : " de revenu issu des mois précédents."} Ce montant peut changer si un mois précédent est modifié.
    </p>
  );
}

/**
 * Bloc 6 : revenus et depenses par mois, deux batons apparies par mois existant.
 *
 * Revenus en vert, depenses en encre. Pas de rouge : sur cet ecran le rouge dit
 * « il manque », et depenser n'est pas un verdict. L'ecart des deux batons tient
 * par la luminance (L* 45 contre 13), il survit donc a la protanopie comme a la
 * deuteranopie, et la legende les nomme de toute facon.
 *
 * La ou il n'y a pas de donnee, il n'y a pas de sol : la ligne de base passe en
 * pointille sous un mois jamais cree, exactement comme la courbe d'epargne se
 * coupe. Un sol continu sous une colonne vide dirait « ce mois-la, zero ».
 */
function FlowBarsCard({ points, selected, onToggle, isFillable }: CardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const columnWidth = width / 12;

  // Echelle commune aux revenus et aux depenses : deux echelles separees
  // laisseraient croire qu'un petit revenu vaut une grosse depense.
  const scale = useMemo(() => {
    const values = points
      .filter((point) => point.exists)
      .flatMap((point) => [point.incomeCents, point.expenseCents]);
    return Math.max(1, ...values);
  }, [points]);

  const usable = FLOW_FLOOR - FLOW_TOP;
  const selectedPoint = selected === null ? null : (points[selected - 1] ?? null);

  const barHeight = (cents: number) => Math.max((Math.max(cents, 0) / scale) * usable, 1);

  return (
    <section className="card px-2 py-4" aria-label="Revenus et dépenses par mois">
      <h3 className="mb-1 px-2 text-base font-semibold text-ink">Revenus et dépenses par mois</h3>

      <ul className="mb-2 flex items-center gap-4 px-2 text-sm text-ink-soft">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block size-3 rounded-xs bg-positive" />
          Revenus
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block size-3 rounded-xs bg-ink" />
          Dépenses
        </li>
      </ul>

      <div ref={containerRef} className="relative w-full">
        <svg
          width={width}
          height={FLOW_HEIGHT}
          viewBox={`0 0 ${width} ${FLOW_HEIGHT}`}
          aria-hidden="true"
          className="block"
        >
          {/* Le sol, segment par segment : plein sous un mois rempli, pointille
              sous un mois qui n'existe pas. */}
          {points.map((point, index) => (
            <line
              key={`floor-${point.month}`}
              x1={columnWidth * index}
              y1={FLOW_FLOOR}
              x2={columnWidth * (index + 1)}
              y2={FLOW_FLOOR}
              stroke="var(--color-line)"
              strokeWidth={1}
              strokeDasharray={point.exists ? undefined : "4 4"}
            />
          ))}

          {points.map((point, index) => {
            if (!point.exists) return null;
            const cx = columnWidth * index + columnWidth / 2;
            const dimmed = selected !== null && selected !== point.month;
            const incomeHeight = barHeight(point.incomeCents);
            const expenseHeight = barHeight(point.expenseCents);
            return (
              <g
                key={point.month}
                opacity={dimmed ? 0.35 : 1}
                style={{ transition: "opacity 180ms ease-out" }}
              >
                <rect
                  x={cx - FLOW_BAR - FLOW_GAP / 2}
                  y={FLOW_FLOOR - incomeHeight}
                  width={FLOW_BAR}
                  height={incomeHeight}
                  rx={2}
                  fill="var(--color-positive)"
                />
                <rect
                  x={cx + FLOW_GAP / 2}
                  y={FLOW_FLOOR - expenseHeight}
                  width={FLOW_BAR}
                  height={expenseHeight}
                  rx={2}
                  fill="var(--color-ink)"
                />
              </g>
            );
          })}
        </svg>

        <MonthAxis
          points={points}
          width={width}
          columnWidth={columnWidth}
          selected={selected}
          isFillable={isFillable}
          promiseAction={false}
        />

        <TouchColumns
          points={points}
          selected={selected}
          onToggle={onToggle}
          describe={(point) =>
            point.exists
              ? `, revenus ${formatCents(point.incomeCents)}, dépenses ${formatCents(point.expenseCents)}`
              : ", pas encore rempli"
          }
        />
      </div>

      {/* Pas de aria-live ici : la phrase du bloc 3 (partage le meme `selected`)
          annonce deja revenus et depenses. Un second aria-live sur le meme geste
          ferait entendre deux annonces successives pour une seule information. */}
      <div className="mt-3 px-2">
        {selectedPoint === null ? (
          <p className="text-base text-ink-soft">Touchez un mois pour voir ses montants.</p>
        ) : selectedPoint.exists ? (
          <p className="text-base text-ink">
            <span className="font-semibold capitalize">{monthName(selectedPoint.month)}</span> :
            revenus{" "}
            <span className="amount tabular-nums">
              {formatCentsRounded(selectedPoint.incomeCents)}
            </span>
            , dépenses{" "}
            <span className="amount tabular-nums">
              {formatCentsRounded(selectedPoint.expenseCents)}
            </span>
            .
          </p>
        ) : (
          <p className="text-base text-ink-soft">
            <span className="font-semibold text-ink capitalize">
              {monthName(selectedPoint.month)}
            </span>{" "}
            n&apos;est pas encore rempli.
          </p>
        )}
      </div>

      <p className="mt-2 px-2 text-sm text-ink-soft">
        Les mois non remplis n&apos;ont ni bâtons ni sol : ils ne valent pas zéro.
      </p>
    </section>
  );
}

/**
 * Axe des initiales, partage par les graphes a douze colonnes.
 *
 * Une initiale a 40 % d'opacite tombait sous le seuil de lisibilite : un mois vide
 * encore ouvert porte donc la couleur des liens, un mois a venir garde l'encre
 * douce. Aucune initiale n'est effacee, sinon le trou d'un mois absent se lirait
 * comme « ce mois-la, il ne restait rien ». Cette couleur de lien n'est due que la
 * ou une porte existe vraiment (bloc 3, qui offre "Remplir") : le bloc 6 n'a aucune
 * action sur un mois vide, `promiseAction={false}` y ramene l'invite a l'encre douce.
 */
function MonthAxis({
  points,
  width,
  columnWidth,
  selected,
  isFillable,
  promiseAction = true,
}: {
  points: readonly YearPointView[];
  width: number;
  columnWidth: number;
  selected: number | null;
  isFillable: (month: number) => boolean;
  promiseAction?: boolean;
}) {
  return (
    <svg
      width={width}
      height={AXIS_HEIGHT}
      viewBox={`0 0 ${width} ${AXIS_HEIGHT}`}
      aria-hidden="true"
      className="block"
    >
      {MONTH_INITIALS.map((initial, index) => {
        const month = index + 1;
        const filled = points[index]?.exists === true;
        const invite = promiseAction && !filled && isFillable(month);
        const isSelected = selected === month;
        return (
          <text
            key={`${initial}-${index}`}
            x={columnWidth * index + columnWidth / 2}
            y={15}
            textAnchor="middle"
            fontSize={12}
            fill={
              isSelected
                ? "var(--color-ink)"
                : invite
                  ? "var(--color-accent-ink)"
                  : "var(--color-ink-soft)"
            }
            fontWeight={isSelected ? 700 : invite ? 600 : 400}
          >
            {initial}
          </text>
        );
      })}
    </svg>
  );
}

/**
 * Douze colonnes tactiles superposees a un graphe, pleine hauteur du conteneur.
 * Vingt-sept pixels de large, mais toute la hauteur : la surface utile depasse
 * largement le minimum de 24px du WCAG 2.2.
 */
function TouchColumns({
  points,
  selected,
  onToggle,
  describe,
}: {
  points: readonly YearPointView[];
  selected: number | null;
  onToggle: (month: number) => void;
  describe: (point: YearPointView) => string;
}) {
  return (
    <div className="absolute inset-0 flex">
      {points.map((point) => (
        <button
          key={point.month}
          type="button"
          onClick={() => onToggle(point.month)}
          aria-pressed={selected === point.month}
          className={cn("h-full flex-1 rounded-sm", selected === point.month && "bg-ink/[0.04]")}
        >
          <span className="sr-only">
            {monthName(point.month)}
            {describe(point)}
          </span>
        </button>
      ))}
    </div>
  );
}
