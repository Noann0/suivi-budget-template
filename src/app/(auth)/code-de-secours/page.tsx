import { redirect } from "next/navigation";

import { RecoveryCodeBoard } from "@/components/auth/RecoveryCodeBoard";
import { safeNextPath } from "@/components/lib/authMessages";
import { getAuthState } from "@/actions/auth";

type Props = {
  searchParams: Promise<{ retour?: string }>;
};

/**
 * Ecran du code de secours.
 *
 * Il vit HORS du groupe (app), et c'est structurel : la coquille authentifiee
 * redirige ici tant que `pendingRecoveryAck` est vrai. S'il partageait cette
 * coquille, il se redirigerait vers lui-meme sans fin.
 *
 * Il reste protege par le proxy, qui exige le cookie de session sur tout ce qui
 * n'est pas /login, /enroll, /recover ni /api/health.
 */
export default async function RecoveryCodePage({ searchParams }: Props) {
  const { retour } = await searchParams;
  const state = await getAuthState();

  // Sans session, il n'y a pas de code a reveler. Le proxy a normalement deja
  // barre la route, ce controle ferme le cas ou le cookie existe mais ne vaut plus.
  if (state.ok && !state.data.authenticated) redirect("/login");

  return (
    <RecoveryCodeBoard
      destination={safeNextPath(retour)}
      pendingAck={state.ok && state.data.pendingRecoveryAck}
    />
  );
}
