import { AppShell } from "@/components/app-shell";
import { NewTicketPage } from "@/components/pages/new-ticket-page";
import { requireSessionUser } from "@/lib/session";

export default async function NewTicketRoute() {
  await requireSessionUser();

  return (
    <AppShell>
      <NewTicketPage />
    </AppShell>
  );
}
