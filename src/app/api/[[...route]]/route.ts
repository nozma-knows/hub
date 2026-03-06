import { handle } from "hono/vercel";

import { honoApp } from "@/server/hono";

export const runtime = "nodejs";

const handler = handle(honoApp);

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as OPTIONS
};
