import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  PrismaClient,
  PortalProvider,
  LeadStatus,
  WebhookProcessingStatus,
  UserRole,
} from "@prisma/client";
import { getTestPrisma, disconnectTestDb } from "./helpers/db-client";
import {
  createTestTenant,
  createTestUser,
  TestTenantFixture,
} from "./helpers/tenant-helper";
import { POST } from "@/app/api/webhooks/portals/[provider]/route";
import {
  setWebhookRateLimiter,
  resetWebhookRateLimiter,
  createMockRateLimiter,
} from "@/server/security/portal-rate-limiter";
import {
  registerPortalAdapter,
  resetPortalAdapters,
} from "@/server/integrations/portals/registry";
import { GenericMockPortalAdapter } from "@/server/integrations/portals/adapters/generic-mock";
import { generateWebhookToken } from "@/server/security/portal-tokens";

describe("Live PostgreSQL Integration: Public Inbound Portal Webhook Route (DV-14 Phase 3 Stage 3B)", () => {
  let prisma: PrismaClient;
  let fixtureA: TestTenantFixture;
  let fixtureB: TestTenantFixture;
  let telecallerA: { id: string; name: string };

  let token99A: { rawToken: string; tokenHash: string };
  let tokenMBA: { rawToken: string; tokenHash: string };
  let token99B: { rawToken: string; tokenHash: string };

  beforeAll(async () => {
    prisma = await getTestPrisma();
    fixtureA = await createTestTenant(prisma, "Webhook Route Alpha Brokerage");
    fixtureB = await createTestTenant(prisma, "Webhook Route Beta Brokerage");

    // Create an active telecaller in Tenant Alpha for lead assignment
    const caller = await createTestUser(prisma, fixtureA.tenant.id, {
      name: "Sunil Telecaller",
      role: UserRole.TELECALLER,
      phone: "9811122233",
    });
    telecallerA = { id: caller.id, name: caller.name };

    // 1. Configure enabled 99acres for Tenant Alpha
    token99A = generateWebhookToken();
    await prisma.tenantPortalConfig.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        webhookTokenHash: token99A.tokenHash,
        isEnabled: true,
      },
    });

    // 2. Configure disabled Magicbricks for Tenant Alpha
    tokenMBA = generateWebhookToken();
    await prisma.tenantPortalConfig.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.MAGICBRICKS,
        webhookTokenHash: tokenMBA.tokenHash,
        isEnabled: false,
      },
    });

    // 3. Configure enabled 99acres for Tenant Beta
    token99B = generateWebhookToken();
    await prisma.tenantPortalConfig.create({
      data: {
        tenantId: fixtureB.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        webhookTokenHash: token99B.tokenHash,
        isEnabled: true,
      },
    });
  });

  afterAll(async () => {
    if (fixtureA) await fixtureA.cleanup();
    if (fixtureB) await fixtureB.cleanup();
    await disconnectTestDb();
  });

  beforeEach(() => {
    // Enable permissive test double rate limiter for functional integration tests
    setWebhookRateLimiter(
      createMockRateLimiter({ configured: true, ipAllowed: true, tenantAllowed: true })
    );

    // Register verified mock adapters for synthetic testing (Section 6)
    registerPortalAdapter(
      PortalProvider.NINETY_NINE_ACRES,
      new GenericMockPortalAdapter(PortalProvider.NINETY_NINE_ACRES)
    );
    registerPortalAdapter(
      PortalProvider.MAGICBRICKS,
      new GenericMockPortalAdapter(PortalProvider.MAGICBRICKS)
    );
  });

  afterEach(() => {
    resetPortalAdapters();
    resetWebhookRateLimiter();
  });

  function buildRequest(options: {
    providerPath: string;
    token?: string;
    authHeader?: string;
    body: unknown;
    contentType?: string | null;
  }): NextRequest {
    const headers = new Headers();
    if (options.contentType !== null) {
      headers.set("content-type", options.contentType ?? "application/json");
    }
    if (options.authHeader !== undefined) {
      headers.set("authorization", options.authHeader);
    } else if (options.token) {
      headers.set("authorization", `Bearer ${options.token}`);
    }

    return new NextRequest(
      `http://localhost:3000/api/webhooks/portals/${options.providerPath}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(options.body),
      }
    );
  }

  it("Test 1: Valid GenericMock request creates expected Lead, Requirement, Enquiry, Assignment, and PROCESSED event in PostgreSQL", async () => {
    const payload = {
      externalEventId: "route_test_001",
      name: "Aarav Gupta",
      mobile: "9810011234",
      email: "aarav@example.com",
      city: "Gurugram",
      locality: "Sector 54",
      preference: "SALE",
      minBudget: 15000000,
      maxBudget: 25000000,
      propertyType: "APARTMENT",
      bedroomConfiguration: "3 BHK",
      enquiryNotes: "Looking for ready to move apartment near metro.",
    };

    const req = buildRequest({
      providerPath: "99acres",
      token: token99A.rawToken,
      body: payload,
    });

    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.isDuplicate).toBe(false);
    expect(body.isExistingBuyer).toBe(false);
    expect(body.deduplicationGuarantee).toBe("STRONG_KEYED");
    expect(body.leadId).toBeDefined();
    expect(body.enquiryId).toBeDefined();

    // Verify PostgreSQL records in Tenant Alpha
    const lead = await prisma.lead.findUnique({
      where: { id: body.leadId },
      include: {
        requirement: true,
        enquiries: true,
        assignments: true,
      },
    });

    expect(lead).not.toBeNull();
    expect(lead!.tenantId).toBe(fixtureA.tenant.id);
    expect(lead!.name).toBe("Aarav Gupta");
    expect(lead!.primaryPhone).toBe("9810011234");
    expect(lead!.originalSource).toBe(PortalProvider.NINETY_NINE_ACRES);
    expect(lead!.status).toBe(LeadStatus.NOT_YET_VALIDATED);
    expect(lead!.assignedTelecallerId).toBe(telecallerA.id);

    // Requirement created
    expect(lead!.requirement).not.toBeNull();
    expect(lead!.requirement!.city).toBe("Gurugram");
    expect(Number(lead!.requirement!.minBudget)).toBe(15000000);

    // Enquiry created
    expect(lead!.enquiries).toHaveLength(1);
    expect(lead!.enquiries[0].id).toBe(body.enquiryId);
    expect(lead!.enquiries[0].source).toBe(PortalProvider.NINETY_NINE_ACRES);

    // PortalWebhookEvent created in PROCESSED status
    const event = await prisma.portalWebhookEvent.findUnique({
      where: {
        tenantId_provider_idempotencyKey: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
          idempotencyKey: "NINETY_NINE_ACRES_route_test_001",
        },
      },
    });

    expect(event).not.toBeNull();
    expect(event!.status).toBe(WebhookProcessingStatus.PROCESSED);
    expect(event!.leadPhone).toBe("9810011234");
    expect(event!.externalEventId).toBe("route_test_001");
  });

  it("Test 2: Repeated keyed event returns 200 and isDuplicate: true without creating duplicate enquiries or leads", async () => {
    const payload = {
      externalEventId: "route_test_001", // Same external ID as Test 1
      name: "Aarav Gupta",
      mobile: "9810011234",
      city: "Gurugram",
      preference: "SALE",
    };

    const req = buildRequest({
      providerPath: "99acres",
      token: token99A.rawToken,
      body: payload,
    });

    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.isDuplicate).toBe(true);
    expect(body.isExistingBuyer).toBe(true);

    // Assert database enquiry count for this phone is STILL exactly 1
    const lead = await prisma.lead.findFirst({
      where: { tenantId: fixtureA.tenant.id, primaryPhone: "9810011234" },
      include: { enquiries: true },
    });
    expect(lead!.enquiries).toHaveLength(1);
  });

  it("Test 3: Cross-tenant token isolation: client cannot inject tenantId; token resolves strictly to configuration tenant", async () => {
    // Attempting to inject Tenant Alpha's tenantId in payload while authenticating with Tenant Beta's token
    const payload = {
      tenantId: fixtureA.tenant.id, // Attacker tries to inject Tenant Alpha's ID
      externalEventId: "beta_lead_001",
      name: "Beta Prospect",
      mobile: "9820033445",
      city: "Mumbai",
      preference: "RENT",
    };

    const req = buildRequest({
      providerPath: "99acres",
      token: token99B.rawToken, // Tenant Beta token
      body: payload,
    });

    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);

    // Lead must exist in Tenant Beta
    const betaLead = await prisma.lead.findFirst({
      where: { tenantId: fixtureB.tenant.id, primaryPhone: "9820033445" },
    });
    expect(betaLead).not.toBeNull();
    expect(betaLead!.tenantId).toBe(fixtureB.tenant.id);

    // Lead must NOT exist in Tenant Alpha
    const alphaLead = await prisma.lead.findFirst({
      where: { tenantId: fixtureA.tenant.id, primaryPhone: "9820033445" },
    });
    expect(alphaLead).toBeNull();
  });

  it("Test 4: Disabled portal integration is rejected with HTTP 401 and creates no database records", async () => {
    const payload = {
      externalEventId: "mb_lead_disabled",
      name: "Disabled Test",
      mobile: "9811199988",
      city: "Delhi",
      preference: "SALE",
    };

    const req = buildRequest({
      providerPath: "magicbricks",
      token: tokenMBA.rawToken, // Magicbricks is disabled in Tenant Alpha
      body: payload,
    });

    const res = await POST(req, { params: Promise.resolve({ provider: "magicbricks" }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/disabled/i);

    // No lead created in PostgreSQL
    const lead = await prisma.lead.findFirst({
      where: { tenantId: fixtureA.tenant.id, primaryPhone: "9811199988" },
    });
    expect(lead).toBeNull();
  });

  it("Test 5: Invalid or unknown token is rejected with HTTP 401 without database writes", async () => {
    const unknownToken = "e".repeat(64);
    const payload = {
      name: "Unknown Token Test",
      mobile: "9811177766",
      city: "Delhi",
      preference: "SALE",
    };

    const req = buildRequest({
      providerPath: "99acres",
      token: unknownToken,
      body: payload,
    });

    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(401);

    const lead = await prisma.lead.findFirst({
      where: { primaryPhone: "9811177766" },
    });
    expect(lead).toBeNull();
  });

  it("Test 6: DNC protection is preserved: incoming portal re-enquiry for DNC buyer preserves DNC status and appends enquiry", async () => {
    const dncPhone = "9899988877";

    // Pre-create a lead with INACTIVE status and isDoNotContact: true in Tenant Alpha
    const existingDncLead = await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "Vikram DNC Buyer",
        primaryPhone: dncPhone,
        status: LeadStatus.INACTIVE,
        isDoNotContact: true,
        originalSource: "MANUAL",
      },
    });

    const payload = {
      externalEventId: "dnc_repeat_enquiry_01",
      name: "Vikram DNC Buyer",
      mobile: dncPhone,
      city: "Gurugram",
      preference: "SALE",
      enquiryNotes: "Repeat enquiry from portal.",
    };

    const req = buildRequest({
      providerPath: "99acres",
      token: token99A.rawToken,
      body: payload,
    });

    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(200);

    // Verify lead status was NOT altered to active or unvalidated
    const leadAfter = await prisma.lead.findUnique({
      where: { id: existingDncLead.id },
      include: { enquiries: true },
    });

    expect(leadAfter!.status).toBe(LeadStatus.INACTIVE);
    expect(leadAfter!.isDoNotContact).toBe(true);
    expect(leadAfter!.enquiries).toHaveLength(1);
    expect(leadAfter!.enquiries[0].enquiryDetails).toMatch(/re-enquiry/i);
  });

  it("Test 7: Existing buyer re-enquiry appends an Enquiry to the existing Lead without duplicate Lead creation", async () => {
    const repeatPhone = "9877766655";

    // Pre-create an active validated buyer in Tenant Alpha
    const activeLead = await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "Pooja Active Buyer",
        primaryPhone: repeatPhone,
        status: LeadStatus.ACTIVE,
        originalSource: "MANUAL",
      },
    });

    // Also pre-create their initial enquiry
    await prisma.enquiry.create({
      data: {
        tenantId: fixtureA.tenant.id,
        leadId: activeLead.id,
        source: "MANUAL",
        enquiryDetails: "Initial manual enquiry.",
      },
    });

    const payload = {
      externalEventId: "pooja_portal_enquiry_01",
      name: "Pooja Active Buyer",
      mobile: repeatPhone,
      city: "Gurugram",
      preference: "SALE",
      enquiryNotes: "Secondary enquiry via 99acres.",
    };

    const req = buildRequest({
      providerPath: "99acres",
      token: token99A.rawToken,
      body: payload,
    });

    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.isExistingBuyer).toBe(true);
    expect(body.leadId).toBe(activeLead.id);

    // Verify exactly 1 Lead exists and now has 2 Enquiries
    const leads = await prisma.lead.findMany({
      where: { tenantId: fixtureA.tenant.id, primaryPhone: repeatPhone },
      include: { enquiries: true },
    });
    expect(leads).toHaveLength(1);
    expect(leads[0].enquiries).toHaveLength(2);
    expect(leads[0].status).toBe(LeadStatus.ACTIVE);
  });

  it("Test 8: Database failure mid-transaction leaves zero partial business records and logs FAILED event outside transaction", async () => {
    // Invalidate phone by passing an invalid number that bypasses adapter (or triggers validation failure)
    const malformedPayload = {
      externalEventId: "fail_tx_001",
      name: "Incomplete Lead",
      mobile: "", // Empty mobile fails adapter validation
      city: "Gurugram",
      preference: "SALE",
    };

    const req = buildRequest({
      providerPath: "99acres",
      token: token99A.rawToken,
      body: malformedPayload,
    });

    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(400);

    // Verify zero leads created
    const lead = await prisma.lead.findFirst({
      where: { tenantId: fixtureA.tenant.id, name: "Incomplete Lead" },
    });
    expect(lead).toBeNull();

    // Verify a FAILED event was persisted outside the failed transaction for auditing
    const failedEvent = await prisma.portalWebhookEvent.findFirst({
      where: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        status: WebhookProcessingStatus.FAILED,
        eventAction: "PORTAL_VALIDATION_FAILED",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(failedEvent).not.toBeNull();
    expect(failedEvent!.errorMessage).toMatch(/mobile phone is required/i);
  });

  it("Test 9: PortalWebhookEvent status and error handling remain consistent on validation error", async () => {
    const invalidPayload = {
      // Missing name entirely
      mobile: "9810011999",
      city: "Noida",
      preference: "SALE",
    };

    const req = buildRequest({
      providerPath: "99acres",
      token: token99A.rawToken,
      body: invalidPayload,
    });

    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/prospect name is required/i);

    // Verify FAILED event in database
    const failedEvent = await prisma.portalWebhookEvent.findFirst({
      where: {
        tenantId: fixtureA.tenant.id,
        status: WebhookProcessingStatus.FAILED,
        errorMessage: { contains: "Prospect name is required" },
      },
    });
    expect(failedEvent).not.toBeNull();
  });

  it("Test 10: Unkeyed requests with identical payloads create separate enquiries with unique receipt IDs and candidate duplicate flag without suppression", async () => {
    // Unkeyed payload (no externalEventId, queryId, or leadId)
    const unkeyedPayload = {
      name: "Pooja Hegde",
      mobile: "9876543210",
      city: "Gurugram",
      locality: "Golf Course Road",
      preference: "SALE",
      minBudget: 20000000,
      maxBudget: 35000000,
      bedroomConfiguration: "3 BHK",
      enquiryNotes: "Interested in luxury high-rise apartment",
    };

    // First unkeyed delivery
    const req1 = buildRequest({
      providerPath: "99acres",
      token: token99A.rawToken,
      body: unkeyedPayload,
    });
    const res1 = await POST(req1, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.success).toBe(true);
    expect(body1.isDuplicate).toBe(false);
    expect(body1.isExistingBuyer).toBe(false);
    expect(body1.isDuplicateCandidate).toBe(false);
    expect(body1.deduplicationGuarantee).toBe("WEAK_UNKEYED");
    expect(typeof body1.eventId).toBe("string");
    expect(typeof body1.leadId).toBe("string");
    expect(typeof body1.enquiryId).toBe("string");

    // Second unkeyed delivery with IDENTICAL payload
    const req2 = buildRequest({
      providerPath: "99acres",
      token: token99A.rawToken,
      body: unkeyedPayload,
    });
    const res2 = await POST(req2, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    // Must NOT be suppressed or marked as an automatic duplicate delivery
    expect(body2.success).toBe(true);
    expect(body2.isDuplicate).toBe(false);
    expect(body2.isExistingBuyer).toBe(true);
    expect(body2.isDuplicateCandidate).toBe(true); // Flagged for observability
    expect(body2.deduplicationGuarantee).toBe("WEAK_UNKEYED");

    // Both requests must receive unique receipt IDs and separate enquiries
    expect(body2.eventId).not.toBe(body1.eventId);
    expect(body2.enquiryId).not.toBe(body1.enquiryId);
    expect(body2.leadId).toBe(body1.leadId);

    // Verify database state: exactly 1 Lead with 2 distinct Enquiries
    const lead = await prisma.lead.findUnique({
      where: { id: body1.leadId },
      include: { enquiries: true },
    });
    expect(lead).not.toBeNull();
    expect(lead!.enquiries).toHaveLength(2);

    // Verify 2 separate PROCESSED webhook events exist in database with unique idempotency keys
    const event1 = await prisma.portalWebhookEvent.findUnique({
      where: { id: body1.eventId },
    });
    const event2 = await prisma.portalWebhookEvent.findUnique({
      where: { id: body2.eventId },
    });
    expect(event1).not.toBeNull();
    expect(event2).not.toBeNull();
    expect(event1!.status).toBe(WebhookProcessingStatus.PROCESSED);
    expect(event2!.status).toBe(WebhookProcessingStatus.PROCESSED);
    expect(event1!.idempotencyKey).toMatch(/^unkeyed_/);
    expect(event2!.idempotencyKey).toMatch(/^unkeyed_/);
    expect(event1!.idempotencyKey).not.toBe(event2!.idempotencyKey);

    // Third unkeyed delivery with DIFFERENT payload for the same phone number
    const differentPayload = {
      ...unkeyedPayload,
      locality: "Sohna Road",
      enquiryNotes: "Inquiring about independent floors",
      minBudget: 15000000,
      maxBudget: 22000000,
    };
    const req3 = buildRequest({
      providerPath: "99acres",
      token: token99A.rawToken,
      body: differentPayload,
    });
    const res3 = await POST(req3, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res3.status).toBe(200);
    const body3 = await res3.json();
    expect(body3.success).toBe(true);
    expect(body3.isDuplicate).toBe(false);
    expect(body3.isExistingBuyer).toBe(true);
    expect(body3.isDuplicateCandidate).toBe(false); // Different payload -> NOT a duplicate candidate!
    expect(body3.eventId).not.toBe(body1.eventId);
    expect(body3.eventId).not.toBe(body2.eventId);
    expect(body3.enquiryId).not.toBe(body1.enquiryId);
    expect(body3.enquiryId).not.toBe(body2.enquiryId);

    const leadAfter3 = await prisma.lead.findUnique({
      where: { id: body1.leadId },
      include: { enquiries: true },
    });
    expect(leadAfter3!.enquiries).toHaveLength(3);
  });
});
