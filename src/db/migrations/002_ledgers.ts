import type { DatabaseSync } from "node:sqlite";

import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";

import { LEDGER_DEFINITIONS, insertSeedCategories } from "../seed";

/**
 * Migration 002 : deux budgets, « Joint » et « Perso ».
 *
 * Ecrite en TypeScript et non en SQL pur, contrairement a 001, pour deux raisons de
 * fond. D'abord les identifiants : le contrat annonce des cles opaques de 21
 * caracteres produites par `newId()`, et `lower(hex(randomblob(16)))` en produirait 32.
 * Ensuite les garde-fous : cette migration s'execute sur des donnees reelles, elle doit
 * pouvoir compter les lignes avant et apres et refuser de valider si un seul mois a
 * disparu. Une chaine SQL ne sait pas faire cela.
 *
 * Ce qu'elle fait :
 * 1. cree la table `ledgers` et ses deux lignes par utilisatrice ;
 * 2. reconstruit `months` et `categories` avec une colonne `ledger_id` NOT NULL, en
 *    rattachant TOUT l'existant au budget « Joint » ;
 * 3. deplace l'unicite des mois de (user_id, year, month) vers (ledger_id, year, month),
 *    ce qui autorise le meme mois dans les deux budgets ;
 * 4. seme le budget « Perso » avec un jeu de categories adapte a un compte personnel.
 *
 * `entries`, `subcategories` et `allocations` ne changent pas : elles heritent du
 * budget par leur parent.
 *
 * ATTENTION, invariant d'execution : cette migration reconstruit deux tables par
 * DROP puis RENAME. Elle EXIGE `PRAGMA foreign_keys = OFF` pendant son execution,
 * signale par `disableForeignKeys` dans le runner. Sans cela, `DROP TABLE months`
 * declenche un DELETE implicite qui cascade sur `entries` et `allocations` : la base
 * ressortirait vide, et sans la moindre erreur. Le runner joue un
 * `PRAGMA foreign_key_check` avant de valider, ce qui rattrape tout orphelin.
 */

function countRows(db: DatabaseSync, table: string): number {
  // Le nom de table vient exclusivement des litteraux de ce fichier, jamais d'une
  // entree exterieure : aucune surface d'injection.
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as
    | { total: number }
    | undefined;
  return row?.total ?? 0;
}

function assertPreserved(db: DatabaseSync, table: string, expected: number): void {
  const actual = countRows(db, table);
  if (actual !== expected) {
    // Leve dans la transaction du runner : la base repart intacte.
    throw new Error(
      `Migration 002 : la table ${table} est passee de ${expected} a ${actual} lignes. ` +
        "Aucune ligne ne doit etre perdue, migration annulee.",
    );
  }
}

export function migration002(db: DatabaseSync): void {
  const before = {
    months: countRows(db, "months"),
    entries: countRows(db, "entries"),
    allocations: countRows(db, "allocations"),
    categories: countRows(db, "categories"),
    subcategories: countRows(db, "subcategories"),
  };

  db.exec(`
CREATE TABLE ledgers (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Cle stable : c'est elle que portent les preferences et l'interface, jamais l'id.
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, slug)
);
CREATE INDEX idx_ledgers_user ON ledgers(user_id, sort_order);
`);

  const users = db.prepare("SELECT id FROM users").all() as { id: string }[];
  const insertLedger = db.prepare(
    `INSERT INTO ledgers (id, user_id, slug, name, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = nowIso();

  for (const user of users) {
    LEDGER_DEFINITIONS.forEach((definition, index) => {
      insertLedger.run(newId(), user.id, definition.slug, definition.name, index, now);
    });
  }

  // Reconstruction de `months`. La recopie passe par une jointure sur le budget joint :
  // si elle ne trouvait pas sa ligne, le mois disparaitrait en silence. D'ou le
  // comptage avant / apres juste en dessous, qui transforme cette perte en echec.
  db.exec(`
CREATE TABLE months_v2 (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ledger_id   TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  note        TEXT,
  created_at  TEXT NOT NULL,
  -- L'unicite bascule du couple utilisatrice/periode vers budget/periode : aout 2026
  -- peut desormais exister dans le joint ET dans le perso.
  UNIQUE (ledger_id, year, month)
);

INSERT INTO months_v2 (id, user_id, ledger_id, year, month, note, created_at)
SELECT m.id, m.user_id, l.id, m.year, m.month, m.note, m.created_at
  FROM months m
  JOIN ledgers l ON l.user_id = m.user_id AND l.slug = 'joint';

DROP TABLE months;
ALTER TABLE months_v2 RENAME TO months;

CREATE INDEX idx_months_ledger_period ON months(ledger_id, year, month);
CREATE INDEX idx_months_user_period ON months(user_id, year, month);
`);

  assertPreserved(db, "months", before.months);
  assertPreserved(db, "entries", before.entries);
  assertPreserved(db, "allocations", before.allocations);

  // Meme reconstruction pour `categories`. Les sous-categories ne bougent pas : elles
  // heritent du budget par leur categorie parente.
  db.exec(`
CREATE TABLE categories_v2 (
  id          TEXT NOT NULL PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ledger_id   TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  hue         INTEGER NOT NULL CHECK (hue BETWEEN 1 AND 16),
  intensity   TEXT CHECK (intensity IS NULL OR intensity IN ('soft', 'vivid')),
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at  TEXT NOT NULL
);

INSERT INTO categories_v2
       (id, user_id, ledger_id, name, hue, intensity, kind, sort_order, is_archived, created_at)
SELECT c.id, c.user_id, l.id, c.name, c.hue, c.intensity, c.kind, c.sort_order,
       c.is_archived, c.created_at
  FROM categories c
  JOIN ledgers l ON l.user_id = c.user_id AND l.slug = 'joint';

DROP TABLE categories;
ALTER TABLE categories_v2 RENAME TO categories;

CREATE INDEX idx_categories_ledger_kind ON categories(ledger_id, kind, sort_order);
CREATE INDEX idx_categories_user_kind ON categories(user_id, kind, sort_order);
`);

  assertPreserved(db, "categories", before.categories);
  assertPreserved(db, "subcategories", before.subcategories);

  // Seed du budget perso. Il est vide par construction : tout l'existant vient d'etre
  // rattache au joint. Le budget joint, lui, n'est jamais reseme ici.
  const perso = LEDGER_DEFINITIONS.find((definition) => definition.slug === "perso");
  if (perso) {
    for (const user of users) {
      const row = db
        .prepare("SELECT id FROM ledgers WHERE user_id = ? AND slug = ?")
        .get(user.id, perso.slug) as { id: string } | undefined;
      if (!row) continue;
      insertSeedCategories(db, user.id, row.id, perso.categories);
    }
  }

  logger.info("Migration 002 : budgets crees", {
    users: users.length,
    months: before.months,
    entries: before.entries,
    allocations: before.allocations,
    categories: before.categories,
  });
}
