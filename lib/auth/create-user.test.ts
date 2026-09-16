import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the audit-log writer — its real implementation reaches for the
// generated Prisma client at module load, which is heavier than the unit
// under test needs.
vi.mock("@/lib/audit-log", () => ({
  recordAuditEvent: vi.fn(async () => {}),
}));

import {
  createTenantBoundUser,
  DEFAULT_TENANT_ID,
  type CreateUserPrismaClient,
} from "./create-user";
import { recordAuditEvent } from "@/lib/audit-log";

function makePrisma(): CreateUserPrismaClient & {
  user: { create: ReturnType<typeof vi.fn> };
} {
  return {
    user: {
      create: vi.fn(async ({ data }) => ({
        id: data.id,
        email: data.email,
        name: data.name,
        emailVerified: data.emailVerified,
        tenant_id: data.tenant_id,
      })),
    },
  };
}

describe("createTenantBoundUser (1.2 adapter shim)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes tenant_id = DEFAULT_TENANT_ID on the prisma.user.create call", async () => {
    const prisma = makePrisma();

    await createTenantBoundUser(prisma, {
      email: "new@example.com",
      name: "New User",
      emailVerified: null,
    } as never);

    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    const args = prisma.user.create.mock.calls[0][0];
    expect(args.data.tenant_id).toBe(DEFAULT_TENANT_ID);
  });

  it("also fills the self-referencing creator_id / updater_id so the merged user row constraints are satisfied", async () => {
    const prisma = makePrisma();

    await createTenantBoundUser(prisma, {
      email: "a@b.com",
      name: "A",
    } as never);

    const args = prisma.user.create.mock.calls[0][0];
    expect(args.data.id).toEqual(expect.any(String));
    expect(args.data.creator_id).toBe(args.data.id);
    expect(args.data.updater_id).toBe(args.data.id);
  });

  it("returns an AdapterUser shape (no tenant_id leak in the auth.js contract)", async () => {
    const prisma = makePrisma();

    const result = await createTenantBoundUser(prisma, {
      email: "shape@example.com",
      name: "Shape",
      emailVerified: null,
    } as never);

    expect(result).toEqual({
      id: expect.any(String),
      email: "shape@example.com",
      name: "Shape",
      emailVerified: null,
    });
    expect(result).not.toHaveProperty("tenant_id");
  });

  it("falls back to email as the display name when AdapterUser.name is absent", async () => {
    const prisma = makePrisma();

    await createTenantBoundUser(prisma, {
      email: "noname@example.com",
    } as never);

    const args = prisma.user.create.mock.calls[0][0];
    expect(args.data.name).toBe("noname@example.com");
  });

  it("records an audit event including the tenant_id metadata", async () => {
    const prisma = makePrisma();

    await createTenantBoundUser(prisma, {
      email: "audited@example.com",
      name: "A",
    } as never);

    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    const event = (recordAuditEvent as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(event.action).toBe("auth:createUser");
    expect(event.metadata).toEqual(
      expect.objectContaining({ tenant_id: DEFAULT_TENANT_ID }),
    );
  });
});
