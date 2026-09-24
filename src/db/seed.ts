import type { DatabaseSync } from "node:sqlite";

import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { hueSequenceFor, type CategoryKind, type Hue, type LedgerSlug } from "@/lib/types";

/**
 * Donnees initiales.
 *
 * Ce ne sont que des valeurs de depart : tout est renommable, archivable et
 * extensible par l'utilisatrice. Le seed ne s'execute que si le budget vise n'a encore
 * aucune categorie, donc rejouer le demarrage ne recree jamais ce qu'elle a supprime.
 *
 * Les teintes suivent la sequence d'attribution de design/DESIGN_PLAN.md, avec un
 * compteur par nature et deux sens de parcours : les depenses par la tete, les revenus
 * par la queue. Le camembert ne melange jamais les deux natures, donc les six
 * categories de depenses recoivent bien les six premieres teintes, celles dont l'ecart
 * a ete mesure sous daltonisme (11.8 en pastel, contre 9.9 avec un compteur global).
 * Le parcours inverse des revenus supprime en prime tout partage de teinte entre les
 * deux natures.
 *
 * `intensity` reste null partout : chaque categorie suit le reglage global, qui vaut
 * "soft" par defaut.
 */

type SeedCategory = {
  name: string;
  kind: CategoryKind;
  subcategories: string[];
};

/**
 * Categories generiques de depart pour le budget « Joint ».
 */
export const SEED_CATEGORIES_JOINT: SeedCategory[] = [
  {
    name: "Salaire",
    kind: "income",
    subcategories: ["Salaire"],
  },
  {
    name: "Autres revenus",
    kind: "income",
    subcategories: ["Remboursements", "Autre"],
  },
  {
    name: "Logement",
    kind: "expense",
    subcategories: [
      "Loyer ou crédit",
      "Charges",
      "Énergie",
      "Internet",
      "Assurance habitation",
    ],
  },
  {
    name: "Abonnements",
    kind: "expense",
    subcategories: ["Streaming", "Téléphone", "Autre abonnement"],
  },
  {
    name: "Impôts et assurances",
    kind: "expense",
    subcategories: ["Impôts", "Assurances"],
  },
  {
    name: "Transport",
    kind: "expense",
    subcategories: ["Carburant", "Transports en commun", "Entretien"],
  },
  {
    name: "Vie courante",
    kind: "expense",
    subcategories: ["Courses", "Santé et pharmacie"],
  },
  {
    name: "Dépenses perso",
    kind: "expense",
    subcategories: ["Vêtements", "Loisirs", "Coiffeur", "Restaurant", "Cadeaux"],
  },
];

/**
 * Budget « Perso », son compte a elle.
 *
 * Volontairement plus court que le budget du foyer : rien de ce qui pese sur la maison
 * n'a de sens ici, et une liste de vingt lignes dont dix resteront vides rendrait
 * l'ecran illisible sur un telephone. Six categories de depenses, comme le foyer, pour
 * rester dans la plage de teintes mesuree par le designer.
 */
export const SEED_CATEGORIES_PERSO: SeedCategory[] = [
  {
    name: "Salaire",
    kind: "income",
    subcategories: ["Salaire"],
  },
  {
    name: "Autres revenus",
    kind: "income",
    subcategories: ["Remboursements", "Autre"],
  },
  {
    name: "Vie courante",
    kind: "expense",
    subcategories: ["Courses", "Pharmacie"],
  },
  {
    name: "Abonnements perso",
    kind: "expense",
    subcategories: ["Téléphone", "Streaming", "Autre abonnement"],
  },
  {
    name: "Loisirs",
    kind: "expense",
    subcategories: ["Sorties", "Restaurant", "Vacances"],
  },
  {
    name: "Santé",
    kind: "expense",
    subcategories: ["Mutuelle", "Médecin", "Autres soins"],
  },
  {
    name: "Dépenses perso",
    kind: "expense",
    subcategories: ["Vêtements", "Coiffeur", "Cadeaux"],
  },
  {
    name: "Transport",
    kind: "expense",
    subcategories: ["Carburant", "Transports en commun"],
  },
];

export type LedgerDefinition = {
  slug: LedgerSlug;
  name: string;
  categories: SeedCategory[];
};

/**
 * Les deux budgets, dans leur ordre d'affichage. « Joint » d'abord : c'est celui
 * qu'elle ouvre en arrivant, et le defaut de la preference `active_ledger`.
 */
export const LEDGER_DEFINITIONS: LedgerDefinition[] = [
  { slug: "joint", name: "Joint", categories: SEED_CATEGORIES_JOINT },
  { slug: "perso", name: "Perso", categories: SEED_CATEGORIES_PERSO },
];

/** Teinte de la n-ieme categorie d'une nature, en bouclant si la sequence est epuisee. */
export function hueForPosition(kind: CategoryKind, position: number): Hue {
  const sequence = hueSequenceFor(kind);
  return sequence[position % sequence.length] ?? 1;
}

/**
 * Rend l'identifiant de l'unique utilisatrice, en la creant au besoin.
 * L'application est mono-utilisatrice par conception : on prend la premiere ligne,
 * triee pour rester deterministe si une seconde apparaissait un jour.
 */
export function ensureUser(db: DatabaseSync): string {
  const existing = db
    .prepare("SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1")
    .get() as { id: string } | undefined;

  if (existing) return existing.id;

  const id = newId();
  db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(id, nowIso());
  logger.info("Utilisatrice creee", { userId: id });
  return id;
}

/**
 * Cree les budgets manquants et rend leurs identifiants par slug.
 *
 * Idempotent : `ON CONFLICT DO NOTHING` sur UNIQUE(user_id, slug). Appele au demarrage
 * et par la resolution du budget actif, il repare une base ou les budgets manqueraient,
 * par exemple une sauvegarde restauree a la main.
 */
export function ensureLedgers(db: DatabaseSync, userId: string): Map<LedgerSlug, string> {
  const insert = db.prepare(
    `INSERT INTO ledgers (id, user_id, slug, name, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, slug) DO NOTHING`,
  );
  const now = nowIso();

  LEDGER_DEFINITIONS.forEach((definition, index) => {
    insert.run(newId(), userId, definition.slug, definition.name, index, now);
  });

  const rows = db
    .prepare("SELECT id, slug FROM ledgers WHERE user_id = ?")
    .all(userId) as { id: string; slug: string }[];

  return new Map(rows.map((row) => [row.slug as LedgerSlug, row.id]));
}

/**
 * Insere un jeu de categories dans un budget. Sans transaction : l'appelant en tient
 * deja une, que ce soit le seed de demarrage ou une migration.
 */
export function insertSeedCategories(
  db: DatabaseSync,
  userId: string,
  ledgerId: string,
  seed: SeedCategory[],
): void {
  const now = nowIso();
  const insertCategory = db.prepare(
    `INSERT INTO categories
       (id, user_id, ledger_id, name, hue, intensity, kind, sort_order, is_archived, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?)`,
  );
  const insertSubcategory = db.prepare(
    `INSERT INTO subcategories (id, category_id, name, sort_order, is_archived, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  );

  // Le tri repart de zero pour chaque nature : revenus et depenses sont deux
  // listes distinctes a l'ecran, leurs ordres ne doivent pas s'entremeler.
  const orders: Record<CategoryKind, number> = { income: 0, expense: 0 };

  for (const category of seed) {
    const categoryId = newId();
    const position = orders[category.kind];
    insertCategory.run(
      categoryId,
      userId,
      ledgerId,
      category.name,
      hueForPosition(category.kind, position),
      category.kind,
      position,
      now,
    );
    orders[category.kind] += 1;

    category.subcategories.forEach((name, index) => {
      insertSubcategory.run(newId(), categoryId, name, index, now);
    });
  }
}

/** Nombre de categories deja presentes dans un budget, archivees comprises. */
function categoryCount(db: DatabaseSync, ledgerId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS total FROM categories WHERE ledger_id = ?")
    .get(ledgerId) as { total: number } | undefined;
  return row?.total ?? 0;
}

/**
 * Seme les categories initiales de chaque budget, budget par budget.
 *
 * La condition porte sur le budget et non sur l'utilisatrice : sans cela, l'existence
 * du budget joint suffirait a laisser le budget perso vide a jamais.
 */
export function seedCategories(db: DatabaseSync, userId: string): boolean {
  const ledgers = ensureLedgers(db, userId);

  const pending = LEDGER_DEFINITIONS.map((definition) => ({
    definition,
    ledgerId: ledgers.get(definition.slug),
  })).filter(
    (candidate): candidate is { definition: LedgerDefinition; ledgerId: string } =>
      typeof candidate.ledgerId === "string" && categoryCount(db, candidate.ledgerId) === 0,
  );

  if (pending.length === 0) return false;

  // Reentrance : le seed est appele au demarrage hors transaction, mais aussi depuis
  // une migration qui en tient deja une. Un second BEGIN echouerait.
  const owned = !db.isTransaction;
  if (owned) db.exec("BEGIN");
  try {
    for (const { definition, ledgerId } of pending) {
      insertSeedCategories(db, userId, ledgerId, definition.categories);
      logger.info("Categories initiales semees", {
        ledger: definition.slug,
        count: definition.categories.length,
      });
    }
    if (owned) db.exec("COMMIT");
  } catch (error) {
    if (owned) db.exec("ROLLBACK");
    throw error;
  }

  return true;
}
