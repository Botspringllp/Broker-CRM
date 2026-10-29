import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenantContext, NotFoundError } from "@/server/tenant-context";
import { getLeadById } from "@/server/dal/leads";
import { listEligibleTelecallers } from "@/server/dal/assignments";
import { mapPrismaLeadToView } from "@/server/dal/mappers";
import { hasPermission } from "@/server/permissions";
import { UserRole } from "@prisma/client";
import { EditLeadClient } from "./EditLeadClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function EditLeadData({ params }: PageProps) {
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

  if (!canEdit) {
    redirect(`/leads/${id}`);
  }

  const lead = mapPrismaLeadToView(dbLead);

  const canAssignTelecaller = hasPermission(
    context.role,
    "assignment:assign_telecaller",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  let eligibleTelecallers: { id: string; name: string; email: string; phone: string }[] = [];
  if (canAssignTelecaller) {
    try {
      const list = await listEligibleTelecallers(context);
      eligibleTelecallers = list.map((t) => ({
        id: t.id,
        name: t.name,
        email: t.email,
        phone: t.phone,
      }));
    } catch {
      eligibleTelecallers = [];
    }
  }

  return (
    <EditLeadClient
      lead={lead}
      canAssignTelecaller={canAssignTelecaller}
      eligibleTelecallers={eligibleTelecallers}
      userRole={context.role}
    />
  );
}

export default function EditLeadPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <EditLeadData params={params} />
    </Suspense>
  );
}

