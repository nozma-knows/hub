import { AppShell } from "@/components/app-shell";
import { MessagesPage } from "@/components/pages/messages-page";
import { requireSessionUser } from "@/lib/session";

export default async function MessagesRoute() {
  await requireSessionUser();

  return (
    <AppShell>
      <MessagesPage />
    </AppShell>
  );
}
