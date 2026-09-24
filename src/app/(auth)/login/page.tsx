import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LoginBoard } from "@/components/auth/LoginBoard";
import { getAuthState } from "@/actions/auth";

/**
 * `getAuthState` tranche les trois cas possibles avant meme d'afficher quoi que ce
 * soit : deja connectee, aucune passkey enregistree, ou pret a se connecter. Sans
 * elle, un tout premier demarrage afficherait un bouton de connexion qui ne peut
 * mener nulle part, et elle appellerait son fils des le premier ecran.
 */
export default async function LoginPage() {
  const state = await getAuthState();

  if (state.ok && state.data.authenticated) redirect("/");
  if (state.ok && !state.data.hasCredentials) redirect("/enroll");

  return (
    <Suspense fallback={null}>
      <LoginBoard />
    </Suspense>
  );
}
