import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";

import type { TrpcContext } from "@/server/trpc/context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson
});

const requireUser = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});

export const createTrpcRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(requireUser);
