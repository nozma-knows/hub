import { createTrpcRouter } from "@/server/trpc/init";
import { actionsRouter } from "@/server/trpc/routers/actions";
import { agentsRouter } from "@/server/trpc/routers/agents";
import { auditRouter } from "@/server/trpc/routers/audit";
import { authRouter } from "@/server/trpc/routers/auth";
import { permissionsRouter } from "@/server/trpc/routers/permissions";
import { providersRouter } from "@/server/trpc/routers/providers";

export const appRouter = createTrpcRouter({
  auth: authRouter,
  agents: agentsRouter,
  providers: providersRouter,
  permissions: permissionsRouter,
  actions: actionsRouter,
  audit: auditRouter
});

export type AppRouter = typeof appRouter;
