import { AppShell } from "@/components/app-shell";
import { ChannelPage } from "@/components/pages/channel-page";
import { requireSessionUser } from "@/lib/session";

export default async function ChannelRoute(props: { params: Promise<{ channelId: string }> }) {
  await requireSessionUser();
  const params = await props.params;

  return (
    <AppShell mainClassName="h-[calc(100svh-3.5rem)] overflow-hidden px-2 py-2 sm:px-4 sm:py-4">
      <ChannelPage channelId={params.channelId} />
    </AppShell>
  );
}
