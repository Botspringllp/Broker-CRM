/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { PrismaClient, PortalProvider, UserRole, WebhookProcessingStatus } from "@prisma/client";
import { getTestPrisma, disconnectTestDb } from "./helpers/db-client";
import {
  createTestTenant,
  createTestUser,
  createTestContext,
  TestTenantFixture,
} from "./helpers/tenant-helper";
import { TenantContext } from "@/server/tenant-context";

// Mock next/cache revalidatePath
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock requireTenantContext to return our test context
let currentTestContext: TenantContext | null = null;
vi.mock("@/server/tenant-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/tenant-context")>();
  return {
    ...actual,
    requireTenantContext: vi.fn(async () => {
      if (!currentTestContext) {
        throw new Error("Authentication required.");
      }
      return currentTestContext;
    }),
  };
});

import {
  getPortalConfigurationsAction,
  togglePortalIntegrationStatusAction,
  generatePortalWebhookTokenAction,
  rotatePortalWebhookTokenAction,
} from "@/app/settings/portals/actions";
import { verifyWebhookToken } from "@/server/security/portal-tokens";

describe("Live PostgreSQL Integration: Portal Settings Server Actions (Stage 3C)", () => {
  let prisma: PrismaClient;
  let fixtureA: TestTenantFixture;
  let fixtureB: TestTenantFixture;

  let ownerContextA: TenantContext;
  let telecallerContextA: TenantContext;
  let ownerContextB: TenantContext;

  beforeAll(async () => {
    prisma = await getTestPrisma();
    fixtureA = await createTestTenant(prisma, "Settings UI Tenant Alpha");
    fixtureB = await createTestTenant(prisma, "Settings UI Tenant Beta");

    const ownerA = await createTestUser(prisma, fixtureA.tenant.id, {
      name: "Alpha Owner",
      role: UserRole.BROKER_OWNER,
      email: `owner-alpha-settings-${Date.now()}@test.com`,
    });
    const telecallerA = await createTestUser(prisma, fixtureA.tenant.id, {
      name: "Alpha Telecaller",
      role: UserRole.TELECALLER,
      email: `caller-alpha-settings-${Date.now()}@test.com`,
    });
    const ownerB = await createTestUser(prisma, fixtureB.tenant.id, {
      name: "Beta Owner",
      role: UserRole.BROKER_OWNER,
      email: `owner-beta-settings-${Date.now()}@test.com`,
    });

    ownerContextA = createTestContext(ownerA);
    telecallerContextA = createTestContext(telecallerA);
    ownerContextB = createTestContext(ownerB);
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(() => {
    currentTestContext = null;
  });

  it("Test 1: Rejects unauthorized role (TELECALLER) from invoking portal settings actions", async () => {
    currentTestContext = telecallerContextA;

    const listRes = await getPortalConfigurationsAction();
    expect(listRes.success).toBe(false);
    expect(listRes.error).toMatch(/access denied/i);

    const toggleRes = await togglePortalIntegrationStatusAction(PortalProvider.NINETY_NINE_ACRES, true);
    expect(toggleRes.success).toBe(false);
    expect(toggleRes.error).toMatch(/access denied/i);

    const genRes = await generatePortalWebhookTokenAction(PortalProvider.NINETY_NINE_ACRES);
    expect(genRes.success).toBe(false);
    expect(genRes.error).toMatch(/access denied/i);

    const rotRes = await rotatePortalWebhookTokenAction(PortalProvider.NINETY_NINE_ACRES);
    expect(rotRes.success).toBe(false);
    expect(rotRes.error).toMatch(/access denied/i);
  });

  it("Test 2: Generates initial webhook token: persists SHA-256 hash in DB, returns rawToken once", async () => {
    currentTestContext = ownerContextA;

    const res = await generatePortalWebhookTokenAction(PortalProvider.NINETY_NINE_ACRES, true);
    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();

    const { config, rawToken } = res.data!;
    expect(typeof rawToken).toBe("string");
    expect(rawToken.length).toBeGreaterThanOrEqual(32);
    expect(config.provider).toBe(PortalProvider.NINETY_NINE_ACRES);
    expect(config.isEnabled).toBe(true);
    expect((config as any).webhookTokenHash).toBeUndefined();

    // Verify PostgreSQL record: only hash is stored
    const dbRecord = await prisma.tenantPortalConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
        },
      },
    });

    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.webhookTokenHash).not.toBe(rawToken);
    expect(verifyWebhookToken(rawToken, dbRecord!.webhookTokenHash)).toBe(true);
  });

  it("Test 3: Duplicate token generation for same provider is rejected by Server Action", async () => {
    currentTestContext = ownerContextA;

    const res = await generatePortalWebhookTokenAction(PortalProvider.NINETY_NINE_ACRES, true);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already configured/i);
  });

  it("Test 4: Toggles integration status in PostgreSQL (enable / disable)", async () => {
    currentTestContext = ownerContextA;

    // Disable 99acres
    const disableRes = await togglePortalIntegrationStatusAction(PortalProvider.NINETY_NINE_ACRES, false);
    expect(disableRes.success).toBe(true);
    expect(disableRes.data?.isEnabled).toBe(false);

    const dbRecordDisabled = await prisma.tenantPortalConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
        },
      },
    });
    expect(dbRecordDisabled!.isEnabled).toBe(false);

    // Re-enable 99acres
    const enableRes = await togglePortalIntegrationStatusAction(PortalProvider.NINETY_NINE_ACRES, true);
    expect(enableRes.success).toBe(true);
    expect(enableRes.data?.isEnabled).toBe(true);

    const dbRecordEnabled = await prisma.tenantPortalConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
        },
      },
    });
    expect(dbRecordEnabled!.isEnabled).toBe(true);
  });

  it("Test 5: Rotates webhook token: invalidates old token hash and records rotation metadata", async () => {
    currentTestContext = ownerContextA;

    const initialDbRecord = await prisma.tenantPortalConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
        },
      },
    });
    const oldHash = initialDbRecord!.webhookTokenHash;

    const res = await rotatePortalWebhookTokenAction(PortalProvider.NINETY_NINE_ACRES);
    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();

    const { config, rawToken: newRawToken } = res.data!;
    expect(config.tokenRotatedAt).not.toBeNull();

    const updatedDbRecord = await prisma.tenantPortalConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
        },
      },
    });

    expect(updatedDbRecord!.webhookTokenHash).not.toBe(oldHash);
    expect(verifyWebhookToken(newRawToken, updatedDbRecord!.webhookTokenHash)).toBe(true);
    expect(updatedDbRecord!.tokenRotatedAt).not.toBeNull();
  });

  it("Test 6: Tenant isolation: Tenant B cannot view, toggle, or rotate Tenant A configurations", async () => {
    currentTestContext = ownerContextB;

    // Tenant B has no configs yet
    const listRes = await getPortalConfigurationsAction();
    expect(listRes.success).toBe(true);
    expect(listRes.data?.configs).toHaveLength(0);

    // Attempting to toggle 99acres in Tenant B fails with not found
    const toggleRes = await togglePortalIntegrationStatusAction(PortalProvider.NINETY_NINE_ACRES, false);
    expect(toggleRes.success).toBe(false);
    expect(toggleRes.error).toMatch(/not configured/i);

    // Attempting to rotate 99acres in Tenant B fails with not found
    const rotateRes = await rotatePortalWebhookTokenAction(PortalProvider.NINETY_NINE_ACRES);
    expect(rotateRes.success).toBe(false);
    expect(rotateRes.error).toMatch(/not configured/i);
  });

  it("Test 7: Health metrics aggregation correctly computes processed/failed event counts per tenant", async () => {
    currentTestContext = ownerContextA;

    // Seed test webhook events in Tenant Alpha
    await prisma.portalWebhookEvent.createMany({
      data: [
        {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
          idempotencyKey: `metric_test_1_${Date.now()}`,
          status: WebhookProcessingStatus.PROCESSED,
          leadPhone: "9811122233",
          processedAt: new Date(),
        },
        {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
          idempotencyKey: `metric_test_2_${Date.now()}`,
          status: WebhookProcessingStatus.PROCESSED,
          leadPhone: "9811122244",
          processedAt: new Date(),
        },
        {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
          idempotencyKey: `metric_test_3_${Date.now()}`,
          status: WebhookProcessingStatus.FAILED,
          errorMessage: "Simulated test error",
        },
      ],
    });

    const res = await getPortalConfigurationsAction();
    expect(res.success).toBe(true);
    expect(res.data?.healthMetrics).toBeDefined();

    const metrics99 = res.data!.healthMetrics[PortalProvider.NINETY_NINE_ACRES];
    expect(metrics99.processedCount).toBeGreaterThanOrEqual(2);
    expect(metrics99.failedCount).toBeGreaterThanOrEqual(1);
    expect(metrics99.lastReceivedAt).not.toBeNull();
    expect(metrics99.lastProcessedAt).not.toBeNull();

    // Verify Tenant B has 0 events for 99acres (tenant isolation)
    currentTestContext = ownerContextB;
    const resB = await getPortalConfigurationsAction();
    expect(resB.data!.healthMetrics[PortalProvider.NINETY_NINE_ACRES].processedCount).toBe(0);
    expect(resB.data!.healthMetrics[PortalProvider.NINETY_NINE_ACRES].failedCount).toBe(0);
  });
});
