"use server";

import type { ActionResult } from "@/lib/result";
import type { LedgerSlug, YearSeries } from "@/lib/types";
import { withSession } from "@/server/action-helpers";
import { resolveScope } from "@/server/services/ledgers";
import { getYearSeries as buildYearSeries } from "@/server/services/stats";

/**
 * Serie annuelle pour la courbe. Douze points, toujours, meme sans donnee.
 * Un seul budget a la fois : `ledger` absent vaut budget actif.
 *
 * Elle porte aussi la repartition annuelle des depenses par categorie. Une seule
 * lecture pour tout l'ecran de l'annee : une seconde action n'aurait rien apporte
 * qu'un aller-retour de plus a chaque changement de budget.
 */
export async function getYearSeries(input: {
  year: number;
  ledger?: LedgerSlug;
}): Promise<ActionResult<YearSeries>> {
  return withSession(({ userId }) =>
    buildYearSeries(resolveScope(userId, input.ledger), input.year),
  );
}
