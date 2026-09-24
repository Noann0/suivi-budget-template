/**
 * Amorcage du serveur.
 *
 * Next appelle `register()` une fois au demarrage du processus. C'est ici que les
 * migrations sont jouees et que le code du premier enrolement est seme, donc sans
 * etape manuelle a la mise en production.
 *
 * Deux gardes indispensables :
 * - le runtime, parce que ce fichier est aussi evalue pour l'environnement Edge, ou
 *   node:sqlite et node:fs n'existent pas ;
 * - la phase de build, parce que `next build` execute lui aussi ce code, et que le
 *   volume /data n'existe pas encore dans l'image en cours de construction.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { logger, describeError } = await import("@/lib/logger");

  try {
    const { getDb } = await import("@/db/client");
    const { ensureUser, seedCategories } = await import("@/db/seed");
    const { getSchemaVersion } = await import("@/db/migrate");
    const { seedInitialEnrollmentCode } = await import("@/server/auth/enrollment");
    const {
      purgeExpiredChallenges,
      purgeExpiredEnrollmentCodes,
      purgeExpiredSessions,
      trimChallenges,
    } = await import("@/server/repositories/auth");
    const { purgeOldRateLimits } = await import("@/server/rate-limit");

    // getDb applique les migrations au premier appel.
    const db = getDb();
    logger.info("Schema de base pret", { version: getSchemaVersion(db) });

    const userId = ensureUser(db);
    seedCategories(db, userId);

    await seedInitialEnrollmentCode();

    /**
     * Menage. Au demarrage, puis periodiquement.
     *
     * Le passage au periodique n'est pas cosmetique : les challenges WebAuthn sont
     * creables par un appel public, et un robot peut en inserer des milliers en
     * quelques secondes, tous valides cinq minutes. Une purge qui ne tourne qu'au
     * demarrage laisserait la table grossir sans borne dans le volume /data.
     * `trimChallenges` pose en plus un plafond absolu, independant de l'age.
     */
    const sweep = (): void => {
      try {
        purgeExpiredSessions();
        purgeExpiredEnrollmentCodes();
        purgeExpiredChallenges();
        trimChallenges(200);
        purgeOldRateLimits();
      } catch (error) {
        logger.warn("Menage periodique en echec", describeError(error));
      }
    };

    sweep();

    // unref() : ce minuteur ne doit pas empecher le processus de s'arreter proprement
    // lors d'un redeploiement.
    setInterval(sweep, 10 * 60 * 1000).unref();
  } catch (error) {
    // On journalise et on laisse le processus vivre : /api/health rendra 503 et
    // signalera le probleme, ce qui est plus diagnosticable qu'un conteneur en
    // boucle de redemarrage sans aucun message lisible.
    logger.error("Amorcage du serveur en echec", describeError(error));
  }
}
