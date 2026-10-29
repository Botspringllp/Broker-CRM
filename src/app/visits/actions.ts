"use server";

import { requireTenantContext } from "@/server/tenant-context";
import {
  createSiteVisit,
  recordVisitItemOutcome,
  confirmSiteVisit,
  getSiteVisitById,
  rescheduleSiteVisit,
  reassignSiteVisitAgent,
  cancelSiteVisit,
  CreateSiteVisitInput,
  RecordVisitItemOutcomeInput,
  RescheduleSiteVisitInput,
  ReassignSiteVisitAgentInput,
  CancelSiteVisitInput,
} from "@/server/dal/visits";
import { mapPrismaSiteVisitToView } from "@/server/dal/mappers";
import { revalidatePath } from "next/cache";

export async function createSiteVisitAction(input: CreateSiteVisitInput) {
  try {
    const context = await requireTenantContext();
    const created = await createSiteVisit(context, input);
    revalidatePath("/visits");
    revalidatePath("/");
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

export async function confirmSiteVisitAction(input: {
  visitId: string;
  notes?: string;
}) {
  try {
    const context = await requireTenantContext();
    const updatedVisit = await confirmSiteVisit(context, input.visitId, input.notes);
    revalidatePath("/visits");
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

