"use server";

import { requireTenantContext } from "@/server/tenant-context";
import {
  createLead,
  editLead,
  logLeadCall,
  updateLeadStatus,
  getLeadById,
  CreateLeadData,
  EditLeadData,
  LogLeadCallInput,
} from "@/server/dal/leads";
import { listEligibleTelecallers } from "@/server/dal/assignments";
import { hasPermission } from "@/server/permissions";
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

export async function editLeadAction(data: EditLeadData) {
  try {
    const context = await requireTenantContext();
    const updated = await editLead(context, data);
    revalidatePath("/leads");
    revalidatePath(`/leads/${data.id}`);
    revalidatePath(`/leads/${data.id}/edit`);
    revalidatePath(`/leads/${data.id}/qualify`);
    revalidatePath("/demand");
    revalidatePath("/");
    return {
      success: true as const,
      lead: mapPrismaLeadToView(updated),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update lead.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function getEligibleTelecallersAction() {
  try {
    const context = await requireTenantContext();
    const canAssign = hasPermission(
      context.role,
      "assignment:assign_telecaller",
      context.user?.delegatedPermissions || context.delegatedPermissions
    );
    if (!canAssign) {
      return { success: true as const, telecallers: [] };
    }
    const telecallers = await listEligibleTelecallers(context);
    return {
      success: true as const,
      telecallers: telecallers.map((t) => ({
        id: t.id,
        name: t.name,
        email: t.email,
        phone: t.phone,
      })),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch telecallers.";
    return {
      success: false as const,
      error: message,
      telecallers: [],
    };
  }
}

