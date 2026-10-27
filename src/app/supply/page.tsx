import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listProperties, listEligibleTelecallers, EligibleTelecaller } from "@/server/dal/properties";
import { mapPrismaPropertyToView } from "@/server/dal/mappers";
import { hasPermission } from "@/server/permissions";
import { Property } from "@/types/crm";
import { SupplyValidationClient } from "./SupplyValidationClient";
import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";

async function SupplyValidationData() {
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
  let eligibleTelecallers: EligibleTelecaller[] = [];
  const canAssign = hasPermission(
    context.role,
    "assignment:assign_telecaller",
    context.user.delegatedPermissions
  );
  const canUploadMedia = hasPermission(
    context.role,
    "supply:upload_media",
    context.user.delegatedPermissions
  );

  try {
    const dbProperties = await listProperties(context);
    properties = dbProperties.map(mapPrismaPropertyToView);
    if (canAssign) {
      eligibleTelecallers = await listEligibleTelecallers(context);
    }
  } catch {
    properties = [];
    eligibleTelecallers = [];
  }

  return (
    <SupplyValidationClient
      initialProperties={properties}
      currentUserRole={context.role}
      canAssignTelecaller={canAssign}
      canUploadMedia={canUploadMedia}
      initialTelecallers={eligibleTelecallers}
    />
  );
}

export default function SupplyValidationPage() {
  return (
    <Suspense fallback={null}>
      <SupplyValidationData />
    </Suspense>
  );
}
