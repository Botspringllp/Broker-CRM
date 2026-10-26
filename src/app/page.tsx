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
import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";

async function OverviewData() {
  let context: Awaited<ReturnType<typeof requireTenantContext>> | null = null;

  try {
    context = await requireTenantContext();
  } catch {
    context = null;
  }

  // 1. If not authenticated, redirect to /login
  if (!context) {
    redirect("/login");
  }

  // 2. If Platform Super Admin, redirect directly to /platform
  if (context.role === UserRole.PLATFORM_SUPER_ADMIN) {
    redirect("/platform");
  }

  // 3. For authenticated tenant users, load operational data
  let properties: Property[] = [];
  let leads: Lead[] = [];
  let visits: SiteVisit[] = [];

  try {
    const [dbProperties, dbLeads, dbVisits] = await Promise.all([
      listProperties(context).catch(() => []),
      listLeads(context).catch(() => []),
      listSiteVisits(context).catch(() => []),
    ]);

    properties = dbProperties.map(mapPrismaPropertyToView);
    leads = dbLeads.map(mapPrismaLeadToView);
    visits = dbVisits.map(mapPrismaSiteVisitToView);
  } catch {
    properties = [];
    leads = [];
    visits = [];
  }

  return (
    <OverviewClient
      initialProperties={properties}
      initialLeads={leads}
      initialVisits={visits}
      userName={context.user.name}
      userRole={context.user.role.replace("_", " ")}
      isAuthenticated={true}
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
