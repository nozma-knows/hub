import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";

import type { TrpcContext } from "@/server/trpc/context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson
});

const requireUser = t.middleware(({ ctx, next }) => {
  if (!ctx.user || !ctx.workspace) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      workspace: ctx.workspace
    }
  });
});

const requireAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.workspace || (ctx.workspace.role !== "owner" && ctx.workspace.role !== "admin")) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }

  return next({
    ctx: {
      ...ctx,
      workspace: ctx.workspace
    }
  });
});

export const createTrpcRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(requireUser);
export const adminProcedure = protectedProcedure.use(requireAdmin);
