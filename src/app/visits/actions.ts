"use server";

import { requireTenantContext } from "@/server/tenant-context";
import { headers } from "next/headers";
import { checkRateLimit } from "@/server/security/rate-limiter";
import {
  createSiteVisit,
  recordVisitItemOutcome,
  confirmSiteVisit,
  confirmSiteVisitOwnerAvailability,
  getSiteVisitById,
  rescheduleSiteVisit,
  reassignSiteVisitAgent,
  cancelSiteVisit,
  createSiteVisitAccessLink,
  revokeSiteVisitAccessLink,
  getSiteVisitByAccessToken,
  recordVisitItemOutcomeViaToken,
  CreateSiteVisitInput,
  RecordVisitItemOutcomeInput,
  RescheduleSiteVisitInput,
  ReassignSiteVisitAgentInput,
  CancelSiteVisitInput,
  TokenRecordOutcomeInput,
} from "@/server/dal/visits";
import { mapPrismaSiteVisitToView } from "@/server/dal/mappers";
import { revalidatePath } from "next/cache";

export async function createSiteVisitAction(input: CreateSiteVisitInput) {
  try {
    const context = await requireTenantContext();
    const created = await createSiteVisit(context, input);
    revalidatePath("/visits");
    revalidatePath("/");
    revalidatePath(`/leads/${input.leadId}`);
    return {
      success: true as const,
      visit: mapPrismaSiteVisitToView(created),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to schedule site visit.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function recordVisitItemOutcomeAction(input: {
  itemId: string;
  data: RecordVisitItemOutcomeInput;
}) {
  try {
    const context = await requireTenantContext();
    const updatedVisit = await recordVisitItemOutcome(context, input.itemId, input.data);
    revalidatePath("/visits");
    revalidatePath("/");
    return {
      success: true as const,
      visit: mapPrismaSiteVisitToView(updatedVisit),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record property outcome.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function confirmSiteVisitOwnerAvailabilityAction(input: {
  visitId: string;
}) {
  try {
    const context = await requireTenantContext();
    const updated = await confirmSiteVisitOwnerAvailability(context, input.visitId);
    revalidatePath("/visits");
    revalidatePath(`/visits/${input.visitId}`);
    revalidatePath("/");
    return {
      success: true as const,
      visit: mapPrismaSiteVisitToView(updated),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to confirm owner availability.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export const confirmOwnerAvailabilityAction = confirmSiteVisitOwnerAvailabilityAction;

export async function confirmSiteVisitAction(input: {
  visitId: string;
  notes?: string;
}) {
  try {
    const context = await requireTenantContext();
    const updatedVisit = await confirmSiteVisit(context, input.visitId, input.notes);
    revalidatePath("/visits");
    revalidatePath(`/visits/${input.visitId}`);
    revalidatePath("/");
    return {
      success: true as const,
      visit: mapPrismaSiteVisitToView(updatedVisit),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to confirm site visit.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function getSiteVisitAction(visitId: string) {
  try {
    const context = await requireTenantContext();
    const visit = await getSiteVisitById(context, visitId);
    return {
      success: true as const,
      visit: mapPrismaSiteVisitToView(visit),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve site visit.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function rescheduleSiteVisitAction(input: RescheduleSiteVisitInput) {
  try {
    const context = await requireTenantContext();
    const updated = await rescheduleSiteVisit(context, input);
    revalidatePath("/visits");
    revalidatePath(`/visits/${input.visitId}`);
    revalidatePath("/");
    return {
      success: true as const,
      visit: mapPrismaSiteVisitToView(updated),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reschedule site visit.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function reassignSiteVisitAgentAction(input: ReassignSiteVisitAgentInput) {
  try {
    const context = await requireTenantContext();
    const updated = await reassignSiteVisitAgent(context, input);
    revalidatePath("/visits");
    revalidatePath(`/visits/${input.visitId}`);
    revalidatePath("/");
    return {
      success: true as const,
      visit: mapPrismaSiteVisitToView(updated),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reassign sales agent.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function cancelSiteVisitAction(input: CancelSiteVisitInput) {
  try {
    const context = await requireTenantContext();
    const updated = await cancelSiteVisit(context, input);
    revalidatePath("/visits");
    revalidatePath(`/visits/${input.visitId}`);
    revalidatePath("/");
    return {
      success: true as const,
      visit: mapPrismaSiteVisitToView(updated),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel site visit.";
    return {
      success: false as const,
      error: message,
    };
  }
}

/**
 * Generates or reissues a secure, time-limited mobile link for the assigned Field Sales Agent.
 * Returned raw token is exposed ONLY at generation time for copying or sharing.
 */
export async function generateSiteVisitMobileLinkAction(visitId: string) {
  try {
    const context = await requireTenantContext();
    const result = await createSiteVisitAccessLink(context, visitId);
    revalidatePath("/visits");
    revalidatePath(`/visits/${visitId}`);
    return {
      success: true as const,
      rawToken: result.rawToken,
      linkId: result.linkId,
      expiresAt: result.expiresAt.toISOString(),
      mobileUrl: result.mobileUrl,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate mobile itinerary link.";
    return {
      success: false as const,
      error: message,
    };
  }
}

/**
 * Revokes a specific access link immediately.
 */
export async function revokeSiteVisitMobileLinkAction(linkId: string, visitId?: string) {
  try {
    const context = await requireTenantContext();
    await revokeSiteVisitAccessLink(context, linkId);
    revalidatePath("/visits");
    if (visitId) {
      revalidatePath(`/visits/${visitId}`);
    }
    return {
      success: true as const,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to revoke access link.";
    return {
      success: false as const,
      error: message,
    };
  }
}

/**
 * Resolves a site visit itinerary for a mobile browser using the bearer token.
 * Rate-limited to prevent DoS / resource exhaustion.
 */
export async function getSiteVisitByAccessTokenAction(rawToken: string) {
  try {
    const reqHeaders = await headers();
    const ip =
      reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      reqHeaders.get("x-real-ip") ||
      "anonymous";

    const rl = checkRateLimit(`token-resolve:${ip}`, {
      maxRequests: 40,
      windowMs: 60 * 1000,
    });

    if (!rl.allowed) {
      return {
        success: false as const,
        error: "Too many requests. Please wait a moment and try again.",
      };
    }

    const result = await getSiteVisitByAccessToken(rawToken);
    return {
      success: true as const,
      data: {
        linkId: result.linkId,
        expiresAt: result.expiresAt.toISOString(),
        tenantName: result.tenantName,
        salesAgentName: result.salesAgentName,
        salesAgentId: result.salesAgentId,
        visit: result.visit,
      },
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Invalid or expired site visit access link.";
    return {
      success: false as const,
      error: message,
    };
  }
}

/**
 * Submits an individual property visit outcome directly from the mobile bearer route.
 * Dual identity audit records `reportedByUserId` and `enteredByUserId` as the assigned agent.
 */
export async function submitMobileVisitOutcomeAction(
  rawToken: string,
  itemId: string,
  input: TokenRecordOutcomeInput
) {
  try {
    const reqHeaders = await headers();
    const ip =
      reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      reqHeaders.get("x-real-ip") ||
      "anonymous";

    const rl = checkRateLimit(`token-submit:${ip}`, {
      maxRequests: 20,
      windowMs: 60 * 1000,
    });

    if (!rl.allowed) {
      return {
        success: false as const,
        error: "Too many submission attempts. Please wait a minute and try again.",
      };
    }

    const updatedResult = await recordVisitItemOutcomeViaToken(rawToken, itemId, input);

    revalidatePath("/visits");
    revalidatePath(`/visits/${updatedResult.visit.id}`);
    revalidatePath(`/m/visits/${rawToken}`);

    return {
      success: true as const,
      visit: updatedResult.visit,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to record site visit outcome.";
    return {
      success: false as const,
      error: message,
    };
  }
}

