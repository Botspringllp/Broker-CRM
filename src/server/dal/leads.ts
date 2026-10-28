import { prisma } from "../db";
import { TenantContext, NotFoundError, ForbiddenError } from "../tenant-context";
import { assertPermission, hasPermission } from "../permissions";
import { ValidationError } from "../errors";
import {
  Prisma,
  UserRole,
  LeadStatus,
  LeadCallingDisposition,
  CallTargetType,
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
  enquiries: true,
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
 */
export async function createLead(context: TenantContext, data: CreateLeadData) {
  assertPermission(context, "demand:create");

  if (!data.name?.trim()) {
    throw new ValidationError("Prospect name is required.");
  }

  const cleanedPhone = data.primaryPhone.replace(/\D/g, "");
  if (cleanedPhone.length < 10) {
    throw new ValidationError("Valid 10-digit primary phone number is required.");
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

  if (!data.originalSource?.trim()) {
    throw new ValidationError("Inquiry source is required.");
  }

  const assignedTelecallerId =
    context.role === UserRole.TELECALLER
      ? context.userId
      : data.assignedTelecallerId || null;

  return prisma.lead.create({
    data: {
      tenantId: context.tenantId,
      name: data.name.trim(),
      primaryPhone: cleanedPhone,
      alternatePhone: data.alternatePhone?.trim() || null,
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
    },
    include: FULL_LEAD_INCLUDE,
  });
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
    if (status === LeadStatus.ACTIVE && lead.requirement) {
      await tx.leadRequirement.update({
        where: { leadId: lead.id },
        data: { isConfirmed: true },
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

  await getLeadById(context, leadId);

  return prisma.lead.update({
    where: {
      id_tenantId: {
        id: leadId,
        tenantId: context.tenantId,
      },
    },
    data,
    include: FULL_LEAD_INCLUDE,
  });
}
