"use server";

import type { ActionResult } from "@/lib/result";
import type { Ledger } from "@/lib/types";
import { withSession } from "@/server/action-helpers";
import { listLedgers as readLedgers, resolveLedger } from "@/server/services/ledgers";

/**
 * Les budgets de l'utilisatrice : « Joint » pour le foyer, « Perso » pour son compte.
 *
 * Deux univers etanches. Chacun a ses categories, ses mois, ses allocations et sa
 * courbe annuelle, et rien ne se melange dans les totaux. Le budget affiche est une
 * preference, pas un segment d'URL : voir `setActiveLedger` dans `@/actions/preferences`.
 */

/** Liste ordonnee des budgets. Toujours au moins un : les manquants sont crees. */
export async function listLedgers(): Promise<ActionResult<Ledger[]>> {
  return withSession(({ userId }) => readLedgers(userId));
}

/** Budget actuellement ouvert, celui que toutes les autres actions viseront par defaut. */
export async function getActiveLedger(): Promise<ActionResult<Ledger>> {
  return withSession(({ userId }) => resolveLedger(userId));
}
