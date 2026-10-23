import { describe, it, expect, vi } from "vitest";
import {
  requireTenantContext,
  requireRole,
  assertTenantOwnership,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  TenantContext,
} from "@/server/tenant-context";
import { UserRole } from "@prisma/client";

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Mock auth module
vi.mock("@/server/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import { auth } from "@/server/auth";

describe("Tenant Context & Session Authorization", () => {
  it("rejects unauthenticated requests with UnauthorizedError (401)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);

    await expect(requireTenantContext()).rejects.toThrow(UnauthorizedError);
  });

  it("rejects requests if user has no assigned tenantId with ForbiddenError (403)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: {
        id: "sess-1",
        userId: "user-1",
        token: "tok-1",
        expiresAt: new Date(Date.now() + 100000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: "user-1",
        email: "orphan@example.com",
        name: "Orphan User",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        // tenantId is missing!
      },
    } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

    await expect(requireTenantContext()).rejects.toThrow(ForbiddenError);
  });

  it("rejects deactivated user accounts with ForbiddenError (403)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: {
        id: "sess-2",
        userId: "user-deactivated",
        token: "tok-2",
        expiresAt: new Date(Date.now() + 100000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: "user-deactivated",
        email: "former.agent@apex.in",
        name: "Former Agent",
        tenantId: "tenant-apex",
        role: "TELECALLER",
        isActive: false, // Deactivated!
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

    await expect(requireTenantContext()).rejects.toThrow(/account is inactive/i);
  });

  it("correctly resolves tenant context from validated server session", async () => {
    const expiresAt = new Date(Date.now() + 100000);
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: {
        id: "sess-valid",
        userId: "user-pooja",
        token: "tok-valid",
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: "user-pooja",
        email: "pooja.telecaller@apexrealty.in",
        name: "Pooja Sharma",
        role: "TELECALLER",
        tenantId: "tenant-apex-123",
        isActive: true,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

    const context = await requireTenantContext();

    expect(context.userId).toBe("user-pooja");
    expect(context.tenantId).toBe("tenant-apex-123");
    expect(context.role).toBe(UserRole.TELECALLER);
    expect(context.user.email).toBe("pooja.telecaller@apexrealty.in");
    expect(context.session.id).toBe("sess-valid");
  });

  it("asserts role permission with deny-by-default", () => {
    const telecallerContext: TenantContext = {
      userId: "u-1",
      tenantId: "t-1",
      role: UserRole.TELECALLER,
      user: {
        id: "u-1",
        email: "telecaller@apex.in",
        name: "Telecaller",
        role: UserRole.TELECALLER,
        tenantId: "t-1",
        isActive: true,
      },
      session: {
        id: "s-1",
        token: "t",
        expiresAt: new Date(),
      },
    };

    // Allowed for Telecaller
    expect(() =>
      requireRole(telecallerContext, [UserRole.TELECALLER, UserRole.BROKER_OWNER])
    ).not.toThrow();

    // Denied for Telecaller
    expect(() =>
      requireRole(telecallerContext, [UserRole.BROKER_OWNER, UserRole.TEAM_LEADER])
    ).toThrow(ForbiddenError);
  });

  it("enforces tenant boundary via assertTenantOwnership", () => {
    // Matching tenant: passes
    expect(() => assertTenantOwnership("tenant-apex", "tenant-apex")).not.toThrow();

    // Cross-tenant: throws NotFoundError to prevent record ID enumeration
    expect(() => assertTenantOwnership("tenant-horizon", "tenant-apex", "Property")).toThrow(
      NotFoundError
    );
  });
});
