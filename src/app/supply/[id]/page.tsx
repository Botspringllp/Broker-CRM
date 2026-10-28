import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenantContext, NotFoundError } from "@/server/tenant-context";
import { getPropertyById, listEligibleTelecallers } from "@/server/dal/properties";
import { mapPrismaPropertyToView } from "@/server/dal/mappers";
import { hasPermission } from "@/server/permissions";
import { UserRole } from "@prisma/client";
import { PropertyDetailsClient } from "./PropertyDetailsClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function PropertyDetailsData({ params }: PageProps) {
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

  let dbProperty;
  try {
    dbProperty = await getPropertyById(context, id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      notFound();
    }
    throw err;
  }

  const property = mapPrismaPropertyToView(dbProperty);

  const canEdit =
    hasPermission(context.role, "supply:create", context.user?.delegatedPermissions) ||
    hasPermission(context.role, "supply:validate", context.user?.delegatedPermissions) ||
    hasPermission(context.role, "supply:log_call", context.user?.delegatedPermissions);

  const canLogCall = hasPermission(
    context.role,
    "supply:log_call",
    context.user?.delegatedPermissions
  );

  const canAssignTelecaller = hasPermission(
    context.role,
    "assignment:assign_telecaller",
    context.user?.delegatedPermissions
  );

  const canAssignFieldVerifier = hasPermission(
    context.role,
    "verification:assign",
    context.user?.delegatedPermissions
  );

  const canUploadMedia = hasPermission(
    context.role,
    "supply:upload_media",
    context.user?.delegatedPermissions
  );

  let eligibleTelecallers: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    role: string;
    isActive: boolean;
  }> = [];

  if (canAssignTelecaller) {
    try {
      eligibleTelecallers = await listEligibleTelecallers(context);
    } catch {
      eligibleTelecallers = [];
    }
  }

  return (
    <PropertyDetailsClient
      property={property}
      currentUserRole={context.role}
      canEdit={canEdit}
      canLogCall={canLogCall}
      canAssignTelecaller={canAssignTelecaller}
      canAssignFieldVerifier={canAssignFieldVerifier}
      canUploadMedia={canUploadMedia}
      initialTelecallers={eligibleTelecallers}
    />
  );
}

export default function PropertyDetailsPage(props: PageProps) {
  return (
    <Suspense fallback={null}>
      <PropertyDetailsData {...props} />
    </Suspense>
  );
}
