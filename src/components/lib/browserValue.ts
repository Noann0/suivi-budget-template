"use client";

import { useSyncExternalStore } from "react";

/** Aucun abonnement : ces valeurs ne changent pas pendant la vie de la page. */
const noSubscription = () => () => {};

/**
 * Lit une valeur qui n'existe que dans le navigateur, sans effet ni setState.
 *
 * `useSyncExternalStore` est fait exactement pour ca : il rend `serverValue` au
 * rendu serveur puis la vraie valeur apres hydratation, sans desaccord de balisage
 * et sans le rendu en cascade qu'un `useEffect` + `setState` provoquerait.
 */
export function useBrowserValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscription, read, () => serverValue);
}
