import { centsToDecimalString } from "@/lib/money";
import type { Ledger } from "@/lib/types";
import { listCategories, listSubcategories } from "@/server/repositories/categories";
import type { LedgerScope } from "@/server/repositories/ledgers";
import { listAllocations, listEntries, listMonthRows } from "@/server/repositories/months";
import { getPreferences } from "@/server/repositories/preferences";

import { listLedgers } from "./ledgers";
import { buildMonthView } from "./months";

/**
 * Export de tout l'historique.
 *
 * Ce n'est pas qu'une commodite : c'est aussi la sauvegarde utilisateur. Le contenu
 * doit donc se suffire a lui-meme, categories archivees comprises, sans quoi une
 * restauration perdrait la structure des mois passes.
 *
 * Depuis l'arrivee des deux budgets, chaque ligne exportee dit a quel budget elle
 * appartient. Sans cela, aout 2026 apparaitrait deux fois avec des montants
 * differents et la sauvegarde deviendrait illisible : c'est la meme periode, ce n'est
 * pas le meme argent.
 */

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function scopeOf(userId: string, ledger: Ledger): LedgerScope {
  return { userId, ledgerId: ledger.id };
}

export function buildJsonExport(userId: string): { filename: string; content: string } {
  const budgets = listLedgers(userId).map((ledger) => {
    const scope = scopeOf(userId, ledger);

    const months = listMonthRows(scope).map((row) => {
      const view = buildMonthView(userId, row);
      return {
        year: row.year,
        month: row.month,
        note: row.note,
        totals: view.totals,
        entries: listEntries(row.id),
        allocations: listAllocations(row.id),
      };
    });

    return {
      slug: ledger.slug,
      name: ledger.name,
      categories: listCategories(scope, true),
      subcategories: listSubcategories(scope, true),
      months,
    };
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    // v2 : la structure est desormais groupee par budget. Le numero de schema existe
    // pour qu'une relecture dans deux ans sache a quelle forme elle a affaire.
    schema: "suivi-budget/v2",
    // Rappel explicite dans le fichier lui-meme : sans cela, une relecture dans six
    // mois pourrait interpreter 1234 comme des euros.
    amountUnit: "cents",
    preferences: getPreferences(userId),
    budgets,
  };

  return {
    filename: `suivi-budget-${todayStamp()}.json`,
    content: JSON.stringify(payload, null, 2),
  };
}

/**
 * Echappement CSV : guillemets doubles, doublement des guillemets internes, et
 * neutralisation des cellules interpretables comme des formules.
 *
 * Un texte commencant par =, +, - ou @ est execute comme une formule a l'ouverture
 * dans Excel ou LibreOffice. Ici le risque est auto-inflige, elle seule saisit ces
 * libelles, mais l'export est aussi sa sauvegarde : un fichier de sauvegarde ne doit
 * jamais pouvoir declencher quoi que ce soit a la relecture. Le prefixe apostrophe
 * force le mode texte et coute une ligne.
 */
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  const neutralized = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

export function buildCsvExport(userId: string): { filename: string; content: string } {
  // Colonne « budget » en tete : c'est le premier tri qu'elle fera dans son tableur.
  const header = [
    "budget",
    "annee",
    "mois",
    "type",
    "categorie",
    "sous_categorie",
    "montant_centimes",
    "montant_euros",
    "reporte",
    "note",
  ];

  const lines: string[] = [header.map(csvCell).join(";")];

  for (const ledger of listLedgers(userId)) {
    const scope = scopeOf(userId, ledger);
    const categories = new Map(listCategories(scope, true).map((c) => [c.id, c]));
    const subcategories = new Map(listSubcategories(scope, true).map((s) => [s.id, s]));

    for (const row of listMonthRows(scope).reverse()) {
      for (const entry of listEntries(row.id)) {
        const subcategory = subcategories.get(entry.subcategoryId);
        const category = subcategory ? categories.get(subcategory.categoryId) : undefined;
        lines.push(
          [
            csvCell(ledger.name),
            csvCell(row.year),
            csvCell(row.month),
            csvCell(category?.kind === "income" ? "revenu" : "depense"),
            csvCell(category?.name ?? "(categorie supprimee)"),
            csvCell(subcategory?.name ?? "(sous-categorie supprimee)"),
            csvCell(entry.amountCents),
            csvCell(centsToDecimalString(entry.amountCents).replace(".", ",")),
            csvCell(entry.isCarried ? "oui" : "non"),
            csvCell(entry.note),
          ].join(";"),
        );
      }

      for (const allocation of listAllocations(row.id)) {
        lines.push(
          [
            csvCell(ledger.name),
            csvCell(row.year),
            csvCell(row.month),
            csvCell(allocation.kind === "savings" ? "epargne" : "remboursement"),
            csvCell(allocation.kind === "savings" ? "Epargne" : "Remboursement"),
            csvCell(allocation.label),
            csvCell(allocation.amountCents),
            csvCell(centsToDecimalString(allocation.amountCents).replace(".", ",")),
            csvCell("non"),
            csvCell(null),
          ].join(";"),
        );
      }
    }
  }

  // Separateur point-virgule et BOM UTF-8 : la cible est Excel en locale francaise,
  // qui coupe les colonnes au point-virgule et affiche des accents casses sans BOM.
  const content = `﻿${lines.join("\r\n")}\r\n`;

  return { filename: `suivi-budget-${todayStamp()}.csv`, content };
}
