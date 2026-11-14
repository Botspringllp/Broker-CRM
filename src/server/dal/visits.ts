import { prisma } from "../db";
import { TenantContext, NotFoundError, ForbiddenError } from "../tenant-context";
import { assertPermission } from "../permissions";
import { ValidationError } from "../errors";
import {
  generateSiteVisitToken,
  hashSiteVisitToken,
  isValidSiteVisitTokenFormat,
} from "../tokens/site-visit-token";
import { mapPrismaSiteVisitToView } from "./mappers";
import {
  Prisma,
  UserRole,
  SiteVisitStatus,
  SiteVisitItemOutcome,
  VisitOutcomeEntryChannel,
  ScheduleChangeType,
  VisitPartyPersona,
  BuyerInterestLevel,
} from "@prisma/client";

export interface CreateSiteVisitInput {
  leadId: string;
  assignedSalesAgentId: string;
  scheduledDate: string | Date;
  propertyIds: string[];
  notes?: string;
}

export interface RescheduleSiteVisitInput {
  visitId: string;
  newScheduledDate: string | Date;
  reason: string;
}

export interface ReassignSiteVisitAgentInput {
  visitId: string;
  newSalesAgentId: string;
  reason?: string;
}

export interface CancelSiteVisitInput {
  visitId: string;
  reason: string;
  cancelledByPersona?: VisitPartyPersona;
}

export interface RecordVisitItemOutcomeInput {
  status: SiteVisitItemOutcome;
  agentTextNotes?: string;
  voiceNoteUrl?: string;
  voiceNoteDurationSeconds?: number;
  buyerFeedback?: string;
  buyerInterestLevel?: BuyerInterestLevel;
  reportedByUserId?: string;
  entryChannel?: VisitOutcomeEntryChannel;
}

export interface TokenRecordOutcomeInput {
  status: SiteVisitItemOutcome;
  agentTextNotes?: string;
  voiceNoteUrl?: string;
  voiceNoteDurationSeconds?: number;
  buyerFeedback?: string;
  buyerInterestLevel?: BuyerInterestLevel;
}

export const FULL_SITE_VISIT_INCLUDE = {
  lead: {
    select: {
      id: true,
      name: true,
      primaryPhone: true,
      alternatePhone: true,
      email: true,
    },
  },
  assignedSalesAgent: {
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
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
          preference: true,
          propertyType: true,
          furnishingStatus: true,
          area: true,
          areaType: true,
          price: true,
          amenities: true,
          keyHolders: {
            select: {
              id: true,
              name: true,
              mobile: true,
              persona: true,
              notes: true,
            },
            orderBy: { createdAt: "asc" as const },
          },
          media: {
            where: { mediaType: "PHOTO" as const },
            select: {
              id: true,
              url: true,
              caption: true,
              displayOrder: true,
            },
            orderBy: { displayOrder: "asc" as const },
          },
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
  accessLinks: {
    select: {
      id: true,
      salesAgentId: true,
      expiresAt: true,
      accessedAt: true,
      isRevoked: true,
      createdAt: true,
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
 * Retrieves site visits for a specific lead strictly scoped to the tenant.
 */
export async function getSiteVisitsForLead(context: TenantContext, leadId: string) {
  assertPermission(context, "visits:view_assigned");

  const where: Prisma.SiteVisitWhereInput = {
    tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
    leadId,
  };

  // Field sales agent scoped strictly to assigned visits
  if (context.role === UserRole.FIELD_SALES_AGENT) {
    where.assignedSalesAgentId = context.userId;
  }

  return prisma.siteVisit.findMany({
    where,
    orderBy: { scheduledDate: "desc" },
    include: FULL_SITE_VISIT_INCLUDE,
    take: 10,
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
      status: SiteVisitStatus.TENTATIVE_AWAITING_OWNER,
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
      ...(data.buyerInterestLevel ? { buyerInterestLevel: data.buyerInterestLevel } : {}),
      reportedOutcomeAt: new Date(),
      reportedByUserId: data.reportedByUserId || context.userId,
      enteredByUserId: context.userId,
      entryChannel: data.entryChannel || VisitOutcomeEntryChannel.FIELD_AGENT_DIRECT,
    },
  });

  return getSiteVisitById(context, item.siteVisitId);
}

/**
 * Confirms property owner/key-holder availability for a tentative site visit (PRD §7.1).
 * Transitions visit status strictly from TENTATIVE_AWAITING_OWNER to CONFIRMED.
 * Only authorized users with 'visits:schedule' permission in the tenant can perform this.
 */
export async function confirmSiteVisitOwnerAvailability(
  context: TenantContext,
  visitId: string
) {
  assertPermission(context, "visits:schedule");

  if (!visitId?.trim()) {
    throw new ValidationError("Visit ID is required.");
  }

  const visit = await getSiteVisitById(context, visitId.trim());

  if (visit.status !== SiteVisitStatus.TENTATIVE_AWAITING_OWNER) {
    if (visit.status === SiteVisitStatus.CONFIRMED) {
      throw new ValidationError(
        "Owner availability has already been confirmed for this site visit."
      );
    }
    if (visit.status === SiteVisitStatus.CANCELLED) {
      throw new ValidationError(
        "Cannot confirm owner availability for a cancelled site visit."
      );
    }
    if (visit.status === SiteVisitStatus.COMPLETED) {
      throw new ValidationError(
        "Cannot confirm owner availability for an already completed site visit."
      );
    }
    throw new ValidationError(
      `Cannot confirm owner availability for a site visit with status '${visit.status}'. Only tentative visits awaiting owner confirmation can be confirmed.`
    );
  }

  return prisma.siteVisit.update({
    where: { id: visit.id },
    data: {
      status: SiteVisitStatus.CONFIRMED,
    },
    include: FULL_SITE_VISIT_INCLUDE,
  });
}

export const confirmOwnerAvailability = confirmSiteVisitOwnerAvailability;

/**
 * Confirms and finalizes a completed site visit itinerary after telecaller review (PRD §7.3).
 * Authorized for Telecallers, Team Leaders, and Broker Owners.
 * Requires:
 * - Visit must NOT be tentative awaiting owner confirmation.
 * - Visit must NOT be cancelled or already completed.
 * - All itinerary items must have outcomes recorded (no item remains PENDING).
 */
export async function confirmSiteVisit(
  context: TenantContext,
  visitId: string,
  notes?: string
) {
  assertPermission(context, "visits:confirm_final");

  if (!visitId?.trim()) {
    throw new ValidationError("Visit ID is required.");
  }

  const visit = await getSiteVisitById(context, visitId.trim());

  if (visit.status === SiteVisitStatus.TENTATIVE_AWAITING_OWNER) {
    throw new ValidationError(
      "Cannot finalize a site visit that is still awaiting owner availability confirmation. Owner availability must be confirmed first."
    );
  }

  if (visit.status === SiteVisitStatus.CANCELLED) {
    throw new ValidationError("Cannot finalize a cancelled site visit.");
  }

  if (visit.status === SiteVisitStatus.COMPLETED) {
    throw new ValidationError("Site visit has already been finalized and completed.");
  }

  const items = visit.items || [];
  if (items.length === 0) {
    throw new ValidationError("Cannot finalize a site visit with no itinerary items.");
  }

  const pendingItems = items.filter(
    (item) => item.status === SiteVisitItemOutcome.PENDING
  );
  if (pendingItems.length > 0) {
    throw new ValidationError(
      `Cannot finalize site visit. ${pendingItems.length} property itinerary item(s) are still pending outcome recording.`
    );
  }

  return prisma.$transaction(async (tx) => {
    // 1. Update site visit to COMPLETED with telecaller confirmation audit (PRD §7.3)
    const updatedVisit = await tx.siteVisit.update({
      where: { id: visit.id },
      data: {
        status: SiteVisitStatus.COMPLETED,
        telecallerConfirmedAt: new Date(),
        telecallerConfirmedByUserId: context.userId,
        ...(notes?.trim() ? { notes: notes.trim() } : {}),
      },
      include: FULL_SITE_VISIT_INCLUDE,
    });

    // Revoke all active access links upon finalization/completion (DEC-M1-05 / PRD §7.3)
    if (tx.siteVisitAccessLink) {
      await tx.siteVisitAccessLink.updateMany({
        where: {
          siteVisitId: visit.id,
          tenantId: context.tenantId,
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });
    }

    // 2. Synchronize feedback to Active Supply Pool (BuyerPropertyInterest) for each itinerary item
    for (const item of items) {
      if (item.status === SiteVisitItemOutcome.PENDING) continue;

      const feedback = item.buyerFeedback?.trim() || item.agentTextNotes?.trim() || null;

      // Find existing interest record strictly scoped by tenant, lead, and property
      const existingInterest = await tx.buyerPropertyInterest.findUnique({
        where: {
          tenantId_leadId_propertyId: {
            tenantId: context.tenantId,
            leadId: visit.leadId,
            propertyId: item.propertyId,
          },
        },
      });

      let nextInterestLevel: BuyerInterestLevel | undefined;

      if (item.buyerInterestLevel) {
        // Explicitly recorded interest level is preserved
        nextInterestLevel = item.buyerInterestLevel;
      } else if (item.status === SiteVisitItemOutcome.VISIT_DONE) {
        // For completed showings without explicit interest recorded:
        // preserve existing level if available, otherwise default to MEDIUM
        nextInterestLevel = existingInterest?.interestLevel ?? BuyerInterestLevel.MEDIUM;
      } else {
        // VISIT_NOT_DONE without explicitly recorded interest:
        // Do NOT invent an interest level. Preserve existing if present.
        nextInterestLevel = existingInterest?.interestLevel;
      }

      if (existingInterest) {
        await tx.buyerPropertyInterest.update({
          where: { id: existingInterest.id },
          data: {
            ...(nextInterestLevel ? { interestLevel: nextInterestLevel } : {}),
            ...(feedback ? { feedbackNotes: feedback } : {}),
          },
        });
      } else if (nextInterestLevel) {
        await tx.buyerPropertyInterest.create({
          data: {
            tenantId: context.tenantId,
            leadId: visit.leadId,
            propertyId: item.propertyId,
            interestLevel: nextInterestLevel,
            feedbackNotes: feedback,
          },
        });
      }
    }

    return updatedVisit;
  });
}

/**
 * Reschedules a site visit and appends to the immutable schedule audit history.
 */
export async function rescheduleSiteVisit(
  context: TenantContext,
  input: RescheduleSiteVisitInput
) {
  assertPermission(context, "visits:schedule");

  if (!input.visitId?.trim()) {
    throw new ValidationError("Visit ID is required.");
  }
  if (!input.reason?.trim()) {
    throw new ValidationError("Reschedule reason is required.");
  }

  const newDate = new Date(input.newScheduledDate);
  if (isNaN(newDate.getTime())) {
    throw new ValidationError("Valid new scheduled date is required.");
  }

  const visit = await getSiteVisitById(context, input.visitId);

  return prisma.$transaction(async (tx) => {
    // 1. Revoke existing active links upon reschedule (Q14 / DEC-M1-05)
    if (tx.siteVisitAccessLink) {
      await tx.siteVisitAccessLink.updateMany({
        where: {
          siteVisitId: visit.id,
          tenantId: context.tenantId,
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });
    }

    // 2. Record in schedule history
    await tx.siteVisitScheduleHistory.create({
      data: {
        tenantId: context.tenantId,
        siteVisitId: visit.id,
        previousScheduledAt: visit.scheduledDate,
        newScheduledAt: newDate,
        changeType: ScheduleChangeType.RESCHEDULED,
        reason: input.reason.trim(),
        recordedByUserId: context.userId,
      },
    });

    return tx.siteVisit.update({
      where: { id: visit.id },
      data: {
        scheduledDate: newDate,
        status:
          visit.status === SiteVisitStatus.CANCELLED
            ? SiteVisitStatus.CONFIRMED
            : visit.status,
      },
      include: FULL_SITE_VISIT_INCLUDE,
    });
  });
}

/**
 * Reassigns the Field Sales Agent for a site visit tour.
 * Immediately revokes active access links for the previous agent (DEC-M1-05 / DEC-R-06).
 */
export async function reassignSiteVisitAgent(
  context: TenantContext,
  input: ReassignSiteVisitAgentInput
) {
  assertPermission(context, "visits:schedule");

  if (!input.visitId?.trim()) {
    throw new ValidationError("Visit ID is required.");
  }
  if (!input.newSalesAgentId?.trim()) {
    throw new ValidationError("New Sales Agent ID is required.");
  }

  const visit = await getSiteVisitById(context, input.visitId);

  const agent = await prisma.user.findFirst({
    where: {
      id: input.newSalesAgentId,
      tenantId: context.tenantId,
      isActive: true,
    },
    select: { id: true, name: true, role: true },
  });

  if (!agent) {
    throw new NotFoundError("Selected sales agent not found or inactive.");
  }

  return prisma.$transaction(async (tx) => {
    // Revoke all active links for the previous agent (DEC-M1-05 / DEC-R-06)
    if (tx.siteVisitAccessLink) {
      await tx.siteVisitAccessLink.updateMany({
        where: {
          siteVisitId: visit.id,
          tenantId: context.tenantId,
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });
    }

    return tx.siteVisit.update({
      where: { id: visit.id },
      data: {
        assignedSalesAgentId: input.newSalesAgentId,
        ...(input.reason?.trim()
          ? { notes: `${visit.notes ? visit.notes + "\n" : ""}Agent Reassigned: ${input.reason.trim()}` }
          : {}),
      },
      include: FULL_SITE_VISIT_INCLUDE,
    });
  });
}

/**
 * Cancels a site visit and records cancellation reasons and actor persona.
 * Immediately revokes all active access links for the visit (DEC-M1-05 / Q14).
 */
export async function cancelSiteVisit(
  context: TenantContext,
  input: CancelSiteVisitInput
) {
  assertPermission(context, "visits:schedule");

  if (!input.visitId?.trim()) {
    throw new ValidationError("Visit ID is required.");
  }
  if (!input.reason?.trim()) {
    throw new ValidationError("Cancellation reason is required.");
  }

  const visit = await getSiteVisitById(context, input.visitId);

  return prisma.$transaction(async (tx) => {
    // 1. Revoke all active links upon cancellation
    if (tx.siteVisitAccessLink) {
      await tx.siteVisitAccessLink.updateMany({
        where: {
          siteVisitId: visit.id,
          tenantId: context.tenantId,
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });
    }

    // 2. Record schedule history
    await tx.siteVisitScheduleHistory.create({
      data: {
        tenantId: context.tenantId,
        siteVisitId: visit.id,
        previousScheduledAt: visit.scheduledDate,
        newScheduledAt: null,
        changeType: ScheduleChangeType.CANCELLED,
        reason: input.reason.trim(),
        recordedByUserId: context.userId,
      },
    });

    return tx.siteVisit.update({
      where: { id: visit.id },
      data: {
        status: SiteVisitStatus.CANCELLED,
        cancellationReason: input.reason.trim(),
        cancelledAt: new Date(),
        cancelledByPersona: input.cancelledByPersona || VisitPartyPersona.BROKER,
      },
      include: FULL_SITE_VISIT_INCLUDE,
    });
  });
}

// ---------------------------------------------------------
// FIELD AGENT MOBILE TOKEN ACCESS & OUTCOME MUTATIONS (DV-12 Phase 4)
// ---------------------------------------------------------

/**
 * Creates or reissues a secure, time-limited mobile access link for the assigned Field Sales Agent.
 * - Enforces `visits:schedule` permission and tenant scoping.
 * - Generates a 256-bit cryptographically secure token.
 * - Stores ONLY the SHA-256 hash in `SiteVisitAccessLink.tokenHash`.
 * - Expiration is strictly 24 hours after the scheduled visit window (DEC-M1-05).
 * - Revokes any prior active links for this visit to prevent duplicate active links.
 * - Returns rawToken ONLY to the authorized caller at creation time.
 */
export async function createSiteVisitAccessLink(
  context: TenantContext,
  visitId: string
): Promise<{ rawToken: string; linkId: string; expiresAt: Date; mobileUrl: string }> {
  assertPermission(context, "visits:schedule");

  if (!visitId?.trim()) {
    throw new ValidationError("Visit ID is required.");
  }

  const visit = await prisma.siteVisit.findFirst({
    where: {
      id: visitId.trim(),
      tenantId: context.tenantId,
    },
    include: {
      assignedSalesAgent: true,
    },
  });

  if (!visit) {
    throw new NotFoundError("Site visit not found.");
  }

  if (visit.status === SiteVisitStatus.CANCELLED) {
    throw new ValidationError("Cannot generate access link for a cancelled site visit.");
  }

  if (visit.status === SiteVisitStatus.COMPLETED) {
    throw new ValidationError("Cannot generate access link for an already completed site visit.");
  }

  if (!visit.assignedSalesAgent || !visit.assignedSalesAgent.isActive) {
    throw new ValidationError("Assigned field sales agent is inactive or not found.");
  }

  const { rawToken, tokenHash } = generateSiteVisitToken();

  // Link expires 24 hours after the scheduled visit window (DEC-M1-05)
  const expiresAt = new Date(visit.scheduledDate.getTime() + 24 * 60 * 60 * 1000);

  if (expiresAt.getTime() <= Date.now()) {
    throw new ValidationError(
      "Cannot generate access link: the scheduled visit window and its 24-hour validity period have already passed. Please reschedule the visit first."
    );
  }

  return prisma.$transaction(async (tx) => {
    // Revoke any previous active links for this visit
    await tx.siteVisitAccessLink.updateMany({
      where: {
        siteVisitId: visit.id,
        tenantId: context.tenantId,
        isRevoked: false,
      },
      data: {
        isRevoked: true,
      },
    });

    const link = await tx.siteVisitAccessLink.create({
      data: {
        tenantId: context.tenantId,
        siteVisitId: visit.id,
        salesAgentId: visit.assignedSalesAgentId,
        tokenHash,
        expiresAt,
      },
    });

    return {
      rawToken,
      linkId: link.id,
      expiresAt: link.expiresAt,
      mobileUrl: `/m/visits/${rawToken}`,
    };
  });
}

/**
 * Manually revokes a specific access link.
 */
export async function revokeSiteVisitAccessLink(
  context: TenantContext,
  linkId: string
) {
  assertPermission(context, "visits:schedule");

  if (!linkId?.trim()) {
    throw new ValidationError("Link ID is required.");
  }

  const link = await prisma.siteVisitAccessLink.findFirst({
    where: {
      id: linkId.trim(),
      tenantId: context.tenantId,
    },
  });

  if (!link) {
    throw new NotFoundError("Access link not found.");
  }

  return prisma.siteVisitAccessLink.update({
    where: { id: link.id },
    data: { isRevoked: true },
  });
}

/**
 * Reusable helper to revoke all active access links for a visit within a transaction.
 */
export async function revokeActiveSiteVisitAccessLinks(
  tx: Prisma.TransactionClient,
  visitId: string,
  tenantId: string
) {
  return tx.siteVisitAccessLink.updateMany({
    where: {
      siteVisitId: visitId,
      tenantId,
      isRevoked: false,
    },
    data: {
      isRevoked: true,
    },
  });
}

/**
 * Resolves a site visit itinerary using a raw bearer token.
 * SECURITY CHECKS:
 * 1. Token format validation (64-character hex).
 * 2. Hash comparison via unique DB lookup.
 * 3. Not revoked (`isRevoked === false`).
 * 4. Not expired (`expiresAt > now`).
 * 5. Tenant is active.
 * 6. Assigned agent is still the active assigned agent.
 * 7. Visit is not cancelled.
 * 8. Updates `accessedAt`.
 * 9. Returns strictly data scoped to that visit and tenant.
 */
export async function getSiteVisitByAccessToken(rawToken: string) {
  if (!isValidSiteVisitTokenFormat(rawToken)) {
    throw new NotFoundError("Invalid or expired site visit link.");
  }

  const tokenHash = hashSiteVisitToken(rawToken);

  const link = await prisma.siteVisitAccessLink.findUnique({
    where: { tokenHash },
    include: {
      tenant: { select: { id: true, name: true, isActive: true } },
      salesAgent: { select: { id: true, name: true, email: true, isActive: true } },
      siteVisit: {
        include: FULL_SITE_VISIT_INCLUDE,
      },
    },
  });

  if (!link) {
    throw new NotFoundError("Invalid or expired site visit link.");
  }

  if (link.isRevoked) {
    if (link.siteVisit.status === SiteVisitStatus.COMPLETED) {
      throw new ForbiddenError(
        "This site visit has already been finalized and completed. This access link has been closed."
      );
    }
    throw new ForbiddenError(
      "This site visit access link has been revoked. Please contact your coordinator for a new link."
    );
  }

  if (link.expiresAt.getTime() <= Date.now()) {
    throw new ForbiddenError(
      "This site visit access link has expired. Links remain valid for 24 hours after the scheduled visit."
    );
  }

  if (!link.tenant.isActive) {
    throw new ForbiddenError("Tenant brokerage organization is currently inactive.");
  }

  if (!link.salesAgent.isActive) {
    throw new ForbiddenError("Assigned field sales agent is inactive.");
  }

  if (link.siteVisit.status === SiteVisitStatus.CANCELLED) {
    throw new ForbiddenError("This site visit has been cancelled.");
  }

  if (link.siteVisit.assignedSalesAgentId !== link.salesAgentId) {
    throw new ForbiddenError(
      "This site visit has been reassigned to another agent. This link is no longer valid."
    );
  }

  // Update accessedAt timestamp
  await prisma.siteVisitAccessLink.update({
    where: { id: link.id },
    data: { accessedAt: new Date() },
  });

  return {
    linkId: link.id,
    expiresAt: link.expiresAt,
    tenantName: link.tenant.name,
    salesAgentName: link.salesAgent.name,
    salesAgentId: link.salesAgent.id,
    visit: mapPrismaSiteVisitToView(link.siteVisit),
    rawVisit: link.siteVisit,
  };
}

/**
 * Records per-property visit outcome submitted directly by the field sales agent via their bearer token.
 * PRD §7.3 & PRD §8.3 INVARIANTS:
 * - Scoped strictly to the token's visit and tenant.
 * - Item ID must belong to this specific itinerary.
 * - Rejected if visit is cancelled or completed.
 * - Sets `reportedByUserId` and `enteredByUserId` to `link.salesAgentId`.
 * - Sets `entryChannel = FIELD_AGENT_DIRECT`.
 * - Preserves dual-identity audit trail.
 * - Does NOT finalize the parent SiteVisit (telecaller confirmation is separate).
 */
export async function recordVisitItemOutcomeViaToken(
  rawToken: string,
  itemId: string,
  input: TokenRecordOutcomeInput
) {
  if (!isValidSiteVisitTokenFormat(rawToken)) {
    throw new NotFoundError("Invalid or expired site visit link.");
  }

  if (!itemId?.trim()) {
    throw new ValidationError("Itinerary item ID is required.");
  }

  if (
    input.status !== SiteVisitItemOutcome.VISIT_DONE &&
    input.status !== SiteVisitItemOutcome.VISIT_NOT_DONE
  ) {
    throw new ValidationError("Outcome status must be either 'VISIT_DONE' or 'VISIT_NOT_DONE'.");
  }

  const tokenHash = hashSiteVisitToken(rawToken);

  const link = await prisma.siteVisitAccessLink.findUnique({
    where: { tokenHash },
    include: {
      tenant: { select: { id: true, isActive: true } },
      salesAgent: { select: { id: true, isActive: true } },
      siteVisit: { select: { id: true, status: true, assignedSalesAgentId: true } },
    },
  });

  if (!link) {
    throw new NotFoundError("Invalid or expired site visit link.");
  }

  if (link.siteVisit.status === SiteVisitStatus.COMPLETED) {
    throw new ForbiddenError(
      "Cannot modify outcomes for an already finalized site visit. Outcome editing is locked."
    );
  }

  if (link.isRevoked) {
    throw new ForbiddenError("This site visit link has been revoked.");
  }

  if (link.expiresAt.getTime() <= Date.now()) {
    throw new ForbiddenError("This site visit link has expired.");
  }

  if (!link.tenant.isActive) {
    throw new ForbiddenError("Tenant brokerage organization is currently inactive.");
  }

  if (!link.salesAgent.isActive) {
    throw new ForbiddenError("Assigned field sales agent is inactive.");
  }

  if (link.siteVisit.status === SiteVisitStatus.CANCELLED) {
    throw new ForbiddenError("Cannot record outcome for a cancelled site visit.");
  }

  if (link.siteVisit.assignedSalesAgentId !== link.salesAgentId) {
    throw new ForbiddenError("This site visit has been reassigned to another agent.");
  }

  // Ensure item belongs to this exact site visit and tenant
  const item = await prisma.siteVisitItem.findFirst({
    where: {
      id: itemId.trim(),
      siteVisitId: link.siteVisit.id,
      tenantId: link.tenant.id,
    },
  });

  if (!item) {
    throw new NotFoundError("Itinerary item not found in this site visit.");
  }

  // Validate voiceNoteUrl if provided
  let validatedVoiceUrl: string | null = null;
  if (input.voiceNoteUrl && typeof input.voiceNoteUrl === "string") {
    const trimmed = input.voiceNoteUrl.trim();
    if (trimmed.length > 0) {
      if (trimmed.length > 2000) {
        throw new ValidationError("Voice note URL exceeds maximum permitted length.");
      }
      validatedVoiceUrl = trimmed;
    }
  }

  // Validate voiceNoteDurationSeconds if provided
  let validatedDuration: number | null = null;
  if (
    input.voiceNoteDurationSeconds !== undefined &&
    input.voiceNoteDurationSeconds !== null
  ) {
    const d = Number(input.voiceNoteDurationSeconds);
    if (isNaN(d) || d < 0 || !Number.isInteger(d)) {
      throw new ValidationError("Voice note duration must be a non-negative integer (seconds).");
    }
    validatedDuration = d;
  }

  // Update item with dual-identity audit:
  // reportedByUserId = link.salesAgentId (assigned agent)
  // enteredByUserId = link.salesAgentId (assigned agent performing the direct mobile submission)
  // entryChannel = FIELD_AGENT_DIRECT
  await prisma.siteVisitItem.update({
    where: { id: item.id },
    data: {
      status: input.status,
      agentTextNotes: input.agentTextNotes?.trim() || null,
      voiceNoteUrl: validatedVoiceUrl,
      voiceNoteDurationSeconds: validatedDuration,
      buyerFeedback: input.buyerFeedback?.trim() || null,
      ...(input.buyerInterestLevel ? { buyerInterestLevel: input.buyerInterestLevel } : {}),
      reportedOutcomeAt: new Date(),
      reportedByUserId: link.salesAgentId,
      enteredByUserId: link.salesAgentId,
      entryChannel: VisitOutcomeEntryChannel.FIELD_AGENT_DIRECT,
    },
  });

  return getSiteVisitByAccessToken(rawToken);
}
