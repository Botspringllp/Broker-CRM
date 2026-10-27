import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listVerifications } from "@/server/dal/verifications";
import { mapPrismaVerificationToView } from "@/server/dal/mappers";
import { VerificationReviewClient } from "./VerificationReviewClient";
import { hasPermission } from "@/server/permissions";
import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";

async function VerificationReviewData() {
  const context = await requireTenantContext();

  if (context.role === UserRole.PLATFORM_SUPER_ADMIN) redirect("/platform");
  if (context.role === UserRole.CRM_TENANT_ADMIN) redirect("/users");
  if (context.role === UserRole.FIELD_VERIFIER) redirect("/verifier");

  const canReview = hasPermission(
    context.role,
    "verification:review_report",
    context.user.delegatedPermissions
  );

  if (!canReview) {
    redirect("/supply/active");
  }

  const dbVerifications = await listVerifications(context).catch(() => []);
  const verifications = dbVerifications.map(mapPrismaVerificationToView);

  return (
    <VerificationReviewClient
      initialVerifications={verifications}
      userName={context.user.name}
      userRole={context.user.role.replace(/_/g, " ")}
      currentUserId={context.userId}
    />
  );
}

export default function VerificationReviewPage() {
  return (
    <Suspense fallback={null}>
      <VerificationReviewData />
    </Suspense>
  );
}

