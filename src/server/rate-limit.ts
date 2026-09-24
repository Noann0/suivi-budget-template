import { execute, queryOne } from "@/db/client";

/**
 * Limitation de debit par fenetre fixe, stockee en base.
 *
 * En base plutot qu'en memoire, pour deux raisons : un redemarrage du conteneur ne
 * doit pas remettre les compteurs a zero et offrir une fenetre gratuite a un attaquant,
 * et l'etat reste inspectable en cas de doute. Le cout d'ecriture est negligeable a
 * cette echelle.
 */

export type RateLimitVerdict = {
  allowed: boolean;
  /** Secondes a attendre avant de reessayer, quand allowed vaut faux. */
  retryAfterSeconds: number;
};

export const RATE_LIMITS = {
  /**
   * Seaux par IP. Ils ne comptent que les ECHECS : une saisie reussie ne doit pas
   * grignoter le quota. Sans cela, un enrolement normal consommait deux jetons sur
   * cinq et il ne restait que trois essais pour recopier un code de huit caracteres
   * d'un ecran vers un telephone. C'est l'entropie du code qui fait la securite, pas
   * ce plafond.
   */
  enrollmentVerify: { limit: 10, windowSeconds: 15 * 60 },
  authenticationVerify: { limit: 10, windowSeconds: 15 * 60 },
  recoveryVerify: { limit: 5, windowSeconds: 15 * 60 },

  /** Seaux par IP sur les etapes d'ouverture de ceremonie, comptes a chaque appel. */
  enrollmentStart: { limit: 30, windowSeconds: 15 * 60 },
  authenticationStart: { limit: 30, windowSeconds: 15 * 60 },
  authState: { limit: 120, windowSeconds: 15 * 60 },

  /** Seau par session. */
  enrollmentCreate: { limit: 10, windowSeconds: 60 * 60 },

  /**
   * Plafonds GLOBAUX, non lies a l'adresse d'appel.
   *
   * C'est la protection robuste : aucun en-tete ne les contourne, et ils valent que
   * l'application soit derriere un proxy ou exposee en direct. Une seule utilisatrice,
   * donc ces valeurs ne la generont jamais, alors qu'elles bornent durement le travail
   * qu'un inconnu peut imposer au serveur.
   */
  enrollmentGlobal: { limit: 20, windowSeconds: 60 * 60 },
  authenticationGlobal: { limit: 60, windowSeconds: 60 * 60 },
  recoveryGlobal: { limit: 10, windowSeconds: 60 * 60 },
  ceremonyGlobal: { limit: 120, windowSeconds: 60 * 60 },
} as const;

function windowStartFor(windowSeconds: number): number {
  const seconds = Math.floor(Date.now() / 1000);
  return seconds - (seconds % windowSeconds);
}

/**
 * Lit le compteur SANS l'incrementer.
 * Sert aux seaux qui ne comptent que les echecs : on verifie avant d'agir, et on
 * n'enregistre une tentative qu'en cas de resultat negatif.
 */
export function checkRateLimit(
  bucket: string,
  config: { limit: number; windowSeconds: number },
): RateLimitVerdict {
  const start = windowStartFor(config.windowSeconds);
  const row = queryOne<{ count: number }>(
    `SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?`,
    [bucket, String(start)],
  );
  const count = row?.count ?? 0;

  if (count < config.limit) return { allowed: true, retryAfterSeconds: 0 };

  const elapsed = Math.floor(Date.now() / 1000) - start;
  return { allowed: false, retryAfterSeconds: Math.max(1, config.windowSeconds - elapsed) };
}

/** Enregistre une tentative infructueuse dans le seau. */
export function registerRateLimitFailure(
  bucket: string,
  config: { limit: number; windowSeconds: number },
): void {
  const start = windowStartFor(config.windowSeconds);
  execute(
    `INSERT INTO rate_limits (bucket, window_start, count)
     VALUES (?, ?, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1`,
    [bucket, String(start)],
  );
}

/** Incremente le compteur et rend le verdict. Un appel = une tentative comptee. */
export function consumeRateLimit(
  bucket: string,
  config: { limit: number; windowSeconds: number },
): RateLimitVerdict {
  const start = windowStartFor(config.windowSeconds);
  const key = String(start);

  execute(
    `INSERT INTO rate_limits (bucket, window_start, count)
     VALUES (?, ?, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1`,
    [bucket, key],
  );

  const row = queryOne<{ count: number }>(
    `SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?`,
    [bucket, key],
  );
  const count = row?.count ?? 1;

  if (count <= config.limit) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const elapsed = Math.floor(Date.now() / 1000) - start;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, config.windowSeconds - elapsed),
  };
}

/** Message francais pret a afficher, a partir d'un delai en secondes. */
export function rateLimitMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  if (minutes <= 1) return "Trop de tentatives. Réessayez dans une minute.";
  return `Trop de tentatives. Réessayez dans ${minutes} minutes.`;
}

/** Menage des fenetres anciennes, appele au demarrage. */
export function purgeOldRateLimits(): number {
  const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  return execute(`DELETE FROM rate_limits WHERE CAST(window_start AS INTEGER) < ?`, [cutoff])
    .changes;
}
