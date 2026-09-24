"use server";

import { revalidatePath } from "next/cache";

import { isValidAmountCents } from "@/lib/money";
import { notFound, validation, type ActionResult } from "@/lib/result";
import type { Allocation, AllocationKind, MonthTotals } from "@/lib/types";
import { withSession } from "@/server/action-helpers";
import {
  addToAllocation as addToAllocationRow,
  deleteAllocation as deleteAllocationRow,
  findAllocation,
  findMonthById,
  insertAllocation,
  listAllocations as listAllocationRows,
  updateAllocation as updateAllocationRow,
} from "@/server/repositories/months";
import { reloadTotals } from "@/server/services/months";

const MAX_LABEL_LENGTH = 60;

function cleanLabel(raw: unknown): string {
  if (typeof raw !== "string") throw validation("Le libellé est obligatoire.", "label");
  const label = raw.trim();
  if (label.length === 0) throw validation("Le libellé ne peut pas être vide.", "label");
  return label.slice(0, MAX_LABEL_LENGTH);
}

function assertAmount(value: unknown): number {
  if (!isValidAmountCents(value)) {
    throw validation(
      `Le montant doit être positif et ne peut pas dépasser 10 000 000 €.`,
      "amountCents",
    );
  }
  return value;
}

/** Meme regle que pour les entrees : un ajout va dans un seul sens, et jamais a zero. */
function assertDelta(value: unknown): number {
  if (!isValidAmountCents(value) || value === 0) {
    throw validation(
      `Le montant à ajouter doit être supérieur à zéro et ne peut pas dépasser 10 000 000 €.`,
      "deltaCents",
    );
  }
  return value;
}

export async function listAllocations(input: {
  monthId: string;
}): Promise<ActionResult<Allocation[]>> {
  return withSession(({ userId }) => {
    if (!findMonthById(userId, input.monthId)) throw notFound("Ce mois n'existe pas.");
    return listAllocationRows(input.monthId);
  });
}

export async function createAllocation(input: {
  monthId: string;
  kind: AllocationKind;
  amountCents: number;
  label: string;
}): Promise<ActionResult<{ allocation: Allocation; totals: MonthTotals }>> {
  return withSession(({ userId }) => {
    const monthRow = findMonthById(userId, input.monthId);
    if (!monthRow) throw notFound("Ce mois n'existe pas.");
    if (input.kind !== "savings" && input.kind !== "debt") {
      throw validation("Le type doit être une épargne ou un remboursement.", "kind");
    }

    const allocation = insertAllocation({
      monthId: input.monthId,
      kind: input.kind,
      amountCents: assertAmount(input.amountCents),
      label: cleanLabel(input.label),
    });

    revalidatePath("/");
    return { allocation, totals: reloadTotals(userId, monthRow) };
  });
}

export async function updateAllocation(input: {
  id: string;
  amountCents?: number;
  label?: string;
}): Promise<ActionResult<{ allocation: Allocation; totals: MonthTotals }>> {
  return withSession(({ userId }) => {
    const existing = findAllocation(userId, input.id);
    if (!existing) throw notFound("Cette ligne n'existe pas.");

    const monthRow = findMonthById(userId, existing.monthId);
    if (!monthRow) throw notFound("Ce mois n'existe pas.");

    updateAllocationRow(input.id, {
      ...(input.amountCents === undefined ? {} : { amountCents: assertAmount(input.amountCents) }),
      ...(input.label === undefined ? {} : { label: cleanLabel(input.label) }),
    });

    const updated = findAllocation(userId, input.id);
    if (!updated) throw notFound("Cette ligne n'existe pas.");

    revalidatePath("/");
    return { allocation: updated, totals: reloadTotals(userId, monthRow) };
  });
}

/**
 * Ajoute un montant a une allocation existante : 50 EUR mis de cote en debut de mois,
 * puis 30 de plus, sans refaire l'addition de tete. Meme geste que sur une ligne de
 * depense, meme raison de le faire cote base.
 *
 * L'addition est faite par SQLite, dans le meme UPDATE que la lecture, pour la meme
 * raison que sur les entrees : l'ecran ecrit son etat de maniere optimiste, deux
 * ajouts rapproches partiraient sinon de la meme valeur.
 *
 * Deliberement une action distincte de celle des entrees plutot qu'une abstraction
 * commune : les deux tables n'ont pas les memes contraintes. `entries` porte un UNIQUE
 * sur lequel un upsert s'appuie et peut donc creer la ligne manquante ; `allocations`
 * n'en a aucun, la ligne visee doit exister et se designe par son identifiant. Ranger
 * les deux sous une meme fonction obligerait a repartir les cas a l'interieur, ce qui
 * couterait plus cher a lire que cette repetition.
 */
export async function addToAllocation(input: {
  id: string;
  deltaCents: number;
}): Promise<ActionResult<{ allocation: Allocation; totals: MonthTotals }>> {
  return withSession(({ userId }) => {
    const existing = findAllocation(userId, input.id);
    if (!existing) throw notFound("Cette ligne n'existe pas.");

    const monthRow = findMonthById(userId, existing.monthId);
    if (!monthRow) throw notFound("Ce mois n'existe pas.");

    const changes = addToAllocationRow(input.id, assertDelta(input.deltaCents));

    const updated = findAllocation(userId, input.id);
    if (!updated) throw notFound("Cette ligne n'existe pas.");
    // Zero ligne touchee alors que la ligne est toujours la : le WHERE a refuse la
    // borne haute avant d'ecrire. C'est la relecture qui tranche, pas une deduction :
    // une suppression survenue entre-temps donnerait le meme zero et un message faux.
    if (changes === 0) {
      throw validation(
        `Cette addition dépasserait 10 000 000 €. Corrigez le montant de la ligne directement.`,
        "amountCents",
      );
    }

    revalidatePath("/");
    return { allocation: updated, totals: reloadTotals(userId, monthRow) };
  });
}

export async function deleteAllocation(input: {
  id: string;
}): Promise<ActionResult<{ totals: MonthTotals }>> {
  return withSession(({ userId }) => {
    const existing = findAllocation(userId, input.id);
    if (!existing) throw notFound("Cette ligne n'existe pas.");

    const monthRow = findMonthById(userId, existing.monthId);
    if (!monthRow) throw notFound("Ce mois n'existe pas.");

    deleteAllocationRow(input.id);
    revalidatePath("/");
    return { totals: reloadTotals(userId, monthRow) };
  });
}
