import { AppShell } from "@/components/app-shell";
import { OverviewPage } from "@/components/pages/overview-page";
import { requireSessionUser } from "@/lib/session";

export default async function Page() {
  await requireSessionUser();

  return (
    <AppShell>
      <OverviewPage />
    </AppShell>
  );
}
