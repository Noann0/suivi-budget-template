import type { DatabaseSync } from "node:sqlite";

import { logger } from "@/lib/logger";

import { migration001 } from "./migrations/001_initial_schema";
import { migration002 } from "./migrations/002_ledgers";

/**
 * Runner de migrations, idempotent, joue au demarrage.
 *
 * Le suivi se fait via le PRAGMA `user_version` de SQLite, un entier stocke dans
 * l'en-tete du fichier. Pas de table de suivi a creer avant de pouvoir migrer, donc
 * pas de probleme d'amorcage. Chaque migration s'execute dans une transaction : une
 * migration a moitie appliquee laisserait une base dans un etat qu'aucun code ne sait
 * lire, ce qui est bien pire qu'un demarrage refuse.
 */

type Migration = {
  version: number;
  name: string;
  /**
   * Coupe les cles etrangeres le temps de la migration. Reserve aux reconstructions
   * de table par DROP puis RENAME : avec les cles actives, `DROP TABLE months`
   * declenche un DELETE implicite qui cascade sur les entrees et les allocations, et
   * vide la base sans lever la moindre erreur. C'est la procedure officielle SQLite,
   * et le `PRAGMA foreign_key_check` joue plus bas en est le filet obligatoire.
   */
  disableForeignKeys?: boolean;
  apply: (db: DatabaseSync) => void;
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "001_initial_schema",
    apply: (db) => db.exec(migration001),
  },
  {
    version: 2,
    name: "002_ledgers",
    disableForeignKeys: true,
    apply: migration002,
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  return Number(row?.user_version ?? 0);
}

/** Orphelins laisses par une recopie incomplete. Vide en temps normal. */
function foreignKeyViolations(db: DatabaseSync): number {
  return db.prepare("PRAGMA foreign_key_check").all().length;
}

export function runMigrations(db: DatabaseSync): number {
  const current = getSchemaVersion(db);
  const pending = MIGRATIONS.filter((migration) => migration.version > current);

  if (pending.length === 0) {
    logger.debug("Schema deja a jour", { version: current });
    return current;
  }

  for (const migration of pending) {
    logger.info("Application d'une migration", {
      version: migration.version,
      name: migration.name,
    });

    // Hors transaction, obligatoirement : `PRAGMA foreign_keys` est un no-op silencieux
    // pendant une transaction ouverte, la coupure n'aurait aucun effet.
    const suspendForeignKeys = migration.disableForeignKeys === true;
    if (suspendForeignKeys) db.exec("PRAGMA foreign_keys = OFF");

    db.exec("BEGIN");
    try {
      migration.apply(db);

      if (suspendForeignKeys) {
        const violations = foreignKeyViolations(db);
        if (violations > 0) {
          throw new Error(
            `Migration ${migration.name} : ${violations} reference orpheline apres reconstruction.`,
          );
        }
      }

      // user_version n'accepte pas de parametre lie, SQLite exige un litteral.
      // La valeur vient d'une constante du code, jamais d'une entree utilisateur.
      db.exec(`PRAGMA user_version = ${Number(migration.version)}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      logger.error("Migration echouee, base laissee intacte", {
        version: migration.version,
        name: migration.name,
      });
      throw error;
    } finally {
      // Retablies quoi qu'il arrive : une base qui continuerait de tourner sans cles
      // etrangeres accepterait des lignes orphelines pendant toute la vie du processus.
      if (suspendForeignKeys) db.exec("PRAGMA foreign_keys = ON");
    }
  }

  const final = getSchemaVersion(db);
  logger.info("Migrations terminees", { from: current, to: final });
  return final;
}
