/**
 * Helpers de calendrier. Convention stricte : le mois va de 1 a 12.
 * Janvier vaut 1, jamais 0. Date.getMonth() est en base zero, c'est la source
 * d'erreur numero un sur ce genre de code, on ne l'utilise jamais brut.
 */

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

export function isValidYearMonth(year: number, month: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    year >= MIN_YEAR &&
    year <= MAX_YEAR &&
    month >= 1 &&
    month <= 12
  );
}

/** Mois precedent, en gerant le passage d'annee (janvier 2027 rend decembre 2026). */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** Horodatage ISO 8601 en UTC, format unique de toutes les colonnes de date. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Horodatage ISO decale de N secondes, pour les expirations. */
export function isoInSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function isExpired(iso: string): boolean {
  const time = Date.parse(iso);
  return !Number.isFinite(time) || time <= Date.now();
}

/** Cle triable d'un mois, du type "2026-08". */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}
