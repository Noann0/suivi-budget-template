"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { SESSION_EXPIRED_PATH, isUnauthorized, screenErrorMessage } from "@/components/lib/screenErrors";
import type { ActionError } from "@/lib/result";

/**
 * Traite une erreur d'action cote client.
 *
 * Rend la phrase a afficher, ou `null` quand il n'y a plus rien a afficher parce
 * qu'on quitte l'ecran. Une session perdue ne s'affiche pas, elle ramene a la
 * connexion : sinon elle reste devant une piece vide, avec des onglets qui rendront
 * tous la meme erreur.
 *
 * Cas reel a couvrir : l'administrateur retire un appareil depuis les Reglages, la personne qui
 * tenait cet appareil doit revenir a la porte d'entree, pas rester plantee.
 */
export function useActionError(): (error: ActionError) => string | null {
  const router = useRouter();

  return useCallback(
    (error: ActionError) => {
      if (isUnauthorized(error)) {
        router.replace(SESSION_EXPIRED_PATH);
        router.refresh();
        return null;
      }
      return screenErrorMessage(error);
    },
    [router],
  );
}
