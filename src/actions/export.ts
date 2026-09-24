"use server";

import type { ActionResult } from "@/lib/result";
import { withSession } from "@/server/action-helpers";
import { buildCsvExport, buildJsonExport } from "@/server/services/export";

/**
 * Export de tout l'historique. C'est aussi la sauvegarde utilisateur.
 * Le contenu revient sous forme de chaine : le telechargement se declenche cote
 * client a partir d'un Blob, les Server Actions ne rendent pas de flux.
 */

export async function exportJson(): Promise<ActionResult<{ filename: string; content: string }>> {
  return withSession(({ userId }) => buildJsonExport(userId));
}

export async function exportCsv(): Promise<ActionResult<{ filename: string; content: string }>> {
  return withSession(({ userId }) => buildCsvExport(userId));
}
