import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listProperties } from "@/server/dal/properties";
import {
  listLeads,
  getCallerDashboardMetrics,
  getManagerDemandMetrics,
} from "@/server/dal/leads";
import { listSiteVisits } from "@/server/dal/visits";
import {
  mapPrismaPropertyToView,
  mapPrismaLeadToView,
  mapPrismaSiteVisitToView,
} from "@/server/dal/mappers";
import {
  Property,
  Lead,
  SiteVisit,
  CallerDashboardMetrics,
  ManagerDemandMetrics,
} from "@/types/crm";
import { OverviewClient } from "./OverviewClient";
import { UserRole } from "@prisma/client";
import { hasPermission } from "@/server/permissions";
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

  // 3. If CRM Tenant Admin, redirect directly to /users (User & Team Management only)
  if (context.role === UserRole.CRM_TENANT_ADMIN) {
    redirect("/users");
  }

  // 4. If Field Verifier, redirect directly to /verifier (Field Verifier Dashboard)
  if (context.role === UserRole.FIELD_VERIFIER) {
    redirect("/verifier");
  }

  const isTelecaller = context.role === UserRole.TELECALLER;
  const isManager =
    context.role === UserRole.BROKER_OWNER ||
    context.role === UserRole.TEAM_LEADER ||
    hasPermission(
      context.role,
      "overview:view_brokerage_metrics",
      context.user?.delegatedPermissions || context.delegatedPermissions
    );

  let callerMetrics: CallerDashboardMetrics | null = null;
  let managerMetrics: ManagerDemandMetrics | null = null;

  // 5. Load role-appropriate metrics
  if (isTelecaller) {
    try {
      callerMetrics = await getCallerDashboardMetrics(context);
    } catch {
      callerMetrics = null;
    }
  } else if (isManager) {
    try {
      managerMetrics = await getManagerDemandMetrics(context);
    } catch {
      managerMetrics = null;
    }
  }

  // 6. For authenticated tenant users, load operational data
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
      rawRole={context.role}
      callerMetrics={callerMetrics}
      managerMetrics={managerMetrics}
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
