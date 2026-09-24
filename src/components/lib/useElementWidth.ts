"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Largeur reelle d'un conteneur.
 *
 * Les deux graphes de l'annee doivent partager exactement le meme axe X. Un
 * `viewBox` fixe avec mise a l'echelle non uniforme deformerait les traits, et une
 * mise a l'echelle uniforme grossirait les initiales des mois sur ecran large. On
 * mesure donc, et on dessine en pixels reels.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback = 344): number {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
