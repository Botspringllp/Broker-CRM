import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listLeads } from "@/server/dal/leads";
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

  let leads: Lead[] = [];

  try {
    const dbLeads = await listLeads(context);
    leads = dbLeads.map(mapPrismaLeadToView);
  } catch {
    leads = [];
  }

  return <LeadValidationClient initialLeads={leads} />;
}

export default function LeadValidationPage() {
  return (
    <Suspense fallback={null}>
      <LeadValidationData />
    </Suspense>
  );
}
