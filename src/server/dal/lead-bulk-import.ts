import ExcelJS from "exceljs";
import { Readable } from "stream";
import { prisma } from "../db";
import { TenantContext } from "../tenant-context";
import { assertPermission } from "../permissions";
import { ValidationError } from "../errors";
import { normalizeIndianMobile } from "../utils/phone";
import { recordLeadFieldChanges } from "./lead-changelog";
import {
  TransactionType,
  PropertyType,
  AreaUnitType,
  LeadStatus,
  AssignmentMethod,
  Prisma,
} from "@prisma/client";
import {
  recordLeadAssignmentTx,
  pickRoundRobinTelecallerTx,
} from "./assignments";

// Maximum upload limits
export const MAX_LEAD_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_LEAD_IMPORT_ROW_COUNT = 500; // 500 data rows

// -------------------------------------------------------------
// TEMPLATE & HEADER SPECIFICATION (PRD §5.2, DEC-Q18)
// -------------------------------------------------------------

export const LEAD_TEMPLATE_COLUMNS = [
  { header: "Prospect Name", key: "name", required: true },
  { header: "Primary Phone", key: "primaryPhone", required: true },
  { header: "Alternate Phone", key: "alternatePhone", required: false },
  { header: "Email", key: "email", required: false },
  { header: "Source", key: "source", required: true },
  { header: "Preference", key: "preference", required: true },
  { header: "City", key: "city", required: true },
  { header: "Preferred Localities", key: "localities", required: true },
  { header: "Preferred Societies", key: "societies", required: false },
  { header: "Bedroom Configuration", key: "bedroomConfigurations", required: true },
  { header: "Property Types", key: "propertyTypes", required: true },
  { header: "Min Budget", key: "minBudget", required: true },
  { header: "Max Budget", key: "maxBudget", required: true },
  { header: "Target Area", key: "targetArea", required: false },
  { header: "Min Area", key: "minArea", required: false },
  { header: "Max Area", key: "maxArea", required: false },
  { header: "Area Unit", key: "areaUnit", required: false },
  { header: "Area Type", key: "areaType", required: false },
  { header: "Advertised Property Ref", key: "advertisedPropertyRef", required: false },
  { header: "Enquiry Notes", key: "enquiryNotes", required: false },
] as const;

export const MANDATORY_LEAD_HEADER_KEYS = [
  "name",
  "primaryPhone",
  "source",
  "preference",
  "city",
  "localities",
  "bedroomConfigurations",
  "propertyTypes",
  "minBudget",
  "maxBudget",
] as const;

export const HEADER_ALIASES: Record<string, string> = {
  "prospect name": "name",
  "prospectname": "name",
  "buyer name": "name",
  "name": "name",

  "primary phone": "primaryPhone",
  "primaryphone": "primaryPhone",
  "mobile": "primaryPhone",
  "phone": "primaryPhone",

  "alternate phone": "alternatePhone",
  "alternatephone": "alternatePhone",
  "alt phone": "alternatePhone",

  "email": "email",
  "email address": "email",

  "source": "source",
  "lead source": "source",
  "inquiry source": "source",

  "preference": "preference",
  "sale/rent": "preference",
  "transaction type": "preference",

  "city": "city",

  "preferred localities": "localities",
  "localities": "localities",
  "locality": "localities",

  "preferred societies": "societies",
  "societies": "societies",
  "society": "societies",

  "bedroom configuration": "bedroomConfigurations",
  "bhk": "bedroomConfigurations",
  "bedrooms": "bedroomConfigurations",

  "property types": "propertyTypes",
  "property type": "propertyTypes",

  "min budget": "minBudget",
  "min budget (inr)": "minBudget",
  "minimum budget": "minBudget",

  "max budget": "maxBudget",
  "max budget (inr)": "maxBudget",
  "maximum budget": "maxBudget",

  "target area": "targetArea",
  "area": "targetArea",

  "min area": "minArea",
  "max area": "maxArea",

  "area unit": "areaUnit",
  "unit": "areaUnit",

  "area type": "areaType",

  "advertised property ref": "advertisedPropertyRef",
  "advertised property": "advertisedPropertyRef",
  "property ref": "advertisedPropertyRef",

  "enquiry notes": "enquiryNotes",
  "notes": "enquiryNotes",
  "comments": "enquiryNotes",
};

// -------------------------------------------------------------
// DATA TYPES & INTERFACES
// -------------------------------------------------------------

export interface ValidatedLeadRow {
  rowNumber: number;
  name: string;
  primaryPhone: string;
  alternatePhone?: string | null;
  email?: string | null;
  source: string;
  preference: TransactionType;
  city: string;
  localities: string[];
  societies: string[];
  bedroomConfigurations: string[];
  propertyTypes: PropertyType[];
  minBudget: number;
  maxBudget: number;
  targetArea?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  areaUnit?: string | null;
  areaType?: AreaUnitType | null;
  advertisedPropertyRef?: string | null;
  advertisedPropertyId?: string | null;
  enquiryNotes?: string | null;
  isValid: boolean;
  errors: string[];
  isExistingBuyer?: boolean;
  isInternalDuplicate?: boolean;
  duplicateWarning?: string;
}

export interface BulkLeadImportPreview {
  filename: string;
  totalRows: number;
  validCount: number;
  errorCount: number;
  newLeadCount: number;
  existingBuyerCount: number;
  internalDuplicateCount: number;
  rows: ValidatedLeadRow[];
  hasHeadersError?: boolean;
  headersErrorMessage?: string;
}

export interface BulkLeadImportExecutionInput {
  rows: ValidatedLeadRow[];
  skipInvalidRows?: boolean;
}

export interface BulkLeadImportResult {
  success: boolean;
  totalProcessed: number;
  newLeadsCreated: number;
  enquiriesAttached: number;
  skippedCount: number;
  failedCount: number;
  failures: { rowNumber: number; reason: string }[];
  message: string;
}

// -------------------------------------------------------------
// NORMALIZATION HELPERS
// -------------------------------------------------------------

function cleanString(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object" && "text" in val && typeof (val as { text: string }).text === "string") {
    return (val as { text: string }).text.trim();
  }
  return String(val).trim();
}

function normalizeHeaderKey(rawHeader: string): string | null {
  const cleaned = rawHeader.toLowerCase().replace(/[*]/g, "").trim();
  return HEADER_ALIASES[cleaned] || null;
}

function normalizePreference(raw: string): TransactionType | null {
  const lower = raw.trim().toLowerCase();
  if (lower === "sale" || lower === "buy" || lower === "purchase") {
    return TransactionType.SALE;
  }
  if (lower === "rent" || lower === "lease") {
    return TransactionType.RENT;
  }
  return null;
}

function normalizePropertyType(raw: string): PropertyType | null {
  const lower = raw.trim().toLowerCase().replace(/[-_ ]/g, "");
  if (lower === "apartment" || lower === "flat") return PropertyType.APARTMENT;
  if (lower === "independenthouse" || lower === "house" || lower === "kothi") {
    return PropertyType.INDEPENDENT_HOUSE;
  }
  if (lower === "villa") return PropertyType.VILLA;
  if (lower === "builderfloor" || lower === "floor") return PropertyType.BUILDER_FLOOR;
  if (lower === "plot" || lower === "land") return PropertyType.PLOT;
  return null;
}

function normalizeAreaType(raw: string): AreaUnitType | null {
  const lower = raw.trim().toLowerCase().replace(/[-_ ]/g, "");
  if (lower === "carpet") return AreaUnitType.CARPET;
  if (lower === "builtup") return AreaUnitType.BUILT_UP;
  if (lower === "superbuiltup") return AreaUnitType.SUPER_BUILT_UP;
  return null;
}

function normalizeAreaUnit(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  if (lower === "sq.ft" || lower === "sqft" || lower === "sq ft") return "sq.ft";
  if (lower === "sq.yd" || lower === "sqyd" || lower === "sq yd") return "sq.yd";
  if (lower === "sq.m" || lower === "sqm" || lower === "sq m") return "sq.m";
  return null;
}

function parseDelimitedList(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isUuid(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
}

export function buildEnquiryDetails(
  userNotes?: string | null,
  reqSummary?: {
    preference?: string;
    city?: string;
    minBudget?: number;
    maxBudget?: number;
    bedroomConfigurations?: string[];
    propertyTypes?: string[];
  } | null,
  isExistingBuyer?: boolean,
  unmatchedPropertyRef?: string | null
): string | null {
  const parts: string[] = [];
  if (userNotes?.trim()) {
    parts.push(userNotes.trim());
  }
  if (unmatchedPropertyRef?.trim()) {
    parts.push(`[Advertised Property Ref]: ${unmatchedPropertyRef.trim()}`);
  }
  if (isExistingBuyer && reqSummary) {
    const diffParts: string[] = [];
    if (reqSummary.preference) diffParts.push(`Type: ${reqSummary.preference}`);
    if (reqSummary.city) diffParts.push(`City: ${reqSummary.city}`);
    if (reqSummary.minBudget !== undefined && reqSummary.maxBudget !== undefined) {
      diffParts.push(
        `Budget: ₹${reqSummary.minBudget.toLocaleString("en-IN")} - ₹${reqSummary.maxBudget.toLocaleString("en-IN")}`
      );
    }
    if (reqSummary.bedroomConfigurations?.length) {
      diffParts.push(`BHK: ${reqSummary.bedroomConfigurations.join(", ")}`);
    }
    if (reqSummary.propertyTypes?.length) {
      diffParts.push(`Property: ${reqSummary.propertyTypes.join(", ")}`);
    }
    if (diffParts.length > 0) {
      parts.push(`[Submitted Requirements]: ${diffParts.join(" | ")}`);
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

// -------------------------------------------------------------
// LOCALITY SYNC HELPER
// -------------------------------------------------------------

async function syncLocalitiesForRequirement(
  tx: Prisma.TransactionClient,
  tenantId: string,
  requirementId: string,
  city: string,
  localities: string[]
): Promise<void> {
  const seenLower = new Set<string>();
  const normalizedNames: string[] = [];
  for (const raw of localities) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed.length > 0 && !seenLower.has(trimmed.toLowerCase())) {
      seenLower.add(trimmed.toLowerCase());
      normalizedNames.push(trimmed);
    }
  }

  if (normalizedNames.length === 0) return;

  const localityIds: string[] = [];
  for (const name of normalizedNames) {
    let loc = await tx.locality.findFirst({
      where: {
        tenantId,
        city: { equals: city.trim(), mode: "insensitive" },
        name: { equals: name, mode: "insensitive" },
      },
    });

    if (!loc) {
      loc = await tx.locality.create({
        data: {
          tenantId,
          city: city.trim(),
          name,
        },
      });
    }
    localityIds.push(loc.id);
  }

  for (const localityId of localityIds) {
    await tx.leadRequirementLocality.upsert({
      where: {
        requirementId_localityId: {
          requirementId,
          localityId,
        },
      },
      create: {
        tenantId,
        requirementId,
        localityId,
      },
      update: {},
    });
  }
}

// -------------------------------------------------------------
// TEMPLATE GENERATOR (CSV-ONLY)
// -------------------------------------------------------------

export async function generateLeadImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Leads");

  worksheet.columns = LEAD_TEMPLATE_COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: 20,
  }));

  // Add 3 sample rows
  worksheet.addRow({
    name: "Rohit Verma",
    primaryPhone: "9810012345",
    alternatePhone: "9810054321",
    email: "rohit.verma@example.com",
    source: "99acres",
    preference: "Sale",
    city: "Gurugram",
    localities: "Golf Course Road, DLF Phase 5",
    societies: "DLF The Magnolias, DLF Aralias",
    bedroomConfigurations: "3 BHK, 4 BHK",
    propertyTypes: "Apartment",
    minBudget: 25000000,
    maxBudget: 40000000,
    targetArea: 3200,
    minArea: 2800,
    maxArea: 3600,
    areaUnit: "sq.ft",
    areaType: "Super built-up",
    advertisedPropertyRef: "PROP-99A-8821",
    enquiryNotes: "Looking for high floor facing park. Ready to visit this weekend.",
  });

  worksheet.addRow({
    name: "Ananya Sharma",
    primaryPhone: "9820067890",
    alternatePhone: "",
    email: "ananya.s@example.com",
    source: "Magicbricks",
    preference: "Rent",
    city: "Noida",
    localities: "Sector 43, Sector 50",
    societies: "Godrej Woods",
    bedroomConfigurations: "2 BHK",
    propertyTypes: "Apartment",
    minBudget: 40000,
    maxBudget: 55000,
    targetArea: 1250,
    minArea: 1100,
    maxArea: 1400,
    areaUnit: "sq.ft",
    areaType: "Carpet",
    advertisedPropertyRef: "",
    enquiryNotes: "Family moving next month. Prefers furnished.",
  });

  worksheet.addRow({
    name: "Vikas Malhotra",
    primaryPhone: "9830045678",
    alternatePhone: "",
    email: "",
    source: "Direct",
    preference: "Sale",
    city: "Gurugram",
    localities: "Sushant Lok 1, Sector 43",
    societies: "",
    bedroomConfigurations: "4 BHK",
    propertyTypes: "Builder Floor, Villa",
    minBudget: 30000000,
    maxBudget: 45000000,
    targetArea: 2500,
    minArea: "",
    maxArea: "",
    areaUnit: "sq.ft",
    areaType: "Built-up",
    advertisedPropertyRef: "",
    enquiryNotes: "Prefers gated community with dedicated parking.",
  });

  const csvBuffer = await workbook.csv.writeBuffer();
  return Buffer.from(csvBuffer);
}

// -------------------------------------------------------------
// SPREADSHEET PARSER & PREVIEW
// -------------------------------------------------------------

export async function parseAndPreviewLeadImportFile(
  context: TenantContext,
  fileBuffer: Buffer,
  filename: string
): Promise<BulkLeadImportPreview> {
  assertPermission(context, "demand:create");

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new ValidationError("Uploaded file is empty. Please select a valid CSV file.");
  }

  if (fileBuffer.length > MAX_LEAD_IMPORT_FILE_SIZE_BYTES) {
    throw new ValidationError(
      `File size exceeds maximum allowed limit of ${MAX_LEAD_IMPORT_FILE_SIZE_BYTES / (1024 * 1024)} MB.`
    );
  }

  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext !== "csv") {
    throw new ValidationError("Unsupported file format. Please upload a .csv file. Excel (.xlsx) lead import is not supported.");
  }

  const workbook = new ExcelJS.Workbook();

  try {
    const stream = new Readable();
    stream.push(fileBuffer);
    stream.push(null);
    await workbook.csv.read(stream);
  } catch (err) {
    throw new ValidationError(
      `Failed to parse CSV file: ${err instanceof Error ? err.message : "Invalid or corrupt format"}.`
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 2) {
    throw new ValidationError("Spreadsheet contains no data rows. Please use the standard template.");
  }

  // 1. Map Header Row
  const headerRow = worksheet.getRow(1);
  const columnMap: Record<number, string> = {};
  const foundKeys = new Set<string>();
  const unrecognizedHeaders: string[] = [];

  headerRow.eachCell((cell, colNumber) => {
    const rawVal = cleanString(cell.value);
    if (!rawVal) return;
    const normalizedKey = normalizeHeaderKey(rawVal);
    if (normalizedKey) {
      columnMap[colNumber] = normalizedKey;
      foundKeys.add(normalizedKey);
    } else {
      unrecognizedHeaders.push(rawVal);
    }
  });

  // Verify Mandatory Headers
  const missingHeaders: string[] = [];
  for (const mKey of MANDATORY_LEAD_HEADER_KEYS) {
    if (!foundKeys.has(mKey)) {
      const def = LEAD_TEMPLATE_COLUMNS.find((c) => c.key === mKey);
      missingHeaders.push(def?.header || mKey);
    }
  }

  if (missingHeaders.length > 0) {
    return {
      filename,
      totalRows: 0,
      validCount: 0,
      errorCount: 0,
      newLeadCount: 0,
      existingBuyerCount: 0,
      internalDuplicateCount: 0,
      rows: [],
      hasHeadersError: true,
      headersErrorMessage: `Missing mandatory column header(s): ${missingHeaders.join(", ")}. Please use the standard template.`,
    };
  }

  if (unrecognizedHeaders.length > 0) {
    return {
      filename,
      totalRows: 0,
      validCount: 0,
      errorCount: 0,
      newLeadCount: 0,
      existingBuyerCount: 0,
      internalDuplicateCount: 0,
      rows: [],
      hasHeadersError: true,
      headersErrorMessage: `Unrecognized column header(s): ${unrecognizedHeaders.join(", ")}. Please use the standard template.`,
    };
  }

  // 2. Parse & Validate Data Rows
  const rows: ValidatedLeadRow[] = [];
  const totalDataRows = worksheet.rowCount - 1;

  if (totalDataRows > MAX_LEAD_IMPORT_ROW_COUNT) {
    throw new ValidationError(
      `File exceeds maximum limit of ${MAX_LEAD_IMPORT_ROW_COUNT} rows. Found ${totalDataRows} data rows.`
    );
  }

  for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);
    const rowData: Record<string, string> = {};

    let hasAnyData = false;
    row.eachCell((cell, colNumber) => {
      const mappedKey = columnMap[colNumber];
      if (mappedKey) {
        const val = cleanString(cell.value);
        if (val) hasAnyData = true;
        rowData[mappedKey] = val;
      }
    });

    if (!hasAnyData) continue; // Skip completely blank lines

    const rowErrors: string[] = [];

    // Prospect Name
    const name = cleanString(rowData.name);
    if (!name) rowErrors.push("Prospect Name is required.");

    // Primary Phone
    const rawPrimaryPhone = cleanString(rowData.primaryPhone);
    let primaryPhone = "";
    if (!rawPrimaryPhone) {
      rowErrors.push("Primary Phone is required.");
    } else {
      try {
        primaryPhone = normalizeIndianMobile(rawPrimaryPhone);
      } catch (err) {
        rowErrors.push(err instanceof Error ? err.message : `Invalid primary phone '${rawPrimaryPhone}'.`);
      }
    }

    // Alternate Phone (Optional)
    const rawAltPhone = cleanString(rowData.alternatePhone);
    let alternatePhone: string | null = null;
    if (rawAltPhone) {
      try {
        alternatePhone = normalizeIndianMobile(rawAltPhone);
      } catch (err) {
        rowErrors.push(err instanceof Error ? `Alternate phone error: ${err.message}` : `Invalid alternate phone '${rawAltPhone}'.`);
      }
    }

    // Email (Optional)
    const rawEmail = cleanString(rowData.email);
    let email: string | null = null;
    if (rawEmail) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        email = rawEmail.toLowerCase();
      } else {
        rowErrors.push(`Invalid email format '${rawEmail}'.`);
      }
    }

    // Source
    const source = cleanString(rowData.source);
    if (!source) rowErrors.push("Source is required.");

    // Preference
    const rawPref = cleanString(rowData.preference);
    const preference = normalizePreference(rawPref);
    if (!preference) {
      rowErrors.push(`Invalid Preference '${rawPref}'. Must be 'Sale' or 'Rent'.`);
    }

    // City
    const city = cleanString(rowData.city);
    if (!city) rowErrors.push("City is required.");

    // Preferred Localities
    const localities = parseDelimitedList(rowData.localities);
    if (localities.length === 0) {
      rowErrors.push("Preferred Localities are required.");
    }

    // Preferred Societies
    const societies = parseDelimitedList(rowData.societies);

    // Bedroom Configuration
    const bedroomConfigurations = parseDelimitedList(rowData.bedroomConfigurations);
    if (bedroomConfigurations.length === 0) {
      rowErrors.push("Bedroom Configuration is required.");
    }

    // Property Types
    const rawPropertyTypes = parseDelimitedList(rowData.propertyTypes);
    const propertyTypes: PropertyType[] = [];
    if (rawPropertyTypes.length === 0) {
      rowErrors.push("Property Types are required.");
    } else {
      for (const pt of rawPropertyTypes) {
        const mapped = normalizePropertyType(pt);
        if (mapped) {
          if (!propertyTypes.includes(mapped)) propertyTypes.push(mapped);
        } else {
          rowErrors.push(`Invalid property type '${pt}'. Allowed: Apartment, Independent House, Villa, Builder Floor, Plot.`);
        }
      }
    }

    // Budgets
    const rawMinBudget = cleanString(rowData.minBudget).replace(/,/g, "");
    const rawMaxBudget = cleanString(rowData.maxBudget).replace(/,/g, "");
    const minBudget = parseFloat(rawMinBudget);
    const maxBudget = parseFloat(rawMaxBudget);

    if (isNaN(minBudget) || minBudget < 0) {
      rowErrors.push("Min Budget must be a non-negative number.");
    }
    if (isNaN(maxBudget) || maxBudget < 0) {
      rowErrors.push("Max Budget must be a non-negative number.");
    }
    if (!isNaN(minBudget) && !isNaN(maxBudget) && maxBudget < minBudget) {
      rowErrors.push("Max Budget cannot be less than Min Budget.");
    }

    // Target Area / Min / Max
    const rawTargetArea = cleanString(rowData.targetArea);
    let targetArea: number | null = null;
    if (rawTargetArea) {
      const parsed = parseFloat(rawTargetArea);
      if (isNaN(parsed) || parsed < 0) rowErrors.push("Target Area must be a positive number.");
      else targetArea = parsed;
    }

    const rawMinArea = cleanString(rowData.minArea);
    let minArea: number | null = null;
    if (rawMinArea) {
      const parsed = parseFloat(rawMinArea);
      if (isNaN(parsed) || parsed < 0) rowErrors.push("Min Area must be a positive number.");
      else minArea = parsed;
    }

    const rawMaxArea = cleanString(rowData.maxArea);
    let maxArea: number | null = null;
    if (rawMaxArea) {
      const parsed = parseFloat(rawMaxArea);
      if (isNaN(parsed) || parsed < 0) rowErrors.push("Max Area must be a positive number.");
      else maxArea = parsed;
    }

    if (minArea !== null && maxArea !== null && maxArea < minArea) {
      rowErrors.push("Max Area cannot be less than Min Area.");
    }

    // Area Unit & Type
    const rawAreaUnit = cleanString(rowData.areaUnit);
    let areaUnit: string | null = null;
    if (rawAreaUnit) {
      areaUnit = normalizeAreaUnit(rawAreaUnit);
      if (!areaUnit) rowErrors.push(`Invalid Area Unit '${rawAreaUnit}'. Allowed: sq.ft, sq.yd, sq.m.`);
    }

    const rawAreaType = cleanString(rowData.areaType);
    let areaType: AreaUnitType | null = null;
    if (rawAreaType) {
      areaType = normalizeAreaType(rawAreaType);
      if (!areaType) rowErrors.push(`Invalid Area Type '${rawAreaType}'. Allowed: Carpet, Built-up, Super built-up.`);
    }

    // Advertised Property Ref & Enquiry Notes
    const advertisedPropertyRef = cleanString(rowData.advertisedPropertyRef) || null;
    const enquiryNotes = cleanString(rowData.enquiryNotes) || null;

    rows.push({
      rowNumber: rowNum,
      name,
      primaryPhone: primaryPhone || rawPrimaryPhone,
      alternatePhone,
      email,
      source,
      preference: preference || TransactionType.SALE,
      city,
      localities,
      societies,
      bedroomConfigurations,
      propertyTypes,
      minBudget: isNaN(minBudget) ? 0 : minBudget,
      maxBudget: isNaN(maxBudget) ? 0 : maxBudget,
      targetArea,
      minArea,
      maxArea,
      areaUnit: areaUnit || "sq.ft",
      areaType,
      advertisedPropertyRef,
      enquiryNotes,
      isValid: rowErrors.length === 0,
      errors: rowErrors,
    });
  }

  // 3. Duplicate Detection
  // Intra-file duplicate detection (earlier valid row takes precedence; subsequent becomes additional enquiry)
  const seenMobilesInFile = new Map<string, number>();
  for (const r of rows) {
    if (!r.isValid || !r.primaryPhone) continue;
    if (seenMobilesInFile.has(r.primaryPhone)) {
      r.isInternalDuplicate = true;
      r.isExistingBuyer = true;
      r.duplicateWarning = `Duplicate phone within file (first seen at row ${seenMobilesInFile.get(
        r.primaryPhone
      )}). Will link as additional enquiry.`;
    } else {
      seenMobilesInFile.set(r.primaryPhone, r.rowNumber);
    }
  }

  // Database duplicate detection (tenant-scoped)
  const uniquePhones = Array.from(seenMobilesInFile.keys());
  if (uniquePhones.length > 0) {
    const existingDbLeads = await prisma.lead.findMany({
      where: {
        tenantId: context.tenantId,
        primaryPhone: { in: uniquePhones },
      },
      select: {
        id: true,
        primaryPhone: true,
        name: true,
        status: true,
        isDoNotContact: true,
      },
    });

    const dbLeadMap = new Map(existingDbLeads.map((l) => [l.primaryPhone, l]));

    for (const r of rows) {
      if (!r.isValid || !r.primaryPhone) continue;
      const dbMatch = dbLeadMap.get(r.primaryPhone);
      if (dbMatch) {
        r.isExistingBuyer = true;
        if (!r.isInternalDuplicate) {
          r.duplicateWarning = `Existing prospect in database (${dbMatch.name}, status: ${dbMatch.status}${
            dbMatch.isDoNotContact ? ", DNC" : ""
          }). Will link as additional enquiry.`;
        }
      }
    }
  }

  // Count summaries
  let validCount = 0;
  let errorCount = 0;
  let newLeadCount = 0;
  let existingBuyerCount = 0;
  let internalDuplicateCount = 0;

  for (const r of rows) {
    if (r.isValid) {
      validCount++;
      if (r.isInternalDuplicate) {
        internalDuplicateCount++;
      } else if (r.isExistingBuyer) {
        existingBuyerCount++;
      } else {
        newLeadCount++;
      }
    } else {
      errorCount++;
    }
  }

  return {
    filename,
    totalRows: rows.length,
    validCount,
    errorCount,
    newLeadCount,
    existingBuyerCount,
    internalDuplicateCount,
    rows,
    hasHeadersError: false,
  };
}

// -------------------------------------------------------------
// BATCH TRANSACTIONAL EXECUTION
// -------------------------------------------------------------

export async function executeBulkLeadImport(
  context: TenantContext,
  input: BulkLeadImportExecutionInput
): Promise<BulkLeadImportResult> {
  assertPermission(context, "demand:create");

  if (!input.rows || input.rows.length === 0) {
    throw new ValidationError("No rows provided for import.");
  }

  // Filter rows eligible for persistence
  const rowsToProcess: ValidatedLeadRow[] = [];
  let skippedCount = 0;
  const failures: { rowNumber: number; reason: string }[] = [];

  for (const row of input.rows) {
    if (!row.isValid || (row.errors && row.errors.length > 0)) {
      if (input.skipInvalidRows) {
        skippedCount++;
        failures.push({
          rowNumber: row.rowNumber,
          reason: row.errors.join("; "),
        });
        continue;
      } else {
        throw new ValidationError(`Import rejected: Row ${row.rowNumber} has errors: ${row.errors.join("; ")}`);
      }
    }
    rowsToProcess.push(row);
  }

  if (rowsToProcess.length === 0) {
    return {
      success: true,
      totalProcessed: input.rows.length,
      newLeadsCreated: 0,
      enquiriesAttached: 0,
      skippedCount,
      failedCount: failures.length,
      failures,
      message: "No valid rows to import.",
    };
  }

  // Execute entire import in a single Prisma interactive transaction
  return await prisma.$transaction(
    async (tx) => {
      // 1. Preload candidate property UUIDs to avoid N+1 queries
      const candidatePropertyUuids = Array.from(
        new Set(
          rowsToProcess
            .map((r) => r.advertisedPropertyRef?.trim())
            .filter((ref): ref is string => Boolean(ref && isUuid(ref)))
        )
      );

      const matchingProperties =
        candidatePropertyUuids.length > 0
          ? await tx.property.findMany({
              where: {
                tenantId: context.tenantId,
                id: { in: candidatePropertyUuids },
              },
              select: { id: true },
            })
          : [];
      const validPropertyIdSet = new Set(matchingProperties.map((p) => p.id));

      // 2. Preload all existing leads for these phones in this tenant
      const phonesInBatch = Array.from(new Set(rowsToProcess.map((r) => r.primaryPhone)));
      const existingDbLeads = await tx.lead.findMany({
        where: {
          tenantId: context.tenantId,
          primaryPhone: { in: phonesInBatch },
        },
        select: {
          id: true,
          name: true,
          primaryPhone: true,
          status: true,
          isDoNotContact: true,
          assignedTelecallerId: true,
          originalSource: true,
        },
      });

      // In-memory cache for fast, tenant-scoped duplicate handling within the batch
      const activeLeadsByPhone = new Map<
        string,
        {
          id: string;
          name: string;
          status: LeadStatus;
          isDoNotContact: boolean;
          assignedTelecallerId: string | null;
        }
      >();

      for (const l of existingDbLeads) {
        activeLeadsByPhone.set(l.primaryPhone, l);
      }

      let newLeadsCreatedCount = 0;
      let enquiriesAttachedCount = 0;

      for (const row of rowsToProcess) {
        const existingLead = activeLeadsByPhone.get(row.primaryPhone);

        // Resolve advertised property link
        let advertisedPropertyId: string | null = null;
        let unmatchedRef: string | null = null;
        if (row.advertisedPropertyRef) {
          if (isUuid(row.advertisedPropertyRef) && validPropertyIdSet.has(row.advertisedPropertyRef)) {
            advertisedPropertyId = row.advertisedPropertyRef;
          } else {
            unmatchedRef = row.advertisedPropertyRef;
          }
        }

        if (existingLead) {
          // -------------------------------------------------------------
          // CASE A: EXISTING BUYER / SUBSEQUENT ROW IN BATCH
          // -------------------------------------------------------------
          // DNC Protection (PRD §5.5): Never reopen if DNC is flagged
          const shouldReopen =
            existingLead.status === LeadStatus.INACTIVE && !existingLead.isDoNotContact;

          if (shouldReopen) {
            await tx.lead.update({
              where: { id: existingLead.id },
              data: { status: LeadStatus.NOT_YET_VALIDATED },
            });

            await recordLeadFieldChanges({
              tx,
              tenantId: context.tenantId,
              leadId: existingLead.id,
              changedByUserId: context.userId,
              changeSource: "SYSTEM",
              changes: [
                {
                  fieldName: "status",
                  previousValue: LeadStatus.INACTIVE,
                  newValue: LeadStatus.NOT_YET_VALIDATED,
                },
              ],
            });

            existingLead.status = LeadStatus.NOT_YET_VALIDATED;
          }

          // Build enquiry details
          const enquiryDetails = buildEnquiryDetails(
            row.enquiryNotes,
            {
              preference: row.preference,
              city: row.city,
              minBudget: row.minBudget,
              maxBudget: row.maxBudget,
              bedroomConfigurations: row.bedroomConfigurations,
              propertyTypes: row.propertyTypes,
            },
            true,
            unmatchedRef
          );

          await tx.enquiry.create({
            data: {
              tenantId: context.tenantId,
              leadId: existingLead.id,
              source: row.source.trim(),
              advertisedPropertyRef: row.advertisedPropertyRef || null,
              advertisedPropertyId,
              enquiryDetails,
            },
          });

          enquiriesAttachedCount++;
        } else {
          // -------------------------------------------------------------
          // CASE B: NEW LEAD CREATION
          // -------------------------------------------------------------
          let targetTelecallerId: string | null = null;
          let assignmentMethod: AssignmentMethod | null = null;

          try {
            targetTelecallerId = await pickRoundRobinTelecallerTx(tx, context.tenantId);
            assignmentMethod = AssignmentMethod.ROUND_ROBIN;
          } catch (err) {
            if (err instanceof ValidationError) {
              targetTelecallerId = null;
              assignmentMethod = null;
            } else {
              throw err;
            }
          }

          const enquiryDetails = buildEnquiryDetails(
            row.enquiryNotes,
            null,
            false,
            unmatchedRef
          );

          const newLead = await tx.lead.create({
            data: {
              tenantId: context.tenantId,
              name: row.name.trim(),
              primaryPhone: row.primaryPhone,
              alternatePhone: row.alternatePhone || null,
              email: row.email || null,
              originalSource: row.source.trim(),
              assignedTelecallerId: targetTelecallerId,
              status: LeadStatus.NOT_YET_VALIDATED,
              requirement: {
                create: {
                  tenantId: context.tenantId,
                  minBudget: new Prisma.Decimal(row.minBudget),
                  maxBudget: new Prisma.Decimal(row.maxBudget),
                  city: row.city.trim(),
                  preference: row.preference,
                  bedroomConfigurations: row.bedroomConfigurations,
                  propertyTypes: row.propertyTypes,
                  societies: row.societies || [],
                  targetArea: row.targetArea ? new Prisma.Decimal(row.targetArea) : null,
                  minArea: row.minArea ? new Prisma.Decimal(row.minArea) : null,
                  maxArea: row.maxArea ? new Prisma.Decimal(row.maxArea) : null,
                  areaUnit: row.areaUnit || "sq.ft",
                  areaType: row.areaType || null,
                },
              },
              enquiries: {
                create: {
                  tenantId: context.tenantId,
                  source: row.source.trim(),
                  advertisedPropertyRef: row.advertisedPropertyRef || null,
                  advertisedPropertyId,
                  enquiryDetails,
                },
              },
            },
            select: {
              id: true,
              name: true,
              primaryPhone: true,
              status: true,
              isDoNotContact: true,
              assignedTelecallerId: true,
              requirement: { select: { id: true } },
            },
          });

          if (targetTelecallerId && assignmentMethod) {
            await recordLeadAssignmentTx({
              tx,
              tenantId: context.tenantId,
              leadId: newLead.id,
              targetTelecallerId,
              assignedByUserId: context.userId,
              method: assignmentMethod,
            });
          }

          if (row.localities.length > 0 && newLead.requirement) {
            await syncLocalitiesForRequirement(
              tx,
              context.tenantId,
              newLead.requirement.id,
              row.city,
              row.localities
            );
          }

          activeLeadsByPhone.set(row.primaryPhone, {
            id: newLead.id,
            name: newLead.name,
            status: newLead.status,
            isDoNotContact: newLead.isDoNotContact,
            assignedTelecallerId: targetTelecallerId,
          });

          newLeadsCreatedCount++;
        }
      }

      return {
        success: true,
        totalProcessed: input.rows.length,
        newLeadsCreated: newLeadsCreatedCount,
        enquiriesAttached: enquiriesAttachedCount,
        skippedCount,
        failedCount: failures.length,
        failures,
        message: `Import completed: ${newLeadsCreatedCount} new leads created, ${enquiriesAttachedCount} enquiries linked${
          skippedCount > 0 ? `, ${skippedCount} rows skipped` : ""
        }.`,
      };
    },
    { timeout: 30000, maxWait: 10000 }
  );
}
