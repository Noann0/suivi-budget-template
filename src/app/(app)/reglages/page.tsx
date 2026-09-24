import { redirect } from "next/navigation";

import { AccountPanel } from "@/components/AccountPanel";
import { SettingsBoard } from "@/components/SettingsBoard";
import { listCategories } from "@/actions/categories";
import { listDevices } from "@/actions/auth";
import { getPreferences } from "@/actions/preferences";
import { SESSION_EXPIRED_PATH, isUnauthorized, screenErrorMessage } from "@/components/lib/screenErrors";

/**
 * Ecran 3 : reglages, categories, sauvegarde et appareils.
 * Les trois lectures partent ensemble, il n'y a pas de raison d'attendre l'une
 * pour lancer les autres.
 */
export default async function SettingsPage() {
  const [categories, preferences, devices] = await Promise.all([
    listCategories(),
    getPreferences(),
    listDevices(),
  ]);

  if (!categories.ok) {
    if (isUnauthorized(categories.error)) redirect(SESSION_EXPIRED_PATH);

    return (
      <p role="alert" className="card px-4 py-4 text-base text-ink">
        {screenErrorMessage(categories.error)}
      </p>
    );
  }

  return (
    <>
      <h1 className="py-2 font-display text-2xl font-bold text-ink">Réglages</h1>
      {/* key=activeLedger (QA fast-fix) : SettingsBoard initialise son etat local
          categories/intensity via useState(prop) une seule fois au montage. Sans
          cette cle, basculer de budget sur cet ecran laissait la liste de
          categories de l'ANCIEN budget affichee malgre le libelle "Budget ouvert"
          deja a jour ailleurs sur la page (fuite confirmee par reproduction). */}
      <SettingsBoard
        key={preferences.ok ? preferences.data.activeLedger : "default"}
        categories={categories.data}
        intensity={preferences.ok ? preferences.data.colorIntensity : "soft"}
      />
      <AccountPanel devices={devices.ok ? devices.data : []} />
    </>
  );
}
