import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenantContext, NotFoundError } from "@/server/tenant-context";
import { getPropertyById } from "@/server/dal/properties";
import { mapPrismaPropertyToView } from "@/server/dal/mappers";
import { hasPermission } from "@/server/permissions";
import { UserRole } from "@prisma/client";
import { EditPropertyClient } from "./EditPropertyClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function EditPropertyData({ params }: PageProps) {
  const { id } = await params;
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

  const canEdit =
    hasPermission(context.role, "supply:create", context.user?.delegatedPermissions) ||
    hasPermission(context.role, "supply:validate", context.user?.delegatedPermissions) ||
    hasPermission(context.role, "supply:log_call", context.user?.delegatedPermissions);

  if (!canEdit) {
    redirect(`/supply/${id}`);
  }

  let dbProperty;
  try {
    dbProperty = await getPropertyById(context, id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      notFound();
    }
    throw err;
  }

  // Field verifiers may only edit properties they personally submitted
  if (
    context.role === UserRole.FIELD_VERIFIER &&
    dbProperty.submittingAgentId !== context.userId
  ) {
    redirect("/verifier");
  }

  const property = mapPrismaPropertyToView(dbProperty);

  return (
    <EditPropertyClient
      property={property}
      currentUserRole={context.role}
    />
  );
}

export default function EditPropertyPage(props: PageProps) {
  return (
    <Suspense fallback={null}>
      <EditPropertyData {...props} />
    </Suspense>
  );
}

