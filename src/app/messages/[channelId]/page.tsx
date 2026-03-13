import { AppShell } from "@/components/app-shell";
import { ChannelPage } from "@/components/pages/channel-page";
import { MessagesSidebar } from "@/components/pages/messages-sidebar";
import { requireSessionUser } from "@/lib/session";

export default async function ChannelRoute(props: { params: Promise<{ channelId: string }> }) {
  await requireSessionUser();
  const params = await props.params;

  return (
    <AppShell mainClassName="p-0 h-[calc(100dvh-56px)] overflow-hidden">
      <div className="flex h-full min-h-0 overflow-hidden">
        <div className="hidden md:block w-[280px] shrink-0">
          <MessagesSidebar activeChannelId={params.channelId} />
        </div>
        <div className="flex-1 min-w-0">
          <ChannelPage channelId={params.channelId} />
        </div>
      </div>
    </AppShell>
  );
}
