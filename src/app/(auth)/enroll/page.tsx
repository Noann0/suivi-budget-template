import { redirect } from "next/navigation";

import { EnrollBoard } from "@/components/auth/EnrollBoard";
import { getAuthState } from "@/actions/auth";

export default async function EnrollPage() {
  const state = await getAuthState();
  if (state.ok && state.data.authenticated) redirect("/");

  return <EnrollBoard />;
}
