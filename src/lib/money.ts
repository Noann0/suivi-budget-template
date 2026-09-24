/**
 * Argent. Regle non negociable : tout est en centimes, dans des entiers.
 * Aucun flottant ne traverse cette couche, aucune colonne REAL n'existe en base.
 * Le formatage en euros est un probleme d'affichage, il vit ici uniquement pour
 * l'export CSV qui doit rester lisible par un humain dans Excel.
 */

/** Dix millions d'euros. Borne de garde contre une saisie aberrante. */
export const MAX_AMOUNT_CENTS = 1_000_000_000;

export function isValidAmountCents(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_AMOUNT_CENTS
  );
}

/** Formate des centimes en chaine decimale simple, sans symbole ni separateur de milliers. */
export function centsToDecimalString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${negative ? "-" : ""}${units}.${String(rest).padStart(2, "0")}`;
}

/**
 * Lit une saisie humaine ("12,34", "12.34", "12", "1 234,5") et rend des centimes.
 * Rend null si la chaine n'est pas exploitable. Le calcul passe par des entiers :
 * un Math.round(parseFloat(x) * 100) se trompe sur des valeurs comme 8.115.
 */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.trim().replace(/\s| /g, "").replace(",", ".");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;

  const [unitsPart = "0", decimalsPart = ""] = cleaned.split(".");
  const units = Number(unitsPart);
  const decimals = Number(decimalsPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(units) || !Number.isSafeInteger(decimals)) return null;

  const cents = units * 100 + decimals;
  return cents > MAX_AMOUNT_CENTS ? null : cents;
}
