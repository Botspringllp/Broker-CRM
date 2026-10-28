import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { hasPermission } from "@/server/permissions";
import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { NewPropertyClient } from "./NewPropertyClient";

async function NewPropertyData() {
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

  const canCreate = hasPermission(
    context.role,
    "supply:create",
    context.user?.delegatedPermissions
  );

  if (!canCreate) {
    redirect("/supply");
  }

  return (
    <NewPropertyClient
      userRole={context.role}
      userName={context.user.name}
    />
  );
}

export default function NewPropertyPage() {
  return (
    <Suspense fallback={null}>
      <NewPropertyData />
    </Suspense>
  );
}

