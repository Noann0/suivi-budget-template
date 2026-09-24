import { describeError, logger } from "@/lib/logger";
import { AppError, fail, ok, type ActionResult } from "@/lib/result";
import { requireSession, type Session } from "@/server/auth/session";

/**
 * Enveloppes communes aux Server Actions.
 *
 * Ce fichier ne porte deliberement PAS la directive "use server" : un module ainsi
 * marque ne peut exporter que des fonctions asynchrones, ce qui interdirait d'y placer
 * des utilitaires generiques. Les actions l'importent, il n'est jamais expose au client.
 */

/**
 * Certaines "erreurs" de Next ne sont pas des erreurs : ce sont des signaux de
 * controle. `redirect()` et `notFound()` fonctionnent en levant une exception, et le
 * rendu statique leve une DynamicServerError pour signaler qu'une route doit basculer
 * en dynamique. Les attraper reviendrait a neutraliser un redirect en silence, ou a
 * afficher un faux "une erreur est survenue" a la place d'une navigation.
 *
 * Constate au build : sans ce filtre, la bascule en dynamique d'une page etait
 * journalisee comme une erreur interne non geree.
 */
function isFrameworkSignal(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  // redirect() pose NEXT_REDIRECT, notFound() pose NEXT_HTTP_ERROR_FALLBACK.
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest === "string") {
    if (digest.startsWith("NEXT_REDIRECT")) return true;
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return true;
    if (digest === "NEXT_NOT_FOUND") return true;
    if (digest === "DYNAMIC_SERVER_USAGE") return true;
  }

  const name = (error as { name?: unknown }).name;
  return name === "DynamicServerError" || name === "BailoutToCSRError";
}

function toResult(error: unknown): ActionResult<never> {
  // A relever avant tout traitement : ce n'est pas a nous de decider de leur sort.
  if (isFrameworkSignal(error)) throw error;

  if (error instanceof AppError) {
    // `reason` et `details` doivent traverser : c'est sur eux que les ecrans
    // d'authentification distinguent un defi expire d'une passkey inconnue, deux
    // situations qui portent le meme `code` et appellent des gestes opposes.
    return fail(error.code, error.message, {
      field: error.field,
      reason: error.reason,
      details: error.details,
    });
  }
  // Une erreur non prevue ne doit jamais remonter telle quelle au navigateur : elle
  // fuiterait des details d'implementation. On journalise cote serveur, on rend un
  // message generique cote client.
  logger.error("Erreur non geree dans une Server Action", describeError(error));
  return fail("INTERNAL", "Une erreur est survenue. Réessayez dans un instant.");
}

/** Execute un travail sans exiger de session. */
export async function guarded<T>(work: () => Promise<T> | T): Promise<ActionResult<T>> {
  try {
    return ok(await work());
  } catch (error) {
    return toResult(error);
  }
}

/** Execute un travail en exigeant une session valide. */
export async function withSession<T>(
  work: (session: Session) => Promise<T> | T,
): Promise<ActionResult<T>> {
  try {
    const session = await requireSession();
    return ok(await work(session));
  } catch (error) {
    return toResult(error);
  }
}
