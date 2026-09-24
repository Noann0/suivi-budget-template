"use client";

import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Compteur qui monte de zero jusqu'a la valeur, une seule fois par session et par
 * cle (plan, section 9 : 400ms ease-out, une fois par session).
 *
 * L'etat interne ne contient QUE la valeur transitoire de l'animation, et il
 * revient a null des qu'elle est finie. La valeur affichee reste donc toujours
 * `targetCents` en dehors de l'animation : une mise a jour venue du serveur n'a
 * aucune chance de rester bloquee derriere un ancien montant fige.
 *
 * `prefers-reduced-motion` : on ne demarre simplement pas l'animation. Repli, pas
 * suppression, le chiffre est la des la premiere frame.
 */
export function useCountUp(targetCents: number, sessionKey: string): number {
  const [animated, setAnimated] = useState<number | null>(null);
  const played = useRef(false);

  useEffect(() => {
    if (played.current) return;
    played.current = true;

    if (prefersReducedMotion() || targetCents === 0) return;

    const storageKey = `bud:countup:${sessionKey}`;
    try {
      if (window.sessionStorage.getItem(storageKey) === "1") return;
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // Stockage indisponible (navigation privee stricte) : on n'anime pas plutot
      // que de rejouer l'animation a chaque navigation.
      return;
    }

    const duration = 400;
    const start = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      if (progress >= 1) {
        // Retour a null : l'affichage reprend la valeur serveur, pas une copie.
        setAnimated(null);
        return;
      }
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimated(Math.round(targetCents * eased));
      frame = requestAnimationFrame(step);
    };

    // Le premier setState part depuis une frame, jamais depuis le corps de l'effet.
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [targetCents, sessionKey]);

  return animated ?? targetCents;
}
