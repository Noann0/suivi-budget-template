import { execute, query, queryOne, fromSqlBool } from "@/db/client";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import type { Category, CategoryKind, ColorIntensity, Hue, Subcategory } from "@/lib/types";

import type { LedgerScope } from "./ledgers";

/**
 * Acces aux categories et sous-categories. Cette couche ne parle que SQL et mapping :
 * aucune regle metier ici, aucune validation d'entree.
 *
 * Les categories appartiennent a un budget, pas seulement a l'utilisatrice : le foyer
 * et le compte perso n'ont aucune raison de partager « Taxe fonciere ». Toute lecture
 * de liste passe donc par un `LedgerScope`, qui porte les deux filtres a la fois. Les
 * acces par identifiant, eux, restent scopes par la seule utilisatrice : c'est elle la
 * frontiere de securite, le budget n'est qu'un cloisonnement d'affichage.
 */

type CategoryRow = {
  id: string;
  user_id: string;
  name: string;
  hue: number;
  intensity: string | null;
  kind: string;
  sort_order: number;
  is_archived: number;
};

type SubcategoryRow = {
  id: string;
  category_id: string;
  name: string;
  sort_order: number;
  is_archived: number;
};

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as CategoryKind,
    hue: row.hue as Hue,
    intensity: (row.intensity as ColorIntensity | null) ?? null,
    sortOrder: row.sort_order,
    isArchived: fromSqlBool(row.is_archived),
  };
}

function toSubcategory(row: SubcategoryRow): Subcategory {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    sortOrder: row.sort_order,
    isArchived: fromSqlBool(row.is_archived),
  };
}

export function listCategories(scope: LedgerScope, includeArchived: boolean): Category[] {
  const rows = query<CategoryRow>(
    `SELECT id, user_id, name, hue, intensity, kind, sort_order, is_archived
       FROM categories
      WHERE user_id = ? AND ledger_id = ?
        AND (? = 1 OR is_archived = 0)
      ORDER BY kind DESC, sort_order ASC, name ASC`,
    [scope.userId, scope.ledgerId, includeArchived ? 1 : 0],
  );
  return rows.map(toCategory);
}

export function findCategory(userId: string, id: string): Category | null {
  const row = queryOne<CategoryRow>(
    `SELECT id, user_id, name, hue, intensity, kind, sort_order, is_archived
       FROM categories WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return row ? toCategory(row) : null;
}

/**
 * Budget d'une categorie donnee.
 *
 * Sert a deduire le perimetre d'une modification depuis la ligne visee plutot que
 * depuis le budget actif : renommer une categorie du budget perso alors que le budget
 * joint est ouvert doit verifier l'unicite du nom dans le perso, pas ailleurs.
 */
export function findCategoryScope(userId: string, id: string): LedgerScope | null {
  const row = queryOne<{ ledger_id: string }>(
    `SELECT ledger_id FROM categories WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return row ? { userId, ledgerId: row.ledger_id } : null;
}

/**
 * Vrai si une categorie active du meme type porte deja ce nom DANS CE BUDGET.
 * Le meme nom peut exister des deux cotes : « Vie courante » a un sens dans le foyer
 * comme dans le compte perso, et ce sont deux lignes distinctes.
 */
export function categoryNameExists(
  scope: LedgerScope,
  kind: CategoryKind,
  name: string,
  excludeId?: string,
): boolean {
  const row = queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM categories
      WHERE user_id = ? AND ledger_id = ? AND kind = ? AND is_archived = 0
        AND LOWER(name) = LOWER(?)
        AND (? IS NULL OR id <> ?)`,
    [scope.userId, scope.ledgerId, kind, name, excludeId ?? null, excludeId ?? ""],
  );
  return (row?.total ?? 0) > 0;
}

export function nextCategorySortOrder(scope: LedgerScope, kind: CategoryKind): number {
  const row = queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
       FROM categories WHERE user_id = ? AND ledger_id = ? AND kind = ?`,
    [scope.userId, scope.ledgerId, kind],
  );
  return row?.next ?? 0;
}

export function insertCategory(input: {
  scope: LedgerScope;
  name: string;
  kind: CategoryKind;
  hue: Hue;
  intensity: ColorIntensity | null;
  sortOrder: number;
}): Category {
  const id = newId();
  execute(
    `INSERT INTO categories
       (id, user_id, ledger_id, name, hue, intensity, kind, sort_order, is_archived, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id,
      input.scope.userId,
      input.scope.ledgerId,
      input.name,
      input.hue,
      input.intensity,
      input.kind,
      input.sortOrder,
      nowIso(),
    ],
  );
  return {
    id,
    name: input.name,
    kind: input.kind,
    hue: input.hue,
    intensity: input.intensity,
    sortOrder: input.sortOrder,
    isArchived: false,
  };
}

/**
 * Teintes deja prises par les categories actives d'une nature, dans ce budget.
 * Le camembert n'affiche qu'un budget a la fois : deux categories de budgets
 * differents peuvent partager une teinte sans jamais se rencontrer a l'ecran.
 */
export function usedHues(scope: LedgerScope, kind: CategoryKind): number[] {
  return query<{ hue: number }>(
    `SELECT DISTINCT hue FROM categories
      WHERE user_id = ? AND ledger_id = ? AND kind = ? AND is_archived = 0`,
    [scope.userId, scope.ledgerId, kind],
  ).map((row) => row.hue);
}

export function updateCategoryFields(
  userId: string,
  id: string,
  fields: { name?: string; hue?: Hue; intensity?: ColorIntensity | null },
): void {
  // intensity est nullable ET modifiable vers null ("suit le reglage global").
  // COALESCE ne saurait pas distinguer "non fourni" de "remis a null", d'ou le
  // drapeau explicite plutot qu'un COALESCE sur cette colonne.
  const clearIntensity = Object.hasOwn(fields, "intensity") && fields.intensity === null ? 1 : 0;
  execute(
    `UPDATE categories
        SET name      = COALESCE(?, name),
            hue       = COALESCE(?, hue),
            intensity = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, intensity) END
      WHERE id = ? AND user_id = ?`,
    [
      fields.name ?? null,
      fields.hue ?? null,
      clearIntensity,
      fields.intensity ?? null,
      id,
      userId,
    ],
  );
}

/**
 * Archive une categorie et, dans le meme geste, toutes ses sous-categories.
 * L'appelant est responsable d'englober cet appel dans une transaction.
 */
export function archiveCategory(userId: string, id: string, archived: boolean): void {
  const flag = archived ? 1 : 0;
  execute(`UPDATE categories SET is_archived = ? WHERE id = ? AND user_id = ?`, [flag, id, userId]);
  execute(
    `UPDATE subcategories SET is_archived = ?
      WHERE category_id IN (SELECT id FROM categories WHERE id = ? AND user_id = ?)`,
    [flag, id, userId],
  );
}

export function setCategorySortOrder(userId: string, id: string, sortOrder: number): void {
  execute(`UPDATE categories SET sort_order = ? WHERE id = ? AND user_id = ?`, [
    sortOrder,
    id,
    userId,
  ]);
}

/** Les sous-categories heritent du budget par leur categorie parente. */
export function listSubcategories(scope: LedgerScope, includeArchived: boolean): Subcategory[] {
  const rows = query<SubcategoryRow>(
    `SELECT s.id, s.category_id, s.name, s.sort_order, s.is_archived
       FROM subcategories s
       JOIN categories c ON c.id = s.category_id
      WHERE c.user_id = ? AND c.ledger_id = ?
        AND (? = 1 OR s.is_archived = 0)
      ORDER BY s.sort_order ASC, s.name ASC`,
    [scope.userId, scope.ledgerId, includeArchived ? 1 : 0],
  );
  return rows.map(toSubcategory);
}

/**
 * Sous-categories d'une categorie donnee. Pas de `LedgerScope` ici : la categorie a
 * deja ete verifiee comme appartenant a l'utilisatrice, et elle porte son budget.
 */
export function listSubcategoriesForCategory(
  categoryId: string,
  includeArchived: boolean,
): Subcategory[] {
  const rows = query<SubcategoryRow>(
    `SELECT s.id, s.category_id, s.name, s.sort_order, s.is_archived
       FROM subcategories s
      WHERE s.category_id = ?
        AND (? = 1 OR s.is_archived = 0)
      ORDER BY s.sort_order ASC, s.name ASC`,
    [categoryId, includeArchived ? 1 : 0],
  );
  return rows.map(toSubcategory);
}

export function findSubcategory(userId: string, id: string): Subcategory | null {
  const row = queryOne<SubcategoryRow>(
    `SELECT s.id, s.category_id, s.name, s.sort_order, s.is_archived
       FROM subcategories s
       JOIN categories c ON c.id = s.category_id
      WHERE s.id = ? AND c.user_id = ?`,
    [id, userId],
  );
  return row ? toSubcategory(row) : null;
}

export function subcategoryNameExists(
  categoryId: string,
  name: string,
  excludeId?: string,
): boolean {
  const row = queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM subcategories
      WHERE category_id = ? AND is_archived = 0
        AND LOWER(name) = LOWER(?)
        AND (? IS NULL OR id <> ?)`,
    [categoryId, name, excludeId ?? null, excludeId ?? ""],
  );
  return (row?.total ?? 0) > 0;
}

export function nextSubcategorySortOrder(categoryId: string): number {
  const row = queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
       FROM subcategories WHERE category_id = ?`,
    [categoryId],
  );
  return row?.next ?? 0;
}

export function insertSubcategory(input: {
  categoryId: string;
  name: string;
  sortOrder: number;
}): Subcategory {
  const id = newId();
  execute(
    `INSERT INTO subcategories (id, category_id, name, sort_order, is_archived, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [id, input.categoryId, input.name, input.sortOrder, nowIso()],
  );
  return {
    id,
    categoryId: input.categoryId,
    name: input.name,
    sortOrder: input.sortOrder,
    isArchived: false,
  };
}

export function updateSubcategoryName(id: string, name: string): void {
  execute(`UPDATE subcategories SET name = ? WHERE id = ?`, [name, id]);
}

export function archiveSubcategory(id: string, archived: boolean): void {
  execute(`UPDATE subcategories SET is_archived = ? WHERE id = ?`, [archived ? 1 : 0, id]);
}

export function setSubcategorySortOrder(id: string, sortOrder: number): void {
  execute(`UPDATE subcategories SET sort_order = ? WHERE id = ?`, [sortOrder, id]);
}
