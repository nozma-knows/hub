import { AppShell } from "@/components/app-shell";
import { AgentDetailPage } from "@/components/pages/agent-detail-page";
import { requireSessionUser } from "@/lib/session";

export default async function AgentDetailRoute({ params }: { params: { agentId: string } }) {
  await requireSessionUser();

  return (
    <AppShell>
      <AgentDetailPage agentId={params.agentId} />
    </AppShell>
  );
}
