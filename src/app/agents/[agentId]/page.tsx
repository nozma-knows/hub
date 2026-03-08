import { AppShell } from "@/components/app-shell";
import { AgentDetailPage } from "@/components/pages/agent-detail-page";
import { requireSessionUser } from "@/lib/session";

export default async function AgentDetailRoute(props: { params: Promise<{ agentId: string }> }) {
  await requireSessionUser();
  const params = await props.params;

  return (
    <AppShell>
      <AgentDetailPage agentId={params.agentId} />
    </AppShell>
  );
}
