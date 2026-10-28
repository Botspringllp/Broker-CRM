"use server";

import { requireTenantContext } from "@/server/tenant-context";
import {
  createLead,
  logLeadCall,
  updateLeadStatus,
  getLeadById,
  CreateLeadData,
  LogLeadCallInput,
} from "@/server/dal/leads";
import { mapPrismaLeadToView } from "@/server/dal/mappers";
import { revalidatePath } from "next/cache";
import { LeadStatus } from "@prisma/client";

export async function createLeadAction(data: CreateLeadData) {
  try {
    const context = await requireTenantContext();
    const created = await createLead(context, data);
    revalidatePath("/leads");
    revalidatePath("/");
    return {
      success: true as const,
      lead: mapPrismaLeadToView(created),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create lead.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function logLeadCallAction(input: LogLeadCallInput) {
  try {
    const context = await requireTenantContext();
    const updated = await logLeadCall(context, input);
    revalidatePath("/leads");
    revalidatePath("/");
    return {
      success: true as const,
      lead: mapPrismaLeadToView(updated),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record lead call.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function updateLeadStatusAction(input: {
  leadId: string;
  status: "ACTIVE" | "INACTIVE";
}) {
  try {
    const context = await requireTenantContext();
    const statusEnum = input.status === "ACTIVE" ? LeadStatus.ACTIVE : LeadStatus.INACTIVE;
    const updated = await updateLeadStatus(context, input.leadId, statusEnum);
    revalidatePath("/leads");
    revalidatePath("/");
    return {
      success: true as const,
      lead: mapPrismaLeadToView(updated),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update lead status.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function getLeadAction(leadId: string) {
  try {
    const context = await requireTenantContext();
    const lead = await getLeadById(context, leadId);
    return {
      success: true as const,
      lead: mapPrismaLeadToView(lead),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch lead.";
    return {
      success: false as const,
      error: message,
    };
  }
}

