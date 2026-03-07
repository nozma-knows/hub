import { createTrpcRouter } from "@/server/trpc/init";
import { actionsRouter } from "@/server/trpc/routers/actions";
import { agentsRouter } from "@/server/trpc/routers/agents";
import { auditRouter } from "@/server/trpc/routers/audit";
import { authRouter } from "@/server/trpc/routers/auth";
import { membersRouter } from "@/server/trpc/routers/members";
import { modelCredentialsRouter } from "@/server/trpc/routers/model-credentials";
import { monitoringRouter } from "@/server/trpc/routers/monitoring";
import { permissionsRouter } from "@/server/trpc/routers/permissions";
import { providersRouter } from "@/server/trpc/routers/providers";
import { usageRouter } from "@/server/trpc/routers/usage";

export const appRouter = createTrpcRouter({
  auth: authRouter,
  agents: agentsRouter,
  providers: providersRouter,
  permissions: permissionsRouter,
  actions: actionsRouter,
  audit: auditRouter,
  members: membersRouter,
  usage: usageRouter,
  modelCredentials: modelCredentialsRouter,
  monitoring: monitoringRouter
});

export type AppRouter = typeof appRouter;
