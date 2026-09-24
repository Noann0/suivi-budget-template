import { execute, queryOne } from "@/db/client";
import { nowIso } from "@/lib/dates";
import {
  COLOR_INTENSITIES,
  DEFAULT_PREFERENCES,
  isLedgerSlug,
  type ColorIntensity,
  type LedgerSlug,
  type UserPreferences,
  type YearMonth,
} from "@/lib/types";

/**
 * Preferences utilisateur, stockees en cle/valeur.
 * Une valeur absente ou devenue invalide retombe sur le defaut plutot que de faire
 * echouer l'affichage : une preference corrompue ne doit jamais empecher d'ouvrir
 * l'application.
 */

const KEY_COLOR_INTENSITY = "color_intensity";
/**
 * Budget affiche par defaut. La valeur est un slug et non un identifiant : une
 * sauvegarde restauree peut porter d'autres identifiants, les slugs eux ne bougent pas.
 */
const KEY_ACTIVE_LEDGER = "active_ledger";
const KEY_OPENING_BALANCE_START = "opening_balance_start";

function readRaw(userId: string, key: string): string | null {
  const row = queryOne<{ value: string }>(
    `SELECT value FROM user_preferences WHERE user_id = ? AND key = ?`,
    [userId, key],
  );
  return row?.value ?? null;
}

function writeRaw(userId: string, key: string, value: string): void {
  execute(
    `INSERT INTO user_preferences (user_id, key, value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [userId, key, value, nowIso()],
  );
}

function isColorIntensity(value: string | null): value is ColorIntensity {
  return value !== null && (COLOR_INTENSITIES as readonly string[]).includes(value);
}

function isYearMonth(value: unknown): value is YearMonth {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { year?: unknown; month?: unknown };
  return (
    Number.isInteger(candidate.year) &&
    (candidate.year as number) >= 2000 &&
    (candidate.year as number) <= 2100 &&
    Number.isInteger(candidate.month) &&
    (candidate.month as number) >= 1 &&
    (candidate.month as number) <= 12
  );
}

function parseOpeningBalanceStart(value: string | null): YearMonth | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isYearMonth(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getPreferences(userId: string): UserPreferences {
  const intensity = readRaw(userId, KEY_COLOR_INTENSITY);
  const ledger = readRaw(userId, KEY_ACTIVE_LEDGER);
  const openingBalanceStart = readRaw(userId, KEY_OPENING_BALANCE_START);

  return {
    colorIntensity: isColorIntensity(intensity) ? intensity : DEFAULT_PREFERENCES.colorIntensity,
    activeLedger: isLedgerSlug(ledger) ? ledger : DEFAULT_PREFERENCES.activeLedger,
    openingBalanceStart: parseOpeningBalanceStart(openingBalanceStart),
  };
}

export function setColorIntensity(userId: string, intensity: ColorIntensity): void {
  writeRaw(userId, KEY_COLOR_INTENSITY, intensity);
}

/**
 * Enregistre le budget actif. L'appelant a deja verifie que ce slug correspond a un
 * budget de cette utilisatrice : cette couche n'ecrit que ce qu'on lui donne.
 */
export function setActiveLedger(userId: string, slug: LedgerSlug): void {
  writeRaw(userId, KEY_ACTIVE_LEDGER, slug);
}

/**
 * Ecriture de maintenance uniquement. Ce module n'est pas une Server Action : aucun
 * navigateur ne peut l'invoquer. L'operateur doit fournir l'identifiant interne de
 * l'utilisatrice cible depuis un contexte serveur controle.
 */
export function setOpeningBalanceStartForOperator(userId: string, start: YearMonth | null): void {
  if (start === null) {
    writeRaw(userId, KEY_OPENING_BALANCE_START, "null");
    return;
  }
  if (!isYearMonth(start)) throw new TypeError("Invalid opening balance start");
  writeRaw(userId, KEY_OPENING_BALANCE_START, JSON.stringify(start));
}
