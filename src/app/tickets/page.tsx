import { AppShell } from "@/components/app-shell";
import { TicketsPage } from "@/components/pages/tickets-page";
import { requireSessionUser } from "@/lib/session";

export default async function TicketsRoute() {
  await requireSessionUser();

  return (
    <AppShell mainClassName="p-0 h-[calc(100dvh-56px)] overflow-hidden">
      <TicketsPage />
    </AppShell>
  );
}
