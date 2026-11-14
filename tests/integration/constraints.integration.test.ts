import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, UserRole, TransactionType, PropertyType, ScheduleChangeType, CallTargetType } from "@prisma/client";
import { getTestPrisma, disconnectTestDb } from "./helpers/db-client";
import { createTestTenant, createTestUser, createTestProperty, TestTenantFixture } from "./helpers/tenant-helper";

describe("Live PostgreSQL Integration: Constraints & Referential Integrity", () => {
  let prisma: PrismaClient;
  let fixtureA: TestTenantFixture;
  let fixtureB: TestTenantFixture;

  beforeAll(async () => {
    prisma = await getTestPrisma();
    fixtureA = await createTestTenant(prisma, "Tenant Alpha");
    fixtureB = await createTestTenant(prisma, "Tenant Beta");
  });

  afterAll(async () => {
    await fixtureA?.cleanup();
    await fixtureB?.cleanup();
    await disconnectTestDb();
  });

  it("enforces foreign key constraints: rejects Lead with non-existent tenantId with P2003", async () => {
    const invalidTenantId = "00000000-0000-0000-0000-000000000000";

    await expect(
      prisma.lead.create({
        data: {
          tenantId: invalidTenantId,
          name: "Orphan Lead",
          primaryPhone: "9811100001",
          originalSource: "MANUAL",
        },
      })
    ).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("enforces tenant-scoped duplicate buyer rejection: rejects duplicate primaryPhone in the same tenant with P2002", async () => {
    const phone = "9822211111";

    // First lead in Tenant Alpha succeeds
    await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "First Buyer",
        primaryPhone: phone,
        originalSource: "MANUAL",
      },
    });

    // Second lead with same phone in Tenant Alpha must fail with P2002
    await expect(
      prisma.lead.create({
        data: {
          tenantId: fixtureA.tenant.id,
          name: "Second Buyer Duplicate",
          primaryPhone: phone,
          originalSource: "99ACRES",
        },
      })
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("allows the exact same buyer primaryPhone in different tenants (proving composite unique constraint)", async () => {
    const crossTenantPhone = "9833322222";

    // Create in Tenant Alpha
    const leadAlpha = await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "Alpha Buyer",
        primaryPhone: crossTenantPhone,
        originalSource: "MAGICBRICKS",
      },
    });

    // Create in Tenant Beta with identical phone number
    const leadBeta = await prisma.lead.create({
      data: {
        tenantId: fixtureB.tenant.id,
        name: "Beta Buyer",
        primaryPhone: crossTenantPhone,
        originalSource: "NOBROKER",
      },
    });

    expect(leadAlpha.id).toBeDefined();
    expect(leadBeta.id).toBeDefined();
    expect(leadAlpha.id).not.toBe(leadBeta.id);
    expect(leadAlpha.primaryPhone).toBe(leadBeta.primaryPhone);
  });

  it("enforces composite locality uniqueness: rejects duplicate locality name in the same city and tenant with P2002", async () => {
    await prisma.locality.create({
      data: {
        tenantId: fixtureA.tenant.id,
        city: "Gurugram",
        name: "DLF Phase 5",
      },
    });

    await expect(
      prisma.locality.create({
        data: {
          tenantId: fixtureA.tenant.id,
          city: "Gurugram",
          name: "DLF Phase 5",
        },
      })
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("enforces SiteVisitItem composite uniqueness: rejects duplicate property in the same visit itinerary with P2002", async () => {
    const salesAgent = await createTestUser(prisma, fixtureA.tenant.id, { role: UserRole.FIELD_SALES_AGENT });
    const lead = await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "Tour Buyer",
        primaryPhone: "9844433333",
        originalSource: "MANUAL",
      },
    });

    const property = await createTestProperty(prisma, fixtureA.tenant.id, {
      societyName: "Green Valley",
      localityName: "Sector 54",
      city: "Gurugram",
      preference: TransactionType.SALE,
      propertyType: PropertyType.APARTMENT,
      bedroomCount: 2,
      price: 15000000,
      area: 1200,
      ownerName: "Owner A",
      ownerMobile: "9877766655",
    });

    const visit = await prisma.siteVisit.create({
      data: {
        tenantId: fixtureA.tenant.id,
        leadId: lead.id,
        assignedSalesAgentId: salesAgent.id,
        scheduledDate: new Date("2026-11-20T10:00:00Z"),
      },
    });

    // First stop with property succeeds
    await prisma.siteVisitItem.create({
      data: {
        tenantId: fixtureA.tenant.id,
        siteVisitId: visit.id,
        propertyId: property.id,
        visitOrder: 1,
        enteredByUserId: salesAgent.id,
      },
    });

    // Second stop in same visit referencing identical property must fail with P2002
    await expect(
      prisma.siteVisitItem.create({
        data: {
          tenantId: fixtureA.tenant.id,
          siteVisitId: visit.id,
          propertyId: property.id,
          visitOrder: 2,
          enteredByUserId: salesAgent.id,
        },
      })
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("enforces global token hash uniqueness: rejects duplicate tokenHash on SiteVisitAccessLink with P2002", async () => {
    const salesAgent = await createTestUser(prisma, fixtureA.tenant.id, { role: UserRole.FIELD_SALES_AGENT });
    const lead = await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "Hash Buyer",
        primaryPhone: "9855544444",
        originalSource: "MANUAL",
      },
    });

    const visit = await prisma.siteVisit.create({
      data: {
        tenantId: fixtureA.tenant.id,
        leadId: lead.id,
        assignedSalesAgentId: salesAgent.id,
        scheduledDate: new Date(),
      },
    });

    const duplicateTokenHash = "f".repeat(64);

    await prisma.siteVisitAccessLink.create({
      data: {
        tenantId: fixtureA.tenant.id,
        siteVisitId: visit.id,
        salesAgentId: salesAgent.id,
        tokenHash: duplicateTokenHash,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    await expect(
      prisma.siteVisitAccessLink.create({
        data: {
          tenantId: fixtureA.tenant.id,
          siteVisitId: visit.id,
          salesAgentId: salesAgent.id,
          tokenHash: duplicateTokenHash,
          expiresAt: new Date(Date.now() + 86400000),
        },
      })
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("enforces cascade deletion: deleting a SiteVisit deletes its items, links, and schedule history in PostgreSQL", async () => {
    const salesAgent = await createTestUser(prisma, fixtureA.tenant.id, { role: UserRole.FIELD_SALES_AGENT });
    const lead = await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "Cascade Lead",
        primaryPhone: "9866655555",
        originalSource: "MANUAL",
      },
    });

    const property = await createTestProperty(prisma, fixtureA.tenant.id, {
      societyName: "Skyline Heights",
      localityName: "Golf Course",
      city: "Gurugram",
      preference: TransactionType.SALE,
      propertyType: PropertyType.APARTMENT,
      bedroomCount: 3,
      price: 35000000,
      area: 2500,
      ownerName: "Owner B",
      ownerMobile: "9888877766",
    });

    const visit = await prisma.siteVisit.create({
      data: {
        tenantId: fixtureA.tenant.id,
        leadId: lead.id,
        assignedSalesAgentId: salesAgent.id,
        scheduledDate: new Date(),
      },
    });

    const item = await prisma.siteVisitItem.create({
      data: {
        tenantId: fixtureA.tenant.id,
        siteVisitId: visit.id,
        propertyId: property.id,
        enteredByUserId: salesAgent.id,
      },
    });

    const link = await prisma.siteVisitAccessLink.create({
      data: {
        tenantId: fixtureA.tenant.id,
        siteVisitId: visit.id,
        salesAgentId: salesAgent.id,
        tokenHash: "e".repeat(64),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    const history = await prisma.siteVisitScheduleHistory.create({
      data: {
        tenantId: fixtureA.tenant.id,
        siteVisitId: visit.id,
        previousScheduledAt: visit.scheduledDate,
        changeType: ScheduleChangeType.RESCHEDULED,
        reason: "Initial tour schedule",
        recordedByUserId: salesAgent.id,
      },
    });

    // Delete the parent SiteVisit
    await prisma.siteVisit.delete({ where: { id: visit.id } });

    // Assert that child records were cascaded and no longer exist in DB
    const foundItem = await prisma.siteVisitItem.findUnique({ where: { id: item.id } });
    const foundLink = await prisma.siteVisitAccessLink.findUnique({ where: { id: link.id } });
    const foundHistory = await prisma.siteVisitScheduleHistory.findUnique({ where: { id: history.id } });

    expect(foundItem).toBeNull();
    expect(foundLink).toBeNull();
    expect(foundHistory).toBeNull();
  });

  it("enforces restrictive deletion: deleting a User who has logged a CallLog is rejected with P2003", async () => {
    const caller = await createTestUser(prisma, fixtureA.tenant.id, { role: UserRole.TELECALLER });
    const lead = await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "Call Log Lead",
        primaryPhone: "9877700001",
        originalSource: "MANUAL",
      },
    });

    await prisma.callLog.create({
      data: {
        tenantId: fixtureA.tenant.id,
        callerId: caller.id,
        leadId: lead.id,
        callType: CallTargetType.LEAD_VALIDATION,
        notes: "Buyer contacted for requirement gathering",
      },
    });

    // Attempting to delete the caller must be rejected by PostgreSQL onDelete: Restrict
    await expect(
      prisma.user.delete({ where: { id: caller.id } })
    ).rejects.toMatchObject({
      code: "P2003",
    });
  });
});

