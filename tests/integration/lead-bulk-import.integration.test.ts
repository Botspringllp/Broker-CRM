import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  PrismaClient,
  UserRole,
  TransactionType,
  PropertyType,
  LeadStatus,
  CallTargetType,
  Prisma,
} from "@prisma/client";
import { getTestPrisma, disconnectTestDb } from "./helpers/db-client";
import {
  createTestTenant,
  createTestUser,
  createTestContext,
  createTestLead,
  TestTenantFixture,
} from "./helpers/tenant-helper";
import {
  executeBulkLeadImport,
  ValidatedLeadRow,
} from "@/server/dal/lead-bulk-import";

describe("Live PostgreSQL Integration: Demand Bulk Lead Upload", () => {
  let prisma: PrismaClient;
  let fixtureA: TestTenantFixture;
  let fixtureB: TestTenantFixture;

  beforeAll(async () => {
    prisma = await getTestPrisma();
    fixtureA = await createTestTenant(prisma, "Bulk Import Broker Alpha");
    fixtureB = await createTestTenant(prisma, "Bulk Import Broker Beta");
  });

  afterAll(async () => {
    await fixtureA?.cleanup();
    await fixtureB?.cleanup();
    await disconnectTestDb();
  });

  it("1. Successfully creates real leads, requirements, localities, and initial enquiries in PostgreSQL", async () => {
    const userA = await createTestUser(prisma, fixtureA.tenant.id, {
      role: UserRole.BROKER_OWNER,
    });
    // Create an active telecaller for round-robin assignment
    await createTestUser(prisma, fixtureA.tenant.id, {
      role: UserRole.TELECALLER,
      name: "Telecaller Alpha 1",
    });

    const contextA = createTestContext(userA);

    const rows: ValidatedLeadRow[] = [
      {
        rowNumber: 2,
        name: "Aakash Mehta",
        primaryPhone: "9810011223",
        alternatePhone: "9810011224",
        email: "aakash.mehta@example.com",
        source: "99acres",
        preference: TransactionType.SALE,
        city: "Gurugram",
        localities: ["Sector 54", "Golf Course Road"],
        societies: ["DLF Magnolias"],
        bedroomConfigurations: ["3 BHK", "4 BHK"],
        propertyTypes: [PropertyType.APARTMENT],
        minBudget: 25000000,
        maxBudget: 45000000,
        areaUnit: "sq.ft",
        targetArea: 3200,
        enquiryNotes: "Interested in park-facing properties",
        isValid: true,
        errors: [],
      },
    ];

    const result = await executeBulkLeadImport(contextA, { rows });

    expect(result.success).toBe(true);
    expect(result.newLeadsCreated).toBe(1);
    expect(result.enquiriesAttached).toBe(0);

    // Verify database record
    const createdLead = await prisma.lead.findFirst({
      where: {
        tenantId: fixtureA.tenant.id,
        primaryPhone: "9810011223",
      },
      include: {
        requirement: {
          include: {
            localities: {
              include: { locality: true },
            },
          },
        },
        enquiries: true,
        assignments: true,
      },
    });

    expect(createdLead).not.toBeNull();
    expect(createdLead?.name).toBe("Aakash Mehta");
    expect(createdLead?.status).toBe(LeadStatus.NOT_YET_VALIDATED);
    expect(createdLead?.assignedTelecallerId).not.toBeNull();
    expect(createdLead?.requirement).not.toBeNull();
    expect(createdLead?.requirement?.city).toBe("Gurugram");
    expect(createdLead?.requirement?.preference).toBe(TransactionType.SALE);
    expect(createdLead?.requirement?.localities.length).toBe(2);
    expect(createdLead?.enquiries.length).toBe(1);
    expect(createdLead?.enquiries[0].source).toBe("99acres");
    expect(createdLead?.enquiries[0].enquiryDetails).toContain("Interested in park-facing properties");
  });

  it("2. Handles existing buyer: attaches new Enquiry to existing Lead without creating duplicate Lead and preserves all original buyer profile attributes", async () => {
    const userA = await createTestUser(prisma, fixtureA.tenant.id, {
      role: UserRole.BROKER_OWNER,
    });
    const telecallerA = await createTestUser(prisma, fixtureA.tenant.id, {
      role: UserRole.TELECALLER,
      name: "Assigned Telecaller Ramesh",
    });
    const contextA = createTestContext(userA);

    // Seed locality for existing requirement
    const seededLocality = await prisma.locality.create({
      data: {
        tenantId: fixtureA.tenant.id,
        city: "Gurugram",
        name: "Sector 29 Market",
      },
    });

    const customSourceCreatedAt = new Date("2026-06-15T09:30:00.000Z");
    const originalCreatedAt = new Date("2026-06-15T10:00:00.000Z");
    const existingPhone = "9810022334";
    const originalSource = "99ACRES";

    // Seed existing lead with rich existing profile:
    // originalSource, custom sourceCreatedAt, assigned telecaller, call logs, unreachable count, requirements + locality, DNC=false, INACTIVE
    const existingLead = await prisma.lead.create({
      data: {
        tenantId: fixtureA.tenant.id,
        name: "Existing Buyer Ramesh",
        primaryPhone: existingPhone,
        originalSource,
        sourceCreatedAt: customSourceCreatedAt,
        createdAt: originalCreatedAt,
        assignedTelecallerId: telecallerA.id,
        unreachableAttemptsCount: 3,
        status: LeadStatus.INACTIVE,
        isDoNotContact: false,
        requirement: {
          create: {
            tenantId: fixtureA.tenant.id,
            city: "Gurugram",
            preference: TransactionType.SALE,
            minBudget: new Prisma.Decimal(5000000),
            maxBudget: new Prisma.Decimal(8000000),
            bedroomConfigurations: ["2 BHK"],
            propertyTypes: [PropertyType.APARTMENT],
            localities: {
              create: {
                tenantId: fixtureA.tenant.id,
                localityId: seededLocality.id,
              },
            },
          },
        },
        callLogs: {
          create: {
            tenantId: fixtureA.tenant.id,
            callerId: telecallerA.id,
            callType: CallTargetType.LEAD_VALIDATION,
            notes: "Prior outreach call notes",
          },
        },
      },
    });

    const rows: ValidatedLeadRow[] = [
      {
        rowNumber: 2,
        name: "Existing Buyer Ramesh Updated Name",
        primaryPhone: existingPhone,
        source: "Magicbricks",
        preference: TransactionType.SALE,
        city: "Gurugram",
        localities: ["Sector 43"],
        societies: [],
        bedroomConfigurations: ["3 BHK"],
        propertyTypes: [PropertyType.APARTMENT],
        minBudget: 10000000,
        maxBudget: 15000000,
        areaUnit: "sq.ft",
        enquiryNotes: "Looking again after 3 months",
        isValid: true,
        errors: [],
        isExistingBuyer: true,
      },
    ];

    const result = await executeBulkLeadImport(contextA, { rows });

    expect(result.success).toBe(true);
    expect(result.newLeadsCreated).toBe(0);
    expect(result.enquiriesAttached).toBe(1);

    // 1. Verify no duplicate lead was created in PostgreSQL
    const leadsWithPhone = await prisma.lead.findMany({
      where: {
        tenantId: fixtureA.tenant.id,
        primaryPhone: existingPhone,
      },
    });
    expect(leadsWithPhone.length).toBe(1);

    // 2. Fetch updated lead with all associated entities
    const updatedLead = await prisma.lead.findUnique({
      where: { id: existingLead.id },
      include: {
        enquiries: true,
        changeLogs: true,
        callLogs: true,
        requirement: {
          include: {
            localities: {
              include: { locality: true },
            },
          },
        },
      },
    });

    // 3. Explicit Buyer Preservation Assertions:
    // A: primaryPhone unchanged
    expect(updatedLead?.primaryPhone).toBe(existingPhone);
    // B: originalSource unchanged (remains 99ACRES, NOT overwritten by Magicbricks)
    expect(updatedLead?.originalSource).toBe(originalSource);
    // C: sourceCreatedAt and createdAt unchanged
    expect(updatedLead?.sourceCreatedAt?.toISOString()).toBe(customSourceCreatedAt.toISOString());
    expect(updatedLead?.createdAt.toISOString()).toBe(originalCreatedAt.toISOString());
    // D: assignedTelecallerId unchanged
    expect(updatedLead?.assignedTelecallerId).toBe(telecallerA.id);
    // E: unreachableAttemptsCount unchanged
    expect(updatedLead?.unreachableAttemptsCount).toBe(3);
    // F: Existing call logs unchanged
    expect(updatedLead?.callLogs.length).toBe(1);
    expect(updatedLead?.callLogs[0].callerId).toBe(telecallerA.id);
    expect(updatedLead?.callLogs[0].notes).toBe("Prior outreach call notes");
    // G: Existing requirements unchanged
    expect(updatedLead?.requirement?.city).toBe("Gurugram");
    expect(updatedLead?.requirement?.minBudget.toNumber()).toBe(5000000);
    expect(updatedLead?.requirement?.maxBudget.toNumber()).toBe(8000000);
    expect(updatedLead?.requirement?.localities.length).toBe(1);
    expect(updatedLead?.requirement?.localities[0].locality.name).toBe("Sector 29 Market");
    // H: Only permitted status transition occurred (INACTIVE -> NOT_YET_VALIDATED)
    expect(updatedLead?.status).toBe(LeadStatus.NOT_YET_VALIDATED);
    expect(
      updatedLead?.changeLogs.some(
        (c) =>
          c.fieldName === "status" &&
          c.previousValue === "INACTIVE" &&
          c.newValue === "NOT_YET_VALIDATED"
      )
    ).toBe(true);
    // I: New Enquiry linked to the original Lead
    expect(updatedLead?.enquiries.length).toBe(1);
    expect(updatedLead?.enquiries[0].source).toBe("Magicbricks");
    expect(updatedLead?.enquiries[0].enquiryDetails).toContain("Looking again after 3 months");
  });

  it("3. Enforces DNC protection: does NOT reopen INACTIVE lead if isDoNotContact is true", async () => {
    const userA = await createTestUser(prisma, fixtureA.tenant.id, {
      role: UserRole.BROKER_OWNER,
    });
    const contextA = createTestContext(userA);

    const dncLead = await createTestLead(prisma, fixtureA.tenant.id, {
      name: "DNC Customer Suresh",
      primaryPhone: "9810033445",
    });

    await prisma.lead.update({
      where: { id: dncLead.id },
      data: { status: LeadStatus.INACTIVE, isDoNotContact: true },
    });

    const rows: ValidatedLeadRow[] = [
      {
        rowNumber: 2,
        name: "DNC Customer Suresh",
        primaryPhone: "9810033445",
        source: "Walk-in",
        preference: TransactionType.RENT,
        city: "Gurugram",
        localities: ["Sector 54"],
        societies: [],
        bedroomConfigurations: ["1 BHK"],
        propertyTypes: [PropertyType.APARTMENT],
        minBudget: 25000,
        maxBudget: 35000,
        areaUnit: "sq.ft",
        isValid: true,
        errors: [],
        isExistingBuyer: true,
      },
    ];

    const result = await executeBulkLeadImport(contextA, { rows });

    expect(result.success).toBe(true);
    expect(result.enquiriesAttached).toBe(1);

    // Verify lead status remained INACTIVE
    const refreshed = await prisma.lead.findUnique({
      where: { id: dncLead.id },
    });
    expect(refreshed?.status).toBe(LeadStatus.INACTIVE);
    expect(refreshed?.isDoNotContact).toBe(true);
  });

  it("4. Strictly enforces Tenant A/B boundary isolation: same mobile across tenants creates independent leads", async () => {
    const userA = await createTestUser(prisma, fixtureA.tenant.id, {
      role: UserRole.BROKER_OWNER,
    });
    const userB = await createTestUser(prisma, fixtureB.tenant.id, {
      role: UserRole.BROKER_OWNER,
    });

    const contextA = createTestContext(userA);
    const contextB = createTestContext(userB);

    const sharedMobile = "9810044556";

    // Tenant A imports lead
    const rowsA: ValidatedLeadRow[] = [
      {
        rowNumber: 2,
        name: "Shared Client Tenant A",
        primaryPhone: sharedMobile,
        source: "Direct",
        preference: TransactionType.SALE,
        city: "Gurugram",
        localities: ["Sector 54"],
        societies: [],
        bedroomConfigurations: ["3 BHK"],
        propertyTypes: [PropertyType.APARTMENT],
        minBudget: 15000000,
        maxBudget: 25000000,
        areaUnit: "sq.ft",
        isValid: true,
        errors: [],
      },
    ];
    await executeBulkLeadImport(contextA, { rows: rowsA });

    // Tenant B imports lead with exact same phone number
    const rowsB: ValidatedLeadRow[] = [
      {
        rowNumber: 2,
        name: "Shared Client Tenant B",
        primaryPhone: sharedMobile,
        source: "Magicbricks",
        preference: TransactionType.RENT,
        city: "Noida",
        localities: ["Sector 43"],
        societies: [],
        bedroomConfigurations: ["2 BHK"],
        propertyTypes: [PropertyType.APARTMENT],
        minBudget: 35000,
        maxBudget: 45000,
        areaUnit: "sq.ft",
        isValid: true,
        errors: [],
      },
    ];
    const resultB = await executeBulkLeadImport(contextB, { rows: rowsB });

    // Tenant B must create a brand new lead in Tenant B, not treat as existing buyer of Tenant A
    expect(resultB.newLeadsCreated).toBe(1);
    expect(resultB.enquiriesAttached).toBe(0);

    const leadInA = await prisma.lead.findFirst({
      where: { tenantId: fixtureA.tenant.id, primaryPhone: sharedMobile },
    });
    const leadInB = await prisma.lead.findFirst({
      where: { tenantId: fixtureB.tenant.id, primaryPhone: sharedMobile },
    });

    expect(leadInA).not.toBeNull();
    expect(leadInB).not.toBeNull();
    expect(leadInA?.id).not.toBe(leadInB?.id);
    expect(leadInA?.tenantId).toBe(fixtureA.tenant.id);
    expect(leadInB?.tenantId).toBe(fixtureB.tenant.id);
    expect(leadInA?.name).toBe("Shared Client Tenant A");
    expect(leadInB?.name).toBe("Shared Client Tenant B");
  });

  it("5. Handles intra-batch duplicate phones: Row 1 creates new Lead, Row 2 attaches as Enquiry", async () => {
    const userA = await createTestUser(prisma, fixtureA.tenant.id, {
      role: UserRole.BROKER_OWNER,
    });
    const contextA = createTestContext(userA);

    const intraBatchMobile = "9810055667";

    const rows: ValidatedLeadRow[] = [
      {
        rowNumber: 2,
        name: "Intra Batch Prospect",
        primaryPhone: intraBatchMobile,
        source: "99acres",
        preference: TransactionType.SALE,
        city: "Gurugram",
        localities: ["Sector 54"],
        societies: [],
        bedroomConfigurations: ["2 BHK"],
        propertyTypes: [PropertyType.APARTMENT],
        minBudget: 10000000,
        maxBudget: 15000000,
        areaUnit: "sq.ft",
        enquiryNotes: "First inquiry in batch",
        isValid: true,
        errors: [],
      },
      {
        rowNumber: 3,
        name: "Intra Batch Prospect",
        primaryPhone: intraBatchMobile,
        source: "Magicbricks",
        preference: TransactionType.SALE,
        city: "Gurugram",
        localities: ["DLF Phase 5"],
        societies: [],
        bedroomConfigurations: ["3 BHK"],
        propertyTypes: [PropertyType.APARTMENT],
        minBudget: 20000000,
        maxBudget: 30000000,
        areaUnit: "sq.ft",
        enquiryNotes: "Second inquiry in batch",
        isValid: true,
        errors: [],
        isInternalDuplicate: true,
        isExistingBuyer: true,
      },
    ];

    const result = await executeBulkLeadImport(contextA, { rows });

    expect(result.success).toBe(true);
    expect(result.newLeadsCreated).toBe(1);
    expect(result.enquiriesAttached).toBe(1);

    const leads = await prisma.lead.findMany({
      where: { tenantId: fixtureA.tenant.id, primaryPhone: intraBatchMobile },
      include: { enquiries: true },
    });
    expect(leads.length).toBe(1);
    expect(leads[0].enquiries.length).toBe(2);
  });

  it("6. Proves complete transaction rollback: when database failure occurs mid-transaction, all prior writes are completely rolled back", async () => {
    // Dedicated fixture ensuring zero pre-existing or post-test residual records across all tables
    const fixtureRollback = await createTestTenant(prisma, "Rollback Test Broker");

    const rollbackPhone = "9810066778";
    const uniqueLocalityName = `Sector Rollback ${Date.now()}`;

    const triggerName = `trg_fail_assignment_${fixtureRollback.tenant.id.replace(/-/g, "_")}`;
    const funcName = `fn_fail_assignment_${fixtureRollback.tenant.id.replace(/-/g, "_")}`;

    try {
      const userRollback = await createTestUser(prisma, fixtureRollback.tenant.id, {
        role: UserRole.BROKER_OWNER,
      });
      // Active telecaller ensures assignment step is reached
      await createTestUser(prisma, fixtureRollback.tenant.id, {
        role: UserRole.TELECALLER,
        name: "Telecaller Rollback",
      });
      const contextRollback = createTestContext(userRollback);

      // 1. All input rows must pass initial JavaScript validation (no validation errors)
      const rows: ValidatedLeadRow[] = [
        {
          rowNumber: 2,
          name: "Rollback Prospect",
          primaryPhone: rollbackPhone,
          source: "Direct Portal",
          preference: TransactionType.SALE,
          city: "Gurugram",
          localities: [uniqueLocalityName],
          societies: [],
          bedroomConfigurations: ["2 BHK"],
          propertyTypes: [PropertyType.APARTMENT],
          minBudget: 10000000,
          maxBudget: 15000000,
          areaUnit: "sq.ft",
          enquiryNotes: "Should be completely rolled back",
          isValid: true,
          errors: [],
        },
      ];

      // 2. Inject deterministic PostgreSQL-level trigger on assignments scoped to fixtureRollback.tenant.id
      // In executeBulkLeadImport, tx.lead.create writes lead + requirement + enquiry first,
      // and then recordLeadAssignmentTx inserts into assignments.
      // Raising an exception here forces rollback AFTER multiple prior database writes occurred.
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION ${funcName}() RETURNS TRIGGER AS $$
        BEGIN
          IF NEW."tenantId" = '${fixtureRollback.tenant.id}' THEN
            RAISE EXCEPTION 'Simulated failure during assignment insertion for rollback test';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON assignments
        FOR EACH ROW EXECUTE FUNCTION ${funcName}();
      `);

      // 3. Invoke actual executeBulkLeadImport DAL function - MUST reject due to PostgreSQL trigger
      await expect(
        executeBulkLeadImport(contextRollback, { rows })
      ).rejects.toThrow(/Simulated failure during assignment insertion/);

      // 4. Verify PostgreSQL transaction atomicity guarantees: zero partial records persisted
      // A: leads table has zero records
      const leads = await prisma.lead.findMany({
        where: { tenantId: fixtureRollback.tenant.id },
      });
      expect(leads.length).toBe(0);

      // B: enquiries table has zero records
      const enquiries = await prisma.enquiry.findMany({
        where: { tenantId: fixtureRollback.tenant.id },
      });
      expect(enquiries.length).toBe(0);

      // C: lead_requirements table has zero records
      const requirements = await prisma.leadRequirement.findMany({
        where: { tenantId: fixtureRollback.tenant.id },
      });
      expect(requirements.length).toBe(0);

      // D: lead_requirement_localities table has zero records
      const reqLocalities = await prisma.leadRequirementLocality.findMany({
        where: { tenantId: fixtureRollback.tenant.id },
      });
      expect(reqLocalities.length).toBe(0);

      // E: assignments table has zero records
      const assignments = await prisma.assignment.findMany({
        where: { tenantId: fixtureRollback.tenant.id },
      });
      expect(assignments.length).toBe(0);

      // F: lead_change_logs table has zero records
      const changeLogs = await prisma.leadChangeLog.findMany({
        where: { tenantId: fixtureRollback.tenant.id },
      });
      expect(changeLogs.length).toBe(0);

      // G: localities created exclusively by the failed import has zero records
      const localities = await prisma.locality.findMany({
        where: {
          tenantId: fixtureRollback.tenant.id,
          name: uniqueLocalityName,
        },
      });
      expect(localities.length).toBe(0);
    } finally {
      // 5. Ensure trigger and function are dropped safely in cleanup
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON assignments;`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${funcName}();`);
      await fixtureRollback.cleanup();
    }
  });

  it("7. Safely handles concurrent bulk imports with overlapping mobile numbers without duplicate leads or lost enquiries", async () => {
    const fixtureConcA = await createTestTenant(prisma, "Concurrent Tenant Alpha");
    const fixtureConcB = await createTestTenant(prisma, "Concurrent Tenant Beta");

    try {
      const userA = await createTestUser(prisma, fixtureConcA.tenant.id, {
        role: UserRole.BROKER_OWNER,
      });
      await createTestUser(prisma, fixtureConcA.tenant.id, {
        role: UserRole.TELECALLER,
        name: "Telecaller Alpha Conc",
      });
      const contextA = createTestContext(userA);

      const userB = await createTestUser(prisma, fixtureConcB.tenant.id, {
        role: UserRole.BROKER_OWNER,
      });
      await createTestUser(prisma, fixtureConcB.tenant.id, {
        role: UserRole.TELECALLER,
        name: "Telecaller Beta Conc",
      });
      const contextB = createTestContext(userB);

      const sharedPhone = "9811199988";

      const batchA1: ValidatedLeadRow[] = [
        {
          rowNumber: 2,
          name: "Concurrent Prospect Alpha 1",
          primaryPhone: sharedPhone,
          source: "Website Direct",
          preference: TransactionType.SALE,
          city: "Gurugram",
          localities: ["Sector 57"],
          societies: [],
          bedroomConfigurations: ["3 BHK"],
          propertyTypes: [PropertyType.APARTMENT],
          minBudget: 15000000,
          maxBudget: 20000000,
          areaUnit: "sq.ft",
          enquiryNotes: "Batch 1 enquiry for 3BHK",
          isValid: true,
          errors: [],
        },
      ];

      const batchA2: ValidatedLeadRow[] = [
        {
          rowNumber: 2,
          name: "Concurrent Prospect Alpha 2",
          primaryPhone: sharedPhone,
          source: "Magicbricks",
          preference: TransactionType.SALE,
          city: "Gurugram",
          localities: ["Sector 57"],
          societies: [],
          bedroomConfigurations: ["3 BHK"],
          propertyTypes: [PropertyType.APARTMENT],
          minBudget: 16000000,
          maxBudget: 22000000,
          areaUnit: "sq.ft",
          enquiryNotes: "Batch 2 enquiry for 3BHK high floor",
          isValid: true,
          errors: [],
        },
      ];

      const batchB: ValidatedLeadRow[] = [
        {
          rowNumber: 2,
          name: "Tenant Beta Prospect",
          primaryPhone: sharedPhone,
          source: "Housing.com",
          preference: TransactionType.RENT,
          city: "Delhi",
          localities: ["Vasant Kunj"],
          societies: [],
          bedroomConfigurations: ["2 BHK"],
          propertyTypes: [PropertyType.APARTMENT],
          minBudget: 40000,
          maxBudget: 60000,
          areaUnit: "sq.ft",
          enquiryNotes: "Beta rental enquiry",
          isValid: true,
          errors: [],
        },
      ];

      // Execute all three imports concurrently
      const [resA1, resA2, resB] = await Promise.all([
        executeBulkLeadImport(contextA, { rows: batchA1 }),
        executeBulkLeadImport(contextA, { rows: batchA2 }),
        executeBulkLeadImport(contextB, { rows: batchB }),
      ]);

      // 1. Both same-tenant imports succeed
      expect(resA1.success).toBe(true);
      expect(resA2.success).toBe(true);
      expect(resB.success).toBe(true);

      // 2. Truthful reporting: exactly one created the lead, the other linked an enquiry
      expect(resA1.newLeadsCreated + resA2.newLeadsCreated).toBe(1);
      expect(resA1.enquiriesAttached + resA2.enquiriesAttached).toBe(1);

      // 3. Exactly one Lead exists in Tenant Alpha for the shared phone
      const alphaLeads = await prisma.lead.findMany({
        where: {
          tenantId: fixtureConcA.tenant.id,
          primaryPhone: sharedPhone,
        },
        include: {
          enquiries: true,
          requirement: true,
        },
      });
      expect(alphaLeads.length).toBe(1);

      // 4. Both valid incoming enquiries are represented on Tenant Alpha's lead
      expect(alphaLeads[0].enquiries.length).toBe(2);
      const alphaEnquirySources = alphaLeads[0].enquiries.map((e) => e.source);
      expect(alphaEnquirySources).toContain("Website Direct");
      expect(alphaEnquirySources).toContain("Magicbricks");

      // 5. Tenant Beta has exactly one independent lead with the same phone (strict multi-tenant isolation)
      expect(resB.newLeadsCreated).toBe(1);
      const betaLeads = await prisma.lead.findMany({
        where: {
          tenantId: fixtureConcB.tenant.id,
          primaryPhone: sharedPhone,
        },
        include: {
          enquiries: true,
        },
      });
      expect(betaLeads.length).toBe(1);
      expect(betaLeads[0].id).not.toBe(alphaLeads[0].id);
      expect(betaLeads[0].tenantId).toBe(fixtureConcB.tenant.id);
      expect(betaLeads[0].enquiries.length).toBe(1);
      expect(betaLeads[0].enquiries[0].source).toBe("Housing.com");
    } finally {
      await fixtureConcA?.cleanup();
      await fixtureConcB?.cleanup();
    }
  });
});
