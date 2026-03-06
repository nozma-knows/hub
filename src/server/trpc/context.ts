import type { Context as HonoContext } from "hono";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export type SessionUser = {
  id: string;
  email?: string;
  name?: string;
};

export type TrpcContext = {
  db: typeof db;
  user: SessionUser | null;
  honoContext: HonoContext;
};

export async function createTrpcContext(honoContext: HonoContext): Promise<TrpcContext> {
  const sessionResult = (await auth.api.getSession({
    headers: honoContext.req.raw.headers
  })) as { user?: SessionUser } | null;

  return {
    db,
    user: sessionResult?.user ?? null,
    honoContext
  };
}
