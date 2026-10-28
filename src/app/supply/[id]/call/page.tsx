import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenantContext, NotFoundError } from "@/server/tenant-context";
import { getPropertyById } from "@/server/dal/properties";
import { mapPrismaPropertyToView } from "@/server/dal/mappers";
import { hasPermission } from "@/server/permissions";
import { UserRole, AssignmentStatus, AssignmentTargetType } from "@prisma/client";
import { CallWorkspaceClient } from "./CallWorkspaceClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function CallWorkspaceData({ params }: PageProps) {
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

  if (context.role === UserRole.FIELD_VERIFIER) {
    redirect("/verifier");
  }

  // Permission check for logging calls
  const canLogCall = hasPermission(
    context.role,
    "supply:log_call",
    context.user?.delegatedPermissions
  );

  if (!canLogCall) {
    redirect("/supply");
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

  // Strict Telecaller scoping: must be actively assigned to validate this property
  if (context.role === UserRole.TELECALLER) {
    const isActivelyAssigned = dbProperty.assignments?.some(
      (a) =>
        a.assignedUserId === context.userId &&
        a.status === AssignmentStatus.ACTIVE &&
        (!a.targetType || a.targetType === AssignmentTargetType.PROPERTY)
    );

    if (!isActivelyAssigned) {
      // Direct URL tampering or unassigned access denied
      notFound();
    }
  }

  const property = mapPrismaPropertyToView(dbProperty);

  return (
    <CallWorkspaceClient
      property={property}
      currentUserRole={context.role}
      currentUserName={context.user.name}
    />
  );
}

export default function CallWorkspacePage(props: PageProps) {
  return (
    <Suspense fallback={null}>
      <CallWorkspaceData {...props} />
    </Suspense>
  );
}

