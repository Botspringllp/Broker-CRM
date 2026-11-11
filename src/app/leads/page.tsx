import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listLeads } from "@/server/dal/leads";
import { listEligibleTelecallers } from "@/server/dal/assignments";
import { hasPermission } from "@/server/permissions";
import { mapPrismaLeadToView } from "@/server/dal/mappers";
import { Lead } from "@/types/crm";
import { LeadValidationClient } from "./LeadValidationClient";
import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";

async function LeadValidationData() {
  let context: Awaited<ReturnType<typeof requireTenantContext>> | null = null;

  try {
    context = await requireTenantContext();
  } catch {
    context = null;
  }

  if (!context) {
    redirect("/login");
  }

  if (context.role === UserRole.PLATFORM_SUPER_ADMIN) {
    redirect("/platform");
  }

  if (context.role === UserRole.CRM_TENANT_ADMIN) {
    redirect("/users");
  }

  if (context.role === UserRole.FIELD_VERIFIER) {
    redirect("/verifier");
  }

  const canAssignTelecaller = hasPermission(
    context.role,
    "assignment:assign_telecaller",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  let eligibleTelecallers: { id: string; name: string; email: string; phone: string }[] = [];
  if (canAssignTelecaller) {
    try {
      eligibleTelecallers = await listEligibleTelecallers(context);
    } catch {
      eligibleTelecallers = [];
    }
  }

  let leads: Lead[] = [];

  try {
    const dbLeads = await listLeads(context);
    leads = dbLeads.map(mapPrismaLeadToView);
  } catch {
    leads = [];
  }

  return (
    <LeadValidationClient
      initialLeads={leads}
      canAssignTelecaller={canAssignTelecaller}
      eligibleTelecallers={eligibleTelecallers}
    />
  );
}

export default function LeadValidationPage() {
  return (
    <Suspense fallback={null}>
      <LeadValidationData />
    </Suspense>
  );
}
