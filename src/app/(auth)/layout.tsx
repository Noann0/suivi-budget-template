import type { ReactNode } from "react";

/**
 * Coquille des ecrans d'entree.
 *
 * Aucune barre d'onglets : tant qu'elle n'est pas entree, il n'y a rien a
 * naviguer, et une navigation inerte a l'ecran ne ferait que lui donner des choses
 * a essayer au moment ou elle doit en faire une seule.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col justify-center px-4 py-8">
      <main className="mx-auto w-full max-w-[var(--container-reading)]">{children}</main>
    </div>
  );
}
