import { AppShell } from "@/components/app-shell";
import { AuditPage } from "@/components/pages/audit-page";
import { requireSessionUser } from "@/lib/session";

export default async function AuditRoute() {
  await requireSessionUser();

  return (
    <AppShell>
      <AuditPage />
    </AppShell>
  );
}
