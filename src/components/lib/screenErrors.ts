import type { ActionError } from "@/lib/result";

/**
 * Traduction des erreurs serveur pour les ecrans du budget.
 *
 * Meme motif que authMessages, meme raison : les messages du serveur tutoient et
 * sont ecrits sans accents, et certains ne sont pas destines a l'ecran du tout.
 * `unauthorized()` de src/lib/result.ts a pour valeur par defaut
 * "Session expiree, reconnecte-toi." : un texte technique, sans issue, qui laissait
 * l'ecran mort.
 *
 * Regle : une erreur affichee doit toujours dire ce qui s'est passe ET ce qu'elle
 * peut faire ensuite. UNAUTHORIZED n'est jamais affiche, il ramene a la porte.
 */

/**
 * Ou l'on renvoie une session qui n'est plus valide.
 *
 * Le drapeau sert a expliquer la porte : sans lui elle verrait l'ecran de connexion
 * surgir au milieu de sa saisie sans savoir pourquoi.
 */
export const SESSION_EXPIRED_PATH = "/login?expired=1";

export function isUnauthorized(error: ActionError): boolean {
  return error.code === "UNAUTHORIZED";
}

/** Phrase affichable, avec une suite possible, pour tout ce qui n'est pas une session perdue. */
export function screenErrorMessage(error: ActionError): string {
  switch (error.code) {
    case "NOT_FOUND":
      return "Cet élément n'existe plus. Revenez en arrière, l'écran s'est peut-être mis à jour entre-temps.";
    case "CONFLICT":
      return "Ce nom est déjà pris, ou cette opération vient d'être faite. Changez le nom, ou revenez en arrière pour voir l'état actuel.";
    case "VALIDATION":
      // Les messages de validation nomment le champ fautif et sont les seuls du lot
      // a etre reellement utiles tels quels.
      return error.message;
    case "RATE_LIMITED":
      return "Il y a eu trop d'essais de suite. Patientez quelques minutes, puis recommencez.";
    case "UNAUTHORIZED":
      return "Votre session a expiré. Reconnectez-vous pour continuer.";
    default:
      return "Quelque chose n'a pas fonctionné de notre côté. Réessayez dans un instant.";
  }
}
