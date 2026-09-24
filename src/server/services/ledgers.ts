import { getDb } from "@/db/client";
import { ensureLedgers } from "@/db/seed";
import { notFound, validation } from "@/lib/result";
import { DEFAULT_PREFERENCES, isLedgerSlug, type Ledger } from "@/lib/types";
import {
  findLedgerBySlug,
  listLedgerRows,
  type LedgerScope,
} from "@/server/repositories/ledgers";
import { getPreferences } from "@/server/repositories/preferences";

/**
 * Resolution du budget courant.
 *
 * Regle de securite, valable partout : un budget designe par le navigateur n'est
 * jamais utilise tel quel. Il est d'abord retrouve PARMI les budgets de l'utilisatrice
 * connectee, et c'est cette ligne-la, issue de la base, qui sert de perimetre. Le
 * navigateur n'envoie d'ailleurs qu'un slug, jamais un identifiant : meme un slug
 * devine ne donne acces a rien de plus que ses propres budgets.
 */

/**
 * Liste les budgets, en creant les manquants au passage.
 *
 * Cette reparation existe pour un cas precis : une base restaurée a la main, ou une
 * utilisatrice creee avant que les budgets n'existent. Sans elle, l'application
 * s'ouvrirait sur un ecran vide sans aucun moyen de s'en sortir.
 */
export function listLedgers(userId: string): Ledger[] {
  const existing = listLedgerRows(userId);
  if (existing.length > 0) return existing;

  ensureLedgers(getDb(), userId);
  return listLedgerRows(userId);
}

/**
 * Budget vise par une action.
 * `slug` absent : le budget actif des preferences. `slug` fourni : il doit exister
 * chez cette utilisatrice, sinon l'action echoue.
 */
export function resolveLedger(userId: string, slug?: string | null): Ledger {
  if (slug !== undefined && slug !== null) {
    if (!isLedgerSlug(slug)) {
      throw validation("Ce budget n'existe pas.", "ledger");
    }
    const requested = findLedgerBySlug(userId, slug);
    if (!requested) throw notFound("Ce budget n'existe pas.");
    return requested;
  }

  const ledgers = listLedgers(userId);
  if (ledgers.length === 0) {
    // Ne devrait jamais arriver : listLedgers repare. Filet explicite plutot qu'un
    // acces a un tableau vide qui produirait un undefined deux couches plus loin.
    throw notFound("Aucun budget n'est configuré.");
  }

  const preferred = getPreferences(userId).activeLedger;
  return (
    ledgers.find((ledger) => ledger.slug === preferred) ??
    ledgers.find((ledger) => ledger.slug === DEFAULT_PREFERENCES.activeLedger) ??
    ledgers[0]!
  );
}

/** Perimetre complet d'une action : utilisatrice plus budget. */
export function resolveScope(userId: string, slug?: string | null): LedgerScope {
  return { userId, ledgerId: resolveLedger(userId, slug).id };
}
