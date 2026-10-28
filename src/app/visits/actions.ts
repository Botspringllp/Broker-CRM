"use server";

import { requireTenantContext } from "@/server/tenant-context";
import {
  createSiteVisit,
  recordVisitItemOutcome,
  confirmSiteVisit,
  getSiteVisitById,
  CreateSiteVisitInput,
  RecordVisitItemOutcomeInput,
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

