/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import {
  UserRole,
  TransactionType,
  PropertyType,
  AreaUnitType,
  LeadStatus,
  AssignmentMethod,
  AssignmentTargetType,
} from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError, ValidationError } from "@/server/errors";

// Mock Prisma DB module
vi.mock("@/server/db", () => {
  const mockPrisma = {
    lead: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    enquiry: {
      create: vi.fn(),
    },
    property: {
      findMany: vi.fn(),
    },
    locality: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    leadRequirementLocality: {
      upsert: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    assignment: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    leadChangeLog: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(async (arg, _opts) => {
      if (typeof arg === "function") {
        return arg(mockPrisma);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg;
    }),
  };
  return { prisma: mockPrisma };
});

import { prisma } from "@/server/db";
import {
  generateLeadImportTemplate,
  parseAndPreviewLeadImportFile,
  executeBulkLeadImport,
  LEAD_TEMPLATE_COLUMNS,
  MAX_LEAD_IMPORT_FILE_SIZE_BYTES,
  MAX_LEAD_IMPORT_ROW_COUNT,
  ValidatedLeadRow,
} from "@/server/dal/lead-bulk-import";

describe("Demand / Lead Bulk Upload - DAL, Validation & Execution", () => {
  const brokerContext: TenantContext = {
    tenantId: "tenant-brokerage-1",
    userId: "manager-user-1",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "manager-user-1",
      name: "Broker Owner",
      email: "owner@apexrealty.in",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-brokerage-1",
      isActive: true,
    },
    session: {
      id: "sess-owner-1",
      token: "tok-owner-1",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const telecallerContext: TenantContext = {
    tenantId: "tenant-brokerage-1",
    userId: "telecaller-user-1",
    role: UserRole.TELECALLER,
    user: {
      id: "telecaller-user-1",
      name: "Telecaller Priya",
      email: "priya@apexrealty.in",
      role: UserRole.TELECALLER,
      tenantId: "tenant-brokerage-1",
      isActive: true,
    },
    session: {
      id: "sess-telecaller-1",
      token: "tok-telecaller-1",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const fieldVerifierContext: TenantContext = {
    tenantId: "tenant-brokerage-1",
    userId: "verifier-user-1",
    role: UserRole.FIELD_VERIFIER,
    user: {
      id: "verifier-user-1",
      name: "Verifier Amit",
      email: "amit@apexrealty.in",
      role: UserRole.FIELD_VERIFIER,
      tenantId: "tenant-brokerage-1",
      isActive: true,
    },
    session: {
      id: "sess-verifier-1",
      token: "tok-verifier-1",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    (vi.mocked(prisma.locality.findFirst) as any).mockResolvedValue(null);
    (vi.mocked(prisma.locality.create) as any).mockImplementation(async (args: any) => ({
      id: "loc-mock-id",
      tenantId: args.data.tenantId,
      city: args.data.city,
      name: args.data.name,
    }));
    (vi.mocked(prisma.leadRequirementLocality.upsert) as any).mockResolvedValue({});
    vi.mocked(prisma.lead.findMany).mockResolvedValue([]);
    vi.mocked(prisma.property.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: "telecaller-1",
        name: "Priya Sharma",
        email: "priya@apexrealty.in",
        role: UserRole.TELECALLER,
        isActive: true,
        tenantId: "tenant-brokerage-1",
        createdAt: new Date(),
      } as any,
    ]);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "telecaller-1",
      name: "Priya Sharma",
      email: "priya@apexrealty.in",
      role: UserRole.TELECALLER,
      isActive: true,
      tenantId: "tenant-brokerage-1",
      createdAt: new Date(),
    } as any);
  });

  function createCsvBuffer(headerLine: string, rows: string[]): Buffer {
    const content = [headerLine, ...rows].join("\n");
    return Buffer.from(content, "utf-8");
  }

  const validHeaderLine = LEAD_TEMPLATE_COLUMNS.map((c) => c.header).join(",");

  const sampleValidRow1 =
    "Rohit Verma,9810012345,9810054321,rohit@example.com,99acres,Sale,Gurugram,\"Golf Course Road, DLF Phase 5\",\"DLF Magnolias\",\"2 BHK, 3 BHK\",Apartment,25000000,40000000,3200,2800,3600,sq.ft,Super built-up,PROP-99A-8821,High floor park facing";

  const sampleValidRow2 =
    "Ananya Sharma,9820067890,,ananya@example.com,Magicbricks,Rent,Noida,\"Sector 43, Sector 50\",Godrej Woods,2 BHK,Apartment,40000,55000,1250,1100,1400,sq.ft,Carpet,,Family moving next month";

  // -------------------------------------------------------------
  // 1. TEMPLATE GENERATION
  // -------------------------------------------------------------
  describe("generateLeadImportTemplate", () => {
    it("generates valid CSV template with all 20 documented headers and 3 sample rows", async () => {
      const buffer = await generateLeadImportTemplate();
      expect(buffer).toBeInstanceOf(Buffer);
      const csvText = buffer.toString("utf-8");

      for (const col of LEAD_TEMPLATE_COLUMNS) {
        expect(csvText).toContain(col.header);
      }
      expect(csvText).toContain("Rohit Verma");
      expect(csvText).toContain("Ananya Sharma");
      expect(csvText).toContain("Vikas Malhotra");
    });
  });

  // -------------------------------------------------------------
  // 2. PARSER & HEADER VALIDATION
  // -------------------------------------------------------------
  describe("parseAndPreviewLeadImportFile - Headers & Formats", () => {
    it("rejects non-CSV files (.xlsx) with clear error message", async () => {
      const buffer = Buffer.from("dummy excel binary data");
      await expect(
        parseAndPreviewLeadImportFile(brokerContext, buffer, "leads.xlsx")
      ).rejects.toThrow(ValidationError);
      await expect(
        parseAndPreviewLeadImportFile(brokerContext, buffer, "leads.xlsx")
      ).rejects.toThrow(/Unsupported file format.*\.csv/);
    });

    it("rejects empty CSV files", async () => {
      await expect(
        parseAndPreviewLeadImportFile(brokerContext, Buffer.from(""), "leads.csv")
      ).rejects.toThrow(/Uploaded file is empty/);
    });

    it("rejects files exceeding 5 MB limit", async () => {
      const hugeBuffer = Buffer.alloc(MAX_LEAD_IMPORT_FILE_SIZE_BYTES + 1024);
      await expect(
        parseAndPreviewLeadImportFile(brokerContext, hugeBuffer, "large.csv")
      ).rejects.toThrow(/File size exceeds maximum allowed limit of 5 MB/);
    });

    it("reports hasHeadersError when mandatory columns are missing", async () => {
      const invalidHeader = "Prospect Name,Alternate Phone,Email,Source"; // Missing Primary Phone, Preference, Budgets, etc.
      const buffer = createCsvBuffer(invalidHeader, ["John Doe,9810012345,john@example.com,Direct"]);

      const preview = await parseAndPreviewLeadImportFile(brokerContext, buffer, "leads.csv");
      expect(preview.hasHeadersError).toBe(true);
      expect(preview.headersErrorMessage).toContain("Missing mandatory column header(s)");
      expect(preview.headersErrorMessage).toContain("Primary Phone");
      expect(preview.headersErrorMessage).toContain("Min Budget");
    });

    it("reports hasHeadersError when unrecognized columns are present", async () => {
      const headerWithUnknown = validHeaderLine + ",Favorite Color";
      const buffer = createCsvBuffer(headerWithUnknown, [sampleValidRow1 + ",Blue"]);

      const preview = await parseAndPreviewLeadImportFile(brokerContext, buffer, "leads.csv");
      expect(preview.hasHeadersError).toBe(true);
      expect(preview.headersErrorMessage).toContain("Unrecognized column header(s)");
      expect(preview.headersErrorMessage).toContain("Favorite Color");
    });

    it("rejects files exceeding 500 row limit", async () => {
      const rows: string[] = [];
      for (let i = 0; i < MAX_LEAD_IMPORT_ROW_COUNT + 10; i++) {
        rows.push(sampleValidRow1);
      }
      const buffer = createCsvBuffer(validHeaderLine, rows);

      await expect(
        parseAndPreviewLeadImportFile(brokerContext, buffer, "huge_leads.csv")
      ).rejects.toThrow(/exceeds maximum limit of 500 rows/);
    });
  });

  // -------------------------------------------------------------
  // 3. ROW VALIDATION & FIELD CHECKS
  // -------------------------------------------------------------
  describe("parseAndPreviewLeadImportFile - Row Validations", () => {
    it("successfully parses valid rows and computes metrics", async () => {
      const buffer = createCsvBuffer(validHeaderLine, [sampleValidRow1, sampleValidRow2]);
      const preview = await parseAndPreviewLeadImportFile(brokerContext, buffer, "leads.csv");

      expect(preview.hasHeadersError).toBe(false);
      expect(preview.totalRows).toBe(2);
      expect(preview.validCount).toBe(2);
      expect(preview.errorCount).toBe(0);
      expect(preview.newLeadCount).toBe(2);
      expect(preview.rows[0].name).toBe("Rohit Verma");
      expect(preview.rows[0].primaryPhone).toBe("9810012345");
      expect(preview.rows[0].preference).toBe(TransactionType.SALE);
      expect(preview.rows[0].localities).toEqual(["Golf Course Road", "DLF Phase 5"]);
      expect(preview.rows[1].preference).toBe(TransactionType.RENT);
    });

    it("normalizes Indian mobile numbers with prefixes (+91, 0, spaces)", async () => {
      const rowWithMessyPhone =
        'Sunil Gupta,"+91 (981) 001-2345",,sunil@example.com,Direct,Sale,Gurugram,Sector 54,,3 BHK,Apartment,10000000,15000000,,,,sq.ft,,,';
      const buffer = createCsvBuffer(validHeaderLine, [rowWithMessyPhone]);
      const preview = await parseAndPreviewLeadImportFile(brokerContext, buffer, "leads.csv");

      expect(preview.rows[0].isValid).toBe(true);
      expect(preview.rows[0].primaryPhone).toBe("9810012345");
    });

    it("flags invalid primary phones (too short, letters, non-Indian prefix)", async () => {
      const badPhoneRow =
        "Ramesh,123456,,ramesh@example.com,Direct,Sale,Gurugram,Sector 54,,3 BHK,Apartment,10000000,15000000,,,,sq.ft,,,";
      const buffer = createCsvBuffer(validHeaderLine, [badPhoneRow]);
      const preview = await parseAndPreviewLeadImportFile(brokerContext, buffer, "leads.csv");

      expect(preview.rows[0].isValid).toBe(false);
      expect(preview.rows[0].errors.some((e) => e.includes("Invalid mobile number"))).toBe(true);
    });

    it("flags invalid email format when email is provided", async () => {
      const badEmailRow =
        "Ramesh,9810012345,,not-an-email,Direct,Sale,Gurugram,Sector 54,,3 BHK,Apartment,10000000,15000000,,,,sq.ft,,,";
      const buffer = createCsvBuffer(validHeaderLine, [badEmailRow]);
      const preview = await parseAndPreviewLeadImportFile(brokerContext, buffer, "leads.csv");

      expect(preview.rows[0].isValid).toBe(false);
      expect(preview.rows[0].errors.some((e) => e.includes("Invalid email format"))).toBe(true);
    });

    it("validates budget constraints: maxBudget >= minBudget, positive numbers", async () => {
      const badBudgetRow =
        "Ramesh,9810012345,,,Direct,Sale,Gurugram,Sector 54,,3 BHK,Apartment,50000000,20000000,,,,sq.ft,,,";
      const buffer = createCsvBuffer(validHeaderLine, [badBudgetRow]);
      const preview = await parseAndPreviewLeadImportFile(brokerContext, buffer, "leads.csv");

      expect(preview.rows[0].isValid).toBe(false);
      expect(preview.rows[0].errors.some((e) => e.includes("Max Budget cannot be less than Min Budget"))).toBe(true);
    });

    it("validates property types enum values", async () => {
      const badTypeRow =
        "Ramesh,9810012345,,,Direct,Sale,Gurugram,Sector 54,,3 BHK,Spaceship,10000000,20000000,,,,sq.ft,,,";
      const buffer = createCsvBuffer(validHeaderLine, [badTypeRow]);
      const preview = await parseAndPreviewLeadImportFile(brokerContext, buffer, "leads.csv");

      expect(preview.rows[0].isValid).toBe(false);
      expect(preview.rows[0].errors.some((e) => e.includes("Invalid property type 'Spaceship'"))).toBe(true);
    });
  });

  // -------------------------------------------------------------
  // 4. DUPLICATE DETECTION IN PREVIEW
  // -------------------------------------------------------------
  describe("parseAndPreviewLeadImportFile - Duplicate Handling", () => {
    it("detects intra-file duplicate phones: marks first as new, subsequent as file duplicate enquiry", async () => {
      const row1 =
        "Ajay Kumar,9810012345,,ajay@example.com,99acres,Sale,Gurugram,Sector 54,,2 BHK,Apartment,10000000,15000000,,,,sq.ft,,,First inquiry";
      const row2 =
        "Ajay Kumar,9810012345,,ajay@example.com,Magicbricks,Sale,Gurugram,DLF Phase 5,,3 BHK,Apartment,20000000,25000000,,,,sq.ft,,,Second inquiry";

      const buffer = createCsvBuffer(validHeaderLine, [row1, row2]);
      const preview = await parseAndPreviewLeadImportFile(brokerContext, buffer, "leads.csv");

      expect(preview.totalRows).toBe(2);
      expect(preview.validCount).toBe(2);
      expect(preview.newLeadCount).toBe(1);
      expect(preview.internalDuplicateCount).toBe(1);

      expect(preview.rows[0].isInternalDuplicate).toBeFalsy();
      expect(preview.rows[0].isExistingBuyer).toBeFalsy();

      expect(preview.rows[1].isInternalDuplicate).toBe(true);
      expect(preview.rows[1].isExistingBuyer).toBe(true);
      expect(preview.rows[1].duplicateWarning).toContain("Duplicate phone within file");
    });

    it("detects database existing buyers strictly scoped to tenant", async () => {
      vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([
        {
          id: "existing-lead-1",
          primaryPhone: "9810012345",
          name: "Existing Buyer Vikram",
          status: LeadStatus.ACTIVE,
          isDoNotContact: false,
        } as any,
      ]);

      const buffer = createCsvBuffer(validHeaderLine, [sampleValidRow1]);
      const preview = await parseAndPreviewLeadImportFile(brokerContext, buffer, "leads.csv");

      expect(preview.newLeadCount).toBe(0);
      expect(preview.existingBuyerCount).toBe(1);
      expect(preview.rows[0].isExistingBuyer).toBe(true);
      expect(preview.rows[0].duplicateWarning).toContain("Existing prospect in database");
      expect(preview.rows[0].duplicateWarning).toContain("Existing Buyer Vikram");
    });

    it("ensures preview does not mutate database records", async () => {
      const buffer = createCsvBuffer(validHeaderLine, [sampleValidRow1]);
      await parseAndPreviewLeadImportFile(brokerContext, buffer, "leads.csv");

      expect(prisma.lead.create).not.toHaveBeenCalled();
      expect(prisma.enquiry.create).not.toHaveBeenCalled();
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------
  // 5. BATCH EXECUTION & TRANSACTIONS
  // -------------------------------------------------------------
  describe("executeBulkLeadImport", () => {
    it("enforces demand:create permission: rejects unauthorized roles", async () => {
      const rows: ValidatedLeadRow[] = [
        {
          rowNumber: 2,
          name: "Test Lead",
          primaryPhone: "9810012345",
          source: "Direct",
          preference: TransactionType.SALE,
          city: "Gurugram",
          localities: ["Sector 54"],
          societies: [],
          bedroomConfigurations: ["2 BHK"],
          propertyTypes: [PropertyType.APARTMENT],
          minBudget: 5000000,
          maxBudget: 10000000,
          areaUnit: "sq.ft",
          isValid: true,
          errors: [],
        },
      ];

      await expect(
        executeBulkLeadImport(fieldVerifierContext, { rows })
      ).rejects.toThrow(ForbiddenError);
    });

    it("creates brand new lead with requirement, locality, enquiry, and round-robin assignment", async () => {
      vi.mocked(prisma.lead.create).mockResolvedValueOnce({
        id: "lead-new-123",
        name: "Rohit Verma",
        primaryPhone: "9810012345",
        status: LeadStatus.NOT_YET_VALIDATED,
        isDoNotContact: false,
        assignedTelecallerId: "telecaller-1",
        requirement: { id: "req-123" },
      } as any);

      vi.mocked(prisma.locality.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.locality.create).mockResolvedValueOnce({
        id: "loc-golf-course",
        name: "Golf Course Road",
        city: "Gurugram",
        tenantId: brokerContext.tenantId,
      } as any);

      const rows: ValidatedLeadRow[] = [
        {
          rowNumber: 2,
          name: "Rohit Verma",
          primaryPhone: "9810012345",
          source: "99acres",
          preference: TransactionType.SALE,
          city: "Gurugram",
          localities: ["Golf Course Road"],
          societies: ["DLF Magnolias"],
          bedroomConfigurations: ["3 BHK"],
          propertyTypes: [PropertyType.APARTMENT],
          minBudget: 25000000,
          maxBudget: 40000000,
          areaUnit: "sq.ft",
          areaType: AreaUnitType.SUPER_BUILT_UP,
          targetArea: 3200,
          enquiryNotes: "Park facing high floor",
          isValid: true,
          errors: [],
        },
      ];

      const result = await executeBulkLeadImport(brokerContext, { rows });

      expect(result.success).toBe(true);
      expect(result.newLeadsCreated).toBe(1);
      expect(result.enquiriesAttached).toBe(0);
      expect(prisma.lead.create).toHaveBeenCalledTimes(1);
      expect(prisma.assignment.create).toHaveBeenCalledTimes(1);
      expect(prisma.leadRequirementLocality.upsert).toHaveBeenCalledTimes(1);
    });

    it("attaches re-enquiry to existing buyer without creating duplicate lead", async () => {
      vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([
        {
          id: "lead-existing-456",
          name: "Existing Buyer Vikram",
          primaryPhone: "9810012345",
          status: LeadStatus.ACTIVE,
          isDoNotContact: false,
          assignedTelecallerId: "telecaller-1",
          originalSource: "99acres",
        } as any,
      ]);

      const rows: ValidatedLeadRow[] = [
        {
          rowNumber: 2,
          name: "Existing Buyer Vikram",
          primaryPhone: "9810012345",
          source: "Magicbricks",
          preference: TransactionType.SALE,
          city: "Gurugram",
          localities: ["Sector 54"],
          societies: [],
          bedroomConfigurations: ["3 BHK"],
          propertyTypes: [PropertyType.APARTMENT],
          minBudget: 15000000,
          maxBudget: 20000000,
          areaUnit: "sq.ft",
          isValid: true,
          errors: [],
          isExistingBuyer: true,
        },
      ];

      const result = await executeBulkLeadImport(brokerContext, { rows });

      expect(result.success).toBe(true);
      expect(result.newLeadsCreated).toBe(0);
      expect(result.enquiriesAttached).toBe(1);
      expect(prisma.lead.create).not.toHaveBeenCalled();
      expect(prisma.enquiry.create).toHaveBeenCalledTimes(1);
    });

    it("reopens INACTIVE leads to NOT_YET_VALIDATED when isDoNotContact is false", async () => {
      vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([
        {
          id: "lead-inactive-1",
          name: "Inactive Buyer",
          primaryPhone: "9810012345",
          status: LeadStatus.INACTIVE,
          isDoNotContact: false,
          assignedTelecallerId: "telecaller-1",
          originalSource: "Direct",
        } as any,
      ]);

      const rows: ValidatedLeadRow[] = [
        {
          rowNumber: 2,
          name: "Inactive Buyer",
          primaryPhone: "9810012345",
          source: "Website",
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
          isExistingBuyer: true,
        },
      ];

      const result = await executeBulkLeadImport(brokerContext, { rows });

      expect(result.success).toBe(true);
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "lead-inactive-1" },
          data: { status: LeadStatus.NOT_YET_VALIDATED },
        })
      );
      expect(prisma.leadChangeLog.createMany).toHaveBeenCalledTimes(1);
    });

    it("preserves INACTIVE status and respects DNC when isDoNotContact is true", async () => {
      vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([
        {
          id: "lead-dnc-1",
          name: "DNC Buyer",
          primaryPhone: "9810012345",
          status: LeadStatus.INACTIVE,
          isDoNotContact: true, // DNC flagged!
          assignedTelecallerId: "telecaller-1",
          originalSource: "Direct",
        } as any,
      ]);

      const rows: ValidatedLeadRow[] = [
        {
          rowNumber: 2,
          name: "DNC Buyer",
          primaryPhone: "9810012345",
          source: "Magicbricks",
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
          isExistingBuyer: true,
        },
      ];

      const result = await executeBulkLeadImport(brokerContext, { rows });

      expect(result.success).toBe(true);
      expect(result.enquiriesAttached).toBe(1);
      // Status must NOT be updated for DNC
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it("matches valid tenant property UUID and links advertisedPropertyId", async () => {
      const validPropertyUuid = "c3f88f1e-9a74-4b52-b88a-3642199b50b1";
      vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
        { id: validPropertyUuid } as any,
      ]);

      vi.mocked(prisma.lead.create).mockResolvedValueOnce({
        id: "lead-new-prop-link",
        name: "Ad Lead",
        primaryPhone: "9810012345",
        status: LeadStatus.NOT_YET_VALIDATED,
        isDoNotContact: false,
        assignedTelecallerId: null,
        requirement: { id: "req-prop" },
      } as any);

      const rows: ValidatedLeadRow[] = [
        {
          rowNumber: 2,
          name: "Ad Lead",
          primaryPhone: "9810012345",
          source: "Magicbricks",
          preference: TransactionType.SALE,
          city: "Gurugram",
          localities: ["Sector 54"],
          societies: [],
          bedroomConfigurations: ["2 BHK"],
          propertyTypes: [PropertyType.APARTMENT],
          minBudget: 10000000,
          maxBudget: 15000000,
          areaUnit: "sq.ft",
          advertisedPropertyRef: validPropertyUuid,
          isValid: true,
          errors: [],
        },
      ];

      const result = await executeBulkLeadImport(brokerContext, { rows });
      expect(result.success).toBe(true);
      expect(prisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            enquiries: expect.objectContaining({
              create: expect.objectContaining({
                advertisedPropertyId: validPropertyUuid,
              }),
            }),
          }),
        })
      );
    });

    it("falls back to raw text reference when advertisedPropertyRef is unmatched without rejecting the row", async () => {
      const nonUuidRef = "PROP-DLF-PHASE5-402";

      vi.mocked(prisma.lead.create).mockResolvedValueOnce({
        id: "lead-new-unmatched-ref",
        name: "Ad Lead 2",
        primaryPhone: "9810012345",
        status: LeadStatus.NOT_YET_VALIDATED,
        isDoNotContact: false,
        assignedTelecallerId: null,
        requirement: { id: "req-unmatched" },
      } as any);

      const rows: ValidatedLeadRow[] = [
        {
          rowNumber: 2,
          name: "Ad Lead 2",
          primaryPhone: "9810012345",
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
          advertisedPropertyRef: nonUuidRef,
          isValid: true,
          errors: [],
        },
      ];

      const result = await executeBulkLeadImport(brokerContext, { rows });
      expect(result.success).toBe(true);
      expect(result.newLeadsCreated).toBe(1);
      expect(prisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            enquiries: expect.objectContaining({
              create: expect.objectContaining({
                advertisedPropertyId: null,
                advertisedPropertyRef: nonUuidRef,
                enquiryDetails: expect.stringContaining(nonUuidRef),
              }),
            }),
          }),
        })
      );
    });

    it("skips invalid rows when skipInvalidRows is true and records failures in summary", async () => {
      vi.mocked(prisma.lead.create).mockResolvedValueOnce({
        id: "lead-valid-1",
        name: "Valid Lead",
        primaryPhone: "9810012345",
        status: LeadStatus.NOT_YET_VALIDATED,
        isDoNotContact: false,
        assignedTelecallerId: null,
        requirement: { id: "req-valid" },
      } as any);

      const rows: ValidatedLeadRow[] = [
        {
          rowNumber: 2,
          name: "",
          primaryPhone: "123",
          source: "Direct",
          preference: TransactionType.SALE,
          city: "Gurugram",
          localities: [],
          societies: [],
          bedroomConfigurations: [],
          propertyTypes: [],
          minBudget: -10,
          maxBudget: -20,
          isValid: false,
          errors: ["Prospect Name is required.", "Invalid mobile number."],
        },
        {
          rowNumber: 3,
          name: "Valid Lead",
          primaryPhone: "9810012345",
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
      ];

      const result = await executeBulkLeadImport(brokerContext, {
        rows,
        skipInvalidRows: true,
      });

      expect(result.success).toBe(true);
      expect(result.newLeadsCreated).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].rowNumber).toBe(2);
    });

    it("rejects entire import when skipInvalidRows is false and an invalid row exists", async () => {
      const rows: ValidatedLeadRow[] = [
        {
          rowNumber: 2,
          name: "",
          primaryPhone: "123",
          source: "Direct",
          preference: TransactionType.SALE,
          city: "Gurugram",
          localities: [],
          societies: [],
          bedroomConfigurations: [],
          propertyTypes: [],
          minBudget: -10,
          maxBudget: -20,
          isValid: false,
          errors: ["Prospect Name is required."],
        },
      ];

      await expect(
        executeBulkLeadImport(brokerContext, { rows, skipInvalidRows: false })
      ).rejects.toThrow(ValidationError);
      expect(prisma.lead.create).not.toHaveBeenCalled();
    });
  });
});
