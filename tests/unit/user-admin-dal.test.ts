/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole } from "@prisma/client";
import { TenantContext, NotFoundError, ForbiddenError } from "@/server/tenant-context";

// Mock Prisma DB module
vi.mock("@/server/db", () => {
  const mockPrisma: any = {
    tenant: {
      findUnique: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    account: {
      create: vi.fn(),
    },
    userAuditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

import { prisma } from "@/server/db";
import {
  listTenantUsers,
  getTenantUserById,
  createTenantUser,
  updateUserRole,
  updateUserStatus,
  assignUserTeamLeader,
  assignUserBroker,
  updateDelegatedPermissions,
  listUserAuditLogs,
} from "@/server/dal/users";

describe("User Administration & Delegation DAL (PRD §3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: "tenant-apex",
      name: "Apex Realty",
      slug: "apex-realty",
      isActive: true,
      maxSeats: 10,
    } as any);
    vi.mocked(prisma.user.count).mockResolvedValue(2);
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(prisma));
  });

  const ownerContext: TenantContext = {
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

  const tlContext: TenantContext = {
    userId: "user-tl-1",
    tenantId: "tenant-apex",
    role: UserRole.TEAM_LEADER,
    user: {
      id: "user-tl-1",
      email: "tl@apex.in",
      name: "Team Leader One",
      role: UserRole.TEAM_LEADER,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-tl",
      token: "tok-tl",
      expiresAt: new Date(Date.now() + 60000),
    },
  };

  const adminContext: TenantContext = {
    userId: "user-admin-1",
    tenantId: "tenant-apex",
    role: UserRole.CRM_TENANT_ADMIN,
    user: {
      id: "user-admin-1",
      email: "admin@apex.in",
      name: "Tenant Admin",
      role: UserRole.CRM_TENANT_ADMIN,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-admin",
      token: "tok-admin",
      expiresAt: new Date(Date.now() + 60000),
    },
  };

  const foreignOwnerContext: TenantContext = {
    userId: "user-foreign-owner",
    tenantId: "tenant-horizon",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-foreign-owner",
      email: "owner@horizon.in",
      name: "Horizon Owner",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-horizon",
      isActive: true,
    },
    session: {
      id: "sess-foreign",
      token: "tok-foreign",
      expiresAt: new Date(Date.now() + 60000),
    },
  };

  describe("listTenantUsers", () => {
    it("scopes user listing strictly to the tenant", async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValueOnce([]);

      await listTenantUsers(ownerContext);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-apex",
          }),
        })
      );
    });

    it("restricts Team Leader to subordinates and self", async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValueOnce([]);

      await listTenantUsers(tlContext);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-apex",
            OR: [
              { teamLeaderId: "user-tl-1" },
              { id: "user-tl-1" },
            ],
          }),
        })
      );
    });
  });

  describe("getTenantUserById", () => {
    it("throws NotFoundError when querying user in another tenant (anti-enumeration)", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

      await expect(getTenantUserById(ownerContext, "user-foreign-999")).rejects.toThrow(
        NotFoundError
      );

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "user-foreign-999",
            tenantId: "tenant-apex",
          },
        })
      );
    });

    it("throws NotFoundError when Team Leader queries non-subordinate user", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "other-user-99",
        tenantId: "tenant-apex",
        name: "Other User",
        email: "other@apex.in",
        role: UserRole.TELECALLER,
        teamLeaderId: "different-tl-id",
        isActive: true,
      } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>);

      await expect(getTenantUserById(tlContext, "other-user-99")).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError when Broker Owner queries a user belonging to another Broker (cross-broker barrier)", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "broker-2-agent",
        tenantId: "tenant-apex",
        name: "Agent of Broker 2",
        email: "b2.agent@apex.in",
        role: UserRole.FIELD_SALES_AGENT,
        brokerId: "other-broker-2",
        isActive: true,
      } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>);

      await expect(getTenantUserById(ownerContext, "broker-2-agent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("createTenantUser", () => {
    it("denies unauthorized role creation (e.g. creating Platform Super Admin)", async () => {
      await expect(
        createTenantUser(ownerContext, {
          name: "Attacker Admin",
          email: "attacker@apex.in",
          role: UserRole.PLATFORM_SUPER_ADMIN,
        })
      ).rejects.toThrow(ForbiddenError);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("denies delegating unpossessed permissions at creation time", async () => {
      await expect(
        createTenantUser(ownerContext, {
          name: "Subordinate",
          email: "sub@apex.in",
          role: UserRole.TELECALLER,
          delegatedPermissions: ["platform:manage_tenants"],
        })
      ).rejects.toThrow(ForbiddenError);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("denies user creation when tenant seat limit has been reached", async () => {
      vi.mocked(prisma.user.count).mockResolvedValueOnce(10); // 10 active users for maxSeats: 10

      await expect(
        createTenantUser(ownerContext, {
          name: "Overflow User",
          email: "overflow@apex.in",
          role: UserRole.TELECALLER,
        })
      ).rejects.toThrow(ForbiddenError);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("creates user and writes immutable audit log on valid creation", async () => {
      const mockCreatedUser = {
        id: "new-user-1",
        tenantId: "tenant-apex",
        name: "New Telecaller",
        email: "new.tc@apex.in",
        phone: "+91 98765 43210",
        role: UserRole.TELECALLER,
        isActive: true,
        teamLeaderId: "user-tl-1",
        delegatedPermissions: ["supply:log_call"],
      };

      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "user-tl-1",
        tenantId: "tenant-apex",
        role: UserRole.TEAM_LEADER,
      } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>);

      vi.mocked(prisma.user.create).mockResolvedValueOnce(mockCreatedUser as unknown as Awaited<ReturnType<typeof prisma.user.create>>);
      vi.mocked(prisma.userAuditLog.create).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof prisma.userAuditLog.create>>);

      const result = await createTenantUser(ownerContext, {
        name: "New Telecaller",
        email: "new.tc@apex.in",
        phone: "+91 98765 43210",
        role: UserRole.TELECALLER,
        teamLeaderId: "user-tl-1",
        delegatedPermissions: ["supply:log_call"],
      });

      expect(result.id).toBe("new-user-1");
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: "tenant-apex",
            role: UserRole.TELECALLER,
            teamLeaderId: "user-tl-1",
            delegatedPermissions: ["supply:log_call"],
          }),
        })
      );
      expect(prisma.userAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: "tenant-apex",
            targetUserId: "new-user-1",
            actorUserId: "user-owner-1",
            action: "USER_CREATED",
          }),
        })
      );
    });

    it("creates Better Auth credential account when initial password is provided", async () => {
      const mockCreatedUser = {
        id: "new-user-pwd",
        tenantId: "tenant-apex",
        name: "Password User",
        email: "pwd@apex.in",
        phone: "+91 98765 43211",
        role: UserRole.TELECALLER,
        isActive: true,
      };

      vi.mocked(prisma.user.create).mockResolvedValueOnce(mockCreatedUser as any);
      vi.mocked(prisma.account.create).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.userAuditLog.create).mockResolvedValueOnce({} as any);

      await createTenantUser(ownerContext, {
        name: "Password User",
        email: "pwd@apex.in",
        role: UserRole.TELECALLER,
        password: "SuperSecretPassword123!",
      });

      expect(prisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "new-user-pwd",
            providerId: "credential",
            accountId: "new-user-pwd",
            password: expect.any(String),
          }),
        })
      );
    });
  });

  describe("updateUserRole", () => {
    it("blocks self-escalation (cannot update own role)", async () => {
      await expect(
        updateUserRole(ownerContext, "user-owner-1", UserRole.PLATFORM_SUPER_ADMIN)
      ).rejects.toThrow(ForbiddenError);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("blocks cross-tenant role modifications", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

      await expect(
        updateUserRole(foreignOwnerContext, "target-apex-user", UserRole.TEAM_LEADER)
      ).rejects.toThrow(NotFoundError);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("records ROLE_UPDATED in audit trail upon valid update", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "target-user-1",
        tenantId: "tenant-apex",
        role: UserRole.TELECALLER,
        brokerId: "user-owner-1",
      } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>);

      vi.mocked(prisma.user.update).mockResolvedValueOnce({
        id: "target-user-1",
        role: UserRole.TEAM_LEADER,
      } as unknown as Awaited<ReturnType<typeof prisma.user.update>>);

      vi.mocked(prisma.userAuditLog.create).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof prisma.userAuditLog.create>>);

      await updateUserRole(ownerContext, "target-user-1", UserRole.TEAM_LEADER);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "target-user-1" },
          data: { role: UserRole.TEAM_LEADER },
        })
      );
      expect(prisma.userAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "ROLE_UPDATED",
            targetUserId: "target-user-1",
            actorUserId: "user-owner-1",
          }),
        })
      );
    });
  });

  describe("updateUserStatus", () => {
    it("blocks self-deactivation", async () => {
      await expect(
        updateUserStatus(ownerContext, "user-owner-1", false)
      ).rejects.toThrow(ForbiddenError);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("records STATUS_UPDATED in audit trail upon deactivation", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "target-user-2",
        tenantId: "tenant-apex",
        role: UserRole.TELECALLER,
        isActive: true,
        brokerId: "user-owner-1",
      } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>);

      vi.mocked(prisma.user.update).mockResolvedValueOnce({
        id: "target-user-2",
        isActive: false,
      } as unknown as Awaited<ReturnType<typeof prisma.user.update>>);

      vi.mocked(prisma.userAuditLog.create).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof prisma.userAuditLog.create>>);

      await updateUserStatus(ownerContext, "target-user-2", false);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "target-user-2" },
          data: { isActive: false },
        })
      );
      expect(prisma.userAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "STATUS_UPDATED",
            targetUserId: "target-user-2",
          }),
        })
      );
    });
  });

  describe("assignUserTeamLeader", () => {
    it("blocks self-reassignment of team leader", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "user-owner-1",
        tenantId: "tenant-apex",
        role: UserRole.BROKER_OWNER,
        brokerId: "user-owner-1",
      } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>);

      await expect(
        assignUserTeamLeader(ownerContext, "user-owner-1", "user-tl-1")
      ).rejects.toThrow(ForbiddenError);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("verifies team leader exists and belongs to tenant", async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce({
          id: "target-user-3",
          tenantId: "tenant-apex",
          role: UserRole.TELECALLER,
          brokerId: "user-owner-1",
        } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>)
        .mockResolvedValueOnce(null); // Designated team leader not found

      await expect(
        assignUserTeamLeader(ownerContext, "target-user-3", "non-existent-tl")
      ).rejects.toThrow(ForbiddenError);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("successfully assigns team leader and logs audit", async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce({
          id: "target-user-3",
          tenantId: "tenant-apex",
          role: UserRole.TELECALLER,
          brokerId: "user-owner-1",
        } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>)
        .mockResolvedValueOnce({
          id: "user-tl-1",
          tenantId: "tenant-apex",
          role: UserRole.TEAM_LEADER,
          brokerId: "user-owner-1",
        } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>);

      vi.mocked(prisma.user.update).mockResolvedValueOnce({
        id: "target-user-3",
        teamLeaderId: "user-tl-1",
      } as unknown as Awaited<ReturnType<typeof prisma.user.update>>);

      vi.mocked(prisma.userAuditLog.create).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof prisma.userAuditLog.create>>);

      await assignUserTeamLeader(ownerContext, "target-user-3", "user-tl-1");

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "target-user-3" },
          data: { teamLeaderId: "user-tl-1" },
        })
      );
      expect(prisma.userAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "TEAM_LEADER_ASSIGNED",
            targetUserId: "target-user-3",
          }),
        })
      );
    });
  });

  describe("assignUserBroker", () => {
    it("denies broker assignment to non-admin actors (e.g. Team Leader)", async () => {
      await expect(
        assignUserBroker(tlContext, "target-tl-2", "user-owner-1")
      ).rejects.toThrow(ForbiddenError);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("verifies designated broker exists and belongs to tenant with BROKER_OWNER role", async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce({
          id: "target-tl-2",
          tenantId: "tenant-apex",
          role: UserRole.TEAM_LEADER,
        } as any)
        .mockResolvedValueOnce(null); // Designated broker not found

      await expect(
        assignUserBroker(adminContext, "target-tl-2", "non-existent-broker")
      ).rejects.toThrow(ForbiddenError);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("successfully assigns broker to a team leader and logs BROKER_ASSIGNED audit event", async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce({
          id: "target-tl-2",
          tenantId: "tenant-apex",
          role: UserRole.TEAM_LEADER,
        } as any)
        .mockResolvedValueOnce({
          id: "user-owner-1",
          tenantId: "tenant-apex",
          role: UserRole.BROKER_OWNER,
        } as any);

      vi.mocked(prisma.user.update).mockResolvedValueOnce({
        id: "target-tl-2",
        brokerId: "user-owner-1",
      } as any);

      vi.mocked(prisma.userAuditLog.create).mockResolvedValueOnce({} as any);

      await assignUserBroker(adminContext, "target-tl-2", "user-owner-1");

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "target-tl-2" },
          data: { brokerId: "user-owner-1" },
        })
      );
      expect(prisma.userAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "BROKER_ASSIGNED",
            targetUserId: "target-tl-2",
            actorUserId: "user-admin-1",
          }),
        })
      );
    });
  });

  describe("updateDelegatedPermissions", () => {
    it("rejects delegating core non-delegable permissions", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "subordinate-1",
        tenantId: "tenant-apex",
        role: UserRole.TELECALLER,
        brokerId: "user-owner-1",
      } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>);

      await expect(
        updateDelegatedPermissions(ownerContext, "subordinate-1", ["admin:manage_users"])
      ).rejects.toThrow(ForbiddenError);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("rejects delegating permissions not possessed by the granter", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "subordinate-1",
        tenantId: "tenant-apex",
        role: UserRole.TELECALLER,
        teamLeaderId: "user-tl-1",
      } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>);

      await expect(
        updateDelegatedPermissions(tlContext, "subordinate-1", ["platform:manage_tenants"])
      ).rejects.toThrow(ForbiddenError);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("successfully delegates allowed operational permission and logs audit", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "subordinate-1",
        tenantId: "tenant-apex",
        role: UserRole.TELECALLER,
        brokerId: "user-owner-1",
      } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>);

      vi.mocked(prisma.user.update).mockResolvedValueOnce({
        id: "subordinate-1",
        delegatedPermissions: ["supply:validate"],
      } as unknown as Awaited<ReturnType<typeof prisma.user.update>>);

      vi.mocked(prisma.userAuditLog.create).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof prisma.userAuditLog.create>>);

      await updateDelegatedPermissions(ownerContext, "subordinate-1", ["supply:validate"]);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "subordinate-1" },
          data: { delegatedPermissions: ["supply:validate"] },
        })
      );
      expect(prisma.userAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "PERMISSIONS_DELEGATED",
            targetUserId: "subordinate-1",
          }),
        })
      );
    });
  });

  describe("listUserAuditLogs", () => {
    it("scopes audit log listing strictly to tenant", async () => {
      vi.mocked(prisma.userAuditLog.findMany).mockResolvedValueOnce([]);

      await listUserAuditLogs(ownerContext);

      expect(prisma.userAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-apex",
          }),
        })
      );
    });

    it("denies audit log access to non-admin roles", async () => {
      const telecallerContext: TenantContext = {
        userId: "tc-unauthorized",
        tenantId: "tenant-apex",
        role: UserRole.TELECALLER,
        user: {
          id: "tc-unauthorized",
          email: "tc@apex.in",
          name: "Telecaller",
          role: UserRole.TELECALLER,
          tenantId: "tenant-apex",
          isActive: true,
        },
        session: {
          id: "sess",
          token: "tok",
          expiresAt: new Date(),
        },
      };

      await expect(listUserAuditLogs(telecallerContext)).rejects.toThrow(ForbiddenError);
      expect(prisma.userAuditLog.findMany).not.toHaveBeenCalled();
    });
  });
});
