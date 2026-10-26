import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listProperties } from "@/server/dal/properties";
import { mapPrismaPropertyToView } from "@/server/dal/mappers";
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

  let properties: Property[] = [];

  try {
    const dbProperties = await listProperties(context);
    properties = dbProperties.map(mapPrismaPropertyToView);
  } catch {
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
