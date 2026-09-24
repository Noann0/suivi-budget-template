import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { runMigrations } from "./migrate";

/**
 * Unique point de contact avec le driver SQLite de tout le depot.
 *
 * Choix documente dans docs/API.md section 1.1 : `node:sqlite` integre a Node 24
 * plutot que better-sqlite3. Motif decisif, le build Docker : il n'y a aucun module
 * natif a compiler, aucun binaire .node a recopier dans .next/standalone, et le
 * prefixe `node:` est externalise d'office par le bundler.
 *
 * Contrepartie assumee : le module est en stabilite 1.2 (Release Candidate). Elle est
 * neutralisee par ce confinement. Changer de driver reviendrait a remplacer ce seul
 * fichier, pas a refondre l'application.
 */

export type SqlValue = string | number | null | Uint8Array;
export type SqlParams = Record<string, SqlValue> | SqlValue[];

type GlobalWithDb = typeof globalThis & { __budgetDb?: DatabaseSync };

/**
 * En developpement, le rechargement a chaud de Next reevalue les modules. Sans ce
 * passage par globalThis, chaque rechargement ouvrirait une connexion de plus et
 * finirait en verrous concurrents sur le fichier.
 */
const globalRef = globalThis as GlobalWithDb;

let migrationsApplied = false;

function openDatabase(): DatabaseSync {
  const env = getEnv();
  const path = resolve(env.DATABASE_PATH);

  // Le repertoire parent peut ne pas exister au tout premier demarrage, en
  // particulier sur un volume Docker fraichement monte.
  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);

  // WAL : lectures concurrentes non bloquees par une ecriture. Sur une application
  // mono-utilisatrice l'enjeu est faible, mais le cout est nul.
  db.exec("PRAGMA journal_mode = WAL");
  // NORMAL plutot que FULL : en WAL, la durabilite reste correcte et les ecritures
  // ne paient plus un fsync par transaction.
  db.exec("PRAGMA synchronous = NORMAL");
  // Sans cette ligne, SQLite ignore purement et simplement les cles etrangeres, et
  // la cascade de suppression d'un mois ne ferait rien du tout.
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  logger.info("Base de donnees ouverte", { path });
  return db;
}

/**
 * Rend la connexion, en appliquant les migrations au premier appel.
 * Paresseux a dessein : rien ne touche le disque pendant `next build`, ou le
 * volume /data n'existe pas encore.
 */
export function getDb(): DatabaseSync {
  if (!globalRef.__budgetDb) {
    globalRef.__budgetDb = openDatabase();
  }
  const db = globalRef.__budgetDb;

  if (!migrationsApplied) {
    migrationsApplied = true;
    // migrate recoit la connexion en parametre et n'importe pas ce module :
    // il n'y a donc aucun cycle d'import a contourner.
    runMigrations(db);
  }

  return db;
}

/**
 * Ferme la connexion et remet l'etat du module a zero.
 *
 * Utile aux processus courts, `npm run db:migrate` en tete : en mode WAL, c'est la
 * fermeture de la derniere connexion qui replie `budget.db-wal` dans le fichier
 * principal. Un script qui sortirait sans fermer laisserait derriere lui une base dont
 * les dernieres ecritures vivent encore a cote, exactement le piege decrit dans
 * docs/DEPLOY.md section 8.
 *
 * Le serveur Next n'appelle pas cette fonction : sa connexion vit aussi longtemps que
 * le processus.
 */
export function closeDb(): void {
  const db = globalRef.__budgetDb;
  if (!db) return;
  db.close();
  globalRef.__budgetDb = undefined;
  // Sans cette remise a zero, une reouverture dans le meme processus sauterait les
  // migrations en croyant les avoir deja jouees.
  migrationsApplied = false;
}

/** Lecture multi-lignes. */
export function query<T>(sql: string, params?: SqlParams): T[] {
  const statement = getDb().prepare(sql);
  const rows = params === undefined
    ? statement.all()
    : Array.isArray(params)
      ? statement.all(...params)
      : statement.all(params);
  return rows as T[];
}

/** Lecture d'une ligne au plus. */
export function queryOne<T>(sql: string, params?: SqlParams): T | null {
  const statement = getDb().prepare(sql);
  const row = params === undefined
    ? statement.get()
    : Array.isArray(params)
      ? statement.get(...params)
      : statement.get(params);
  return (row as T | undefined) ?? null;
}

/** Ecriture. Rend le nombre de lignes reellement affectees. */
export function execute(sql: string, params?: SqlParams): { changes: number } {
  const statement = getDb().prepare(sql);
  const result = params === undefined
    ? statement.run()
    : Array.isArray(params)
      ? statement.run(...params)
      : statement.run(params);
  return { changes: Number(result.changes) };
}

/**
 * Transaction. Tout ou rien.
 * Pas de transaction imbriquee : on garde une seule frontiere transactionnelle,
 * geree au niveau service, ce qui suffit largement ici.
 */
export function transaction<T>(work: () => T): T {
  const db = getDb();

  // Reentrance : si une transaction est deja ouverte, on se contente d'y participer.
  // Un second BEGIN echouerait, et un COMMIT interne validerait par surprise le
  // travail de l'appelant exterieur.
  if (db.isTransaction) return work();

  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    // SQLite peut avoir deja annule la transaction de lui-meme, auquel cas un
    // ROLLBACK explicite leverait une seconde erreur qui masquerait la premiere.
    if (db.isTransaction) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // On laisse remonter l'erreur d'origine, la seule interessante.
      }
    }
    throw error;
  }
}

/** Convertit un booleen pour SQLite : le driver refuse de binder un vrai booleen. */
export function toSqlBool(value: boolean): number {
  return value ? 1 : 0;
}

export function fromSqlBool(value: number): boolean {
  return value === 1;
}

const SQLITE_CONSTRAINT_UNIQUE = 2067;
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;

/** Vrai si l'erreur est une violation de contrainte d'unicite. */
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { errcode?: number }).errcode;
  return code === SQLITE_CONSTRAINT_UNIQUE || code === SQLITE_CONSTRAINT_PRIMARYKEY;
}
