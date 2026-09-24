/**
 * Enrolement complet, base vierge, via l'authentificateur virtuel CDP.
 *
 * Prerequis : voir e2e/README.md. En resume, depuis la racine du projet :
 *   npm install --no-save playwright
 *   rm -f data/budget.db data/budget.db-shm data/budget.db-wal
 *   npm run dev &            # relit .env, seme un nouveau code d'enrolement
 *   node e2e/enroll.mjs
 *
 * Variables : INITIAL_CODE doit correspondre exactement a INITIAL_ENROLLMENT_CODE
 * du .env courant (voir la ligne loggee par le serveur au demarrage).
 */
import { chromium } from "playwright";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const CODE = process.env.INITIAL_CODE ?? "qa-test-enrollment-code-0000000000";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const client = await context.newCDPSession(page);

await client.send("WebAuthn.enable");
await client.send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2",
    transport: "internal",
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    // Indispensable : sans simulation de presence, la ceremonie attend un
    // geste humain qui ne viendra jamais et le script reste bloque.
    automaticPresenceSimulation: true,
  },
});

await page.goto(`${BASE}/enroll`, { waitUntil: "networkidle" });
console.log("landed on:", page.url());

// Ecran 1 : saisie du code.
await page.getByPlaceholder(/code que l.administrateur/i).fill(CODE);
await page.getByRole("button", { name: /continuer/i }).click();
await page.waitForTimeout(800);

// Ecran 2 : explication, PUIS seulement le clic declenche navigator.credentials.create().
await page.getByRole("button", { name: /j.y vais/i }).click();
await page.waitForTimeout(2500);

console.log("URL finale:", page.url());
console.log("--- texte visible ---");
console.log((await page.locator("body").innerText()).slice(0, 1500));

await browser.close();
