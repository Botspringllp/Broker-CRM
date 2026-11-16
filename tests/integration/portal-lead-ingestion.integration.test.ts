import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  PrismaClient,
  PortalProvider,
  WebhookProcessingStatus,
  LeadStatus,
  TransactionType,
  UserRole,
} from "@prisma/client";
import { getTestPrisma, disconnectTestDb } from "./helpers/db-client";
import {
  createTestTenant,
  createTestUser,
  TestTenantFixture,
} from "./helpers/tenant-helper";
import { generateWebhookToken } from "@/server/security/portal-tokens";
import {
  ingestPortalLead,
} from "@/server/dal/portal-ingestion";
import {
  PortalConfigurationDisabledError,
} from "@/server/integrations/portals/types";
import { ValidationError } from "@/server/errors";

describe("Live PostgreSQL Integration: Normalized Portal Lead Ingestion DAL (DV-14 Phase 2)", () => {
  let prisma: PrismaClient;
  let fixtureA: TestTenantFixture;
  let fixtureB: TestTenantFixture;
  let telecallerA: { id: string; name: string };

  beforeAll(async () => {
    prisma = await getTestPrisma();
    fixtureA = await createTestTenant(prisma, "Ingestion Alpha Brokerage");
    fixtureB = await createTestTenant(prisma, "Ingestion Beta Brokerage");

    // Create an active telecaller in Tenant Alpha for round-robin assignment testing
    const user = await createTestUser(prisma, fixtureA.tenant.id, {
      name: "Rohan Telecaller",
      role: UserRole.TELECALLER,
      email: `rohan-${Date.now()}@alpha.test`,
      phone: "9811122233",
    });
    telecallerA = { id: user.id, name: user.name };

    // Configure 99acres and Magicbricks in Tenant Alpha
    const { tokenHash: hash99A } = generateWebhookToken();
    await prisma.tenantPortalConfig.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        webhookTokenHash: hash99A,
        isEnabled: true,
      },
    });

    const { tokenHash: hashMBA } = generateWebhookToken();
    await prisma.tenantPortalConfig.create({
      data: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.MAGICBRICKS,
        webhookTokenHash: hashMBA,
        isEnabled: true,
      },
    });

    // Configure 99acres in Tenant Beta
    const { tokenHash: hash99B } = generateWebhookToken();
    await prisma.tenantPortalConfig.create({
      data: {
        tenantId: fixtureB.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        webhookTokenHash: hash99B,
        isEnabled: true,
      },
    });
  });

  afterAll(async () => {
    await fixtureA?.cleanup();
    await fixtureB?.cleanup();
    await disconnectTestDb();
  });

  it("1. Ingests a new buyer: creates Lead, LeadRequirement, Enquiry, Round-robin Assignment, and PROCESSED event", async () => {
    const payload = {
      externalEventId: "99a_lead_001",
      name: "Aakash Mehta",
      mobile: "9810011221",
      email: "aakash@example.com",
      city: "Gurugram",
      locality: "Sector 54",
      preference: "SALE",
      minBudget: 12000000,
      maxBudget: 18000000,
      propertyType: "APARTMENT",
      bedroomConfiguration: "3 BHK",
      enquiryNotes: "Looking for ready to move apartment near metro.",
    };

    const result = await ingestPortalLead({
      tenantId: fixtureA.tenant.id,
      provider: PortalProvider.NINETY_NINE_ACRES,
      payload,
    });

    expect(result.success).toBe(true);
    expect(result.isDuplicate).toBe(false);
    expect(result.isExistingBuyer).toBe(false);
    expect(result.deduplicationGuarantee).toBe("STRONG_KEYED");
    expect(result.leadStatus).toBe(LeadStatus.NOT_YET_VALIDATED);
    expect(result.assignedTelecallerId).toBe(telecallerA.id);

    // Verify database state: Lead
    const lead = await prisma.lead.findUnique({
      where: { id: result.leadId },
      include: {
        requirement: true,
        enquiries: true,
        assignments: true,
        changeLogs: true,
      },
    });

    expect(lead).toBeDefined();
    expect(lead?.name).toBe("Aakash Mehta");
    expect(lead?.primaryPhone).toBe("9810011221");
    expect(lead?.originalSource).toBe(PortalProvider.NINETY_NINE_ACRES);
    expect(lead?.assignedTelecallerId).toBe(telecallerA.id);

    // Requirement created
    expect(lead?.requirement).toBeDefined();
    expect(lead?.requirement?.city).toBe("Gurugram");
    expect(lead?.requirement?.preference).toBe(TransactionType.SALE);
    expect(Number(lead?.requirement?.minBudget)).toBe(12000000);
    expect(Number(lead?.requirement?.maxBudget)).toBe(18000000);

    // Enquiry created
    expect(lead?.enquiries.length).toBe(1);
    expect(lead?.enquiries[0].source).toBe(PortalProvider.NINETY_NINE_ACRES);

    // Assignment record created
    expect(lead?.assignments.length).toBe(1);
    expect(lead?.assignments[0].assignedUserId).toBe(telecallerA.id);

    // Change log audit created with API source
    const apiLogs = lead?.changeLogs.filter((c) => c.changeSource === "API");
    expect(apiLogs && apiLogs.length > 0).toBe(true);

    // PortalWebhookEvent created and marked PROCESSED
    const event = await prisma.portalWebhookEvent.findUnique({
      where: { id: result.eventId },
    });
    expect(event?.status).toBe(WebhookProcessingStatus.PROCESSED);
    expect(event?.externalEventId).toBe("99a_lead_001");
  });

  it("2. Ingests an existing buyer re-enquiry: attaches new Enquiry without creating a duplicate Lead", async () => {
    // Second enquiry from same buyer with different event ID
    const payloadReEnquiry = {
      externalEventId: "99a_lead_002",
      name: "Aakash Mehta",
      mobile: "9810011221",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 15000000,
      maxBudget: 22000000,
      enquiryNotes: "Also interested in Golf Course Extension road.",
    };

    const result = await ingestPortalLead({
      tenantId: fixtureA.tenant.id,
      provider: PortalProvider.NINETY_NINE_ACRES,
      payload: payloadReEnquiry,
    });

    expect(result.success).toBe(true);
    expect(result.isDuplicate).toBe(false);
    expect(result.isExistingBuyer).toBe(true);

    // Verify database state: Exactly 1 Lead for this phone in Tenant Alpha
    const leadsCount = await prisma.lead.count({
      where: {
        tenantId: fixtureA.tenant.id,
        primaryPhone: "9810011221",
      },
    });
    expect(leadsCount).toBe(1);

    // Verify 2 enquiries now exist on the lead
    const lead = await prisma.lead.findUnique({
      where: { id: result.leadId },
      include: { enquiries: { orderBy: { createdAt: "desc" } } },
    });
    expect(lead?.enquiries.length).toBe(2);
    expect(lead?.enquiries[0].enquiryDetails).toContain("Golf Course Extension");
  });

  it("3. Preserves original source, primary phone, and original creation timestamp during re-enquiry", async () => {
    // Create pre-existing buyer with original source 'MANUAL_WALKIN'
    const preExisting = await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "Devendra Singh",
        primaryPhone: "9810022334",
        originalSource: "MANUAL_WALKIN",
        status: LeadStatus.NOT_YET_VALIDATED,
        requirement: {
          create: {
            tenantId: fixtureA.tenant.id,
            city: "Noida",
            preference: TransactionType.SALE,
            minBudget: 5000000,
            maxBudget: 8000000,
          },
        },
      },
    });

    const originalCreatedAt = preExisting.sourceCreatedAt;

    // Incoming re-enquiry from Magicbricks
    const result = await ingestPortalLead({
      tenantId: fixtureA.tenant.id,
      provider: PortalProvider.MAGICBRICKS,
      payload: {
        id: "mb_query_7766",
        name: "Devendra Singh (Updated Name)",
        phone: "9810022334",
        city: "Noida",
        preference: "SALE",
      },
    });

    expect(result.success).toBe(true);
    expect(result.isExistingBuyer).toBe(true);

    const refreshed = await prisma.lead.findUnique({
      where: { id: preExisting.id },
    });

    // Original source, phone, and timestamps MUST be preserved
    expect(refreshed?.originalSource).toBe("MANUAL_WALKIN");
    expect(refreshed?.primaryPhone).toBe("9810022334");
    expect(refreshed?.sourceCreatedAt.toISOString()).toBe(originalCreatedAt.toISOString());
  });

  it("4. Preserves existing telecaller assignment and requirements during re-enquiry", async () => {
    // Pre-existing lead assigned to telecallerA with 3BHK requirements
    const lead = await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "Sunita Rao",
        primaryPhone: "9810033445",
        originalSource: "WEBSITE",
        assignedTelecallerId: telecallerA.id,
        status: LeadStatus.ACTIVE,
        requirement: {
          create: {
            tenantId: fixtureA.tenant.id,
            city: "Gurugram",
            preference: TransactionType.SALE,
            minBudget: 20000000,
            maxBudget: 30000000,
            bedroomConfigurations: ["3 BHK"],
          },
        },
      },
    });

    // New enquiry comes in from 99acres with different budget and 2 BHK
    await ingestPortalLead({
      tenantId: fixtureA.tenant.id,
      provider: PortalProvider.NINETY_NINE_ACRES,
      payload: {
        externalEventId: "99a_lead_sunita_2",
        name: "Sunita Rao",
        mobile: "9810033445",
        city: "Gurugram",
        preference: "RENT",
        minBudget: 50000,
        maxBudget: 70000,
        bedroomConfiguration: "2 BHK",
      },
    });

    const refreshed = await prisma.lead.findUnique({
      where: { id: lead.id },
      include: { requirement: true },
    });

    // Existing telecaller assignment NOT wiped or reassigned
    expect(refreshed?.assignedTelecallerId).toBe(telecallerA.id);

    // Existing requirement preserved
    expect(refreshed?.requirement?.preference).toBe(TransactionType.SALE);
    expect(refreshed?.requirement?.bedroomConfigurations).toEqual(["3 BHK"]);
    expect(Number(refreshed?.requirement?.minBudget)).toBe(20000000);
  });

  it("5. Strictly enforces DNC protection: does not reactivate an inactive DNC prospect, but reopens non-DNC", async () => {
    // Lead 1: Inactive WITH DNC
    const dncLead = await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "DNC Buyer",
        primaryPhone: "9810044556",
        originalSource: "PORTAL",
        status: LeadStatus.INACTIVE,
        isDoNotContact: true,
        requirement: {
          create: {
            tenantId: fixtureA.tenant.id,
            city: "Delhi",
            preference: TransactionType.SALE,
            minBudget: 1000000,
            maxBudget: 2000000,
          },
        },
      },
    });

    // Lead 2: Inactive WITHOUT DNC
    const nonDncLead = await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "Non-DNC Buyer",
        primaryPhone: "9810055667",
        originalSource: "PORTAL",
        status: LeadStatus.INACTIVE,
        isDoNotContact: false,
        requirement: {
          create: {
            tenantId: fixtureA.tenant.id,
            city: "Delhi",
            preference: TransactionType.SALE,
            minBudget: 1000000,
            maxBudget: 2000000,
          },
        },
      },
    });

    // Ingest enquiry for DNC buyer
    const resDnc = await ingestPortalLead({
      tenantId: fixtureA.tenant.id,
      provider: PortalProvider.NINETY_NINE_ACRES,
      payload: {
        externalEventId: "99a_dnc_1",
        name: "DNC Buyer",
        mobile: "9810044556",
        city: "Delhi",
        preference: "SALE",
      },
    });

    // Ingest enquiry for Non-DNC buyer
    const resNonDnc = await ingestPortalLead({
      tenantId: fixtureA.tenant.id,
      provider: PortalProvider.NINETY_NINE_ACRES,
      payload: {
        externalEventId: "99a_non_dnc_1",
        name: "Non-DNC Buyer",
        mobile: "9810055667",
        city: "Delhi",
        preference: "SALE",
      },
    });

    const refreshedDnc = await prisma.lead.findUnique({ where: { id: dncLead.id } });
    const refreshedNonDnc = await prisma.lead.findUnique({ where: { id: nonDncLead.id } });

    // DNC buyer remains strictly INACTIVE
    expect(resDnc.leadStatus).toBe(LeadStatus.INACTIVE);
    expect(refreshedDnc?.status).toBe(LeadStatus.INACTIVE);

    // Non-DNC buyer is safely reopened to NOT_YET_VALIDATED
    expect(resNonDnc.leadStatus).toBe(LeadStatus.NOT_YET_VALIDATED);
    expect(refreshedNonDnc?.status).toBe(LeadStatus.NOT_YET_VALIDATED);
  });

  it("6. Stable external event ID duplicate delivery: returns isDuplicate without creating another enquiry", async () => {
    const payload = {
      externalEventId: "99a_stable_evt_999",
      name: "Karan Johar",
      mobile: "9810066778",
      city: "Gurugram",
      preference: "SALE",
    };

    // First delivery
    const res1 = await ingestPortalLead({
      tenantId: fixtureA.tenant.id,
      provider: PortalProvider.NINETY_NINE_ACRES,
      payload,
    });
    expect(res1.isDuplicate).toBe(false);

    // Second delivery of EXACT SAME event
    const res2 = await ingestPortalLead({
      tenantId: fixtureA.tenant.id,
      provider: PortalProvider.NINETY_NINE_ACRES,
      payload,
    });
    expect(res2.isDuplicate).toBe(true);
    expect(res2.eventId).toBe(res1.eventId);
    expect(res2.leadId).toBe(res1.leadId);

    // Verify exactly ONE enquiry was created in DB
    const enquiries = await prisma.enquiry.findMany({
      where: {
        tenantId: fixtureA.tenant.id,
        leadId: res1.leadId,
      },
    });
    expect(enquiries.length).toBe(1);
  });

  it("7. Concurrent duplicate delivery: simultaneous calls with the same external event ID succeed safely", async () => {
    const payload = {
      externalEventId: "99a_concurrent_evt_888",
      name: "Simran Kaur",
      mobile: "9810077889",
      city: "Gurugram",
      preference: "SALE",
    };

    // Run two ingestion calls concurrently
    const [resA, resB] = await Promise.all([
      ingestPortalLead({
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        payload,
      }),
      ingestPortalLead({
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        payload,
      }),
    ]);

    // One must be the original, one must be marked duplicate
    const duplicates = [resA.isDuplicate, resB.isDuplicate];
    expect(duplicates).toContain(false);
    expect(duplicates).toContain(true);

    // Exactly one lead and one enquiry created
    const lead = await prisma.lead.findFirst({
      where: {
        tenantId: fixtureA.tenant.id,
        primaryPhone: "9810077889",
      },
      include: { enquiries: true },
    });
    expect(lead).toBeDefined();
    expect(lead?.enquiries.length).toBe(1);
  });

  it("8. Different providers remain completely isolated even with identical external IDs", async () => {
    const commonEventId = "common_lead_12345";

    // Ingestion via 99acres
    const res99 = await ingestPortalLead({
      tenantId: fixtureA.tenant.id,
      provider: PortalProvider.NINETY_NINE_ACRES,
      payload: {
        externalEventId: commonEventId,
        name: "Common ID User",
        mobile: "9810088990",
        city: "Gurugram",
        preference: "SALE",
      },
    });

    // Ingestion via Magicbricks with same eventId
    const resMB = await ingestPortalLead({
      tenantId: fixtureA.tenant.id,
      provider: PortalProvider.MAGICBRICKS,
      payload: {
        id: commonEventId,
        name: "Common ID User",
        phone: "9810088990",
        city: "Gurugram",
        preference: "SALE",
      },
    });

    expect(res99.success).toBe(true);
    expect(resMB.success).toBe(true);

    // Both succeeded and have distinct provider-scoped idempotency keys
    expect(res99.idempotencyKey).toBe(`${PortalProvider.NINETY_NINE_ACRES}_${commonEventId}`);
    expect(resMB.idempotencyKey).toBe(`${PortalProvider.MAGICBRICKS}_${commonEventId}`);

    // Two distinct webhook events in database
    const events = await prisma.portalWebhookEvent.findMany({
      where: {
        tenantId: fixtureA.tenant.id,
        externalEventId: commonEventId,
      },
    });
    expect(events.length).toBe(2);
  });

  it("9. Different tenants remain strictly isolated: same mobile and event ID are isolated per tenant", async () => {
    const payload = {
      externalEventId: "tenant_iso_evt_555",
      name: "Shared Phone Prospect",
      mobile: "9810099001",
      city: "Gurugram",
      preference: "SALE",
    };

    // Ingest in Tenant Alpha
    const resA = await ingestPortalLead({
      tenantId: fixtureA.tenant.id,
      provider: PortalProvider.NINETY_NINE_ACRES,
      payload,
    });

    // Ingest in Tenant Beta
    const resB = await ingestPortalLead({
      tenantId: fixtureB.tenant.id,
      provider: PortalProvider.NINETY_NINE_ACRES,
      payload,
    });

    expect(resA.success).toBe(true);
    expect(resB.success).toBe(true);

    // Leads must belong strictly to their respective tenants
    expect(resA.leadId).not.toBe(resB.leadId);

    const leadA = await prisma.lead.findUnique({ where: { id: resA.leadId } });
    const leadB = await prisma.lead.findUnique({ where: { id: resB.leadId } });

    expect(leadA?.tenantId).toBe(fixtureA.tenant.id);
    expect(leadB?.tenantId).toBe(fixtureB.tenant.id);
  });

  it("10. Missing event ID does NOT silently discard legitimate identical enquiries", async () => {
    // Unkeyed payload (no external event ID)
    const unkeyedPayload = {
      name: "Manish Tiwari",
      mobile: "9810011002",
      city: "Noida",
      preference: "SALE",
      enquiryNotes: "Looking for 3 BHK flat",
    };

    // First submission
    const res1 = await ingestPortalLead({
      tenantId: fixtureA.tenant.id,
      provider: PortalProvider.NINETY_NINE_ACRES,
      payload: unkeyedPayload,
    });

    expect(res1.success).toBe(true);
    expect(res1.deduplicationGuarantee).toBe("WEAK_UNKEYED");
    expect(res1.isExistingBuyer).toBe(false);

    // Second submission with IDENTICAL content (e.g. buyer re-submits form weeks later)
    const res2 = await ingestPortalLead({
      tenantId: fixtureA.tenant.id,
      provider: PortalProvider.NINETY_NINE_ACRES,
      payload: unkeyedPayload,
    });

    // MUST NOT fail or be discarded: both enquiries attached to buyer
    expect(res2.success).toBe(true);
    expect(res2.deduplicationGuarantee).toBe("WEAK_UNKEYED");
    expect(res2.isExistingBuyer).toBe(true);
    expect(res2.isDuplicateCandidate).toBe(true); // Flagged for observability

    // Exactly 1 buyer with 2 enquiries in DB
    const lead = await prisma.lead.findUnique({
      where: { id: res1.leadId },
      include: { enquiries: true },
    });
    expect(lead?.enquiries.length).toBe(2);
  });

  it("11. Rejects invalid payloads: missing fields throw ValidationError and log FAILED event", async () => {
    const invalidPayload = {
      name: "Incomplete User",
      mobile: "invalid-phone",
      city: "Gurugram",
    };

    await expect(
      ingestPortalLead({
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        payload: invalidPayload,
      })
    ).rejects.toThrow(ValidationError);

    // Verify FAILED webhook event recorded for debugging/observability
    const failedEvent = await prisma.portalWebhookEvent.findFirst({
      where: {
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        status: WebhookProcessingStatus.FAILED,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(failedEvent).toBeDefined();
    expect(failedEvent?.errorMessage).toMatch(/Invalid Indian mobile/);
  });

  it("12. Rejects disabled portal configuration with PortalConfigurationDisabledError", async () => {
    // Disable Magicbricks in Tenant Alpha
    await prisma.tenantPortalConfig.update({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.MAGICBRICKS,
        },
      },
      data: { isEnabled: false },
    });

    const validPayload = {
      id: "mb_disabled_test",
      name: "Test User",
      contact_number: "9810011999",
      city: "Noida",
    };

    await expect(
      ingestPortalLead({
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.MAGICBRICKS,
        payload: validPayload,
      })
    ).rejects.toThrow(PortalConfigurationDisabledError);

    // Re-enable Magicbricks
    await prisma.tenantPortalConfig.update({
      where: {
        tenantId_provider: {
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.MAGICBRICKS,
        },
      },
      data: { isEnabled: true },
    });
  });

  it("13. Transaction rollback on database failure: leaves zero partial records and persists FAILED event outside tx, allowing clean retry", async () => {
    const triggerPhone = "9810099881";
    const externalEventId = "99a_rollback_test_evt";

    // Inject temporary PostgreSQL trigger on enquiries that raises an exception during insertion
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_portal_enquiry()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW."advertisedPropertyRef" = 'TRIGGER_ROLLBACK' THEN
          RAISE EXCEPTION 'Simulated database failure during enquiry insertion for rollback test';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS trg_test_portal_rollback ON enquiries;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_test_portal_rollback
      BEFORE INSERT ON enquiries
      FOR EACH ROW EXECUTE FUNCTION test_fail_portal_enquiry();
    `);

    try {
      const payload = {
        externalEventId,
        name: "Rollback Prospect",
        mobile: triggerPhone,
        city: "Gurugram",
        preference: "SALE",
        advertisedPropertyRef: "TRIGGER_ROLLBACK",
      };

      // Ingestion must reject due to PostgreSQL error
      await expect(
        ingestPortalLead({
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
          payload,
        })
      ).rejects.toThrow(/Simulated database failure during enquiry insertion/);

      // Verify ZERO partial business records exist
      const partialLead = await prisma.lead.findFirst({
        where: { tenantId: fixtureA.tenant.id, primaryPhone: triggerPhone },
      });
      expect(partialLead).toBeNull();

      const partialReq = await prisma.leadRequirement.findFirst({
        where: { tenantId: fixtureA.tenant.id, lead: { primaryPhone: triggerPhone } },
      });
      expect(partialReq).toBeNull();

      const partialEnquiry = await prisma.enquiry.findFirst({
        where: { tenantId: fixtureA.tenant.id, advertisedPropertyRef: "TRIGGER_ROLLBACK" },
      });
      expect(partialEnquiry).toBeNull();

      // Verify FAILED event is persisted outside the aborted transaction
      const failedEvent = await prisma.portalWebhookEvent.findFirst({
        where: {
          tenantId: fixtureA.tenant.id,
          externalEventId,
          status: WebhookProcessingStatus.FAILED,
        },
      });
      expect(failedEvent).toBeDefined();
      expect(failedEvent?.errorMessage).toMatch(/Simulated database failure during enquiry insertion/);
      expect(failedEvent?.leadPhone).toBeNull(); // No customer PII retained in failure record

      // Clean up failure trigger so subsequent retry can succeed
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_test_portal_rollback ON enquiries;`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_fail_portal_enquiry();`);

      // Subsequent retry of the EXACT SAME keyed event succeeds safely
      const retryPayload = { ...payload, advertisedPropertyRef: null };
      const resRetry = await ingestPortalLead({
        tenantId: fixtureA.tenant.id,
        provider: PortalProvider.NINETY_NINE_ACRES,
        payload: retryPayload,
      });

      expect(resRetry.success).toBe(true);
      expect(resRetry.isDuplicate).toBe(false);

      // Verify Lead and Enquiry are now created
      const createdLead = await prisma.lead.findFirst({
        where: { tenantId: fixtureA.tenant.id, primaryPhone: triggerPhone },
        include: { enquiries: true },
      });
      expect(createdLead).toBeDefined();
      expect(createdLead?.enquiries.length).toBe(1);

      // Verify BOTH the FAILED event and the PROCESSED event exist for this externalEventId
      const events = await prisma.portalWebhookEvent.findMany({
        where: { tenantId: fixtureA.tenant.id, externalEventId },
        orderBy: { createdAt: "asc" },
      });
      expect(events.length).toBe(2);
      expect(events[0].status).toBe(WebhookProcessingStatus.FAILED);
      expect(events[1].status).toBe(WebhookProcessingStatus.PROCESSED);
    } finally {
      // Clean up temporary PostgreSQL trigger and function
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS trg_test_portal_rollback ON enquiries;
      `);
      await prisma.$executeRawUnsafe(`
        DROP FUNCTION IF EXISTS test_fail_portal_enquiry();
      `);
    }
  });

  it("14. Unrelated unique constraint errors propagate and are not converted into duplicate deliveries", async () => {
    // Inject a trigger that raises an error on an unrelated constraint
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_unrelated_constraint()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW."name" = 'FAIL_UNRELATED_CONSTRAINT' THEN
          RAISE EXCEPTION 'Unique constraint failed on the fields: (unrelated_key)';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS trg_test_unrelated_constraint ON leads;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_test_unrelated_constraint
      BEFORE INSERT ON leads
      FOR EACH ROW EXECUTE FUNCTION test_fail_unrelated_constraint();
    `);

    try {
      await expect(
        ingestPortalLead({
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
          payload: {
            externalEventId: "unrelated_constraint_evt",
            name: "FAIL_UNRELATED_CONSTRAINT",
            mobile: "9810077112",
            city: "Gurugram",
            preference: "SALE",
          },
        })
      ).rejects.toThrow(/unrelated_key/);
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS trg_test_unrelated_constraint ON leads;
      `);
      await prisma.$executeRawUnsafe(`
        DROP FUNCTION IF EXISTS test_fail_unrelated_constraint();
      `);
    }
  });

  it("15. Best-effort failure logging: persistence failure of FAILED event does not mask original error", async () => {
    // Inject trigger on enquiries causing original error
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_original_error()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW."advertisedPropertyRef" = 'FAIL_ORIGINAL_ERROR' THEN
          RAISE EXCEPTION 'The original transaction error';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS trg_test_fail_original ON enquiries;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_test_fail_original
      BEFORE INSERT ON enquiries
      FOR EACH ROW EXECUTE FUNCTION test_fail_original_error();
    `);

    // Inject trigger on portal_webhook_events failing when status = FAILED
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_webhook_event()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.status = 'FAILED' AND NEW."eventAction" = 'PORTAL_INGESTION_FAILED' THEN
          RAISE EXCEPTION 'Simulated failure recording error';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS trg_test_fail_webhook_event ON portal_webhook_events;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_test_fail_webhook_event
      BEFORE INSERT ON portal_webhook_events
      FOR EACH ROW EXECUTE FUNCTION test_fail_webhook_event();
    `);

    try {
      // Must rethrow 'The original transaction error', NOT 'Simulated failure recording error'
      await expect(
        ingestPortalLead({
          tenantId: fixtureA.tenant.id,
          provider: PortalProvider.NINETY_NINE_ACRES,
          payload: {
            externalEventId: "masking_test_evt",
            name: "Masking Prospect",
            mobile: "9810099443",
            city: "Gurugram",
            preference: "SALE",
            advertisedPropertyRef: "FAIL_ORIGINAL_ERROR",
          },
        })
      ).rejects.toThrow(/The original transaction error/);
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS trg_test_fail_original ON enquiries;
      `);
      await prisma.$executeRawUnsafe(`
        DROP FUNCTION IF EXISTS test_fail_original_error();
      `);
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS trg_test_fail_webhook_event ON portal_webhook_events;
      `);
      await prisma.$executeRawUnsafe(`
        DROP FUNCTION IF EXISTS test_fail_webhook_event();
      `);
    }
  });
});
