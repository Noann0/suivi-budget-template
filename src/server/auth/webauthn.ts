import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

import { CEREMONY_TIMEOUT_MS, CHALLENGE_TTL_SECONDS } from "@/lib/authTimings";
import { isoInSeconds } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  consumeChallengeByValue,
  findCredentialByExternalId,
  insertChallenge,
  listCredentials,
  touchCredential,
  type CredentialRow,
} from "@/server/repositories/auth";

/**
 * Ceremonies WebAuthn.
 *
 * Le challenge est stocke en base entre la generation des options et la verification
 * de la reponse, puis consomme. Sans stockage serveur, la verification n'a plus rien a
 * comparer et devient contournable ; un challenge rejouable ouvre une attaque par rejeu.
 *
 * RP_ID et ORIGIN viennent de l'environnement et leur coherence est verifiee au
 * demarrage par getEnv(). C'est le piege classique de WebAuthn : un RP ID qui ne
 * correspond pas a l'origine fait echouer la ceremonie sans message exploitable.
 */

/**
 * Les deux durees de cette ceremonie vivent dans src/lib/authTimings.ts, avec la
 * troisieme qui leur est liee cote client (la fraicheur des options prechargees de
 * l'ecran de connexion, qui en est derivee). Le module est pur et porte lui-meme
 * l'invariant qui les relie : le delai de ceremonie doit rester strictement inferieur
 * a la duree de vie du defi, sinon le navigateur accepte encore une reponse pour un
 * defi que le serveur a deja jete, et l'utilisatrice va au bout du geste pour se voir
 * refuser sans comprendre.
 */

function parseTransports(raw: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AuthenticatorTransportFuture[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Options d'enregistrement d'une nouvelle passkey. */
export async function buildRegistrationOptions(input: {
  userId: string;
  userName: string;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const env = getEnv();
  const existing = listCredentials(input.userId);

  const options = await generateRegistrationOptions({
    rpName: env.RP_NAME,
    rpID: env.RP_ID,
    userName: input.userName,
    userDisplayName: input.userName,
    userID: new TextEncoder().encode(input.userId),
    attestationType: "none",
    timeout: CEREMONY_TIMEOUT_MS,
    // Empeche d'enregistrer deux fois le meme authenticateur : le navigateur
    // previendra au lieu de creer un doublon silencieux.
    excludeCredentials: existing.map((credential) => ({
      id: credential.credential_id,
      transports: parseTransports(credential.transports),
    })),
    authenticatorSelection: {
      residentKey: "required",
      // "required" et non "preferred" : sans cela, une assertion ou l'authentificateur
      // n'a pas verifie l'utilisatrice (ni biometrie ni code) serait acceptee, et un
      // telephone deverrouille poserait suffisamment. Durci AVANT le premier
      // enrolement : le faire plus tard risquerait de verrouiller une credential deja
      // enregistree sous l'ancien reglage.
      userVerification: "required",
    },
  });

  insertChallenge({
    challenge: options.challenge,
    kind: "registration",
    userId: input.userId,
    expiresAt: isoInSeconds(CHALLENGE_TTL_SECONDS),
  });

  return options;
}

/**
 * Consomme le defi PAR VALEUR et retient son verdict.
 *
 * La version precedente devinait le motif du refus en cherchant le mot "challenge"
 * dans le message d'erreur de la bibliotheque. Deviner un motif dans une chaine de
 * caracteres tenue par une dependance est un pari : plusieurs messages distincts de
 * cette bibliotheque contiennent ce mot, un seul signifie "defi expire", et une mise a
 * jour peut les reformuler sans prevenir. Le verdict est desormais un fait constate,
 * pas une inference sur du texte.
 *
 * Trois etats, pas deux. "untested" signifie que la bibliotheque a refuse la reponse
 * AVANT meme de regarder le defi, par exemple sur une reponse malformee : ce n'est pas
 * un defi expire, et le dire serait renvoyer l'utilisatrice vers le mauvais geste.
 */
type ChallengeVerdict = "untested" | "rejected" | "accepted";

function challengeConsumer(kind: "registration" | "authentication"): {
  consume: (challenge: string) => boolean;
  verdict: () => ChallengeVerdict;
} {
  let verdict: ChallengeVerdict = "untested";
  return {
    consume: (challenge: string): boolean => {
      const accepted = consumeChallengeByValue(challenge, kind);
      verdict = accepted ? "accepted" : "rejected";
      return accepted;
    },
    verdict: () => verdict,
  };
}

/**
 * Le message de la bibliotheque contient la valeur du defi rejete. Ce n'est pas un
 * secret, c'est un jeton a usage unique deja perime et deja passe en clair par le
 * navigateur, mais rien ne justifie d'en remplir les journaux : on borne la ligne.
 */
function describeRefusal(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 200 ? `${message.slice(0, 200)}...` : message;
}

export type VerifiedCredential = {
  credentialId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: AuthenticatorTransportFuture[] | undefined;
};

export type RegistrationOutcome =
  | { ok: true; credential: VerifiedCredential }
  | { ok: false; reason: "no_challenge" | "not_verified" | "already_registered" };

/**
 * Verifie une reponse d'enregistrement. N'ECRIT RIEN d'autre que la consommation du
 * challenge.
 *
 * La separation est deliberee : la verification est asynchrone, l'enregistrement doit
 * etre transactionnel avec la consommation du code d'enrolement. Melanger les deux
 * laissait une fenetre ou la passkey etait deja inseree alors que le code venait
 * d'etre consomme ailleurs, ce qui permettait a un meme code de produire plus d'une
 * passkey permanente. L'appelant assemble desormais les deux dans une transaction.
 */
export async function completeRegistration(input: {
  response: RegistrationResponseJSON;
}): Promise<RegistrationOutcome> {
  const env = getEnv();
  const challenge = challengeConsumer("registration");

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      // Consommation PAR VALEUR : seule la ceremonie qui a produit ce challenge peut
      // le retirer. Rend faux si le challenge est inconnu, expire ou deja utilise.
      expectedChallenge: challenge.consume,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      requireUserVerification: true,
    });
  } catch (error) {
    // Un defi expire se distingue d'une signature invalide : dans un cas elle
    // recommence depuis le debut, dans l'autre son appareil a refuse.
    const expired = challenge.verdict() === "rejected";
    logger.warn("Enregistrement WebAuthn refuse", {
      reason: expired ? "challenge_expired" : "verification_failed",
      challengeVerdict: challenge.verdict(),
      detail: describeRefusal(error),
    });
    return { ok: false, reason: expired ? "no_challenge" : "not_verified" };
  }

  if (!verification.verified) {
    logger.warn("Enregistrement WebAuthn refuse", {
      reason: "verification_failed",
      challengeVerdict: challenge.verdict(),
      detail: "verified=false",
    });
    return { ok: false, reason: "not_verified" };
  }

  const { credential } = verification.registrationInfo;
  if (findCredentialByExternalId(credential.id)) {
    // Elle a presente une passkey deja connue du serveur. Le refus est correct, mais
    // sans trace il devient impossible de distinguer ce cas d'un echec cryptographique
    // en lisant les journaux, alors que la conduite a tenir n'est pas la meme.
    logger.warn("Enregistrement WebAuthn refuse", {
      reason: "credential_already_registered",
      credentialIdPrefix: credential.id.slice(0, 8),
    });
    return { ok: false, reason: "already_registered" };
  }

  return {
    ok: true,
    credential: {
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports,
    },
  };
}

/** Options de connexion. Rend null si aucune passkey n'est enrolee. */
export async function buildAuthenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const env = getEnv();

  const options = await generateAuthenticationOptions({
    rpID: env.RP_ID,
    timeout: CEREMONY_TIMEOUT_MS,
    // allowCredentials volontairement vide : les passkeys sont resident keys, le
    // navigateur propose lui-meme celles qu'il connait pour ce domaine. Lister les
    // credentials ici reviendrait a les divulguer a un visiteur non authentifie.
    userVerification: "required",
  });

  insertChallenge({
    challenge: options.challenge,
    kind: "authentication",
    userId: null,
    expiresAt: isoInSeconds(CHALLENGE_TTL_SECONDS),
  });

  return options;
}

export type AuthenticationOutcome =
  | { ok: true; userId: string; credentialRowId: string }
  | { ok: false; reason: "no_challenge" | "unknown_credential" | "not_verified" };

export async function completeAuthentication(
  response: AuthenticationResponseJSON,
): Promise<AuthenticationOutcome> {
  const env = getEnv();

  const credential: CredentialRow | null = findCredentialByExternalId(response.id);
  if (!credential) {
    /**
     * Ce refus sortait de la fonction sans laisser la moindre trace. C'etait le seul
     * chemin d'echec muet de tout le parcours, et c'est precisement celui qu'il faut
     * lire quand quelqu'un dit "mon telephone ne marche plus" : personne ne pouvait
     * savoir, depuis le serveur, si la passkey presentee etait inconnue ou si la
     * signature avait echoue.
     *
     * On journalise un prefixe de l'identifiant presente, pas sa valeur entiere : de
     * quoi rapprocher deux lignes du meme appareil sans recopier un identifiant
     * complet, fourni par l'appelant et non verifie a ce stade, dans les journaux.
     */
    logger.warn("Authentification WebAuthn refusee", {
      reason: "credential_unknown",
      // String() defensif : cette valeur vient du client et n'est pas encore validee.
      credentialIdPrefix: String(response.id).slice(0, 8),
    });
    return { ok: false, reason: "unknown_credential" };
  }

  const challenge = challengeConsumer("authentication");

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      // Meme consommation par valeur que pour l'enregistrement : le challenge signe
      // par SA passkey est celui qui est retire, pas le dernier arrive.
      expectedChallenge: challenge.consume,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      credential: {
        id: credential.credential_id,
        publicKey: credential.public_key,
        counter: credential.counter,
        transports: parseTransports(credential.transports),
      },
      requireUserVerification: true,
    });
  } catch (error) {
    const expired = challenge.verdict() === "rejected";
    logger.warn("Authentification WebAuthn refusee", {
      reason: expired ? "challenge_expired" : "verification_failed",
      challengeVerdict: challenge.verdict(),
      detail: describeRefusal(error),
    });
    return { ok: false, reason: expired ? "no_challenge" : "not_verified" };
  }

  if (!verification.verified) {
    logger.warn("Authentification WebAuthn refusee", {
      reason: "verification_failed",
      challengeVerdict: challenge.verdict(),
      detail: "verified=false",
    });
    return { ok: false, reason: "not_verified" };
  }

  // Le compteur doit etre conserve : sa non-progression trahit un clonage
  // d'authenticateur. Les passkeys synchronisees renvoient souvent 0, on stocke
  // donc la valeur telle quelle sans en faire un critere de rejet.
  touchCredential(credential.id, verification.authenticationInfo.newCounter);

  return { ok: true, userId: credential.user_id, credentialRowId: credential.id };
}
