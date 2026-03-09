import { AppShell } from "@/components/app-shell";
import { MessagesPage } from "@/components/pages/messages-page";
import { requireSessionUser } from "@/lib/session";

export default async function MessagesRoute() {
  await requireSessionUser();

  return (
    <AppShell mainClassName="h-[calc(100svh-3.5rem)] overflow-hidden p-2 sm:p-4">
      <MessagesPage />
    </AppShell>
  );
}
