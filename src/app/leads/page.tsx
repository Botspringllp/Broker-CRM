import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listLeads } from "@/server/dal/leads";
import { mapPrismaLeadToView } from "@/server/dal/mappers";
import { Lead } from "@/types/crm";
import { LeadValidationClient } from "./LeadValidationClient";

async function LeadValidationData() {
  let leads: Lead[] = [];

  try {
    const context = await requireTenantContext();
    const dbLeads = await listLeads(context);
    leads = dbLeads.map(mapPrismaLeadToView);
  } catch {
    // Unauthenticated or not associated with tenant: render empty state
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
