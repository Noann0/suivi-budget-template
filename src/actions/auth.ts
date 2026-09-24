"use server";

import { headers } from "next/headers";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

import { getDb, transaction } from "@/db/client";
import { ensureUser } from "@/db/seed";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  AppError,
  conflict,
  notFound,
  rateLimited,
  unauthorized,
  validation,
  type ActionResult,
} from "@/lib/result";
import type { DeviceSummary } from "@/lib/types";
import { guarded, withSession } from "@/server/action-helpers";
import {
  classifyRejectedCode,
  classifyRejectedRecoveryCode,
  consumeCode,
  consumeRecoveryCode,
  createDeviceCode,
  findMatchingCode,
  issueRecoveryCode,
  redeemRecoveryCode as redeemRecovery,
} from "@/server/auth/enrollment";
import { endSession, getSession, startSession } from "@/server/auth/session";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  completeAuthentication,
  completeRegistration,
} from "@/server/auth/webauthn";
import {
  acknowledgeRecoveryCodes,
  countCredentials,
  deleteAllSessionsForUser,
  deleteCredential,
  deleteSessionsForCredential,
  hasPendingRecoveryAck,
  insertCredential,
  listCredentials,
  renameCredential,
} from "@/server/repositories/auth";
import {
  checkRateLimit,
  consumeRateLimit,
  rateLimitMessage,
  registerRateLimitFailure,
  RATE_LIMITS,
} from "@/server/rate-limit";

/**
 * Authentification par passkey. Aucun mot de passe nulle part.
 *
 * Plusieurs actions de ce module sont accessibles SANS session : c'est par elles qu'on
 * en obtient une. Elles sont donc toutes bornees, et par deux mecanismes distincts.
 */

const MAX_DEVICE_NAME_LENGTH = 40;
/** Borne appliquee AVANT normalisation et scrypt, pour ne pas payer le hachage. */
const MAX_CODE_INPUT_LENGTH = 64;

/**
 * Identifie l'appelant pour la limitation par adresse.
 *
 * Deux corrections importantes par rapport a la version initiale, qui etait
 * contournable par un simple en-tete :
 *
 * 1. `cf-connecting-ip` n'est lu que si TRUST_CF_CONNECTING_IP est vrai. Le
 *    deploiement retenu place bien Cloudflare en proxy, mais cet en-tete n'est digne
 *    de confiance QUE si l'origine refuse le trafic hors plages Cloudflare. Voir
 *    docs/DEPLOY.md section 5.3 : sans cette restriction, n'importe qui atteint le VPS
 *    en direct et pose la valeur qu'il veut.
 * 2. On lit le DERNIER maillon de X-Forwarded-For, pas le premier. Les proxys ajoutent
 *    a droite sans reecrire ce que le client a envoye : la valeur de gauche est donc
 *    fournie par l'appelant, celle de droite par le dernier proxy traverse.
 *
 * Cette cle reste un ralentisseur, jamais une barriere. La vraie protection est le
 * plafond global ci-dessous, qu'aucun en-tete ne contourne.
 */
async function callerKey(): Promise<string> {
  const headerStore = await headers();

  if (getEnv().TRUST_CF_CONNECTING_IP) {
    const cloudflare = headerStore.get("cf-connecting-ip");
    if (cloudflare) return cloudflare.trim();
  }

  const forwarded = headerStore.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last;
  }

  return headerStore.get("x-real-ip")?.trim() ?? "unknown";
}

type Bucket = { limit: number; windowSeconds: number };

/**
 * Refus pour cause de limitation de debit.
 *
 * Le delai part aussi en donnee, et plus seulement dans la phrase : l'interface le
 * lisait jusqu'ici en cherchant un nombre dans le texte francais, ce qui casse au
 * premier reformulage du message.
 *
 * Le seau est journalise tel quel, adresse comprise. C'est ce qui permet de repondre a
 * la seule question qui compte quand elle appelle en disant qu'elle est bloquee :
 * est-ce elle qui a trop essaye, ou quelqu'un d'autre qui a rempli le plafond global.
 */
function fail(bucket: string, verdict: { retryAfterSeconds: number }): never {
  logger.warn("Limitation de debit atteinte", {
    bucket,
    retryAfterSeconds: verdict.retryAfterSeconds,
  });
  throw rateLimited(rateLimitMessage(verdict.retryAfterSeconds), verdict.retryAfterSeconds);
}

/** Compte chaque appel. Pour les etapes qui ne dependent d'aucun secret. */
function enforceRateLimit(bucket: string, config: Bucket): void {
  const verdict = consumeRateLimit(bucket, config);
  if (!verdict.allowed) fail(bucket, verdict);
}

/**
 * Verifie sans compter, sur le seau par adresse ET sur le seau global.
 *
 * Le plafond global n'est lie a aucune adresse : c'est la seule protection qui tienne
 * si la restriction d'origine Cloudflare est mal posee, et elle ne genera jamais une
 * utilisatrice unique. L'appelant enregistre ensuite l'echec, et seulement l'echec.
 */
function assertAttemptAllowed(perCaller: string, config: Bucket, globalBucket: string, globalConfig: Bucket): void {
  const global = checkRateLimit(globalBucket, globalConfig);
  if (!global.allowed) fail(globalBucket, global);

  const local = checkRateLimit(perCaller, config);
  if (!local.allowed) fail(perCaller, local);
}

/**
 * Enregistre une tentative infructueuse. Une saisie REUSSIE ne consomme rien.
 *
 * Sans cela, un enrolement normal brulait deux jetons sur cinq et il ne restait que
 * trois essais pour recopier un code de huit caracteres d'un ecran vers un telephone.
 * C'est l'entropie du code qui fait la securite, pas ce plafond.
 */
function registerFailure(perCaller: string, config: Bucket, globalBucket: string, globalConfig: Bucket): void {
  registerRateLimitFailure(perCaller, config);
  registerRateLimitFailure(globalBucket, globalConfig);
}

function assertCodeShape(raw: unknown, field = "code"): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw validation("Saisissez le code.", field);
  }
  if (raw.length > MAX_CODE_INPUT_LENGTH) {
    throw validation("Ce code est trop long.", field);
  }
  return raw;
}

function cleanDeviceName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().slice(0, MAX_DEVICE_NAME_LENGTH);
  return name.length === 0 ? null : name;
}

/**
 * Refus d'un code d'enrolement, explique.
 *
 * Le serveur rendait un seul et meme NOT_FOUND pour "inconnu, expire, ou deja
 * utilise". Ces trois situations appellent pourtant trois gestes differents : recopier
 * le code, en redemander un, ou se connecter normalement parce que l'appareil est deja
 * enrole. Le `code` reste NOT_FOUND dans les trois cas, deliberement : l'interface qui
 * ne lit pas encore `reason` se comporte exactement comme avant.
 *
 * La VALEUR du code n'est jamais journalisee, seulement le motif et la sorte de code.
 */
async function rejectEnrollmentCode(raw: string, stage: "start" | "finish"): Promise<AppError> {
  const rejection = await classifyRejectedCode(raw);

  logger.warn("Code d'enrolement refuse", {
    stage,
    reason: rejection.reason,
    ...(rejection.reason === "unknown" ? {} : { codeKind: rejection.kind }),
  });

  if (rejection.reason === "expired") {
    return notFound("Ce code a expiré. Demandez-en un nouveau.", {
      reason: "enrollment_code_expired",
      details: { codeKind: rejection.kind },
    });
  }
  if (rejection.reason === "used") {
    return notFound("Ce code a déjà servi. Demandez-en un nouveau.", {
      reason: "enrollment_code_used",
      details: { codeKind: rejection.kind },
    });
  }
  return notFound("Ce code ne correspond à rien. Vérifiez ce que vous avez tapé.", {
    reason: "enrollment_code_unknown",
  });
}

/**
 * Etape 1 de l'enrolement. Verifie le code SANS le consommer : si l'utilisatrice
 * annule la creation de sa passkey, le code doit rester utilisable. Il ne sera brule
 * qu'a l'etape 2, une fois la passkey reellement creee.
 */
export async function startEnrollment(input: {
  code: string;
}): Promise<ActionResult<{ options: PublicKeyCredentialCreationOptionsJSON }>> {
  return guarded(async () => {
    const raw = assertCodeShape(input.code);
    const caller = `enroll:${await callerKey()}`;

    enforceRateLimit(`enroll-start:${await callerKey()}`, RATE_LIMITS.enrollmentStart);
    assertAttemptAllowed(
      caller,
      RATE_LIMITS.enrollmentVerify,
      "enroll:global",
      RATE_LIMITS.enrollmentGlobal,
    );

    if (!(await findMatchingCode(raw))) {
      registerFailure(caller, RATE_LIMITS.enrollmentVerify, "enroll:global", RATE_LIMITS.enrollmentGlobal);
      throw await rejectEnrollmentCode(raw, "start");
    }

    const userId = ensureUser(getDb());
    const options = await buildRegistrationOptions({ userId, userName: "budget" });
    return { options };
  });
}

/**
 * Etape 2 de l'enrolement. Consomme le code, enregistre la passkey, ouvre la session.
 *
 * Structure imposee par l'atomicite : toute la cryptographie asynchrone est faite
 * d'abord, sans ecrire, puis une seule transaction synchrone consomme le code et
 * insere la credential. `node:sqlite` etant synchrone, cette transaction est
 * indivisible dans la boucle d'evenements. L'ordre precedent (verifier, inserer, puis
 * consommer) laissait un meme code produire plus d'une passkey permanente.
 */
export async function finishEnrollment(input: {
  code: string;
  response: RegistrationResponseJSON;
  deviceName?: string;
}): Promise<ActionResult<{ recoveryCode: string | null }>> {
  return guarded(async () => {
    const raw = assertCodeShape(input.code);
    if (!input.response || typeof input.response !== "object") {
      throw validation("Réponse d'enregistrement invalide.", "response");
    }

    const caller = `enroll:${await callerKey()}`;
    assertAttemptAllowed(
      caller,
      RATE_LIMITS.enrollmentVerify,
      "enroll:global",
      RATE_LIMITS.enrollmentGlobal,
    );

    const match = await findMatchingCode(raw);
    if (!match) {
      registerFailure(caller, RATE_LIMITS.enrollmentVerify, "enroll:global", RATE_LIMITS.enrollmentGlobal);
      throw await rejectEnrollmentCode(raw, "finish");
    }

    // Constate AVANT l'insertion : apres, il y aurait toujours au moins une passkey.
    const isFirstEver = countCredentials() === 0;
    const userId = ensureUser(getDb());

    // Verification cryptographique, asynchrone, sans aucune ecriture metier.
    const outcome = await completeRegistration({ response: input.response });
    if (!outcome.ok) {
      registerFailure(caller, RATE_LIMITS.enrollmentVerify, "enroll:global", RATE_LIMITS.enrollmentGlobal);
      if (outcome.reason === "already_registered") {
        throw conflict("Cette passkey est déjà enregistrée sur ce compte.", {
          reason: "credential_already_registered",
        });
      }
      if (outcome.reason === "no_challenge") {
        /**
         * Le defi a expire, PAS le code : il est toujours valide et n'a pas ete
         * consomme, elle peut reprendre a l'ecran precedent. Ce cas sortait en
         * NOT_FOUND, que l'interface traduisait par "ce code ne fonctionne pas", donc
         * par un mensonge qui l'envoyait redemander un code dont elle n'avait pas
         * besoin. UNAUTHORIZED dit la seule chose vraie : la verification n'a pas
         * abouti, on recommence.
         */
        throw unauthorized("La demande a expiré. Recommencez depuis le début.", {
          reason: "challenge_expired",
          details: { ceremony: "registration" },
        });
      }
      throw unauthorized("La passkey n'a pas pu être vérifiée. Recommencez.", {
        reason: "verification_failed",
        details: { ceremony: "registration" },
      });
    }

    // Tout ou rien : le code est brule et la passkey creee dans le meme geste.
    const credentialRowId = transaction(() => {
      if (!consumeCode(match.id)) {
        // Course perdue : le code etait bon a l'entree de la transaction, un autre
        // appel l'a consomme pendant la ceremonie. Sans trace, ce cas est
        // indiscernable d'un code deja utilise a la saisie, alors qu'il signale une
        // double soumission et non une erreur de l'utilisatrice.
        logger.warn("Code d'enrolement consomme entre la verification et l'insertion", {
          codeKind: match.kind,
        });
        throw conflict("Ce code vient d'être utilisé. Demandez-en un nouveau.", {
          reason: "enrollment_code_race",
          details: { codeKind: match.kind },
        });
      }
      // Le code de secours n'est consomme qu'ici, a la creation effective de la
      // passkey, jamais au moment de l'echange.
      if (match.recoveryCodeId) consumeRecoveryCode(match.recoveryCodeId);

      return insertCredential({
        userId,
        credentialId: outcome.credential.credentialId,
        publicKey: outcome.credential.publicKey,
        counter: outcome.credential.counter,
        transports: outcome.credential.transports,
        deviceName: cleanDeviceName(input.deviceName),
      });
    });

    await startSession({ userId, credentialId: credentialRowId });

    /**
     * Emission du code de secours, au premier enrolement et apres un enrolement de
     * secours. Sans elle, un telephone perdu deux fois signifiait un verrouillage
     * definitif, sans autre issue qu'une edition manuelle du fichier SQLite.
     *
     * NE PAS RETIRER, meme si la valeur rendue parait inutilisee.
     *
     * L'interface ignore volontairement ce `recoveryCode` : la pose du cookie de
     * session declenche une revalidation qui peut emporter l'ecran avant son rendu,
     * donc le code est lu plus tard, sur /code-de-secours, via revealRecoveryCode().
     * On pourrait en conclure que cette emission est un aller-retour scrypt pour rien.
     * C'est faux, et c'est l'effet de bord qui compte, pas la valeur rendue.
     *
     * issueRecoveryCode() insere une ligne dans `recovery_codes` avec
     * `acknowledged_at` a NULL. C'est exactement, et uniquement, ce que detecte
     * hasPendingRecoveryAck(), donc ce qui met `pendingRecoveryAck` a vrai dans
     * getAuthState(), donc ce qui force la redirection vers l'ecran de revelation.
     *
     * Mesure faite sur le serveur construit, juste apres un premier enrolement :
     *   sans cette emission -> pendingRecoveryAck = false -> aucune redirection,
     *                          l'utilisatrice n'obtient JAMAIS de code de secours ;
     *   avec cette emission -> pendingRecoveryAck = true  -> parcours nominal.
     *
     * Le code genere ici est effectivement remplace des le premier appel a
     * revealRecoveryCode(). Ce n'est pas du gaspillage : c'est ce qui arme le
     * garde-fou. Le cout est d'un scrypt, une seule fois dans la vie de
     * l'application.
     */
    const needsRecovery = isFirstEver || match.kind === "recovery";
    return { recoveryCode: needsRecovery ? await issueRecoveryCode(userId) : null };
  });
}

export async function startAuthentication(): Promise<
  ActionResult<{ options: PublicKeyCredentialRequestOptionsJSON }>
> {
  return guarded(async () => {
    // Cette action etait publique et sans aucune borne : quarante appels anonymes
    // suffisaient a remplir la table de challenges en moins d'une seconde.
    enforceRateLimit(`auth-start:${await callerKey()}`, RATE_LIMITS.authenticationStart);
    enforceRateLimit("ceremony:global", RATE_LIMITS.ceremonyGlobal);

    if (countCredentials() === 0) {
      // Cas du tout premier jour, ou d'une base repartie de zero. Rien a reessayer :
      // il faut passer par un code d'enrolement. Ce fait est deja public par
      // getAuthState().hasCredentials, le distinguer ne revele donc rien de neuf.
      logger.warn("Connexion impossible : aucune passkey enregistree", {
        reason: "no_credentials",
      });
      throw notFound("Aucune passkey n'est encore enregistrée sur ce compte.", {
        reason: "no_credentials",
      });
    }
    return { options: await buildAuthenticationOptions() };
  });
}

export async function finishAuthentication(input: {
  response: AuthenticationResponseJSON;
}): Promise<ActionResult<{ ok: true }>> {
  return guarded(async () => {
    if (!input.response || typeof input.response !== "object") {
      throw validation("Réponse de connexion invalide.", "response");
    }

    const caller = `auth:${await callerKey()}`;
    assertAttemptAllowed(
      caller,
      RATE_LIMITS.authenticationVerify,
      "auth:global",
      RATE_LIMITS.authenticationGlobal,
    );

    const outcome = await completeAuthentication(input.response);
    if (!outcome.ok) {
      registerFailure(caller, RATE_LIMITS.authenticationVerify, "auth:global", RATE_LIMITS.authenticationGlobal);
      if (outcome.reason === "unknown_credential") {
        /**
         * La passkey presentee n'existe pas cote serveur : appareil neuf, ou base
         * repartie de zero. C'est le seul de ces trois cas ou l'ecran doit parler du
         * code de secours. Reste en NOT_FOUND, comme avant.
         */
        throw notFound("Cette passkey n'est pas reconnue. Utilisez votre code de récupération.", {
          reason: "credential_unknown",
        });
      }
      if (outcome.reason === "no_challenge") {
        /**
         * Defi expire. C'est le defaut qui a fait echouer un enrolement reel : l'ecran
         * de connexion precharge ses options au montage de la page, donc le compte a
         * rebours du defi tourne pendant qu'elle lit, cherche son telephone ou passe
         * un appel. Au retour, le serveur repondait NOT_FOUND et l'interface annoncait
         * "ce telephone n'est pas encore reconnu", ce qui l'envoyait vers la
         * recuperation alors qu'il suffisait de reappuyer sur le bouton.
         */
        throw unauthorized("La demande a expiré. Recommencez.", {
          reason: "challenge_expired",
          details: { ceremony: "authentication" },
        });
      }
      throw unauthorized("La connexion a échoué. Réessayez.", {
        reason: "verification_failed",
        details: { ceremony: "authentication" },
      });
    }

    await startSession({ userId: outcome.userId, credentialId: outcome.credentialRowId });
    return { ok: true } as const;
  });
}

/**
 * Code court a taper sur un autre appareil. Necessite une session deja valide.
 * Aucune limite au nombre d'appareils : c'est le chemin normal pour le deuxieme comme
 * pour le troisieme.
 */
export async function createEnrollmentCode(): Promise<
  ActionResult<{ code: string; expiresAt: string }>
> {
  return withSession(async (session) => {
    enforceRateLimit(`enroll-create:${session.sessionId}`, RATE_LIMITS.enrollmentCreate);
    return createDeviceCode();
  });
}

/** Chemin de secours : echange le code de recuperation contre un code d'enrolement. */
export async function redeemRecoveryCode(input: {
  code: string;
}): Promise<ActionResult<{ enrollmentCode: string; expiresAt: string }>> {
  return guarded(async () => {
    const raw = assertCodeShape(input.code);
    const caller = `recovery:${await callerKey()}`;
    assertAttemptAllowed(
      caller,
      RATE_LIMITS.recoveryVerify,
      "recovery:global",
      RATE_LIMITS.recoveryGlobal,
    );

    const issued = await redeemRecovery(raw);
    if (!issued) {
      registerFailure(caller, RATE_LIMITS.recoveryVerify, "recovery:global", RATE_LIMITS.recoveryGlobal);

      // Deux issues seulement. "Deja utilise" couvre aussi le code remplace par un
      // plus recent : afficher un nouveau code de secours perime l'ancien, et un
      // papier range depuis six mois tombe donc exactement ici.
      const rejection = await classifyRejectedRecoveryCode(raw);
      logger.warn("Code de recuperation refuse", { reason: rejection });

      if (rejection === "used") {
        throw notFound(
          "Ce code de secours ne vaut plus : il a déjà servi, ou un code plus récent l'a remplacé.",
          { reason: "recovery_code_used" },
        );
      }
      throw notFound("Ce code de secours ne correspond à rien. Vérifiez votre saisie.", {
        reason: "recovery_code_unknown",
      });
    }

    return { enrollmentCode: issued.code, expiresAt: issued.expiresAt };
  });
}

/**
 * Emet un code de secours et le rend EN CLAIR. Session valide requise.
 *
 * Regenere systematiquement et invalide le precedent. C'est la seule facon honnete de
 * reafficher un code : il n'est stocke que hache, donc il est illisible, y compris
 * pour le serveur. Le conserver en clair pour pouvoir le remontrer annulerait tout
 * l'interet du hachage.
 *
 * Consequence a expliquer a l'utilisatrice dans l'interface : afficher un nouveau code
 * rend l'ancien inutilisable. Un papier deja range devient caduc.
 *
 * Ne marque PAS l'acquittement : c'est un geste separe, explicite, cf.
 * acknowledgeRecoveryCode. Tant qu'il n'a pas eu lieu, l'ecran reste impose.
 */
export async function revealRecoveryCode(): Promise<ActionResult<{ recoveryCode: string }>> {
  return withSession(async (session) => {
    enforceRateLimit(`recovery-new:${session.sessionId}`, RATE_LIMITS.enrollmentCreate);
    return { recoveryCode: await issueRecoveryCode(session.userId) };
  });
}

/**
 * Confirme que le code de secours a bien ete lu et mis de cote.
 * Tant que cet acquittement n'a pas eu lieu, getAuthState rend pendingRecoveryAck a
 * vrai et l'interface doit ramener l'utilisatrice sur l'ecran de revelation.
 */
export async function acknowledgeRecoveryCode(): Promise<ActionResult<{ ok: true }>> {
  return withSession((session) => {
    acknowledgeRecoveryCodes(session.userId);
    return { ok: true } as const;
  });
}

export async function logout(): Promise<ActionResult<{ ok: true }>> {
  return guarded(async () => {
    await endSession();
    return { ok: true } as const;
  });
}

/**
 * Ferme toutes les sessions, sur tous les appareils.
 * C'est la contrepartie d'une session d'un an : sans ce bouton, un appareil egare
 * resterait connecte pendant douze mois.
 */
export async function revokeAllSessions(): Promise<ActionResult<{ closed: number }>> {
  return withSession(async (session) => {
    const closed = deleteAllSessionsForUser(session.userId);
    await endSession();
    return { closed };
  });
}

export async function listDevices(): Promise<ActionResult<DeviceSummary[]>> {
  return withSession((session) =>
    listCredentials(session.userId).map((credential) => ({
      id: credential.id,
      deviceName: credential.device_name,
      createdAt: credential.created_at,
      lastUsedAt: credential.last_used_at,
      isCurrent: credential.id === session.credentialId,
    })),
  );
}

/** Renomme un appareil, pour distinguer les porteurs et pas seulement les machines. */
export async function renameDevice(input: {
  id: string;
  deviceName: string;
}): Promise<ActionResult<{ ok: true }>> {
  return withSession((session) => {
    const name = cleanDeviceName(input.deviceName);
    if (!name) throw validation("Donnez un nom à cet appareil.", "deviceName");
    if (!listCredentials(session.userId).some((c) => c.id === input.id)) {
      throw notFound("Cet appareil n'existe pas.");
    }
    renameCredential(session.userId, input.id, name);
    return { ok: true } as const;
  });
}

/**
 * Retire une passkey. Refuse de retirer la derniere : sans elle, plus aucun moyen
 * d'entrer, et l'utilisatrice se verrouillerait dehors d'un seul clic.
 */
export async function removeDevice(input: { id: string }): Promise<ActionResult<{ ok: true }>> {
  return withSession((session) => {
    const credentials = listCredentials(session.userId);
    if (!credentials.some((credential) => credential.id === input.id)) {
      throw notFound("Cet appareil n'existe pas.");
    }
    if (credentials.length <= 1) {
      throw conflict(
        "C'est votre dernière passkey. La retirer vous empêcherait de vous reconnecter. " +
          "Ajoutez d'abord un autre appareil.",
      );
    }

    deleteSessionsForCredential(input.id);
    deleteCredential(session.userId, input.id);
    return { ok: true } as const;
  });
}

/**
 * Etat de session, lu par les ecrans publics et par la coquille de l'application.
 *
 * `pendingRecoveryAck` est le garde-fou du code de secours. Il vaut vrai tant qu'un
 * code a ete emis sans que sa lecture ait ete confirmee. L'interface doit alors
 * rediriger vers l'ecran de revelation, AVANT tout autre ecran.
 *
 * Le probleme resolu : poser le cookie de session dans une Server Action declenche une
 * revalidation du segment courant, donc un re-rendu de la page d'enrolement, qui
 * redirigeait vers l'accueil avant que le code n'ait pu s'afficher. Le code etait
 * genere et hache, et personne ne le voyait jamais. Passer par un etat persistant
 * ferme la question : il n'y a plus de course a gagner entre le client et le serveur,
 * et fermer l'onglet au mauvais moment ne perd plus rien.
 */
export async function getAuthState(): Promise<
  ActionResult<{ authenticated: boolean; hasCredentials: boolean; pendingRecoveryAck: boolean }>
> {
  return guarded(async () => {
    enforceRateLimit(`state:${await callerKey()}`, RATE_LIMITS.authState);
    const session = await getSession();
    return {
      authenticated: session !== null,
      hasCredentials: countCredentials() > 0,
      pendingRecoveryAck: session !== null && hasPendingRecoveryAck(session.userId),
    };
  });
}
