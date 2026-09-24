/**
 * Point d'entree en ligne de commande du runner de migrations : `npm run db:migrate`.
 *
 * Raison d'etre. Les migrations se jouent seules au demarrage (src/instrumentation.ts),
 * donc cette commande ne sert jamais en exploitation normale. Elle sert quand on
 * restaure une sauvegarde sur un poste : on veut mettre le fichier restaure au niveau
 * du schema courant, et le verifier, avant de le renvoyer dans le volume. Une commande
 * de secours qui echoue au moment ou l'on en a besoin est pire que pas de commande.
 *
 * Pourquoi ce fichier existe au lieu d'un simple chemin corrige dans package.json :
 * migrate.ts n'exporte que des fonctions. Le pointer directement chargerait le module,
 * n'appellerait rien, et sortirait en code 0. Un succes muet sur une restauration est
 * exactement le genre de faux positif qu'on ne detecte qu'une fois les donnees perdues.
 *
 * Les hooks de resolution ci-dessous existent parce que Node execute ce fichier sans
 * bundler : ni l'alias `@/*` de tsconfig ni les imports sans extension ne sont resolus
 * nativement. Le hook les traduit, sans dependance ajoutee et sans toucher au code
 * applicatif, qui reste ecrit pour Next.
 */

import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC_DIR = dirname(import.meta.dirname);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const base = specifier.startsWith("@/")
      ? pathToFileURL(join(SRC_DIR, specifier.slice(2))).href
      : specifier;

    // Le specifier tel quel d'abord : les paquets de node_modules et les imports deja
    // suffixes passent par la voie normale, sans etre affectes par ce hook.
    const candidates = [base, `${base}.ts`, `${base}/index.ts`];
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        return nextResolve(candidate, context);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  },
});

// Imports dynamiques, obligatoirement apres registerHooks : des imports statiques
// seraient resolus avant que le hook existe. Ecrits sans extension, comme partout
// ailleurs dans le depot : c'est le hook qui ajoute le .ts.
const { getDb, closeDb } = await import("./client");
const { LATEST_VERSION, getSchemaVersion } = await import("./migrate");
const { describeError } = await import("../lib/logger");
const { getEnv } = await import("../lib/env");

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

try {
  const { DATABASE_PATH } = getEnv();
  write(`Base ciblee : ${DATABASE_PATH}`);

  // getDb applique les migrations : le meme chemin de code exactement que le
  // demarrage du serveur. Une commande de secours qui emprunterait un autre chemin
  // validerait un comportement que la production n'utilise pas.
  const db = getDb();
  const version = getSchemaVersion(db);

  if (version !== LATEST_VERSION) {
    // Ne devrait pas arriver : runMigrations leve en cas d'echec. Filet au cas ou.
    process.stderr.write(
      `Schema en version ${version}, attendu ${LATEST_VERSION}. Migrations incompletes.\n`,
    );
    closeDb();
    process.exit(1);
  }

  write(`Schema a jour, version ${version}.`);
  // Fermeture explicite : en WAL, c'est la fermeture de la derniere connexion qui
  // replie le fichier -wal dans la base. Sans elle, on repartirait avec un fichier
  // dont les dernieres ecritures vivent encore a cote.
  closeDb();
} catch (error) {
  const { errorMessage } = describeError(error);
  process.stderr.write(`Migrations en echec : ${String(errorMessage)}\n`);
  process.exit(1);
}
