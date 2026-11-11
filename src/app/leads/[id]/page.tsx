import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenantContext, NotFoundError } from "@/server/tenant-context";
import { getLeadById, getLeadChangeHistory } from "@/server/dal/leads";
import { listEligibleTelecallers } from "@/server/dal/assignments";
import { getMatchingPropertiesForLead, EvaluatedPropertyMatch } from "@/server/dal/matching";
import { getSiteVisitsForLead } from "@/server/dal/visits";
import { mapPrismaLeadToView, mapPrismaSiteVisitToView } from "@/server/dal/mappers";
import { hasPermission } from "@/server/permissions";
import { UserRole } from "@prisma/client";
import { LeadDetailsClient } from "./LeadDetailsClient";
import { SiteVisit, LeadChangeLogItem } from "@/types/crm";

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

  const canViewChangelog = hasPermission(
    context.role,
    "demand:view_changelog",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  const canAssignTelecaller = hasPermission(
    context.role,
    "assignment:assign_telecaller",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  const canViewMatches = hasPermission(
    context.role,
    "matching:view_matches",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  const canViewVisits = hasPermission(
    context.role,
    "visits:view_assigned",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  let eligibleTelecallers: { id: string; name: string; email: string; phone: string }[] = [];
  if (canAssignTelecaller) {
    try {
      eligibleTelecallers = await listEligibleTelecallers(context);
    } catch {
      eligibleTelecallers = [];
    }
  }

  let topMatches: EvaluatedPropertyMatch[] = [];
  if (canViewMatches && dbLead.requirement) {
    try {
      const matchResult = await getMatchingPropertiesForLead(context, id);
      topMatches = matchResult.matches.slice(0, 3);
    } catch {
      topMatches = [];
    }
  }

  let siteVisits: SiteVisit[] = [];
  if (canViewVisits) {
    try {
      const rawVisits = await getSiteVisitsForLead(context, id);
      siteVisits = rawVisits.map(mapPrismaSiteVisitToView);
    } catch {
      siteVisits = [];
    }
  }

  let initialChangeHistory: LeadChangeLogItem[] = [];
  if (canViewChangelog) {
    try {
      initialChangeHistory = await getLeadChangeHistory(context, id, { limit: 50 });
    } catch {
      initialChangeHistory = [];
    }
  }

  lead.topMatches = topMatches.map((m) => ({
    id: m.property.id,
    score: m.score,
    societyName: m.property.societyName,
    bedroomCount: m.property.bedroomCount,
    area: m.property.area,
    areaType: m.property.areaType,
    priceFormatted: m.property.priceFormatted,
    preference: m.property.preference,
    locality: m.property.locality,
  }));

  lead.siteVisitHistory = siteVisits.flatMap((v) =>
    v.items.map((item) => ({
      date: v.scheduledDate,
      propertySociety: item.propertyTitle || "Property",
      outcome: item.status,
      agentName: v.assignedSalesAgent || "Sales Agent",
    }))
  );

  return (
    <LeadDetailsClient
      lead={lead}
      topMatches={topMatches}
      siteVisits={siteVisits}
      initialChangeHistory={initialChangeHistory}
      canEdit={canEdit}
      canLogCall={canLogCall}
      canActivate={canActivate}
      canViewChangelog={canViewChangelog}
      canAssignTelecaller={canAssignTelecaller}
      canViewMatches={canViewMatches}
      eligibleTelecallers={eligibleTelecallers}
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

