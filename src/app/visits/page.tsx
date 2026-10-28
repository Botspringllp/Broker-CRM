import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listSiteVisits } from "@/server/dal/visits";
import { mapPrismaSiteVisitToView } from "@/server/dal/mappers";
import { prisma } from "@/server/db";
import { SiteVisitsClient } from "./SiteVisitsClient";
import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";

async function SiteVisitsData() {
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

  const [dbVisits, leads, activeProps, agents] = await Promise.all([
    listSiteVisits(context).catch(() => []),
    prisma.lead
      .findMany({
        where: { tenantId: context.tenantId, status: { not: "INACTIVE" } },
        select: { id: true, name: true, primaryPhone: true },
        orderBy: { name: "asc" },
      })
      .catch(() => []),
    prisma.property
      .findMany({
        where: {
          tenantId: context.tenantId,
          isActiveSupply: true,
          availabilityStatus: "AVAILABLE",
        },
        select: {
          id: true,
          societyName: true,
          flatNumber: true,
          bedroomCount: true,
          localityName: true,
        },
        orderBy: { societyName: "asc" },
      })
      .catch(() => []),
    prisma.user
      .findMany({
        where: {
          tenantId: context.tenantId,
          role: UserRole.FIELD_SALES_AGENT,
          isActive: true,
        },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      })
      .catch(() => []),
  ]);

  const visits = dbVisits.map(mapPrismaSiteVisitToView);

  return (
    <SiteVisitsClient
      initialVisits={visits}
      availableLeads={leads}
      availableProperties={activeProps}
      salesAgents={agents}
    />
  );
}

export default function SiteVisitsPage() {
  return (
    <Suspense fallback={null}>
      <SiteVisitsData />
    </Suspense>
  );
}
