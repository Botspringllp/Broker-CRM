import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listProperties } from "@/server/dal/properties";
import { mapPrismaPropertyToView } from "@/server/dal/mappers";
import { Property } from "@/types/crm";
import { SupplyValidationClient } from "./SupplyValidationClient";

async function SupplyValidationData() {
  let properties: Property[] = [];

  try {
    const context = await requireTenantContext();
    const dbProperties = await listProperties(context);
    properties = dbProperties.map(mapPrismaPropertyToView);
  } catch {
    // Unauthenticated or not associated with tenant: render empty state
    properties = [];
  }

  return <SupplyValidationClient initialProperties={properties} />;
}

export default function SupplyValidationPage() {
  return (
    <Suspense fallback={null}>
      <SupplyValidationData />
    </Suspense>
  );
}
