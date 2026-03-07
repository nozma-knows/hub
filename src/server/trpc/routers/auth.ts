import { createTrpcRouter, publicProcedure } from "@/server/trpc/init";

export const authRouter = createTrpcRouter({
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user || !ctx.workspace) {
      return null;
    }

    return {
      id: ctx.user!.id,
      email: ctx.user.email,
      name: ctx.user.name,
      workspace: {
        id: ctx.workspace.id,
        role: ctx.workspace.role
      }
    };
  })
});
