import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listProperties } from "@/server/dal/properties";
import { listLeads } from "@/server/dal/leads";
import {
  mapPrismaPropertyToView,
  mapPrismaLeadToView,
} from "@/server/dal/mappers";
import { Property, Lead } from "@/types/crm";
import { ActiveSupplyPoolClient } from "./ActiveSupplyPoolClient";
import { SupplyValidationStatus, LeadStatus } from "@prisma/client";

async function ActiveSupplyPoolData() {
  let properties: Property[] = [];
  let leads: Lead[] = [];

  try {
    const context = await requireTenantContext();
    const [dbProperties, dbLeads] = await Promise.all([
      listProperties(context, {
        validationStatus: { equals: SupplyValidationStatus.VALIDATED },
        isActiveSupply: true,
      }).catch(() => []),
      listLeads(context, {
        status: { equals: LeadStatus.ACTIVE },
      }).catch(() => []),
    ]);

    properties = dbProperties.map(mapPrismaPropertyToView);
    leads = dbLeads.map(mapPrismaLeadToView);
  } catch {
    // Unauthenticated or not associated with tenant: render empty state
    properties = [];
    leads = [];
  }

  return (
    <ActiveSupplyPoolClient
      initialProperties={properties}
      initialLeads={leads}
    />
  );
}

export default function ActiveSupplyPoolPage() {
  return (
    <Suspense fallback={null}>
      <ActiveSupplyPoolData />
    </Suspense>
  );
}
