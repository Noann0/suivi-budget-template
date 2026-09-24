/**
 * Types partages entre le serveur et l'interface.
 * Source de verite du contrat decrit dans docs/API.md.
 */

/**
 * Couleur d'une categorie : une teinte, et une intensite optionnelle.
 *
 * La base ne stocke JAMAIS un code hexadecimal. Le mapping teinte vers couleur reelle
 * appartient au frontend, ce qui permet au designer de refondre la palette sans une
 * seule migration.
 */

/** Teinte, de 1 a 16. Voir design/DESIGN_PLAN.md pour la palette correspondante. */
export type Hue = number;

export const MIN_HUE = 1;
export const MAX_HUE = 16;

export function isValidHue(value: unknown): value is Hue {
  return Number.isInteger(value) && (value as number) >= MIN_HUE && (value as number) <= MAX_HUE;
}

export const COLOR_INTENSITIES = ["soft", "vivid"] as const;
export type ColorIntensity = (typeof COLOR_INTENSITIES)[number];

/**
 * Ordre d'attribution automatique d'une teinte a une nouvelle categorie, repris tel
 * quel de design/DESIGN_PLAN.md section 3. La sequence est calculee pour maximiser
 * l'ecart des premieres teintes : avec six categories, l'ecart minimal mesure est de
 * 12.0 en pastel et 13.4 en franche, y compris sous daltonisme.
 * Ne pas reordonner sans refaire la mesure.
 */
export const HUE_SEQUENCE: readonly Hue[] = [
  1, 12, 4, 11, 3, 14, 9, 6, 2, 16, 15, 13, 7, 5, 10, 8,
] as const;


/**
 * Budgets. L'utilisatrice en tient deux : « Joint » pour le foyer, « Perso » pour son
 * compte a elle. Ce sont deux univers etanches : chacun a ses categories, ses mois et
 * ses allocations, et rien ne se melange dans les totaux.
 *
 * Le budget actif n'est pas dans l'URL : il vit dans les preferences. Les adresses
 * /mois/2026/8 et /annee/2026 restent stables, ce qui evite de casser les raccourcis
 * poses sur l'ecran d'accueil du telephone quand elle change de budget.
 */
export const LEDGER_SLUGS = ["joint", "perso"] as const;
export type LedgerSlug = (typeof LEDGER_SLUGS)[number];

export function isLedgerSlug(value: unknown): value is LedgerSlug {
  return typeof value === "string" && (LEDGER_SLUGS as readonly string[]).includes(value);
}

export type Ledger = {
  id: string;
  /** Cle stable manipulee par l'interface. Le nom, lui, reste renommable. */
  slug: LedgerSlug;
  name: string;
  sortOrder: number;
};


export type CategoryKind = "income" | "expense";
export type AllocationKind = "savings" | "debt";

/**
 * Sens de parcours de la sequence, selon la nature de la categorie.
 *
 * Deux compteurs, deux sens : les depenses consomment la sequence par la tete, les
 * revenus par la queue (8, 10, 5, 7, 13...). Mesures du designer sur les six premieres
 * depenses, ecart minimal en pire vision (protanopie et deutéranopie) :
 * compteur global 9.9, compteur par nature 11.8 en pastel, 13.4 en franche. Le
 * camembert n'affiche que des depenses, un compteur global gaspillerait donc ses
 * meilleures teintes sur des revenus qui n'y figurent jamais.
 *
 * Le parcours inverse pour les revenus est un gain gratuit : il supprime tout partage
 * de teinte entre les deux natures tant que le total reste sous seize categories, et
 * porte l'ecart entre les trois premiers revenus a 24.3.
 */
export function hueSequenceFor(kind: CategoryKind): readonly Hue[] {
  return kind === "income" ? [...HUE_SEQUENCE].reverse() : HUE_SEQUENCE;
}


export type Category = {
  id: string;
  name: string;
  kind: CategoryKind;
  hue: Hue;
  /**
   * null signifie "suit le reglage global". C'est le cas normal : le designer
   * recommande un interrupteur unique plutot qu'un choix par categorie, parce qu'un
   * secteur sature au milieu de pastels cree une fausse hierarchie visuelle.
   * La valeur explicite reste possible sans migration si le besoin apparait.
   */
  intensity: ColorIntensity | null;
  sortOrder: number;
  isArchived: boolean;
};

export type Subcategory = {
  id: string;
  categoryId: string;
  name: string;
  sortOrder: number;
  isArchived: boolean;
};

export type CategoryWithSubs = Category & { subcategories: Subcategory[] };

export type Entry = {
  id: string;
  monthId: string;
  subcategoryId: string;
  amountCents: number;
  /** Vrai tant que la ligne vient d'un report automatique non confirme. */
  isCarried: boolean;
  note: string | null;
};

export type Allocation = {
  id: string;
  monthId: string;
  kind: AllocationKind;
  amountCents: number;
  label: string;
};

export type MonthTotals = {
  incomeCents: number;
  expenseCents: number;
  /** income - expense. Peut etre negatif. */
  remainingCents: number;
  savingsCents: number;
  debtCents: number;
  /** remaining - savings - debt. Peut etre negatif, ce n'est pas une erreur. */
  unallocatedCents: number;
};

/** Mois civil utilise par les reglages et les grandeurs calculees. */
export type YearMonth = { year: number; month: number };

/** Montant calcule avant un mois depuis les mois precedents du meme budget. */
export type OpeningBalance = {
  cents: number;
  source: YearMonth | null;
};

export type MonthLine = {
  subcategory: Subcategory;
  /** null quand aucune saisie n'existe pour cette sous-categorie ce mois-la. */
  entry: Entry | null;
  amountCents: number;
};

export type CategoryBlock = {
  category: Category;
  subtotalCents: number;
  lines: MonthLine[];
};

export type MonthView = {
  id: string;
  year: number;
  month: number;
  note: string | null;
  income: CategoryBlock[];
  expense: CategoryBlock[];
  allocations: Allocation[];
  totals: MonthTotals;
  /** Nombre de lignes encore marquees comme reportees et non confirmees. */
  carriedCount: number;
};

export type MonthSummary = {
  id: string;
  year: number;
  month: number;
  totalIncomeCents: number;
  totalExpenseCents: number;
  remainingCents: number;
};

/**
 * Selection des lignes reprises d'un mois sur l'autre.
 *
 * L'apercu ci-dessous existe pour un besoin precis : la reprise etait binaire, tout ou
 * rien. Il fallait pouvoir cocher les lignes a garder AVANT que le mois cible n'existe,
 * donc pouvoir lire ce qui serait repris sans rien creer.
 */

/**
 * Ligne reprenable du mois precedent.
 *
 * Ce n'est pas une `Entry`, et la nuance porte la cle d'identite : l'entree du mois
 * source n'est jamais recopiee telle quelle, seul son montant l'est, sur une ligne
 * neuve du mois cible. Ce qui identifie une ligne d'un mois a l'autre est donc la
 * SOUS-CATEGORIE, exactement la contrainte UNIQUE(month_id, subcategory_id) sur
 * laquelle la copie s'appuie. L'identifiant d'entree, lui, ne survit pas au passage.
 */
export type CarryOverEntryCandidate = {
  /** Cle a renvoyer dans `subcategoryIds` pour garder cette ligne. */
  subcategoryId: string;
  subcategoryName: string;
  categoryId: string;
  categoryName: string;
  categoryKind: CategoryKind;
  categoryHue: Hue;
  categoryIntensity: ColorIntensity | null;
  /** Montant du mois source, en centimes. Toujours strictement positif. */
  amountCents: number;
  /**
   * Vrai si le mois cible porte deja une ligne sur cette sous-categorie. La cocher
   * n'ecrase rien : une ligne deja presente est laissee telle quelle, comme toujours.
   */
  alreadyInTarget: boolean;
};

/**
 * Allocation reprenable : epargne ou remboursement.
 *
 * L'identifiant est celui de l'allocation SOURCE. Les allocations n'ont aucun lien vers
 * une sous-categorie ni vers une entree, elles ne partagent donc aucune cle avec les
 * lignes : c'est une selection independante.
 */
export type CarryOverAllocationCandidate = {
  /** Cle a renvoyer dans `allocationIds` pour garder cette allocation. */
  id: string;
  kind: AllocationKind;
  label: string;
  amountCents: number;
  /** Vrai si le mois cible porte deja ce couple (libelle, nature), casse ignoree. */
  alreadyInTarget: boolean;
};

/**
 * Ce qu'une reprise du mois precedent apporterait. Lecture pure : rien n'est cree, et
 * le mois cible n'a pas besoin d'exister.
 */
export type CarryOverPreview = {
  /** Mois precedent. null : il n'existe pas, il n'y a rien a reprendre. */
  source: { year: number; month: number } | null;
  /** Vrai si le mois cible existe deja : la reprise sera alors un rattrapage. */
  targetExists: boolean;
  /** Ordonnees comme la vue d'un mois : revenus d'abord, depenses ensuite. */
  entries: CarryOverEntryCandidate[];
  allocations: CarryOverAllocationCandidate[];
};

export type YearPoint = {
  month: number;
  /**
   * Faux quand le mois n'a jamais ete cree. A ne pas confondre avec un mois cree
   * et rempli de zeros : la courbe doit s'interrompre, pas afficher un zero rassurant.
   */
  exists: boolean;
  incomeCents: number;
  expenseCents: number;
  remainingCents: number;
  /** Solde d'ouverture calcule avant ce mois, hors des flux mensuels. */
  openingBalanceCents: number;
  /** Solde d'ouverture + unallocatedCents du mois. Peut etre negatif. */
  balanceCents: number;
  savingsCents: number;
  /** Remboursement de dette du mois seul. Miroir exact de savingsCents. */
  debtCents: number;
  cumulativeSavingsCents: number;
  /** Cumul des remboursements depuis janvier de cette annee. */
  cumulativeDebtCents: number;
};

/**
 * Part d'une categorie dans les depenses d'une annee entiere.
 *
 * Meme materiau que `Category` mais aplati : le camembert consomme une teinte et un
 * montant, pas une categorie complete avec ses sous-categories. Aplatir ici evite au
 * frontend de re-deriver la meme chose douze fois.
 */
export type YearCategorySlice = {
  categoryId: string;
  name: string;
  hue: Hue;
  /** null signifie "suit le reglage global", meme convention que Category.intensity. */
  intensity: ColorIntensity | null;
  /**
   * Vrai pour une categorie archivee qui porte encore des montants sur l'annee. Elle
   * figure quand meme dans la repartition : une annee passee reste fidele, exactement
   * comme un mois passe continue d'afficher ses categories archivees depuis.
   */
  isArchived: boolean;
  /** Total sur les douze mois de l'annee, toujours strictement positif. */
  amountCents: number;
};

/**
 * Dette heritee avant le debut de l'annee, rendue pour une lecture analytique du
 * camembert. Ce n'est pas une depense saisie : elle reste hors de `expenseCents`.
 */
export type OpeningBalanceExpenseSlice = {
  kind: "opening-balance-debt";
  name: "Dette antérieure";
  amountCents: number;
  source: YearMonth;
};

/**
 * Revenu herite avant le debut de l'annee, rendu pour une lecture analytique du
 * camembert. Ce n'est pas un revenu saisi : il reste hors de `incomeCents`.
 */
export type OpeningBalanceIncomeSlice = {
  kind: "opening-balance-income";
  name: "Revenu antérieur";
  amountCents: number;
  source: YearMonth;
};

export type YearSeries = {
  year: number;
  /** Toujours douze points, de janvier a decembre, dans l'ordre. */
  points: YearPoint[];
  totals: {
    incomeCents: number;
    expenseCents: number;
    remainingCents: number;
    savingsCents: number;
    debtCents: number;
  };
  /**
   * Repartition des depenses de l'annee par categorie, du plus gros montant au plus
   * petit : le camembert se dessine dans cet ordre sans retri.
   *
   * Une categorie sans depense sur l'annee est absente, pas presente a zero. La somme
   * des parts vaut exactement `totals.expenseCents`, ce qui dispense l'affichage de
   * recalculer un total qui pourrait diverger de celui des cartes.
   */
  expenseByCategory: YearCategorySlice[];
  /**
   * Dette calculee a l'ouverture de janvier, distincte des depenses reelles. Le
   * camembert peut la montrer comme annotation analytique, jamais l'additionner a
   * `expenseByCategory` ni a `totals.expenseCents`.
  */
  openingBalanceExpense: OpeningBalanceExpenseSlice | null;
  /**
   * Revenu calcule a l'ouverture de janvier, distinct des revenus reels. Le
   * camembert peut le montrer comme annotation analytique, jamais l'additionner a
   * `totals.incomeCents`.
   */
  openingBalanceIncome: OpeningBalanceIncomeSlice | null;
};

export type DeviceSummary = {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /** Vrai pour l'appareil qui porte la session courante. */
  isCurrent: boolean;
};

export type UserPreferences = {
  /** Intensite appliquee a toute categorie dont intensity vaut null. */
  colorIntensity: ColorIntensity;
  /**
   * Budget ouvert par defaut, designe par son slug et jamais par son identifiant :
   * une preference doit survivre a une restauration de sauvegarde, ou les identifiants
   * peuvent differer alors que les slugs, eux, sont stables.
   */
  activeLedger: LedgerSlug;
  /** null : la ligne calculee reste masquee. */
  openingBalanceStart: YearMonth | null;
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  colorIntensity: "soft",
  activeLedger: "joint",
  openingBalanceStart: null,
};
