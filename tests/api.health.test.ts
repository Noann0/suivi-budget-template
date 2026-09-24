import { before, test } from "node:test";
import assert from "node:assert/strict";

import { getDb } from "@/db/client";
import { LATEST_VERSION } from "@/db/migrate";
import { GET } from "@/app/api/health/route";

import { useScratchDatabase } from "./helpers/scratch-db";

/**
 * Preuve du comportement de `/api/health` : 200 sur un schema a jour, 503 sur un
 * schema perime. La sonde compare STRICTEMENT `version !== LATEST_VERSION` (voir
 * route.ts) : l'ancienne version comparait `version < 1`, qui restait vraie (donc
 * "sain") tant qu'une migration avait au moins commence a s'appliquer une fois, meme
 * restee en cours de route.
 *
 * Piege evite ici : `getDb()` applique les migrations en attente au TOUT PREMIER
 * appel du processus (drapeau `migrationsApplied` a usage unique dans db/client.ts).
 * Pour observer un schema perime sans repartir sur deux processus, on laisse
 * `getDb()` migrer une premiere fois normalement, PUIS on retombe manuellement le
 * `PRAGMA user_version` sur la MEME connexion : la migration ne se rejoue pas (le
 * drapeau est deja leve), la sonde doit donc voir la version perimee et refuser.
 */

before(() => {
  useScratchDatabase("health-route");
});

test("GET /api/health rend 200 et le numero de schema quand la base est a jour", async () => {
  // Premier contact avec la base : migrations appliquees, colonnes vues LATEST_VERSION.
  getDb();

  const response = await GET();
  assert.equal(response.status, 200);
  const body = (await response.json()) as { status: string; migrations: number };
  assert.equal(body.status, "ok");
  assert.equal(body.migrations, LATEST_VERSION);
});

test("GET /api/health rend 503 quand le schema est perime", async () => {
  const db = getDb(); // deja migree par le test precedent, migrationsApplied reste vrai
  db.exec(`PRAGMA user_version = ${LATEST_VERSION - 1}`);

  const response = await GET();
  assert.equal(response.status, 503);
  const body = (await response.json()) as { status: string; database: string };
  assert.equal(body.status, "error");
  assert.equal(body.database, "unreachable");

  // Remet la base dans un etat coherent pour ne pas fausser un test qui suivrait dans
  // le meme fichier (aucun aujourd'hui, mais la regle "tests independants" vaut aussi
  // pour l'etat qu'on laisse derriere soi).
  db.exec(`PRAGMA user_version = ${LATEST_VERSION}`);
});

test("GET /api/health rend a nouveau 200 une fois le schema remis a jour", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
});
