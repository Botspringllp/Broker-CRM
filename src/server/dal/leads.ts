import { prisma } from "../db";
import { TenantContext, NotFoundError, ForbiddenError } from "../tenant-context";
import { assertPermission, hasPermission } from "../permissions";
import { ValidationError } from "../errors";
import { normalizeIndianMobile } from "../utils/phone";
import { recordLeadFieldChanges, FieldComparison } from "./lead-changelog";
import { mapPrismaLeadChangeLogToView, formatIndianCurrency, formatIndianDateTime } from "./mappers";
import {
  LeadChangeLogItem,
  PendingCallbackItem,
  CallerDashboardMetrics,
  ManagerDemandMetrics,
  TelecallerWorkloadItem,
} from "@/types/crm";
import {
  Prisma,
  UserRole,
  LeadStatus,
  LeadCallingDisposition,
  CallTargetType,
  PropertyType,
  TransactionType,
  Enquiry as PrismaEnquiry,
  AssignmentMethod,
  AssignmentStatus,
  AssignmentTargetType,
} from "@prisma/client";
import {
  recordLeadAssignmentTx,
  pickRoundRobinTelecallerTx,
} from "./assignments";

export const ALLOWED_AREA_UNITS = ["sq.ft", "sq.yd", "sq.m"] as const;
export type AllowedAreaUnit = (typeof ALLOWED_AREA_UNITS)[number];

export const ALLOWED_AREA_TYPES = ["CARPET", "BUILT_UP", "SUPER_BUILT_UP"] as const;
export type AllowedAreaType = (typeof ALLOWED_AREA_TYPES)[number];

export function validateAreaRequirements(data: {
  targetArea?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  areaUnit?: string | null;
  areaType?: string | null;
}): void {
  if (data.targetArea !== undefined && data.targetArea !== null) {
    if (isNaN(Number(data.targetArea)) || Number(data.targetArea) < 0) {
      throw new ValidationError("Target area cannot be negative.");
    }
  }

  if (data.minArea !== undefined && data.minArea !== null) {
    if (isNaN(Number(data.minArea)) || Number(data.minArea) < 0) {
      throw new ValidationError("Minimum area cannot be negative.");
    }
  }

  if (data.maxArea !== undefined && data.maxArea !== null) {
    if (isNaN(Number(data.maxArea)) || Number(data.maxArea) < 0) {
      throw new ValidationError("Maximum area cannot be negative.");
    }
  }

  if (
    data.minArea !== undefined &&
    data.minArea !== null &&
    data.maxArea !== undefined &&
    data.maxArea !== null
  ) {
    if (Number(data.maxArea) < Number(data.minArea)) {
      throw new ValidationError("Maximum area cannot be less than minimum area.");
    }
  }

  if (data.areaUnit !== undefined && data.areaUnit !== null && data.areaUnit.trim() !== "") {
    if (!ALLOWED_AREA_UNITS.includes(data.areaUnit.trim() as AllowedAreaUnit)) {
      throw new ValidationError(
        `Invalid area unit '${data.areaUnit}'. Allowed units: ${ALLOWED_AREA_UNITS.join(", ")}.`
      );
    }
  }

  if (data.areaType !== undefined && data.areaType !== null) {
    if (!ALLOWED_AREA_TYPES.includes(data.areaType as AllowedAreaType)) {
      throw new ValidationError(
        `Invalid area type '${data.areaType}'. Allowed types: ${ALLOWED_AREA_TYPES.join(", ")}.`
      );
    }
  }
}

export interface CreateLeadData {
  name: string;
  primaryPhone: string;
  alternatePhone?: string;
  email?: string;
  originalSource: string;
  minBudget: number;
  maxBudget: number;
  city: string;
  preference: "SALE" | "RENT";
  bedroomConfigurations?: string[];
  propertyTypes?: ("APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT")[];
  localities?: string[];
  societies?: string[];
  targetArea?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  areaUnit?: string | null;
  areaType?: ("CARPET" | "BUILT_UP" | "SUPER_BUILT_UP") | null;
  assignedTelecallerId?: string;
  advertisedPropertyRef?: string | null;
  advertisedPropertyId?: string | null;
  enquiryDetails?: string | null;
}

export interface EditLeadData {
  id: string;
  name: string;
  primaryPhone: string;
  alternatePhone?: string | null;
  email?: string | null;
  originalSource: string;
  minBudget: number;
  maxBudget: number;
  city: string;
  preference: "SALE" | "RENT";
  bedroomConfigurations?: string[];
  propertyTypes?: ("APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT")[];
  targetArea?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  areaUnit?: string | null;
  areaType?: ("CARPET" | "BUILT_UP" | "SUPER_BUILT_UP") | null;
  societies?: string[];
  assignedTelecallerId?: string | null;
  localities?: string[];
}

export interface UpdateLeadData {
  name?: string;
  status?: LeadStatus;
  email?: string | null;
  alternatePhone?: string | null;
  assignedTelecallerId?: string | null;
  [key: string]: unknown;
}

export interface LogLeadCallInput {
  leadId: string;
  disposition: LeadCallingDisposition | string;
  notes?: string | null;
  callbackScheduledAt?: string | null;
  enquiryId?: string | null;
  isEnquiryVerified?: boolean | null;
  enquiryVerificationNotes?: string | null;
  isDoNotContact?: boolean;
}

const FULL_LEAD_INCLUDE = {
  requirement: {
    include: {
      localities: {
        include: { locality: true },
      },
    },
  },
  enquiries: {
    orderBy: { createdAt: "desc" as const },
  },
  callLogs: {
    include: {
      caller: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },
    orderBy: { calledAt: "desc" as const },
  },
  assignedTelecaller: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  assignments: {
    where: { targetType: AssignmentTargetType.LEAD },
    include: {
      assignedUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      assignedByUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: { assignedAt: "desc" as const },
  },
};

export type FullPrismaLead = Prisma.LeadGetPayload<{
  include: typeof FULL_LEAD_INCLUDE;
}>;

export interface CreateLeadResult {
  lead: FullPrismaLead;
  enquiry: PrismaEnquiry;
  enquiryId: string;
  isExistingBuyer: boolean;
  id: string; // convenient alias to lead.id
}

function buildEnquiryDetails(
  userNotes?: string | null,
  reqSummary?: {
    preference?: string;
    city?: string;
    minBudget?: number;
    maxBudget?: number;
    bedroomConfigurations?: string[];
    propertyTypes?: string[];
  } | null,
  isExistingBuyer?: boolean
): string | null {
  const parts: string[] = [];
  if (userNotes?.trim()) {
    parts.push(userNotes.trim());
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

function isTenantPhoneUniqueConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const metaTarget = error.meta?.target;
  if (Array.isArray(metaTarget)) {
    const hasPhone = metaTarget.some(
      (field) =>
        typeof field === "string" &&
        (field.includes("primaryPhone") ||
          field.includes("primary_phone") ||
          field.includes("leads_tenant_id_primary_phone_key"))
    );
    if (hasPhone) return true;
  } else if (typeof metaTarget === "string") {
    if (
      metaTarget.includes("primaryPhone") ||
      metaTarget.includes("primary_phone") ||
      metaTarget.includes("leads_tenant_id_primary_phone_key")
    ) {
      return true;
    }
  }

  if (typeof error.message === "string") {
    if (
      error.message.includes("leads_tenant_id_primary_phone_key") ||
      (error.message.includes("primaryPhone") && error.message.includes("tenantId")) ||
      (error.message.includes("primary_phone") && error.message.includes("tenant_id"))
    ) {
      return true;
    }
  }

  return false;
}

async function handleExistingBuyer(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  existingLead: FullPrismaLead,
  data: CreateLeadData,
  validatedPropertyId: string | null
): Promise<CreateLeadResult> {
  const shouldReopen = existingLead.status === LeadStatus.INACTIVE && !existingLead.isDoNotContact;
  const nextStatus = shouldReopen ? LeadStatus.NOT_YET_VALIDATED : existingLead.status;

  let nextAssignedTelecallerId = existingLead.assignedTelecallerId;
  let assignmentMethod: AssignmentMethod = AssignmentMethod.MANUAL;

  if (!nextAssignedTelecallerId) {
    if (context.role === UserRole.TELECALLER) {
      nextAssignedTelecallerId = context.userId;
      assignmentMethod = AssignmentMethod.MANUAL;
    } else if (data.assignedTelecallerId?.trim()) {
      nextAssignedTelecallerId = data.assignedTelecallerId.trim();
      assignmentMethod = AssignmentMethod.MANUAL;
    } else {
      try {
        nextAssignedTelecallerId = await pickRoundRobinTelecallerTx(tx, context.tenantId);
        assignmentMethod = AssignmentMethod.ROUND_ROBIN;
      } catch (err) {
        if (err instanceof ValidationError) {
          nextAssignedTelecallerId = null;
        } else {
          throw err;
        }
      }
    }
  }

  if (shouldReopen || nextAssignedTelecallerId !== existingLead.assignedTelecallerId) {
    const changes: FieldComparison[] = [];
    if (shouldReopen) {
      changes.push({
        fieldName: "status",
        previousValue: existingLead.status,
        newValue: nextStatus,
      });
    }
    if (nextAssignedTelecallerId !== existingLead.assignedTelecallerId) {
      changes.push({
        fieldName: "assignedTelecallerId",
        previousValue: existingLead.assignedTelecallerId,
        newValue: nextAssignedTelecallerId,
      });

      await recordLeadAssignmentTx({
        tx,
        tenantId: context.tenantId,
        leadId: existingLead.id,
        targetTelecallerId: nextAssignedTelecallerId!,
        assignedByUserId: context.userId,
        method: assignmentMethod,
      });
    }

    await recordLeadFieldChanges({
      tx,
      tenantId: context.tenantId,
      leadId: existingLead.id,
      changedByUserId: context.userId,
      changeSource: "SYSTEM",
      changes,
    });

    await tx.lead.update({
      where: { id: existingLead.id },
      data: {
        status: nextStatus,
        assignedTelecallerId: nextAssignedTelecallerId,
      },
    });
  }

  const enquiryDetails = buildEnquiryDetails(
    data.enquiryDetails,
    {
      preference: data.preference,
      city: data.city,
      minBudget: data.minBudget,
      maxBudget: data.maxBudget,
      bedroomConfigurations: data.bedroomConfigurations,
      propertyTypes: data.propertyTypes,
    },
    true
  );

  const enquiry = await tx.enquiry.create({
    data: {
      tenantId: context.tenantId,
      leadId: existingLead.id,
      source: data.originalSource.trim(),
      advertisedPropertyRef: data.advertisedPropertyRef?.trim() || null,
      advertisedPropertyId: validatedPropertyId,
      enquiryDetails,
    },
  });

  const updatedLead = await tx.lead.findUnique({
    where: { id: existingLead.id },
    include: FULL_LEAD_INCLUDE,
  });

  const finalLead = (updatedLead ?? existingLead) as FullPrismaLead;

  return {
    lead: finalLead,
    enquiry,
    enquiryId: enquiry.id,
    isExistingBuyer: true,
    id: finalLead.id,
  };
}

export interface ListLeadsFilters {
  status?: LeadStatus | Prisma.EnumLeadStatusFilter;
  preference?: TransactionType | Prisma.EnumTransactionTypeFilter;
  city?: string;
  searchTerm?: string;
  minBudget?: number;
  maxBudget?: number;
  locality?: string;
  localityId?: string;
  bedroomConfigurations?: string[];
  bedroomConfiguration?: string;
  propertyTypes?: PropertyType[];
  propertyType?: PropertyType;
  assignedTelecallerId?: string | null;
}

/**
 * Lists leads strictly scoped to the authenticated tenant.
 * - Telecallers are strictly restricted to their assigned leads.
 * - Field Verifiers, Sales Agents, and Tenant Admins have zero operational demand access.
 */
export async function listLeads(
  context: TenantContext,
  filters?: ListLeadsFilters
) {
  assertPermission(context, "demand:view_assigned");

  const where: Prisma.LeadWhereInput = {
    tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
  };

  const canViewAll = hasPermission(
    context.role,
    "demand:view_all",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  // Telecaller scoping: only assigned leads (unless granted demand:view_all)
  if (context.role === UserRole.TELECALLER && !canViewAll) {
    where.assignedTelecallerId = context.userId;
  } else if (filters?.assignedTelecallerId !== undefined) {
    if (
      filters.assignedTelecallerId === "UNASSIGNED" ||
      filters.assignedTelecallerId === "Unassigned" ||
      filters.assignedTelecallerId === null
    ) {
      where.assignedTelecallerId = null;
    } else if (filters.assignedTelecallerId !== "All") {
      where.assignedTelecallerId = filters.assignedTelecallerId;
    }
  }

  if (filters?.status) where.status = filters.status;

  const requirementWhere: Prisma.LeadRequirementWhereInput = {};

  if (filters?.preference) {
    requirementWhere.preference = filters.preference;
  }

  if (filters?.city && filters.city !== "All") {
    requirementWhere.city = filters.city.trim();
  }

  // PRD §5.6 Filter 1: Budget Range
  if (
    filters?.minBudget !== undefined &&
    filters.minBudget !== null &&
    filters?.maxBudget !== undefined &&
    filters.maxBudget !== null
  ) {
    requirementWhere.AND = [
      { maxBudget: { gte: new Prisma.Decimal(filters.minBudget) } },
      { minBudget: { lte: new Prisma.Decimal(filters.maxBudget) } },
    ];
  } else if (filters?.minBudget !== undefined && filters.minBudget !== null) {
    requirementWhere.maxBudget = { gte: new Prisma.Decimal(filters.minBudget) };
  } else if (filters?.maxBudget !== undefined && filters.maxBudget !== null) {
    requirementWhere.minBudget = { lte: new Prisma.Decimal(filters.maxBudget) };
  }

  // PRD §5.6 Filter 2: Locality (verified relational link or locality name)
  if (filters?.localityId && filters.localityId !== "All") {
    requirementWhere.localities = {
      some: { localityId: filters.localityId },
    };
  } else if (filters?.locality && filters.locality !== "All") {
    requirementWhere.localities = {
      some: {
        locality: {
          name: { equals: filters.locality.trim(), mode: "insensitive" },
        },
      },
    };
  }

  // PRD §5.6 Filter 6: Bedroom Configuration (BHK)
  const bhkList = filters?.bedroomConfigurations?.length
    ? filters.bedroomConfigurations
    : filters?.bedroomConfiguration && filters.bedroomConfiguration !== "All"
    ? [filters.bedroomConfiguration]
    : undefined;

  if (bhkList && bhkList.length > 0) {
    requirementWhere.bedroomConfigurations = {
      hasSome: bhkList,
    };
  }

  // PRD §5.6 Filter 7: Property Type
  const typeList = filters?.propertyTypes?.length
    ? filters.propertyTypes
    : filters?.propertyType
    ? [filters.propertyType]
    : undefined;

  if (typeList && typeList.length > 0) {
    requirementWhere.propertyTypes = {
      hasSome: typeList,
    };
  }

  if (Object.keys(requirementWhere).length > 0) {
    where.requirement = requirementWhere;
  }

  if (filters?.searchTerm?.trim()) {
    const term = filters.searchTerm.trim();
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { primaryPhone: { contains: term } },
    ];
  }

  return prisma.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: FULL_LEAD_INCLUDE,
  });
}

/**
 * Retrieves a lead by ID strictly scoped to the authenticated tenant and role assignment.
 * Throws NotFoundError if not found, belongs to another tenant, or not assigned to the Telecaller.
 */
export async function getLeadById(context: TenantContext, leadId: string) {
  assertPermission(context, "demand:view_assigned");

  const where: Prisma.LeadWhereInput = {
    id: leadId,
    tenantId: context.tenantId, // STRICT TENANT SCOPE
  };

  // Telecallers cannot access unassigned leads through direct URLs or APIs (unless granted demand:view_all)
  if (context.role === UserRole.TELECALLER) {
    const canViewAll = hasPermission(
      context.role,
      "demand:view_all",
      context.user?.delegatedPermissions || context.delegatedPermissions
    );
    if (!canViewAll) {
      where.assignedTelecallerId = context.userId;
    }
  }

  const lead = await prisma.lead.findFirst({
    where,
    include: FULL_LEAD_INCLUDE,
  });

  if (!lead) {
    throw new NotFoundError("Lead not found.");
  }

  return lead;
}

/**
 * Synchronizes a lead requirement's locality associations against verified locality master records.
 *
 * Rules:
 * 1. Normalize submitted locality names (trim, ignore empty, deduplicate case-insensitively).
 * 2. If localities is undefined, do not modify existing associations.
 * 3. If localities is empty array [], remove all associations.
 * 4. If localities are provided:
 *    - Query existing verified locality master records for tenantId and city.
 *    - If any submitted locality does not exist in the verified master, throw ValidationError.
 *    - Delete associations that are no longer selected.
 *    - Preserve unchanged associations.
 *    - Create newly selected LeadRequirementLocality records.
 */
export async function syncLeadRequirementLocalities({
  tx,
  tenantId,
  requirementId,
  city,
  localities,
}: {
  tx: Prisma.TransactionClient;
  tenantId: string;
  requirementId: string;
  city: string;
  localities?: string[];
}): Promise<void> {
  if (localities === undefined) {
    return;
  }

  // Normalize submitted names (trim, drop empty, case-insensitive deduplication)
  const seenLower = new Set<string>();
  const normalizedNames: string[] = [];
  for (const raw of localities) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed.length > 0 && !seenLower.has(trimmed.toLowerCase())) {
      seenLower.add(trimmed.toLowerCase());
      normalizedNames.push(trimmed);
    }
  }

  // If empty array, clear all existing associations
  if (normalizedNames.length === 0) {
    await tx.leadRequirementLocality.deleteMany({
      where: {
        tenantId,
        requirementId,
      },
    });
    return;
  }

  // Query verified locality master records for tenant and city
  const masterLocalities = await tx.locality.findMany({
    where: {
      tenantId,
      city: { equals: city.trim(), mode: "insensitive" },
    },
  });

  const matchedMasterIds: string[] = [];
  const missingNames: string[] = [];

  for (const submittedName of normalizedNames) {
    const match = masterLocalities.find(
      (ml) => ml.name.trim().toLowerCase() === submittedName.toLowerCase()
    );
    if (match) {
      matchedMasterIds.push(match.id);
    } else {
      missingNames.push(submittedName);
    }
  }

  if (missingNames.length > 0) {
    throw new ValidationError(
      `Locality '${missingNames.join(
        "', '"
      )}' does not exist in the verified locality master for city '${city.trim()}'. Please select verified master localities.`
    );
  }

  // Existing associations
  const existingAssocs = await tx.leadRequirementLocality.findMany({
    where: {
      tenantId,
      requirementId,
    },
  });

  const existingLocalityIds = new Set(existingAssocs.map((a) => a.localityId));

  // Associations to delete
  const idsToDelete = existingAssocs
    .filter((a) => !matchedMasterIds.includes(a.localityId))
    .map((a) => a.localityId);

  if (idsToDelete.length > 0) {
    await tx.leadRequirementLocality.deleteMany({
      where: {
        tenantId,
        requirementId,
        localityId: { in: idsToDelete },
      },
    });
  }

  // Associations to create
  const uniqueMasterIds = Array.from(new Set(matchedMasterIds));
  const idsToAdd = uniqueMasterIds.filter((id) => !existingLocalityIds.has(id));
  if (idsToAdd.length > 0) {
    await tx.leadRequirementLocality.createMany({
      data: idsToAdd.map((localityId) => ({
        tenantId,
        requirementId,
        localityId,
      })),
      skipDuplicates: true,
    });
  }
}

/**
 * Creates a lead within the tenant context.
 * - Enforces tenant-scoped deduplication on primaryPhone.
 * - Reuses existing buyer profile and logs a new Enquiry if already present in the tenant.
 * - Atomically registers Lead, LeadRequirement, and initial Enquiry for new prospects.
 * - Gracefully recovers from concurrent P2002 duplicate submission races.
 */
export async function createLead(
  context: TenantContext,
  data: CreateLeadData
): Promise<CreateLeadResult> {
  assertPermission(context, "demand:create");

  if (!data.name?.trim()) {
    throw new ValidationError("Prospect name is required.");
  }

  // Canonical Indian mobile normalization (enforces 10 digits starting with 6-9)
  const normalizedPhone = normalizeIndianMobile(data.primaryPhone);

  if (data.minBudget < 0 || data.maxBudget < 0) {
    throw new ValidationError("Budget values cannot be negative.");
  }

  if (data.maxBudget < data.minBudget) {
    throw new ValidationError("Maximum budget cannot be less than minimum budget.");
  }

  if (!data.city?.trim()) {
    throw new ValidationError("Target city is required.");
  }

  validateAreaRequirements(data);

  if (!data.originalSource?.trim()) {
    throw new ValidationError("Inquiry source is required.");
  }

  validateAreaRequirements(data);

  // Tenant-scoped Advertised Property Validation
  let validatedPropertyId: string | null = null;
  if (data.advertisedPropertyId?.trim()) {
    const prop = await prisma.property.findFirst({
      where: {
        id: data.advertisedPropertyId.trim(),
        tenantId: context.tenantId,
      },
      select: { id: true },
    });
    if (!prop) {
      throw new ValidationError("Referenced advertised property does not exist.");
    }
    validatedPropertyId = prop.id;
  }

  // Optional alternate phone normalization (best effort)
  let cleanedAltPhone: string | null = null;
  if (data.alternatePhone?.trim()) {
    try {
      cleanedAltPhone = normalizeIndianMobile(data.alternatePhone);
    } catch {
      cleanedAltPhone = data.alternatePhone.trim();
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Tenant-scoped buyer lookup
      const existing = await tx.lead.findFirst({
        where: {
          tenantId: context.tenantId,
          primaryPhone: normalizedPhone,
        },
        include: FULL_LEAD_INCLUDE,
      });

      if (existing) {
        return await handleExistingBuyer(
          tx,
          context,
          existing as FullPrismaLead,
          data,
          validatedPropertyId
        );
      }

      // Determine assignment for new prospect (PRD §5.6)
      let targetTelecallerId: string | null = null;
      let assignmentMethod: AssignmentMethod | null = null;

      if (context.role === UserRole.TELECALLER) {
        targetTelecallerId = context.userId;
        assignmentMethod = AssignmentMethod.MANUAL;
      } else if (data.assignedTelecallerId?.trim()) {
        targetTelecallerId = data.assignedTelecallerId.trim();
        assignmentMethod = AssignmentMethod.MANUAL;
      } else {
        // Manager did not explicitly select a telecaller -> fair round-robin
        try {
          targetTelecallerId = await pickRoundRobinTelecallerTx(tx, context.tenantId);
          assignmentMethod = AssignmentMethod.ROUND_ROBIN;
        } catch (err) {
          if (err instanceof ValidationError) {
            // Per PRD §5.6: If no active telecallers exist in the tenant, leave assignedTelecallerId null without crashing prospect creation
            targetTelecallerId = null;
            assignmentMethod = null;
          } else {
            throw err;
          }
        }
      }

      // 2. New prospect creation: Lead + Requirement + first Enquiry
      const newLead = await tx.lead.create({
        data: {
          tenantId: context.tenantId,
          name: data.name.trim(),
          primaryPhone: normalizedPhone,
          alternatePhone: cleanedAltPhone,
          email: data.email?.trim().toLowerCase() || null,
          originalSource: data.originalSource.trim(),
          assignedTelecallerId: targetTelecallerId,
          status: LeadStatus.NOT_YET_VALIDATED,
          requirement: {
            create: {
              tenantId: context.tenantId,
              minBudget: new Prisma.Decimal(data.minBudget),
              maxBudget: new Prisma.Decimal(data.maxBudget),
              city: data.city.trim(),
              preference: data.preference,
              bedroomConfigurations: data.bedroomConfigurations ?? [],
              propertyTypes: data.propertyTypes ?? [],
              societies: data.societies ?? [],
              targetArea: data.targetArea ? new Prisma.Decimal(data.targetArea) : null,
              minArea: data.minArea ? new Prisma.Decimal(data.minArea) : null,
              maxArea: data.maxArea ? new Prisma.Decimal(data.maxArea) : null,
              areaUnit: data.areaUnit?.trim() || "sq.ft",
              areaType: data.areaType ?? null,
            },
          },
          enquiries: {
            create: {
              tenantId: context.tenantId,
              source: data.originalSource.trim(),
              advertisedPropertyRef: data.advertisedPropertyRef?.trim() || null,
              advertisedPropertyId: validatedPropertyId,
              enquiryDetails: data.enquiryDetails?.trim() || null,
            },
          },
        },
        include: FULL_LEAD_INCLUDE,
      });

      // 3. Atomically create the active Assignment record if telecaller assigned
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

      let finalLead = newLead as FullPrismaLead;

      if (data.localities !== undefined && newLead.requirement) {
        await syncLeadRequirementLocalities({
          tx,
          tenantId: context.tenantId,
          requirementId: newLead.requirement.id,
          city: data.city.trim(),
          localities: data.localities,
        });

        const refreshed = await tx.lead.findUnique({
          where: {
            id_tenantId: {
              id: newLead.id,
              tenantId: context.tenantId,
            },
          },
          include: FULL_LEAD_INCLUDE,
        });
        if (refreshed) {
          finalLead = refreshed as FullPrismaLead;
        }
      }

      const initialEnquiry =
        finalLead.enquiries?.[0] ??
        ({
          id: `enquiry-${finalLead.id}`,
          tenantId: context.tenantId,
          leadId: finalLead.id,
          source: data.originalSource.trim(),
          advertisedPropertyRef: data.advertisedPropertyRef?.trim() || null,
          advertisedPropertyId: validatedPropertyId,
          enquiryDetails: data.enquiryDetails?.trim() || null,
          enquiryDate: new Date(),
          isVerifiedByCaller: false,
          callerVerificationNotes: null,
          createdAt: new Date(),
        } as unknown as PrismaEnquiry);

      return {
        lead: finalLead,
        enquiry: initialEnquiry,
        enquiryId: initialEnquiry.id,
        isExistingBuyer: false,
        id: finalLead.id,
      };
    });
  } catch (error) {
    // 3. Concurrency race-condition recovery on confirmed P2002 unique constraint
    if (isTenantPhoneUniqueConflict(error)) {
      const winnerLead = await prisma.lead.findFirst({
        where: {
          tenantId: context.tenantId,
          primaryPhone: normalizedPhone,
        },
        include: FULL_LEAD_INCLUDE,
      });

      if (winnerLead) {
        return await prisma.$transaction(async (tx) => {
          return await handleExistingBuyer(
            tx,
            context,
            winnerLead as FullPrismaLead,
            data,
            validatedPropertyId
          );
        });
      }
    }

    // Rethrow any unrelated constraint errors or exceptions
    throw error;
  }
}

/**
 * Logs an owner/prospect qualification call on a lead with audit persistence.
 * Enforces:
 * - 4 standard PRD lead dispositions.
 * - Callback scheduling requirements on CALL_BACK (cannot be in the past).
 * - PRD §5.5 unreachable attempt tracking: increments count, caller may mark Inactive at discretion (not automatic).
 * - Immediate INACTIVE transition when buyer states not looking.
 * - One later follow-up rule: allows exactly 1 subsequent call after BUYER_SAYS_NOT_LOOKING.
 * - DNC rejection: blocks calls if prospect is marked Do Not Contact.
 * - Advertised enquiry verification: updates isVerifiedByCaller and callerVerificationNotes atomically.
 * - Unreachable counter reset on successful CONNECTED call.
 */
export async function logLeadCall(context: TenantContext, input: LogLeadCallInput) {
  assertPermission(context, "demand:log_call");

  if (!input.leadId?.trim()) {
    throw new ValidationError("Lead ID is required.");
  }

  // Enforce tenant scoping and telecaller assignment via getLeadById
  const lead = await getLeadById(context, input.leadId);

  if (
    context.role === UserRole.TELECALLER &&
    lead.assignedTelecallerId &&
    lead.assignedTelecallerId !== context.userId
  ) {
    throw new ForbiddenError("Telecallers may only log calls for leads actively assigned to them.");
  }

  // DNC Enforcement: reject all calls if prospect is marked Do Not Contact
  if (lead.isDoNotContact) {
    throw new ValidationError("Cannot call lead: this prospect is marked as Do Not Contact (DNC).");
  }

  // Inactive prospect and one later follow-up rule enforcement (PRD §5.5)
  if (lead.status === LeadStatus.INACTIVE) {
    const latestNotLookingCall = await prisma.callLog.findFirst({
      where: {
        tenantId: context.tenantId,
        leadId: lead.id,
        leadDisposition: LeadCallingDisposition.BUYER_SAYS_NOT_LOOKING,
      },
      orderBy: { calledAt: "desc" },
    });

    if (!latestNotLookingCall) {
      throw new ValidationError("Cannot call lead: prospect is inactive. Re-activate the lead to resume calling.");
    }

    const followUpCallsCount = await prisma.callLog.count({
      where: {
        tenantId: context.tenantId,
        leadId: lead.id,
        calledAt: { gt: latestNotLookingCall.calledAt },
      },
    });

    if (followUpCallsCount >= 1) {
      throw new ValidationError(
        "Cannot call lead: the single permitted follow-up call after 'Not Looking' has already been used."
      );
    }
  }

  // Normalize disposition
  const rawDisp = String(input.disposition).toUpperCase().replace(/[\s/]+/g, "_");
  let normalizedDisposition: LeadCallingDisposition;
  if (rawDisp.includes("NOT_LOOKING")) {
    normalizedDisposition = LeadCallingDisposition.BUYER_SAYS_NOT_LOOKING;
  } else if (rawDisp.includes("RINGING") || rawDisp.includes("NOT_ANSWERING")) {
    normalizedDisposition = LeadCallingDisposition.RINGING_OR_NOT_ANSWERING;
  } else if (rawDisp.includes("CALL_BACK") || rawDisp.includes("CALLBACK")) {
    normalizedDisposition = LeadCallingDisposition.CALL_BACK;
  } else if (rawDisp.includes("CONNECT")) {
    normalizedDisposition = LeadCallingDisposition.CONNECTED;
  } else {
    throw new ValidationError(`Invalid lead calling disposition: '${input.disposition}'.`);
  }

  let callbackDate: Date | null = null;
  if (normalizedDisposition === LeadCallingDisposition.CALL_BACK) {
    if (!input.callbackScheduledAt?.trim()) {
      throw new ValidationError("A callback date and time is required when disposition is Call Back.");
    }
    const d = new Date(input.callbackScheduledAt);
    if (isNaN(d.getTime())) {
      throw new ValidationError("Invalid callback date and time format.");
    }
    if (d.getTime() < Date.now()) {
      throw new ValidationError("Callback date and time cannot be in the past.");
    }
    callbackDate = d;
  } else if (input.callbackScheduledAt?.trim()) {
    const d = new Date(input.callbackScheduledAt);
    if (!isNaN(d.getTime())) {
      if (d.getTime() < Date.now()) {
        throw new ValidationError("Callback date and time cannot be in the past.");
      }
      callbackDate = d;
    }
  }

  let nextStatus: LeadStatus = lead.status;
  let nextUnreachable: number = lead.unreachableAttemptsCount || 0;

  if (normalizedDisposition === LeadCallingDisposition.BUYER_SAYS_NOT_LOOKING) {
    nextStatus = LeadStatus.INACTIVE;
  } else if (normalizedDisposition === LeadCallingDisposition.RINGING_OR_NOT_ANSWERING) {
    nextUnreachable += 1;
    // PRD §5.5: After three unsuccessful attempts, the caller may mark the lead Inactive at discretion.
    // We do NOT automatically force status to INACTIVE.
  } else if (normalizedDisposition === LeadCallingDisposition.CONNECTED) {
    nextUnreachable = 0;
  }

  const markDnc = Boolean(input.isDoNotContact);
  if (markDnc) {
    nextStatus = LeadStatus.INACTIVE;
  }

  return prisma.$transaction(async (tx) => {
    // Inactive prospect concurrency lock and atomic re-verification (PRD §5.5)
    if (lead.status === LeadStatus.INACTIVE) {
      // Touching the lead row within the transaction locks the record exclusively (FOR UPDATE),
      // strictly serializing simultaneous follow-up calls on the same lead.
      await tx.lead.update({
        where: {
          id_tenantId: {
            id: lead.id,
            tenantId: context.tenantId,
          },
        },
        data: {
          updatedAt: new Date(),
        },
      });

      const latestNotLookingCallTx = await tx.callLog.findFirst({
        where: {
          tenantId: context.tenantId,
          leadId: lead.id,
          leadDisposition: LeadCallingDisposition.BUYER_SAYS_NOT_LOOKING,
        },
        orderBy: { calledAt: "desc" },
      });

      if (!latestNotLookingCallTx) {
        throw new ValidationError("Cannot call lead: prospect is inactive. Re-activate the lead to resume calling.");
      }

      const followUpCallsCountTx = await tx.callLog.count({
        where: {
          tenantId: context.tenantId,
          leadId: lead.id,
          calledAt: { gt: latestNotLookingCallTx.calledAt },
        },
      });

      if (followUpCallsCountTx >= 1) {
        throw new ValidationError(
          "Cannot call lead: the single permitted follow-up call after 'Not Looking' has already been used."
        );
      }
    }

    await tx.callLog.create({
      data: {
        tenantId: context.tenantId,
        callerId: context.userId,
        callType: CallTargetType.LEAD_VALIDATION,
        leadId: lead.id,
        leadDisposition: normalizedDisposition,
        notes: input.notes?.trim() || null,
        callbackScheduledAt: callbackDate,
      },
    });

    if (input.enquiryId?.trim()) {
      const enquiry = await tx.enquiry.findFirst({
        where: {
          id: input.enquiryId.trim(),
          tenantId: context.tenantId,
          leadId: lead.id,
        },
        select: { id: true },
      });
      if (!enquiry) {
        throw new ValidationError("Referenced enquiry does not exist for this prospect.");
      }
      await tx.enquiry.update({
        where: { id: enquiry.id },
        data: {
          isVerifiedByCaller:
            input.isEnquiryVerified !== undefined && input.isEnquiryVerified !== null
              ? Boolean(input.isEnquiryVerified)
              : true,
          callerVerificationNotes:
            input.enquiryVerificationNotes !== undefined
              ? input.enquiryVerificationNotes?.trim() || null
              : undefined,
        },
      });
    }

    const changes: FieldComparison[] = [];
    if (nextStatus !== lead.status) {
      changes.push({
        fieldName: "status",
        previousValue: lead.status,
        newValue: nextStatus,
      });
    }
    if (markDnc && !lead.isDoNotContact) {
      changes.push({
        fieldName: "isDoNotContact",
        previousValue: false,
        newValue: true,
      });
    }

    if (changes.length > 0) {
      await recordLeadFieldChanges({
        tx,
        tenantId: context.tenantId,
        leadId: lead.id,
        changedByUserId: context.userId,
        changeSource: "SYSTEM",
        changes,
      });
    }

    return tx.lead.update({
      where: {
        id_tenantId: {
          id: lead.id,
          tenantId: context.tenantId,
        },
      },
      data: {
        status: nextStatus,
        unreachableAttemptsCount: nextUnreachable,
        ...(markDnc ? { isDoNotContact: true } : {}),
      },
      include: FULL_LEAD_INCLUDE,
    });
  });
}

/**
 * Updates lead status (e.g. marking Active/Qualified or Inactive).
 */
export async function updateLeadStatus(
  context: TenantContext,
  leadId: string,
  status: LeadStatus
) {
  if (status === LeadStatus.ACTIVE) {
    assertPermission(context, "demand:activate");
  } else if (status === LeadStatus.INACTIVE) {
    assertPermission(context, "demand:inactivate");
  } else {
    assertPermission(context, "demand:log_call");
  }

  const lead = await getLeadById(context, leadId);

  return prisma.$transaction(async (tx) => {
    const changes: FieldComparison[] = [];

    if (lead.status !== status) {
      changes.push({
        fieldName: "status",
        previousValue: lead.status,
        newValue: status,
      });
    }

    if (status === LeadStatus.ACTIVE && lead.requirement) {
      if (!lead.requirement.isConfirmed) {
        changes.push({
          fieldName: "isConfirmed",
          previousValue: false,
          newValue: true,
        });
      }
      await tx.leadRequirement.update({
        where: { leadId: lead.id },
        data: { isConfirmed: true },
      });
    }

    await recordLeadFieldChanges({
      tx,
      tenantId: context.tenantId,
      leadId: lead.id,
      changedByUserId: context.userId,
      changeSource: "USER",
      changes,
    });

    return tx.lead.update({
      where: {
        id_tenantId: {
          id: lead.id,
          tenantId: context.tenantId,
        },
      },
      data: {
        status,
      },
      include: FULL_LEAD_INCLUDE,
    });
  });
}

/**
 * Updates a lead with strict allowlist validation, permission enforcement, and atomic audit logging.
 * Disallows arbitrary or unsupported field mutations to eliminate audit bypass risks.
 */
export async function updateLead(
  context: TenantContext,
  leadId: string,
  data: UpdateLeadData
) {
  if (!leadId?.trim()) {
    throw new ValidationError("Lead ID is required.");
  }

  // 1. Explicitly check and reject immutable / protected fields
  if ("primaryPhone" in data && data.primaryPhone !== undefined) {
    throw new ValidationError("Primary phone number is immutable and cannot be changed.");
  }
  if ("originalSource" in data && data.originalSource !== undefined) {
    throw new ValidationError("Lead source is immutable and cannot be changed.");
  }
  if ("sourceCreatedAt" in data && data.sourceCreatedAt !== undefined) {
    throw new ValidationError("sourceCreatedAt is immutable and cannot be changed.");
  }
  if ("isDoNotContact" in data && data.isDoNotContact !== undefined) {
    throw new ValidationError(
      "Direct modification of isDoNotContact is not permitted through generic lead updates."
    );
  }

  // 2. Strict allowlist validation: reject any unsupported field to prevent silent mutation bypass
  const ALLOWED_UPDATE_FIELDS = new Set([
    "name",
    "status",
    "email",
    "alternatePhone",
    "assignedTelecallerId",
  ]);

  for (const key of Object.keys(data)) {
    if (!ALLOWED_UPDATE_FIELDS.has(key)) {
      throw new ValidationError(`Unsupported field in update payload: '${key}'.`);
    }
  }

  // 3. Permission checks for status changes
  if (data.status === LeadStatus.ACTIVE) {
    assertPermission(context, "demand:activate");
  } else if (data.status === LeadStatus.INACTIVE) {
    assertPermission(context, "demand:inactivate");
  } else {
    assertPermission(context, "demand:log_call");
  }

  // 4. Retrieve existing lead ensuring tenant isolation & telecaller scoping
  const lead = await getLeadById(context, leadId);

  // 5. Assignment permission check if assignedTelecallerId is changing
  let targetTelecallerId = lead.assignedTelecallerId;
  if ("assignedTelecallerId" in data && data.assignedTelecallerId !== undefined) {
    const rawTelecaller = data.assignedTelecallerId ? data.assignedTelecallerId.trim() : null;
    if (rawTelecaller !== lead.assignedTelecallerId) {
      const canAssign = hasPermission(
        context.role,
        "assignment:assign_telecaller",
        context.user?.delegatedPermissions || context.delegatedPermissions
      );
      if (!canAssign) {
        throw new ForbiddenError(
          "You do not have permission to assign or reassign telecallers."
        );
      }
      targetTelecallerId = rawTelecaller;
    }
  }

  // 6. Build sanitized Prisma update payload and field comparison list
  const sanitizedUpdate: Prisma.LeadUpdateInput = {};
  const changes: FieldComparison[] = [];

  if ("name" in data && data.name !== undefined) {
    const trimmedName = data.name.trim();
    if (!trimmedName) {
      throw new ValidationError("Prospect name cannot be blank.");
    }
    sanitizedUpdate.name = trimmedName;
    changes.push({ fieldName: "name", previousValue: lead.name, newValue: trimmedName });
  }

  if ("status" in data && data.status !== undefined) {
    sanitizedUpdate.status = data.status;
    changes.push({ fieldName: "status", previousValue: lead.status, newValue: data.status });
  }

  if ("email" in data && data.email !== undefined) {
    const cleanedEmail = data.email ? data.email.trim().toLowerCase() : null;
    sanitizedUpdate.email = cleanedEmail;
    changes.push({ fieldName: "email", previousValue: lead.email, newValue: cleanedEmail });
  }

  if ("alternatePhone" in data && data.alternatePhone !== undefined) {
    const trimmedAlt = data.alternatePhone ? data.alternatePhone.trim() : null;
    sanitizedUpdate.alternatePhone = trimmedAlt;
    changes.push({
      fieldName: "alternatePhone",
      previousValue: lead.alternatePhone,
      newValue: trimmedAlt,
    });
  }

  if ("assignedTelecallerId" in data && data.assignedTelecallerId !== undefined) {
    sanitizedUpdate.assignedTelecaller = targetTelecallerId
      ? { connect: { id: targetTelecallerId } }
      : { disconnect: true };
    changes.push({
      fieldName: "assignedTelecallerId",
      previousValue: lead.assignedTelecallerId,
      newValue: targetTelecallerId,
    });
  }

  return prisma.$transaction(async (tx) => {
    // If activating lead, ensure requirement isConfirmed is synced and audited
    if (data.status === LeadStatus.ACTIVE && lead.requirement) {
      if (!lead.requirement.isConfirmed) {
        changes.push({
          fieldName: "isConfirmed",
          previousValue: false,
          newValue: true,
        });
      }
      await tx.leadRequirement.update({
        where: { leadId: lead.id },
        data: { isConfirmed: true },
      });
    }

    await recordLeadFieldChanges({
      tx,
      tenantId: context.tenantId,
      leadId: lead.id,
      changedByUserId: context.userId,
      changeSource: "USER",
      changes,
    });

    if (
      "assignedTelecallerId" in data &&
      data.assignedTelecallerId !== undefined &&
      targetTelecallerId !== lead.assignedTelecallerId
    ) {
      if (targetTelecallerId) {
        await recordLeadAssignmentTx({
          tx,
          tenantId: context.tenantId,
          leadId: lead.id,
          targetTelecallerId,
          assignedByUserId: context.userId,
          method: AssignmentMethod.MANUAL,
        });
      } else {
        const activeAssignment = await tx.assignment.findFirst({
          where: {
            leadId: lead.id,
            tenantId: context.tenantId,
            targetType: AssignmentTargetType.LEAD,
            status: AssignmentStatus.ACTIVE,
          },
        });
        if (activeAssignment) {
          await tx.assignment.update({
            where: { id: activeAssignment.id },
            data: {
              status: AssignmentStatus.REASSIGNED,
              unassignedAt: new Date(),
            },
          });
        }
      }
    }

    return tx.lead.update({
      where: {
        id_tenantId: {
          id: leadId,
          tenantId: context.tenantId,
        },
      },
      data: sanitizedUpdate,
      include: FULL_LEAD_INCLUDE,
    });
  });
}

/**
 * Edits a lead and its requirements atomically.
 * Strictly checks tenant scope and telecaller scoping via getLeadById.
 * Reassignment of telecaller is permitted only for users with "assignment:assign_telecaller".
 */
export async function editLead(context: TenantContext, data: EditLeadData) {
  if (!data.id?.trim()) {
    throw new ValidationError("Lead ID is required.");
  }

  // Reject protected fields
  const rawData = data as unknown as Record<string, unknown>;
  if ("isDoNotContact" in rawData && rawData.isDoNotContact !== undefined) {
    throw new ValidationError(
      "Direct modification of isDoNotContact is not permitted through generic lead updates."
    );
  }

  if ("sourceCreatedAt" in rawData && rawData.sourceCreatedAt !== undefined) {
    throw new ValidationError("sourceCreatedAt is immutable and cannot be changed.");
  }

  // Enforces tenant scope, permissions, and telecaller assignment via getLeadById
  const lead = await getLeadById(context, data.id);

  if (!data.name?.trim()) {
    throw new ValidationError("Prospect name is required.");
  }

  const cleanedPhone = data.primaryPhone.replace(/\D/g, "");
  if (cleanedPhone.length < 10) {
    throw new ValidationError("Valid 10-digit primary phone number is required.");
  }

  const normalizedPhone =
    cleanedPhone.length > 10 && cleanedPhone.startsWith("91")
      ? cleanedPhone.slice(-10)
      : cleanedPhone;

  // PRD §5.3 Immutability checks
  if (normalizedPhone !== lead.primaryPhone) {
    throw new ValidationError("Primary phone number is immutable and cannot be changed.");
  }

  if (data.originalSource.trim() !== lead.originalSource) {
    throw new ValidationError("Lead source is immutable and cannot be changed.");
  }

  if (data.minBudget < 0 || data.maxBudget < 0) {
    throw new ValidationError("Budget values cannot be negative.");
  }

  if (data.maxBudget < data.minBudget) {
    throw new ValidationError("Maximum budget cannot be less than minimum budget.");
  }

  if (!data.city?.trim()) {
    throw new ValidationError("Target city is required.");
  }

  validateAreaRequirements(data);

  let assignedTelecallerId = lead.assignedTelecallerId;
  const canAssignTelecaller = hasPermission(
    context.role,
    "assignment:assign_telecaller",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  if (canAssignTelecaller && data.assignedTelecallerId !== undefined) {
    assignedTelecallerId = data.assignedTelecallerId || null;
  }

  const trimmedAlternatePhone = data.alternatePhone?.trim() || null;
  const cleanedEmail = data.email?.trim().toLowerCase() || null;

  return prisma.$transaction(async (tx) => {
    // Collect field comparisons
    const changes: FieldComparison[] = [
      {
        fieldName: "name",
        previousValue: lead.name,
        newValue: data.name.trim(),
      },
      {
        fieldName: "alternatePhone",
        previousValue: lead.alternatePhone,
        newValue: trimmedAlternatePhone,
      },
      {
        fieldName: "email",
        previousValue: lead.email,
        newValue: cleanedEmail,
      },
      {
        fieldName: "assignedTelecallerId",
        previousValue: lead.assignedTelecallerId,
        newValue: assignedTelecallerId,
      },
      {
        fieldName: "minBudget",
        previousValue: lead.requirement?.minBudget ?? null,
        newValue: data.minBudget,
      },
      {
        fieldName: "maxBudget",
        previousValue: lead.requirement?.maxBudget ?? null,
        newValue: data.maxBudget,
      },
      {
        fieldName: "city",
        previousValue: lead.requirement?.city ?? null,
        newValue: data.city.trim(),
      },
      {
        fieldName: "preference",
        previousValue: lead.requirement?.preference ?? null,
        newValue: data.preference,
      },
      {
        fieldName: "bedroomConfigurations",
        previousValue: lead.requirement?.bedroomConfigurations ?? [],
        newValue: data.bedroomConfigurations ?? [],
      },
      {
        fieldName: "propertyTypes",
        previousValue: lead.requirement?.propertyTypes ?? [],
        newValue: data.propertyTypes ?? [],
      },
      {
        fieldName: "societies",
        previousValue: lead.requirement?.societies ?? [],
        newValue: data.societies ?? [],
      },
      {
        fieldName: "targetArea",
        previousValue: lead.requirement?.targetArea ?? null,
        newValue: data.targetArea !== undefined && data.targetArea !== null ? new Prisma.Decimal(data.targetArea) : null,
      },
      {
        fieldName: "minArea",
        previousValue: lead.requirement?.minArea ?? null,
        newValue: data.minArea !== undefined && data.minArea !== null ? new Prisma.Decimal(data.minArea) : null,
      },
      {
        fieldName: "maxArea",
        previousValue: lead.requirement?.maxArea ?? null,
        newValue: data.maxArea !== undefined && data.maxArea !== null ? new Prisma.Decimal(data.maxArea) : null,
      },
      {
        fieldName: "areaUnit",
        previousValue: lead.requirement?.areaUnit ?? "sq.ft",
        newValue: data.areaUnit !== undefined && data.areaUnit !== null ? data.areaUnit.trim() : "sq.ft",
      },
      {
        fieldName: "areaType",
        previousValue: lead.requirement?.areaType ?? null,
        newValue: data.areaType ?? null,
      },
    ];

    if (data.localities !== undefined) {
      const prevLocs = (lead.requirement?.localities ?? [])
        .map((l) => l.locality?.name || l.localityId)
        .filter(Boolean)
        .sort();
      const nextLocs = Array.from(
        new Set([...data.localities].map((s) => s.trim()).filter(Boolean))
      ).sort();
      changes.push({
        fieldName: "localities",
        previousValue: prevLocs,
        newValue: nextLocs,
      });
    }

    await recordLeadFieldChanges({
      tx,
      tenantId: context.tenantId,
      leadId: lead.id,
      changedByUserId: context.userId,
      changeSource: "USER",
      changes,
    });

    if (
      data.assignedTelecallerId !== undefined &&
      assignedTelecallerId !== lead.assignedTelecallerId
    ) {
      if (assignedTelecallerId) {
        await recordLeadAssignmentTx({
          tx,
          tenantId: context.tenantId,
          leadId: lead.id,
          targetTelecallerId: assignedTelecallerId,
          assignedByUserId: context.userId,
          method: AssignmentMethod.MANUAL,
        });
      } else {
        const activeAssignment = await tx.assignment.findFirst({
          where: {
            leadId: lead.id,
            tenantId: context.tenantId,
            targetType: AssignmentTargetType.LEAD,
            status: AssignmentStatus.ACTIVE,
          },
        });
        if (activeAssignment) {
          await tx.assignment.update({
            where: { id: activeAssignment.id },
            data: {
              status: AssignmentStatus.REASSIGNED,
              unassignedAt: new Date(),
            },
          });
        }
      }
    }

    await tx.lead.update({
      where: {
        id_tenantId: {
          id: lead.id,
          tenantId: context.tenantId,
        },
      },
      data: {
        name: data.name.trim(),
        alternatePhone: trimmedAlternatePhone,
        email: cleanedEmail,
        assignedTelecallerId,
      },
    });

    const updatedReq = await tx.leadRequirement.upsert({
      where: { leadId: lead.id },
      create: {
        tenantId: context.tenantId,
        leadId: lead.id,
        minBudget: new Prisma.Decimal(data.minBudget),
        maxBudget: new Prisma.Decimal(data.maxBudget),
        city: data.city.trim(),
        preference: data.preference,
        bedroomConfigurations: data.bedroomConfigurations ?? [],
        propertyTypes: data.propertyTypes ?? [],
        societies: data.societies ?? [],
        targetArea: data.targetArea !== undefined ? (data.targetArea ? new Prisma.Decimal(data.targetArea) : null) : null,
        minArea: data.minArea !== undefined ? (data.minArea ? new Prisma.Decimal(data.minArea) : null) : null,
        maxArea: data.maxArea !== undefined ? (data.maxArea ? new Prisma.Decimal(data.maxArea) : null) : null,
        areaUnit: data.areaUnit !== undefined ? (data.areaUnit?.trim() || "sq.ft") : "sq.ft",
        areaType: data.areaType ?? null,
      },
      update: {
        minBudget: new Prisma.Decimal(data.minBudget),
        maxBudget: new Prisma.Decimal(data.maxBudget),
        city: data.city.trim(),
        preference: data.preference,
        bedroomConfigurations: data.bedroomConfigurations ?? [],
        propertyTypes: data.propertyTypes ?? [],
        societies: data.societies ?? [],
        targetArea: data.targetArea !== undefined ? (data.targetArea ? new Prisma.Decimal(data.targetArea) : null) : undefined,
        minArea: data.minArea !== undefined ? (data.minArea ? new Prisma.Decimal(data.minArea) : null) : undefined,
        maxArea: data.maxArea !== undefined ? (data.maxArea ? new Prisma.Decimal(data.maxArea) : null) : undefined,
        areaUnit: data.areaUnit !== undefined ? (data.areaUnit?.trim() || "sq.ft") : undefined,
        areaType: data.areaType !== undefined ? data.areaType : undefined,
      },
    });

    if (data.localities !== undefined) {
      const reqId =
        updatedReq?.id ||
        lead.requirement?.id ||
        (await tx.leadRequirement.findUniqueOrThrow({ where: { leadId: lead.id } })).id;
      await syncLeadRequirementLocalities({
        tx,
        tenantId: context.tenantId,
        requirementId: reqId,
        city: data.city.trim(),
        localities: data.localities,
      });
    }

    return tx.lead.findUniqueOrThrow({
      where: {
        id_tenantId: {
          id: lead.id,
          tenantId: context.tenantId,
        },
      },
      include: FULL_LEAD_INCLUDE,
    });
  });
}

export interface GetLeadChangeHistoryOptions {
  limit?: number;
  offset?: number;
}

/**
 * Retrieves change history records for a lead strictly scoped to tenant context and role permissions.
 * Enforces demand:view_changelog permission and tenant/telecaller scoping via getLeadById.
 * Returns results ordered by changedAt descending, mapped safely for client consumption.
 */
export async function getLeadChangeHistory(
  context: TenantContext,
  leadId: string,
  options?: GetLeadChangeHistoryOptions
): Promise<LeadChangeLogItem[]> {
  if (!leadId?.trim()) {
    throw new ValidationError("Lead ID is required.");
  }

  // 1. Permission check
  assertPermission(context, "demand:view_changelog");

  // 2. Strict tenant scoping & telecaller assignment scoping via getLeadById
  // Throws NotFoundError if lead belongs to another tenant or telecaller is unassigned
  await getLeadById(context, leadId);

  const take = Math.min(Math.max(options?.limit ?? 100, 1), 200);
  const skip = Math.max(options?.offset ?? 0, 0);

  // 3. Query changelog scoped to tenant and lead, ordered newest first
  const logs = await prisma.leadChangeLog.findMany({
    where: {
      tenantId: context.tenantId,
      leadId,
    },
    include: {
      changedByUser: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
    orderBy: {
      changedAt: "desc",
    },
    take,
    skip,
  });

  return logs.map(mapPrismaLeadChangeLogToView);
}

/**
 * Retrieves verified master localities for a tenant and optional city.
 * Used for form autocompletion, selectors, and master data inspection.
 */
export async function getVerifiedLocalities(
  context: TenantContext,
  city?: string
) {
  assertPermission(context, "demand:view_assigned");

  return prisma.locality.findMany({
    where: {
      tenantId: context.tenantId,
      ...(city?.trim()
        ? { city: { equals: city.trim(), mode: "insensitive" } }
        : {}),
    },
    select: {
      id: true,
      name: true,
      city: true,
      latitude: true,
      longitude: true,
    },
    orderBy: { name: "asc" },
  });
}

/**
 * Marks a lead as Do Not Contact (DNC) and transitions it to INACTIVE.
 * Enforces demand:mark_dnc or demand:inactivate permission, tenant isolation, and telecaller assignment.
 * Generates audit log records for isDoNotContact (and status if changed).
 * No-op if already DNC and INACTIVE.
 */
export async function markLeadDoNotContact(
  context: TenantContext,
  leadId: string,
  reason?: string | null
): Promise<FullPrismaLead> {
  void reason;
  if (!leadId?.trim()) {
    throw new ValidationError("Lead ID is required.");
  }

  const canMarkDnc =
    hasPermission(
      context.role,
      "demand:mark_dnc",
      context.user?.delegatedPermissions || context.delegatedPermissions
    ) ||
    hasPermission(
      context.role,
      "demand:inactivate",
      context.user?.delegatedPermissions || context.delegatedPermissions
    );

  if (!canMarkDnc) {
    throw new ForbiddenError("You do not have permission to mark a prospect as Do Not Contact.");
  }

  const lead = await getLeadById(context, leadId);

  if (
    context.role === UserRole.TELECALLER &&
    lead.assignedTelecallerId &&
    lead.assignedTelecallerId !== context.userId
  ) {
    throw new ForbiddenError("Telecallers may only update leads actively assigned to them.");
  }

  if (lead.isDoNotContact && lead.status === LeadStatus.INACTIVE) {
    return prisma.lead.findUniqueOrThrow({
      where: {
        id_tenantId: {
          id: lead.id,
          tenantId: context.tenantId,
        },
      },
      include: FULL_LEAD_INCLUDE,
    });
  }

  return prisma.$transaction(async (tx) => {
    const changes: FieldComparison[] = [];

    if (!lead.isDoNotContact) {
      changes.push({
        fieldName: "isDoNotContact",
        previousValue: false,
        newValue: true,
      });
    }

    if (lead.status !== LeadStatus.INACTIVE) {
      changes.push({
        fieldName: "status",
        previousValue: lead.status,
        newValue: LeadStatus.INACTIVE,
      });
    }

    if (changes.length > 0) {
      await recordLeadFieldChanges({
        tx,
        tenantId: context.tenantId,
        leadId: lead.id,
        changedByUserId: context.userId,
        changeSource: "USER",
        changes,
      });
    }

    return tx.lead.update({
      where: {
        id_tenantId: {
          id: lead.id,
          tenantId: context.tenantId,
        },
      },
      data: {
        isDoNotContact: true,
        status: LeadStatus.INACTIVE,
      },
      include: FULL_LEAD_INCLUDE,
    });
  });
}

export interface ListPendingCallbacksOptions {
  timeframe?: "overdue" | "today" | "upcoming" | "all";
  limit?: number;
}

/**
 * Retrieves pending callbacks for the tenant context.
 * - Restricts telecallers to their assigned prospects.
 * - Excludes prospects marked as Do Not Contact (isDoNotContact = true).
 * - Excludes historical/resolved callbacks (only counts when lead's latest call was CALL_BACK).
 * - Supports filtering by timeframe: 'overdue', 'today', 'upcoming', 'all'.
 * - Formats dates with full Indian date and time (formatIndianDateTime).
 */
export async function listPendingCallbacks(
  context: TenantContext,
  options?: ListPendingCallbacksOptions
): Promise<PendingCallbackItem[]> {
  assertPermission(context, "demand:view_assigned");

  const timeframe = options?.timeframe ?? "all";
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);

  const logs = await prisma.callLog.findMany({
    where: {
      tenantId: context.tenantId,
      leadDisposition: LeadCallingDisposition.CALL_BACK,
      callbackScheduledAt: { not: null },
      lead: {
        isDoNotContact: false,
        ...(context.role === UserRole.TELECALLER ? { assignedTelecallerId: context.userId } : {}),
      },
    },
    include: {
      lead: {
        include: {
          requirement: true,
          assignedTelecaller: {
            select: { id: true, name: true, email: true },
          },
          callLogs: {
            orderBy: { calledAt: "desc" },
            take: 1,
            select: { id: true, leadDisposition: true, calledAt: true },
          },
        },
      },
    },
    orderBy: {
      callbackScheduledAt: "asc",
    },
  });

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const seenLeadIds = new Set<string>();
  const results: PendingCallbackItem[] = [];

  for (const log of logs) {
    if (!log.leadId || !log.lead || log.lead.isDoNotContact) {
      continue;
    }

    if (seenLeadIds.has(log.leadId)) {
      continue;
    }

    // Check if resolved by a later call
    if (log.lead.callLogs && log.lead.callLogs.length > 0) {
      const latestCall = log.lead.callLogs[0];
      if (latestCall.id !== log.id || latestCall.leadDisposition !== LeadCallingDisposition.CALL_BACK) {
        continue;
      }
    }

    if (!log.callbackScheduledAt) {
      continue;
    }

    const cbDate = new Date(log.callbackScheduledAt);
    if (isNaN(cbDate.getTime())) {
      continue;
    }

    const isOverdue = cbDate.getTime() < now.getTime();
    const isDueToday = cbDate.getTime() >= startOfToday.getTime() && cbDate.getTime() <= endOfToday.getTime();

    if (timeframe === "overdue" && !isOverdue) continue;
    if (timeframe === "today" && !isDueToday) continue;
    if (timeframe === "upcoming" && cbDate.getTime() <= now.getTime()) continue;

    seenLeadIds.add(log.leadId);

    const minB = log.lead.requirement?.minBudget ? Number(log.lead.requirement.minBudget) : 0;
    const maxB = log.lead.requirement?.maxBudget ? Number(log.lead.requirement.maxBudget) : 0;
    const budgetFormatted =
      log.lead.requirement && (minB > 0 || maxB > 0)
        ? `${formatIndianCurrency(minB)} - ${formatIndianCurrency(maxB)}`
        : "Not specified";

    results.push({
      callLogId: log.id,
      leadId: log.leadId,
      leadName: log.lead.name,
      primaryPhone: log.lead.primaryPhone,
      assignedTelecallerName: log.lead.assignedTelecaller?.name || "Unassigned",
      assignedTelecallerId: log.lead.assignedTelecallerId || null,
      callbackScheduledAt: cbDate.toISOString(),
      callbackFormatted: formatIndianDateTime(cbDate),
      isOverdue,
      isDueToday,
      notes: log.notes || null,
      leadStatus: log.lead.status,
      budgetFormatted,
      city: log.lead.requirement?.city || "Not specified",
    });

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

/**
 * Retrieves caller dashboard metrics scoped to the authenticated caller in their tenant.
 * - Uses targeted database-level count queries (avoids fetching full lead trees).
 * - Enforces strict tenant and caller scoping.
 * - Excludes DNC leads from actionable callback counts.
 */
export async function getCallerDashboardMetrics(
  context: TenantContext
): Promise<CallerDashboardMetrics> {
  assertPermission(context, "demand:view_assigned");

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // Scoped strictly to telecaller's assigned leads in tenant
  const leadBaseWhere: Prisma.LeadWhereInput = {
    tenantId: context.tenantId,
    assignedTelecallerId: context.userId,
  };

  const [
    assignedTotal,
    pendingValidation,
    activeLeads,
    inactiveLeads,
    unreachableNearLimit,
  ] = await Promise.all([
    prisma.lead.count({ where: leadBaseWhere }),
    prisma.lead.count({
      where: {
        ...leadBaseWhere,
        status: LeadStatus.NOT_YET_VALIDATED,
      },
    }),
    prisma.lead.count({
      where: {
        ...leadBaseWhere,
        status: LeadStatus.ACTIVE,
      },
    }),
    prisma.lead.count({
      where: {
        ...leadBaseWhere,
        status: LeadStatus.INACTIVE,
      },
    }),
    prisma.lead.count({
      where: {
        ...leadBaseWhere,
        unreachableAttemptsCount: 2,
        status: { not: LeadStatus.INACTIVE },
        isDoNotContact: false,
      },
    }),
  ]);

  // Daily calls made by this caller in tenant today
  const callBaseWhere: Prisma.CallLogWhereInput = {
    tenantId: context.tenantId,
    callerId: context.userId,
    calledAt: { gte: startOfToday, lte: endOfToday },
  };

  const [callsLoggedToday, connectedToday] = await Promise.all([
    prisma.callLog.count({ where: callBaseWhere }),
    prisma.callLog.count({
      where: {
        ...callBaseWhere,
        leadDisposition: LeadCallingDisposition.CONNECTED,
      },
    }),
  ]);

  // Scheduled callbacks for this telecaller (excludes DNC & resolved)
  const callbacks = await listPendingCallbacks(context, { timeframe: "all" });
  const callbacksDueToday = callbacks.filter((c) => c.isDueToday).length;
  const callbacksOverdue = callbacks.filter((c) => c.isOverdue).length;

  return {
    assignedTotal,
    pendingValidation,
    activeLeads,
    inactiveLeads,
    callsLoggedToday,
    connectedToday,
    callbacksDueToday,
    callbacksOverdue,
    unreachableNearLimit,
  };
}

/**
 * Retrieves manager demand metrics across the entire tenant.
 * - Restricted to managers with overview:view_brokerage_metrics or demand:view_all.
 * - Enforces strict tenant isolation.
 * - Reports overall lead counts, unassigned leads, and per-telecaller workloads.
 */
export async function getManagerDemandMetrics(
  context: TenantContext
): Promise<ManagerDemandMetrics> {
  const isManager =
    context.role === UserRole.BROKER_OWNER ||
    context.role === UserRole.TEAM_LEADER ||
    hasPermission(
      context.role,
      "overview:view_brokerage_metrics",
      context.user?.delegatedPermissions || context.delegatedPermissions
    ) ||
    hasPermission(
      context.role,
      "demand:view_all",
      context.user?.delegatedPermissions || context.delegatedPermissions
    );

  if (!isManager) {
    throw new ForbiddenError(
      "You do not have permission to view brokerage manager metrics."
    );
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const tenantWhere: Prisma.LeadWhereInput = {
    tenantId: context.tenantId,
  };

  const [
    totalLeads,
    pendingValidation,
    activeLeads,
    inactiveLeads,
    unassignedLeads,
  ] = await Promise.all([
    prisma.lead.count({ where: tenantWhere }),
    prisma.lead.count({
      where: { ...tenantWhere, status: LeadStatus.NOT_YET_VALIDATED },
    }),
    prisma.lead.count({
      where: { ...tenantWhere, status: LeadStatus.ACTIVE },
    }),
    prisma.lead.count({
      where: { ...tenantWhere, status: LeadStatus.INACTIVE },
    }),
    prisma.lead.count({
      where: { ...tenantWhere, assignedTelecallerId: null },
    }),
  ]);

  // Tenant-wide calls logged today
  const [callsLoggedToday, connectedToday] = await Promise.all([
    prisma.callLog.count({
      where: {
        tenantId: context.tenantId,
        calledAt: { gte: startOfToday, lte: endOfToday },
      },
    }),
    prisma.callLog.count({
      where: {
        tenantId: context.tenantId,
        leadDisposition: LeadCallingDisposition.CONNECTED,
        calledAt: { gte: startOfToday, lte: endOfToday },
      },
    }),
  ]);

  // Tenant-wide pending callbacks
  const allCallbacks = await listPendingCallbacks(context, { timeframe: "all" });
  const callbacksDueToday = allCallbacks.filter((c) => c.isDueToday).length;
  const callbacksOverdue = allCallbacks.filter((c) => c.isOverdue).length;

  // Active telecallers in tenant
  const eligibleTelecallers = await prisma.user.findMany({
    where: {
      tenantId: context.tenantId,
      role: UserRole.TELECALLER,
      isActive: true,
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  const telecallerWorkloads: TelecallerWorkloadItem[] = await Promise.all(
    eligibleTelecallers.map(async (t) => {
      const [activeLeadCount, pendingValidationCount] = await Promise.all([
        prisma.lead.count({
          where: {
            tenantId: context.tenantId,
            assignedTelecallerId: t.id,
            status: LeadStatus.ACTIVE,
          },
        }),
        prisma.lead.count({
          where: {
            tenantId: context.tenantId,
            assignedTelecallerId: t.id,
            status: LeadStatus.NOT_YET_VALIDATED,
          },
        }),
      ]);

      const telecallerCallbacks = allCallbacks.filter(
        (c) => c.assignedTelecallerId === t.id && c.isDueToday
      ).length;

      return {
        telecallerId: t.id,
        telecallerName: t.name,
        telecallerEmail: t.email,
        activeLeadCount,
        pendingValidationCount,
        callbacksDueTodayCount: telecallerCallbacks,
      };
    })
  );

  return {
    totalLeads,
    pendingValidation,
    activeLeads,
    inactiveLeads,
    unassignedLeads,
    callsLoggedToday,
    connectedToday,
    callbacksDueToday,
    callbacksOverdue,
    telecallerWorkloads,
  };
}
