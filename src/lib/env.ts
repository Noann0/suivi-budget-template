import { z } from "zod";

/**
 * Configuration serveur, validee une fois et mise en cache.
 *
 * Le point sensible est la coherence RP_ID / ORIGIN. Si les deux ne concordent pas,
 * le navigateur refuse la ceremonie WebAuthn sans message exploitable, et on passe
 * une soiree a chercher un bug qui n'existe pas. On verifie donc ici, explicitement,
 * et on refuse de servir plutot que de laisser l'utilisatrice devant un echec muet.
 */

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  /** Chemin du fichier SQLite. En production, dans le volume monte sur /data. */
  DATABASE_PATH: z.string().min(1).default("./data/budget.db"),

  /** Nom de domaine nu : pas de schema, pas de port, pas de barre finale. */
  RP_ID: z.string().min(1).default("localhost"),

  /** Origine complete, avec schema et, en developpement, le port. */
  ORIGIN: z.string().url().default("http://localhost:3000"),

  /** Nom affiche par le gestionnaire de passkeys. */
  RP_NAME: z.string().min(1).default("Suivi budget"),

  /**
   * Code du tout premier enrolement, seme au demarrage si aucune passkey n'existe.
   *
   * Minimum 24 caracteres : ce code vaut un acces total pendant sept jours, et le
   * depot est destine a GitHub. Une valeur courte ou laissee au modele serait le
   * maillon faible de toute l'authentification.
   */
  INITIAL_ENROLLMENT_CODE: z.string().min(24).optional(),

  /**
   * Deploiement arbitre : Cloudflare en proxy, nuage orange. D'ou le defaut a true.
   *
   * ATTENTION, condition de validite : cet en-tete n'est digne de confiance QUE si
   * l'origine refuse tout trafic ne venant pas des plages Cloudflare. Sans cette
   * restriction, n'importe qui tape l'IP du VPS en direct, pose l'en-tete qu'il veut,
   * et la limitation par adresse redevient contournable, avec en prime l'illusion
   * d'etre protege. La marche a suivre est dans docs/DEPLOY.md section 5.3.
   *
   * A passer a false si le nuage repasse au gris. C'est precisement le role de ce
   * drapeau : rendre l'hypothese explicite et la bascule sans changement de code.
   */
  TRUST_CF_CONNECTING_IP: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),

  SESSION_COOKIE_NAME: z.string().min(1).default("budget_session"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema> & { isProduction: boolean };

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    throw new Error(`Configuration invalide. ${details}`);
  }

  const value = parsed.data;

  // Verification de coherence WebAuthn, la plus rentable de tout le fichier.
  let originHost: string;
  try {
    originHost = new URL(value.ORIGIN).hostname;
  } catch {
    throw new Error(`ORIGIN n'est pas une URL valide : ${value.ORIGIN}`);
  }

  const rpMatches = originHost === value.RP_ID || originHost.endsWith(`.${value.RP_ID}`);
  if (!rpMatches) {
    throw new Error(
      `RP_ID ("${value.RP_ID}") ne correspond pas au domaine de ORIGIN ("${originHost}"). ` +
        "WebAuthn echouera silencieusement. RP_ID doit etre le domaine nu, sans schema ni port.",
    );
  }

  if (value.RP_ID.includes("://") || value.RP_ID.includes(":") || value.RP_ID.endsWith("/")) {
    throw new Error(
      `RP_ID doit etre un domaine nu, recu : "${value.RP_ID}". ` +
        'Exemple correct : "budget.example.com".',
    );
  }

  // Refus de demarrer sur une valeur d'exemple. Meme reflexe que pour l'incoherence
  // RP_ID / ORIGIN : mieux vaut un service qui refuse de servir avec un message clair
  // qu'une application ouverte avec un code devinable publie sur GitHub.
  const code = value.INITIAL_ENROLLMENT_CODE;
  if (code) {
    const placeholders = ["change-moi", "changeme", "remplacer", "todo", "example", "exemple"];
    const lowered = code.toLowerCase();
    if (placeholders.some((placeholder) => lowered.startsWith(placeholder))) {
      throw new Error(
        "INITIAL_ENROLLMENT_CODE porte encore une valeur d'exemple. " +
          "Genere une vraie valeur avec `openssl rand -hex 16` avant de demarrer.",
      );
    }
  }

  cached = { ...value, isProduction: value.NODE_ENV === "production" };
  return cached;
}
