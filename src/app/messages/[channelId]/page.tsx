import { AppShell } from "@/components/app-shell";
import { ChannelPage } from "@/components/pages/channel-page";
import { requireSessionUser } from "@/lib/session";

export default async function ChannelRoute(props: { params: Promise<{ channelId: string }> }) {
  await requireSessionUser();
  const params = await props.params;

  return (
    <AppShell>
      <ChannelPage channelId={params.channelId} />
    </AppShell>
  );
}
