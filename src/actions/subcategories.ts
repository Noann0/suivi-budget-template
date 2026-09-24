"use server";

import { revalidatePath } from "next/cache";

import { transaction } from "@/db/client";
import { conflict, notFound, validation, type ActionResult } from "@/lib/result";
import type { Subcategory } from "@/lib/types";
import { withSession } from "@/server/action-helpers";
import {
  archiveSubcategory as archiveSubcategoryRow,
  findCategory,
  findSubcategory,
  insertSubcategory,
  listSubcategoriesForCategory,
  nextSubcategorySortOrder,
  setSubcategorySortOrder,
  subcategoryNameExists,
  updateSubcategoryName,
} from "@/server/repositories/categories";

const MAX_NAME_LENGTH = 60;

function cleanName(raw: unknown): string {
  if (typeof raw !== "string") throw validation("Le nom est obligatoire.", "name");
  const name = raw.trim();
  if (name.length === 0) throw validation("Le nom ne peut pas être vide.", "name");
  if (name.length > MAX_NAME_LENGTH) {
    throw validation(`Le nom ne doit pas dépasser ${MAX_NAME_LENGTH} caractères.`, "name");
  }
  return name;
}

export async function createSubcategory(input: {
  categoryId: string;
  name: string;
}): Promise<ActionResult<Subcategory>> {
  return withSession(({ userId }) => {
    const name = cleanName(input.name);
    if (!findCategory(userId, input.categoryId)) {
      throw notFound("Cette catégorie n'existe pas.");
    }
    if (subcategoryNameExists(input.categoryId, name)) {
      throw conflict("Une sous-catégorie porte déjà ce nom.");
    }
    revalidatePath("/");
    return insertSubcategory({
      categoryId: input.categoryId,
      name,
      sortOrder: nextSubcategorySortOrder(input.categoryId),
    });
  });
}

export async function updateSubcategory(input: {
  id: string;
  name: string;
}): Promise<ActionResult<Subcategory>> {
  return withSession(({ userId }) => {
    const existing = findSubcategory(userId, input.id);
    if (!existing) throw notFound("Cette sous-catégorie n'existe pas.");

    const name = cleanName(input.name);
    if (subcategoryNameExists(existing.categoryId, name, existing.id)) {
      throw conflict("Une sous-catégorie porte déjà ce nom.");
    }

    updateSubcategoryName(input.id, name);
    revalidatePath("/");
    return { ...existing, name };
  });
}

/** Archive plutot que supprimer : les mois passes gardent leur ligne et son libelle. */
export async function archiveSubcategory(input: {
  id: string;
}): Promise<ActionResult<{ ok: true }>> {
  return withSession(({ userId }) => {
    if (!findSubcategory(userId, input.id)) throw notFound("Cette sous-catégorie n'existe pas.");
    archiveSubcategoryRow(input.id, true);
    revalidatePath("/");
    return { ok: true } as const;
  });
}

export async function restoreSubcategory(input: {
  id: string;
}): Promise<ActionResult<{ ok: true }>> {
  return withSession(({ userId }) => {
    const existing = findSubcategory(userId, input.id);
    if (!existing) throw notFound("Cette sous-catégorie n'existe pas.");

    // Restaurer une sous-categorie dans une categorie archivee la rendrait invisible :
    // on previent plutot que de laisser l'utilisatrice croire que rien ne s'est passe.
    const parent = findCategory(userId, existing.categoryId);
    if (parent?.isArchived) {
      throw conflict("Restaurez d'abord la catégorie parente, elle est archivée.");
    }

    archiveSubcategoryRow(input.id, false);
    revalidatePath("/");
    return { ok: true } as const;
  });
}

export async function reorderSubcategories(input: {
  categoryId: string;
  ids: string[];
}): Promise<ActionResult<{ ok: true }>> {
  return withSession(({ userId }) => {
    if (!Array.isArray(input.ids)) throw validation("La liste des éléments à réordonner est invalide.", "ids");
    if (!findCategory(userId, input.categoryId)) throw notFound("Cette catégorie n'existe pas.");

    // Filtre par categorie plutot que par budget : la categorie vient d'etre
    // verifiee comme appartenant a l'utilisatrice, et elle porte deja son budget.
    const active = listSubcategoriesForCategory(input.categoryId, false);
    const expected = new Set(active.map((subcategory) => subcategory.id));
    const received = new Set(input.ids);

    if (received.size !== input.ids.length) {
      throw validation("La liste contient des doublons.", "ids");
    }
    if (received.size !== expected.size || [...received].some((id) => !expected.has(id))) {
      throw validation(
        "La liste doit contenir exactement les sous-catégories actives de cette catégorie.",
        "ids",
      );
    }

    transaction(() => {
      input.ids.forEach((id, index) => setSubcategorySortOrder(id, index));
    });
    revalidatePath("/");
    return { ok: true } as const;
  });
}
