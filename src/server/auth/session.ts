import { cookies, headers } from "next/headers";

import { newSessionToken, sha256 } from "@/lib/crypto";
import { isExpired, isoInSeconds, nowIso } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { unauthorized } from "@/lib/result";
import {
  deleteSession,
  extendSession,
  findSessionByTokenHash,
  insertSession,
} from "@/server/repositories/auth";

/**
 * Sessions par cookie opaque.
 *
 * Objectif produit : elle ouvre le site et elle est dedans, sans rien taper. D'ou une
 * duree d'un an et une prolongation glissante a chaque visite. Le cookie ne porte
 * qu'un jeton aleatoire de 256 bits ; la base n'en garde que l'empreinte SHA-256, donc
 * une fuite du fichier SQLite ne permet pas de fabriquer un cookie valide.
 */

export const SESSION_DURATION_SECONDS = 365 * 24 * 60 * 60;

/**
 * On ne reecrit l'echeance en base qu'au dela de ce seuil. Sans cela, chaque
 * navigation, y compris un simple aller-retour entre deux ecrans, declencherait une
 * ecriture disque pour ne gagner que quelques secondes de duree de vie.
 */
const SLIDING_WRITE_THRESHOLD_SECONDS = 60 * 60;

export type Session = {
  sessionId: string;
  userId: string;
  credentialId: string | null;
};

export function sessionCookieName(): string {
  return getEnv().SESSION_COOKIE_NAME;
}

function cookieOptions(maxAgeSeconds: number) {
  const env = getEnv();
  return {
    httpOnly: true,
    // Secure est indispensable en production, mais le poser en developpement sur
    // http://localhost ferait rejeter le cookie par le navigateur.
    secure: env.isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Cree la session, l'ecrit en base et pose le cookie. A appeler depuis une action. */
export async function startSession(input: {
  userId: string;
  credentialId: string | null;
}): Promise<void> {
  const token = newSessionToken();
  const expiresAt = isoInSeconds(SESSION_DURATION_SECONDS);

  const headerStore = await headers();
  const userAgent = headerStore.get("user-agent");

  insertSession({
    userId: input.userId,
    tokenHash: sha256(token),
    credentialId: input.credentialId,
    expiresAt,
    userAgent: userAgent ? userAgent.slice(0, 300) : null,
  });

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(), token, cookieOptions(SESSION_DURATION_SECONDS));
}

/** Detruit la session courante et efface le cookie. */
export async function endSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (token) deleteSession(sha256(token));
  cookieStore.set(sessionCookieName(), "", cookieOptions(0));
}

/**
 * Lit la session courante, ou null.
 *
 * C'est ici que se fait la verification reelle, pas dans le proxy : le proxy ne
 * regarde que la presence du cookie, sans toucher la base. Une seule barriere, placee
 * au plus pres de la donnee, vaut mieux que deux dont une contournable.
 */
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (!token) return null;

  const row = findSessionByTokenHash(sha256(token));
  if (!row) return null;

  if (isExpired(row.expires_at)) {
    deleteSession(sha256(token));
    return null;
  }

  // Prolongation glissante, ecrite avec parcimonie.
  const lastSeen = Date.parse(row.last_seen_at);
  const staleSeconds = Number.isFinite(lastSeen) ? (Date.now() - lastSeen) / 1000 : Infinity;
  if (staleSeconds > SLIDING_WRITE_THRESHOLD_SECONDS) {
    extendSession(row.id, isoInSeconds(SESSION_DURATION_SECONDS));
  }

  return { sessionId: row.id, userId: row.user_id, credentialId: row.credential_id };
}

/** Variante stricte, pour tout ce qui exige une utilisatrice connectee. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw unauthorized();
  return session;
}

/** Horodatage courant, expose pour les couches qui journalisent une activite. */
export function touchedAt(): string {
  return nowIso();
}
