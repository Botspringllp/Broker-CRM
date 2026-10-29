import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenantContext, NotFoundError } from "@/server/tenant-context";
import { getLeadById } from "@/server/dal/leads";
import { mapPrismaLeadToView } from "@/server/dal/mappers";
import { hasPermission } from "@/server/permissions";
import { UserRole } from "@prisma/client";
import { LeadDetailsClient } from "./LeadDetailsClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function LeadDetailsData({ params }: PageProps) {
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

  let dbLead;
  try {
    dbLead = await getLeadById(context, id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      notFound();
    }
    throw err;
  }

  const lead = mapPrismaLeadToView(dbLead);

  const canEdit =
    context.role === UserRole.BROKER_OWNER ||
    context.role === UserRole.TEAM_LEADER ||
    (context.role === UserRole.TELECALLER &&
      (dbLead.assignedTelecallerId === context.userId ||
        hasPermission(
          context.role,
          "demand:view_all",
          context.user?.delegatedPermissions || context.delegatedPermissions
        )));

  const canLogCall = hasPermission(
    context.role,
    "demand:log_call",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  const canActivate = hasPermission(
    context.role,
    "demand:activate",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  return (
    <LeadDetailsClient
      lead={lead}
      canEdit={canEdit}
      canLogCall={canLogCall}
      canActivate={canActivate}
      userRole={context.role}
    />
  );
}

export default function LeadDetailsPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <LeadDetailsData params={params} />
    </Suspense>
  );
}

