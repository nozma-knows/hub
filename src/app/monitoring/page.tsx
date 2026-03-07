import { AppShell } from "@/components/app-shell";
import { MonitoringPage } from "@/components/pages/monitoring-page";
import { requireSessionUser } from "@/lib/session";

export default async function MonitoringRoute() {
  await requireSessionUser();

  return (
    <AppShell>
      <MonitoringPage />
    </AppShell>
  );
}