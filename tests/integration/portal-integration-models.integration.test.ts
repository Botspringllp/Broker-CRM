import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  PrismaClient,
  PortalProvider,
  WebhookProcessingStatus,
} from "@prisma/client";
import { getTestPrisma, disconnectTestDb } from "./helpers/db-client";
import { createTestTenant, TestTenantFixture } from "./helpers/tenant-helper";
import {
  generateWebhookToken,
  generatePayloadIdempotencyKey,
} from "@/server/security/portal-tokens";

describe("Live PostgreSQL Integration: External Portal Models & Token Security", () => {
  let prisma: PrismaClient;
  let fixtureA: TestTenantFixture;
  let fixtureB: TestTenantFixture;

  beforeAll(async () => {
    prisma = await getTestPrisma();
    fixtureA = await createTestTenant(prisma, "Portal Alpha Brokerage");
    fixtureB = await createTestTenant(prisma, "Portal Beta Brokerage");
  });

  afterAll(async () => {
    await fixtureA?.cleanup();
    await fixtureB?.cleanup();
    await disconnectTestDb();
  });

  it("1. Enforces tenant + provider configuration uniqueness in TenantPortalConfig (P2002 on duplicate)", async () => {
    const { tokenHash: hash1 } = generateWebhookToken();
    const { tokenHash: hash2 } = generateWebhookToken();

    // First configuration for 99acres in Tenant Alpha succeeds
    const config1 = await prisma.tenantPortalConfig.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        webhookTokenHash: hash1,
        isEnabled: true,
      },
    });

    expect(config1.id).toBeDefined();
    expect(config1.provider).toBe(PortalProvider.NINETY_NINE_ACRES);
    expect(config1.webhookTokenHash).toBe(hash1);

    // Second configuration for SAME provider in SAME tenant must be rejected by PostgreSQL with P2002
    await expect(
      prisma.tenantPortalConfig.create({
        data: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
          webhookTokenHash: hash2,
          isEnabled: true,
        },
      })
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("2. Different tenants can configure the same portal provider independently without conflict", async () => {
    const { tokenHash: hashBeta } = generateWebhookToken();

    // Tenant Beta configures 99acres (which Tenant Alpha also has configured)
    const configBeta = await prisma.tenantPortalConfig.create({
      data: {
        tenantId: fixtureB.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        webhookTokenHash: hashBeta,
        isEnabled: true,
      },
    });

    expect(configBeta.id).toBeDefined();
    expect(configBeta.tenantId).toBe(fixtureB.tenant.id);
    expect(configBeta.provider).toBe(PortalProvider.NINETY_NINE_ACRES);

    // Verify both configurations exist concurrently in PostgreSQL
    const alphaConfig = await prisma.tenantPortalConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
        },
      },
    });
    expect(alphaConfig).not.toBeNull();
    expect(alphaConfig?.id).not.toBe(configBeta.id);
  });

  it("3. Enforces duplicate webhook event prevention in PortalWebhookEvent (P2002 on duplicate idempotencyKey)", async () => {
    const externalLeadId = "99acres_lead_evt_1001";

    // Initial webhook event creation succeeds
    const event1 = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        externalEventId: externalLeadId,
        idempotencyKey: externalLeadId,
        status: WebhookProcessingStatus.PENDING,
        eventAction: "LEAD_ENQUIRY",
        leadPhone: "9810011223",
        rawPayload: { query_id: "1001", client_name: "Buyer Ramesh" },
      },
    });

    expect(event1.id).toBeDefined();
    expect(event1.status).toBe(WebhookProcessingStatus.PENDING);

    // Retried webhook event from 99acres with identical idempotencyKey for Tenant Alpha must fail with P2002
    await expect(
      prisma.portalWebhookEvent.create({
        data: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
          externalEventId: externalLeadId,
          idempotencyKey: externalLeadId,
          status: WebhookProcessingStatus.PENDING,
          eventAction: "LEAD_ENQUIRY",
          leadPhone: "9810011223",
          rawPayload: { query_id: "1001", client_name: "Buyer Ramesh" },
        },
      })
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("4. Different providers and different tenants remain strictly isolated on webhook events", async () => {
    const sharedEventId = "common_external_event_999";

    // Same external ID for a DIFFERENT provider (Magicbricks) in Tenant Alpha succeeds
    const eventMagicbricks = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.MAGICBRICKS,
        externalEventId: sharedEventId,
        idempotencyKey: sharedEventId,
        status: WebhookProcessingStatus.PROCESSED,
        leadPhone: "9810055443",
      },
    });

    // Same external ID for a DIFFERENT tenant (Tenant Beta) with 99acres succeeds
    const eventBeta = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureB.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        externalEventId: sharedEventId,
        idempotencyKey: sharedEventId,
        status: WebhookProcessingStatus.PROCESSED,
        leadPhone: "9810077889",
      },
    });

    expect(eventMagicbricks.id).toBeDefined();
    expect(eventBeta.id).toBeDefined();
    expect(eventMagicbricks.id).not.toBe(eventBeta.id);
  });

  it("5. Correctly handles providers that do not supply an external event ID via deterministic payload hashing", async () => {
    const rawPayloadA = {
      source: "NOBROKER",
      phone: "9810033221",
      city: "Bengaluru",
      notes: "Looking for 2 BHK resale",
    };

    const idempotencyKeyA = generatePayloadIdempotencyKey(rawPayloadA);

    // First event without external ID persists successfully with deterministic payload key
    const eventNull1 = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NOBROKER,
        externalEventId: null,
        idempotencyKey: idempotencyKeyA,
        status: WebhookProcessingStatus.PROCESSED,
        leadPhone: "9810033221",
        rawPayload: rawPayloadA,
      },
    });

    expect(eventNull1.externalEventId).toBeNull();
    expect(eventNull1.idempotencyKey).toBe(idempotencyKeyA);

    // Retried identical event with null external ID throws P2002 due to non-null idempotencyKey
    await expect(
      prisma.portalWebhookEvent.create({
        data: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NOBROKER,
          externalEventId: null,
          idempotencyKey: idempotencyKeyA,
          status: WebhookProcessingStatus.PENDING,
          leadPhone: "9810033221",
          rawPayload: rawPayloadA,
        },
      })
    ).rejects.toMatchObject({
      code: "P2002",
    });

    // A distinct event without external ID has a different payload hash and succeeds
    const rawPayloadB = { ...rawPayloadA, phone: "9810044556" };
    const idempotencyKeyB = generatePayloadIdempotencyKey(rawPayloadB);

    const eventNull2 = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NOBROKER,
        externalEventId: null,
        idempotencyKey: idempotencyKeyB,
        status: WebhookProcessingStatus.PENDING,
        leadPhone: "9810044556",
        rawPayload: rawPayloadB,
      },
    });

    expect(eventNull2.externalEventId).toBeNull();
    expect(eventNull2.idempotencyKey).toBe(idempotencyKeyB);
    expect(eventNull2.id).not.toBe(eventNull1.id);
  });

  it("6. Enforces foreign key constraints: rejects config or event with non-existent tenantId with P2003", async () => {
    const invalidTenantId = "00000000-0000-0000-0000-000000000000";
    const { tokenHash } = generateWebhookToken();

    // Reject invalid tenantId on TenantPortalConfig
    await expect(
      prisma.tenantPortalConfig.create({
        data: {
          tenantId: invalidTenantId,
          provider: PortalProvider.MAGICBRICKS,
          webhookTokenHash: tokenHash,
        },
      })
    ).rejects.toMatchObject({
      code: "P2003",
    });

    // Reject invalid tenantId on PortalWebhookEvent
    await expect(
      prisma.portalWebhookEvent.create({
        data: {
          tenantId: invalidTenantId,
          provider: PortalProvider.MAGICBRICKS,
          idempotencyKey: "evt_invalid_tenant",
        },
      })
    ).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("7. Enforces cascade deletion: deleting a Tenant cleanly cascades and removes associated portal configs and webhook events", async () => {
    const ephemeralFixture = await createTestTenant(prisma, "Ephemeral Portal Tenant");
    const { tokenHash } = generateWebhookToken();

    const config = await prisma.tenantPortalConfig.create({
      data: {
        tenantId: ephemeralFixture.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        webhookTokenHash: tokenHash,
      },
    });

    const event = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: ephemeralFixture.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        idempotencyKey: "cascade_test_event_1",
      },
    });

    // Delete tenant directly
    await prisma.tenant.delete({
      where: { id: ephemeralFixture.tenant.id },
    });

    // Assert that both config and event were cascaded by PostgreSQL
    const foundConfig = await prisma.tenantPortalConfig.findUnique({
      where: { id: config.id },
    });
    const foundEvent = await prisma.portalWebhookEvent.findUnique({
      where: { id: event.id },
    });

    expect(foundConfig).toBeNull();
    expect(foundEvent).toBeNull();
  });
});
