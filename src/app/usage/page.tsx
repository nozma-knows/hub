import { AppShell } from "@/components/app-shell";
import { UsagePage } from "@/components/pages/usage-page";
import { requireSessionUser } from "@/lib/session";

export default async function UsageRoute() {
  await requireSessionUser();

  return (
    <AppShell>
      <UsagePage />
    </AppShell>
  );
}
