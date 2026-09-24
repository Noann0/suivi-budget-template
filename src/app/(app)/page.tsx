import { MonthScreen } from "@/components/MonthScreen";

/**
 * Ecran d'accueil : le mois en cours, celui qu'elle ouvrira 95 % du temps.
 * `getMonth` est base 1, jamais base zero : `Date.getMonth()` rend 0 pour janvier.
 */
export default async function HomePage() {
  const now = new Date();
  return <MonthScreen year={now.getFullYear()} month={now.getMonth() + 1} />;
}
