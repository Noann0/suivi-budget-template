import { query, queryOne } from "@/db/client";
import type { Ledger, LedgerSlug } from "@/lib/types";

/** Acces aux budgets. SQL et mapping uniquement. */

type LedgerRow = {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
};

/**
 * Perimetre d'une lecture ou d'une ecriture : une utilisatrice ET un budget.
 *
 * Les deux voyagent ensemble et jamais separement. Le `user_id` reste la frontiere de
 * securite, le `ledger_id` n'est qu'un cloisonnement fonctionnel : un identifiant de
 * budget venu du navigateur ne donne aucun droit tant qu'il n'a pas ete retrouve dans
 * les budgets de cette utilisatrice.
 */
export type LedgerScope = {
  userId: string;
  ledgerId: string;
};

function toLedger(row: LedgerRow): Ledger {
  return {
    id: row.id,
    // Meme convention que `kind` ailleurs dans les repositories : la colonne est
    // ecrite par le seul code de ce depot, on lui fait confiance a la lecture.
    slug: row.slug as LedgerSlug,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

export function listLedgerRows(userId: string): Ledger[] {
  return query<LedgerRow>(
    `SELECT id, slug, name, sort_order FROM ledgers
      WHERE user_id = ? ORDER BY sort_order ASC, name ASC`,
    [userId],
  ).map(toLedger);
}

export function findLedgerBySlug(userId: string, slug: string): Ledger | null {
  const row = queryOne<LedgerRow>(
    `SELECT id, slug, name, sort_order FROM ledgers WHERE user_id = ? AND slug = ?`,
    [userId, slug],
  );
  return row ? toLedger(row) : null;
}

/** Retrouve un budget par identifiant, en verifiant qu'il appartient bien a l'appelante. */
export function findLedgerById(userId: string, id: string): Ledger | null {
  const row = queryOne<LedgerRow>(
    `SELECT id, slug, name, sort_order FROM ledgers WHERE user_id = ? AND id = ?`,
    [userId, id],
  );
  return row ? toLedger(row) : null;
}
