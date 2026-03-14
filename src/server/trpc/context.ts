import type { Context as HonoContext } from "hono";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureUserWorkspace, type WorkspaceRole } from "@/lib/workspaces";

export type SessionUser = {
  id: string;
  email?: string;
  name?: string;
};

export type TrpcContext = {
  db: typeof db;
  user: SessionUser | null;
  workspace: {
    id: string;
    role: WorkspaceRole;
  } | null;
  honoContext: HonoContext;
};

export async function createTrpcContext(honoContext: HonoContext): Promise<TrpcContext> {
  const sessionResult = (await auth.api.getSession({
    headers: honoContext.req.raw.headers,
  })) as { user?: SessionUser } | null;
  const user = sessionResult?.user ?? null;
  const workspace = user ? await ensureUserWorkspace(user) : null;

  return {
    db,
    user,
    workspace: workspace
      ? {
          id: workspace.workspaceId,
          role: workspace.role,
        }
      : null,
    honoContext,
  };
}
