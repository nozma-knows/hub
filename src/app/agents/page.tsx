import { AppShell } from "@/components/app-shell";
import { AgentsPage } from "@/components/pages/agents-page";
import { requireSessionUser } from "@/lib/session";

export default async function AgentsRoute() {
  await requireSessionUser();

  return (
    <AppShell>
      <AgentsPage />
    </AppShell>
  );
}
