import { AppShell } from "@/components/app-shell";
import { SchedulesPage } from "@/components/pages/schedules-page";
import { requireSessionUser } from "@/lib/session";

export default async function SchedulesRoute() {
  await requireSessionUser();

  return (
    <AppShell mainClassName="h-[calc(100svh-3.5rem)] overflow-hidden p-2 sm:p-4">
      <SchedulesPage />
    </AppShell>
  );
}
