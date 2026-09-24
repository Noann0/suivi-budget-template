import type { CSSProperties } from "react";

import type { ColorIntensity, Hue } from "@/lib/types";

/**
 * Palette des categories : section 3 de design/DESIGN_PLAN.md.
 *
 * La base ne stocke qu'une teinte entiere (1..16) et une intensite optionnelle.
 * Aucun hexadecimal ne circule cote serveur, le mapping vit ici et dans
 * globals.css. Les hex de la table ci-dessous doublent les variables CSS pour les
 * usages qui ont besoin de la valeur litterale (aperçu SVG hors DOM, `<meta>`).
 * Ils doivent rester synchrones avec globals.css.
 *
 * Chaque teinte porte un ecart perceptif mesure sous protanopie et deuteranopie.
 * Retoucher un hex "au gout" peut creer une collision invisible pour un
 * trichromate : le plan le demontre sur la teinte 10.
 */

export type HueDefinition = {
  hue: Hue;
  /** Nom francais, affiche a cote de la pastille dans le selecteur. */
  name: string;
  soft: string;
  vivid: string;
  /** Seule valeur de la teinte qui a le droit de porter du texte (AA sur creme). */
  ink: string;
};

export const HUES: readonly HueDefinition[] = [
  { hue: 1,  name: "brique",   soft: "#e7a6a4", vivid: "#d58d87", ink: "#a75254" },
  { hue: 2,  name: "abricot",  soft: "#fbbeaf", vivid: "#f47e6a", ink: "#a35646" },
  { hue: 3,  name: "miel",     soft: "#f5d8ac", vivid: "#cc9641", ink: "#87682c" },
  { hue: 4,  name: "paille",   soft: "#cdb474", vivid: "#887c11", ink: "#7f6b2b" },
  { hue: 5,  name: "anis",     soft: "#dbd48f", vivid: "#749653", ink: "#716e2b" },
  { hue: 6,  name: "sauge",    soft: "#a9c08d", vivid: "#52782a", ink: "#567536" },
  { hue: 7,  name: "amande",   soft: "#9fe6c2", vivid: "#227d60", ink: "#1d7a56" },
  { hue: 8,  name: "céladon",  soft: "#90c9c5", vivid: "#21847f", ink: "#067a75" },
  { hue: 9,  name: "canard",   soft: "#9eeaec", vivid: "#22b0c5", ink: "#08797d" },
  { hue: 10, name: "ciel",     soft: "#75d7fe", vivid: "#08899a", ink: "#0a7695" },
  { hue: 11, name: "myosotis", soft: "#ade3fd", vivid: "#38a6d6", ink: "#077696" },
  { hue: 12, name: "lavande",  soft: "#88c0fd", vivid: "#4179d4", ink: "#2371ac" },
  { hue: 13, name: "lilas",    soft: "#c1ade1", vivid: "#7e9af2", ink: "#7862a0" },
  { hue: 14, name: "mauve",    soft: "#c7b4d7", vivid: "#875ca8", ink: "#7c6096" },
  { hue: 15, name: "bruyère",  soft: "#fec0da", vivid: "#d26bac", ink: "#a15277" },
  { hue: 16, name: "rose",     soft: "#eda1b6", vivid: "#bd425a", ink: "#a5506c" },
] as const;

export const DEFAULT_INTENSITY: ColorIntensity = "soft";

/** Ramene une teinte venue de la base dans les bornes, sans jamais planter l'ecran. */
export function safeHue(hue: number): Hue {
  if (!Number.isInteger(hue) || hue < 1 || hue > 16) return 1;
  return hue;
}

export function hueDefinition(hue: number): HueDefinition {
  return HUES[safeHue(hue) - 1] as HueDefinition;
}

export function hueName(hue: number): string {
  return hueDefinition(hue).name;
}

/**
 * Variables locales d'une categorie.
 *
 * `intensity` a null signifie "suit le reglage global" : on pointe alors vers
 * `--cat-N-surface`, que globals.css fait basculer via `data-intensity` sur le
 * conteneur. Un composant enfant ne lit jamais que `--cat-surface` et
 * `--cat-ink`, il ignore tout de l'intensite courante.
 */
export function hueStyle(hue: number, intensity: ColorIntensity | null = null): CSSProperties {
  const n = safeHue(hue);
  const surface = intensity === null ? `var(--cat-${n}-surface)` : `var(--cat-${n}-${intensity})`;
  return {
    ["--cat-surface" as string]: surface,
    ["--cat-ink" as string]: `var(--cat-${n}-ink)`,
  } as CSSProperties;
}

/** Valeur litterale, pour les rares cas ou une variable CSS ne passe pas. */
export function hueSurfaceHex(hue: number, intensity: ColorIntensity): string {
  const def = hueDefinition(hue);
  return intensity === "vivid" ? def.vivid : def.soft;
}

/*
 * L'ATTRIBUTION AUTOMATIQUE D'UNE TEINTE N'EST PAS ICI, ET C'EST VOLONTAIRE.
 *
 * Elle vit cote serveur, dans `pickHue` de src/actions/categories.ts : deux compteurs
 * separes, les depenses consomment la sequence par la tete (1, 12, 4, 11, 3, 14, 9, 6...),
 * les revenus par la queue (8, 10, 5, 7, 13...). C'est une regle mesuree, pas une
 * commodite : le compteur par nature vaut 11.8 de DeltaE minimal en pire vision sur les
 * six premieres depenses, contre 9.9 pour un compteur global.
 *
 * La dupliquer ici donnerait deux sources pour la meme regle. Le frontend affiche la
 * teinte que le serveur renvoie, il ne la devine jamais.
 */
