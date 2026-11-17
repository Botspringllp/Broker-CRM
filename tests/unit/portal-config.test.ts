import { describe, it, expect, afterEach, vi } from "vitest";
import { PortalProvider, UserRole } from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
import {
  listTenantPortalConfigs,
  getTenantPortalConfig,
  setPortalIntegrationStatus,
  generatePortalWebhookToken,
  rotatePortalWebhookToken,
  validatePortalProvider,
  assertAuthorizedPortalAdmin,
  SAFE_PORTAL_CONFIG_SELECT,
} from "@/server/dal/portal-config";
import { prisma } from "@/server/db";
import { verifyWebhookToken, hashWebhookToken } from "@/server/security/portal-tokens";

describe("Portal Configuration DAL: Unit Tests & Security Invariants (Stage 3A)", () => {
  const mockTenantIdA = "tenant-alpha-uuid";

  const brokerOwnerContext: TenantContext = {
    userId: "user-broker-1",
    tenantId: mockTenantIdA,
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-broker-1",
      email: "broker@alpha.test",
      name: "Broker Owner Alpha",
      role: UserRole.BROKER_OWNER,
      tenantId: mockTenantIdA,
      isActive: true,
    },
    session: {
      id: "session-1",
      token: "session-token-1",
      expiresAt: new Date(Date.now() + 3600000),
    },
  };

  const tenantAdminContext: TenantContext = {
    userId: "user-admin-1",
    tenantId: mockTenantIdA,
    role: UserRole.CRM_TENANT_ADMIN,
    user: {
      id: "user-admin-1",
      email: "admin@alpha.test",
      name: "CRM Admin Alpha",
      role: UserRole.CRM_TENANT_ADMIN,
      tenantId: mockTenantIdA,
      isActive: true,
    },
    session: {
      id: "session-2",
      token: "session-token-2",
      expiresAt: new Date(Date.now() + 3600000),
    },
  };

  const telecallerContext: TenantContext = {
    userId: "user-telecaller-1",
    tenantId: mockTenantIdA,
    role: UserRole.TELECALLER,
    user: {
      id: "user-telecaller-1",
      email: "telecaller@alpha.test",
      name: "Telecaller Alpha",
      role: UserRole.TELECALLER,
      tenantId: mockTenantIdA,
      isActive: true,
    },
    session: {
      id: "session-3",
      token: "session-token-3",
      expiresAt: new Date(Date.now() + 3600000),
    },
  };

  const teamLeaderContext: TenantContext = {
    ...telecallerContext,
    role: UserRole.TEAM_LEADER,
    user: { ...telecallerContext.user, role: UserRole.TEAM_LEADER },
  };

  const fieldVerifierContext: TenantContext = {
    ...telecallerContext,
    role: UserRole.FIELD_VERIFIER,
    user: { ...telecallerContext.user, role: UserRole.FIELD_VERIFIER },
  };

  const fieldSalesAgentContext: TenantContext = {
    ...telecallerContext,
    role: UserRole.FIELD_SALES_AGENT,
    user: { ...telecallerContext.user, role: UserRole.FIELD_SALES_AGENT },
  };

  const platformSuperAdminContext: TenantContext = {
    userId: "user-super-1",
    tenantId: "platform-system",
    role: UserRole.PLATFORM_SUPER_ADMIN,
    user: {
      id: "user-super-1",
      email: "super@broker-crm.internal",
      name: "Platform Super Admin",
      role: UserRole.PLATFORM_SUPER_ADMIN,
      tenantId: "platform-system",
      isActive: true,
    },
    session: {
      id: "session-super",
      token: "session-token-super",
      expiresAt: new Date(Date.now() + 3600000),
    },
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Authorization & Role Verification", () => {
    it("permits BROKER_OWNER and CRM_TENANT_ADMIN to manage configurations", () => {
      expect(() => assertAuthorizedPortalAdmin(brokerOwnerContext)).not.toThrow();
      expect(() => assertAuthorizedPortalAdmin(tenantAdminContext)).not.toThrow();
    });

    it("rejects unauthorized roles (TELECALLER, TEAM_LEADER, FIELD_VERIFIER, FIELD_SALES_AGENT, PLATFORM_SUPER_ADMIN)", () => {
      expect(() => assertAuthorizedPortalAdmin(telecallerContext)).toThrow(ForbiddenError);
      expect(() => assertAuthorizedPortalAdmin(teamLeaderContext)).toThrow(ForbiddenError);
      expect(() => assertAuthorizedPortalAdmin(fieldVerifierContext)).toThrow(ForbiddenError);
      expect(() => assertAuthorizedPortalAdmin(fieldSalesAgentContext)).toThrow(ForbiddenError);
      expect(() => assertAuthorizedPortalAdmin(platformSuperAdminContext)).toThrow(ForbiddenError);
    });

    it("rejects missing authentication session or missing tenantId with UnauthorizedError", () => {
      expect(() => assertAuthorizedPortalAdmin(null as unknown as TenantContext)).toThrow(UnauthorizedError);
      expect(() =>
        assertAuthorizedPortalAdmin({ ...brokerOwnerContext, tenantId: "" })
      ).toThrow(UnauthorizedError);
    });
  });

  describe("2. Provider Enum Validation", () => {
    it("accepts valid Prisma PortalProvider values", () => {
      expect(validatePortalProvider(PortalProvider.NINETY_NINE_ACRES)).toBe(
        PortalProvider.NINETY_NINE_ACRES
      );
      expect(validatePortalProvider(PortalProvider.MAGICBRICKS)).toBe(
        PortalProvider.MAGICBRICKS
      );
      expect(validatePortalProvider(PortalProvider.NOBROKER)).toBe(
        PortalProvider.NOBROKER
      );
    });

    it("rejects invalid or arbitrary provider strings with ValidationError", () => {
      expect(() => validatePortalProvider("HOUSING_DOT_COM")).toThrow(ValidationError);
      expect(() => validatePortalProvider("")).toThrow(ValidationError);
      expect(() => validatePortalProvider(null)).toThrow(ValidationError);
      expect(() => validatePortalProvider(123)).toThrow(ValidationError);
    });
  });

  describe("3. Safe Configuration Listing & Retrieval", () => {
    it("returns configurations belonging strictly to the authenticated caller's tenantId", async () => {
      const mockDbConfigs = [
        {
          id: "cfg-1",
          tenantId: mockTenantIdA,
          provider: PortalProvider.NINETY_NINE_ACRES,
          isEnabled: true,
          webhookTokenHash: "dummy-hash",
          tokenCreatedAt: new Date("2026-11-01T10:00:00Z"),
          tokenRotatedAt: null,
          createdAt: new Date("2026-11-01T10:00:00Z"),
          updatedAt: new Date("2026-11-01T10:00:00Z"),
        },
      ];

      const findManySpy = vi
        .spyOn(prisma.tenantPortalConfig, "findMany")
        .mockResolvedValue(mockDbConfigs);

      const result = await listTenantPortalConfigs(brokerOwnerContext);

      expect(findManySpy).toHaveBeenCalledWith({
        where: { tenantId: mockTenantIdA },
        select: SAFE_PORTAL_CONFIG_SELECT,
        orderBy: { provider: "asc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].tenantId).toBe(mockTenantIdA);
      expect(result[0].provider).toBe(PortalProvider.NINETY_NINE_ACRES);
    });

    it("ensures SAFE_PORTAL_CONFIG_SELECT never exposes webhookTokenHash or rawToken", () => {
      expect((SAFE_PORTAL_CONFIG_SELECT as Record<string, unknown>).webhookTokenHash).toBeUndefined();
      expect((SAFE_PORTAL_CONFIG_SELECT as Record<string, unknown>).rawToken).toBeUndefined();
    });

    it("retrieves a single configuration strictly scoped by tenantId and provider", async () => {
      const mockConfig = {
        id: "cfg-2",
        tenantId: mockTenantIdA,
        provider: PortalProvider.MAGICBRICKS,
        isEnabled: false,
        webhookTokenHash: "dummy-hash",
        tokenCreatedAt: new Date("2026-11-01T10:00:00Z"),
        tokenRotatedAt: null,
        createdAt: new Date("2026-11-01T10:00:00Z"),
        updatedAt: new Date("2026-11-01T10:00:00Z"),
      };

      const findUniqueSpy = vi
        .spyOn(prisma.tenantPortalConfig, "findUnique")
        .mockResolvedValue(mockConfig);

      const result = await getTenantPortalConfig(
        tenantAdminContext,
        PortalProvider.MAGICBRICKS
      );

      expect(findUniqueSpy).toHaveBeenCalledWith({
        where: {
          tenantId_provider: {
            tenantId: mockTenantIdA,
            provider: PortalProvider.MAGICBRICKS,
          },
        },
        select: SAFE_PORTAL_CONFIG_SELECT,
      });
      expect(result?.provider).toBe(PortalProvider.MAGICBRICKS);
      expect(result?.isEnabled).toBe(false);
    });
  });

  describe("4. Enable / Disable Integration Status", () => {
    it("updates integration status strictly for the authenticated tenant and provider", async () => {
      vi.spyOn(prisma.tenantPortalConfig, "findUnique").mockResolvedValue({
        id: "cfg-1",
        tenantId: mockTenantIdA,
        provider: PortalProvider.NINETY_NINE_ACRES,
        isEnabled: true,
        webhookTokenHash: "dummy-hash",
        tokenCreatedAt: new Date(),
        tokenRotatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const updateSpy = vi
        .spyOn(prisma.tenantPortalConfig, "update")
        .mockResolvedValue({
          id: "cfg-1",
          tenantId: mockTenantIdA,
          provider: PortalProvider.NINETY_NINE_ACRES,
          isEnabled: false,
          webhookTokenHash: "dummy-hash",
          tokenCreatedAt: new Date(),
          tokenRotatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      const result = await setPortalIntegrationStatus(
        brokerOwnerContext,
        PortalProvider.NINETY_NINE_ACRES,
        false
      );

      expect(updateSpy).toHaveBeenCalledWith({
        where: {
          tenantId_provider: {
            tenantId: mockTenantIdA,
            provider: PortalProvider.NINETY_NINE_ACRES,
          },
        },
        data: { isEnabled: false },
        select: SAFE_PORTAL_CONFIG_SELECT,
      });
      expect(result.isEnabled).toBe(false);
    });

    it("throws NotFoundError when attempting to update an unconfigured provider", async () => {
      vi.spyOn(prisma.tenantPortalConfig, "findUnique").mockResolvedValue(null);

      await expect(
        setPortalIntegrationStatus(brokerOwnerContext, PortalProvider.NOBROKER, true)
      ).rejects.toThrow(NotFoundError);
    });

    it("throws ValidationError when isEnabled is not a boolean", async () => {
      await expect(
        setPortalIntegrationStatus(
          brokerOwnerContext,
          PortalProvider.NINETY_NINE_ACRES,
          "true" as unknown as boolean
        )
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("5. Token Generation (One-Time Disclosure & Hash-Only Persistence)", () => {
    it("stores only the SHA-256 token hash in the database and returns raw token once", async () => {
      vi.spyOn(prisma.tenantPortalConfig, "findUnique").mockResolvedValue(null);

      let capturedCreateData: {
        tenantId: string;
        provider: PortalProvider;
        isEnabled: boolean;
        webhookTokenHash: string;
        rawToken?: string;
      } | null = null;
      const genuineCreate = prisma.tenantPortalConfig.create;
      prisma.tenantPortalConfig.create = (async (args: {
        data: {
          tenantId: string;
          provider: PortalProvider;
          isEnabled: boolean;
          webhookTokenHash: string;
          rawToken?: string;
        };
      }) => {
        capturedCreateData = args.data;
        return {
          id: "cfg-new-1",
          tenantId: mockTenantIdA,
          provider: PortalProvider.NINETY_NINE_ACRES,
          isEnabled: true,
          tokenCreatedAt: new Date(),
          tokenRotatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }) as unknown as typeof genuineCreate;

      try {
        const result = await generatePortalWebhookToken(
          brokerOwnerContext,
          PortalProvider.NINETY_NINE_ACRES
        );

        // Verify rawToken is returned to caller
        expect(typeof result.rawToken).toBe("string");
        expect(result.rawToken.length).toBe(64); // 32 bytes hex encoded = 64 chars

        // Verify database payload stored ONLY the hash and NEVER the rawToken
        expect(capturedCreateData).not.toBeNull();
        const createData = capturedCreateData!;
        expect(createData.rawToken).toBeUndefined();
        expect(createData.webhookTokenHash).toBe(hashWebhookToken(result.rawToken));
        expect(createData.tenantId).toBe(mockTenantIdA);
        expect(createData.provider).toBe(PortalProvider.NINETY_NINE_ACRES);

        // Verify the generated raw token successfully verifies against the stored hash
        expect(verifyWebhookToken(result.rawToken, createData.webhookTokenHash)).toBe(true);

        // Verify config DTO returned does NOT contain the token hash or raw token
        expect((result.config as unknown as Record<string, unknown>).webhookTokenHash).toBeUndefined();
        expect((result.config as unknown as Record<string, unknown>).rawToken).toBeUndefined();
      } finally {
        prisma.tenantPortalConfig.create = genuineCreate;
      }
    });

    it("rejects token generation if a configuration already exists for this provider", async () => {
      vi.spyOn(prisma.tenantPortalConfig, "findUnique").mockResolvedValue({
        id: "existing-cfg",
        tenantId: mockTenantIdA,
        provider: PortalProvider.NINETY_NINE_ACRES,
        isEnabled: true,
        webhookTokenHash: "dummy-hash",
        tokenCreatedAt: new Date(),
        tokenRotatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        generatePortalWebhookToken(brokerOwnerContext, PortalProvider.NINETY_NINE_ACRES)
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("6. Token Rotation (Atomic Invalidation & Concurrency Guard)", () => {
    it("rotates token atomically in a transaction: generates new raw token, stores new hash, updates rotatedAt", async () => {
      const initialRaw = "a".repeat(64);
      const initialHash = hashWebhookToken(initialRaw);

      const existingConfig = {
        id: "cfg-rotate-1",
        tenantId: mockTenantIdA,
        provider: PortalProvider.MAGICBRICKS,
        webhookTokenHash: initialHash,
        tokenCreatedAt: new Date("2026-11-01T10:00:00Z"),
        tokenRotatedAt: null,
      };

      let capturedUpdateData: {
        data: {
          webhookTokenHash: string;
          tokenRotatedAt: Date;
        };
      } | null = null;
      const mockTx = {
        tenantPortalConfig: {
          findUnique: vi.fn().mockResolvedValue(existingConfig),
          updateMany: vi.fn().mockImplementation(async (args: { data: { webhookTokenHash: string; tokenRotatedAt: Date } }) => {
            capturedUpdateData = args;
            return { count: 1 };
          }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: "cfg-rotate-1",
            tenantId: mockTenantIdA,
            provider: PortalProvider.MAGICBRICKS,
            isEnabled: true,
            tokenCreatedAt: existingConfig.tokenCreatedAt,
            tokenRotatedAt: new Date(),
            createdAt: new Date("2026-11-01T10:00:00Z"),
            updatedAt: new Date(),
          }),
        },
      };

      const genuineTx = prisma.$transaction;
      prisma.$transaction = (async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)) as unknown as typeof genuineTx;

      try {
        const result = await rotatePortalWebhookToken(
          tenantAdminContext,
          PortalProvider.MAGICBRICKS
        );

        // Verify new raw token was disclosed
        expect(typeof result.rawToken).toBe("string");
        expect(result.rawToken.length).toBe(64);
        expect(result.rawToken).not.toBe(initialRaw);

        // Verify new token validates against newly stored hash
        expect(capturedUpdateData).not.toBeNull();
        const newStoredHash = capturedUpdateData!.data.webhookTokenHash;
        expect(newStoredHash).not.toBe(initialHash);
        expect(verifyWebhookToken(result.rawToken, newStoredHash)).toBe(true);

        // Verify the OLD raw token now FAILS verification against the new hash
        expect(verifyWebhookToken(initialRaw, newStoredHash)).toBe(false);

        // Verify rotation timestamp was recorded
        expect(capturedUpdateData!.data.tokenRotatedAt).toBeInstanceOf(Date);
      } finally {
        prisma.$transaction = genuineTx;
      }
    });

    it("throws ValidationError when concurrent rotation occurs during updateMany", async () => {
      const mockTx = {
        tenantPortalConfig: {
          findUnique: vi.fn().mockResolvedValue({
            id: "cfg-race-1",
            tenantId: mockTenantIdA,
            provider: PortalProvider.NOBROKER,
            webhookTokenHash: hashWebhookToken("b".repeat(64)),
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), // 0 updated = concurrent conflict
        },
      };

      const genuineTx = prisma.$transaction;
      prisma.$transaction = (async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)) as unknown as typeof genuineTx;

      try {
        await expect(
          rotatePortalWebhookToken(brokerOwnerContext, PortalProvider.NOBROKER)
        ).rejects.toThrow(/concurrent token rotation/i);
      } finally {
        prisma.$transaction = genuineTx;
      }
    });

    it("throws NotFoundError when attempting to rotate token for an unconfigured provider", async () => {
      const mockTx = {
        tenantPortalConfig: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };

      const genuineTx = prisma.$transaction;
      prisma.$transaction = (async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)) as unknown as typeof genuineTx;

      try {
        await expect(
          rotatePortalWebhookToken(brokerOwnerContext, PortalProvider.NOBROKER)
        ).rejects.toThrow(NotFoundError);
      } finally {
        prisma.$transaction = genuineTx;
      }
    });
  });
});

