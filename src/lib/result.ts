/**
 * Resultat uniforme de toutes les Server Actions.
 *
 * On ne leve jamais d'exception pour une erreur metier : en production, une exception
 * traversant une Server Action arrive au client sous forme de digest opaque, donc
 * inaffichable. Une union discriminee garde le message utilisable.
 */

export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "INTERNAL";

/**
 * Motif fin d'un refus d'authentification.
 *
 * Le `code` seul ne suffisait pas : trois situations sans rapport (defi de ceremonie
 * expire, passkey inconnue, aucune passkey enregistree) sortaient toutes en
 * `NOT_FOUND`, et l'ecran refondait ces trois cas en une seule phrase, forcement
 * fausse pour deux d'entre eux. Un simple defi expire s'affichait comme "ce telephone
 * n'est pas encore reconnu", ce qui envoyait vers l'ecran de recuperation alors qu'il
 * suffisait de reappuyer sur le bouton.
 *
 * Ce champ est ADDITIF : `code` garde exactement les valeurs qu'il avait, un client
 * qui l'ignore continue de fonctionner comme avant.
 */
export type AuthErrorReason =
  | "enrollment_code_expired"
  | "enrollment_code_used"
  | "enrollment_code_unknown"
  | "enrollment_code_race"
  | "recovery_code_used"
  | "recovery_code_unknown"
  | "no_credentials"
  | "credential_unknown"
  | "credential_already_registered"
  | "challenge_expired"
  | "verification_failed"
  | "rate_limited";

/**
 * Donnees associees a un motif. Volontairement un ensemble FERME de cles scalaires :
 * la forme elle-meme interdit d'y glisser un code, un secret ou une empreinte, meme
 * par inadvertance. Tout ce qui n'entre pas dans ces cles ne traverse pas.
 */
export type ActionErrorDetails = {
  /** Sorte de code d'enrolement concerne, quand l'erreur porte sur un code. */
  codeKind?: "initial" | "device" | "recovery";
  /** Ceremonie WebAuthn concernee, quand l'erreur porte sur un defi. */
  ceremony?: "registration" | "authentication";
  /** Delai avant nouvelle tentative, en secondes, pour une limitation de debit. */
  retryAfterSeconds?: number;
};

export type ActionError = {
  code: ErrorCode;
  /** Message en francais, destine a etre affiche tel quel a l'utilisatrice. */
  message: string;
  /** Champ fautif, renseigne pour les erreurs de saisie. */
  field?: string;
  /** Motif fin, stable, sur lequel l'interface peut brancher un message juste. */
  reason?: AuthErrorReason;
  /** Complement du motif. Jamais de valeur secrete. */
  details?: ActionErrorDetails;
};

/** Complements optionnels communs aux constructeurs d'erreur. */
export type ErrorExtra = {
  reason?: AuthErrorReason;
  details?: ActionErrorDetails;
};

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  code: ErrorCode,
  message: string,
  extra?: { field?: string } & ErrorExtra,
): ActionResult<T> {
  // Les cles absentes ne sont pas posees a undefined : l'objet reste minimal, et un
  // client qui teste la presence d'une cle ne se fait pas piper par un undefined.
  const error: ActionError = { code, message };
  if (extra?.field !== undefined) error.field = extra.field;
  if (extra?.reason !== undefined) error.reason = extra.reason;
  if (extra?.details !== undefined) error.details = extra.details;
  return { ok: false, error };
}

/** Erreur interne portant un code metier, utilisee dans les couches basses. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;
  readonly reason?: AuthErrorReason;
  readonly details?: ActionErrorDetails;

  constructor(code: ErrorCode, message: string, extra?: { field?: string } & ErrorExtra) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.field = extra?.field;
    this.reason = extra?.reason;
    this.details = extra?.details;
  }
}

export function notFound(message: string, extra?: ErrorExtra): AppError {
  return new AppError("NOT_FOUND", message, extra);
}

export function conflict(message: string, extra?: ErrorExtra): AppError {
  return new AppError("CONFLICT", message, extra);
}

export function validation(message: string, field?: string): AppError {
  return new AppError("VALIDATION", message, { field });
}

export function unauthorized(
  message = "Votre session a expiré, reconnectez-vous.",
  extra?: ErrorExtra,
): AppError {
  return new AppError("UNAUTHORIZED", message, extra);
}

/** Limitation de debit. Le delai est rendu en donnee, pas seulement dans la phrase. */
export function rateLimited(message: string, retryAfterSeconds: number): AppError {
  return new AppError("RATE_LIMITED", message, {
    reason: "rate_limited",
    details: { retryAfterSeconds },
  });
}
