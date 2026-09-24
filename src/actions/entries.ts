"use server";

import { revalidatePath } from "next/cache";

import { isValidAmountCents } from "@/lib/money";
import { notFound, validation, type ActionResult } from "@/lib/result";
import type { Entry, MonthTotals } from "@/lib/types";
import { withSession } from "@/server/action-helpers";
import { findSubcategory } from "@/server/repositories/categories";
import {
  addToEntry as addToEntryRow,
  confirmCarriedEntries as confirmCarriedEntriesRow,
  deleteEntry as deleteEntryRow,
  findMonthById,
  upsertEntry as upsertEntryRow,
} from "@/server/repositories/months";
import { reloadTotals } from "@/server/services/months";

const MAX_NOTE_LENGTH = 500;

function assertAmount(value: unknown): number {
  if (!isValidAmountCents(value)) {
    // Le signe est porte par categories.kind, jamais par le montant : une depense se
    // saisit en positif. Accepter un negatif ici casserait tous les totaux.
    throw validation(
      `Le montant doit être positif et ne peut pas dépasser 10 000 000 €.`,
      "amountCents",
    );
  }
  return value;
}

/**
 * Valide un delta d'ajout. Volontairement plus strict que `assertAmount` sur deux
 * points, et les deux comptent.
 *
 * Zero est refuse : « ajouter rien » n'est pas une intention, et l'accepter creerait
 * une ligne a zero sur une sous-categorie jamais saisie, du bruit a l'ecran.
 *
 * Le negatif est refuse lui aussi. Retirer un montant existe deja, et mieux : le champ
 * de saisie du montant reste modifiable directement, c'est le geste de correction. Un
 * delta negatif ouvrirait une question sans bonne reponse, celle de retirer plus que
 * la ligne ne porte, entre refuser, ramener a zero et laisser passer un negatif que la
 * contrainte CHECK rejetterait de toute facon. Un seul sens, aucune ambiguite.
 */
function assertDelta(value: unknown): number {
  if (!isValidAmountCents(value) || value === 0) {
    throw validation(
      `Le montant à ajouter doit être supérieur à zéro et ne peut pas dépasser 10 000 000 €.`,
      "deltaCents",
    );
  }
  return value;
}

/**
 * Nettoie une note en distinguant les trois intentions que le repository attend.
 * `undefined` traverse tel quel : c'est ce qui dit « je ne parle pas de la note » et
 * qui empeche une saisie de montant d'effacer une note existante.
 */
function cleanNote(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  // Une chaine vide, ou blanche, est un effacement volontaire : elle vient d'un champ
  // que quelqu'un a vide a la main.
  return raw.trim().slice(0, MAX_NOTE_LENGTH) || null;
}

/**
 * Ecrit ou met a jour une entree, sur la contrainte UNIQUE(month_id, subcategory_id).
 * `is_carried` retombe a 0 dans tous les cas : confirmer un montant reporte sans le
 * modifier est un acte a part entiere, il doit faire disparaitre le marqueur.
 *
 * `note` omise laisse la note existante en place. Elle etait auparavant ramenee a
 * `null` des que l'appelant n'en transmettait pas, et l'ecran de saisie n'en transmet
 * jamais : toute note portee par une ligne disparaissait au premier changement de
 * montant, sans message ni trace. Envoyer `null` ou une chaine vide efface toujours,
 * l'effacement volontaire reste donc possible.
 */
export async function upsertEntry(input: {
  monthId: string;
  subcategoryId: string;
  amountCents: number;
  note?: string | null;
}): Promise<ActionResult<{ entry: Entry; totals: MonthTotals }>> {
  return withSession(({ userId }) => {
    const monthRow = findMonthById(userId, input.monthId);
    if (!monthRow) throw notFound("Ce mois n'existe pas.");
    if (!findSubcategory(userId, input.subcategoryId)) {
      throw notFound("Cette sous-catégorie n'existe pas.");
    }

    const amountCents = assertAmount(input.amountCents);
    const note = cleanNote(input.note);

    const entry = upsertEntryRow({
      monthId: input.monthId,
      subcategoryId: input.subcategoryId,
      amountCents,
      // La cle est posee seulement si l'appelant a parle de la note : `note: undefined`
      // et cle absente sont deja equivalents cote repository, mais l'objet reste
      // minimal, comme partout ailleurs dans le depot.
      ...(note === undefined ? {} : { note }),
    });

    revalidatePath("/");
    // Les totaux repartent avec la reponse : l'ecran se rafraichit sans second
    // aller-retour, et surtout sans recalcul cote navigateur.
    return { entry, totals: reloadTotals(userId, monthRow) };
  });
}

/**
 * Ajoute un montant a une entree, sans que personne n'ait a faire l'addition.
 *
 * Le besoin : 40 EUR de vetements en debut de mois, 100 de plus quatre jours apres.
 * Elle envoie 100, la ligne passe a 140. Le montant reste modifiable directement par
 * ailleurs, c'est ce qui sert a corriger une erreur de saisie.
 *
 * L'addition est faite par SQLite et pas ici : le navigateur ecrit son etat avant la
 * reponse du serveur, deux ajouts rapproches partiraient donc de la meme base et le
 * second ecraserait le premier. Voir `addToEntry` dans le repository.
 *
 * Revenus et depenses passent par la meme table et donc par la meme action : rien ici
 * ne connait la nature de la categorie, elle n'a aucune incidence.
 */
export async function addToEntry(input: {
  monthId: string;
  subcategoryId: string;
  deltaCents: number;
}): Promise<ActionResult<{ entry: Entry; totals: MonthTotals }>> {
  return withSession(({ userId }) => {
    const monthRow = findMonthById(userId, input.monthId);
    if (!monthRow) throw notFound("Ce mois n'existe pas.");
    if (!findSubcategory(userId, input.subcategoryId)) {
      throw notFound("Cette sous-catégorie n'existe pas.");
    }

    const entry = addToEntryRow({
      monthId: input.monthId,
      subcategoryId: input.subcategoryId,
      deltaCents: assertDelta(input.deltaCents),
    });

    // Aucune ligne rendue : la seule cause possible est la borne haute, l'ajout a ete
    // refuse avant d'ecrire quoi que ce soit. Le champ fautif designe le montant de la
    // ligne et non le delta : c'est la somme qui ne passe pas, pas ce qu'elle a tape.
    if (!entry) {
      throw validation(
        `Cette addition dépasserait 10 000 000 €. Corrigez le montant de la ligne directement.`,
        "amountCents",
      );
    }

    revalidatePath("/");
    return { entry, totals: reloadTotals(userId, monthRow) };
  });
}

export async function deleteEntry(input: {
  monthId: string;
  subcategoryId: string;
}): Promise<ActionResult<{ totals: MonthTotals }>> {
  return withSession(({ userId }) => {
    const monthRow = findMonthById(userId, input.monthId);
    if (!monthRow) throw notFound("Ce mois n'existe pas.");

    deleteEntryRow(input.monthId, input.subcategoryId);
    revalidatePath("/");
    return { totals: reloadTotals(userId, monthRow) };
  });
}

/** Confirme toutes les lignes reportees du mois, pour le bouton "tout est bon". */
export async function confirmCarriedEntries(input: {
  monthId: string;
}): Promise<ActionResult<{ confirmed: number }>> {
  return withSession(({ userId }) => {
    if (!findMonthById(userId, input.monthId)) throw notFound("Ce mois n'existe pas.");
    const confirmed = confirmCarriedEntriesRow(input.monthId);
    revalidatePath("/");
    return { confirmed };
  });
}
