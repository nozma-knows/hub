import { AppShell } from "@/components/app-shell";
import { AccessPage } from "@/components/pages/access-page";
import { requireSessionUser } from "@/lib/session";

export default async function AccessRoute() {
  await requireSessionUser();

  return (
    <AppShell>
      <AccessPage />
    </AppShell>
  );
}
