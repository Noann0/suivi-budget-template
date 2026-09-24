import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * scrypt asynchrone, jamais sa variante synchrone.
 *
 * Mesure de l'audit : un scryptSync bloque le fil principal 18 ms. Comme les codes se
 * verifient sur des routes publiques, une soixantaine de requetes par seconde suffisait
 * a figer l'application entiere, sans meme deviner un code. La version asynchrone
 * s'execute dans le pool de threads et rend la main a la boucle d'evenements.
 */
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * Deux regimes de hachage, choisis selon l'entropie du secret et non par preference.
 *
 * - Jeton de session : 256 bits d'alea. SHA-256 nu suffit, aucune attaque par
 *   dictionnaire n'a prise dessus. Un KDF lent ne ferait que ralentir chaque
 *   navigation sans rien apporter.
 * - Code tape a la main : court, entropie faible, donc scrypt avec sel.
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

/** Jeton de session opaque, 32 octets d'alea en base64url. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Empreinte d'un secret a forte entropie. */
export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Hache un secret a faible entropie. Format : scrypt$N$r$p$selBase64$cleBase64. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(secret, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/** Verifie un secret contre son empreinte, en temps constant. Ne leve jamais. */
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;

    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4]!, "base64");
    const expected = Buffer.from(parts[5]!, "base64");
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

    const derived = await scryptAsync(secret, salt, expected.length, { N: n, r, p });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Comparaison de chaines en temps constant, pour des valeurs de meme nature. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
