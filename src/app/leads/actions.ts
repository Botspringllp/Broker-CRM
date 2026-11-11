"use server";

import { requireTenantContext } from "@/server/tenant-context";
import {
  createLead,
  editLead,
  logLeadCall,
  updateLeadStatus,
  getLeadById,
  getLeadChangeHistory,
  getVerifiedLocalities,
  markLeadDoNotContact,
  listPendingCallbacks,
  getCallerDashboardMetrics,
  getManagerDemandMetrics,
  CreateLeadData,
  EditLeadData,
  LogLeadCallInput,
} from "@/server/dal/leads";
import {
  listEligibleTelecallers,
  assignLeadManually,
  assignLeadRoundRobin,
  getLeadAssignmentHistory,
  AssignLeadInput,
  RoundRobinLeadInput,
} from "@/server/dal/assignments";
import { hasPermission } from "@/server/permissions";
import { mapPrismaLeadToView, formatIndianDateTime } from "@/server/dal/mappers";
import { revalidatePath } from "next/cache";
import { LeadStatus } from "@prisma/client";

export async function createLeadAction(data: CreateLeadData) {
  try {
    const context = await requireTenantContext();
    const result = await createLead(context, data);
    revalidatePath("/leads");
    revalidatePath("/");
    return {
      success: true as const,
      lead: mapPrismaLeadToView(result.lead),
      enquiryId: result.enquiry.id,
      isExistingBuyer: result.isExistingBuyer,
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

export async function getLeadChangeHistoryAction(leadId: string) {
  try {
    if (!leadId?.trim()) {
      return {
        success: false as const,
        error: "Lead ID is required.",
        history: [],
      };
    }
    const context = await requireTenantContext();
    const history = await getLeadChangeHistory(context, leadId.trim());
    return {
      success: true as const,
      history,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch change history.";
    return {
      success: false as const,
      error: message,
      history: [],
    };
  }
}

export async function getVerifiedLocalitiesAction(city?: string) {
  try {
    const context = await requireTenantContext();
    const localities = await getVerifiedLocalities(context, city);
    return {
      success: true as const,
      localities: localities.map((l) => ({
        id: l.id,
        name: l.name,
        city: l.city,
        latitude: l.latitude ? Number(l.latitude) : null,
        longitude: l.longitude ? Number(l.longitude) : null,
      })),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch verified localities.";
    return {
      success: false as const,
      error: message,
      localities: [],
    };
  }
}

export async function markLeadDoNotContactAction(leadId: string, reason?: string) {
  try {
    const context = await requireTenantContext();
    const updated = await markLeadDoNotContact(context, leadId, reason);
    revalidatePath("/leads");
    revalidatePath("/");
    return {
      success: true as const,
      lead: mapPrismaLeadToView(updated),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to mark prospect as Do Not Contact.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function getPendingCallbacksAction(timeframe?: "overdue" | "today" | "upcoming" | "all") {
  try {
    const context = await requireTenantContext();
    const callbacks = await listPendingCallbacks(context, { timeframe });
    return {
      success: true as const,
      callbacks,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch pending callbacks.";
    return {
      success: false as const,
      error: message,
      callbacks: [],
    };
  }
}

export async function assignLeadAction(input: AssignLeadInput) {
  try {
    const context = await requireTenantContext();
    await assignLeadManually(context, input);
    const updatedLead = await getLeadById(context, input.leadId);
    revalidatePath("/leads");
    revalidatePath(`/leads/${input.leadId}`);
    revalidatePath("/demand");
    revalidatePath("/");
    return {
      success: true as const,
      lead: mapPrismaLeadToView(updatedLead),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to assign lead.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function assignLeadRoundRobinAction(input: RoundRobinLeadInput) {
  try {
    const context = await requireTenantContext();
    await assignLeadRoundRobin(context, input);
    const updatedLead = await getLeadById(context, input.leadId);
    revalidatePath("/leads");
    revalidatePath(`/leads/${input.leadId}`);
    revalidatePath("/demand");
    revalidatePath("/");
    return {
      success: true as const,
      lead: mapPrismaLeadToView(updatedLead),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to execute round-robin assignment.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function getLeadAssignmentHistoryAction(leadId: string) {
  try {
    if (!leadId?.trim()) {
      return {
        success: false as const,
        error: "Lead ID is required.",
        history: [],
      };
    }
    const context = await requireTenantContext();
    const history = await getLeadAssignmentHistory(context, leadId.trim());
    return {
      success: true as const,
      history: history.map((a) => {
        const assignedDate = new Date(a.assignedAt);
        const formattedAssignedAt = !isNaN(assignedDate.getTime())
          ? formatIndianDateTime(assignedDate)
          : "Recently";
        const unassignedDate = a.unassignedAt ? new Date(a.unassignedAt) : null;
        const formattedUnassignedAt =
          unassignedDate && !isNaN(unassignedDate.getTime())
            ? formatIndianDateTime(unassignedDate)
            : null;

        return {
          id: a.id,
          assignedUserId: a.assignedUserId,
          assignedUserName: a.assignedUser?.name || "Telecaller",
          assignedByUserId: a.assignedByUserId,
          assignedByUserName: a.assignedByUser?.name || null,
          assignmentMethod:
            a.assignmentMethod === "ROUND_ROBIN"
              ? ("Round Robin" as const)
              : ("Manual" as const),
          status:
            a.status === "ACTIVE"
              ? ("Active" as const)
              : a.status === "REASSIGNED"
              ? ("Reassigned" as const)
              : a.status === "COMPLETED"
              ? ("Completed" as const)
              : ("Cancelled" as const),
          assignedAt: formattedAssignedAt,
          unassignedAt: formattedUnassignedAt,
          notes: a.notes || null,
        };
      }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch assignment history.";
    return {
      success: false as const,
      error: message,
      history: [],
    };
  }
}

export async function getCallerDashboardMetricsAction() {
  try {
    const context = await requireTenantContext();
    const metrics = await getCallerDashboardMetrics(context);
    return {
      success: true as const,
      metrics,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch caller dashboard metrics.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function getManagerDemandMetricsAction() {
  try {
    const context = await requireTenantContext();
    const metrics = await getManagerDemandMetrics(context);
    return {
      success: true as const,
      metrics,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch manager demand metrics.";
    return {
      success: false as const,
      error: message,
    };
  }
}

