import { AppShell } from "@/components/app-shell";
import { IntegrationsPage } from "@/components/pages/integrations-page";
import { requireSessionUser } from "@/lib/session";

export default async function IntegrationsRoute() {
  await requireSessionUser();

  return (
    <AppShell>
      <IntegrationsPage />
    </AppShell>
  );
}
