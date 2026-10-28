import { prisma } from "../db";
import { TenantContext, NotFoundError, ForbiddenError } from "../tenant-context";
import { assertPermission } from "../permissions";
import { ValidationError } from "../errors";
import {
  Prisma,
  UserRole,
  SiteVisitStatus,
  SiteVisitItemOutcome,
  VisitOutcomeEntryChannel,
} from "@prisma/client";

export interface CreateSiteVisitInput {
  leadId: string;
  assignedSalesAgentId: string;
  scheduledDate: string | Date;
  propertyIds: string[];
  notes?: string;
}

export interface RecordVisitItemOutcomeInput {
  status: SiteVisitItemOutcome;
  agentTextNotes?: string;
  voiceNoteUrl?: string;
  buyerFeedback?: string;
  reportedByUserId?: string;
  entryChannel?: VisitOutcomeEntryChannel;
}

const FULL_SITE_VISIT_INCLUDE = {
  lead: {
    select: {
      id: true,
      name: true,
      primaryPhone: true,
    },
  },
  assignedSalesAgent: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  telecallerConfirmedByUser: {
    select: {
      id: true,
      name: true,
      role: true,
    },
  },
  items: {
    include: {
      property: {
        select: {
          id: true,
          societyName: true,
          localityName: true,
          city: true,
          bedroomCount: true,
          flatNumber: true,
          ownerName: true,
          ownerMobile: true,
        },
      },
      reportedByUser: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
      enteredByUser: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },
    orderBy: { visitOrder: "asc" as const },
  },
  scheduleHistories: {
    include: {
      recordedByUser: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" as const },
  },
};

/**
 * Lists site visits strictly scoped to the authenticated tenant.
 * - Field Sales Agents are strictly restricted to their assigned visits per PRD §8.2.
 * - Telecallers and Broker Owners can view all tenant site visits.
 * - Field Verifiers and Tenant Admins have zero operational visit access.
 */
export async function listSiteVisits(context: TenantContext) {
  assertPermission(context, "visits:view_assigned");

  const where: Prisma.SiteVisitWhereInput = {
    tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
  };

  // Field sales agent scoped strictly to assigned visits
  if (context.role === UserRole.FIELD_SALES_AGENT) {
    where.assignedSalesAgentId = context.userId;
  }

  return prisma.siteVisit.findMany({
    where,
    orderBy: { scheduledDate: "asc" },
    include: FULL_SITE_VISIT_INCLUDE,
  });
}

/**
 * Retrieves a site visit by ID strictly scoped to the authenticated tenant.
 * Denies access if not found or if a Field Sales Agent requests an unassigned visit.
 */
export async function getSiteVisitById(context: TenantContext, visitId: string) {
  assertPermission(context, "visits:view_assigned");

  const where: Prisma.SiteVisitWhereInput = {
    id: visitId,
    tenantId: context.tenantId, // STRICT TENANT SCOPE
  };

  // Field Sales Agent: deny unassigned visits even if ID is known
  if (context.role === UserRole.FIELD_SALES_AGENT) {
    where.assignedSalesAgentId = context.userId;
  }

  const visit = await prisma.siteVisit.findFirst({
    where,
    include: FULL_SITE_VISIT_INCLUDE,
  });

  if (!visit) {
    throw new NotFoundError("Site visit not found.");
  }

  return visit;
}

/**
 * Creates and schedules a multi-property site visit.
 * Validates:
 * - Lead exists in tenant.
 * - Assigned agent is an active Sales Agent in tenant.
 * - All selected properties exist in tenant and belong to Active Supply Pool.
 */
export async function createSiteVisit(context: TenantContext, input: CreateSiteVisitInput) {
  assertPermission(context, "visits:schedule");

  if (!input.leadId?.trim()) {
    throw new ValidationError("Prospect / Lead is required.");
  }

  if (!input.assignedSalesAgentId?.trim()) {
    throw new ValidationError("Field Sales Agent assignment is required.");
  }

  if (!input.propertyIds || input.propertyIds.length === 0) {
    throw new ValidationError("At least one property must be selected for the site visit tour.");
  }

  const schedDate = new Date(input.scheduledDate);
  if (isNaN(schedDate.getTime())) {
    throw new ValidationError("Invalid scheduled date format.");
  }

  // 1. Verify lead exists in tenant
  const lead = await prisma.lead.findFirst({
    where: {
      id: input.leadId,
      tenantId: context.tenantId,
    },
    select: { id: true, name: true, status: true },
  });

  if (!lead) {
    throw new NotFoundError("Selected lead not found in your brokerage.");
  }

  // 2. Verify assigned sales agent exists in tenant
  const agent = await prisma.user.findFirst({
    where: {
      id: input.assignedSalesAgentId,
      tenantId: context.tenantId,
      isActive: true,
    },
    select: { id: true, name: true, role: true },
  });

  if (!agent) {
    throw new NotFoundError("Selected sales agent not found or inactive.");
  }

  // 3. Verify all properties belong to tenant and are in Active Supply Pool
  const properties = await prisma.property.findMany({
    where: {
      id: { in: input.propertyIds },
      tenantId: context.tenantId,
    },
    select: {
      id: true,
      societyName: true,
      isActiveSupply: true,
      availabilityStatus: true,
    },
  });

  if (properties.length !== input.propertyIds.length) {
    throw new ValidationError("One or more selected properties could not be found in your brokerage.");
  }

  const ineligible = properties.filter(
    (p) => !p.isActiveSupply || p.availabilityStatus !== "AVAILABLE"
  );
  if (ineligible.length > 0) {
    throw new ValidationError(
      `Property '${ineligible[0].societyName}' is not currently available in the Active Supply Pool.`
    );
  }

  // 4. Create site visit and itinerary items
  return prisma.siteVisit.create({
    data: {
      tenantId: context.tenantId,
      leadId: input.leadId,
      assignedSalesAgentId: input.assignedSalesAgentId,
      scheduledDate: schedDate,
      status: SiteVisitStatus.CONFIRMED,
      notes: input.notes?.trim() || null,
      items: {
        create: input.propertyIds.map((propId, idx) => ({
          tenantId: context.tenantId,
          propertyId: propId,
          visitOrder: idx + 1,
          status: SiteVisitItemOutcome.PENDING,
          enteredByUserId: context.userId,
        })),
      },
    },
    include: FULL_SITE_VISIT_INCLUDE,
  });
}

/**
 * Records per-property visit outcome with dual-identity audit.
 * Field Sales Agents can only record outcomes on their assigned visit items.
 */
export async function recordVisitItemOutcome(
  context: TenantContext,
  itemId: string,
  data: RecordVisitItemOutcomeInput
) {
  assertPermission(context, "visits:record_outcome");

  // Ensure item belongs to tenant
  const item = await prisma.siteVisitItem.findFirst({
    where: {
      id: itemId,
      tenantId: context.tenantId, // STRICT TENANT SCOPE
    },
    include: {
      siteVisit: true,
    },
  });

  if (!item) {
    throw new NotFoundError("Visit item not found.");
  }

  // If actor is Field Sales Agent, assert this visit is assigned to them
  if (
    context.role === UserRole.FIELD_SALES_AGENT &&
    item.siteVisit.assignedSalesAgentId !== context.userId
  ) {
    throw new ForbiddenError("Cannot record outcome on unassigned visit.");
  }

  await prisma.siteVisitItem.update({
    where: { id: itemId },
    data: {
      status: data.status,
      agentTextNotes: data.agentTextNotes?.trim() || null,
      voiceNoteUrl: data.voiceNoteUrl || null,
      buyerFeedback: data.buyerFeedback?.trim() || null,
      reportedOutcomeAt: new Date(),
      reportedByUserId: data.reportedByUserId || context.userId,
      enteredByUserId: context.userId,
      entryChannel: data.entryChannel || VisitOutcomeEntryChannel.FIELD_AGENT_DIRECT,
    },
  });

  return getSiteVisitById(context, item.siteVisitId);
}

/**
 * Confirms and finalizes a completed site visit itinerary.
 * Authorized for Telecallers, Team Leaders, and Broker Owners.
 */
export async function confirmSiteVisit(
  context: TenantContext,
  visitId: string,
  notes?: string
) {
  assertPermission(context, "visits:confirm_final");

  const visit = await getSiteVisitById(context, visitId);

  return prisma.siteVisit.update({
    where: { id: visit.id },
    data: {
      status: SiteVisitStatus.COMPLETED,
      telecallerConfirmedAt: new Date(),
      telecallerConfirmedByUserId: context.userId,
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
    },
    include: FULL_SITE_VISIT_INCLUDE,
  });
}
