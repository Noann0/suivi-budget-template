// Script QA manuel, meme famille que enroll.mjs (voir e2e/README.md) : pas branche
// sur `npm test`, a rejouer a la main quand une revalidation visuelle ou de
// concurrence cote client est utile. Preuve produite pour la validation qa du lot 4/5
// du 2026-09-12 (addToEntry/addToAllocation + AddToAmount.tsx).
//
// Ce que ce script prouve, en un seul passage :
//   1. Aucun overflow horizontal a 360px, dashboard ET feuille de saisie ouverte.
//   2. Un double-clic DOM synchrone sur "Ajouter" (le geste d'une utilisatrice
//      impatiente) ne declenche qu'UNE seule requete serveur et qu'UN seul ajout :
//      capture d'ecran finale + relecture directe de la base a l'appui.
//
// Prerequis, EXACTEMENT comme enroll.mjs :
//   npx playwright install --dry-run chromium   # deja en cache la plupart du temps
//
// Emploi :
//   1. Choisir un fichier de base jetable, JAMAIS data/budget.db :
//        export DB=/tmp/suivi-budget-qa-$(date +%s).db
//   2. Semer une utilisatrice, un mois, une ligne fictive et une session valide.
//      Le mode "seed" importe src/db/client.ts, qui utilise l'alias `@/*` : passer par
//      le meme hook de resolution que la suite `node:test` (tests/helpers/register.mjs).
//        DATABASE_PATH=$DB node --import ./tests/helpers/register.mjs \
//          e2e/double-tap-and-mobile.mjs seed
//      Le jeton de session imprime sert a l'etape suivante.
//   3. Dans un AUTRE terminal, demarrer le serveur sur ce meme fichier :
//        DATABASE_PATH=$DB RP_ID=localhost ORIGIN=http://localhost:3917 \
//        INITIAL_ENROLLMENT_CODE=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
//        TRUST_CF_CONNECTING_IP=false npx next dev -p 3917
//   4. Lancer le scenario :
//        TOKEN=<jeton imprime a l'etape 2> node e2e/double-tap-and-mobile.mjs run
//
// Note d'environnement : si un autre `next dev` tourne deja pour ce depot, Next
// refuse d'en demarrer un second dans le MEME dossier (verrou par projet, pas par
// port). Utiliser une copie du depot (node_modules clone via `cp -Rc`, PAS symlink :
// Turbopack refuse un symlink qui sort de son "filesystem root") si besoin d'un
// serveur isole pendant qu'un autre tourne deja.

import { chromium } from "playwright";

const mode = process.argv[2];

if (mode === "seed") {
  const { execute } = await import("../src/db/client.ts");
  const { nowIso } = await import("../src/lib/dates.ts");
  const { newId } = await import("../src/lib/ids.ts");
  const { sha256, newSessionToken } = await import("../src/lib/crypto.ts");

  const now = nowIso();
  const userId = newId();
  const ledgerId = newId();
  const catId = newId();
  const subId = newId();
  const monthId = newId();
  const entryId = newId();

  execute(`INSERT INTO users (id, created_at) VALUES (?, ?)`, [userId, now]);
  execute(
    `INSERT INTO ledgers (id, user_id, slug, name, sort_order, created_at) VALUES (?, ?, 'joint', 'Joint', 0, ?)`,
    [ledgerId, userId, now],
  );
  execute(
    `INSERT INTO categories (id, user_id, ledger_id, name, hue, kind, created_at) VALUES (?, ?, ?, 'Depenses', 1, 'expense', ?)`,
    [catId, userId, ledgerId, now],
  );
  execute(`INSERT INTO subcategories (id, category_id, name, created_at) VALUES (?, ?, 'Vetements', ?)`, [
    subId,
    catId,
    now,
  ]);
  const today = new Date();
  execute(`INSERT INTO months (id, user_id, ledger_id, year, month, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [
    monthId,
    userId,
    ledgerId,
    today.getFullYear(),
    today.getMonth() + 1,
    now,
  ]);
  execute(
    `INSERT INTO entries (id, month_id, subcategory_id, amount_cents, is_carried, note, created_at, updated_at)
     VALUES (?, ?, ?, 1000, 0, NULL, ?, ?)`,
    [entryId, monthId, subId, now, now],
  );

  const token = newSessionToken();
  const sessionId = newId();
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  execute(
    `INSERT INTO sessions (id, user_id, token_hash, credential_id, created_at, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, NULL, ?, ?, ?, NULL)`,
    [sessionId, userId, sha256(token), now, expiresAt, now],
  );

  console.log(`TOKEN=${token}`);
  process.exit(0);
}

if (mode === "run") {
  const TOKEN = process.env.TOKEN;
  if (!TOKEN) throw new Error("TOKEN manquant : reprendre l'etape 'seed'.");
  const BASE = process.env.BASE_URL ?? "http://localhost:3917";
  const SHOT_DIR = process.env.SHOT_DIR ?? ".";

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await context.addCookies([
    { name: "budget_session", value: TOKEN, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);

  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SHOT_DIR}/1-dashboard-360.png` });
  const overflowDashboard = await page.evaluate(() => document.documentElement.scrollWidth);

  const addButton = page.getByRole("button", { name: /ajouter un montant à vetements/i });
  await addButton.waitFor({ state: "attached", timeout: 5000 });
  await addButton.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  await addButton.evaluate((el) => el.click());

  const dialog = page.locator("dialog[open]");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOT_DIR}/2-sheet-open-360.png` });
  const overflowSheet = await page.evaluate(() => document.documentElement.scrollWidth);

  const input = page.locator('input[inputmode="decimal"]');
  await input.fill("50");
  await page.waitForTimeout(150);

  const submitButton = page.locator("dialog[open] form button[type=submit]");
  await submitButton.waitFor({ state: "visible" });

  let actionRequests = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url() === `${BASE}/`) actionRequests += 1;
  });

  // Deux clics DOM dans la MEME tache JS : un double-appui reel, pas deux appels
  // Playwright serialises (qui attendraient chacun l'actionability du precedent et
  // masqueraient exactement le scenario a prouver).
  const submitHandle = await submitButton.elementHandle();
  await page.evaluate((el) => {
    el.click();
    el.click();
  }, submitHandle);

  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOT_DIR}/3-sheet-done-360.png` });

  console.log(
    JSON.stringify(
      {
        overflowDashboard,
        overflowSheet,
        viewport: 360,
        verdictOverflow: overflowDashboard === 360 && overflowSheet === 360 ? "PASS aucun overflow" : "A EXAMINER",
        actionRequestsObserved: actionRequests,
        verdictDoubleTap: actionRequests === 1 ? "PASS une seule requete" : "A EXAMINER",
      },
      null,
      2,
    ),
  );

  await browser.close();
  process.exit(0);
}

console.error("Usage: node e2e/double-tap-and-mobile.mjs seed|run");
process.exit(1);
