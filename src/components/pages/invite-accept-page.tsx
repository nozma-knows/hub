"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc-client";

export function InviteAcceptPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const accept = trpc.members.acceptInvite.useMutation();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Accept Workspace Invite</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Accept this invite to join the shared OpenClaw Hub workspace.</p>
          {!token ? <Alert className="border-destructive text-destructive">Missing invite token in URL.</Alert> : null}
          <Button
            disabled={!token || accept.isPending}
            onClick={async () => {
              try {
                await accept.mutateAsync({ token });
                setMessage("Invite accepted. Refresh the app to continue.");
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Invite accept failed");
              }
            }}
          >
            Accept Invite
          </Button>
          {message ? <Alert>{message}</Alert> : null}
        </CardContent>
      </Card>
    </div>
  );
}
