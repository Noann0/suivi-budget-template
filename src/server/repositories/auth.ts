import { execute, query, queryOne } from "@/db/client";
import { isoInSeconds, nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";

/** Acces aux tables d'authentification : credentials, sessions, codes, challenges. */

export type CredentialRow = {
  id: string;
  user_id: string;
  credential_id: string;
  /**
   * node:sqlite rend un Uint8Array adosse a un ArrayBuffer classique. On le type
   * explicitement ainsi : @simplewebauthn refuse un Uint8Array<ArrayBufferLike>,
   * qui pourrait etre adosse a un SharedArrayBuffer.
   */
  public_key: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string | null;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
};

export type SessionRow = {
  id: string;
  user_id: string;
  credential_id: string | null;
  expires_at: string;
  last_seen_at: string;
};

export type EnrollmentCodeRow = {
  id: string;
  code_hash: string;
  kind: string;
  recovery_code_id: string | null;
  expires_at: string;
  used_at: string | null;
};

export type ChallengeRow = {
  id: string;
  challenge: string;
  kind: string;
  user_id: string | null;
  expires_at: string;
};

export function countCredentials(): number {
  const row = queryOne<{ total: number }>(`SELECT COUNT(*) AS total FROM credentials`);
  return row?.total ?? 0;
}

export function listCredentials(userId: string): CredentialRow[] {
  return query<CredentialRow>(
    `SELECT id, user_id, credential_id, public_key, counter, transports,
            device_name, created_at, last_used_at
       FROM credentials WHERE user_id = ? ORDER BY created_at ASC`,
    [userId],
  );
}

export function findCredentialByExternalId(credentialId: string): CredentialRow | null {
  return queryOne<CredentialRow>(
    `SELECT id, user_id, credential_id, public_key, counter, transports,
            device_name, created_at, last_used_at
       FROM credentials WHERE credential_id = ?`,
    [credentialId],
  );
}

export function insertCredential(input: {
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[] | undefined;
  deviceName: string | null;
}): string {
  const id = newId();
  execute(
    `INSERT INTO credentials
       (id, user_id, credential_id, public_key, counter, transports, device_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.credentialId,
      input.publicKey,
      input.counter,
      input.transports ? JSON.stringify(input.transports) : null,
      input.deviceName,
      nowIso(),
    ],
  );
  return id;
}

export function touchCredential(id: string, counter: number): void {
  execute(`UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?`, [
    counter,
    nowIso(),
    id,
  ]);
}

/** Renomme un appareil. Sert a distinguer les porteurs, pas seulement les machines. */
export function renameCredential(userId: string, id: string, deviceName: string): number {
  return execute(`UPDATE credentials SET device_name = ? WHERE id = ? AND user_id = ?`, [
    deviceName,
    id,
    userId,
  ]).changes;
}

export function deleteCredential(userId: string, id: string): number {
  return execute(`DELETE FROM credentials WHERE id = ? AND user_id = ?`, [id, userId]).changes;
}

export function insertSession(input: {
  userId: string;
  tokenHash: string;
  credentialId: string | null;
  expiresAt: string;
  userAgent: string | null;
}): string {
  const id = newId();
  const now = nowIso();
  execute(
    `INSERT INTO sessions
       (id, user_id, token_hash, credential_id, created_at, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.userId, input.tokenHash, input.credentialId, now, input.expiresAt, now, input.userAgent],
  );
  return id;
}

export function findSessionByTokenHash(tokenHash: string): SessionRow | null {
  return queryOne<SessionRow>(
    `SELECT id, user_id, credential_id, expires_at, last_seen_at
       FROM sessions WHERE token_hash = ?`,
    [tokenHash],
  );
}

export function extendSession(id: string, expiresAt: string): void {
  execute(`UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?`, [
    expiresAt,
    nowIso(),
    id,
  ]);
}

export function deleteSession(tokenHash: string): void {
  execute(`DELETE FROM sessions WHERE token_hash = ?`, [tokenHash]);
}

export function deleteSessionsForCredential(credentialId: string): void {
  execute(`DELETE FROM sessions WHERE credential_id = ?`, [credentialId]);
}

/** Menage des sessions perimees. Appele au demarrage, sans urgence. */
export function purgeExpiredSessions(): number {
  return execute(`DELETE FROM sessions WHERE expires_at <= ?`, [nowIso()]).changes;
}

export function insertEnrollmentCode(input: {
  codeHash: string;
  kind: "initial" | "device" | "recovery";
  expiresAt: string;
  recoveryCodeId?: string | null;
}): string {
  const id = newId();
  execute(
    `INSERT INTO enrollment_codes
       (id, code_hash, kind, recovery_code_id, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [id, input.codeHash, input.kind, input.recoveryCodeId ?? null, input.expiresAt, nowIso()],
  );
  return id;
}

/**
 * Codes encore ouverts. Le code lui-meme n'etant stocke que hache, il faut les
 * parcourir et tester chacun : on ne peut pas retrouver la ligne par une egalite SQL.
 * Le volume reste de l'ordre de quelques lignes, et une purge borne la croissance.
 */
export function listOpenEnrollmentCodes(): EnrollmentCodeRow[] {
  return query<EnrollmentCodeRow>(
    `SELECT id, code_hash, kind, recovery_code_id, expires_at, used_at
       FROM enrollment_codes WHERE used_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC`,
    [nowIso()],
  );
}

/**
 * Codes FERMES : deja consommes, ou perimes. Sert uniquement a expliquer un refus.
 *
 * Sans eux, un code expire et un code jamais emis sont le meme evenement pour le
 * serveur, et l'ecran ne peut que servir la phrase fourre-tout "inconnu, expire ou
 * deja utilise", qui ne dit a l'utilisatrice ni ce qui s'est passe, ni quoi faire.
 *
 * `limit` est un plafond de COUT, pas de justesse : chaque ligne rendue vaut un
 * scrypt, et ce parcours n'a lieu qu'apres l'echec du parcours des codes ouverts.
 * Au-dela des quelques codes recents, l'explication n'aiderait plus personne.
 */
export function listClosedEnrollmentCodes(limit: number): EnrollmentCodeRow[] {
  return query<EnrollmentCodeRow>(
    `SELECT id, code_hash, kind, recovery_code_id, expires_at, used_at
       FROM enrollment_codes WHERE used_at IS NOT NULL OR expires_at <= ?
       ORDER BY created_at DESC LIMIT ?`,
    [nowIso(), limit],
  );
}

export function markEnrollmentCodeUsed(id: string): number {
  return execute(`UPDATE enrollment_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`, [
    nowIso(),
    id,
  ]).changes;
}

/**
 * Duree pendant laquelle un code mort est CONSERVE apres son expiration.
 *
 * Sans ce delai, la purge tourne toutes les dix minutes et efface les codes perimes.
 * Le serveur perd alors le moyen de dire "ce code a expire" : il ne retrouve plus la
 * ligne et repond "ce code n'existe pas", donc "verifiez votre saisie" a quelqu'un qui
 * avait parfaitement bien recopie un code d'appareil, valable dix minutes, tape un
 * quart d'heure trop tard. C'est exactement le message trompeur qu'on cherche a
 * supprimer.
 *
 * Une ligne conservee ne peut rien autoriser : listOpenEnrollmentCodes() exige
 * `used_at IS NULL AND expires_at > maintenant`, et le code n'est stocke que hache.
 * Le cout est d'une poignee de lignes par jour.
 */
const DEAD_CODE_RETENTION_SECONDS = 24 * 60 * 60;

export function purgeExpiredEnrollmentCodes(): number {
  return execute(`DELETE FROM enrollment_codes WHERE expires_at <= ?`, [
    isoInSeconds(-DEAD_CODE_RETENTION_SECONDS),
  ]).changes;
}

export function insertRecoveryCode(userId: string, codeHash: string): void {
  execute(
    `INSERT INTO recovery_codes (id, user_id, code_hash, created_at, used_at, acknowledged_at)
     VALUES (?, ?, ?, ?, NULL, NULL)`,
    [newId(), userId, codeHash, nowIso()],
  );
}

/**
 * Vrai s'il existe un code de secours emis, encore valide, mais dont personne n'a
 * confirme la lecture. C'est ce drapeau qui rend l'etape impossible a rater.
 */
export function hasPendingRecoveryAck(userId: string): boolean {
  const row = queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM recovery_codes
      WHERE user_id = ? AND used_at IS NULL AND acknowledged_at IS NULL`,
    [userId],
  );
  return (row?.total ?? 0) > 0;
}

/** Marque comme lus tous les codes de secours en attente d'acquittement. */
export function acknowledgeRecoveryCodes(userId: string): number {
  return execute(
    `UPDATE recovery_codes SET acknowledged_at = ?
      WHERE user_id = ? AND used_at IS NULL AND acknowledged_at IS NULL`,
    [nowIso(), userId],
  ).changes;
}

export function listOpenRecoveryCodes(): { id: string; user_id: string; code_hash: string }[] {
  return query<{ id: string; user_id: string; code_hash: string }>(
    `SELECT id, user_id, code_hash FROM recovery_codes WHERE used_at IS NULL`,
  );
}

/**
 * Codes de secours FERMES, du plus recent au plus ancien. Sert uniquement a expliquer
 * un refus, jamais a autoriser quoi que ce soit.
 *
 * Attention a la lecture qu'on en fait : `used_at` couvre DEUX evenements distincts,
 * "ce code a servi a enroler un appareil" et "ce code a ete remplace par un plus
 * recent", puisque revealRecoveryCode() invalide les precedents en posant la meme
 * colonne. Le schema ne permet pas de les separer et il ne sera pas touche ici : le
 * motif rendu doit donc couvrir les deux, c'est-a-dire "ce code ne vaut plus".
 */
export function listClosedRecoveryCodes(limit: number): { id: string; code_hash: string }[] {
  return query<{ id: string; code_hash: string }>(
    `SELECT id, code_hash FROM recovery_codes WHERE used_at IS NOT NULL
      ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
}

/** Invalide tous les codes de secours encore ouverts. Appele avant d'en emettre un neuf. */
export function invalidateOpenRecoveryCodes(userId: string): number {
  return execute(
    `UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND used_at IS NULL`,
    [nowIso(), userId],
  ).changes;
}

export function markRecoveryCodeUsed(id: string): number {
  return execute(`UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`, [
    nowIso(),
    id,
  ]).changes;
}

export function insertChallenge(input: {
  challenge: string;
  kind: "registration" | "authentication";
  userId: string | null;
  expiresAt: string;
}): string {
  const id = newId();
  execute(
    `INSERT INTO webauthn_challenges (id, challenge, kind, user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.challenge, input.kind, input.userId, input.expiresAt, nowIso()],
  );
  return id;
}

/**
 * Consomme un challenge PAR SA VALEUR, et non par sa recence.
 *
 * L'ancienne version prenait le challenge le plus recent du type demande, toutes
 * origines confondues. Consequence mesuree : pendant qu'un inconnu appelait la
 * ceremonie en boucle, la passkey de l'utilisatrice signait bien le challenge qu'elle
 * avait recu, mais le serveur depilait celui de l'attaquant. Elle lisait "la connexion
 * a echoue" indefiniment, sans qu'aucun secret ne soit compromis.
 *
 * Consommer par valeur supprime la course par construction : chaque ceremonie ne peut
 * retirer que le challenge qu'elle a elle-meme produit. Le DELETE ... RETURNING rend la
 * lecture et la suppression indivisibles, donc l'usage unique tient meme en cas de
 * double soumission.
 */
export function consumeChallengeByValue(
  challenge: string,
  kind: "registration" | "authentication",
): boolean {
  const row = queryOne<{ id: string }>(
    `DELETE FROM webauthn_challenges
      WHERE challenge = ? AND kind = ? AND expires_at > ?
      RETURNING id`,
    [challenge, kind, nowIso()],
  );
  return row !== null;
}

/** Supprime toutes les sessions d'une utilisatrice. Bouton "deconnecter partout". */
export function deleteAllSessionsForUser(userId: string): number {
  return execute(`DELETE FROM sessions WHERE user_id = ?`, [userId]).changes;
}

/**
 * Borne le nombre de challenges ouverts, quel que soit leur age.
 * La purge par expiration ne suffit pas : un robot peut en creer des milliers en
 * quelques secondes, tous valides pendant cinq minutes.
 */
export function trimChallenges(keep: number): number {
  return execute(
    `DELETE FROM webauthn_challenges
      WHERE id NOT IN (
        SELECT id FROM webauthn_challenges ORDER BY created_at DESC LIMIT ?
      )`,
    [keep],
  ).changes;
}

export function purgeExpiredChallenges(): number {
  return execute(`DELETE FROM webauthn_challenges WHERE expires_at <= ?`, [nowIso()]).changes;
}
