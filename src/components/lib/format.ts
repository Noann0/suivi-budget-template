/**
 * Mise en forme des montants.
 *
 * Regle non negociable : les montants arrivent du serveur en centimes entiers.
 * Aucune arithmetique en flottant ici. La separation unites / centimes se fait
 * sur la chaine de caracteres, pas par une division, pour qu'aucun arrondi ne
 * puisse s'inviter.
 *
 * PIEGE MESURE (2026-08-30, Node 24 / ICU 78) :
 * `Intl.NumberFormat("fr-FR").format(1234.56)` rend
 *   U+0031 U+202F U+0032 U+0033 U+0034 U+002C ...
 * Le separateur de milliers est U+202F, l'espace fine insecable. Or ce caractere
 * est ABSENT de Bricolage Grotesque comme de Familjen Grotesk (verifie sur les
 * woff2 servis). Le navigateur tomberait sur une fonte de repli pour ce seul
 * caractere, avec une chasse imprevisible : les colonnes de montants cesseraient
 * de s'aligner alors meme que `tabular-nums` est applique. On normalise donc vers
 * U+00A0, present dans les deux fontes.
 */

const NBSP = "\u00A0";

/** Groupement des milliers, sur un entier. On ne lui confie jamais de decimales. */
const groupFormatter = new Intl.NumberFormat("fr-FR", {
  useGrouping: true,
  maximumFractionDigits: 0,
});

/** Toute espace produite par ICU devient une insecable presente dans nos fontes. */
function normalizeSpaces(value: string): string {
  return value.replace(/[\u202F\u2009\u2007\u00A0\u2060]/g, NBSP);
}

export type FormatOptions = {
  /** Ajoute le symbole euro. Vrai par defaut. */
  symbol?: boolean;
  /** Force le signe + devant un montant positif non nul. */
  forceSign?: boolean;
  /** Rend la valeur absolue : le verdict est porte par un mot, pas par un signe. */
  absolute?: boolean;
};

/**
 * Centimes entiers vers "1 234,56 €".
 * Les espaces rendues sont toutes des U+00A0, voir le commentaire d'en-tete.
 */
export function formatCents(cents: number, options: FormatOptions = {}): string {
  const { symbol = true, forceSign = false, absolute = false } = options;

  const negative = !absolute && cents < 0;
  const digits = String(Math.abs(Math.trunc(cents))).padStart(3, "0");
  const unitsPart = digits.slice(0, -2);
  const centsPart = digits.slice(-2);

  const grouped = normalizeSpaces(groupFormatter.format(Number(unitsPart)));

  let prefix = "";
  if (negative) prefix = "-";
  else if (forceSign && cents > 0) prefix = "+";

  const body = `${prefix}${grouped},${centsPart}`;
  return symbol ? `${body}${NBSP}€` : body;
}

/** Montant sans centimes, pour les axes de graphe ou une phrase courte. */
export function formatCentsRounded(cents: number, options: FormatOptions = {}): string {
  const { symbol = true, absolute = false } = options;
  const negative = !absolute && cents < 0;
  const units = Math.round(Math.abs(cents) / 100);
  const grouped = normalizeSpaces(groupFormatter.format(units));
  const body = `${negative ? "-" : ""}${grouped}`;
  return symbol ? `${body}${NBSP}€` : body;
}

/**
 * Lit une saisie humaine et rend des centimes entiers.
 * Elle tapera "1250,50" sur le clavier Android : la virgule doit passer, l'espace
 * de milliers aussi, sous toutes ses formes.
 * Rend null si la chaine n'est pas exploitable, jamais NaN.
 */
export const MAX_AMOUNT_CENTS = 1_000_000_000;

export function parseAmount(input: string): number | null {
  const cleaned = input
    .replace(/[\s\u00A0\u202F\u2009\u2007]/g, "")
    .replace(/€/g, "")
    .replace(",", ".")
    .trim();

  if (cleaned === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;

  const [unitsPart = "0", decimalsPart = ""] = cleaned.split(".");
  const units = Number(unitsPart);
  if (!Number.isSafeInteger(units)) return null;

  const cents = units * 100 + Number(decimalsPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

/** Centimes vers la valeur editable dans le champ, au format francais. */
export function centsToInputValue(cents: number): string {
  const digits = String(Math.abs(Math.trunc(cents))).padStart(3, "0");
  return `${digits.slice(0, -2)},${digits.slice(-2)}`;
}

/** Part en pourcentage, arrondie a l'entier. Le serveur reste seul maitre des totaux. */
export function formatShare(partCents: number, totalCents: number): string {
  if (totalCents <= 0) return "";
  return `${Math.round((partCents / totalCents) * 100)} %`;
}

const MONTH_NAMES = [
  "janvier", "fevrier", "mars", "avril", "mai", "juin",
  "juillet", "aout", "septembre", "octobre", "novembre", "decembre",
] as const;

const MONTH_NAMES_ACCENTED = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
] as const;

export const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] as const;

/** Mois de 1 a 12, jamais base zero. */
export function monthName(month: number): string {
  return MONTH_NAMES_ACCENTED[month - 1] ?? MONTH_NAMES[month - 1] ?? "";
}

export function monthLabel(year: number, month: number): string {
  const name = monthName(month);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}
