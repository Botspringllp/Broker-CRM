import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  PrismaClient,
  PortalProvider,
  WebhookProcessingStatus,
  TransactionType,
  AssignmentTargetType,
  AssignmentRole,
  UserRole,
} from "@prisma/client";
import { getTestPrisma, disconnectTestDb } from "./helpers/db-client";
import { prisma as serverPrisma } from "@/server/db";
import {
  createTestTenant,
  createTestUser,
  TestTenantFixture,
} from "./helpers/tenant-helper";
import {
  cleanupExpiredWebhookEvents,
} from "@/server/dal/portal-retention";

describe("Live PostgreSQL Integration: 90-Day Portal Webhook Retention & Automatic Cleanup (DV-14 Phase 2 Area C)", () => {
  let prisma: PrismaClient;
  let fixtureA: TestTenantFixture;
  let fixtureB: TestTenantFixture;

  const referenceNow = new Date("2026-11-15T12:00:00.000Z");
  // 90 days prior is 2026-08-17T12:00:00.000Z
  const expiredDate = new Date("2026-08-01T10:00:00.000Z"); // 106 days old (< cutoff)
  const recentDate = new Date("2026-10-15T10:00:00.000Z"); // 31 days old (> cutoff)

  beforeAll(async () => {
    prisma = await getTestPrisma();
    fixtureA = await createTestTenant(prisma, "Retention Tenant Alpha");
    fixtureB = await createTestTenant(prisma, "Retention Tenant Beta");
  });

  afterAll(async () => {
    if (fixtureA) await fixtureA.cleanup();
    if (fixtureB) await fixtureB.cleanup();
    await disconnectTestDb();
  });

  it("Test 1: deletes an event older than 90 days with PROCESSED status", async () => {
    const event = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        idempotencyKey: `test1-processed-${Date.now()}`,
        status: WebhookProcessingStatus.PROCESSED,
        receivedAt: expiredDate,
        processedAt: expiredDate,
      },
    });

    const result = await cleanupExpiredWebhookEvents({
      now: referenceNow,
      tenantId: fixtureA.tenant.id,
    });

    expect(result.success).toBe(true);
    expect(result.deletedCount).toBeGreaterThanOrEqual(1);

    const found = await prisma.portalWebhookEvent.findUnique({
      where: { id: event.id },
    });
    expect(found).toBeNull();
  });

  it("Test 2: deletes an event older than 90 days with FAILED status", async () => {
    const event = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.MAGICBRICKS,
        idempotencyKey: `test2-failed-${Date.now()}`,
        status: WebhookProcessingStatus.FAILED,
        receivedAt: expiredDate,
        processedAt: expiredDate,
        errorMessage: "Simulated upstream provider validation failure",
      },
    });

    const result = await cleanupExpiredWebhookEvents({
      now: referenceNow,
      tenantId: fixtureA.tenant.id,
    });

    expect(result.success).toBe(true);

    const found = await prisma.portalWebhookEvent.findUnique({
      where: { id: event.id },
    });
    expect(found).toBeNull();
  });

  it("Test 3: deletes an event older than 90 days with IGNORED status", async () => {
    const event = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NOBROKER,
        idempotencyKey: `test3-ignored-${Date.now()}`,
        status: WebhookProcessingStatus.IGNORED,
        receivedAt: expiredDate,
        processedAt: expiredDate,
      },
    });

    const result = await cleanupExpiredWebhookEvents({
      now: referenceNow,
      tenantId: fixtureA.tenant.id,
    });

    expect(result.success).toBe(true);

    const found = await prisma.portalWebhookEvent.findUnique({
      where: { id: event.id },
    });
    expect(found).toBeNull();
  });

  it("Test 4: retains events newer than 90 days (e.g. 31 days old) regardless of terminal status", async () => {
    const recentProcessed = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        idempotencyKey: `test4-recent-processed-${Date.now()}`,
        status: WebhookProcessingStatus.PROCESSED,
        receivedAt: recentDate,
        processedAt: recentDate,
      },
    });

    const recentFailed = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.MAGICBRICKS,
        idempotencyKey: `test4-recent-failed-${Date.now()}`,
        status: WebhookProcessingStatus.FAILED,
        receivedAt: recentDate,
        processedAt: recentDate,
        errorMessage: "Recent failure message",
      },
    });

    const recentIgnored = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NOBROKER,
        idempotencyKey: `test4-recent-ignored-${Date.now()}`,
        status: WebhookProcessingStatus.IGNORED,
        receivedAt: recentDate,
        processedAt: recentDate,
      },
    });

    const result = await cleanupExpiredWebhookEvents({
      now: referenceNow,
      tenantId: fixtureA.tenant.id,
    });

    expect(result.success).toBe(true);

    const foundProcessed = await prisma.portalWebhookEvent.findUnique({
      where: { id: recentProcessed.id },
    });
    const foundFailed = await prisma.portalWebhookEvent.findUnique({
      where: { id: recentFailed.id },
    });
    const foundIgnored = await prisma.portalWebhookEvent.findUnique({
      where: { id: recentIgnored.id },
    });

    expect(foundProcessed).not.toBeNull();
    expect(foundFailed).not.toBeNull();
    expect(foundIgnored).not.toBeNull();
  });

  it("Test 5: retains events older than 90 days if status is PENDING", async () => {
    const pendingEvent = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        idempotencyKey: `test5-pending-${Date.now()}`,
        status: WebhookProcessingStatus.PENDING,
        receivedAt: expiredDate,
      },
    });

    const result = await cleanupExpiredWebhookEvents({
      now: referenceNow,
      tenantId: fixtureA.tenant.id,
    });

    expect(result.success).toBe(true);

    const found = await prisma.portalWebhookEvent.findUnique({
      where: { id: pendingEvent.id },
    });
    expect(found).not.toBeNull();
    expect(found?.status).toBe(WebhookProcessingStatus.PENDING);
  });

  it("Test 6: ensures core CRM records (Lead, Enquiry, LeadRequirement, Assignment) remain completely untouched when linked webhook event is deleted", async () => {
    // 1. Create Telecaller user
    const telecaller = await createTestUser(prisma, fixtureA.tenant.id, {
      name: "Retention Ops Telecaller",
      role: UserRole.TELECALLER,
      email: `telecaller-retention-${Date.now()}@alpha.test`,
      phone: "9812345678",
    });

    // 2. Create Lead
    const lead = await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "Devendra Verma",
        primaryPhone: "9899887766",
        originalSource: "99ACRES",
        sourceCreatedAt: expiredDate,
        assignedTelecallerId: telecaller.id,
      },
    });

    // 3. Create Enquiry
    const enquiry = await prisma.enquiry.create({
      data: {
        tenantId: fixtureA.tenant.id,
        leadId: lead.id,
        source: "99ACRES",
        enquiryDate: expiredDate,
        enquiryDetails: "Interested in 3 BHK in Sector 43",
      },
    });

    // 4. Create LeadRequirement
    const requirement = await prisma.leadRequirement.create({
      data: {
        tenantId: fixtureA.tenant.id,
        leadId: lead.id,
        city: "Gurugram",
        preference: TransactionType.SALE,
        minBudget: 8000000,
        maxBudget: 12000000,
        bedroomConfigurations: ["3 BHK"],
      },
    });

    // 5. Create Assignment
    const assignment = await prisma.assignment.create({
      data: {
        tenantId: fixtureA.tenant.id,
        targetType: AssignmentTargetType.LEAD,
        leadId: lead.id,
        assignedUserId: telecaller.id,
        roleInAssignment: AssignmentRole.TELECALLER_VALIDATION,
        assignedAt: expiredDate,
      },
    });

    // 6. Create corresponding expired PortalWebhookEvent
    const webhookEvent = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        idempotencyKey: `test6-lead-linked-${Date.now()}`,
        status: WebhookProcessingStatus.PROCESSED,
        leadPhone: lead.primaryPhone,
        receivedAt: expiredDate,
        processedAt: expiredDate,
      },
    });

    // 7. Run cleanup
    const result = await cleanupExpiredWebhookEvents({
      now: referenceNow,
      tenantId: fixtureA.tenant.id,
    });

    expect(result.success).toBe(true);

    // Verify webhook event was deleted
    const foundWebhook = await prisma.portalWebhookEvent.findUnique({
      where: { id: webhookEvent.id },
    });
    expect(foundWebhook).toBeNull();

    // Verify Lead is preserved completely untouched
    const foundLead = await prisma.lead.findUnique({
      where: { id: lead.id },
    });
    expect(foundLead).not.toBeNull();
    expect(foundLead?.name).toBe("Devendra Verma");
    expect(foundLead?.primaryPhone).toBe("9899887766");
    expect(foundLead?.originalSource).toBe("99ACRES");
    expect(foundLead?.assignedTelecallerId).toBe(telecaller.id);

    // Verify Enquiry is preserved
    const foundEnquiry = await prisma.enquiry.findUnique({
      where: { id: enquiry.id },
    });
    expect(foundEnquiry).not.toBeNull();
    expect(foundEnquiry?.leadId).toBe(lead.id);
    expect(foundEnquiry?.enquiryDetails).toBe("Interested in 3 BHK in Sector 43");

    // Verify LeadRequirement is preserved
    const foundReq = await prisma.leadRequirement.findUnique({
      where: { id: requirement.id },
    });
    expect(foundReq).not.toBeNull();
    expect(foundReq?.city).toBe("Gurugram");
    expect(Number(foundReq?.minBudget)).toBe(8000000);

    // Verify Assignment is preserved
    const foundAssignment = await prisma.assignment.findUnique({
      where: { id: assignment.id },
    });
    expect(foundAssignment).not.toBeNull();
    expect(foundAssignment?.leadId).toBe(lead.id);
    expect(foundAssignment?.assignedUserId).toBe(telecaller.id);
  });

  it("Test 7: repeated cleanup execution is safe, repeatable, and idempotent", async () => {
    // Create 2 expired records
    await prisma.portalWebhookEvent.createMany({
      data: [
        {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
          idempotencyKey: `test7-idemp-1-${Date.now()}`,
          status: WebhookProcessingStatus.PROCESSED,
          receivedAt: expiredDate,
        },
        {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.MAGICBRICKS,
          idempotencyKey: `test7-idemp-2-${Date.now()}`,
          status: WebhookProcessingStatus.FAILED,
          receivedAt: expiredDate,
        },
      ],
    });

    // First execution: deletes the 2 events
    const firstRun = await cleanupExpiredWebhookEvents({
      now: referenceNow,
      tenantId: fixtureA.tenant.id,
    });
    expect(firstRun.success).toBe(true);
    expect(firstRun.deletedCount).toBeGreaterThanOrEqual(2);

    // Second execution immediately after: should safely delete 0 records without errors
    const secondRun = await cleanupExpiredWebhookEvents({
      now: referenceNow,
      tenantId: fixtureA.tenant.id,
    });
    expect(secondRun.success).toBe(true);
    expect(secondRun.deletedCount).toBe(0);
  });

  it("Test 8: batch processing handles multiple eligible records correctly across multiple batches (batchSize: 2)", async () => {
    // Create 5 eligible expired records
    const eventIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ev = await prisma.portalWebhookEvent.create({
        data: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
          idempotencyKey: `test8-batch-${i}-${Date.now()}`,
          status: WebhookProcessingStatus.PROCESSED,
          receivedAt: expiredDate,
        },
      });
      eventIds.push(ev.id);
    }

    // Run cleanup with batchSize: 2 (should loop 3 times: 2 + 2 + 1)
    const result = await cleanupExpiredWebhookEvents({
      now: referenceNow,
      batchSize: 2,
      tenantId: fixtureA.tenant.id,
    });

    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(5);

    // Verify all 5 events were deleted
    const remaining = await prisma.portalWebhookEvent.findMany({
      where: { id: { in: eventIds } },
    });
    expect(remaining).toHaveLength(0);
  });

  it("Test 9: tenant-scoped cleanup option deletes strictly within specified tenant without affecting other tenants", async () => {
    // Create 2 expired events in Tenant Alpha
    const evA1 = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        idempotencyKey: `test9-alpha-1-${Date.now()}`,
        status: WebhookProcessingStatus.PROCESSED,
        receivedAt: expiredDate,
      },
    });
    const evA2 = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.MAGICBRICKS,
        idempotencyKey: `test9-alpha-2-${Date.now()}`,
        status: WebhookProcessingStatus.FAILED,
        receivedAt: expiredDate,
      },
    });

    // Create 2 expired events in Tenant Beta
    const evB1 = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureB.tenant.id,
        provider: PortalProvider.NOBROKER,
        idempotencyKey: `test9-beta-1-${Date.now()}`,
        status: WebhookProcessingStatus.PROCESSED,
        receivedAt: expiredDate,
      },
    });
    const evB2 = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureB.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        idempotencyKey: `test9-beta-2-${Date.now()}`,
        status: WebhookProcessingStatus.IGNORED,
        receivedAt: expiredDate,
      },
    });

    // Run cleanup strictly scoped to Tenant Alpha
    const result = await cleanupExpiredWebhookEvents({
      now: referenceNow,
      tenantId: fixtureA.tenant.id,
    });

    expect(result.success).toBe(true);

    // Tenant Alpha events should be deleted
    const foundA1 = await prisma.portalWebhookEvent.findUnique({ where: { id: evA1.id } });
    const foundA2 = await prisma.portalWebhookEvent.findUnique({ where: { id: evA2.id } });
    expect(foundA1).toBeNull();
    expect(foundA2).toBeNull();

    // Tenant Beta events MUST be preserved untouched
    const foundB1 = await prisma.portalWebhookEvent.findUnique({ where: { id: evB1.id } });
    const foundB2 = await prisma.portalWebhookEvent.findUnique({ where: { id: evB2.id } });
    expect(foundB1).not.toBeNull();
    expect(foundB2).not.toBeNull();
  });

  it("Test 10: cleanup failure reporting handles invalid batch size by throwing an error", async () => {
    await expect(
      cleanupExpiredWebhookEvents({ batchSize: 0 })
    ).rejects.toThrow("Batch size must be a positive integer.");

    await expect(
      cleanupExpiredWebhookEvents({ batchSize: -10 })
    ).rejects.toThrow("Batch size must be a positive integer.");
  });

  it("Test 11: race-condition safety: preserves a record whose status transitions to PENDING after candidate selection before deletion", async () => {
    const event = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        idempotencyKey: `test11-race-status-${Date.now()}`,
        status: WebhookProcessingStatus.PROCESSED,
        receivedAt: expiredDate,
        processedAt: expiredDate,
      },
    });

    const genuineFindMany = serverPrisma.portalWebhookEvent.findMany;
    serverPrisma.portalWebhookEvent.findMany = (async (
      ...args: Parameters<typeof genuineFindMany>
    ) => {
      const result = await genuineFindMany.apply(serverPrisma.portalWebhookEvent, args);
      // Deterministic race injection: mutate the status in the live DB right after selection before deleteMany
      if (result.some((r) => r.id === event.id)) {
        await prisma.portalWebhookEvent.update({
          where: { id: event.id },
          data: { status: WebhookProcessingStatus.PENDING },
        });
      }
      return result;
    }) as typeof genuineFindMany;

    try {
      const result = await cleanupExpiredWebhookEvents({
        now: referenceNow,
        tenantId: fixtureA.tenant.id,
      });

      expect(result.success).toBe(true);

      // deleteMany rechecks status in TERMINAL_WEBHOOK_STATUSES, so it refuses to delete the now-PENDING record
      const found = await prisma.portalWebhookEvent.findUnique({
        where: { id: event.id },
      });
      expect(found).not.toBeNull();
      expect(found?.status).toBe(WebhookProcessingStatus.PENDING);
    } finally {
      serverPrisma.portalWebhookEvent.findMany = genuineFindMany;
    }
  });

  it("Test 12: race-condition safety: preserves a record whose receivedAt becomes newer than cutoff after candidate selection before deletion", async () => {
    const event = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.MAGICBRICKS,
        idempotencyKey: `test12-race-date-${Date.now()}`,
        status: WebhookProcessingStatus.PROCESSED,
        receivedAt: expiredDate,
        processedAt: expiredDate,
      },
    });

    const genuineFindMany = serverPrisma.portalWebhookEvent.findMany;
    serverPrisma.portalWebhookEvent.findMany = (async (
      ...args: Parameters<typeof genuineFindMany>
    ) => {
      const result = await genuineFindMany.apply(serverPrisma.portalWebhookEvent, args);
      // Deterministic race injection: mutate receivedAt to recentDate in DB right after selection before deleteMany
      if (result.some((r) => r.id === event.id)) {
        await prisma.portalWebhookEvent.update({
          where: { id: event.id },
          data: { receivedAt: recentDate },
        });
      }
      return result;
    }) as typeof genuineFindMany;

    try {
      const result = await cleanupExpiredWebhookEvents({
        now: referenceNow,
        tenantId: fixtureA.tenant.id,
      });

      expect(result.success).toBe(true);

      // deleteMany rechecks receivedAt <= cutoffDate, so it refuses to delete the now-recent record
      const found = await prisma.portalWebhookEvent.findUnique({
        where: { id: event.id },
      });
      expect(found).not.toBeNull();
      expect(found?.receivedAt.toISOString()).toBe(recentDate.toISOString());
    } finally {
      serverPrisma.portalWebhookEvent.findMany = genuineFindMany;
    }
  });

  it("Test 13: race-condition safety: tenant-scoped cleanup does not delete another tenant's record even if its ID was selected in a candidate batch", async () => {
    // Create an expired event in Tenant Beta
    const eventBeta = await prisma.portalWebhookEvent.create({
      data: {
        tenantId: fixtureB.tenant.id,
        provider: PortalProvider.NOBROKER,
        idempotencyKey: `test13-tenant-cross-${Date.now()}`,
        status: WebhookProcessingStatus.PROCESSED,
        receivedAt: expiredDate,
        processedAt: expiredDate,
      },
    });

    const genuineFindMany = serverPrisma.portalWebhookEvent.findMany;
    // Inject Beta event ID into candidate selection of Alpha's cleanup
    serverPrisma.portalWebhookEvent.findMany = (async (
      ...args: Parameters<typeof genuineFindMany>
    ) => {
      const result = await genuineFindMany.apply(serverPrisma.portalWebhookEvent, args);
      return [...result, { id: eventBeta.id }];
    }) as typeof genuineFindMany;

    try {
      const result = await cleanupExpiredWebhookEvents({
        now: referenceNow,
        tenantId: fixtureA.tenant.id,
      });

      expect(result.success).toBe(true);

      // deleteMany rechecks tenantId: fixtureA.tenant.id, so it refuses to delete Tenant Beta's event
      const foundBeta = await prisma.portalWebhookEvent.findUnique({
        where: { id: eventBeta.id },
      });
      expect(foundBeta).not.toBeNull();
      expect(foundBeta?.tenantId).toBe(fixtureB.tenant.id);
    } finally {
      serverPrisma.portalWebhookEvent.findMany = genuineFindMany;
    }
  });
});
