"use client";

import { CalendarRange, PieChart, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/lib/cn";

const TABS = [
  { href: "/", label: "Mois", icon: PieChart, match: (p: string) => p === "/" || p.startsWith("/mois") },
  { href: "/annee", label: "Année", icon: CalendarRange, match: (p: string) => p.startsWith("/annee") },
  { href: "/reglages", label: "Réglages", icon: Settings, match: (p: string) => p.startsWith("/reglages") },
] as const;

/**
 * Navigation principale.
 *
 * Sur telephone, elle vit en bas : c'est la zone du pouce sur un Android tenu a une
 * main. Sur ordinateur, une barre flottante en bas d'un ecran de 1920 est un tic de
 * maquette mobile agrandie ; elle remonte donc en en-tete, avec le nom de
 * l'application, et redevient une vraie barre de navigation de bureau.
 */
export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 backdrop-blur-sm",
        "lg:top-0 lg:bottom-auto lg:border-t-0 lg:border-b",
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-[var(--container-reading)] items-center lg:max-w-[1120px] lg:gap-8 lg:px-6">
        <span className="hidden font-display text-lg font-bold text-ink lg:block">
          Suivi budget
        </span>
        <ul className="flex flex-1 lg:flex-none lg:gap-2">
          {TABS.map((tab) => {
            const active = tab.match(pathname);
            const Icon = tab.icon;
            return (
              <li key={tab.href} className="flex-1 lg:flex-none">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-0.5",
                    "lg:h-16 lg:flex-row lg:gap-2 lg:rounded-sm lg:px-4",
                    active ? "text-accent-ink" : "text-ink-soft lg:hover:text-ink",
                  )}
                >
                  <Icon size={22} aria-hidden="true" strokeWidth={active ? 2.4 : 1.8} />
                  <span className={cn("text-xs lg:text-base", active && "font-semibold")}>
                    {tab.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
