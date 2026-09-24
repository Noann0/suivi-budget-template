import type { ActionError, ActionErrorDetails, AuthErrorReason } from "@/lib/result";

/**
 * Traduction des refus du serveur en phrases qu'elle comprend.
 *
 * Deux raisons de ne pas afficher `error.message` tel quel sur ces ecrans :
 *
 * 1. Registre. Les messages du serveur tutoient et sont ecrits sans accents
 *    ("Ce code est inconnu, expire ou deja utilise"). Toute l'interface la vouvoie
 *    et porte ses accents. Melanger les deux au moment le plus fragile du parcours
 *    serait le pire endroit pour le faire.
 * 2. Une erreur sans issue est un cul-de-sac. Chaque cas rend donc aussi une action
 *    possible, jamais un simple constat.
 *
 * Le branchement se fait d'abord sur `reason` (docs/API.md section 2.2 bis), et
 * seulement ensuite sur `code`. C'est ce qui repare le defaut d'origine : un defi de
 * ceremonie expire, une passkey inconnue et un compte sans aucune passkey sortent
 * tous les trois en NOT_FOUND cote transport, et les refondre en une phrase unique la
 * renvoyait vers le code de secours pour un simple chronometre depasse. Le repli par
 * `code` reste en place pour tout refus qui ne porterait pas de motif.
 *
 * Trois regles d'ecriture, tenues par chaque message ci-dessous : dire ce qui s'est
 * passe, dire si c'est grave, dire quoi faire maintenant. Jamais de vocabulaire
 * technique, jamais le mot erreur, jamais un code affiche.
 */

export type NextStep =
  /** La saisie est en cause : on marque le champ et elle retape. */
  | "retry"
  /** Rien a retaper, il faut seulement rejouer la fenetre du systeme. */
  | "ceremony"
  /** Reprendre le parcours en cours a son etape precedente. */
  | "restart"
  /** Passer par le code de secours. */
  | "recover"
  /** Enregistrer d'abord cet appareil. */
  | "enroll"
  /** L'appareil est deja connu : elle entre directement. */
  | "login"
  /** Patienter, une securite s'est declenchee. */
  | "wait"
  /** Rien a tenter depuis cet ecran. */
  | "none";

export type FriendlyError = {
  /** Une phrase, sujet verbe complement, sans jargon. */
  message: string;
  /** Ce qu'elle peut faire maintenant. */
  step: NextStep;
};

export type AuthContext = "enroll" | "login" | "recover" | "addDevice";

/**
 * Lien de sortie associe a une suite d'actions.
 *
 * Seuls les pas qui changent d'ecran en produisent un. "retry", "ceremony" et
 * "restart" se jouent sur place, sur le bouton deja present : y ajouter un lien
 * ferait deux propositions concurrentes pour un seul geste.
 */
export function stepLink(step: NextStep): { href: string; label: string } | null {
  switch (step) {
    case "recover":
      return { href: "/recover", label: "Utiliser mon code de secours" };
    case "enroll":
      return { href: "/enroll", label: "Enregistrer cet appareil" };
    case "login":
      return { href: "/login", label: "Aller à la connexion" };
    default:
      return null;
  }
}

/** Repli quand le delai n'est pas rendu en donnee : on le cherche dans la phrase. */
function waitMinutesFromMessage(message: string): number {
  const match = /(\d+)\s*minute/.exec(message);
  const parsed = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Delai d'attente, lu dans `details.retryAfterSeconds` en priorite.
 * L'interface le cherchait jusqu'ici dans le texte francais du serveur, ce qui casse
 * au premier reformulage du message. La donnee ne casse pas.
 */
function waitMessage(error: ActionError): string {
  const seconds = error.details?.retryAfterSeconds;
  const minutes =
    typeof seconds === "number" && seconds > 0
      ? Math.max(1, Math.ceil(seconds / 60))
      : waitMinutesFromMessage(error.message);

  return minutes <= 1
    ? "Il y a eu trop d'essais de suite, c'est une sécurité qui s'est déclenchée. Patientez une minute, puis recommencez."
    : `Il y a eu trop d'essais de suite, c'est une sécurité qui s'est déclenchée. Patientez ${minutes} minutes, puis recommencez.`;
}

/**
 * Message porte par le motif fin.
 *
 * Rend `null` quand le motif ne nous dit rien de plus que le code : l'appelant
 * retombe alors sur la table par code, plus grossiere mais toujours vraie.
 */
function fromReason(
  reason: AuthErrorReason,
  details: ActionErrorDetails | undefined,
  error: ActionError,
): FriendlyError | null {
  const codeKind = details?.codeKind;

  switch (reason) {
    /**
     * Trois codes coexistent avec trois durees de vie tres differentes : dix minutes
     * pour un code d'appareil, sept jours pour le tout premier, un quart d'heure pour
     * celui prepare apres un code de secours. Rien a l'ecran ne les nommait, donc
     * "ce code a expiré" ne disait ni lequel, ni pourquoi si vite, ni quoi faire.
     * `codeKind` permet enfin de le dire sans nommer une mecanique interne.
     */
    case "enrollment_code_expired":
      if (codeKind === "recovery") {
        return {
          message:
            "L'enregistrement préparé pour cet appareil n'a pas abouti à temps : il ne reste valable qu'un quart d'heure. Retapez votre code de secours, un nouvel enregistrement sera préparé aussitôt.",
          step: "recover",
        };
      }
      if (codeKind === "device") {
        return {
          message:
            "Ce code n'est plus valable, il ne dure que dix minutes. Demandez à l'administrateur d'en afficher un nouveau, et tapez-le dans la foulée.",
          step: "retry",
        };
      }
      return {
        message:
          "Ce code n'est plus valable, sa date est passée. Appelez l'administrateur, il peut vous en donner un nouveau tout de suite.",
        step: "retry",
      };

    case "enrollment_code_used":
      if (codeKind === "recovery") {
        return {
          message:
            "Cet enregistrement a déjà servi une fois, et il ne sert qu'une fois. Si c'était bien vous, cet appareil est prêt et vous pouvez entrer directement.",
          step: "login",
        };
      }
      return {
        message:
          "Ce code a déjà servi une fois, et il ne sert qu'une fois. Demandez-en un nouveau à l'administrateur.",
        step: "retry",
      };

    case "enrollment_code_unknown":
      return {
        message:
          "Ce code ne correspond à rien. Vérifiez-le caractère par caractère, en majuscules. Les tirets, eux, n'ont pas d'importance.",
        step: "retry",
      };

    case "enrollment_code_race":
      return {
        message:
          "Ce code vient tout juste d'être utilisé, l'enregistrement est sans doute déjà passé. Essayez d'entrer directement.",
        step: "login",
      };

    case "recovery_code_used":
      return {
        message:
          "Ce code de secours ne vaut plus : il a déjà servi, ou un plus récent l'a remplacé. Si l'administrateur en a noté plusieurs, prenez le dernier. Sinon, appelez-le, il peut en créer un nouveau.",
        step: "retry",
      };

    case "recovery_code_unknown":
      return {
        message:
          "Ce code de secours ne correspond à rien. Recopiez-le en entier, caractère par caractère. Les tirets n'ont pas d'importance, les majuscules non plus.",
        step: "retry",
      };

    case "no_credentials":
      return {
        message:
          "Aucun appareil n'est encore enregistré ici. Il faut commencer par en enregistrer un, avec le code que l'administrateur vous donne.",
        step: "enroll",
      };

    /** Le seul de ces cas ou parler du code de secours est juste. */
    case "credential_unknown":
      return {
        message:
          "Cet appareil n'est pas encore reconnu. S'il est nouveau, enregistrez-le d'abord avec votre code de secours.",
        step: "recover",
      };

    case "credential_already_registered":
      return {
        message:
          "Cet appareil est déjà enregistré, vous n'avez plus besoin de code. Vous pouvez entrer directement.",
        step: "login",
      };

    /**
     * Le defaut qui a fait echouer un enrolement reel. Ce n'est ni un probleme de
     * code, ni un probleme d'appareil : c'est un chronometre depasse entre la
     * preparation de la demande et la reponse. A l'enrolement, le code n'a PAS ete
     * consomme (le serveur ne le brule qu'apres une verification reussie), donc elle
     * n'a aucune raison d'en redemander un.
     */
    case "challenge_expired":
      if (details?.ceremony === "authentication") {
        return {
          message:
            "Cela a pris un peu trop de temps, la demande n'était plus valable. Rien de cassé et rien à retaper : appuyez à nouveau sur le bouton, on repart d'une demande toute neuve.",
          step: "ceremony",
        };
      }
      return {
        message:
          "Cela a pris un peu trop de temps, la demande n'était plus valable. Votre code, lui, n'a pas été utilisé : il reste bon. Appuyez sur Continuer pour reprendre.",
        step: "restart",
      };

    case "verification_failed":
      if (details?.ceremony === "authentication") {
        return {
          message:
            "Votre appareil n'a pas réussi à vous reconnaître. Appuyez à nouveau sur le bouton, et laissez la fenêtre ouverte jusqu'au bout.",
          step: "ceremony",
        };
      }
      return {
        message:
          "L'enregistrement n'est pas allé au bout. Votre code n'a pas été utilisé, il reste bon : appuyez sur Continuer pour reprendre.",
        step: "restart",
      };

    case "rate_limited":
      return { message: waitMessage(error), step: "wait" };

    default:
      return null;
  }
}

export function friendlyActionError(error: ActionError, context: AuthContext): FriendlyError {
  if (error.reason !== undefined) {
    const precise = fromReason(error.reason, error.details, error);
    if (precise !== null) return precise;
  }

  // Repli par code, pour tout refus sans motif. Volontairement plus prudent qu'avant
  // dans ses affirmations : sans motif, on ne sait pas ce qui manque, donc on ne
  // designe ni l'appareil ni le code.
  if (error.code === "RATE_LIMITED") {
    return { message: waitMessage(error), step: "wait" };
  }

  if (error.code === "NOT_FOUND") {
    if (context === "recover") {
      return {
        message:
          "Ce code de secours n'est pas reconnu, ou il a déjà servi. Vérifiez que vous l'avez recopié en entier, sans oublier de caractère.",
        step: "retry",
      };
    }
    if (context === "login") {
      return {
        message:
          "Nous n'avons pas retrouvé de quoi vous reconnaître sur cet appareil. S'il est nouveau, enregistrez-le d'abord avec votre code de secours.",
        step: "recover",
      };
    }
    return {
      message:
        "Ce code ne fonctionne pas. Il a peut-être passé sa date, ou il a déjà servi. Demandez-en un nouveau à l'administrateur.",
      step: "retry",
    };
  }

  if (error.code === "CONFLICT" && (context === "enroll" || context === "addDevice")) {
    return {
      message:
        "Cet appareil est déjà enregistré. Vous pouvez entrer directement, sans code.",
      step: "login",
    };
  }

  if (error.code === "VALIDATION") {
    return { message: "Il manque quelque chose dans ce que vous avez tapé.", step: "retry" };
  }

  if (error.code === "UNAUTHORIZED") {
    return context === "login"
      ? {
          message:
            "La reconnaissance n'a pas abouti. Appuyez à nouveau sur le bouton, cela arrive.",
          step: "ceremony",
        }
      : {
          message: "La vérification n'a pas abouti. Reprenons juste avant, ça arrive.",
          step: "restart",
        };
  }

  return {
    message: "Quelque chose n'a pas fonctionné de notre côté. Réessayez dans un instant.",
    step: "retry",
  };
}

/**
 * Erreurs venues du navigateur pendant la ceremonie WebAuthn.
 *
 * Le cas de loin le plus frequent est `NotAllowedError` : elle a ferme la fenetre du
 * systeme, ou elle a mis trop de temps. Ce n'est pas une panne, et surtout ce n'est
 * pas de sa faute : le message doit le dire. Rien n'est consomme cote serveur dans ce
 * cas, le meme bouton rejoue la meme demande.
 */
export function friendlyWebAuthnError(error: unknown, context: AuthContext): FriendlyError {
  const name = error instanceof Error ? error.name : "";
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.name : "";
  const kind = name === "WebAuthnError" && cause !== "" ? cause : name;

  switch (kind) {
    case "NotAllowedError":
    case "AbortError":
      return {
        message:
          context === "login"
            ? "La fenêtre s'est fermée avant la fin. Appuyez à nouveau sur le bouton, votre appareil vous redemandera de vous identifier."
            : "La fenêtre s'est fermée avant la fin. Ce n'est rien, et votre code n'a pas été utilisé : appuyez à nouveau sur le bouton.",
        step: context === "login" ? "ceremony" : "retry",
      };

    case "InvalidStateError":
      return {
        message:
          "Cet appareil est déjà enregistré. Vous pouvez entrer directement, sans code.",
        step: "login",
      };

    case "NotSupportedError":
    case "ConstraintError":
      return {
        message:
          "Cet appareil ne sait pas faire cette manipulation tout seul. Essayez depuis votre téléphone, ou demandez de l'aide à l'administrateur.",
        step: "none",
      };

    case "SecurityError":
      return {
        message:
          "L'adresse du site ne correspond pas à ce qui est attendu. Vérifiez le lien que vous avez ouvert, ou demandez-en un à l'administrateur.",
        step: "none",
      };

    default:
      return {
        message:
          "Votre appareil n'a pas réussi à répondre. Appuyez à nouveau sur le bouton, et laissez la fenêtre ouverte jusqu'au bout.",
        step: "retry",
      };
  }
}

/**
 * Destination de retour apres connexion.
 *
 * Seul un chemin interne est accepte. `//exemple.com` est une URL absolue pour le
 * navigateur malgre son air de chemin relatif : sans ce filtre, un lien
 * `/login?next=//ailleurs` la deposerait sur un autre site apres sa connexion.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw === "") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}
