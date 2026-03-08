import { AppShell } from "@/components/app-shell";
import { NewAgentPage } from "@/components/pages/new-agent-page";
import { requireSessionUser } from "@/lib/session";

export default async function NewAgentRoute() {
  await requireSessionUser();

  return (
    <AppShell>
      <NewAgentPage />
    </AppShell>
  );
}
