import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listSiteVisits } from "@/server/dal/visits";
import { mapPrismaSiteVisitToView } from "@/server/dal/mappers";
import { SiteVisit } from "@/types/crm";
import { SiteVisitsClient } from "./SiteVisitsClient";

async function SiteVisitsData() {
  let visits: SiteVisit[] = [];

  try {
    const context = await requireTenantContext();
    const dbVisits = await listSiteVisits(context);
    visits = dbVisits.map(mapPrismaSiteVisitToView);
  } catch {
    // Unauthenticated or not associated with tenant: render empty state
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
