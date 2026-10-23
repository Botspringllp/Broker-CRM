import { prisma } from "../db";
import { TenantContext, NotFoundError } from "../tenant-context";
import { assertPermission } from "../permissions";
import { Prisma, UserRole, SiteVisitItemOutcome } from "@prisma/client";

/**
 * Lists site visits strictly scoped to the authenticated tenant.
 * Field Sales Agents are strictly restricted to their assigned visits per PRD §8.2.
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
    include: {
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
        },
      },
      scheduleHistories: true,
    },
  });
}

/**
 * Retrieves a site visit by ID strictly scoped to the authenticated tenant.
 */
export async function getSiteVisitById(context: TenantContext, visitId: string) {
  assertPermission(context, "visits:view_assigned");

  const where: Prisma.SiteVisitWhereInput = {
    id: visitId,
    tenantId: context.tenantId, // STRICT TENANT SCOPE
  };

  if (context.role === UserRole.FIELD_SALES_AGENT) {
    where.assignedSalesAgentId = context.userId;
  }

  const visit = await prisma.siteVisit.findFirst({
    where,
    include: {
      items: {
        include: { property: true },
      },
      scheduleHistories: true,
    },
  });

  if (!visit) {
    throw new NotFoundError("Site visit not found.");
  }

  return visit;
}

/**
 * Records per-property visit outcome with dual-identity audit.
 */
export async function recordVisitItemOutcome(
  context: TenantContext,
  itemId: string,
  data: {
    status: SiteVisitItemOutcome;
    agentTextNotes?: string;
    voiceNoteUrl?: string;
    buyerFeedback?: string;
    reportedByUserId?: string;
  }
) {
  assertPermission(context, "visits:record_outcome");

  // Ensure item belongs to tenant
  const item = await prisma.siteVisitItem.findFirst({
    where: {
      id: itemId,
      tenantId: context.tenantId, // STRICT TENANT SCOPE
    },
  });

  if (!item) {
    throw new NotFoundError("Visit item not found.");
  }

  return prisma.siteVisitItem.update({
    where: { id: itemId },
    data: {
      status: data.status,
      agentTextNotes: data.agentTextNotes,
      voiceNoteUrl: data.voiceNoteUrl,
      buyerFeedback: data.buyerFeedback,
      reportedOutcomeAt: new Date(),
      reportedByUserId: data.reportedByUserId || context.userId,
      enteredByUserId: context.userId,
    },
  });
}

