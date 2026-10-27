import ExcelJS from "exceljs";
import { Readable } from "stream";
import { prisma } from "../db";
import { TenantContext } from "../tenant-context";
import { assertPermission } from "../permissions";
import { ValidationError } from "../errors";
import {
  TransactionType,
  PropertyType,
  FurnishingStatus,
  ConstructionStatus,
  AreaUnitType,
  KeyHolderPersona,
  SupplyValidationStatus,
  PropertyAvailabilityStatus,
  Prisma,
} from "@prisma/client";

// Maximum upload limits
export const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMPORT_ROW_COUNT = 500; // 500 rows per batch

export interface KeyHolderImportData {
  name: string;
  mobile?: string;
  persona: KeyHolderPersona;
  notes?: string;
}

export interface ValidatedPropertyRow {
  rowNumber: number;
  societyName: string;
  flatNumber: string;
  localityName: string;
  city: string;
  preference: TransactionType;
  propertyType: PropertyType;
  furnishingStatus: FurnishingStatus;
  constructionStatus: ConstructionStatus;
  bedroomCount: number;
  bathroomCount: number;
  balconyCount: number;
  area: number;
  areaType: AreaUnitType;
  price: number;
  amenities: string[];
  ownerName: string;
  ownerMobile: string;
  keyHolder?: KeyHolderImportData | null;
  isValid: boolean;
  errors: string[];
  isDuplicate?: boolean;
  duplicateWarning?: string;
  isInternalDuplicate?: boolean;
}

export interface BulkImportPreview {
  filename: string;
  totalRows: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  rows: ValidatedPropertyRow[];
  hasHeadersError?: boolean;
  headersErrorMessage?: string;
}

export interface BulkImportResult {
  success: boolean;
  totalProcessed: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  failures: { rowNumber: number; reason: string }[];
  message: string;
}

// -------------------------------------------------------------
// NORMALIZATION HELPERS
// -------------------------------------------------------------

export function normalizeMobile(mobile: string | number | undefined | null): string {
  if (mobile === undefined || mobile === null) return "";
  const raw = String(mobile).replace(/\D/g, "");
  if (raw.length === 12 && raw.startsWith("91")) {
    return raw.slice(2);
  }
  if (raw.length === 11 && raw.startsWith("0")) {
    return raw.slice(1);
  }
  return raw;
}

function cleanString(val: unknown): string {
  if (val === undefined || val === null) return "";
  return String(val).trim();
}

function parseNumber(val: unknown): number | null {
  if (val === undefined || val === null || val === "") return null;
  const cleaned = String(val).replace(/,/g, "").trim();
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

function normalizePreference(val: string): TransactionType | null {
  const v = val.toLowerCase().trim();
  if (v === "sale" || v === "resale") return TransactionType.SALE;
  if (v === "rent" || v === "rental" || v === "lease") return TransactionType.RENT;
  return null;
}

function normalizePropertyType(val: string): PropertyType | null {
  const v = val.toLowerCase().replace(/[\s_-]+/g, "");
  if (v === "apartment" || v === "flat" || v === "condo") return PropertyType.APARTMENT;
  if (v === "independenthouse" || v === "house" || v === "kothi" || v === "bungalow")
    return PropertyType.INDEPENDENT_HOUSE;
  if (v === "villa") return PropertyType.VILLA;
  if (v === "builderfloor" || v === "floor" || v === "independentfloor")
    return PropertyType.BUILDER_FLOOR;
  if (v === "plot" || v === "land") return PropertyType.PLOT;
  if (v === "commercial" || v === "office" || v === "shop") return PropertyType.COMMERCIAL;
  if (v === "other") return PropertyType.OTHER;
  return null;
}

function normalizeFurnishing(val: string): FurnishingStatus | null {
  const v = val.toLowerCase().replace(/[\s_-]+/g, "");
  if (v === "unfurnished" || v === "bare") return FurnishingStatus.UNFURNISHED;
  if (v === "semifurnished" || v === "semi") return FurnishingStatus.SEMI_FURNISHED;
  if (v === "furnished" || v === "fullyfurnished" || v === "full")
    return FurnishingStatus.FURNISHED;
  return null;
}

function normalizeConstruction(val: string): ConstructionStatus | null {
  const v = val.toLowerCase().replace(/[\s_-]+/g, "");
  if (v === "readytomove" || v === "ready" || v === "completed")
    return ConstructionStatus.READY_TO_MOVE;
  if (v === "underconstruction" || v === "upcoming" || v === "ongoing")
    return ConstructionStatus.UNDER_CONSTRUCTION;
  return null;
}

function normalizeAreaType(val: string): AreaUnitType | null {
  const v = val.toLowerCase().replace(/[\s_-]+/g, "");
  if (v === "carpet" || v === "carpetarea") return AreaUnitType.CARPET;
  if (v === "builtup" || v === "builtuparea") return AreaUnitType.BUILT_UP;
  if (v === "superbuiltup" || v === "superbuiltuparea" || v === "super" || v === "superarea")
    return AreaUnitType.SUPER_BUILT_UP;
  return null;
}

function normalizeKeyHolderPersona(val: string): KeyHolderPersona | null {
  const v = val.toLowerCase().replace(/[\s_-]+/g, "");
  if (v === "guard" || v === "societyguard" || v === "security") return KeyHolderPersona.GUARD;
  if (v === "maintenanceoffice" || v === "maintenance" || v === "societyoffice" || v === "office")
    return KeyHolderPersona.MAINTENANCE_OFFICE;
  if (v === "neighbour" || v === "neighbor") return KeyHolderPersona.NEIGHBOUR;
  if (v === "owner") return KeyHolderPersona.OWNER;
  if (v === "other" || v === "representative" || v === "relative")
    return KeyHolderPersona.OTHER;
  return null;
}

// -------------------------------------------------------------
// HEADER DEFINITIONS & MATCHING
// -------------------------------------------------------------

export const TEMPLATE_COLUMNS = [
  { header: "Flat Number*", key: "flatNumber", width: 18, required: true },
  { header: "Society Name*", key: "societyName", width: 22, required: true },
  { header: "Locality*", key: "localityName", width: 20, required: true },
  { header: "City*", key: "city", width: 16, required: true },
  { header: "Sale/Rent Preference*", key: "preference", width: 22, required: true },
  { header: "Property Type*", key: "propertyType", width: 18, required: true },
  { header: "Furnishing Status*", key: "furnishingStatus", width: 20, required: true },
  { header: "Area (sq.ft)*", key: "area", width: 16, required: true },
  { header: "Area Type*", key: "areaType", width: 18, required: true },
  { header: "Bedrooms*", key: "bedroomCount", width: 14, required: true },
  { header: "Bathrooms*", key: "bathroomCount", width: 14, required: true },
  { header: "Balcony Count", key: "balconyCount", width: 15, required: false },
  { header: "Price (INR)*", key: "price", width: 18, required: true },
  { header: "Amenities / Features", key: "amenities", width: 30, required: false },
  { header: "Construction Status*", key: "constructionStatus", width: 22, required: true },
  { header: "Owner Name*", key: "ownerName", width: 20, required: true },
  { header: "Owner Mobile Number*", key: "ownerMobile", width: 22, required: true },
  { header: "Key-Holder Name", key: "keyHolderName", width: 20, required: false },
  { header: "Key-Holder Mobile Number", key: "keyHolderMobile", width: 24, required: false },
  { header: "Key-Holder Persona", key: "keyHolderPersona", width: 20, required: false },
];

const CANONICAL_HEADER_MAP: Record<string, string> = {
  flatnumber: "flatNumber",
  flatno: "flatNumber",
  flat: "flatNumber",
  societyname: "societyName",
  society: "societyName",
  building: "societyName",
  locality: "localityName",
  localityname: "localityName",
  sector: "localityName",
  city: "city",
  salerentpreference: "preference",
  salerent: "preference",
  preference: "preference",
  transactiontype: "preference",
  listingtype: "preference",
  propertytype: "propertyType",
  type: "propertyType",
  furnishingstatus: "furnishingStatus",
  furnishing: "furnishingStatus",
  areasqft: "area",
  area: "area",
  size: "area",
  areatype: "areaType",
  unittype: "areaType",
  bedrooms: "bedroomCount",
  bedroomcount: "bedroomCount",
  bhk: "bedroomCount",
  beds: "bedroomCount",
  bathrooms: "bathroomCount",
  bathroomcount: "bathroomCount",
  baths: "bathroomCount",
  balconycount: "balconyCount",
  balconies: "balconyCount",
  balcony: "balconyCount",
  priceinr: "price",
  price: "price",
  askingprice: "price",
  rent: "price",
  amenitiesfeatures: "amenities",
  amenities: "amenities",
  features: "amenities",
  constructionstatus: "constructionStatus",
  construction: "constructionStatus",
  possessionstatus: "constructionStatus",
  ownername: "ownerName",
  owner: "ownerName",
  ownermobilenumber: "ownerMobile",
  ownermobile: "ownerMobile",
  ownerphone: "ownerMobile",
  mobilenumber: "ownerMobile",
  mobile: "ownerMobile",
  phone: "ownerMobile",
  keyholdername: "keyHolderName",
  custodianname: "keyHolderName",
  keyholdermobilenumber: "keyHolderMobile",
  keyholdermobile: "keyHolderMobile",
  custodianmobile: "keyHolderMobile",
  keyholderpersona: "keyHolderPersona",
  custodianpersona: "keyHolderPersona",
  persona: "keyHolderPersona",
};

export const REQUIRED_CANONICAL_KEYS = [
  "flatNumber",
  "societyName",
  "localityName",
  "city",
  "preference",
  "propertyType",
  "furnishingStatus",
  "area",
  "areaType",
  "bedroomCount",
  "bathroomCount",
  "price",
  "constructionStatus",
  "ownerName",
  "ownerMobile",
];

// -------------------------------------------------------------
// TEMPLATE GENERATOR
// -------------------------------------------------------------

export async function generateImportTemplate(format: "csv" | "xlsx"): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Broker CRM";
  workbook.lastModifiedBy = "Broker CRM";

  const worksheet = workbook.addWorksheet("Property Import Template");

  worksheet.columns = TEMPLATE_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
  }));

  // Style Header Row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FF1E2A32" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF7F5F0" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };

  // Add 3 Sample Rows
  worksheet.addRow({
    flatNumber: "Tower B - 1204",
    societyName: "Sobha City",
    localityName: "Sector 108",
    city: "Gurgaon",
    preference: "Sale",
    propertyType: "Apartment",
    furnishingStatus: "Semi-Furnished",
    area: 1950,
    areaType: "Super built-up",
    bedroomCount: 3,
    bathroomCount: 3,
    balconyCount: 2,
    price: 24500000,
    amenities: "Gym, Swimming Pool, Lift, Club House, 24x7 Security",
    constructionStatus: "Ready to Move",
    ownerName: "Rameshwar Kulkarni",
    ownerMobile: "9811122334",
    keyHolderName: "Bahadur Singh",
    keyHolderMobile: "9812345678",
    keyHolderPersona: "Guard",
  });

  worksheet.addRow({
    flatNumber: "Unit 402",
    societyName: "Godrej Woods",
    localityName: "Sector 43",
    city: "Noida",
    preference: "Rent",
    propertyType: "Apartment",
    furnishingStatus: "Furnished",
    area: 1250,
    areaType: "Carpet",
    bedroomCount: 2,
    bathroomCount: 2,
    balconyCount: 1,
    price: 45000,
    amenities: "Modular Kitchen, AC, Power Backup, Covered Parking",
    constructionStatus: "Ready to Move",
    ownerName: "Deepak Chopra",
    ownerMobile: "9822233445",
    keyHolderName: "",
    keyHolderMobile: "",
    keyHolderPersona: "",
  });

  worksheet.addRow({
    flatNumber: "Floor 2 - Plot 45",
    societyName: "Sushant Lok 1",
    localityName: "Sector 43",
    city: "Gurgaon",
    preference: "Sale",
    propertyType: "Builder Floor",
    furnishingStatus: "Semi-Furnished",
    area: 2200,
    areaType: "Built-up",
    bedroomCount: 4,
    bathroomCount: 4,
    balconyCount: 3,
    price: 32000000,
    amenities: "Reserved Parking, Lift, Piped Gas",
    constructionStatus: "Ready to Move",
    ownerName: "Anil Kapoor",
    ownerMobile: "9833344556",
    keyHolderName: "Sunil Sharma",
    keyHolderMobile: "9844455667",
    keyHolderPersona: "Neighbour",
  });

  if (format === "csv") {
    const csvBuffer = await workbook.csv.writeBuffer();
    return Buffer.from(csvBuffer);
  } else {
    const xlsxBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(xlsxBuffer);
  }
}

// -------------------------------------------------------------
// SPREADSHEET PARSER & PREVIEW
// -------------------------------------------------------------

export async function parseAndPreviewImportFile(
  context: TenantContext,
  fileBuffer: Buffer,
  filename: string
): Promise<BulkImportPreview> {
  assertPermission(context, "supply:create");

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new ValidationError("Uploaded file is empty. Please select a valid CSV or Excel file.");
  }

  if (fileBuffer.length > MAX_IMPORT_FILE_SIZE_BYTES) {
    throw new ValidationError(
      `File size exceeds maximum allowed limit of ${MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024)} MB.`
    );
  }

  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext !== "csv" && ext !== "xlsx" && ext !== "xls") {
    throw new ValidationError("Unsupported file format. Please upload a .csv, .xlsx, or .xls file.");
  }

  const workbook = new ExcelJS.Workbook();

  try {
    if (ext === "csv") {
      const stream = new Readable();
      stream.push(fileBuffer);
      stream.push(null);
      await workbook.csv.read(stream);
    } else {
      await workbook.xlsx.load(fileBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    }
  } catch (err) {
    throw new ValidationError(
      `Failed to parse spreadsheet file: ${err instanceof Error ? err.message : "Invalid or corrupt format"}.`
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 2) {
    throw new ValidationError("Uploaded file contains no data rows. At least one property row is required.");
  }

  // 1. Map Headers from Row 1
  const headerRow = worksheet.getRow(1);
  const columnKeyMap = new Map<number, string>();

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const rawText = String(cell.value || "")
      .toLowerCase()
      .replace(/[\s*_.()/[\]\\-]/g, "");
    const canonicalKey = CANONICAL_HEADER_MAP[rawText];
    if (canonicalKey) {
      columnKeyMap.set(colNumber, canonicalKey);
    }
  });

  // Verify Required Headers
  const foundKeys = new Set(columnKeyMap.values());
  const missingRequired = REQUIRED_CANONICAL_KEYS.filter((k) => !foundKeys.has(k));

  if (missingRequired.length > 0) {
    const missingLabels = missingRequired
      .map((k) => TEMPLATE_COLUMNS.find((c) => c.key === k)?.header || k)
      .join(", ");
    return {
      filename,
      totalRows: 0,
      validCount: 0,
      errorCount: 0,
      duplicateCount: 0,
      rows: [],
      hasHeadersError: true,
      headersErrorMessage: `Missing required template columns: ${missingLabels}. Please download the official template.`,
    };
  }

  // Check max rows limit
  if (worksheet.rowCount - 1 > MAX_IMPORT_ROW_COUNT) {
    throw new ValidationError(
      `File exceeds the maximum limit of ${MAX_IMPORT_ROW_COUNT} rows per upload. Found ${worksheet.rowCount - 1} rows.`
    );
  }

  // 2. Parse & Validate Data Rows
  const parsedRows: ValidatedPropertyRow[] = [];
  const seenInFile = new Map<string, number>(); // track duplicates within file

  let rowCounter = 0;

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // Skip Header

    rowCounter++;
    if (rowCounter > MAX_IMPORT_ROW_COUNT) {
      return;
    }

    const rowData: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = columnKeyMap.get(colNumber);
      if (key) {
        let val: unknown = cell.value;
        if (typeof val === "object" && val !== null) {
          val = (val as { result?: unknown; text?: unknown }).result ?? (val as { text?: unknown }).text ?? String(val);
        }
        rowData[key] = val;
      }
    });

    const rowErrors: string[] = [];

    // Extract & Validate Fields
    const societyName = cleanString(rowData.societyName);
    if (!societyName) rowErrors.push("Society Name is required.");

    const flatNumber = cleanString(rowData.flatNumber);
    if (!flatNumber) rowErrors.push("Flat Number is required.");

    const localityName = cleanString(rowData.localityName);
    if (!localityName) rowErrors.push("Locality is required.");

    const city = cleanString(rowData.city);
    if (!city) rowErrors.push("City is required.");

    const rawPref = cleanString(rowData.preference);
    const preference = normalizePreference(rawPref);
    if (!preference) {
      rowErrors.push(`Invalid Sale/Rent Preference '${rawPref}'. Must be 'Sale' or 'Rent'.`);
    }

    const rawType = cleanString(rowData.propertyType);
    const propertyType = normalizePropertyType(rawType);
    if (!propertyType) {
      rowErrors.push(`Invalid Property Type '${rawType}'.`);
    }

    const rawFurnishing = cleanString(rowData.furnishingStatus);
    const furnishingStatus = normalizeFurnishing(rawFurnishing);
    if (!furnishingStatus) {
      rowErrors.push(`Invalid Furnishing Status '${rawFurnishing}'.`);
    }

    const rawArea = parseNumber(rowData.area);
    if (rawArea === null || rawArea <= 0) {
      rowErrors.push("Area must be a positive number greater than 0.");
    }
    const area = rawArea ?? 0;

    const rawAreaType = cleanString(rowData.areaType);
    const areaType = normalizeAreaType(rawAreaType);
    if (!areaType) {
      rowErrors.push(`Invalid Area Type '${rawAreaType}'. Must be Carpet, Built-up, or Super built-up.`);
    }

    const rawBhk = parseNumber(rowData.bedroomCount);
    if (rawBhk === null || rawBhk < 0) {
      rowErrors.push("Bedrooms must be a non-negative number.");
    }
    const bedroomCount = rawBhk !== null ? Math.floor(rawBhk) : 0;

    const rawBaths = parseNumber(rowData.bathroomCount);
    if (rawBaths === null || rawBaths < 0) {
      rowErrors.push("Bathrooms must be a non-negative number.");
    }
    const bathroomCount = rawBaths !== null ? Math.floor(rawBaths) : 0;

    const rawBalconies = parseNumber(rowData.balconyCount);
    const balconyCount = rawBalconies !== null && rawBalconies >= 0 ? Math.floor(rawBalconies) : 0;

    const rawPrice = parseNumber(rowData.price);
    if (rawPrice === null || rawPrice <= 0) {
      rowErrors.push("Price must be a positive number greater than 0.");
    }
    const price = rawPrice ?? 0;

    const rawConstruction = cleanString(rowData.constructionStatus);
    const constructionStatus = normalizeConstruction(rawConstruction);
    if (!constructionStatus) {
      rowErrors.push(`Invalid Construction Status '${rawConstruction}'. Must be Ready to Move or Under Construction.`);
    }

    const ownerName = cleanString(rowData.ownerName);
    if (!ownerName) rowErrors.push("Owner Name is required.");

    const rawOwnerMobile = normalizeMobile(rowData.ownerMobile as string | number);
    if (!/^[6-9]\d{9}$/.test(rawOwnerMobile)) {
      rowErrors.push(`Invalid Owner Mobile Number '${cleanString(rowData.ownerMobile)}'. Must be a 10-digit Indian mobile.`);
    }
    const ownerMobile = rawOwnerMobile;

    // Amenities parsing
    const rawAmenities = cleanString(rowData.amenities);
    const amenities = rawAmenities
      ? rawAmenities
          .split(/[,;|]/)
          .map((a) => a.trim())
          .filter((a) => a.length > 0)
      : [];

    // Key-Holder parsing (optional)
    const keyHolderName = cleanString(rowData.keyHolderName);
    let keyHolder: KeyHolderImportData | null = null;

    if (keyHolderName) {
      const rawKhMobile = normalizeMobile(rowData.keyHolderMobile as string | number);
      if (rawKhMobile && !/^[6-9]\d{9}$/.test(rawKhMobile)) {
        rowErrors.push(`Invalid Key-Holder Mobile Number '${cleanString(rowData.keyHolderMobile)}'.`);
      }

      const rawPersona = cleanString(rowData.keyHolderPersona);
      const persona = rawPersona ? normalizeKeyHolderPersona(rawPersona) || KeyHolderPersona.OTHER : KeyHolderPersona.OTHER;

      keyHolder = {
        name: keyHolderName,
        mobile: rawKhMobile || undefined,
        persona,
      };
    }

    // Intra-file duplicate check
    let isInternalDuplicate = false;
    let duplicateWarning: string | undefined;

    if (societyName && flatNumber) {
      const fileKey = `${societyName.toLowerCase()}|${flatNumber.toLowerCase()}`;
      if (seenInFile.has(fileKey)) {
        isInternalDuplicate = true;
        const prevRow = seenInFile.get(fileKey);
        duplicateWarning = `Duplicate in upload: Matches Row ${prevRow} (Society: '${societyName}', Flat: '${flatNumber}').`;
      } else {
        seenInFile.set(fileKey, rowNumber);
      }
    }

    parsedRows.push({
      rowNumber,
      societyName,
      flatNumber,
      localityName,
      city,
      preference: preference || TransactionType.SALE,
      propertyType: propertyType || PropertyType.APARTMENT,
      furnishingStatus: furnishingStatus || FurnishingStatus.SEMI_FURNISHED,
      constructionStatus: constructionStatus || ConstructionStatus.READY_TO_MOVE,
      bedroomCount,
      bathroomCount,
      balconyCount,
      area,
      areaType: areaType || AreaUnitType.SUPER_BUILT_UP,
      price,
      amenities,
      ownerName,
      ownerMobile,
      keyHolder,
      isValid: rowErrors.length === 0,
      errors: rowErrors,
      isDuplicate: isInternalDuplicate,
      isInternalDuplicate,
      duplicateWarning,
    });
  });

  if (rowCounter > MAX_IMPORT_ROW_COUNT) {
    throw new ValidationError(
      `Upload exceeds maximum limit of ${MAX_IMPORT_ROW_COUNT} rows per batch. Found ${rowCounter} rows.`
    );
  }

  // 3. Database Duplicate Detection (Tenant-scoped)
  const candidateKeys = parsedRows
    .filter((r) => r.isValid && !r.isInternalDuplicate)
    .map((r) => ({
      societyName: r.societyName,
      flatNumber: r.flatNumber,
    }));

  if (candidateKeys.length > 0) {
    // Find all existing properties in the tenant matching societyName and flatNumber
    const existingProperties = await prisma.property.findMany({
      where: {
        tenantId: context.tenantId, // STRICT TENANT SCOPE
        OR: candidateKeys.map((c) => ({
          societyName: { equals: c.societyName, mode: "insensitive" },
          flatNumber: { equals: c.flatNumber, mode: "insensitive" },
        })),
      },
      select: {
        id: true,
        societyName: true,
        flatNumber: true,
      },
    });

    const existingMap = new Map<string, string>();
    for (const ep of existingProperties) {
      const k = `${ep.societyName.toLowerCase()}|${ep.flatNumber.toLowerCase()}`;
      existingMap.set(k, ep.societyName);
    }

    for (const row of parsedRows) {
      if (!row.isInternalDuplicate && row.societyName && row.flatNumber) {
        const k = `${row.societyName.toLowerCase()}|${row.flatNumber.toLowerCase()}`;
        if (existingMap.has(k)) {
          row.isDuplicate = true;
          row.duplicateWarning = `Potential duplicate: Property in '${row.societyName}' with Flat '${row.flatNumber}' already exists in your brokerage.`;
        }
      }
    }
  }

  const validCount = parsedRows.filter((r) => r.isValid && !r.isInternalDuplicate && !r.isDuplicate).length;
  const duplicateCount = parsedRows.filter((r) => r.isDuplicate || r.isInternalDuplicate).length;
  const errorCount = parsedRows.filter((r) => !r.isValid).length;

  return {
    filename,
    totalRows: parsedRows.length,
    validCount,
    errorCount,
    duplicateCount,
    rows: parsedRows,
  };
}

// -------------------------------------------------------------
// EXECUTE BULK IMPORT TO DATABASE
// -------------------------------------------------------------

export interface BulkImportExecutionInput {
  rows: ValidatedPropertyRow[];
  overrideDuplicates?: boolean;
}

export async function executeBulkPropertyImport(
  context: TenantContext,
  input: BulkImportExecutionInput
): Promise<BulkImportResult> {
  assertPermission(context, "supply:create");

  if (!input.rows || input.rows.length === 0) {
    throw new ValidationError("No rows provided for import.");
  }

  // Filter rows eligible for persistence
  const rowsToImport: ValidatedPropertyRow[] = [];
  let skippedCount = 0;
  const failures: { rowNumber: number; reason: string }[] = [];

  for (const row of input.rows) {
    // 1. Skip rows with errors
    if (!row.isValid || (row.errors && row.errors.length > 0)) {
      skippedCount++;
      failures.push({
        rowNumber: row.rowNumber,
        reason: row.errors.join("; "),
      });
      continue;
    }

    // 2. Intra-file duplicate
    if (row.isInternalDuplicate) {
      skippedCount++;
      failures.push({
        rowNumber: row.rowNumber,
        reason: row.duplicateWarning || "Skipped internal duplicate in file.",
      });
      continue;
    }

    // 3. Database duplicate
    if (row.isDuplicate && !input.overrideDuplicates) {
      skippedCount++;
      failures.push({
        rowNumber: row.rowNumber,
        reason: row.duplicateWarning || "Skipped duplicate property.",
      });
      continue;
    }

    rowsToImport.push(row);
  }

  if (rowsToImport.length === 0) {
    return {
      success: true,
      totalProcessed: input.rows.length,
      importedCount: 0,
      skippedCount,
      failedCount: failures.length,
      failures,
      message: "No valid, non-duplicate properties to import.",
    };
  }

  // Persist valid rows inside Prisma transaction
  return prisma.$transaction(async (tx) => {
    let importedCount = 0;

    for (const row of rowsToImport) {
      // Build KeyHolder data if present
      let keyHolderCreate: Prisma.KeyHolderCreateWithoutPropertyInput | undefined;
      if (row.keyHolder && row.keyHolder.name?.trim()) {
        keyHolderCreate = {
          tenant: { connect: { id: context.tenantId } },
          name: row.keyHolder.name.trim(),
          mobile: row.keyHolder.mobile || "",
          persona: row.keyHolder.persona,
          notes: row.keyHolder.notes || null,
        };
      }

      await tx.property.create({
        data: {
          tenantId: context.tenantId, // STRICT SERVER-DERIVED TENANT
          submittingAgentId: context.userId, // STRICT SERVER-DERIVED SUBMITTER
          societyName: row.societyName.trim(),
          flatNumber: row.flatNumber.trim(),
          localityName: row.localityName.trim(),
          city: row.city.trim(),
          preference: row.preference,
          propertyType: row.propertyType,
          furnishingStatus: row.furnishingStatus,
          constructionStatus: row.constructionStatus,
          bedroomCount: row.bedroomCount,
          bathroomCount: row.bathroomCount,
          balconyCount: row.balconyCount,
          area: row.area,
          areaType: row.areaType,
          price: row.price,
          ownerName: row.ownerName.trim(),
          ownerMobile: row.ownerMobile,
          amenities: row.amenities || [],
          validationStatus: SupplyValidationStatus.NOT_VALIDATED, // STRICT PRD DEFAULT
          availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
          ownerWillingnessConfirmed: false, // STRICT PRD DEFAULT
          isActiveSupply: false, // STRICT PRD DEFAULT
          keyHolders: keyHolderCreate ? { create: keyHolderCreate } : undefined,
        },
      });

      importedCount++;
    }

    return {
      success: true,
      totalProcessed: input.rows.length,
      importedCount,
      skippedCount,
      failedCount: failures.length,
      failures,
      message: `Successfully imported ${importedCount} properties into Supply Validation queue.`,
    };
  });
}
