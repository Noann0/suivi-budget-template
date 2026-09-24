"use server";

import { revalidatePath } from "next/cache";

import { notFound, validation, type ActionResult } from "@/lib/result";
import {
  COLOR_INTENSITIES,
  isLedgerSlug,
  type ColorIntensity,
  type LedgerSlug,
  type UserPreferences,
} from "@/lib/types";
import { withSession } from "@/server/action-helpers";
import { findLedgerBySlug } from "@/server/repositories/ledgers";
import {
  getPreferences as readPreferences,
  setActiveLedger as setActiveLedgerValue,
  setColorIntensity as setColorIntensityValue,
} from "@/server/repositories/preferences";
import { resolveLedger } from "@/server/services/ledgers";

/**
 * Preferences effectives : la valeur stockee, corrigee de ce que la base contient
 * reellement. Si la preference designe un budget qui n'existe pas, on renvoie celui
 * sur lequel l'application va effectivement s'ouvrir, jamais une valeur fantome que
 * l'interface afficherait comme selectionnee.
 */
function effectivePreferences(userId: string): UserPreferences {
  const stored = readPreferences(userId);
  return { ...stored, activeLedger: resolveLedger(userId).slug };
}

export async function getPreferences(): Promise<ActionResult<UserPreferences>> {
  return withSession(({ userId }) => effectivePreferences(userId));
}

/**
 * Interrupteur global d'intensite de palette.
 *
 * Il s'applique a toute categorie dont `intensity` vaut null, c'est a dire a toutes
 * par defaut. Le designer a mesure qu'un secteur sature au milieu de pastels cree une
 * fausse hierarchie visuelle : d'ou un reglage global plutot qu'un choix par categorie.
 */
export async function setColorIntensity(input: {
  intensity: ColorIntensity;
}): Promise<ActionResult<UserPreferences>> {
  return withSession(({ userId }) => {
    if (!(COLOR_INTENSITIES as readonly string[]).includes(input.intensity)) {
      throw validation('L\'intensité doit valoir « soft » ou « vivid ».', "intensity");
    }
    setColorIntensityValue(userId, input.intensity);
    revalidatePath("/");
    return effectivePreferences(userId);
  });
}

/**
 * Bascule le budget actif, « Joint » ou « Perso ».
 *
 * Le budget vit dans les preferences et non dans l'URL : /mois/2026/8 designe le mois
 * d'aout du budget ouvert, quel qu'il soit. Le raccourci pose sur l'ecran d'accueil de
 * son telephone continue donc de fonctionner apres un changement de budget.
 *
 * Securite : le slug recu du navigateur n'est jamais utilise tel quel. Il doit
 * correspondre a un budget appartenant a l'utilisatrice connectee, verifie en base
 * avant toute ecriture.
 */
export async function setActiveLedger(input: {
  slug: LedgerSlug;
}): Promise<ActionResult<UserPreferences>> {
  return withSession(({ userId }) => {
    if (!isLedgerSlug(input.slug)) {
      throw validation("Ce budget n'existe pas.", "slug");
    }
    const ledger = findLedgerBySlug(userId, input.slug);
    if (!ledger) throw notFound("Ce budget n'existe pas.");

    setActiveLedgerValue(userId, ledger.slug);
    /**
     * Portee « layout » et non la page racine seule, contrairement au reste du depot.
     * Une bascule de budget change le contenu de TOUS les ecrans : le mois, l'annee et
     * les reglages. Invalider la seule route « / » laisserait /mois/2026/8 afficher les
     * chiffres de l'autre budget jusqu'a la prochaine navigation.
     * Signature verifiee dans node_modules/next/dist/docs : revalidatePath(path, 'layout')
     * invalide le layout de ce segment, les layouts imbriques et toutes leurs pages.
     */
    revalidatePath("/", "layout");
    return effectivePreferences(userId);
  });
}

/**
 * Alias de compatibilite de `getPreferences`.
 *
 * Les deux noms coexistent dans le code d'interface ecrit en parallele de ce lot.
 * Le nom canonique est `getPreferences`, coherent avec `setColorIntensity`. Cet alias
 * existe pour ne pas casser le build pendant la convergence et pourra etre retire une
 * fois tous les appels alignes.
 */
export async function getUserPreferences(): Promise<ActionResult<UserPreferences>> {
  return getPreferences();
}
