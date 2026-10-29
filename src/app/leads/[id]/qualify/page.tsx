import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenantContext, NotFoundError } from "@/server/tenant-context";
import { getLeadById } from "@/server/dal/leads";
import { mapPrismaLeadToView } from "@/server/dal/mappers";
import { hasPermission } from "@/server/permissions";
import { UserRole } from "@prisma/client";
import { LeadQualifyClient } from "./LeadQualifyClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function LeadQualifyData({ params }: PageProps) {
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

  const canLogCall = hasPermission(
    context.role,
    "demand:log_call",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  if (!canLogCall) {
    redirect(`/leads/${id}`);
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

  const canActivate = hasPermission(
    context.role,
    "demand:activate",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  return (
    <LeadQualifyClient
      lead={lead}
      currentUserRole={context.role}
      currentUserName={context.user.name}
      canActivate={canActivate}
    />
  );
}

export default function LeadQualifyPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <LeadQualifyData params={params} />
    </Suspense>
  );
}

