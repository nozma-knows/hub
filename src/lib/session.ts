import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

export async function requireSessionUser(): Promise<{ id: string; email?: string; name?: string }> {
  const session = (await auth.api.getSession({
    headers: await headers()
  })) as { user?: { id: string; email?: string; name?: string } } | null;

  if (!session?.user) {
    redirect("/sign-in");
  }

  return session.user;
}
