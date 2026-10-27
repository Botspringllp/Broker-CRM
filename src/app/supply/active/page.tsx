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
import { SupplyValidationStatus, LeadStatus, UserRole } from "@prisma/client";
import { hasPermission } from "@/server/permissions";
import { redirect } from "next/navigation";

async function ActiveSupplyPoolData() {
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

  let properties: Property[] = [];
  let leads: Lead[] = [];

  try {
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
    properties = [];
    leads = [];
  }

  const canAssignFieldVerifier = hasPermission(
    context.role,
    "verification:assign",
    context.user.delegatedPermissions
  );
  const canReviewVerification = hasPermission(
    context.role,
    "verification:review_report",
    context.user.delegatedPermissions
  );

  return (
    <ActiveSupplyPoolClient
      initialProperties={properties}
      initialLeads={leads}
      canAssignFieldVerifier={canAssignFieldVerifier}
      canReviewVerification={canReviewVerification}
      currentUserRole={context.role}
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
