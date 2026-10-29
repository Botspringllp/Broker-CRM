import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenantContext, NotFoundError } from "@/server/tenant-context";
import { getMatchingPropertiesForLead } from "@/server/dal/matching";
import { hasPermission } from "@/server/permissions";
import { UserRole } from "@prisma/client";
import { MatchingResultsClient } from "./MatchingResultsClient";

interface PageProps {
  params: Promise<{ leadId: string }>;
}

async function MatchingResultsData({ params }: PageProps) {
  const { leadId } = await params;
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

  if (context.role === UserRole.FIELD_SALES_AGENT) {
    redirect("/visits");
  }

  const canViewMatches = hasPermission(
    context.role,
    "matching:view_matches",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  if (!canViewMatches) {
    redirect(`/leads/${leadId}`);
  }

  let matchingData;
  try {
    matchingData = await getMatchingPropertiesForLead(context, leadId);
  } catch (err) {
    if (err instanceof NotFoundError) {
      notFound();
    }
    throw err;
  }

  return (
    <MatchingResultsClient
      lead={matchingData.lead}
      matches={matchingData.matches}
      totalActiveInventoryCount={matchingData.totalActiveInventoryCount}
      currentUserRole={context.role}
    />
  );
}

export default function MatchingResultsPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <MatchingResultsData params={params} />
    </Suspense>
  );
}

