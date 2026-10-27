import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listVerifications, getVerificationStats } from "@/server/dal/verifications";
import { mapPrismaVerificationToView } from "@/server/dal/mappers";
import { VerifierDashboardClient } from "../VerifierDashboardClient";
import { UserRole, PropertyVerificationStatus } from "@prisma/client";
import { redirect } from "next/navigation";

async function CompletedVerificationsData() {
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

  const completedOnly = dbVerifications
    .filter(
      (v) =>
        v.status === PropertyVerificationStatus.APPROVED ||
        v.status === PropertyVerificationStatus.SUBMITTED ||
        v.status === PropertyVerificationStatus.UNABLE_TO_VERIFY ||
        v.status === PropertyVerificationStatus.REJECTED
    )
    .map(mapPrismaVerificationToView);

  return (
    <VerifierDashboardClient
      initialVerifications={completedOnly}
      stats={stats}
      userName={context.user.name}
      userRole={context.user.role.replace(/_/g, " ")}
    />
  );
}

export default function CompletedVerificationsPage() {
  return (
    <Suspense fallback={null}>
      <CompletedVerificationsData />
    </Suspense>
  );
}

