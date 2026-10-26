import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listSiteVisits } from "@/server/dal/visits";
import { mapPrismaSiteVisitToView } from "@/server/dal/mappers";
import { SiteVisit } from "@/types/crm";
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

  let visits: SiteVisit[] = [];

  try {
    const dbVisits = await listSiteVisits(context);
    visits = dbVisits.map(mapPrismaSiteVisitToView);
  } catch {
    visits = [];
  }

  return <SiteVisitsClient initialVisits={visits} />;
}

export default function SiteVisitsPage() {
  return (
    <Suspense fallback={null}>
      <SiteVisitsData />
    </Suspense>
  );
}
