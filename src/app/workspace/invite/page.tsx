import { AppShell } from "@/components/app-shell";
import { InviteAcceptPage } from "@/components/pages/invite-accept-page";
import { requireSessionUser } from "@/lib/session";

export default async function InviteAcceptRoute() {
  await requireSessionUser();

  return (
    <AppShell>
      <InviteAcceptPage />
    </AppShell>
  );
}
