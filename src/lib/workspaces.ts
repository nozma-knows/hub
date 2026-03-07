import { and, eq } from "drizzle-orm";

import { workspaceMembers, workspaces } from "@/db/schema";
import { db } from "@/lib/db";

export type WorkspaceRole = "owner" | "admin" | "operator";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "workspace";
}

export async function ensureUserWorkspace(user: { id: string; email?: string; name?: string }): Promise<{
  workspaceId: string;
  role: WorkspaceRole;
}> {
  const existingMembership = await db.query.workspaceMembers.findFirst({
    where: eq(workspaceMembers.userId, user.id),
    orderBy: (table, { desc }) => [desc(table.joinedAt)]
  });
  if (existingMembership) {
    return {
      workspaceId: existingMembership.workspaceId,
      role: existingMembership.role as WorkspaceRole
    };
  }

  const base = slugify(user.name || user.email || `workspace-${user.id.slice(0, 8)}`);
  let slug = base;
  for (let i = 1; i <= 20; i += 1) {
    const existingWorkspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.slug, slug)
    });

    if (!existingWorkspace) {
      const [created] = await db
        .insert(workspaces)
        .values({
          name: `${user.name || user.email || "User"} Workspace`,
          slug,
          createdBy: user.id
        })
        .returning({ id: workspaces.id });

      if (!created) {
        break;
      }

      await db.insert(workspaceMembers).values({
        workspaceId: created.id,
        userId: user.id,
        role: "owner",
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });

      return {
        workspaceId: created.id,
        role: "owner"
      };
    }

    slug = `${base}-${i + 1}`;
  }

  const fallback = await db.query.workspaceMembers.findFirst({
    where: eq(workspaceMembers.userId, user.id),
    orderBy: (table, { desc }) => [desc(table.joinedAt)]
  });

  if (!fallback) {
    throw new Error("Unable to resolve workspace membership.");
  }

  return {
    workspaceId: fallback.workspaceId,
    role: fallback.role as WorkspaceRole
  };
}

export async function getWorkspaceMembership(input: {
  workspaceId: string;
  userId: string;
}): Promise<{ workspaceId: string; userId: string; role: WorkspaceRole } | null> {
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, input.workspaceId),
      eq(workspaceMembers.userId, input.userId)
    )
  });

  if (!membership) {
    return null;
  }

  return {
    workspaceId: membership.workspaceId,
    userId: membership.userId,
    role: membership.role as WorkspaceRole
  };
}
