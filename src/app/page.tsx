import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listProperties } from "@/server/dal/properties";
import { listLeads } from "@/server/dal/leads";
import { listSiteVisits } from "@/server/dal/visits";
import {
  mapPrismaPropertyToView,
  mapPrismaLeadToView,
  mapPrismaSiteVisitToView,
} from "@/server/dal/mappers";
import { Property, Lead, SiteVisit } from "@/types/crm";
import { OverviewClient } from "./OverviewClient";

async function OverviewData() {
  let properties: Property[] = [];
  let leads: Lead[] = [];
  let visits: SiteVisit[] = [];
  let isAuthenticated = false;
  let userName = "Not signed in";
  let userRole = "Guest";

  try {
    const context = await requireTenantContext();
    isAuthenticated = true;
    userName = context.user.name;
    userRole = context.user.role.replace("_", " ");

    const [dbProperties, dbLeads, dbVisits] = await Promise.all([
      listProperties(context).catch(() => []),
      listLeads(context).catch(() => []),
      listSiteVisits(context).catch(() => []),
    ]);

    properties = dbProperties.map(mapPrismaPropertyToView);
    leads = dbLeads.map(mapPrismaLeadToView);
    visits = dbVisits.map(mapPrismaSiteVisitToView);
  } catch {
    // Unauthenticated or not associated with tenant: safely default to empty dataset
    properties = [];
    leads = [];
    visits = [];
  }

  return (
    <OverviewClient
      initialProperties={properties}
      initialLeads={leads}
      initialVisits={visits}
      userName={userName}
      userRole={userRole}
      isAuthenticated={isAuthenticated}
    />
  );
}

export default function OverviewPage() {
  return (
    <Suspense fallback={null}>
      <OverviewData />
    </Suspense>
  );
}
