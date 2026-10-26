/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole } from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError, NotFoundError } from "@/server/errors";

vi.mock("@/server/db", () => {
  const mockPrisma: any = {
    tenant: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    account: {
      create: vi.fn(),
    },
    userAuditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

vi.mock("better-auth/crypto", () => ({
  hashPassword: vi.fn(async (pwd: string) => `hashed_${pwd}`),
}));

import { prisma } from "@/server/db";
import {
  listTenants,
  getTenantById,
  provisionTenant,
  updateTenantStatus,
} from "@/server/dal/tenants";

describe("Platform Super Admin & Tenant Provisioning DAL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(prisma));
  });

  const superAdminContext: TenantContext = {
    userId: "superadmin-root",
    tenantId: "tenant-system",
    role: UserRole.PLATFORM_SUPER_ADMIN,
    user: {
      id: "superadmin-root",
      email: "superadmin@broker-crm.internal",
      name: "Platform Super Admin",
      role: UserRole.PLATFORM_SUPER_ADMIN,
      tenantId: "tenant-system",
      isActive: true,
    },
    session: {
      id: "sess-super",
      token: "tok-super",
      expiresAt: new Date(Date.now() + 60000),
    },
  };

  const brokerOwnerContext: TenantContext = {
    userId: "user-owner-1",
    tenantId: "tenant-apex",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-owner-1",
      email: "owner@apex.in",
      name: "Broker Owner",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-owner",
      token: "tok-owner",
      expiresAt: new Date(Date.now() + 60000),
    },
  };

  describe("listTenants", () => {
    it("denies access to non-platform roles", async () => {
      await expect(listTenants(brokerOwnerContext)).rejects.toThrow(ForbiddenError);
      expect(prisma.tenant.findMany).not.toHaveBeenCalled();
    });

    it("lists all non-system tenants with counts for super admin", async () => {
      vi.mocked(prisma.tenant.findMany).mockResolvedValueOnce([
        {
          id: "tenant-1",
          name: "Apex Realty",
          slug: "apex-realty",
          isActive: true,
          maxSeats: 10,
          _count: { users: 5, properties: 12, leads: 8 },
        } as any,
      ]);

      const result = await listTenants(superAdminContext);

      expect(result).toHaveLength(1);
      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            slug: { not: "platform-system" },
          },
        })
      );
    });
  });

  describe("getTenantById", () => {
    it("denies access to non-platform roles", async () => {
      await expect(getTenantById(brokerOwnerContext, "tenant-1")).rejects.toThrow(ForbiddenError);
      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });

    it("throws NotFoundError if tenant does not exist", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce(null);

      await expect(getTenantById(superAdminContext, "tenant-missing")).rejects.toThrow(NotFoundError);
    });

    it("returns tenant details with admin user list and counts", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
        id: "tenant-1",
        name: "Apex Realty",
        slug: "apex-realty",
        users: [
          {
            id: "admin-1",
            name: "Tenant Admin",
            email: "admin@apex.in",
            role: UserRole.CRM_TENANT_ADMIN,
          },
        ],
        _count: { users: 4, properties: 10, leads: 5 },
      } as any);

      const result = await getTenantById(superAdminContext, "tenant-1");

      expect(result.id).toBe("tenant-1");
      expect(result.users).toHaveLength(1);
    });
  });

  describe("provisionTenant", () => {
    const validData = {
      name: "Bluechip Properties",
      slug: "bluechip-props",
      adminName: "Vikram Admin",
      adminEmail: "vikram@bluechip.in",
      adminPhone: "+91 98765 00000",
      adminPassword: "StrongPassword123!",
      maxSeats: 15,
    };

    it("denies provisioning by non-platform roles", async () => {
      await expect(provisionTenant(brokerOwnerContext, validData)).rejects.toThrow(ForbiddenError);
      expect(prisma.tenant.create).not.toHaveBeenCalled();
    });

    it("rejects invalid organization names", async () => {
      await expect(
        provisionTenant(superAdminContext, { ...validData, name: " " })
      ).rejects.toThrow(ForbiddenError);
    });

    it("rejects invalid slugs containing spaces or special characters", async () => {
      await expect(
        provisionTenant(superAdminContext, { ...validData, slug: "Blue Chip Realty!" })
      ).rejects.toThrow(ForbiddenError);
    });

    it("rejects duplicate tenant slug", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
        id: "existing-tenant",
        slug: "bluechip-props",
      } as any);

      await expect(provisionTenant(superAdminContext, validData)).rejects.toThrow(
        "already in use"
      );
    });

    it("rejects duplicate admin email address", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "existing-user",
        email: "vikram@bluechip.in",
      } as any);

      await expect(provisionTenant(superAdminContext, validData)).rejects.toThrow(
        "already exists"
      );
    });

    it("rejects weak password shorter than 8 characters", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

      await expect(
        provisionTenant(superAdminContext, { ...validData, adminPassword: "short" })
      ).rejects.toThrow("at least 8 characters");
    });

    it("atomically provisions tenant, admin user, credential account, and audit log", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

      const createdTenant = {
        id: "new-tenant-id",
        name: "Bluechip Properties",
        slug: "bluechip-props",
        maxSeats: 15,
        isActive: true,
      };

      const createdAdmin = {
        id: "new-admin-id",
        tenantId: "new-tenant-id",
        name: "Vikram Admin",
        email: "vikram@bluechip.in",
        role: UserRole.CRM_TENANT_ADMIN,
        isActive: true,
      };

      vi.mocked(prisma.tenant.create).mockResolvedValueOnce(createdTenant as any);
      vi.mocked(prisma.user.create).mockResolvedValueOnce(createdAdmin as any);
      vi.mocked(prisma.account.create).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.userAuditLog.create).mockResolvedValueOnce({} as any);

      const result = await provisionTenant(superAdminContext, validData);

      expect(result.tenant.id).toBe("new-tenant-id");
      expect(result.adminUser.id).toBe("new-admin-id");

      expect(prisma.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Bluechip Properties",
            slug: "bluechip-props",
            maxSeats: 15,
            isActive: true,
          }),
        })
      );

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: "new-tenant-id",
            role: UserRole.CRM_TENANT_ADMIN,
            email: "vikram@bluechip.in",
          }),
        })
      );

      expect(prisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "new-admin-id",
            providerId: "credential",
            password: "hashed_StrongPassword123!",
          }),
        })
      );

      expect(prisma.userAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: "new-tenant-id",
            targetUserId: "new-admin-id",
            actorUserId: "superadmin-root",
            action: "TENANT_PROVISIONED",
          }),
        })
      );
    });
  });

  describe("updateTenantStatus", () => {
    it("denies tenant status modification to non-platform roles", async () => {
      await expect(
        updateTenantStatus(brokerOwnerContext, "tenant-1", false)
      ).rejects.toThrow(ForbiddenError);
    });

    it("throws NotFoundError if tenant does not exist", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce(null);

      await expect(
        updateTenantStatus(superAdminContext, "tenant-missing", false)
      ).rejects.toThrow(NotFoundError);
    });

    it("prohibits deactivating the system platform root tenant", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
        id: "sys-tenant",
        slug: "platform-system",
        isActive: true,
      } as any);

      await expect(
        updateTenantStatus(superAdminContext, "sys-tenant", false)
      ).rejects.toThrow("Cannot deactivate the system platform root tenant");

      expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it("successfully toggles tenant status and logs TENANT_STATUS_UPDATED audit event", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
        id: "tenant-to-deactivate",
        slug: "customer-realty",
        isActive: true,
      } as any);

      vi.mocked(prisma.tenant.update).mockResolvedValueOnce({
        id: "tenant-to-deactivate",
        slug: "customer-realty",
        isActive: false,
      } as any);

      vi.mocked(prisma.userAuditLog.create).mockResolvedValueOnce({} as any);

      const result = await updateTenantStatus(superAdminContext, "tenant-to-deactivate", false);

      expect(result.isActive).toBe(false);
      expect(prisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "tenant-to-deactivate" },
          data: { isActive: false },
        })
      );
      expect(prisma.userAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: "tenant-to-deactivate",
            actorUserId: "superadmin-root",
            action: "TENANT_STATUS_UPDATED",
          }),
        })
      );
    });
  });
});
