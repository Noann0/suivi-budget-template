import { redirect } from "next/navigation";

import { RecoverBoard } from "@/components/auth/RecoverBoard";
import { getAuthState } from "@/actions/auth";

export default async function RecoverPage() {
  const state = await getAuthState();
  if (state.ok && state.data.authenticated) redirect("/");

  return <RecoverBoard />;
}
