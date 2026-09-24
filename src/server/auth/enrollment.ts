import { hashSecret, verifySecret } from "@/lib/crypto";
import { isoInSeconds } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { newHumanCode, newRecoveryCode, normalizeCode } from "@/lib/ids";
import { logger } from "@/lib/logger";
import {
  countCredentials,
  insertEnrollmentCode,
  insertRecoveryCode,
  invalidateOpenRecoveryCodes,
  listClosedEnrollmentCodes,
  listClosedRecoveryCodes,
  listOpenEnrollmentCodes,
  listOpenRecoveryCodes,
  markEnrollmentCodeUsed,
  markRecoveryCodeUsed,
} from "@/server/repositories/auth";

/**
 * Codes d'enrolement et de recuperation.
 *
 * Les codes sont courts parce qu'ils sont lus sur un ecran et tapes sur un autre
 * appareil. Cette faible entropie impose scrypt, et non un simple SHA-256 : un code de
 * huit caracteres se retrouverait sinon par force brute hors ligne en quelques
 * secondes a partir d'une copie du fichier de base.
 *
 * Consequence directe : on ne peut pas retrouver un code par egalite SQL, il faut
 * parcourir les codes ouverts et les tester un a un. Le volume reste de l'ordre de
 * quelques lignes, et une purge des codes expires borne la croissance.
 */

const DEVICE_CODE_TTL_SECONDS = 10 * 60;
const INITIAL_CODE_TTL_SECONDS = 7 * 24 * 60 * 60;
const RECOVERY_ENROLLMENT_TTL_SECONDS = 15 * 60;

export type CodeKind = "initial" | "device" | "recovery";

/**
 * Seme le code du tout premier enrolement, si et seulement si aucune passkey n'existe.
 * Le code est affiche une fois dans les journaux de demarrage : c'est le seul moment
 * ou il est lisible en clair.
 */
export async function seedInitialEnrollmentCode(): Promise<void> {
  if (countCredentials() > 0) return;

  const env = getEnv();
  if (!env.INITIAL_ENROLLMENT_CODE) {
    logger.warn(
      "Aucune passkey enrolee et INITIAL_ENROLLMENT_CODE absent : " +
        "personne ne peut se connecter. Definis cette variable puis redemarre.",
    );
    return;
  }

  const alreadyOpen = listOpenEnrollmentCodes().some((row) => row.kind === "initial");
  if (alreadyOpen) {
    logger.info("Code d'enrolement initial deja actif, aucun nouveau code seme.");
    return;
  }

  insertEnrollmentCode({
    codeHash: await hashSecret(normalizeCode(env.INITIAL_ENROLLMENT_CODE)),
    kind: "initial",
    expiresAt: isoInSeconds(INITIAL_CODE_TTL_SECONDS),
  });

  // La VALEUR du code n'est jamais journalisee. Elle partirait sur stdout, donc dans
  // les journaux Docker, donc dans l'interface web de Dokploy, conserves sans duree
  // definie, alors que ce code vaut un acces total pendant sept jours. On accuse
  // reception, celui qui deploie connait deja la valeur, il vient de la saisir.
  logger.info(
    "Premier enrolement arme : aucune passkey n'existe encore. " +
      "Ouvre le site et saisis la valeur de INITIAL_ENROLLMENT_CODE " +
      "(telle que definie dans les variables d'environnement). Elle expire dans 7 jours.",
  );
}

/**
 * Code a usage unique pour enroler un appareil supplementaire.
 *
 * Aucune limite au nombre d'appareils : chaque appel produit un code independant, et
 * `credentials` accepte autant de lignes que voulu pour une meme utilisatrice. Le
 * troisieme appareil s'enrole exactement comme le deuxieme.
 */
export async function createDeviceCode(): Promise<{ code: string; expiresAt: string }> {
  const code = newHumanCode();
  const expiresAt = isoInSeconds(DEVICE_CODE_TTL_SECONDS);
  insertEnrollmentCode({
    codeHash: await hashSecret(normalizeCode(code)),
    kind: "device",
    expiresAt,
  });
  return { code, expiresAt };
}

/**
 * Verifie un code sans le consommer. Sert a l'etape 1 de l'enrolement, ou l'on doit
 * savoir si le code est bon avant de lancer la ceremonie WebAuthn, sans pour autant
 * bruler le code si l'utilisatrice annule la creation de sa passkey.
 */
export async function findMatchingCode(
  rawCode: string,
): Promise<{ id: string; kind: CodeKind; recoveryCodeId: string | null } | null> {
  const normalized = normalizeCode(rawCode);
  if (normalized.length === 0) return null;

  for (const row of listOpenEnrollmentCodes()) {
    if (await verifySecret(normalized, row.code_hash)) {
      return {
        id: row.id,
        kind: row.kind as CodeKind,
        recoveryCodeId: row.recovery_code_id,
      };
    }
  }
  return null;
}

/**
 * Nombre de codes fermes examines pour expliquer un refus.
 *
 * Chaque ligne examinee coute un scrypt, soit une vingtaine de millisecondes, et ce
 * parcours n'a lieu QU'APRES l'echec du parcours des codes ouverts, sur une route
 * publique. Le plafond borne donc le travail qu'une saisie fausse peut imposer au
 * serveur : au pire une poignee de centaines de millisecondes, deja plafonnees par
 * ailleurs par la limitation de debit. Au-dela des codes recents, l'explication
 * n'interesse plus personne : un code d'appareil vit dix minutes.
 */
const CLOSED_CODES_EXAMINED = 8;
const CLOSED_RECOVERY_CODES_EXAMINED = 5;

/**
 * Pourquoi un code n'a pas ete accepte.
 *
 * "unknown" est le cas par defaut, et c'est le bon defaut : si on ne retrouve le code
 * nulle part, on ne raconte pas a l'utilisatrice qu'il a expire.
 */
export type CodeRejection =
  | { reason: "expired"; kind: CodeKind }
  | { reason: "used"; kind: CodeKind }
  | { reason: "unknown" };

/**
 * Explique un refus, une fois findMatchingCode() revenu bredouille.
 *
 * Arbitrage de securite, assume : distinguer "expire" de "inconnu" revele qu'un code
 * donne a existe. Ce qui est revele n'a aucune valeur pour un attaquant, puisque le
 * code en question est justement celui qui ne marche plus ; et cela ne rapproche
 * d'aucune facon de la decouverte d'un code VIVANT, seul objectif utile, qui reste un
 * tirage dans 31^8 possibilites derriere un scrypt et une limitation de debit.
 * En face, le gain est direct : une personne qui a mal recopie son code n'est plus
 * envoyee redemander un nouveau code, et une personne dont le code a expire cesse de
 * verifier vingt fois sa saisie.
 */
export async function classifyRejectedCode(rawCode: string): Promise<CodeRejection> {
  const normalized = normalizeCode(rawCode);
  if (normalized.length === 0) return { reason: "unknown" };

  for (const row of listClosedEnrollmentCodes(CLOSED_CODES_EXAMINED)) {
    if (!(await verifySecret(normalized, row.code_hash))) continue;
    const kind = row.kind as CodeKind;
    // used_at prime sur l'expiration : un code consomme puis perime a d'abord servi,
    // et c'est cela qu'il faut dire.
    return row.used_at === null ? { reason: "expired", kind } : { reason: "used", kind };
  }
  return { reason: "unknown" };
}

/**
 * Meme role pour un code de secours. Deux issues seulement : "used" couvre aussi bien
 * un code qui a servi qu'un code remplace par un plus recent, faute de colonne pour
 * les distinguer, et le message doit donc rester vrai dans les deux cas.
 */
export async function classifyRejectedRecoveryCode(
  rawCode: string,
): Promise<"used" | "unknown"> {
  const normalized = normalizeCode(rawCode);
  if (normalized.length === 0) return "unknown";

  for (const row of listClosedRecoveryCodes(CLOSED_RECOVERY_CODES_EXAMINED)) {
    if (await verifySecret(normalized, row.code_hash)) return "used";
  }
  return "unknown";
}

/**
 * Marque le code comme utilise. Rend faux si un autre appel l'a consomme entre-temps,
 * ce qui garantit l'usage unique meme en cas de double soumission.
 */
export function consumeCode(id: string): boolean {
  return markEnrollmentCodeUsed(id) === 1;
}

/**
 * Emet un code de recuperation. Rendu en clair une seule et unique fois : il n'est
 * stocke que hache, personne ne pourra le relire ensuite, pas meme le serveur.
 *
 * Les codes precedents encore ouverts sont invalides : sans cela, plusieurs codes de
 * secours valides circuleraient, dont d'anciens notes sur un papier oublie.
 */
export async function issueRecoveryCode(userId: string): Promise<string> {
  invalidateOpenRecoveryCodes(userId);
  const code = newRecoveryCode();
  insertRecoveryCode(userId, await hashSecret(normalizeCode(code)));
  return code;
}

/**
 * Echange un code de recuperation contre un code d'enrolement a duree courte.
 * Chemin de secours quand elle a perdu le telephone qui portait la passkey.
 */
/**
 * Echange un code de recuperation contre un code d'enrolement a duree courte.
 *
 * Le code de secours n'est PAS consomme ici. Il ne le sera qu'a la creation effective
 * de la passkey, dans la meme transaction. Auparavant il etait brule des l'echange :
 * si elle abandonnait a l'ecran suivant, ou si le code d'enrolement expirait, elle
 * avait definitivement perdu son unique moyen de reprendre la main. Ce n'etait pas une
 * attaque, juste une perte d'acces a ses propres donnees, et c'est pire.
 */
export async function redeemRecoveryCode(
  rawCode: string,
): Promise<{ code: string; expiresAt: string } | null> {
  const normalized = normalizeCode(rawCode);
  if (normalized.length === 0) return null;

  for (const row of listOpenRecoveryCodes()) {
    if (!(await verifySecret(normalized, row.code_hash))) continue;

    const code = newHumanCode();
    const expiresAt = isoInSeconds(RECOVERY_ENROLLMENT_TTL_SECONDS);
    insertEnrollmentCode({
      codeHash: await hashSecret(normalizeCode(code)),
      kind: "recovery",
      expiresAt,
      recoveryCodeId: row.id,
    });
    logger.warn("Code de recuperation echange contre un code d'enrolement", {
      userId: row.user_id,
    });
    return { code, expiresAt };
  }
  return null;
}

/** Consomme le code de secours a l'origine d'un enrolement. Synchrone, transactionnel. */
export function consumeRecoveryCode(recoveryCodeId: string): boolean {
  return markRecoveryCodeUsed(recoveryCodeId) === 1;
}
