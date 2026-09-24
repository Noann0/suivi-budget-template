"use server";

import { revalidatePath } from "next/cache";

import { transaction } from "@/db/client";
import { hueForPosition } from "@/db/seed";
import { conflict, notFound, validation, type ActionResult } from "@/lib/result";
import {
  COLOR_INTENSITIES,
  hueSequenceFor,
  isValidHue,
  type Category,
  type CategoryKind,
  type CategoryWithSubs,
  type ColorIntensity,
  type Hue,
  type LedgerSlug,
} from "@/lib/types";
import { withSession } from "@/server/action-helpers";
import {
  archiveCategory as archiveCategoryRow,
  categoryNameExists,
  findCategory,
  findCategoryScope,
  insertCategory,
  listCategories as listCategoryRows,
  listSubcategories,
  nextCategorySortOrder,
  setCategorySortOrder,
  updateCategoryFields,
  usedHues,
} from "@/server/repositories/categories";
import type { LedgerScope } from "@/server/repositories/ledgers";
import { resolveScope } from "@/server/services/ledgers";

const MAX_NAME_LENGTH = 60;

/**
 * Budget vise. Absent : le budget actif. Les categories sont par budget, le foyer et
 * le compte perso n'ont aucune raison de partager « Taxe fonciere ».
 */
type LedgerInput = { ledger?: LedgerSlug };

function cleanName(raw: unknown, field: string): string {
  if (typeof raw !== "string") throw validation("Le nom est obligatoire.", field);
  const name = raw.trim();
  if (name.length === 0) throw validation("Le nom ne peut pas être vide.", field);
  if (name.length > MAX_NAME_LENGTH) {
    throw validation(`Le nom ne doit pas dépasser ${MAX_NAME_LENGTH} caractères.`, field);
  }
  return name;
}

function cleanIntensity(raw: unknown): ColorIntensity | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && (COLOR_INTENSITIES as readonly string[]).includes(raw)) {
    return raw as ColorIntensity;
  }
  throw validation('L\'intensité doit valoir « soft », « vivid », ou rien.', "intensity");
}

/**
 * Premiere teinte libre de la sequence du designer, pour la nature demandee.
 *
 * Deux compteurs, deux sens de parcours : les depenses consomment la sequence par la
 * tete, les revenus par la queue. Le camembert ne melange jamais les deux natures,
 * donc les premieres depenses doivent recevoir les premieres teintes, celles dont
 * l'ecart a ete mesure sous daltonisme : 11.8 en pastel, contre 9.9 avec un compteur
 * global. Le parcours inverse des revenus supprime tout partage de teinte entre les
 * deux natures tant que le total reste sous seize categories.
 */
function pickHue(scope: LedgerScope, kind: CategoryKind): Hue {
  const taken = new Set(usedHues(scope, kind));
  for (const hue of hueSequenceFor(kind)) {
    if (!taken.has(hue)) return hue;
  }
  // Les seize teintes sont prises : on recycle en suivant le meme sens de parcours.
  return hueForPosition(kind, taken.size);
}

export async function listCategories(
  input?: { includeArchived?: boolean } & LedgerInput,
): Promise<ActionResult<CategoryWithSubs[]>> {
  return withSession(({ userId }) => {
    const scope = resolveScope(userId, input?.ledger);
    const includeArchived = input?.includeArchived === true;
    const categories = listCategoryRows(scope, includeArchived);
    const subcategories = listSubcategories(scope, includeArchived);

    return categories.map((category) => ({
      ...category,
      subcategories: subcategories
        .filter((subcategory) => subcategory.categoryId === category.id)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "fr")),
    }));
  });
}

export async function createCategory(
  input: {
    name: string;
    kind: CategoryKind;
    hue?: Hue;
    intensity?: ColorIntensity | null;
  } & LedgerInput,
): Promise<ActionResult<Category>> {
  return withSession(({ userId }) => {
    const scope = resolveScope(userId, input.ledger);
    const name = cleanName(input.name, "name");
    if (input.kind !== "income" && input.kind !== "expense") {
      throw validation("Le type doit être un revenu ou une dépense.", "kind");
    }
    if (input.hue !== undefined && !isValidHue(input.hue)) {
      throw validation("La teinte doit être un nombre entier compris entre 1 et 16.", "hue");
    }
    const intensity = cleanIntensity(input.intensity);

    if (categoryNameExists(scope, input.kind, name)) {
      throw conflict("Une catégorie porte déjà ce nom.");
    }

    return insertCategory({
      scope,
      name,
      kind: input.kind,
      hue: input.hue ?? pickHue(scope, input.kind),
      intensity,
      sortOrder: nextCategorySortOrder(scope, input.kind),
    });
  });
}

export async function updateCategory(input: {
  id: string;
  name?: string;
  hue?: Hue;
  intensity?: ColorIntensity | null;
}): Promise<ActionResult<Category>> {
  return withSession(({ userId }) => {
    const existing = findCategory(userId, input.id);
    if (!existing) throw notFound("Cette catégorie n'existe pas.");
    // Le budget se deduit de la categorie visee, pas du budget actif : elle peut
    // renommer une categorie de l'autre budget depuis l'ecran des reglages.
    const scope = findCategoryScope(userId, input.id);
    if (!scope) throw notFound("Cette catégorie n'existe pas.");

    const name = input.name === undefined ? undefined : cleanName(input.name, "name");
    if (input.hue !== undefined && !isValidHue(input.hue)) {
      throw validation("La teinte doit être un nombre entier compris entre 1 et 16.", "hue");
    }

    if (name !== undefined && categoryNameExists(scope, existing.kind, name, existing.id)) {
      throw conflict("Une catégorie porte déjà ce nom.");
    }

    // `kind` n'est volontairement pas modifiable : basculer une categorie de revenu en
    // depense inverserait le signe de tout l'historique deja saisi.
    updateCategoryFields(userId, input.id, {
      ...(name === undefined ? {} : { name }),
      ...(input.hue === undefined ? {} : { hue: input.hue }),
      ...(Object.hasOwn(input, "intensity")
        ? { intensity: cleanIntensity(input.intensity) }
        : {}),
    });

    const updated = findCategory(userId, input.id);
    if (!updated) throw notFound("Cette catégorie n'existe pas.");
    revalidatePath("/");
    return updated;
  });
}

/**
 * Archive une categorie. C'est la reponse a une demande de suppression : effacer
 * detruirait l'historique de tous les mois passes qui la referencent.
 */
export async function archiveCategory(input: {
  id: string;
}): Promise<ActionResult<{ ok: true }>> {
  return withSession(({ userId }) => {
    if (!findCategory(userId, input.id)) throw notFound("Cette catégorie n'existe pas.");
    transaction(() => archiveCategoryRow(userId, input.id, true));
    revalidatePath("/");
    return { ok: true } as const;
  });
}

export async function restoreCategory(input: { id: string }): Promise<ActionResult<{ ok: true }>> {
  return withSession(({ userId }) => {
    if (!findCategory(userId, input.id)) throw notFound("Cette catégorie n'existe pas.");
    transaction(() => archiveCategoryRow(userId, input.id, false));
    revalidatePath("/");
    return { ok: true } as const;
  });
}

/**
 * Reordonne les categories d'une meme nature.
 * La liste doit etre exhaustive : accepter une liste partielle laisserait des rangs
 * en double et un ordre d'affichage instable d'un chargement a l'autre.
 */
export async function reorderCategories(input: {
  ids: string[];
}): Promise<ActionResult<{ ok: true }>> {
  return withSession(({ userId }) => {
    if (!Array.isArray(input.ids) || input.ids.length === 0) {
      throw validation("La liste des éléments à réordonner est invalide.", "ids");
    }

    // La nature ET le budget se deduisent de la premiere categorie de la liste :
    // revenus et depenses sont deux listes distinctes a l'ecran, et on ne reordonne
    // jamais deux budgets ensemble.
    const first = findCategory(userId, input.ids[0]!);
    if (!first) throw validation("Cette catégorie n'existe pas.", "ids");
    const scope = findCategoryScope(userId, input.ids[0]!);
    if (!scope) throw validation("Cette catégorie n'existe pas.", "ids");
    const kind: CategoryKind = first.kind;

    const active = listCategoryRows(scope, false).filter((c) => c.kind === kind);
    const expected = new Set(active.map((c) => c.id));
    const received = new Set(input.ids);

    if (received.size !== input.ids.length) {
      throw validation("La liste contient des doublons.", "ids");
    }
    if (received.size !== expected.size || [...received].some((id) => !expected.has(id))) {
      throw validation(
        "La liste doit contenir exactement les catégories actives de ce type.",
        "ids",
      );
    }

    transaction(() => {
      input.ids.forEach((id, index) => setCategorySortOrder(userId, id, index));
    });
    revalidatePath("/");
    return { ok: true } as const;
  });
}
