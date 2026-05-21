// Tenant-aware adapter createUser.
//
// Extracted from auth.ts so it can be unit-tested without spinning up
// the full NextAuth handler. The shape mirrors `PrismaAdapter.createUser`
// — same arguments in, same `AdapterUser` out — but also fills the
// my-next-specific columns the merged `user` row requires: non-null
// `name`, self-referencing `creator_id` / `updater_id`, and (since
// Phase 1.2) a `tenant_id` bound to the deployment's "default" tenant.
//
// Why default to 'default': Phase 4.1 will introduce invite-only sign-up
// where new users land in the inviter's tenant. Until then OAuth sign-ins
// have no tenant context, so they land in the bootstrap tenant — the
// same row the 1.5 migration script backfills existing users to. The
// schema column also defaults to 'default', but writing it here keeps
// the intent visible at the call site and makes the vitest assertion
// meaningful.

import type { AdapterUser } from "@auth/core/adapters";
import { createId } from "@paralleldrive/cuid2";
import { recordAuditEvent } from "@/lib/audit-log";

export const DEFAULT_TENANT_ID = "default";

// Minimal contract for the prisma client we need. Typed as a structural
// interface rather than the generated `PrismaClient` so tests can supply
// a hand-rolled mock without importing the full generated client.
export type CreateUserPrismaClient = {
  user: {
    create: (args: {
      data: {
        id: string;
        email: string;
        name: string;
        emailVerified: Date | null;
        image: string | null;
        creator_id: string;
        updater_id: string;
        tenant_id: string;
      };
    }) => Promise<{
      id: string;
      email: string;
      name: string;
      emailVerified: Date | null;
      image: string | null;
      tenant_id: string;
    }>;
  };
};

export async function createTenantBoundUser(
  prisma: CreateUserPrismaClient,
  data: AdapterUser,
): Promise<AdapterUser> {
  const id = createId();
  const created = await prisma.user.create({
    data: {
      id,
      email: data.email!,
      name: data.name ?? data.email!,
      emailVerified: data.emailVerified ?? null,
      image: data.image ?? null,
      creator_id: id,
      updater_id: id,
      tenant_id: DEFAULT_TENANT_ID,
    },
  });
  console.info(
    "[auth:createUser]",
    JSON.stringify({
      at: new Date().toISOString(),
      userId: created.id,
      email: created.email,
      tenantId: created.tenant_id,
    }),
  );
  await recordAuditEvent({
    action: "auth:createUser",
    actor_user_id: created.id,
    target_table: "user",
    target_id: created.id,
    metadata: { email: created.email, tenant_id: created.tenant_id },
  });
  return {
    id: created.id,
    name: created.name,
    email: created.email,
    emailVerified: created.emailVerified,
    image: created.image,
  } as AdapterUser;
}
