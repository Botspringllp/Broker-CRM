import { prisma } from "../db";
import { TenantContext, NotFoundError } from "../tenant-context";
import { assertPermission } from "../permissions";
import { ValidationError } from "../errors";
import {
  SupplyValidationStatus,
  PropertyAvailabilityStatus,
  LeadStatus,
} from "@prisma/client";
import { getLeadById } from "./leads";
import { mapPrismaPropertyToView, mapPrismaLeadToView } from "./mappers";
import { Property, Lead } from "@/types/crm";
import {
  CriterionResult,
  MatchCriteriaBreakdown,
  RawRequirementData,
  RawPropertyData,
  calculateHaversineDistanceKm,
  isPropertySupplyEligible,
  evaluatePropertyMatch,
} from "@/lib/matching-engine";

export {
  calculateHaversineDistanceKm,
  isPropertySupplyEligible,
  evaluatePropertyMatch,
};
export type {
  CriterionResult,
  MatchCriteriaBreakdown,
  RawRequirementData,
  RawPropertyData,
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
 * Retrieves matching active supply properties for a given lead.
 * Strictly enforces:
 * - Tenant isolation.
 * - Telecaller scoping (assigned lead only, unless demand:view_all).
 * - "matching:view_matches" permission.
 * - Active supply pool eligibility (VALIDATED, AVAILABLE, willing owner).
 * - PRD deterministic scoring and ranking.
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

  // Query eligible active supply properties matching the hard preference gate
  const eligibleProperties = await prisma.property.findMany({
    where: {
      tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
      isActiveSupply: true,
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
      ownerWillingnessConfirmed: true,
      preference: lead.requirement.preference, // HARD GATE IN DATABASE
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
    orderBy: { createdAt: "desc" },
  });

  const buyerLocalities = lead.requirement.localities.map((l) => ({
    name: l.locality?.name || "",
    latitude: l.locality?.latitude ? Number(l.locality.latitude) : null,
    longitude: l.locality?.longitude ? Number(l.locality.longitude) : null,
  }));

  const reqData: RawRequirementData = {
    preference: lead.requirement.preference,
    minBudget: Number(lead.requirement.minBudget),
    maxBudget: Number(lead.requirement.maxBudget),
    city: lead.requirement.city,
    localities: buyerLocalities,
    propertyTypes: lead.requirement.propertyTypes,
    bedroomConfigurations: lead.requirement.bedroomConfigurations,
    minBedrooms: lead.requirement.minBedrooms,
    maxBedrooms: lead.requirement.maxBedrooms,
    targetArea: lead.requirement.targetArea ? Number(lead.requirement.targetArea) : null,
  };

  const matches: EvaluatedPropertyMatch[] = [];

  for (const prop of eligibleProperties) {
    const rawProp: RawPropertyData = {
      id: prop.id,
      preference: prop.preference,
      price: Number(prop.price),
      city: prop.city,
      localityName: prop.localityName,
      locality: prop.locality
        ? {
            name: prop.locality.name,
            latitude: prop.locality.latitude ? Number(prop.locality.latitude) : null,
            longitude: prop.locality.longitude ? Number(prop.locality.longitude) : null,
          }
        : null,
      propertyType: prop.propertyType,
      bedroomCount: prop.bedroomCount,
      area: Number(prop.area),
      validationStatus: prop.validationStatus,
      availabilityStatus: prop.availabilityStatus,
      ownerWillingnessConfirmed: prop.ownerWillingnessConfirmed,
      isActiveSupply: prop.isActiveSupply,
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

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

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
 * - Identical PRD scoring logic.
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

  // Query all active leads in the tenant matching the transaction preference hard gate
  const activeLeads = await prisma.lead.findMany({
    where: {
      tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
      status: LeadStatus.ACTIVE,
      requirement: {
        preference: property.preference, // HARD GATE
      },
    },
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
    localityName: property.localityName,
    locality: property.locality
      ? {
          name: property.locality.name,
          latitude: property.locality.latitude ? Number(property.locality.latitude) : null,
          longitude: property.locality.longitude ? Number(property.locality.longitude) : null,
        }
      : null,
    propertyType: property.propertyType,
    bedroomCount: property.bedroomCount,
    area: Number(property.area),
    validationStatus: property.validationStatus,
    availabilityStatus: property.availabilityStatus,
    ownerWillingnessConfirmed: property.ownerWillingnessConfirmed,
    isActiveSupply: property.isActiveSupply,
  };

  const matches: EvaluatedLeadMatch[] = [];

  for (const dbLead of activeLeads) {
    if (!dbLead.requirement) continue;

    const buyerLocalities = dbLead.requirement.localities.map((l) => ({
      name: l.locality?.name || "",
      latitude: l.locality?.latitude ? Number(l.locality.latitude) : null,
      longitude: l.locality?.longitude ? Number(l.locality.longitude) : null,
    }));

    const reqData: RawRequirementData = {
      preference: dbLead.requirement.preference,
      minBudget: Number(dbLead.requirement.minBudget),
      maxBudget: Number(dbLead.requirement.maxBudget),
      city: dbLead.requirement.city,
      localities: buyerLocalities,
      propertyTypes: dbLead.requirement.propertyTypes,
      bedroomConfigurations: dbLead.requirement.bedroomConfigurations,
      minBedrooms: dbLead.requirement.minBedrooms,
      maxBedrooms: dbLead.requirement.maxBedrooms,
      targetArea: dbLead.requirement.targetArea ? Number(dbLead.requirement.targetArea) : null,
    };

    const evaluation = evaluatePropertyMatch(reqData, rawProp);

    if (evaluation.isEligible) {
      // Determine site visit status for this buyer against this property
      const hasVisit = dbLead.siteVisits?.some((v) =>
        v.items?.some((item) => item.propertyId === property.id)
      );

      matches.push({
        lead: mapPrismaLeadToView(dbLead as any),
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

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return {
    property: mapPrismaPropertyToView(property as any),
    matches,
    totalActiveLeadsCount,
  };
}
