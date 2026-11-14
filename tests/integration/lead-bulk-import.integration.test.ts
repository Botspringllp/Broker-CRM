import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  PrismaClient,
  UserRole,
  TransactionType,
  PropertyType,
  LeadStatus,
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

  it("2. Handles existing buyer: attaches new Enquiry to existing Lead without creating duplicate Lead", async () => {
    const userA = await createTestUser(prisma, fixtureA.tenant.id, {
      role: UserRole.BROKER_OWNER,
    });
    const contextA = createTestContext(userA);

    // Seed existing lead in INACTIVE status
    const existingLead = await createTestLead(prisma, fixtureA.tenant.id, {
      name: "Existing Buyer Ramesh",
      primaryPhone: "9810022334",
    });

    await prisma.lead.update({
      where: { id: existingLead.id },
      data: { status: LeadStatus.INACTIVE, isDoNotContact: false },
    });

    const rows: ValidatedLeadRow[] = [
      {
        rowNumber: 2,
        name: "Existing Buyer Ramesh",
        primaryPhone: "9810022334",
        source: "Magicbricks",
        preference: TransactionType.SALE,
        city: "Gurugram",
        localities: ["Sector 43"],
        societies: [],
        bedroomConfigurations: ["2 BHK"],
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

    // Verify no duplicate lead was created
    const leadsWithPhone = await prisma.lead.findMany({
      where: {
        tenantId: fixtureA.tenant.id,
        primaryPhone: "9810022334",
      },
    });
    expect(leadsWithPhone.length).toBe(1);

    // Verify lead was reopened to NOT_YET_VALIDATED
    const updatedLead = await prisma.lead.findUnique({
      where: { id: existingLead.id },
      include: {
        enquiries: true,
        changeLogs: true,
      },
    });
    expect(updatedLead?.status).toBe(LeadStatus.NOT_YET_VALIDATED);
    expect(updatedLead?.enquiries.length).toBe(1);
    expect(updatedLead?.enquiries[0].source).toBe("Magicbricks");
    expect(updatedLead?.enquiries[0].enquiryDetails).toContain("Looking again after 3 months");
    expect(updatedLead?.changeLogs.some((c) => c.fieldName === "status")).toBe(true);
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

  it("6. Proves complete transaction rollback: when database failure occurs, no partial writes persist", async () => {
    const userA = await createTestUser(prisma, fixtureA.tenant.id, {
      role: UserRole.BROKER_OWNER,
    });
    const contextA = createTestContext(userA);

    const rollbackPhone1 = "9810066778";
    const rollbackPhone2 = "9810077889";

    // Row 1 is valid, Row 2 has invalid data that causes a database error (or invalid row with skipInvalidRows: false)
    const rows: ValidatedLeadRow[] = [
      {
        rowNumber: 2,
        name: "Rollback Prospect 1",
        primaryPhone: rollbackPhone1,
        source: "Direct",
        preference: TransactionType.SALE,
        city: "Gurugram",
        localities: ["Sector 54"],
        societies: [],
        bedroomConfigurations: ["2 BHK"],
        propertyTypes: [PropertyType.APARTMENT],
        minBudget: 10000000,
        maxBudget: 15000000,
        areaUnit: "sq.ft",
        isValid: true,
        errors: [],
      },
      {
        rowNumber: 3,
        name: "Rollback Prospect 2",
        primaryPhone: rollbackPhone2,
        source: "Direct",
        preference: TransactionType.SALE,
        city: "Gurugram",
        localities: [],
        societies: [],
        bedroomConfigurations: [],
        propertyTypes: [],
        minBudget: 0,
        maxBudget: 0,
        isValid: false,
        errors: ["Mandatory fields missing"],
      },
    ];

    // With skipInvalidRows: false, row 2 will cause executeBulkLeadImport to reject
    await expect(
      executeBulkLeadImport(contextA, { rows, skipInvalidRows: false })
    ).rejects.toThrow();

    // Verify row 1 was completely rolled back and does NOT exist in PostgreSQL
    const lead1 = await prisma.lead.findFirst({
      where: { tenantId: fixtureA.tenant.id, primaryPhone: rollbackPhone1 },
    });
    expect(lead1).toBeNull();
  });
});
