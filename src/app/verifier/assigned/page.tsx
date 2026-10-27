import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listVerifications, getVerificationStats } from "@/server/dal/verifications";
import { mapPrismaVerificationToView } from "@/server/dal/mappers";
import { VerifierDashboardClient } from "../VerifierDashboardClient";
import { UserRole, PropertyVerificationStatus } from "@prisma/client";
import { redirect } from "next/navigation";

async function AssignedVerificationsData() {
  const context = await requireTenantContext();

  if (context.role === UserRole.PLATFORM_SUPER_ADMIN) redirect("/platform");
  if (context.role === UserRole.CRM_TENANT_ADMIN) redirect("/users");
  if (context.role === UserRole.TELECALLER) redirect("/supply");

  const [dbVerifications, stats] = await Promise.all([
    listVerifications(context).catch(() => []),
    getVerificationStats(context).catch(() => ({
      total: 0,
      assigned: 0,
      inProgress: 0,
      submitted: 0,
      approved: 0,
      unableToVerify: 0,
      rejected: 0,
    })),
  ]);

  const activeOnly = dbVerifications
    .filter(
      (v) =>
        v.status === PropertyVerificationStatus.ASSIGNED ||
        v.status === PropertyVerificationStatus.IN_PROGRESS
    )
    .map(mapPrismaVerificationToView);

  return (
    <VerifierDashboardClient
      initialVerifications={activeOnly}
      stats={stats}
      userName={context.user.name}
      userRole={context.user.role.replace(/_/g, " ")}
    />
  );
}

export default function AssignedVerificationsPage() {
  return (
    <Suspense fallback={null}>
      <AssignedVerificationsData />
    </Suspense>
  );
}

