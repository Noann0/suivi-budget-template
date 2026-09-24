import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { before, test } from "node:test";

import { execute } from "@/db/client";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import {
  getPreferences,
  setOpeningBalanceStartForOperator,
} from "@/server/repositories/preferences";

import { useScratchDatabase } from "./helpers/scratch-db";

let userId: string;

function runOpeningBalanceCli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "src/db/opening-balance-cli.ts",
      ...args,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    },
  );

  assert.equal(result.error, undefined);
  return result;
}

before(() => {
  useScratchDatabase("preferences");
  userId = newId();
  execute("INSERT INTO users (id, created_at) VALUES (?, ?)", [userId, nowIso()]);
});

test("preferences : le solde d'ouverture est masque par defaut", () => {
  assert.equal(getPreferences(userId).openingBalanceStart, null);
});

test("preferences : l'operateur peut activer l'affichage avec un mois valide", () => {
  setOpeningBalanceStartForOperator(userId, { year: 2026, month: 9 });

  assert.deepEqual(getPreferences(userId).openingBalanceStart, { year: 2026, month: 9 });
});

test("preferences : une valeur stockee invalide desactive l'affichage", () => {
  execute(
    `INSERT INTO user_preferences (user_id, key, value, updated_at) VALUES (?, 'opening_balance_start', ?, ?)
     ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [userId, '{"year":2026,"month":13}', nowIso()],
  );

  assert.equal(getPreferences(userId).openingBalanceStart, null);
});

test("preferences : le CLI operateur active le solde d'ouverture pour un mois", () => {
  const result = runOpeningBalanceCli(["--user-id", userId, "--month", "2026-09"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Solde d'ouverture active pour 2026-09/);
  assert.deepEqual(getPreferences(userId).openingBalanceStart, { year: 2026, month: 9 });
});

test("preferences : le CLI operateur desactive le solde d'ouverture", () => {
  const result = runOpeningBalanceCli(["--user-id", userId, "--disable"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Solde d'ouverture masque/);
  assert.equal(getPreferences(userId).openingBalanceStart, null);
});

test("preferences : le CLI operateur exige DATABASE_PATH, un utilisateur et une action unique", () => {
  const withoutDatabasePath = { ...process.env };
  delete withoutDatabasePath.DATABASE_PATH;

  const missingDatabasePath = runOpeningBalanceCli(
    ["--user-id", userId, "--disable"],
    withoutDatabasePath,
  );
  assert.equal(missingDatabasePath.status, 1);
  assert.match(missingDatabasePath.stderr, /DATABASE_PATH est obligatoire/);

  const missingUserId = runOpeningBalanceCli(["--disable"]);
  assert.equal(missingUserId.status, 1);
  assert.match(missingUserId.stderr, /--user-id est obligatoire/);

  const conflictingActions = runOpeningBalanceCli([
    "--user-id",
    userId,
    "--month",
    "2026-09",
    "--disable",
  ]);
  assert.equal(conflictingActions.status, 1);
  assert.match(conflictingActions.stderr, /exactement --month YYYY-MM ou --disable/);
});
