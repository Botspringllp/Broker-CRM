import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, UserRole, SupplyValidationStatus, PropertyAvailabilityStatus } from "@prisma/client";
import { getTestPrisma, disconnectTestDb } from "./helpers/db-client";
import {
  createTestTenant,
  createTestUser,
  createTestProperty,
  createTestLead,
  createTestContext,
  TestTenantFixture,
} from "./helpers/tenant-helper";
import { getLeadById, listLeads, updateLead } from "@/server/dal/leads";
import { getSiteVisitById, listSiteVisits, createSiteVisit } from "@/server/dal/visits";
import { NotFoundError, ValidationError } from "@/server/errors";

describe("Live PostgreSQL Integration: Multi-Tenancy & Tenant Boundary Enforcement", () => {
  let prisma: PrismaClient;
  let fixtureA: TestTenantFixture;
  let fixtureB: TestTenantFixture;

  beforeAll(async () => {
    prisma = await getTestPrisma();
    fixtureA = await createTestTenant(prisma, "MultiTenant Broker Alpha");
    fixtureB = await createTestTenant(prisma, "MultiTenant Broker Beta");
  });

  afterAll(async () => {
    await fixtureA?.cleanup();
    await fixtureB?.cleanup();
    await disconnectTestDb();
  });

  it("strictly enforces Lead query isolation: Tenant A cannot read Tenant B's Lead through DAL", async () => {
    const userA = await createTestUser(prisma, fixtureA.tenant.id, { role: UserRole.BROKER_OWNER });

    const leadB = await createTestLead(prisma, fixtureB.tenant.id, {
      name: "Private Buyer Beta",
      primaryPhone: "9811122233",
    });

    const contextA = createTestContext(userA);

    // Tenant A querying Tenant B's lead must throw NotFoundError
    await expect(getLeadById(contextA, leadB.id)).rejects.toThrow(NotFoundError);

    // Direct database query with tenant filter returns null
    const directQuery = await prisma.lead.findFirst({
      where: {
        id: leadB.id,
        tenantId: fixtureA.tenant.id,
      },
    });
    expect(directQuery).toBeNull();
  });

  it("strictly enforces Lead list isolation: Tenant A's lead list contains 0 records belonging to Tenant B", async () => {
    const userA = await createTestUser(prisma, fixtureA.tenant.id, { role: UserRole.BROKER_OWNER });

    const leadA = await createTestLead(prisma, fixtureA.tenant.id, { name: "Buyer Alpha 1" });
    const leadB = await createTestLead(prisma, fixtureB.tenant.id, { name: "Buyer Beta 1" });

    const contextA = createTestContext(userA);
    const leads = await listLeads(contextA, {});

    const returnedIds = leads.map((l) => l.id);
    expect(returnedIds).toContain(leadA.id);
    expect(returnedIds).not.toContain(leadB.id);

    // Every single returned record must have tenantId equal to fixtureA
    leads.forEach((l) => {
      expect(l.tenantId).toBe(fixtureA.tenant.id);
    });
  });

  it("strictly enforces Lead mutation isolation: Tenant A cannot update Tenant B's Lead", async () => {
    const userA = await createTestUser(prisma, fixtureA.tenant.id, { role: UserRole.BROKER_OWNER });
    const leadB = await createTestLead(prisma, fixtureB.tenant.id, {
      name: "Original Beta Lead",
      primaryPhone: "9822233344",
    });

    const contextA = createTestContext(userA);

    await expect(
      updateLead(contextA, leadB.id, { name: "Malicious Tampered Lead" })
    ).rejects.toThrow(NotFoundError);

    // Verify in database that leadB is completely untampered
    const unchangedLead = await prisma.lead.findUnique({
      where: { id: leadB.id },
    });
    expect(unchangedLead?.name).toBe("Original Beta Lead");
  });

  it("allows identical buyer phone numbers across tenants simultaneously in PostgreSQL", async () => {
    const sharedPhone = "9899988877";

    const leadAlpha = await createTestLead(prisma, fixtureA.tenant.id, {
      name: "Alpha Shared Client",
      primaryPhone: sharedPhone,
    });

    const leadBeta = await createTestLead(prisma, fixtureB.tenant.id, {
      name: "Beta Shared Client",
      primaryPhone: sharedPhone,
    });

    expect(leadAlpha.id).toBeDefined();
    expect(leadBeta.id).toBeDefined();
    expect(leadAlpha.id).not.toBe(leadBeta.id);
    expect(leadAlpha.primaryPhone).toBe(leadBeta.primaryPhone);

    // Direct database count check
    const count = await prisma.lead.count({
      where: { primaryPhone: sharedPhone },
    });
    expect(count).toBe(2);
  });

  it("strictly enforces Site Visit query isolation: Tenant A cannot read Tenant B's Site Visit", async () => {
    const userA = await createTestUser(prisma, fixtureA.tenant.id, { role: UserRole.BROKER_OWNER });
    const agentB = await createTestUser(prisma, fixtureB.tenant.id, { role: UserRole.FIELD_SALES_AGENT });
    const leadB = await createTestLead(prisma, fixtureB.tenant.id, { name: "Beta Prospect" });
    const propB = await createTestProperty(prisma, fixtureB.tenant.id, {
      isActiveSupply: true,
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
    });

    const visitB = await prisma.siteVisit.create({
      data: {
        tenantId: fixtureB.tenant.id,
        leadId: leadB.id,
        assignedSalesAgentId: agentB.id,
        scheduledDate: new Date("2026-11-20T10:00:00Z"),
        items: {
          create: {
            tenantId: fixtureB.tenant.id,
            propertyId: propB.id,
            visitOrder: 1,
            enteredByUserId: agentB.id,
          },
        },
      },
    });

    const contextA = createTestContext(userA);

    // DAL fetch must throw NotFoundError
    await expect(getSiteVisitById(contextA, visitB.id)).rejects.toThrow(NotFoundError);

    // Direct database check with Tenant A filter
    const directCheck = await prisma.siteVisit.findFirst({
      where: {
        id: visitB.id,
        tenantId: fixtureA.tenant.id,
      },
    });
    expect(directCheck).toBeNull();
  });

  it("strictly prevents cross-tenant property scheduling: rejects scheduling when a property belongs to another tenant", async () => {
    const userA = await createTestUser(prisma, fixtureA.tenant.id, { role: UserRole.BROKER_OWNER });
    const agentA = await createTestUser(prisma, fixtureA.tenant.id, { role: UserRole.FIELD_SALES_AGENT });
    const leadA = await createTestLead(prisma, fixtureA.tenant.id, { name: "Alpha Prospect" });

    // Property owned by Tenant B
    const propB = await createTestProperty(prisma, fixtureB.tenant.id, {
      societyName: "Beta Exclusive Tower",
      isActiveSupply: true,
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
    });

    const contextA = createTestContext(userA);

    // Attempting to schedule visit in Tenant A with Property B must be rejected
    await expect(
      createSiteVisit(contextA, {
        leadId: leadA.id,
        assignedSalesAgentId: agentA.id,
        scheduledDate: "2026-11-25T11:00:00Z",
        propertyIds: [propB.id],
      })
    ).rejects.toThrow(ValidationError);
  });

  it("strictly isolates Site Visit listings between tenants", async () => {
    const userA = await createTestUser(prisma, fixtureA.tenant.id, { role: UserRole.BROKER_OWNER });
    const agentA = await createTestUser(prisma, fixtureA.tenant.id, { role: UserRole.FIELD_SALES_AGENT });
    const leadA = await createTestLead(prisma, fixtureA.tenant.id, { name: "Alpha Tour Prospect" });
    const propA = await createTestProperty(prisma, fixtureA.tenant.id, {
      isActiveSupply: true,
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
    });

    const visitA = await prisma.siteVisit.create({
      data: {
        tenantId: fixtureA.tenant.id,
        leadId: leadA.id,
        assignedSalesAgentId: agentA.id,
        scheduledDate: new Date("2026-11-21T14:00:00Z"),
        items: {
          create: {
            tenantId: fixtureA.tenant.id,
            propertyId: propA.id,
            visitOrder: 1,
            enteredByUserId: agentA.id,
          },
        },
      },
    });

    const contextA = createTestContext(userA);
    const visits = await listSiteVisits(contextA);

    const visitIds = visits.map((v) => v.id);
    expect(visitIds).toContain(visitA.id);

    // Ensure all returned visits belong strictly to Tenant A
    visits.forEach((v) => {
      expect(v.tenantId).toBe(fixtureA.tenant.id);
    });
  });

  it("strictly isolates BuyerPropertyInterest records between tenants", async () => {
    const leadA = await createTestLead(prisma, fixtureA.tenant.id, { name: "Buyer Alpha Interest" });
    const propA = await createTestProperty(prisma, fixtureA.tenant.id);

    const leadB = await createTestLead(prisma, fixtureB.tenant.id, { name: "Buyer Beta Interest" });
    const propB = await createTestProperty(prisma, fixtureB.tenant.id);

    // Create interest in Tenant A
    await prisma.buyerPropertyInterest.create({
      data: {
        tenantId: fixtureA.tenant.id,
        leadId: leadA.id,
        propertyId: propA.id,
        interestLevel: "HIGH",
        feedbackNotes: "Loves morning sunlight",
      },
    });

    // Create interest in Tenant B
    await prisma.buyerPropertyInterest.create({
      data: {
        tenantId: fixtureB.tenant.id,
        leadId: leadB.id,
        propertyId: propB.id,
        interestLevel: "LOW",
        feedbackNotes: "Too far from highway",
      },
    });

    // Query interests for Tenant A
    const interestsA = await prisma.buyerPropertyInterest.findMany({
      where: { tenantId: fixtureA.tenant.id },
    });

    expect(interestsA.length).toBeGreaterThanOrEqual(1);
    interestsA.forEach((interest) => {
      expect(interest.tenantId).toBe(fixtureA.tenant.id);
      expect(interest.leadId).toBe(leadA.id);
      expect(interest.propertyId).toBe(propA.id);
      expect(interest.leadId).not.toBe(leadB.id);
    });
  });
});
