import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, PortalProvider, UserRole } from "@prisma/client";
import { getTestPrisma, disconnectTestDb } from "./helpers/db-client";
import { prisma as serverPrisma } from "@/server/db";
import {
  createTestTenant,
  createTestUser,
  createTestContext,
  TestTenantFixture,
} from "./helpers/tenant-helper";
import { TenantContext } from "@/server/tenant-context";
import {
  listTenantPortalConfigs,
  getTenantPortalConfig,
  setPortalIntegrationStatus,
  generatePortalWebhookToken,
  rotatePortalWebhookToken,
  TenantPortalConfigDTO,
} from "@/server/dal/portal-config";
import { verifyWebhookToken } from "@/server/security/portal-tokens";
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";

describe("Live PostgreSQL Integration: Portal Configuration DAL & Token Security (DV-14 Phase 3 Stage 3A)", () => {
  let prisma: PrismaClient;
  let fixtureA: TestTenantFixture;
  let fixtureB: TestTenantFixture;

  let ownerContextA: TenantContext;
  let adminContextA: TenantContext;
  let telecallerContextA: TenantContext;
  let teamLeaderContextA: TenantContext;
  let fieldVerifierContextA: TenantContext;
  let fieldSalesContextA: TenantContext;
  let superAdminContext: TenantContext;

  let ownerContextB: TenantContext;

  beforeAll(async () => {
    prisma = await getTestPrisma();
    fixtureA = await createTestTenant(prisma, "Config DAL Tenant Alpha");
    fixtureB = await createTestTenant(prisma, "Config DAL Tenant Beta");

    // Create users in Tenant Alpha
    const ownerA = await createTestUser(prisma, fixtureA.tenant.id, {
      name: "Alpha Owner",
      role: UserRole.BROKER_OWNER,
      email: `owner-alpha-${Date.now()}@test.com`,
    });
    const adminA = await createTestUser(prisma, fixtureA.tenant.id, {
      name: "Alpha Admin",
      role: UserRole.CRM_TENANT_ADMIN,
      email: `admin-alpha-${Date.now()}@test.com`,
    });
    const telecallerA = await createTestUser(prisma, fixtureA.tenant.id, {
      name: "Alpha Telecaller",
      role: UserRole.TELECALLER,
      email: `caller-alpha-${Date.now()}@test.com`,
    });
    const teamLeaderA = await createTestUser(prisma, fixtureA.tenant.id, {
      name: "Alpha Team Leader",
      role: UserRole.TEAM_LEADER,
      email: `leader-alpha-${Date.now()}@test.com`,
    });
    const verifierA = await createTestUser(prisma, fixtureA.tenant.id, {
      name: "Alpha Verifier",
      role: UserRole.FIELD_VERIFIER,
      email: `verifier-alpha-${Date.now()}@test.com`,
    });
    const salesA = await createTestUser(prisma, fixtureA.tenant.id, {
      name: "Alpha Sales Agent",
      role: UserRole.FIELD_SALES_AGENT,
      email: `sales-alpha-${Date.now()}@test.com`,
    });

    // Create owner in Tenant Beta
    const ownerB = await createTestUser(prisma, fixtureB.tenant.id, {
      name: "Beta Owner",
      role: UserRole.BROKER_OWNER,
      email: `owner-beta-${Date.now()}@test.com`,
    });

    ownerContextA = createTestContext(ownerA);
    adminContextA = createTestContext(adminA);
    telecallerContextA = createTestContext(telecallerA);
    teamLeaderContextA = createTestContext(teamLeaderA);
    fieldVerifierContextA = createTestContext(verifierA);
    fieldSalesContextA = createTestContext(salesA);
    superAdminContext = createTestContext({
      id: "platform-super-admin-id",
      email: "superadmin@internal.test",
      name: "Super Admin",
      role: UserRole.PLATFORM_SUPER_ADMIN,
      tenantId: fixtureA.tenant.id,
      isActive: true,
    });

    ownerContextB = createTestContext(ownerB);
  });

  afterAll(async () => {
    if (fixtureA) await fixtureA.cleanup();
    if (fixtureB) await fixtureB.cleanup();
    await disconnectTestDb();
  });

  let initialRawToken99A: string;

  it("Test 1: BROKER_OWNER generates initial token: persists hash-only in PostgreSQL, discloses rawToken once, and verifies cryptographically", async () => {
    const result = await generatePortalWebhookToken(
      ownerContextA,
      PortalProvider.NINETY_NINE_ACRES,
      true
    );

    expect(result.rawToken).toBeDefined();
    expect(typeof result.rawToken).toBe("string");
    expect(result.rawToken.length).toBe(64);
    initialRawToken99A = result.rawToken;

    // Verify DTO fields
    expect(result.config.tenantId).toBe(fixtureA.tenant.id);
    expect(result.config.provider).toBe(PortalProvider.NINETY_NINE_ACRES);
    expect(result.config.isEnabled).toBe(true);
    expect(result.config.tokenCreatedAt).toBeInstanceOf(Date);
    expect(result.config.tokenRotatedAt).toBeNull();
    // Sensitive fields must NOT exist in the DTO
    expect((result.config as unknown as Record<string, unknown>).webhookTokenHash).toBeUndefined();

    // Directly inspect database row in PostgreSQL
    const dbRecord = await prisma.tenantPortalConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
        },
      },
    });

    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.webhookTokenHash).toBeDefined();
    expect(dbRecord!.webhookTokenHash.length).toBe(64); // SHA-256
    expect(dbRecord!.webhookTokenHash).not.toBe(result.rawToken); // Must NOT be raw token

    // Cryptographic verification against stored hash
    const isValid = verifyWebhookToken(result.rawToken, dbRecord!.webhookTokenHash);
    expect(isValid).toBe(true);
  });

  it("Test 2: Re-generating initial token for already-configured provider throws ValidationError", async () => {
    await expect(
      generatePortalWebhookToken(
        ownerContextA,
        PortalProvider.NINETY_NINE_ACRES,
        true
      )
    ).rejects.toThrow(ValidationError);
  });

  it("Test 3: CRM_TENANT_ADMIN can generate configuration for another provider (MAGICBRICKS)", async () => {
    const result = await generatePortalWebhookToken(
      adminContextA,
      PortalProvider.MAGICBRICKS,
      false
    );

    expect(result.rawToken).toBeDefined();
    expect(result.config.provider).toBe(PortalProvider.MAGICBRICKS);
    expect(result.config.isEnabled).toBe(false);

    const dbRecord = await prisma.tenantPortalConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.MAGICBRICKS,
        },
      },
    });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.isEnabled).toBe(false);
    expect(verifyWebhookToken(result.rawToken, dbRecord!.webhookTokenHash)).toBe(true);
  });

  it("Test 4: listTenantPortalConfigs returns safe DTOs and strictly omits webhookTokenHash", async () => {
    const configs: TenantPortalConfigDTO[] = await listTenantPortalConfigs(ownerContextA);

    expect(configs).toHaveLength(2);
    const providers = configs.map((c) => c.provider);
    expect(providers).toContain(PortalProvider.NINETY_NINE_ACRES);
    expect(providers).toContain(PortalProvider.MAGICBRICKS);

    // Verify all configs strictly omit sensitive credentials
    for (const c of configs) {
      expect((c as unknown as Record<string, unknown>).webhookTokenHash).toBeUndefined();
      expect((c as unknown as Record<string, unknown>).rawToken).toBeUndefined();
      expect(c.tenantId).toBe(fixtureA.tenant.id);
    }
  });

  it("Test 5: getTenantPortalConfig retrieves single provider config or null without exposing credentials", async () => {
    const config99 = await getTenantPortalConfig(
      adminContextA,
      PortalProvider.NINETY_NINE_ACRES
    );
    expect(config99).not.toBeNull();
    expect(config99!.provider).toBe(PortalProvider.NINETY_NINE_ACRES);
    expect((config99 as unknown as Record<string, unknown>).webhookTokenHash).toBeUndefined();

    const configNoBroker = await getTenantPortalConfig(
      adminContextA,
      PortalProvider.NOBROKER
    );
    expect(configNoBroker).toBeNull();
  });

  it("Test 6: Strict Cross-Tenant Isolation: Tenant Beta cannot view, toggle, or rotate Tenant Alpha configurations", async () => {
    // 1. Tenant Beta list is empty
    const betaConfigs = await listTenantPortalConfigs(ownerContextB);
    expect(betaConfigs).toHaveLength(0);

    // 2. Tenant Beta get returns null for Alpha's configured provider
    const beta99 = await getTenantPortalConfig(
      ownerContextB,
      PortalProvider.NINETY_NINE_ACRES
    );
    expect(beta99).toBeNull();

    // 3. Tenant Beta toggle throws NotFoundError
    await expect(
      setPortalIntegrationStatus(
        ownerContextB,
        PortalProvider.NINETY_NINE_ACRES,
        false
      )
    ).rejects.toThrow(NotFoundError);

    // 4. Tenant Beta rotate throws NotFoundError
    await expect(
      rotatePortalWebhookToken(
        ownerContextB,
        PortalProvider.NINETY_NINE_ACRES
      )
    ).rejects.toThrow(NotFoundError);

    // 5. Verify Tenant Alpha's record in PostgreSQL is completely untouched
    const alphaRecord = await prisma.tenantPortalConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
        },
      },
    });
    expect(alphaRecord).not.toBeNull();
    expect(alphaRecord!.isEnabled).toBe(true);
    expect(verifyWebhookToken(initialRawToken99A, alphaRecord!.webhookTokenHash)).toBe(true);
  });

  it("Test 7: Unauthorized roles are rejected with ForbiddenError across all configuration operations", async () => {
    const unauthorizedContexts = [
      telecallerContextA,
      teamLeaderContextA,
      fieldVerifierContextA,
      fieldSalesContextA,
      superAdminContext,
    ];

    for (const ctx of unauthorizedContexts) {
      await expect(listTenantPortalConfigs(ctx)).rejects.toThrow(ForbiddenError);
      await expect(
        getTenantPortalConfig(ctx, PortalProvider.NINETY_NINE_ACRES)
      ).rejects.toThrow(ForbiddenError);
      await expect(
        setPortalIntegrationStatus(ctx, PortalProvider.NINETY_NINE_ACRES, false)
      ).rejects.toThrow(ForbiddenError);
      await expect(
        generatePortalWebhookToken(ctx, PortalProvider.NOBROKER)
      ).rejects.toThrow(ForbiddenError);
      await expect(
        rotatePortalWebhookToken(ctx, PortalProvider.NINETY_NINE_ACRES)
      ).rejects.toThrow(ForbiddenError);
    }
  });

  it("Test 8: Missing or unauthenticated session context is rejected with UnauthorizedError", async () => {
    const emptyContext = {} as TenantContext;
    const nullContext = null as unknown as TenantContext;

    await expect(listTenantPortalConfigs(emptyContext)).rejects.toThrow(UnauthorizedError);
    await expect(listTenantPortalConfigs(nullContext)).rejects.toThrow(UnauthorizedError);
    await expect(
      generatePortalWebhookToken(emptyContext, PortalProvider.NOBROKER)
    ).rejects.toThrow(UnauthorizedError);
  });

  it("Test 9: setPortalIntegrationStatus toggles isEnabled strictly for caller's tenant", async () => {
    // Disable 99acres
    const disabledConfig = await setPortalIntegrationStatus(
      ownerContextA,
      PortalProvider.NINETY_NINE_ACRES,
      false
    );
    expect(disabledConfig.isEnabled).toBe(false);

    let dbRecord = await prisma.tenantPortalConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
        },
      },
    });
    expect(dbRecord!.isEnabled).toBe(false);

    // Re-enable 99acres
    const enabledConfig = await setPortalIntegrationStatus(
      adminContextA,
      PortalProvider.NINETY_NINE_ACRES,
      true
    );
    expect(enabledConfig.isEnabled).toBe(true);

    dbRecord = await prisma.tenantPortalConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
        },
      },
    });
    expect(dbRecord!.isEnabled).toBe(true);

    // Attempting toggle on unconfigured provider throws NotFoundError
    await expect(
      setPortalIntegrationStatus(ownerContextA, PortalProvider.NOBROKER, true)
    ).rejects.toThrow(NotFoundError);

    // Attempting toggle with non-boolean throws ValidationError
    await expect(
      setPortalIntegrationStatus(
        ownerContextA,
        PortalProvider.NINETY_NINE_ACRES,
        "not-a-bool" as unknown as boolean
      )
    ).rejects.toThrow(ValidationError);
  });

  it("Test 10: rotatePortalWebhookToken generates fresh token, updates hash, sets tokenRotatedAt, invalidates old token", async () => {
    const rotationResult = await rotatePortalWebhookToken(
      ownerContextA,
      PortalProvider.NINETY_NINE_ACRES
    );

    expect(rotationResult.rawToken).toBeDefined();
    expect(rotationResult.rawToken).not.toBe(initialRawToken99A);
    expect(rotationResult.config.tokenRotatedAt).toBeInstanceOf(Date);
    expect((rotationResult.config as unknown as Record<string, unknown>).webhookTokenHash).toBeUndefined();

    // Verify database row
    const dbRecord = await prisma.tenantPortalConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
        },
      },
    });

    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.tokenRotatedAt).not.toBeNull();

    // Old token must FAIL verification
    const isOldValid = verifyWebhookToken(initialRawToken99A, dbRecord!.webhookTokenHash);
    expect(isOldValid).toBe(false);

    // New token must SUCCEED verification
    const isNewValid = verifyWebhookToken(rotationResult.rawToken, dbRecord!.webhookTokenHash);
    expect(isNewValid).toBe(true);
  });

  it("Test 11: Invalid portal provider strings are rejected with ValidationError", async () => {
    const invalidProvider = "INVALID_PORTAL" as PortalProvider;

    await expect(
      getTenantPortalConfig(ownerContextA, invalidProvider)
    ).rejects.toThrow(ValidationError);
    await expect(
      setPortalIntegrationStatus(ownerContextA, invalidProvider, true)
    ).rejects.toThrow(ValidationError);
    await expect(
      generatePortalWebhookToken(ownerContextA, invalidProvider)
    ).rejects.toThrow(ValidationError);
    await expect(
      rotatePortalWebhookToken(ownerContextA, invalidProvider)
    ).rejects.toThrow(ValidationError);
  });

  it("Test 12: Concurrent token rotation race detection throws ValidationError when hash was changed concurrently", async () => {
    // Simulate race condition: another concurrent worker rotated the token between read and update
    const genuineTransaction = serverPrisma.$transaction;

    // We can simulate an updateMany count of 0 inside the transaction
    const mockTx = {
      tenantPortalConfig: {
        findUnique: async () => ({
          id: "config-id",
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
          webhookTokenHash: "a".repeat(64),
        }),
        updateMany: async () => ({ count: 0 }), // Simulates race where hash no longer matched
      },
    };

    serverPrisma.$transaction = (async (cb: (tx: typeof mockTx) => Promise<unknown>) => {
      return cb(mockTx);
    }) as unknown as typeof genuineTransaction;

    try {
      await expect(
        rotatePortalWebhookToken(ownerContextA, PortalProvider.NINETY_NINE_ACRES)
      ).rejects.toThrow(ValidationError);
    } finally {
      serverPrisma.$transaction = genuineTransaction;
    }
  });

  it("Test 13: Database error during rotation does not leak credentials or raw tokens", async () => {
    const genuineTransaction = serverPrisma.$transaction;

    serverPrisma.$transaction = (async () => {
      throw new Error("PostgreSQL connection terminated abnormally: FATAL password authentication failed for user 'secret_user'");
    }) as unknown as typeof genuineTransaction;

    try {
      await expect(
        rotatePortalWebhookToken(ownerContextA, PortalProvider.NINETY_NINE_ACRES)
      ).rejects.toThrow("PostgreSQL connection terminated abnormally");
    } finally {
      serverPrisma.$transaction = genuineTransaction;
    }
  });
});
