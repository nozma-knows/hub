import { AppShell } from "@/components/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { requireSessionUser } from "@/lib/session";

export default async function WorkspaceRoute() {
  await requireSessionUser();

  return (
    <AppShell>
      <WorkspacePage />
    </AppShell>
  );
}
