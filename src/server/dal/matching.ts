import { prisma } from "../db";
import { TenantContext, NotFoundError } from "../tenant-context";
import { assertPermission } from "../permissions";
import { ValidationError } from "../errors";
import {
  SupplyValidationStatus,
  PropertyAvailabilityStatus,
  LeadStatus,
  Prisma,
} from "@prisma/client";
import { getLeadById } from "./leads";
import { mapPrismaPropertyToView, mapPrismaLeadToView } from "./mappers";
import { Property, Lead } from "@/types/crm";
import {
  CriterionResult,
  MatchCriteriaBreakdown,
  RawRequirementData,
  RawPropertyData,
  LocalityItem,
  calculateHaversineDistanceKm,
  isPropertySupplyEligible,
  evaluatePropertyMatch,
  normalizeLocalityName,
  areCoordinatesVerified,
  normalizeAreaUnit,
} from "@/lib/matching-engine";

export {
  calculateHaversineDistanceKm,
  isPropertySupplyEligible,
  evaluatePropertyMatch,
  normalizeLocalityName,
  areCoordinatesVerified,
  normalizeAreaUnit,
};
export type {
  CriterionResult,
  MatchCriteriaBreakdown,
  RawRequirementData,
  RawPropertyData,
  LocalityItem,
};

export interface EvaluatedPropertyMatch {
  property: Property;
  score: number; // 0 to 100
  isEligible: boolean;
  criteriaMatchedCount: number;
  criteriaEvaluatedCount: number;
  breakdown: MatchCriteriaBreakdown;
  unspecifiedCriteria: string[];
}

export interface EvaluatedLeadMatch {
  lead: Lead;
  score: number; // 0 to 100
  isEligible: boolean;
  criteriaMatchedCount: number;
  criteriaEvaluatedCount: number;
  breakdown: MatchCriteriaBreakdown;
  unspecifiedCriteria: string[];
  visitStatus: string;
}

export interface LeadMatchingResults {
  lead: Lead;
  matches: EvaluatedPropertyMatch[];
  totalActiveInventoryCount: number;
}

export interface PropertyMatchingResults {
  property: Property;
  matches: EvaluatedLeadMatch[];
  totalActiveLeadsCount: number;
}

/**
 * Deterministic multi-level tie-breaking for matching properties (Decision M6):
 * 1. Matching score descending
 * 2. If buyer budget exists, property price closest to the buyer budget midpoint
 * 3. Most recently validated eligible property (validation date / updatedAt DESC)
 * 4. Stable property ID ascending
 */
export function sortPropertyMatches(
  matches: EvaluatedPropertyMatch[],
  requirement: { minBudget?: number | null; maxBudget?: number | null }
): EvaluatedPropertyMatch[] {
  const hasMinB = requirement.minBudget != null && Number(requirement.minBudget) > 0;
  const hasMaxB = requirement.maxBudget != null && Number(requirement.maxBudget) > 0;
  let budgetMidpoint: number | null = null;

  if (hasMinB && hasMaxB) {
    budgetMidpoint = (Number(requirement.minBudget) + Number(requirement.maxBudget)) / 2;
  } else if (hasMinB) {
    budgetMidpoint = Number(requirement.minBudget);
  } else if (hasMaxB) {
    budgetMidpoint = Number(requirement.maxBudget);
  }

  return matches.sort((a, b) => {
    // 1. Matching score descending
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    // 2. Property price closest to buyer budget midpoint (only if buyer budget exists)
    if (budgetMidpoint !== null) {
      const diffA = Math.abs(a.property.price - budgetMidpoint);
      const diffB = Math.abs(b.property.price - budgetMidpoint);
      if (diffA !== diffB) {
        return diffA - diffB;
      }
    }

    // 3. Most recently validated eligible property (validatedAt DESC; deterministic fallback createdAt DESC)
    const timeA = a.property.validatedAt
      ? new Date(a.property.validatedAt).getTime()
      : a.property.createdAt
      ? new Date(a.property.createdAt).getTime()
      : 0;
    const timeB = b.property.validatedAt
      ? new Date(b.property.validatedAt).getTime()
      : b.property.createdAt
      ? new Date(b.property.createdAt).getTime()
      : 0;
    if (timeB !== timeA) {
      return timeB - timeA;
    }

    // 4. Stable property ID ascending
    return a.property.id.localeCompare(b.property.id);
  });
}

/**
 * Deterministic multi-level tie-breaking for matching leads (symmetrical to M6):
 * 1. Matching score descending
 * 2. If buyer budget exists, price closest to the property price (evaluated only when BOTH candidates have a budget)
 * 3. Intake / creation timestamp descending (deterministic fallback)
 * 4. Stable lead ID ascending
 */
export function sortLeadMatches(
  matches: EvaluatedLeadMatch[],
  propertyPrice: number
): EvaluatedLeadMatch[] {
  return matches.sort((a, b) => {
    // 1. Matching score descending
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    // 2. Buyer budget midpoint closest to property price (only when BOTH candidates have a budget)
    const reqA = a.lead.requirements;
    const reqB = b.lead.requirements;

    const midA =
      reqA && reqA.minBudget > 0 && reqA.maxBudget > 0
        ? (reqA.minBudget + reqA.maxBudget) / 2
        : reqA?.minBudget && reqA.minBudget > 0
        ? reqA.minBudget
        : reqA?.maxBudget && reqA.maxBudget > 0
        ? reqA.maxBudget
        : null;

    const midB =
      reqB && reqB.minBudget > 0 && reqB.maxBudget > 0
        ? (reqB.minBudget + reqB.maxBudget) / 2
        : reqB?.minBudget && reqB.minBudget > 0
        ? reqB.minBudget
        : reqB?.maxBudget && reqB.maxBudget > 0
        ? reqB.maxBudget
        : null;

    if (midA !== null && midB !== null) {
      const diffA = Math.abs(midA - propertyPrice);
      const diffB = Math.abs(midB - propertyPrice);
      if (diffA !== diffB) {
        return diffA - diffB;
      }
    }
    // Note: When either midA or midB is null, Tier 2 is skipped so buyers are not
    // penalized for unspecified budgets. Evaluation proceeds to Tier 3.

    // 3. Buyer requirement confirmation date descending (LeadRequirement.confirmedAt DESC)
    // Deterministic fallback: Lead.createdAt DESC when confirmedAt is null
    const timeA = a.lead.requirements?.confirmedAt
      ? new Date(a.lead.requirements.confirmedAt).getTime()
      : a.lead.createdAt
      ? new Date(a.lead.createdAt).getTime()
      : 0;
    const timeB = b.lead.requirements?.confirmedAt
      ? new Date(b.lead.requirements.confirmedAt).getTime()
      : b.lead.createdAt
      ? new Date(b.lead.createdAt).getTime()
      : 0;
    if (timeB !== timeA) {
      return timeB - timeA;
    }

    // 4. Stable lead ID ascending
    return a.lead.id.localeCompare(b.lead.id);
  });
}

/**
 * Retrieves matching active supply properties for a given lead.
 * Strictly enforces:
 * - Tenant isolation.
 * - Telecaller scoping (assigned lead only, unless demand:view_all).
 * - "matching:view_matches" permission.
 * - Active supply pool eligibility (VALIDATED, AVAILABLE, willing owner).
 * - PRD deterministic scoring and ranking (M1-M6).
 */
export async function getMatchingPropertiesForLead(
  context: TenantContext,
  leadId: string
): Promise<LeadMatchingResults> {
  assertPermission(context, "matching:view_matches");

  if (!leadId?.trim()) {
    throw new ValidationError("Lead ID is required.");
  }

  // Enforce tenant scoping and role-based lead access
  const lead = await getLeadById(context, leadId);

  if (!lead.requirement) {
    return {
      lead: mapPrismaLeadToView(lead),
      matches: [],
      totalActiveInventoryCount: 0,
    };
  }

  // Total active supply inventory count in tenant
  const totalActiveInventoryCount = await prisma.property.count({
    where: {
      tenantId: context.tenantId,
      isActiveSupply: true,
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
      ownerWillingnessConfirmed: true,
    },
  });

  const propertyWhere: Prisma.PropertyWhereInput = {
    tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
    isActiveSupply: true,
    validationStatus: SupplyValidationStatus.VALIDATED,
    availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
    ownerWillingnessConfirmed: true,
    preference: lead.requirement.preference, // HARD GATE IN DATABASE
  };

  // Query eligible active supply properties (lean includes: avoid heavy media/callLogs/assignments/siteVisitItems)
  const eligibleProperties = await prisma.property.findMany({
    where: propertyWhere,
    include: {
      locality: true,
      keyHolders: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const buyerLocalities = lead.requirement.localities.map((l) => ({
    id: l.locality?.id || l.localityId || null,
    name: l.locality?.name || "",
    latitude: l.locality?.latitude ? Number(l.locality.latitude) : null,
    longitude: l.locality?.longitude ? Number(l.locality.longitude) : null,
    isVerified: true,
  }));

  const reqData: RawRequirementData = {
    preference: lead.requirement.preference,
    minBudget: lead.requirement.minBudget ? Number(lead.requirement.minBudget) : null,
    maxBudget: lead.requirement.maxBudget ? Number(lead.requirement.maxBudget) : null,
    city: lead.requirement.city,
    localities: buyerLocalities,
    propertyTypes: lead.requirement.propertyTypes,
    bedroomConfigurations: lead.requirement.bedroomConfigurations,
    minBedrooms: lead.requirement.minBedrooms,
    maxBedrooms: lead.requirement.maxBedrooms,
    targetArea: lead.requirement.targetArea ? Number(lead.requirement.targetArea) : null,
    minArea: lead.requirement.minArea ? Number(lead.requirement.minArea) : null,
    maxArea: lead.requirement.maxArea ? Number(lead.requirement.maxArea) : null,
    areaUnit: lead.requirement.areaUnit || "sq.ft",
    areaType: lead.requirement.areaType || null,
  };

  const matches: EvaluatedPropertyMatch[] = [];

  for (const prop of eligibleProperties) {
    const rawProp: RawPropertyData = {
      id: prop.id,
      preference: prop.preference,
      price: Number(prop.price),
      city: prop.city,
      localityId: prop.localityId || prop.locality?.id || null,
      localityName: prop.localityName,
      locality: prop.locality
        ? {
            id: prop.locality.id,
            name: prop.locality.name,
            latitude: prop.locality.latitude ? Number(prop.locality.latitude) : null,
            longitude: prop.locality.longitude ? Number(prop.locality.longitude) : null,
            isVerified: true,
          }
        : null,
      propertyType: prop.propertyType,
      bedroomCount: prop.bedroomCount,
      area: Number(prop.area),
      areaUnit: "sq.ft",
      areaType: prop.areaType,
      validationStatus: prop.validationStatus,
      availabilityStatus: prop.availabilityStatus,
      ownerWillingnessConfirmed: prop.ownerWillingnessConfirmed,
      isActiveSupply: prop.isActiveSupply,
      validatedAt: prop.validatedAt,
      updatedAt: prop.updatedAt,
    };

    const evaluation = evaluatePropertyMatch(reqData, rawProp);

    if (evaluation.isEligible) {
      matches.push({
        property: mapPrismaPropertyToView(prop),
        score: evaluation.score,
        isEligible: true,
        criteriaMatchedCount: evaluation.criteriaMatchedCount,
        criteriaEvaluatedCount: evaluation.criteriaEvaluatedCount,
        breakdown: evaluation.breakdown,
        unspecifiedCriteria: evaluation.unspecifiedCriteria,
      });
    }
  }

  // Deterministic sorting via M6 approved multi-tier tie-breaking
  sortPropertyMatches(matches, reqData);

  return {
    lead: mapPrismaLeadToView(lead),
    matches,
    totalActiveInventoryCount,
  };
}

/**
 * Retrieves matching active buyers and tenants across the brokerage tenant for a given property (PRD §7.2).
 * Strictly enforces:
 * - Tenant isolation.
 * - Property existence and eligibility.
 * - "matching:view_matches" permission.
 * - Identical PRD scoring logic (symmetrical matching).
 */
export async function getMatchingLeadsForProperty(
  context: TenantContext,
  propertyId: string
): Promise<PropertyMatchingResults> {
  assertPermission(context, "matching:view_matches");

  if (!propertyId?.trim()) {
    throw new ValidationError("Property ID is required.");
  }

  const property = await prisma.property.findFirst({
    where: {
      id: propertyId,
      tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
    },
    include: {
      locality: true,
      keyHolders: true,
      media: true,
      callLogs: {
        orderBy: { calledAt: "desc" },
        include: { caller: true },
      },
      assignments: {
        include: {
          assignedUser: true,
          assignedByUser: true,
        },
      },
      siteVisitItems: {
        include: {
          siteVisit: true,
        },
      },
    },
  });

  if (!property) {
    throw new NotFoundError("Property not found.");
  }

  // Total active leads in the brokerage tenant
  const totalActiveLeadsCount = await prisma.lead.count({
    where: {
      tenantId: context.tenantId,
      status: LeadStatus.ACTIVE,
    },
  });

  const leadWhere: Prisma.LeadWhereInput = {
    tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
    status: LeadStatus.ACTIVE,
    requirement: {
      preference: property.preference, // HARD GATE
    },
  };

  // Query all active leads in the tenant matching the transaction preference hard gate
  const activeLeads = await prisma.lead.findMany({
    where: leadWhere,
    include: {
      requirement: {
        include: {
          localities: {
            include: { locality: true },
          },
        },
      },
      enquiries: true,
      callLogs: {
        include: {
          caller: {
            select: { id: true, name: true, role: true },
          },
        },
        orderBy: { calledAt: "desc" },
      },
      assignedTelecaller: {
        select: { id: true, name: true, email: true },
      },
      siteVisits: {
        include: {
          items: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const rawProp: RawPropertyData = {
    id: property.id,
    preference: property.preference,
    price: Number(property.price),
    city: property.city,
    localityId: property.localityId || property.locality?.id || null,
    localityName: property.localityName,
    locality: property.locality
      ? {
          id: property.locality.id,
          name: property.locality.name,
          latitude: property.locality.latitude ? Number(property.locality.latitude) : null,
          longitude: property.locality.longitude ? Number(property.locality.longitude) : null,
          isVerified: true,
        }
      : null,
    propertyType: property.propertyType,
    bedroomCount: property.bedroomCount,
    area: Number(property.area),
    areaUnit: "sq.ft",
    areaType: property.areaType,
    validationStatus: property.validationStatus,
    availabilityStatus: property.availabilityStatus,
    ownerWillingnessConfirmed: property.ownerWillingnessConfirmed,
    isActiveSupply: property.isActiveSupply,
    validatedAt: property.validatedAt,
    updatedAt: property.updatedAt,
  };

  const matches: EvaluatedLeadMatch[] = [];

  for (const dbLead of activeLeads) {
    if (!dbLead.requirement) continue;

    const buyerLocalities = dbLead.requirement.localities.map((l) => ({
      id: l.locality?.id || l.localityId || null,
      name: l.locality?.name || "",
      latitude: l.locality?.latitude ? Number(l.locality.latitude) : null,
      longitude: l.locality?.longitude ? Number(l.locality.longitude) : null,
      isVerified: true,
    }));

    const reqData: RawRequirementData = {
      preference: dbLead.requirement.preference,
      minBudget: dbLead.requirement.minBudget ? Number(dbLead.requirement.minBudget) : null,
      maxBudget: dbLead.requirement.maxBudget ? Number(dbLead.requirement.maxBudget) : null,
      city: dbLead.requirement.city,
      localities: buyerLocalities,
      propertyTypes: dbLead.requirement.propertyTypes,
      bedroomConfigurations: dbLead.requirement.bedroomConfigurations,
      minBedrooms: dbLead.requirement.minBedrooms,
      maxBedrooms: dbLead.requirement.maxBedrooms,
      targetArea: dbLead.requirement.targetArea ? Number(dbLead.requirement.targetArea) : null,
      minArea: dbLead.requirement.minArea ? Number(dbLead.requirement.minArea) : null,
      maxArea: dbLead.requirement.maxArea ? Number(dbLead.requirement.maxArea) : null,
      areaUnit: dbLead.requirement.areaUnit || "sq.ft",
      areaType: dbLead.requirement.areaType || null,
    };

    const evaluation = evaluatePropertyMatch(reqData, rawProp);

    if (evaluation.isEligible) {
      // Determine site visit status for this buyer against this property
      const hasVisit = dbLead.siteVisits?.some((v) =>
        v.items?.some((item) => item.propertyId === property.id)
      );

      matches.push({
        lead: mapPrismaLeadToView(dbLead as unknown as Parameters<typeof mapPrismaLeadToView>[0]),
        score: evaluation.score,
        isEligible: true,
        criteriaMatchedCount: evaluation.criteriaMatchedCount,
        criteriaEvaluatedCount: evaluation.criteriaEvaluatedCount,
        breakdown: evaluation.breakdown,
        unspecifiedCriteria: evaluation.unspecifiedCriteria,
        visitStatus: hasVisit ? "Visit Scheduled" : "No Visits Yet",
      });
    }
  }

  // Deterministic symmetrical sorting
  sortLeadMatches(matches, Number(property.price));

  return {
    property: mapPrismaPropertyToView(property as unknown as Parameters<typeof mapPrismaPropertyToView>[0]),
    matches,
    totalActiveLeadsCount,
  };
}
