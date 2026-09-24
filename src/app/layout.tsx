import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Bricolage_Grotesque, Familjen_Grotesk } from "next/font/google";

import "./globals.css";

/**
 * Fontes : section 4 du plan de design.
 *
 * `next/font/google` telecharge le woff2 au build et le sert depuis notre domaine.
 * Aucune requete vers Google au runtime, ce qui satisfait le "self-host woff2" du plan.
 *
 * Verification faite le 2026-08-30 sur les woff2 reellement servis (fontTools) :
 * - Bricolage Grotesque : glyphe `zero` a 2 contours, donc zero PLEIN, ni barre ni
 *   pointe. Feature `tnum` presente, elle mappe vers des variantes .tf toutes larges
 *   de 580 unites. Sans `tnum`, les chiffres sont proportionnels (0 = 594, 1 = 310).
 * - Familjen Grotesk : `zero` a 2 contours apres decomposition (zero.lf), chasse
 *   unique 680 sur les dix chiffres, donc deja tabulaire meme sans `tnum`.
 * L'utilitaire `.amount` de globals.css force `tnum` dans les deux cas.
 */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
  // La fonte a trois axes. On embarque `opsz` pour que `font-optical-sizing: auto`
  // ait prise sur le montant hero en 40px, et on laisse tomber `wdth` dont on ne
  // se sert pas : chaque axe embarque pese dans le fichier.
  axes: ["opsz"],
});

const familjen = Familjen_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-familjen",
});

export const metadata: Metadata = {
  title: "Suivi budget",
  description: "Vos revenus, vos depenses et ce qu'il vous reste a la fin du mois.",
  applicationName: "Suivi budget",
  formatDetection: { telephone: false, date: false, email: false, address: false },
  // Ecran d'accueil iOS. Sur Android c'est le manifeste qui fait foi, mais Safari
  // ignore encore `display: standalone` et lit ces balises. Deux lignes pour que le
  // raccourci s'ouvre sans barre d'URL sur iPhone comme sur Android.
  // `title` reprend le `short_name` du manifeste : meme libelle sous l'icone partout.
  // `statusBarStyle: "default"` laisse la barre systeme opaque, le contenu ne passe
  // pas dessous ; c'est le comportement attendu avec un fond creme clair.
  appleWebApp: { capable: true, title: "Budget", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pas de maximumScale ni de userScalable: false. Elle doit pouvoir zoomer.
  themeColor: "#f6f1e7",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${bricolage.variable} ${familjen.variable} h-full`}>
      <body className="min-h-full bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
