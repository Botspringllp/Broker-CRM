/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole } from "@prisma/client";

vi.mock("@/server/db", () => {
  const mockPrisma: any = {
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    account: {
      create: vi.fn(),
    },
    userAuditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
    $disconnect: vi.fn(),
  };
  return { prisma: mockPrisma };
});

vi.mock("better-auth/crypto", () => ({
  hashPassword: vi.fn(async (pwd: string) => `scrypt_hash_${pwd}`),
}));

import { prisma } from "@/server/db";
import { bootstrapSuperAdmin } from "../../scripts/bootstrap-superadmin";

describe("Platform Super Admin Bootstrap Script", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(prisma));
  });

  it("is strictly idempotent: cancels if a Platform Super Admin already exists", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: "existing-super-1",
      email: "existing@internal.com",
    } as any);

    const result = await bootstrapSuperAdmin({
      email: "new@internal.com",
      password: "SuperSecretPassword123!",
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("ALREADY_EXISTS");
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it("validates email format", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

    await expect(
      bootstrapSuperAdmin({
        email: "invalid-email",
        password: "SuperSecretPassword123!",
      })
    ).rejects.toThrow("Invalid email address");
  });

  it("validates minimum password length (>= 8 chars)", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

    await expect(
      bootstrapSuperAdmin({
        email: "valid@internal.com",
        password: "short",
      })
    ).rejects.toThrow("at least 8 characters");
  });

  it("successfully bootstraps platform root tenant, super admin user, and credential account", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce(null);

    const mockRootTenant = {
      id: "root-tenant-id",
      name: "Broker CRM Platform Administration",
      slug: "platform-system",
      isActive: true,
      maxSeats: 999999,
    };

    const mockSuperUser = {
      id: "super-user-id",
      tenantId: "root-tenant-id",
      name: "Root Admin",
      email: "root@broker-crm.internal",
      role: UserRole.PLATFORM_SUPER_ADMIN,
      isActive: true,
      emailVerified: true,
    };

    vi.mocked(prisma.tenant.create).mockResolvedValueOnce(mockRootTenant as any);
    vi.mocked(prisma.user.create).mockResolvedValueOnce(mockSuperUser as any);
    vi.mocked(prisma.account.create).mockResolvedValueOnce({} as any);
    vi.mocked(prisma.userAuditLog.create).mockResolvedValueOnce({} as any);

    const result = await bootstrapSuperAdmin({
      email: "root@broker-crm.internal",
      password: "StrongPassword123!",
      name: "Root Admin",
    });

    expect(result.success).toBe(true);
    expect(result.user?.id).toBe("super-user-id");
    expect(result.tenant?.slug).toBe("platform-system");

    expect(prisma.tenant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: "platform-system",
          isActive: true,
        }),
      })
    );

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: UserRole.PLATFORM_SUPER_ADMIN,
          email: "root@broker-crm.internal",
          tenantId: "root-tenant-id",
        }),
      })
    );

    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "super-user-id",
          providerId: "credential",
          password: "scrypt_hash_StrongPassword123!",
        }),
      })
    );

    expect(prisma.userAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "root-tenant-id",
          targetUserId: "super-user-id",
          action: "PLATFORM_SUPER_ADMIN_BOOTSTRAP",
        }),
      })
    );
  });
});
