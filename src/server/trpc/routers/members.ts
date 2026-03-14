import { createHash } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { workspaceInvites, workspaceMembers, workspaces } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { randomState } from "@/lib/utils";
import { adminProcedure, createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const membersRouter = createTrpcRouter({
  list: adminProcedure.query(async ({ ctx }) => {
    const [workspace, members, invites] = await Promise.all([
      ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.id, ctx.workspace.id),
      }),
      ctx.db.query.workspaceMembers.findMany({
        where: eq(workspaceMembers.workspaceId, ctx.workspace.id),
        orderBy: (table, { asc }) => [asc(table.joinedAt)],
      }),
      ctx.db.query.workspaceInvites.findMany({
        where: and(eq(workspaceInvites.workspaceId, ctx.workspace.id), isNull(workspaceInvites.revokedAt)),
        orderBy: (table, { desc }) => [desc(table.createdAt)],
      }),
    ]);

    return {
      workspace,
      members,
      invites,
    };
  }),

  invite: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        role: z.enum(["admin", "operator"]).default("operator"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const rawToken = randomState(64);
      const tokenHash = hashToken(rawToken);

      const [invite] = await ctx.db
        .insert(workspaceInvites)
        .values({
          workspaceId: ctx.workspace.id,
          email: input.email.toLowerCase(),
          role: input.role,
          tokenHash,
          invitedBy: ctx.user!.id,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
        })
        .returning();

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "members.invite",
        actorUserId: ctx.user!.id,
        result: "success",
        details: {
          email: input.email,
          role: input.role,
        },
      });

      return {
        inviteId: invite.id,
        token: rawToken,
        inviteUrl: `/workspace/invite?token=${encodeURIComponent(rawToken)}`,
      };
    }),

  updateRole: adminProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        role: z.enum(["owner", "admin", "operator"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(workspaceMembers)
        .set({
          role: input.role,
          updatedAt: new Date(),
        })
        .where(
          and(eq(workspaceMembers.workspaceId, ctx.workspace.id), eq(workspaceMembers.userId, input.userId))
        );

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "members.update_role",
        actorUserId: ctx.user!.id,
        result: "success",
        details: {
          userId: input.userId,
          role: input.role,
        },
      });

      return { success: true };
    }),

  remove: adminProcedure
    .input(
      z.object({
        userId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, ctx.workspace.id), eq(workspaceMembers.userId, input.userId))
        );

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "members.remove",
        actorUserId: ctx.user!.id,
        result: "success",
        details: {
          userId: input.userId,
        },
      });

      return { success: true };
    }),

  acceptInvite: protectedProcedure
    .input(
      z.object({
        token: z.string().min(20),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tokenHash = hashToken(input.token);
      const invite = await ctx.db.query.workspaceInvites.findFirst({
        where: and(eq(workspaceInvites.tokenHash, tokenHash), isNull(workspaceInvites.revokedAt)),
      });

      if (!invite) {
        throw new Error("Invite not found.");
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        throw new Error("Invite expired.");
      }
      if (invite.email.toLowerCase() !== (ctx.user.email ?? "").toLowerCase()) {
        throw new Error("Invite email does not match signed-in user.");
      }

      await ctx.db
        .insert(workspaceMembers)
        .values({
          workspaceId: invite.workspaceId,
          userId: ctx.user!.id,
          role: invite.role,
          invitedBy: invite.invitedBy,
          joinedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          set: {
            role: invite.role,
            updatedAt: new Date(),
          },
        });

      await ctx.db
        .update(workspaceInvites)
        .set({
          acceptedBy: ctx.user!.id,
          acceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workspaceInvites.id, invite.id));

      await logAuditEvent({
        workspaceId: invite.workspaceId,
        eventType: "members.accept_invite",
        actorUserId: ctx.user!.id,
        result: "success",
      });

      return { success: true };
    }),
});
