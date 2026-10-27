import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import {
  UserRole,
  TransactionType,
  PropertyType,
  FurnishingStatus,
  ConstructionStatus,
  AreaUnitType,
  KeyHolderPersona,
  SupplyValidationStatus,
  PropertyAvailabilityStatus,
} from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError, ValidationError } from "@/server/errors";

// Mock Prisma DB module
vi.mock("@/server/db", () => {
  const mockPrisma = {
    property: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(async (arg) => {
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
  generateImportTemplate,
  parseAndPreviewImportFile,
  executeBulkPropertyImport,
  TEMPLATE_COLUMNS,
  ValidatedPropertyRow,
} from "@/server/dal/bulk-import";

type MockProperty = NonNullable<Awaited<ReturnType<typeof prisma.property.findFirst>>>;

describe("Supply Bulk Property Upload - DAL & Validation", () => {
  const tenant1Context: TenantContext = {
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

  const salesAgentContext: TenantContext = {
    tenantId: "tenant-brokerage-1",
    userId: "sales-user-1",
    role: UserRole.FIELD_SALES_AGENT,
    user: {
      id: "sales-user-1",
      name: "Sales Agent Rahul",
      email: "rahul@apexrealty.in",
      role: UserRole.FIELD_SALES_AGENT,
      tenantId: "tenant-brokerage-1",
      isActive: true,
    },
    session: {
      id: "sess-sales-1",
      token: "tok-sales-1",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.property.findMany).mockResolvedValue([]);
  });

  // Helper to create a CSV buffer
  function createCsvBuffer(headerLine: string, rows: string[]): Buffer {
    const content = [headerLine, ...rows].join("\n");
    return Buffer.from(content, "utf-8");
  }

  // Standard valid header line matching TEMPLATE_COLUMNS
  const validHeaderLine = TEMPLATE_COLUMNS.map((c) => c.header).join(",");

  it("1. Generates valid CSV and Excel templates with 20 PRD columns", async () => {
    const csvBuffer = await generateImportTemplate("csv");
    expect(csvBuffer).toBeInstanceOf(Buffer);
    const csvText = csvBuffer.toString("utf-8");
    expect(csvText).toContain("Flat Number*");
    expect(csvText).toContain("Society Name*");
    expect(csvText).toContain("Locality*");
    expect(csvText).toContain("Price (INR)*");
    expect(csvText).toContain("Owner Mobile Number*");

    const xlsxBuffer = await generateImportTemplate("xlsx");
    expect(xlsxBuffer).toBeInstanceOf(Buffer);
    expect(xlsxBuffer.length).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsxBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const worksheet = workbook.getWorksheet("Property Import Template");
    expect(worksheet).toBeDefined();
    expect(worksheet?.columnCount).toBe(20);
  });

  it("2. Validates and previews a valid CSV file", async () => {
    const row = [
      "101",
      "DLF The Crest",
      "Sector 54",
      "Gurgaon",
      "Sale",
      "Apartment",
      "Semi-Furnished",
      "2250",
      "Super built-up",
      "3",
      "3",
      "2",
      "45000000",
      '"Clubhouse, Pool"',
      "Ready to Move",
      "Vikram Malhotra",
      "9876543210",
      "Ramesh Security",
      "9876500000",
      "Society Guard",
    ].join(",");

    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([]);

    const csvBuffer = createCsvBuffer(validHeaderLine, [row]);
    const preview = await parseAndPreviewImportFile(tenant1Context, csvBuffer, "test-import.csv");

    expect(preview.totalRows).toBe(1);
    expect(preview.validCount).toBe(1);
    expect(preview.errorCount).toBe(0);
    expect(preview.duplicateCount).toBe(0);

    const parsedRow = preview.rows[0];
    expect(parsedRow.flatNumber).toBe("101");
    expect(parsedRow.societyName).toBe("DLF The Crest");
    expect(parsedRow.preference).toBe(TransactionType.SALE);
    expect(parsedRow.propertyType).toBe(PropertyType.APARTMENT);
    expect(parsedRow.price).toBe(45000000);
    expect(parsedRow.ownerMobile).toBe("9876543210");
    expect(parsedRow.keyHolder?.name).toBe("Ramesh Security");
    expect(parsedRow.keyHolder?.persona).toBe(KeyHolderPersona.GUARD);
  });

  it("3. Validates and previews a valid Excel (.xlsx) file", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Properties");
    sheet.addRow(TEMPLATE_COLUMNS.map((c) => c.header));
    sheet.addRow([
      "B-402",
      "Sobha City",
      "Sector 108",
      "Gurgaon",
      "Rent",
      "Independent Floor",
      "Fully-Furnished",
      "1800",
      "Carpet",
      "2",
      "2",
      "1",
      "55000",
      "Gym",
      "Ready to Move",
      "Sunita Rao",
      "+91 9988776655",
      "",
      "",
      "",
    ]);

    const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([]);

    const preview = await parseAndPreviewImportFile(tenant1Context, xlsxBuffer, "test-excel.xlsx");
    if (preview.rows[0]?.errors?.length) {
      console.log("TEST 3 ERRORS:", preview.rows[0].errors);
    }

    expect(preview.totalRows).toBe(1);
    expect(preview.validCount).toBe(1);
    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0].flatNumber).toBe("B-402");
    expect(preview.rows[0].societyName).toBe("Sobha City");
    expect(preview.rows[0].preference).toBe(TransactionType.RENT);
    expect(preview.rows[0].ownerMobile).toBe("9988776655");
    expect(preview.rows[0].keyHolder).toBeNull();
  });

  it("4. Detects missing required headers and reports error", async () => {
    const invalidHeader = "Flat Number*,Random Header,Another Header";
    const csvBuffer = createCsvBuffer(invalidHeader, ["101,ABC,XYZ"]);

    const preview = await parseAndPreviewImportFile(tenant1Context, csvBuffer, "bad-headers.csv");
    expect(preview.hasHeadersError).toBe(true);
    expect(preview.headersErrorMessage).toContain("Missing required template columns");
    expect(preview.totalRows).toBe(0);
  });

  it("5. Flags invalid enum values in preference, property type, furnishing, and construction", async () => {
    const row = [
      "501",
      "DLF Phase 5",
      "Sector 54",
      "Gurgaon",
      "LeaseToOwn", // Invalid preference
      "Mansion", // Invalid property type
      "HalfFurnished", // Invalid furnishing
      "2000",
      "InvalidAreaType", // Invalid area type
      "3",
      "2",
      "1",
      "30000000",
      "",
      "AlmostDone", // Invalid construction
      "Rajesh",
      "9811122334",
      "",
      "",
      "",
    ].join(",");

    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([]);

    const csvBuffer = createCsvBuffer(validHeaderLine, [row]);
    const preview = await parseAndPreviewImportFile(tenant1Context, csvBuffer, "invalid-enums.csv");

    expect(preview.totalRows).toBe(1);
    expect(preview.validCount).toBe(0);
    expect(preview.errorCount).toBe(1);
    const r = preview.rows[0];
    expect(r.isValid).toBe(false);
    expect(r.errors.some((e) => e.includes("Sale/Rent Preference"))).toBe(true);
    expect(r.errors.some((e) => e.includes("Property Type"))).toBe(true);
    expect(r.errors.some((e) => e.includes("Furnishing Status"))).toBe(true);
    expect(r.errors.some((e) => e.includes("Construction Status"))).toBe(true);
  });

  it("6. Flags invalid mobile numbers and negative numeric fields", async () => {
    const row = [
      "12",
      "Palm Grove",
      "Sector 43",
      "Noida",
      "Sale",
      "Apartment",
      "Unfurnished",
      "-500", // Negative area
      "Super built-up",
      "-2", // Negative bedrooms
      "2",
      "1",
      "-100000", // Negative price
      "",
      "Ready to Move",
      "Anoop",
      "12345", // Invalid 5-digit mobile
      "",
      "",
      "",
    ].join(",");

    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([]);

    const csvBuffer = createCsvBuffer(validHeaderLine, [row]);
    const preview = await parseAndPreviewImportFile(tenant1Context, csvBuffer, "invalid-numerics.csv");

    expect(preview.validCount).toBe(0);
    expect(preview.errorCount).toBe(1);
    const errors = preview.rows[0].errors;
    expect(errors.some((e) => e.includes("Must be a 10-digit Indian mobile"))).toBe(true);
    expect(errors.some((e) => e.includes("Area must be a positive number"))).toBe(true);
    expect(errors.some((e) => e.includes("Bedrooms must be a non-negative number"))).toBe(true);
    expect(errors.some((e) => e.includes("Price must be a positive number"))).toBe(true);
  });

  it("7. Handles empty files gracefully", async () => {
    const emptyBuffer = Buffer.from("", "utf-8");
    await expect(
      parseAndPreviewImportFile(tenant1Context, emptyBuffer, "empty.csv")
    ).rejects.toThrow(ValidationError);
  });

  it("8. Rejects files exceeding the 500 row maximum limit", async () => {
    const rows: string[] = [];
    for (let i = 1; i <= 505; i++) {
      rows.push([
        `Flat-${i}`,
        "Society A",
        "Locality X",
        "City Y",
        "Sale",
        "Apartment",
        "Unfurnished",
        "1000",
        "Super built-up",
        "2",
        "2",
        "1",
        "5000000",
        "",
        "Ready to Move",
        "Owner",
        "9876543210",
        "",
        "",
        "",
      ].join(","));
    }

    const csvBuffer = createCsvBuffer(validHeaderLine, rows);

    await expect(
      parseAndPreviewImportFile(tenant1Context, csvBuffer, "too-many-rows.csv")
    ).rejects.toThrow(ValidationError);
  });

  it("9. Detects internal duplicate rows within the same upload", async () => {
    const row1 = [
      "A-101",
      "Godrej Woods",
      "Sector 43",
      "Noida",
      "Sale",
      "Apartment",
      "Semi-Furnished",
      "1200",
      "Super built-up",
      "2",
      "2",
      "1",
      "12000000",
      "",
      "Ready to Move",
      "Deepak",
      "9876543210",
      "",
      "",
      "",
    ].join(",");

    // Exact same flat and society
    const row2 = [
      "A-101",
      "Godrej Woods",
      "Sector 43",
      "Noida",
      "Sale",
      "Apartment",
      "Semi-Furnished",
      "1200",
      "Super built-up",
      "2",
      "2",
      "1",
      "12000000",
      "",
      "Ready to Move",
      "Deepak",
      "9876543210",
      "",
      "",
      "",
    ].join(",");

    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([]);

    const csvBuffer = createCsvBuffer(validHeaderLine, [row1, row2]);
    const preview = await parseAndPreviewImportFile(tenant1Context, csvBuffer, "internal-dup.csv");

    expect(preview.totalRows).toBe(2);
    expect(preview.duplicateCount).toBe(1);
    expect(preview.rows[0].isDuplicate).toBe(false);
    expect(preview.rows[1].isDuplicate).toBe(true);
    expect(preview.rows[1].duplicateWarning).toContain("Duplicate in upload: Matches Row 2");
  });

  it("10. Detects existing tenant-scoped duplicates from database", async () => {
    const row = [
      "T1-502",
      "Ireo Grand Arch",
      "Sector 58",
      "Gurgaon",
      "Sale",
      "Apartment",
      "Fully-Furnished",
      "2100",
      "Super built-up",
      "3",
      "3",
      "2",
      "35000000",
      "",
      "Ready to Move",
      "Alok Verma",
      "9811122334",
      "",
      "",
      "",
    ].join(",");

    // Existing property in DB for tenant1
    vi.mocked(prisma.property.findMany).mockReturnValue(
      Promise.resolve([
        {
          id: "existing-prop-id-1",
          societyName: "Ireo Grand Arch",
          flatNumber: "T1-502",
          localityName: "Sector 58",
          city: "Gurgaon",
        },
      ]) as unknown as ReturnType<typeof prisma.property.findMany>
    );

    const csvBuffer = createCsvBuffer(validHeaderLine, [row]);
    const preview = await parseAndPreviewImportFile(tenant1Context, csvBuffer, "db-dup.csv");

    expect(preview.totalRows).toBe(1);
    expect(preview.duplicateCount).toBe(1);
    expect(preview.rows[0].isDuplicate).toBe(true);
    expect(preview.rows[0].duplicateWarning).toContain("already exists in your brokerage");
  });

  it("11. Strictly enforces cross-tenant isolation during duplicate check and import", async () => {
    const row = [
      "101",
      "DLF The Crest",
      "Sector 54",
      "Gurgaon",
      "Sale",
      "Apartment",
      "Semi-Furnished",
      "2250",
      "Super built-up",
      "3",
      "3",
      "2",
      "45000000",
      "",
      "Ready to Move",
      "Owner",
      "9876543210",
      "",
      "",
      "",
    ].join(",");

    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([]);

    const csvBuffer = createCsvBuffer(validHeaderLine, [row]);
    await parseAndPreviewImportFile(tenant1Context, csvBuffer, "tenant1.csv");

    // Ensure findMany queried ONLY with context.tenantId
    expect(prisma.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-brokerage-1",
        }),
      })
    );
  });

  it("12. Blocks unauthorized roles (Field Sales Agent) from previewing or executing imports", async () => {
    const csvBuffer = createCsvBuffer(validHeaderLine, ["101,ABC,XYZ"]);

    // Sales Agent lacks supply:create
    await expect(
      parseAndPreviewImportFile(salesAgentContext, csvBuffer, "import.csv")
    ).rejects.toThrow(ForbiddenError);

    await expect(
      executeBulkPropertyImport(salesAgentContext, { rows: [], overrideDuplicates: false })
    ).rejects.toThrow(ForbiddenError);
  });

  it("13. Persists valid properties to PostgreSQL outside Active Supply Pool", async () => {
    const validRow: ValidatedPropertyRow = {
      rowNumber: 2,
      societyName: "Sobha City",
      flatNumber: "A-101",
      localityName: "Sector 108",
      city: "Gurgaon",
      preference: TransactionType.SALE,
      propertyType: PropertyType.APARTMENT,
      furnishingStatus: FurnishingStatus.SEMI_FURNISHED,
      constructionStatus: ConstructionStatus.READY_TO_MOVE,
      bedroomCount: 3,
      bathroomCount: 3,
      balconyCount: 2,
      area: 2000,
      areaType: AreaUnitType.SUPER_BUILT_UP,
      price: 24500000,
      amenities: ["Gym", "Pool"],
      ownerName: "Ramesh Kulkarni",
      ownerMobile: "9876543210",
      keyHolder: {
        name: "Security Guard",
        mobile: "9876500000",
        persona: KeyHolderPersona.GUARD,
        notes: "Gate 1",
      },
      isValid: true,
      errors: [],
    };

    vi.mocked(prisma.property.create).mockResolvedValueOnce({
      id: "new-prop-id-1",
      ...validRow,
    } as unknown as MockProperty);

    const result = await executeBulkPropertyImport(tenant1Context, {
      rows: [validRow],
      overrideDuplicates: false,
    });

    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(0);

    // Verify properties created with strict PRD defaults:
    // NOT_VALIDATED, ownerWillingnessConfirmed: false, isActiveSupply: false
    expect(prisma.property.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-brokerage-1",
        submittingAgentId: "manager-user-1",
        societyName: "Sobha City",
        flatNumber: "A-101",
        validationStatus: SupplyValidationStatus.NOT_VALIDATED,
        availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
        ownerWillingnessConfirmed: false,
        isActiveSupply: false,
        keyHolders: {
          create: expect.objectContaining({
            name: "Security Guard",
            persona: KeyHolderPersona.GUARD,
          }),
        },
      }),
    });
  });

  it("14. Honors duplicate override toggle: skips duplicates when false, imports when true", async () => {
    const dupRow: ValidatedPropertyRow = {
      rowNumber: 2,
      societyName: "Sobha City",
      flatNumber: "A-101",
      localityName: "Sector 108",
      city: "Gurgaon",
      preference: TransactionType.SALE,
      propertyType: PropertyType.APARTMENT,
      furnishingStatus: FurnishingStatus.SEMI_FURNISHED,
      constructionStatus: ConstructionStatus.READY_TO_MOVE,
      bedroomCount: 3,
      bathroomCount: 3,
      balconyCount: 2,
      area: 2000,
      areaType: AreaUnitType.SUPER_BUILT_UP,
      price: 24500000,
      amenities: [],
      ownerName: "Ramesh",
      ownerMobile: "9876543210",
      isValid: true,
      isDuplicate: true,
      duplicateWarning: "Already exists",
      errors: [],
    };

    // When overrideDuplicates = false, duplicate row should be skipped
    const skippedResult = await executeBulkPropertyImport(tenant1Context, {
      rows: [dupRow],
      overrideDuplicates: false,
    });

    expect(skippedResult.importedCount).toBe(0);
    expect(skippedResult.skippedCount).toBe(1);
    expect(prisma.property.create).not.toHaveBeenCalled();

    // When overrideDuplicates = true, duplicate row should be imported
    vi.mocked(prisma.property.create).mockResolvedValueOnce({ id: "dup-prop-id" } as unknown as MockProperty);

    const overrideResult = await executeBulkPropertyImport(tenant1Context, {
      rows: [dupRow],
      overrideDuplicates: true,
    });

    expect(overrideResult.importedCount).toBe(1);
    expect(overrideResult.skippedCount).toBe(0);
    expect(prisma.property.create).toHaveBeenCalledTimes(1);
  });
});
