import { prisma } from "../db";
import { TenantContext, NotFoundError, ForbiddenError } from "../tenant-context";
import { assertPermission, hasPermission } from "../permissions";
import { ValidationError } from "../errors";
import { normalizeIndianMobile } from "../utils/phone";
import { recordLeadFieldChanges, FieldComparison } from "./lead-changelog";
import {
  Prisma,
  UserRole,
  LeadStatus,
  LeadCallingDisposition,
  CallTargetType,
  Enquiry as PrismaEnquiry,
} from "@prisma/client";

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
  areaType?: ("CARPET" | "BUILT_UP" | "SUPER_BUILT_UP") | null;
  societies?: string[];
  assignedTelecallerId?: string | null;
  localities?: string[];
}

export interface LogLeadCallInput {
  leadId: string;
  disposition: LeadCallingDisposition | string;
  notes?: string | null;
  callbackScheduledAt?: string | null;
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
  const shouldReopen = existingLead.status === LeadStatus.INACTIVE;
  const nextStatus = shouldReopen ? LeadStatus.NOT_YET_VALIDATED : existingLead.status;

  let nextAssignedTelecallerId = existingLead.assignedTelecallerId;
  if (!nextAssignedTelecallerId) {
    if (context.role === UserRole.TELECALLER) {
      nextAssignedTelecallerId = context.userId;
    } else if (data.assignedTelecallerId) {
      nextAssignedTelecallerId = data.assignedTelecallerId;
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

/**
 * Lists leads strictly scoped to the authenticated tenant.
 * - Telecallers are strictly restricted to their assigned leads.
 * - Field Verifiers, Sales Agents, and Tenant Admins have zero operational demand access.
 */
export async function listLeads(
  context: TenantContext,
  filters?: {
    status?: Prisma.EnumLeadStatusFilter;
    preference?: Prisma.EnumTransactionTypeFilter;
    city?: string;
    searchTerm?: string;
  }
) {
  assertPermission(context, "demand:view_assigned");

  const where: Prisma.LeadWhereInput = {
    tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
  };

  // Telecaller scoping: only assigned leads (unless granted demand:view_all)
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

  if (filters?.status) where.status = filters.status;
  if (filters?.city) {
    where.requirement = { city: filters.city };
  }

  if (filters?.searchTerm) {
    where.OR = [
      { name: { contains: filters.searchTerm, mode: "insensitive" } },
      { primaryPhone: { contains: filters.searchTerm } },
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

  if (!data.originalSource?.trim()) {
    throw new ValidationError("Inquiry source is required.");
  }

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

  const assignedTelecallerId =
    context.role === UserRole.TELECALLER
      ? context.userId
      : data.assignedTelecallerId || null;

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

      // 2. New prospect creation: Lead + Requirement + first Enquiry
      const newLead = await tx.lead.create({
        data: {
          tenantId: context.tenantId,
          name: data.name.trim(),
          primaryPhone: normalizedPhone,
          alternatePhone: cleanedAltPhone,
          email: data.email?.trim().toLowerCase() || null,
          originalSource: data.originalSource.trim(),
          assignedTelecallerId,
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

      const initialEnquiry =
        newLead.enquiries?.[0] ??
        ({
          id: `enquiry-${newLead.id}`,
          tenantId: context.tenantId,
          leadId: newLead.id,
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
        lead: newLead as FullPrismaLead,
        enquiry: initialEnquiry,
        enquiryId: initialEnquiry.id,
        isExistingBuyer: false,
        id: newLead.id,
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
 * - Callback scheduling requirements on CALL_BACK.
 * - 3-attempt unreachable threshold (automatically marks lead INACTIVE on 3 consecutive unreachable attempts).
 * - Immediate INACTIVE transition when buyer states not looking.
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
    callbackDate = d;
  } else if (input.callbackScheduledAt?.trim()) {
    const d = new Date(input.callbackScheduledAt);
    if (!isNaN(d.getTime())) {
      callbackDate = d;
    }
  }

  let nextStatus: LeadStatus = lead.status;
  let nextUnreachable: number = lead.unreachableAttemptsCount || 0;

  if (normalizedDisposition === LeadCallingDisposition.BUYER_SAYS_NOT_LOOKING) {
    nextStatus = LeadStatus.INACTIVE;
  } else if (normalizedDisposition === LeadCallingDisposition.RINGING_OR_NOT_ANSWERING) {
    nextUnreachable += 1;
    if (nextUnreachable >= 3) {
      nextStatus = LeadStatus.INACTIVE;
    }
  } else if (normalizedDisposition === LeadCallingDisposition.CONNECTED) {
    nextUnreachable = 0;
  }

  return prisma.$transaction(async (tx) => {
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

    if (nextStatus !== lead.status) {
      await recordLeadFieldChanges({
        tx,
        tenantId: context.tenantId,
        leadId: lead.id,
        changedByUserId: context.userId,
        changeSource: "SYSTEM",
        changes: [
          {
            fieldName: "status",
            previousValue: lead.status,
            newValue: nextStatus,
          },
        ],
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
 * Updates a lead atomically enforcing tenant scope and permission checks.
 */
export async function updateLead(
  context: TenantContext,
  leadId: string,
  data: Prisma.LeadUpdateInput
) {
  if (
    data.status === "ACTIVE" ||
    (typeof data.status === "object" && (data.status as { set?: string }).set === "ACTIVE")
  ) {
    assertPermission(context, "demand:activate");
  } else if (
    data.status === "INACTIVE" ||
    (typeof data.status === "object" && (data.status as { set?: string }).set === "INACTIVE")
  ) {
    assertPermission(context, "demand:inactivate");
  } else {
    assertPermission(context, "demand:log_call");
  }

  const lead = await getLeadById(context, leadId);

  // Enforce field immutability (PRD §5.3)
  if (data.primaryPhone !== undefined) {
    const raw =
      typeof data.primaryPhone === "string"
        ? data.primaryPhone
        : (data.primaryPhone as { set?: string }).set;
    if (raw && raw !== lead.primaryPhone) {
      throw new ValidationError("Primary phone number is immutable and cannot be changed.");
    }
  }
  if (data.originalSource !== undefined) {
    const raw =
      typeof data.originalSource === "string"
        ? data.originalSource
        : (data.originalSource as { set?: string }).set;
    if (raw && raw !== lead.originalSource) {
      throw new ValidationError("Lead source is immutable and cannot be changed.");
    }
  }
  if (data.sourceCreatedAt !== undefined) {
    throw new ValidationError("sourceCreatedAt is immutable and cannot be changed.");
  }

  return prisma.$transaction(async (tx) => {
    const changes: FieldComparison[] = [];
    if (data.name !== undefined) {
      const val = typeof data.name === "string" ? data.name : (data.name as { set?: string }).set;
      changes.push({ fieldName: "name", previousValue: lead.name, newValue: val });
    }
    if (data.status !== undefined) {
      const val =
        typeof data.status === "string"
          ? data.status
          : (data.status as { set?: LeadStatus }).set;
      changes.push({ fieldName: "status", previousValue: lead.status, newValue: val });
    }
    if (data.email !== undefined) {
      const val =
        typeof data.email === "string"
          ? data.email
          : (data.email as { set?: string | null }).set;
      changes.push({ fieldName: "email", previousValue: lead.email, newValue: val });
    }
    if (data.alternatePhone !== undefined) {
      const val =
        typeof data.alternatePhone === "string"
          ? data.alternatePhone
          : (data.alternatePhone as { set?: string | null }).set;
      changes.push({ fieldName: "alternatePhone", previousValue: lead.alternatePhone, newValue: val });
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
          id: leadId,
          tenantId: context.tenantId,
        },
      },
      data,
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
        newValue: data.targetArea ? new Prisma.Decimal(data.targetArea) : null,
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
      const nextLocs = [...data.localities].map((s) => s.trim()).filter(Boolean).sort();
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

    await tx.leadRequirement.upsert({
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
        targetArea: data.targetArea ? new Prisma.Decimal(data.targetArea) : null,
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
        targetArea: data.targetArea ? new Prisma.Decimal(data.targetArea) : null,
        areaType: data.areaType ?? null,
      },
    });

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
