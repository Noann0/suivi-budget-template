import type { ReactNode } from "react";

import { redirect } from "next/navigation";

import { LedgerSwitch } from "@/components/LedgerSwitch";
import { TabBar } from "@/components/TabBar";
import { getAuthState } from "@/actions/auth";
import { listLedgers } from "@/actions/ledgers";
import { getPreferences } from "@/actions/preferences";
import { DEFAULT_PREFERENCES } from "@/lib/types";

/**
 * Coquille des trois ecrans.
 *
 * `data-intensity` porte le reglage global de la palette. Tous les composants
 * lisent `--cat-N-surface`, resolue ici : l'interrupteur "Douces / Franches" agit
 * sur toute l'application par la cascade, sans qu'un seul composant ait a le savoir.
 *
 * Largeur : colonne de lecture de 640px jusqu'a 1024px, puis une vraie mise en page
 * de bureau de 1120px. Au-dela on centre, mais on ne laisse jamais une colonne de
 * telephone etiree seule au milieu d'un ecran de 1920.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // Les trois lectures partent ensemble, la coquille ne doit pas couter un
  // aller-retour en cascade a chaque navigation.
  const [preferences, authState, ledgers] = await Promise.all([
    getPreferences(),
    getAuthState(),
    listLedgers(),
  ]);

  /**
   * Contrat docs/API.md section 5.3.1 : tant qu'un code de secours emis n'a pas ete
   * acquitte, TOUTE page authentifiee ramene a l'ecran de revelation.
   *
   * La regle est posee ici et pas sur /enroll, et c'est ce qui la rend solide :
   * poser le cookie de session declenche une revalidation qui re-rend la page
   * d'inscription et la redirige avant que le code n'ait pu s'afficher. Cette course
   * etait ingagnable. Sur la coquille, le chemin d'arrivee n'a plus d'importance,
   * fermeture d'onglet comprise.
   *
   * On echoue OUVERT si l'etat n'a pas pu etre lu, par exemple sur un depassement de
   * quota : ce drapeau guide le parcours, il ne garde aucune porte. La priver de son
   * budget parce qu'une lecture d'etat a echoue serait un remede pire que le mal.
   */
  if (authState.ok && authState.data.pendingRecoveryAck) redirect("/code-de-secours");
  const intensity = preferences.ok
    ? preferences.data.colorIntensity
    : DEFAULT_PREFERENCES.colorIntensity;

  return (
    <div data-intensity={intensity} className="min-h-dvh">
      <main
        className="mx-auto flex w-full max-w-[var(--container-reading)] flex-col gap-4 px-4 pt-2 pb-[calc(80px+env(safe-area-inset-bottom))] lg:max-w-[1120px] lg:px-6 lg:pt-24 lg:pb-12"
      >
        {/* Le selecteur n'apparait que si les DEUX lectures ont abouti. Se rabattre
            sur une valeur par defaut comme on le fait pour l'intensite serait ici une
            faute : afficher « Joint » en gras alors que l'application est ouverte sur
            « Perso » l'enverrait saisir ses montants dans le mauvais budget en toute
            confiance. Un reperage faux est pire que pas de reperage. */}
        {preferences.ok && ledgers.ok ? (
          <LedgerSwitch ledgers={ledgers.data} active={preferences.data.activeLedger} />
        ) : null}
        {children}
      </main>
      <TabBar />
    </div>
  );
}
