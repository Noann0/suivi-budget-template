import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CEREMONY_TIMEOUT_MS,
  CHALLENGE_TTL_MS,
  CHALLENGE_TTL_SECONDS,
  OPTIONS_FRESHNESS_MS,
} from "./authTimings.ts";

/**
 * Fichier en .mjs et non en .ts, et ce n'est pas une preference : la configuration
 * TypeScript du depot n'active pas allowImportingTsExtensions, donc un test ecrit en
 * .ts ne peut pas importer "./authTimings.ts" sans faire echouer `npm run typecheck`
 * (TS5097), et sans extension c'est node qui ne sait plus resoudre le module. Le .mjs
 * n'est ni compile ni typecheck, il s'execute tel quel avec `node --test`.
 */

test("les durees effectives n'ont pas bouge", () => {
  // Ces trois nombres sont un comportement d'authentification en production, pas un
  // detail d'implementation. S'ils changent, que ce soit une decision, pas un effet
  // de bord d'un refactor.
  assert.equal(CHALLENGE_TTL_SECONDS, 600, "duree de vie du defi : 10 minutes");
  assert.equal(CEREMONY_TIMEOUT_MS, 300_000, "delai de la fenetre systeme : 5 minutes");
  assert.equal(OPTIONS_FRESHNESS_MS, 300_000, "fraicheur des options prechargees : 5 minutes");
});

test("la fraicheur des options est la difference, pas une copie du delai de ceremonie", () => {
  // Les deux lectures donnent le meme nombre aujourd'hui. Ce test distingue celle qui
  // survit a un changement de la duree de vie du defi.
  assert.equal(OPTIONS_FRESHNESS_MS, CHALLENGE_TTL_MS - CEREMONY_TIMEOUT_MS);
});

test("le pire enchainement autorise reste dans la duree de vie du defi", () => {
  // Chronologie reelle : les options sont generees a t=0 (prechargement au montage de
  // l'ecran de connexion), le clic les reutilise tant que leur age est STRICTEMENT
  // inferieur a OPTIONS_FRESHNESS_MS, puis la fenetre du systeme peut tenir jusqu'a
  // CEREMONY_TIMEOUT_MS. Le serveur n'accepte la reponse que si elle arrive avant
  // t = CHALLENGE_TTL_MS.
  const dernierClicAcceptant = OPTIONS_FRESHNESS_MS - 1;
  const arriveeAuServeur = dernierClicAcceptant + CEREMONY_TIMEOUT_MS;

  assert.ok(
    arriveeAuServeur < CHALLENGE_TTL_MS,
    `une reponse peut arriver a ${arriveeAuServeur} ms alors que le defi meurt a ${CHALLENGE_TTL_MS} ms`,
  );
});

test("la fraicheur derivee reste un delai utilisable", () => {
  // Une valeur nulle ou negative signifierait qu'aucun instant du clic ne garantit
  // plus d'aller au bout du geste. Le module refuse de se charger dans ce cas ; ce
  // test verifie qu'il ne le refuse pas avec les valeurs actuelles.
  assert.ok(OPTIONS_FRESHNESS_MS > 0);
});
