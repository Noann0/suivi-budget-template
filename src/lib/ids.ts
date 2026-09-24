import { randomBytes } from "node:crypto";

/** Alphabet URL-safe, sans caractere ambigu a l'oeil. */
const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const ID_LENGTH = 21;

/** Identifiant opaque de 21 caracteres. Aucun entier auto-incremente n'est expose. */
export function newId(): string {
  const bytes = randomBytes(ID_LENGTH);
  let out = "";
  for (let i = 0; i < ID_LENGTH; i += 1) {
    out += ID_ALPHABET[bytes[i]! & 63];
  }
  return out;
}

/**
 * Alphabet des codes tapes a la main : ni O ni 0, ni I ni 1, ni L.
 * Elle lira ce code sur un ecran et le tapera sur un autre appareil, souvent un
 * telephone. Toute ambiguite visuelle se paie en tentatives ratees.
 */
const HUMAN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Code court a usage unique, groupe par blocs de quatre pour la lisibilite. */
export function newHumanCode(groups = 2, groupSize = 4): string {
  const total = groups * groupSize;
  const bytes = randomBytes(total * 2);
  let raw = "";
  for (let i = 0; i < total; i += 1) {
    // Rejet des valeurs hors plage pour rester uniforme sur 31 symboles.
    let value = bytes[i * 2]!;
    let attempt = 1;
    while (value >= 248 && attempt < 2) {
      value = bytes[i * 2 + 1]!;
      attempt += 1;
    }
    raw += HUMAN_ALPHABET[value % HUMAN_ALPHABET.length];
  }
  return raw.match(new RegExp(`.{1,${groupSize}}`, "g"))!.join("-");
}

/** Code de recuperation, plus long : il remplace une passkey perdue. */
export function newRecoveryCode(): string {
  return newHumanCode(4, 5);
}

/** Normalise une saisie de code : majuscules, sans tiret ni espace. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
