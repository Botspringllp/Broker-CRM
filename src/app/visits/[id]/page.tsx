import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenantContext, NotFoundError } from "@/server/tenant-context";
import { getSiteVisitById } from "@/server/dal/visits";
import { mapPrismaSiteVisitToView } from "@/server/dal/mappers";
import { hasPermission } from "@/server/permissions";
import { prisma } from "@/server/db";
import { UserRole } from "@prisma/client";
import { SiteVisitDetailsClient } from "./SiteVisitDetailsClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function SiteVisitDetailsData({ params }: PageProps) {
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

  let dbVisit;
  try {
    dbVisit = await getSiteVisitById(context, id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      notFound();
    }
    throw err;
  }

  // Fetch active sales agents for reassignment dropdown
  const salesAgents = await prisma.user.findMany({
    where: {
      tenantId: context.tenantId,
      role: {
        in: [UserRole.FIELD_SALES_AGENT, UserRole.BROKER_OWNER, UserRole.TEAM_LEADER],
      },
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
    orderBy: { name: "asc" },
  });

  const canReschedule = hasPermission(
    context.role,
    "visits:schedule",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  const canAssignAgent =
    hasPermission(
      context.role,
      "assignment:assign_sales_agent",
      context.user?.delegatedPermissions || context.delegatedPermissions
    ) || canReschedule;

  const canRecordOutcome = hasPermission(
    context.role,
    "visits:record_outcome",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  const canConfirm = hasPermission(
    context.role,
    "visits:confirm_final",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  const canCancel = canReschedule;

  const viewVisit = mapPrismaSiteVisitToView(dbVisit);

  return (
    <SiteVisitDetailsClient
      initialVisit={viewVisit}
      currentUserRole={context.role}
      currentUserId={context.userId}
      salesAgents={salesAgents}
      canReschedule={canReschedule}
      canAssignAgent={canAssignAgent}
      canRecordOutcome={canRecordOutcome}
      canConfirm={canConfirm}
      canCancel={canCancel}
    />
  );
}

export default function SiteVisitDetailsPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <SiteVisitDetailsData params={params} />
    </Suspense>
  );
}

