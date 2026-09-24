import type { MetadataRoute } from "next";

/**
 * Manifeste web, section "Manifeste web recommande" de design/ICON_PLAN.md.
 *
 * Convention de fichier Next 16 : ce module est servi a /manifest.webmanifest et Next
 * pose lui-meme le <link rel="manifest"> dans le <head>.
 *
 * Choix poses par le plan de design, repris tels quels :
 * - `short_name: "Budget"` est le libelle affiche sous l'icone sur l'ecran d'accueil.
 *   Court, sans ambiguite pour l'utilisatrice.
 * - `display: "standalone"` pour que le raccourci ouvre l'application sans barre d'URL.
 * - `theme_color` et `background_color` en creme `--color-bg`, pour que la barre systeme
 *   et l'ecran de lancement soient dans le papier de l'application. Cette valeur doit
 *   rester synchronisee avec le `themeColor` de l'export `viewport` de layout.tsx.
 *
 * Le maitre etant dessine maskable d'origine (fond opaque bord a bord, motif dans le
 * cercle de securite a 80 %), les memes fichiers servent les deux purposes : deux
 * entrees par taille, meme `src`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Suivi budget",
    short_name: "Budget",
    description: "Suivi du budget mensuel",
    lang: "fr",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f1e7",
    theme_color: "#f6f1e7",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
