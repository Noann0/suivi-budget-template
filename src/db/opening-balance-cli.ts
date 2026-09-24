/**
 * Commande de maintenance reservee a l'operateur. Elle ne devient jamais une
 * Server Action et ne peut donc pas etre appelee depuis le navigateur.
 */

import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

type Command =
  | { userId: string; start: { year: number; month: number } }
  | { userId: string; start: null };

const SRC_DIR = dirname(import.meta.dirname);

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readOptionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    fail(`${option} exige une valeur.`);
  }
  return value;
}

function parseCommand(args: string[]): Command {
  let userId: string | undefined;
  let month: { year: number; month: number } | undefined;
  let disable = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--user-id") {
      if (userId !== undefined) fail("--user-id ne peut etre fourni qu'une fois.");
      userId = readOptionValue(args, index, "--user-id");
      index += 1;
      continue;
    }

    if (argument === "--month") {
      if (month !== undefined) fail("--month ne peut etre fourni qu'une fois.");
      const value = readOptionValue(args, index, "--month");
      const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
      if (match === null) fail("--month doit respecter le format YYYY-MM.");
      month = { year: Number(match[1]), month: Number(match[2]) };
      index += 1;
      continue;
    }

    if (argument === "--disable") {
      if (disable) fail("--disable ne peut etre fourni qu'une fois.");
      disable = true;
      continue;
    }

    fail(`Option inconnue : ${argument}`);
  }

  if (userId === undefined || userId.length === 0) fail("--user-id est obligatoire.");
  if ((month === undefined && !disable) || (month !== undefined && disable)) {
    fail("Fournir exactement --month YYYY-MM ou --disable.");
  }

  return month === undefined ? { userId, start: null } : { userId, start: month };
}

if (process.env.DATABASE_PATH === undefined || process.env.DATABASE_PATH.trim().length === 0) {
  fail("DATABASE_PATH est obligatoire.");
}

const command = parseCommand(process.argv.slice(2));

registerHooks({
  resolve(specifier, context, nextResolve) {
    const base = specifier.startsWith("@/")
      ? pathToFileURL(join(SRC_DIR, specifier.slice(2))).href
      : specifier;
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

let closeDb: (() => void) | undefined;

try {
  const preferences = await import("../server/repositories/preferences");
  ({ closeDb } = await import("./client"));

  preferences.setOpeningBalanceStartForOperator(command.userId, command.start);
  process.stdout.write(
    command.start === null
      ? "Solde d'ouverture masque.\n"
      : `Solde d'ouverture active pour ${command.start.year}-${String(command.start.month).padStart(2, "0")}.\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Mise a jour du solde d'ouverture en echec : ${message}\n`);
  process.exitCode = 1;
} finally {
  closeDb?.();
}
