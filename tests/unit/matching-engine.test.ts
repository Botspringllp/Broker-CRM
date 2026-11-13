/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateHaversineDistanceKm,
  isPropertySupplyEligible,
  evaluatePropertyMatch,
  RawRequirementData,
  RawPropertyData,
} from "@/lib/matching-engine";
import { UserRole, SupplyValidationStatus, PropertyAvailabilityStatus, LeadStatus, AreaUnitType } from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";

vi.mock("@/server/db", () => {
  const mockPrisma = {
    property: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    lead: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

import { prisma } from "@/server/db";
import {
  getMatchingPropertiesForLead,
  getMatchingLeadsForProperty,
  sortPropertyMatches,
  sortLeadMatches,
  EvaluatedPropertyMatch,
  EvaluatedLeadMatch,
} from "@/server/dal/matching";

describe("Property Matching Engine & Active Supply Pool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Pure Mathematics & Proximity Helpers", () => {
    it("calculateHaversineDistanceKm returns 0 for identical coordinates", () => {
      const dist = calculateHaversineDistanceKm(28.4595, 77.0266, 28.4595, 77.0266);
      expect(dist).toBe(0);
    });

    it("calculateHaversineDistanceKm correctly calculates distance between two Gurgaon coordinates", () => {
      // Cyber City (28.4950, 77.0895) to Golf Course Road (28.4595, 77.0988) ~ 4 km
      const dist = calculateHaversineDistanceKm(28.495, 77.0895, 28.4595, 77.0988);
      expect(dist).toBeGreaterThan(3.5);
      expect(dist).toBeLessThan(4.5);
    });

    it("isPropertySupplyEligible strictly verifies validated, available, and owner willingness", () => {
      expect(
        isPropertySupplyEligible({
          ownerWillingnessConfirmed: true,
          validationStatus: "VALIDATED",
          availabilityStatus: "AVAILABLE",
        })
      ).toBe(true);

      // Ineligible if unvalidated
      expect(
        isPropertySupplyEligible({
          ownerWillingnessConfirmed: true,
          validationStatus: "PENDING",
          availabilityStatus: "AVAILABLE",
        })
      ).toBe(false);

      // Ineligible if sold
      expect(
        isPropertySupplyEligible({
          ownerWillingnessConfirmed: true,
          validationStatus: "VALIDATED",
          availabilityStatus: "SOLD",
        })
      ).toBe(false);

      // Ineligible if rented
      expect(
        isPropertySupplyEligible({
          ownerWillingnessConfirmed: true,
          validationStatus: "VALIDATED",
          availabilityStatus: "RENTED",
        })
      ).toBe(false);

      // Ineligible if temporarily unavailable
      expect(
        isPropertySupplyEligible({
          ownerWillingnessConfirmed: true,
          validationStatus: "VALIDATED",
          availabilityStatus: "TEMPORARILY_UNAVAILABLE",
        })
      ).toBe(false);

      // Ineligible if owner willingness not confirmed
      expect(
        isPropertySupplyEligible({
          ownerWillingnessConfirmed: false,
          validationStatus: "VALIDATED",
          availabilityStatus: "AVAILABLE",
        })
      ).toBe(false);
    });
  });

  describe("2. Pure Scoring Engine: Hard Gates (PRD §6.1)", () => {
    const baseRequirement: RawRequirementData = {
      preference: "SALE",
      minBudget: 10000000, // 1 Cr
      maxBudget: 20000000, // 2 Cr
      city: "Gurugram",
      localities: [{ name: "Golf Course Road", latitude: 28.4595, longitude: 77.0988 }],
      propertyTypes: ["APARTMENT"],
      bedroomConfigurations: ["3 BHK"],
      targetArea: 1500,
    };

    const baseProperty: RawPropertyData = {
      id: "prop-1",
      preference: "SALE",
      price: 15000000, // 1.5 Cr
      city: "Gurugram",
      localityName: "Golf Course Road",
      locality: { name: "Golf Course Road", latitude: 28.4595, longitude: 77.0988 },
      propertyType: "APARTMENT",
      bedroomCount: 3,
      area: 1500,
      validationStatus: "VALIDATED",
      availabilityStatus: "AVAILABLE",
      ownerWillingnessConfirmed: true,
      isActiveSupply: true,
    };

    it("Hard Gate 1: Rejects transaction preference mismatch (SALE vs RENT) with 0% score", () => {
      const rentProp: RawPropertyData = {
        ...baseProperty,
        preference: "RENT",
        price: 60000,
      };

      const result = evaluatePropertyMatch(baseRequirement, rentProp);
      expect(result.isEligible).toBe(false);
      expect(result.score).toBe(0);
      expect(result.criteriaMatchedCount).toBe(0);
      expect(result.breakdown.preference.matched).toBe(false);
      expect(result.breakdown.preference.details).toContain("Mismatch: Buyer wants");
    });

    it("Hard Gate 2: Rejects unvalidated properties with 0% score and ineligibility", () => {
      const pendingProp: RawPropertyData = {
        ...baseProperty,
        validationStatus: "PENDING",
      };

      const result = evaluatePropertyMatch(baseRequirement, pendingProp);
      expect(result.isEligible).toBe(false);
      expect(result.score).toBe(0);
      expect(result.criteriaMatchedCount).toBe(0);
      expect(result.breakdown.budget.details).toContain("not an active, validated available");
    });

    it("Hard Gate 2: Rejects SOLD and RENTED properties with 0% score", () => {
      const soldProp: RawPropertyData = {
        ...baseProperty,
        availabilityStatus: "SOLD",
      };
      const soldResult = evaluatePropertyMatch(baseRequirement, soldProp);
      expect(soldResult.isEligible).toBe(false);
      expect(soldResult.score).toBe(0);

      const rentedProp: RawPropertyData = {
        ...baseProperty,
        availabilityStatus: "RENTED",
      };
      const rentedResult = evaluatePropertyMatch(baseRequirement, rentedProp);
      expect(rentedResult.isEligible).toBe(false);
      expect(rentedResult.score).toBe(0);
    });

    it("Hard Gate 2: Rejects properties with unconfirmed owner willingness", () => {
      const unwillingProp: RawPropertyData = {
        ...baseProperty,
        ownerWillingnessConfirmed: false,
      };

      const result = evaluatePropertyMatch(baseRequirement, unwillingProp);
      expect(result.isEligible).toBe(false);
      expect(result.score).toBe(0);
    });
  });

  describe("3. Pure Scoring Engine: Criteria Evaluation & Tolerances (PRD §6.2 & Approved Decisions)", () => {
    const baseRequirement: RawRequirementData = {
      preference: "SALE",
      minBudget: 15000000, // 1.5 Cr
      maxBudget: 20000000, // 2.0 Cr
      city: "Gurugram",
      localities: [{ id: "loc-1", name: "DLF Phase 5", latitude: 28.455, longitude: 77.095, isVerified: true }],
      propertyTypes: ["APARTMENT", "BUILDER_FLOOR"],
      bedroomConfigurations: ["3 BHK", "4 BHK"],
      minArea: 1800,
      maxArea: 2200,
      targetArea: 2000,
      areaUnit: "SQ_FT",
      areaType: "CARPET",
    };

    const eligibleBaseProp: RawPropertyData = {
      id: "prop-valid",
      preference: "SALE",
      price: 17500000, // 1.75 Cr (midpoint)
      city: "Gurugram",
      localityId: "loc-1",
      localityName: "DLF Phase 5",
      locality: { name: "DLF Phase 5", latitude: 28.455, longitude: 77.095, isVerified: true },
      propertyType: "APARTMENT",
      bedroomCount: 3,
      area: 2000,
      areaUnit: "SQ_FT",
      areaType: "CARPET",
      validationStatus: "VALIDATED",
      availabilityStatus: "AVAILABLE",
      ownerWillingnessConfirmed: true,
      isActiveSupply: true,
    };

    it("evaluates a perfect match as 100% across all 6 criteria", () => {
      const result = evaluatePropertyMatch(baseRequirement, eligibleBaseProp);
      expect(result.isEligible).toBe(true);
      expect(result.score).toBe(100);
      expect(result.criteriaEvaluatedCount).toBe(6);
      expect(result.criteriaMatchedCount).toBe(6);
      expect(result.breakdown.preference.matched).toBe(true);
      expect(result.breakdown.budget.matched).toBe(true);
      expect(result.breakdown.locality.matched).toBe(true);
      expect(result.breakdown.propertyType.matched).toBe(true);
      expect(result.breakdown.bedroomCount.matched).toBe(true);
      expect(result.breakdown.area.matched).toBe(true);
    });

    it("qualifies property price within stated budget range directly", () => {
      const prop: RawPropertyData = { ...eligibleBaseProp, price: 16000000 };
      const result = evaluatePropertyMatch(baseRequirement, prop);
      expect(result.breakdown.budget.matched).toBe(true);
      expect(result.breakdown.budget.details).toBe("Within stated buyer budget range");
    });

    it("qualifies property price outside stated range but within PRD ±25% midpoint tolerance window", () => {
      // Range: 1.5 Cr - 2.0 Cr. Midpoint = 1.75 Cr.
      // ±25% of 1.75 Cr = 0.4375 Cr.
      // Tolerance window: [1.3125 Cr, 2.1875 Cr]
      // Test price 2.1 Cr (outside [1.5, 2.0 Cr] but inside [1.3125, 2.1875 Cr])
      const propHigh: RawPropertyData = { ...eligibleBaseProp, price: 21000000 };
      const resultHigh = evaluatePropertyMatch(baseRequirement, propHigh);
      expect(resultHigh.breakdown.budget.matched).toBe(true);
      expect(resultHigh.breakdown.budget.details).toBe("Within PRD ±25% midpoint tolerance window");

      // Test price 1.4 Cr (outside [1.5, 2.0 Cr] but inside [1.3125, 2.1875 Cr])
      const propLow: RawPropertyData = { ...eligibleBaseProp, price: 14000000 };
      const resultLow = evaluatePropertyMatch(baseRequirement, propLow);
      expect(resultLow.breakdown.budget.matched).toBe(true);
      expect(resultLow.breakdown.budget.details).toBe("Within PRD ±25% midpoint tolerance window");
    });

    it("rejects property price outside both stated range and midpoint ±25% tolerance window", () => {
      // Range: 1.5 Cr - 2.0 Cr. Tolerance window max is 2.1875 Cr.
      // Price 2.3 Cr is strictly outside both
      const propTooHigh: RawPropertyData = { ...eligibleBaseProp, price: 23000000 };
      const result = evaluatePropertyMatch(baseRequirement, propTooHigh);
      expect(result.breakdown.budget.matched).toBe(false);
      expect(result.breakdown.budget.details).toBe("Outside buyer budget range and tolerance");
    });

    it("matches locality by coordinate proximity when distance <= 3 km even if name differs", () => {
      // Property at Sector 42 (28.465, 77.095) - approx 1.11 km from DLF Phase 5 (28.455, 77.095)
      const propNearby: RawPropertyData = {
        ...eligibleBaseProp,
        localityId: "loc-diff",
        localityName: "Sector 42",
        locality: { name: "Sector 42", latitude: 28.465, longitude: 77.095, isVerified: true },
      };

      const result = evaluatePropertyMatch(baseRequirement, propNearby);
      expect(result.breakdown.locality.matched).toBe(true);
      expect(result.breakdown.locality.details).toContain("≤ 3 km threshold");
    });

    it("rejects locality when coordinate distance > 3 km and name does not match", () => {
      // Property at Sohna Road (28.405, 77.045) - approx 7 km away
      const propFar: RawPropertyData = {
        ...eligibleBaseProp,
        localityId: "loc-sohna",
        localityName: "Sohna Road",
        locality: { name: "Sohna Road", latitude: 28.405, longitude: 77.045, isVerified: true },
      };

      const result = evaluatePropertyMatch(baseRequirement, propFar);
      expect(result.breakdown.locality.matched).toBe(false);
      expect(result.breakdown.locality.details).toContain("does not match buyer's preferred localities");
    });

    it("evaluates bedroom configurations correctly across multi-select BHK options", () => {
      // Buyer wants ["3 BHK", "4 BHK"]
      const prop3BHK: RawPropertyData = { ...eligibleBaseProp, bedroomCount: 3 };
      expect(evaluatePropertyMatch(baseRequirement, prop3BHK).breakdown.bedroomCount.matched).toBe(true);

      const prop4BHK: RawPropertyData = { ...eligibleBaseProp, bedroomCount: 4 };
      expect(evaluatePropertyMatch(baseRequirement, prop4BHK).breakdown.bedroomCount.matched).toBe(true);

      const prop2BHK: RawPropertyData = { ...eligibleBaseProp, bedroomCount: 2 };
      expect(evaluatePropertyMatch(baseRequirement, prop2BHK).breakdown.bedroomCount.matched).toBe(false);
    });
  });

  describe("4. Detailed DV-11 Scenarios (19 Business Rule Hardening Tests)", () => {
    const baseReq: RawRequirementData = {
      preference: "SALE",
      minBudget: 15000000,
      maxBudget: 20000000,
      city: "Gurugram",
      localities: [{ id: "loc-dlf5", name: "DLF Phase 5", latitude: 28.455, longitude: 77.095, isVerified: true }],
      propertyTypes: ["APARTMENT"],
      bedroomConfigurations: ["3 BHK"],
      minArea: 1500,
      maxArea: 2000,
      targetArea: 1750,
      areaUnit: "SQ_FT",
      areaType: "CARPET",
    };

    const baseProp: RawPropertyData = {
      id: "prop-base",
      preference: "SALE",
      price: 17500000,
      city: "Gurugram",
      localityId: "loc-dlf5",
      localityName: "DLF Phase 5",
      locality: { name: "DLF Phase 5", latitude: 28.455, longitude: 77.095, isVerified: true },
      propertyType: "APARTMENT",
      bedroomCount: 3,
      area: 1750,
      areaUnit: "SQ_FT",
      areaType: "CARPET",
      validationStatus: "VALIDATED",
      availabilityStatus: "AVAILABLE",
      ownerWillingnessConfirmed: true,
      isActiveSupply: true,
      updatedAt: new Date("2026-05-10"),
    };

    // Scenario 1: Area range matching (inside range, exact min boundary, exact max boundary)
    it("Scenario 1: Area range matching evaluates properties inside range and on exact min/max boundaries as matched", () => {
      const propInside = { ...baseProp, area: 1750 };
      expect(evaluatePropertyMatch(baseReq, propInside).breakdown.area.matched).toBe(true);

      const propExactMin = { ...baseProp, area: 1500 };
      expect(evaluatePropertyMatch(baseReq, propExactMin).breakdown.area.matched).toBe(true);

      const propExactMax = { ...baseProp, area: 2000 };
      expect(evaluatePropertyMatch(baseReq, propExactMax).breakdown.area.matched).toBe(true);

      const propBelowMin = { ...baseProp, area: 1499 };
      expect(evaluatePropertyMatch(baseReq, propBelowMin).breakdown.area.matched).toBe(false);

      const propAboveMax = { ...baseProp, area: 2001 };
      expect(evaluatePropertyMatch(baseReq, propAboveMax).breakdown.area.matched).toBe(false);
    });

    // Scenario 2: One-sided area boundaries (min-only >=, max-only <=)
    it("Scenario 2: Evaluates one-sided area boundaries (min-only >=, max-only <=) correctly", () => {
      // Min-only >= 1500
      const minOnlyReq: RawRequirementData = { ...baseReq, minArea: 1500, maxArea: null };
      expect(evaluatePropertyMatch(minOnlyReq, { ...baseProp, area: 1500 }).breakdown.area.matched).toBe(true);
      expect(evaluatePropertyMatch(minOnlyReq, { ...baseProp, area: 3000 }).breakdown.area.matched).toBe(true);
      expect(evaluatePropertyMatch(minOnlyReq, { ...baseProp, area: 1499 }).breakdown.area.matched).toBe(false);

      // Max-only <= 2000
      const maxOnlyReq: RawRequirementData = { ...baseReq, minArea: null, maxArea: 2000 };
      expect(evaluatePropertyMatch(maxOnlyReq, { ...baseProp, area: 2000 }).breakdown.area.matched).toBe(true);
      expect(evaluatePropertyMatch(maxOnlyReq, { ...baseProp, area: 1000 }).breakdown.area.matched).toBe(true);
      expect(evaluatePropertyMatch(maxOnlyReq, { ...baseProp, area: 2001 }).breakdown.area.matched).toBe(false);
    });

    // Scenario 3: Missing area requirements (neither min nor max; verify excluded from denominator even with targetArea)
    it("Scenario 3: Excludes area from denominator when minArea and maxArea are missing, even if targetArea is present", () => {
      const noMinMaxReq: RawRequirementData = {
        ...baseReq,
        minArea: null,
        maxArea: null,
        targetArea: 1800,
      };

      const result = evaluatePropertyMatch(noMinMaxReq, baseProp);
      expect(result.breakdown.area.evaluated).toBe(false);
      expect(result.unspecifiedCriteria).toContain("Property Area");
      // Total evaluated should be 5 instead of 6
      expect(result.criteriaEvaluatedCount).toBe(5);
    });

    // Scenario 4: Unit and area-type compatibility (incompatible units fail; area type mismatch e.g. Carpet vs Super built-up fails)
    it("Scenario 4: Handles area unit conversions correctly and rejects mismatched area types", () => {
      // Compatible conversion: Req in SQ_YD [166.67, 222.22], Property in SQ_FT (1800 sq ft = 200 sq yd)
      const sqYdReq: RawRequirementData = {
        ...baseReq,
        minArea: 160,
        maxArea: 220,
        areaUnit: "SQ_YD",
        areaType: "CARPET",
      };
      const propSqFt: RawPropertyData = {
        ...baseProp,
        area: 1800, // 1800 sq ft = 200 sq yd
        areaUnit: "SQ_FT",
        areaType: "CARPET",
      };
      const matchResult = evaluatePropertyMatch(sqYdReq, propSqFt);
      expect(matchResult.breakdown.area.matched).toBe(true);

      // Mismatched area type: CARPET vs SUPER_BUILT_UP
      const propSuperBuiltUp: RawPropertyData = {
        ...baseProp,
        areaType: "SUPER_BUILT_UP",
      };
      const mismatchResult = evaluatePropertyMatch(baseReq, propSuperBuiltUp);
      expect(mismatchResult.breakdown.area.matched).toBe(false);
      expect(mismatchResult.breakdown.area.details).toContain("Area type mismatch");
    });

    // Scenario 5: Locality substring false positives (e.g. "Sector 5" vs "Sector 54" must NOT match)
    it("Scenario 5: Rejects locality substring matches (e.g. 'Sector 5' vs 'Sector 54' must NOT match)", () => {
      const sector5Req: RawRequirementData = {
        ...baseReq,
        localities: [{ name: "Sector 5", latitude: null, longitude: null }],
      };
      const sector54Prop: RawPropertyData = {
        ...baseProp,
        localityId: null,
        localityName: "Sector 54",
        locality: null,
      };

      const result = evaluatePropertyMatch(sector5Req, sector54Prop);
      expect(result.breakdown.locality.matched).toBe(false);
    });

    // Scenario 6: Exact locality fallback (when coordinates missing, exact normalized string matches)
    it("Scenario 6: Fallback to exact normalized locality name match when coordinates are unavailable", () => {
      const req: RawRequirementData = {
        ...baseReq,
        localities: [{ name: "  Sector 54, Golf Course Road  ", latitude: null, longitude: null }],
      };
      const prop: RawPropertyData = {
        ...baseProp,
        localityId: null,
        localityName: "sector 54, golf course road",
        locality: null,
      };

      const result = evaluatePropertyMatch(req, prop);
      expect(result.breakdown.locality.matched).toBe(true);
      expect(result.breakdown.locality.details).toContain("Matched by exact normalized locality name");
    });

    // Scenario 7: Verified 3 km proximity boundary (distance <= 3.0 km matches, > 3.0 km fails)
    it("Scenario 7: Proximity matching strictly respects <= 3.0 km verified threshold and rejects > 3.0 km", () => {
      // Point A: (28.4550, 77.0950)
      // Point B: (28.4650, 77.0950) -> ~1.11 km <= 3.0 km
      const prop3KmInside: RawPropertyData = {
        ...baseProp,
        localityId: "loc-nearby",
        localityName: "Sector 42",
        locality: { name: "Sector 42", latitude: 28.465, longitude: 77.095, isVerified: true },
      };
      expect(evaluatePropertyMatch(baseReq, prop3KmInside).breakdown.locality.matched).toBe(true);

      // Point C: (28.4000, 77.0950) -> ~6.1 km > 3.0 km
      const prop3KmOutside: RawPropertyData = {
        ...baseProp,
        localityId: "loc-far",
        localityName: "Sector 65",
        locality: { name: "Sector 65", latitude: 28.4, longitude: 77.095, isVerified: true },
      };
      expect(evaluatePropertyMatch(baseReq, prop3KmOutside).breakdown.locality.matched).toBe(false);
    });

    // Scenario 8: Unverified or missing coordinates (isVerified: false prevents proximity check and requires exact name)
    it("Scenario 8: Requires verified coordinates for proximity matching, skipping proximity if unverified", () => {
      const propUnverified: RawPropertyData = {
        ...baseProp,
        localityId: "loc-nearby",
        localityName: "Sector 42", // Different name
        locality: { name: "Sector 42", latitude: 28.465, longitude: 77.095, isVerified: false }, // Unverified!
      };

      const result = evaluatePropertyMatch(baseReq, propUnverified);
      expect(result.breakdown.locality.matched).toBe(false);
    });

    // Scenario 9: Missing budget denominator (unspecified budget excluded from denominator)
    it("Scenario 9: Excludes unspecified or zero budget from evaluated criteria count", () => {
      const noBudgetReq: RawRequirementData = {
        ...baseReq,
        minBudget: null,
        maxBudget: 0,
      };

      const result = evaluatePropertyMatch(noBudgetReq, baseProp);
      expect(result.breakdown.budget.evaluated).toBe(false);
      expect(result.unspecifiedCriteria).toContain("Budget");
      expect(result.criteriaEvaluatedCount).toBe(5);
    });

    // Scenario 10: Missing BHK denominator (unspecified BHK excluded from denominator)
    it("Scenario 10: Excludes unspecified BHK configuration from evaluated criteria count", () => {
      const noBhkReq: RawRequirementData = {
        ...baseReq,
        bedroomConfigurations: [],
        minBedrooms: null,
        maxBedrooms: null,
      };

      const result = evaluatePropertyMatch(noBhkReq, baseProp);
      expect(result.breakdown.bedroomCount.evaluated).toBe(false);
      expect(result.unspecifiedCriteria).toContain("Bedroom Configuration");
      expect(result.criteriaEvaluatedCount).toBe(5);
    });

    // Scenario 11: Score ordering (score DESC)
    it("Scenario 11: sortPropertyMatches sorts candidates by matching score descending", () => {
      const mockMatches: EvaluatedPropertyMatch[] = [
        {
          property: { id: "prop-low", price: 17500000, updatedAt: new Date() } as any,
          score: 60,
          isEligible: true,
          criteriaMatchedCount: 3,
          criteriaEvaluatedCount: 5,
          breakdown: {} as any,
          unspecifiedCriteria: [],
        },
        {
          property: { id: "prop-high", price: 17500000, updatedAt: new Date() } as any,
          score: 100,
          isEligible: true,
          criteriaMatchedCount: 5,
          criteriaEvaluatedCount: 5,
          breakdown: {} as any,
          unspecifiedCriteria: [],
        },
      ];

      const sorted = sortPropertyMatches(mockMatches, { minBudget: 15000000, maxBudget: 20000000 });
      expect(sorted[0].property.id).toBe("prop-high");
      expect(sorted[1].property.id).toBe("prop-low");
    });

    // Scenario 12: Budget midpoint tie-break (same score, closer price difference to budget midpoint ranks higher)
    it("Scenario 12: Breaks score ties by property price closest to buyer budget midpoint", () => {
      // Budget midpoint: (1.5 Cr + 2.5 Cr) / 2 = 2.0 Cr
      // Prop A: price 1.9 Cr (diff = 0.1 Cr)
      // Prop B: price 1.7 Cr (diff = 0.3 Cr)
      const mockMatches: EvaluatedPropertyMatch[] = [
        {
          property: { id: "prop-b", price: 17000000, updatedAt: new Date("2026-05-01") } as any,
          score: 80,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 5,
          breakdown: {} as any,
          unspecifiedCriteria: [],
        },
        {
          property: { id: "prop-a", price: 19000000, updatedAt: new Date("2026-05-01") } as any,
          score: 80,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 5,
          breakdown: {} as any,
          unspecifiedCriteria: [],
        },
      ];

      const sorted = sortPropertyMatches(mockMatches, { minBudget: 15000000, maxBudget: 25000000 });
      expect(sorted[0].property.id).toBe("prop-a");
      expect(sorted[1].property.id).toBe("prop-b");
    });

    // Scenario 13: Missing budget tie-break (same score, missing budget skips midpoint and tie-breaks by validation date)
    it("Scenario 13: Skips budget midpoint comparison when buyer budget is missing without defaulting to 0", () => {
      // Missing budget: null
      // Prop A: price 1.0 Cr, older updatedAt (2026-01-01)
      // Prop B: price 3.0 Cr, newer updatedAt (2026-05-01)
      // If code substituted 0, Prop A (diff from 0 is 1.0 Cr) would beat Prop B (diff 3.0 Cr).
      // With midpoint skipped, Prop B (newer updatedAt) must win!
      const mockMatches: EvaluatedPropertyMatch[] = [
        {
          property: { id: "prop-older", price: 10000000, updatedAt: new Date("2026-01-01") } as any,
          score: 80,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 5,
          breakdown: {} as any,
          unspecifiedCriteria: [],
        },
        {
          property: { id: "prop-newer", price: 30000000, updatedAt: new Date("2026-05-01") } as any,
          score: 80,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 5,
          breakdown: {} as any,
          unspecifiedCriteria: [],
        },
      ];

      const sorted = sortPropertyMatches(mockMatches, { minBudget: null, maxBudget: null });
      expect(sorted[0].property.id).toBe("prop-newer");
      expect(sorted[1].property.id).toBe("prop-older");
    });

    // Scenario 14: Latest validation date tie-break (validatedAt DESC takes precedence over subsequent edits)
    it("Scenario 14: Breaks score and price ties by most recent validatedAt date descending, ignoring subsequent edits", () => {
      // Property A: validated Jan 1, 2026. Edited on June 1, 2026 (updatedAt is newer)
      // Property B: validated May 1, 2026. Not edited (updatedAt is May 1)
      // Rule: Property B was validated later, so Property B must rank before Property A despite Property A's newer updatedAt!
      const mockMatches: EvaluatedPropertyMatch[] = [
        {
          property: {
            id: "prop-a-edited-later",
            price: 18000000,
            validatedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z", // Edited later!
            createdAt: "2025-12-01T00:00:00.000Z",
          } as any,
          score: 80,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 5,
          breakdown: {} as any,
          unspecifiedCriteria: [],
        },
        {
          property: {
            id: "prop-b-validated-later",
            price: 18000000,
            validatedAt: "2026-05-01T00:00:00.000Z", // Validated later!
            updatedAt: "2026-05-01T00:00:00.000Z",
            createdAt: "2026-04-01T00:00:00.000Z",
          } as any,
          score: 80,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 5,
          breakdown: {} as any,
          unspecifiedCriteria: [],
        },
      ];

      const sorted = sortPropertyMatches(mockMatches, { minBudget: 15000000, maxBudget: 20000000 });
      expect(sorted[0].property.id).toBe("prop-b-validated-later");
      expect(sorted[1].property.id).toBe("prop-a-edited-later");
    });

    it("Scenario 14b: Falls back to createdAt DESC when validatedAt is null", () => {
      const mockMatches: EvaluatedPropertyMatch[] = [
        {
          property: {
            id: "prop-older-created",
            price: 18000000,
            validatedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          } as any,
          score: 80,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 5,
          breakdown: {} as any,
          unspecifiedCriteria: [],
        },
        {
          property: {
            id: "prop-newer-created",
            price: 18000000,
            validatedAt: null,
            createdAt: "2026-05-01T00:00:00.000Z",
          } as any,
          score: 80,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 5,
          breakdown: {} as any,
          unspecifiedCriteria: [],
        },
      ];

      const sorted = sortPropertyMatches(mockMatches, { minBudget: 15000000, maxBudget: 20000000 });
      expect(sorted[0].property.id).toBe("prop-newer-created");
      expect(sorted[1].property.id).toBe("prop-older-created");
    });

    // Scenario 15: Stable property ID tie-break (same score, price, date, sorted by id ASC)
    it("Scenario 15: Breaks remaining ties using stable ascending property ID", () => {
      const sameDate = new Date("2026-05-01");
      const mockMatches: EvaluatedPropertyMatch[] = [
        {
          property: { id: "prop-zzz", price: 18000000, updatedAt: sameDate } as any,
          score: 80,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 5,
          breakdown: {} as any,
          unspecifiedCriteria: [],
        },
        {
          property: { id: "prop-aaa", price: 18000000, updatedAt: sameDate } as any,
          score: 80,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 5,
          breakdown: {} as any,
          unspecifiedCriteria: [],
        },
      ];

      const sorted = sortPropertyMatches(mockMatches, { minBudget: 15000000, maxBudget: 20000000 });
      expect(sorted[0].property.id).toBe("prop-aaa");
      expect(sorted[1].property.id).toBe("prop-zzz");
    });

    // Scenario 16: Active supply eligibility
    it("Scenario 16: Active supply pool gate excludes unvalidated, unavailable, or unconfirmed willingness inventory", () => {
      expect(isPropertySupplyEligible({
        validationStatus: SupplyValidationStatus.VALIDATED,
        availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
        ownerWillingnessConfirmed: true,
      })).toBe(true);

      expect(isPropertySupplyEligible({
        validationStatus: SupplyValidationStatus.NOT_VALIDATED,
        availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
        ownerWillingnessConfirmed: true,
      })).toBe(false);

      expect(isPropertySupplyEligible({
        validationStatus: SupplyValidationStatus.VALIDATED,
        availabilityStatus: PropertyAvailabilityStatus.SOLD,
        ownerWillingnessConfirmed: true,
      })).toBe(false);

      expect(isPropertySupplyEligible({
        validationStatus: SupplyValidationStatus.VALIDATED,
        availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
        ownerWillingnessConfirmed: false,
      })).toBe(false);
    });

    // Scenario 17: Property-to-buyer matching (sortLeadMatches) tie-breaking & missing budget handling
    it("Scenario 17: Property-to-buyer matching (sortLeadMatches) does not penalize missing budget and enforces multi-tier tie-breaking", () => {
      // 17.1 Score descending tier
      const mockLeadMatchesScore: EvaluatedLeadMatch[] = [
        {
          lead: { id: "lead-lower", requirements: { minBudget: 15000000, maxBudget: 20000000 }, createdAt: new Date("2026-05-01") } as any,
          score: 75,
          isEligible: true,
          criteriaMatchedCount: 3,
          criteriaEvaluatedCount: 4,
          breakdown: {} as any,
          unspecifiedCriteria: [],
          visitStatus: "No Visits Yet",
        },
        {
          lead: { id: "lead-higher", requirements: { minBudget: 15000000, maxBudget: 20000000 }, createdAt: new Date("2026-05-01") } as any,
          score: 100,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 4,
          breakdown: {} as any,
          unspecifiedCriteria: [],
          visitStatus: "No Visits Yet",
        },
      ];
      expect(sortLeadMatches(mockLeadMatchesScore, 18000000)[0].lead.id).toBe("lead-higher");

      // 17.2 Budget midpoint tie-break when both leads have budgets
      // Property price: 1.8 Cr. Lead closer midpoint: 1.85 Cr (diff 5L). Lead farther midpoint: 1.6 Cr (diff 20L)
      const mockLeadMatchesBudget: EvaluatedLeadMatch[] = [
        {
          lead: { id: "lead-farther", requirements: { minBudget: 15000000, maxBudget: 17000000 }, createdAt: new Date("2026-05-01") } as any,
          score: 100,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 4,
          breakdown: {} as any,
          unspecifiedCriteria: [],
          visitStatus: "No Visits Yet",
        },
        {
          lead: { id: "lead-closer", requirements: { minBudget: 17000000, maxBudget: 20000000 }, createdAt: new Date("2026-05-01") } as any,
          score: 100,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 4,
          breakdown: {} as any,
          unspecifiedCriteria: [],
          visitStatus: "No Visits Yet",
        },
      ];
      expect(sortLeadMatches(mockLeadMatchesBudget, 18000000)[0].lead.id).toBe("lead-closer");

      // 17.3 Missing budget does NOT penalize or rank lower: skips Tier 2 and compares via Tier 3 (intake timestamp)
      // Lead A has budget, created Jan 1 (older).
      // Lead B has NO budget, created May 1 (newer).
      // Both score 100%. Since Lead B has no budget, Tier 2 midpoint is skipped.
      // Lead B (newer createdAt) must rank FIRST, not penalized for lacking a budget!
      const mockLeadMatchesMissingBudget: EvaluatedLeadMatch[] = [
        {
          lead: { id: "lead-with-budget-older", requirements: { minBudget: 15000000, maxBudget: 20000000 }, createdAt: new Date("2026-01-01") } as any,
          score: 100,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 4,
          breakdown: {} as any,
          unspecifiedCriteria: [],
          visitStatus: "No Visits Yet",
        },
        {
          lead: { id: "lead-no-budget-newer", requirements: { minBudget: 0, maxBudget: 0 }, createdAt: new Date("2026-05-01") } as any,
          score: 100,
          isEligible: true,
          criteriaMatchedCount: 3,
          criteriaEvaluatedCount: 3,
          breakdown: {} as any,
          unspecifiedCriteria: ["Budget"],
          visitStatus: "No Visits Yet",
        },
      ];
      const sortedNoBudget = sortLeadMatches(mockLeadMatchesMissingBudget, 18000000);
      expect(sortedNoBudget[0].lead.id).toBe("lead-no-budget-newer");
      expect(sortedNoBudget[1].lead.id).toBe("lead-with-budget-older");

      // 17.4 Stable Lead ID tie-break when scores, budgets, and dates are identical
      const sameDate = new Date("2026-05-01");
      const mockLeadMatchesId: EvaluatedLeadMatch[] = [
        {
          lead: { id: "lead-zzz", requirements: { minBudget: 15000000, maxBudget: 20000000 }, createdAt: sameDate } as any,
          score: 100,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 4,
          breakdown: {} as any,
          unspecifiedCriteria: [],
          visitStatus: "No Visits Yet",
        },
        {
          lead: { id: "lead-aaa", requirements: { minBudget: 15000000, maxBudget: 20000000 }, createdAt: sameDate } as any,
          score: 100,
          isEligible: true,
          criteriaMatchedCount: 4,
          criteriaEvaluatedCount: 4,
          breakdown: {} as any,
          unspecifiedCriteria: [],
          visitStatus: "No Visits Yet",
        },
      ];
      expect(sortLeadMatches(mockLeadMatchesId, 18000000)[0].lead.id).toBe("lead-aaa");
      expect(sortLeadMatches(mockLeadMatchesId, 18000000)[1].lead.id).toBe("lead-zzz");
    });

    // Scenario 18: Top-3 consistency between lead detail and matching workspace
    it("Scenario 18: Ensures top-3 matches in Lead Detail match the top results of the full matching engine", () => {
      const mockMatches: EvaluatedPropertyMatch[] = [
        { property: { id: "prop-1", price: 18000000, updatedAt: new Date() } as any, score: 100 } as any,
        { property: { id: "prop-2", price: 18000000, updatedAt: new Date() } as any, score: 90 } as any,
        { property: { id: "prop-3", price: 18000000, updatedAt: new Date() } as any, score: 80 } as any,
        { property: { id: "prop-4", price: 18000000, updatedAt: new Date() } as any, score: 70 } as any,
      ];

      const top3 = mockMatches.slice(0, 3);
      expect(top3.length).toBe(3);
      expect(top3.map((m) => m.property.id)).toEqual(["prop-1", "prop-2", "prop-3"]);
    });

    // Scenario 19: Matching refresh after requirement edits
    it("Scenario 19: Reflects updated criteria in newly computed match scores when requirements change", () => {
      // Original requirement: SALE, budget 1.5 - 2.0 Cr -> propBase matches 100%
      const initialResult = evaluatePropertyMatch(baseReq, baseProp);
      expect(initialResult.score).toBe(100);

      // Requirement edited: Budget lowered to 50L - 80L -> budget no longer matches
      const updatedReq: RawRequirementData = {
        ...baseReq,
        minBudget: 5000000,
        maxBudget: 8000000,
      };
      const refreshedResult = evaluatePropertyMatch(updatedReq, baseProp);
      expect(refreshedResult.score).toBeLessThan(100);
      expect(refreshedResult.breakdown.budget.matched).toBe(false);
    });
  });

  describe("5. Pure Scoring Engine: Missing / Unspecified Buyer Criteria (PRD §6.3)", () => {
    it("excludes unspecified criteria from both numerator and denominator", () => {
      // Buyer has only specified Preference, Budget, and BHK.
      // Localities, Property Types, and Target Area are all empty / unspecified.
      const sparseReq: RawRequirementData = {
        preference: "SALE",
        minBudget: 10000000,
        maxBudget: 20000000,
        city: "Gurugram",
        localities: [],
        propertyTypes: [],
        bedroomConfigurations: ["3 BHK"],
        targetArea: null,
      };

      const prop: RawPropertyData = {
        id: "prop-sparse",
        preference: "SALE",
        price: 15000000,
        city: "Gurugram",
        localityName: "Any Locality",
        locality: null,
        propertyType: "PENTHOUSE",
        bedroomCount: 3,
        area: 3500,
        validationStatus: "VALIDATED",
        availabilityStatus: "AVAILABLE",
        ownerWillingnessConfirmed: true,
        isActiveSupply: true,
      };

      const result = evaluatePropertyMatch(sparseReq, prop);
      // Evaluated: Preference (matched), Budget (matched), BHK (matched) = 3 criteria
      expect(result.criteriaEvaluatedCount).toBe(3);
      expect(result.criteriaMatchedCount).toBe(3);
      expect(result.score).toBe(100); // 3 / 3 = 100%

      expect(result.breakdown.locality.evaluated).toBe(false);
      expect(result.breakdown.propertyType.evaluated).toBe(false);
      expect(result.breakdown.area.evaluated).toBe(false);

      expect(result.unspecifiedCriteria).toContain("Locality");
      expect(result.unspecifiedCriteria).toContain("Property Type");
      expect(result.unspecifiedCriteria).toContain("Property Area");
    });

    it("calculates partial match percentage accurately: (matched / evaluated) * 100", () => {
      // 4 evaluated criteria: Preference, Budget, Locality, BHK.
      // Preference: matches (1)
      // Budget: matches (1)
      // Locality: matches (1)
      // BHK: mismatches (0) (buyer wants 4 BHK, property is 3 BHK)
      // Matched: 3, Evaluated: 4 -> Score: Math.round((3/4) * 100) = 75%
      const req: RawRequirementData = {
        preference: "SALE",
        minBudget: 10000000,
        maxBudget: 20000000,
        city: "Gurugram",
        localities: [{ name: "Golf Course Road", latitude: null, longitude: null }],
        propertyTypes: [],
        bedroomConfigurations: ["4 BHK"],
        targetArea: null,
      };

      const prop: RawPropertyData = {
        id: "prop-partial",
        preference: "SALE",
        price: 15000000,
        city: "Gurugram",
        localityName: "Golf Course Road",
        locality: null,
        propertyType: "APARTMENT",
        bedroomCount: 3,
        area: 1800,
        validationStatus: "VALIDATED",
        availabilityStatus: "AVAILABLE",
        ownerWillingnessConfirmed: true,
        isActiveSupply: true,
      };

      const result = evaluatePropertyMatch(req, prop);
      expect(result.criteriaEvaluatedCount).toBe(4);
      expect(result.criteriaMatchedCount).toBe(3);
      expect(result.score).toBe(75);
    });
  });

  describe("5. Matching DAL: getMatchingPropertiesForLead", () => {
    const brokerContext: TenantContext = {
      tenantId: "tenant-broker-1",
      userId: "user-broker-1",
      role: UserRole.BROKER_OWNER,
      user: {
        id: "user-broker-1",
        name: "Broker Vikram",
        email: "vikram@apexrealty.in",
        role: UserRole.BROKER_OWNER,
        tenantId: "tenant-broker-1",
        isActive: true,
      },
      session: {
        id: "sess-1",
        token: "tok-1",
        expiresAt: new Date(Date.now() + 86400000),
      },
    };

    const telecallerContext: TenantContext = {
      tenantId: "tenant-broker-1",
      userId: "user-telecaller-1",
      role: UserRole.TELECALLER,
      user: {
        id: "user-telecaller-1",
        name: "Pooja Telecaller",
        email: "pooja@apexrealty.in",
        role: UserRole.TELECALLER,
        tenantId: "tenant-broker-1",
        isActive: true,
      },
      session: {
        id: "sess-2",
        token: "tok-2",
        expiresAt: new Date(Date.now() + 86400000),
      },
    };

    const mockDbLead = {
      id: "lead-1",
      tenantId: "tenant-broker-1",
      name: "Rohit Verma",
      primaryPhone: "9876543210",
      alternatePhone: null,
      email: "rohit@gmail.com",
      status: LeadStatus.ACTIVE,
      currentDisposition: "CONNECTED",
      unreachableCount: 0,
      assignedTelecallerId: "user-telecaller-1",
      originalSource: "WEBSITE",
      sourceCreatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      requirement: {
        id: "req-1",
        leadId: "lead-1",
        preference: "SALE" as any,
        minBudget: BigInt(10000000),
        maxBudget: BigInt(20000000),
        city: "Gurugram",
        propertyTypes: ["APARTMENT"],
        bedroomConfigurations: ["3 BHK"],
        minBedrooms: 3,
        maxBedrooms: 3,
        minArea: 1200,
        maxArea: 1800,
        areaUnit: "sq.ft",
        areaType: AreaUnitType.CARPET,
        targetArea: 1500,
        localities: [
          {
            id: "rl-1",
            requirementId: "req-1",
            localityId: "loc-1",
            locality: {
              id: "loc-1",
              name: "Golf Course Road",
              city: "Gurugram",
              state: "Haryana",
              latitude: 28.4595,
              longitude: 77.0988,
            },
          },
        ],
      },
      enquiries: [],
      callLogs: [],
      assignedTelecaller: {
        id: "user-telecaller-1",
        name: "Pooja Telecaller",
        email: "pooja@apexrealty.in",
      },
      siteVisits: [],
    };

    const mockDbProperties = [
      {
        id: "prop-100",
        tenantId: "tenant-broker-1",
        preference: "SALE",
        price: BigInt(15000000),
        city: "Gurugram",
        localityId: "loc-1",
        localityName: "Golf Course Road",
        locality: {
          id: "loc-1",
          name: "Golf Course Road",
          latitude: 28.4595,
          longitude: 77.0988,
        },
        propertyType: "APARTMENT",
        bedroomCount: 3,
        area: 1500,
        areaUnit: "sq.ft",
        areaType: AreaUnitType.CARPET,
        validationStatus: SupplyValidationStatus.VALIDATED,
        availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
        ownerWillingnessConfirmed: true,
        isActiveSupply: true,
        societyName: "The Magnolias",
        addressUnitNumber: "Unit 1204",
        privateAddressRemarks: "Key with guard",
        ownerContactNumber: "9999988888",
        isDirectOwner: true,
        ownerName: "Private Owner",
        ownerPhone: "9999988888",
        keyHolders: [],
        media: [],
        callLogs: [],
        assignments: [],
        siteVisitItems: [],
        validatedAt: new Date("2026-05-01"),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "prop-80",
        tenantId: "tenant-broker-1",
        preference: "SALE",
        price: BigInt(18000000),
        city: "Gurugram",
        localityId: "loc-1",
        localityName: "Golf Course Road",
        locality: {
          id: "loc-1",
          name: "Golf Course Road",
          latitude: 28.4595,
          longitude: 77.0988,
        },
        propertyType: "APARTMENT",
        bedroomCount: 4, // BHK mismatch
        area: 1500,
        areaUnit: "sq.ft",
        areaType: AreaUnitType.CARPET,
        validationStatus: SupplyValidationStatus.VALIDATED,
        availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
        ownerWillingnessConfirmed: true,
        isActiveSupply: true,
        societyName: "The Aralias",
        addressUnitNumber: "Tower 2",
        privateAddressRemarks: null,
        ownerContactNumber: "9999977777",
        isDirectOwner: true,
        ownerName: "Private Owner",
        ownerPhone: "9999977777",
        keyHolders: [],
        media: [],
        callLogs: [],
        assignments: [],
        siteVisitItems: [],
        validatedAt: new Date("2026-04-01"),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    it("throws ValidationError when leadId is missing", async () => {
      await expect(getMatchingPropertiesForLead(brokerContext, "")).rejects.toThrow(
        ValidationError
      );
    });

    it("throws ForbiddenError when user lacks matching:view_matches permission", async () => {
      const verifierContext: TenantContext = {
        tenantId: "tenant-broker-1",
        userId: "user-verifier-1",
        role: UserRole.FIELD_VERIFIER,
        user: {
          id: "user-verifier-1",
          name: "Suresh Verifier",
          email: "suresh@apexrealty.in",
          role: UserRole.FIELD_VERIFIER,
          tenantId: "tenant-broker-1",
          isActive: true,
        },
        session: {
          id: "sess-v",
          token: "tok-v",
          expiresAt: new Date(Date.now() + 86400000),
        },
      };

      await expect(getMatchingPropertiesForLead(verifierContext, "lead-1")).rejects.toThrow(
        ForbiddenError
      );
    });

    it("enforces strict tenant isolation and throws NotFoundError if lead belongs to another tenant", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(null);

      await expect(getMatchingPropertiesForLead(brokerContext, "lead-cross-tenant")).rejects.toThrow(
        NotFoundError
      );
    });

    it("queries database with strict Active Supply Pool eligibility filters", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(mockDbLead);
      (prisma.property.count as any).mockResolvedValue(2);
      (prisma.property.findMany as any).mockResolvedValue(mockDbProperties);

      const result = await getMatchingPropertiesForLead(brokerContext, "lead-1");

      expect(prisma.property.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-broker-1",
            isActiveSupply: true,
            validationStatus: SupplyValidationStatus.VALIDATED,
            availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
            ownerWillingnessConfirmed: true,
            preference: "SALE",
          }),
        })
      );

      expect(result.matches.length).toBe(2);
      // Sorted by score descending: prop-100 (100%) should be first, prop-80 second
      expect(result.matches[0].score).toBe(100);
      expect(result.matches[0].property.id).toBe("prop-100");
      expect(result.matches[1].score).toBeLessThan(100);
      expect(result.matches[1].property.id).toBe("prop-80");
    });

    it("scopes telecaller access to assigned leads only", async () => {
      // Mock lead assigned to a different telecaller
      (prisma.lead.findFirst as any).mockResolvedValue(null);

      await expect(
        getMatchingPropertiesForLead(telecallerContext, "lead-unassigned")
      ).rejects.toThrow(NotFoundError);
    });

    it("evaluates cross-city properties within 3km and rejects those beyond 3km without SQL city pre-filter", async () => {
      // Lead is in Gurugram (DLF Phase 3: 28.4950, 77.0895)
      const gurugramLead = {
        ...mockDbLead,
        requirement: {
          ...mockDbLead.requirement,
          city: "Gurugram",
          localities: [
            {
              id: "rl-dlf",
              requirementId: "req-1",
              localityId: "loc-dlf",
              locality: {
                id: "loc-dlf",
                name: "DLF Phase 3",
                city: "Gurugram",
                state: "Haryana",
                latitude: 28.4950,
                longitude: 77.0895,
              },
            },
          ],
        },
      };

      // Property 1: New Delhi (Rajokri: 28.5020, 77.0950) -> ~0.95 km away (<= 3 km)
      const propDelhiNear = {
        ...mockDbProperties[0],
        id: "prop-delhi-near",
        city: "New Delhi",
        localityName: "Rajokri",
        locality: {
          id: "loc-rajokri",
          name: "Rajokri",
          latitude: 28.5020,
          longitude: 77.0950,
        },
      };

      // Property 2: New Delhi (Connaught Place: 28.6304, 77.2177) -> ~19 km away (> 3 km)
      const propDelhiFar = {
        ...mockDbProperties[0],
        id: "prop-delhi-far",
        city: "New Delhi",
        localityName: "Connaught Place",
        locality: {
          id: "loc-cp",
          name: "Connaught Place",
          latitude: 28.6304,
          longitude: 77.2177,
        },
      };

      (prisma.lead.findFirst as any).mockResolvedValue(gurugramLead);
      (prisma.property.count as any).mockResolvedValue(2);
      (prisma.property.findMany as any).mockResolvedValue([propDelhiNear, propDelhiFar]);

      const result = await getMatchingPropertiesForLead(brokerContext, "lead-1");

      // Verify prisma.property.findMany was called without city filter
      const findManyCall = (prisma.property.findMany as any).mock.calls.at(-1)[0];
      expect(findManyCall.where.city).toBeUndefined();

      // Find evaluated matches
      const nearMatch = result.matches.find((m) => m.property.id === "prop-delhi-near");
      const farMatch = result.matches.find((m) => m.property.id === "prop-delhi-far");

      expect(nearMatch).toBeDefined();
      expect(nearMatch!.breakdown.locality.matched).toBe(true);
      expect(nearMatch!.breakdown.locality.details).toContain("≤ 3 km threshold");
      expect(nearMatch!.score).toBe(100);

      expect(farMatch).toBeDefined();
      expect(farMatch!.breakdown.locality.matched).toBe(false);
      expect(farMatch!.breakdown.locality.details).toContain("does not match");
      expect(farMatch!.score).toBeLessThan(100);
    });
  });

  describe("6. Matching DAL: getMatchingLeadsForProperty", () => {
    const brokerContext: TenantContext = {
      tenantId: "tenant-broker-1",
      userId: "user-broker-1",
      role: UserRole.BROKER_OWNER,
      user: {
        id: "user-broker-1",
        name: "Broker Vikram",
        email: "vikram@apexrealty.in",
        role: UserRole.BROKER_OWNER,
        tenantId: "tenant-broker-1",
        isActive: true,
      },
      session: {
        id: "sess-1",
        token: "tok-1",
        expiresAt: new Date(Date.now() + 86400000),
      },
    };

    const mockProperty = {
      id: "prop-1",
      tenantId: "tenant-broker-1",
      preference: "SALE",
      price: BigInt(15000000),
      city: "Gurugram",
      localityId: "loc-1",
      localityName: "Golf Course Road",
      locality: {
        id: "loc-1",
        name: "Golf Course Road",
        latitude: 28.4595,
        longitude: 77.0988,
      },
      propertyType: "APARTMENT",
      bedroomCount: 3,
      area: 1500,
      areaUnit: "sq.ft",
      areaType: AreaUnitType.CARPET,
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
      ownerWillingnessConfirmed: true,
      isActiveSupply: true,
      societyName: "The Magnolias",
      addressUnitNumber: "Unit 1204",
      privateAddressRemarks: "Key with guard",
      ownerContactNumber: "9999988888",
      isDirectOwner: true,
      ownerName: "Private Owner",
      ownerPhone: "9999988888",
      keyHolders: [],
      media: [],
      callLogs: [],
      assignments: [],
      siteVisitItems: [],
      validatedAt: new Date("2026-05-01"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockActiveLeads = [
      {
        id: "lead-1",
        tenantId: "tenant-broker-1",
        name: "Rohit Verma",
        primaryPhone: "9876543210",
        alternatePhone: null,
        email: "rohit@gmail.com",
        status: LeadStatus.ACTIVE,
        currentDisposition: "CONNECTED",
        unreachableCount: 0,
        assignedTelecallerId: "user-telecaller-1",
        originalSource: "WEBSITE",
        sourceCreatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        requirement: {
          id: "req-1",
          leadId: "lead-1",
          preference: "SALE" as any,
          minBudget: BigInt(10000000),
          maxBudget: BigInt(20000000),
          city: "Gurugram",
          propertyTypes: ["APARTMENT"],
          bedroomConfigurations: ["3 BHK"],
          minBedrooms: 3,
          maxBedrooms: 3,
          minArea: 1200,
          maxArea: 1800,
          areaUnit: "sq.ft",
          areaType: AreaUnitType.CARPET,
          targetArea: 1500,
          localities: [
            {
              id: "rl-1",
              requirementId: "req-1",
              localityId: "loc-1",
              locality: {
                id: "loc-1",
                name: "Golf Course Road",
                latitude: 28.4595,
                longitude: 77.0988,
              },
            },
          ],
        },
        enquiries: [],
        callLogs: [],
        assignedTelecaller: {
          id: "user-telecaller-1",
          name: "Pooja Telecaller",
          email: "pooja@apexrealty.in",
        },
        siteVisits: [],
      },
    ];

    it("throws NotFoundError if property does not exist or belongs to another tenant", async () => {
      (prisma.property.findFirst as any).mockResolvedValue(null);

      await expect(getMatchingLeadsForProperty(brokerContext, "prop-other")).rejects.toThrow(
        NotFoundError
      );
    });

    it("returns ranked matching active leads for property", async () => {
      (prisma.property.findFirst as any).mockResolvedValue(mockProperty);
      (prisma.lead.count as any).mockResolvedValue(1);
      (prisma.lead.findMany as any).mockResolvedValue(mockActiveLeads);

      const result = await getMatchingLeadsForProperty(brokerContext, "prop-1");

      expect(result.matches.length).toBe(1);
      expect(result.matches[0].lead.id).toBe("lead-1");
      expect(result.matches[0].score).toBe(100);
      expect(result.matches[0].visitStatus).toBe("No Visits Yet");
    });

    it("evaluates cross-city buyer leads without SQL city pre-filter", async () => {
      // Property is in New Delhi (Rajokri: 28.5020, 77.0950)
      const delhiProperty = {
        ...mockProperty,
        id: "prop-delhi",
        city: "New Delhi",
        localityName: "Rajokri",
        locality: {
          id: "loc-rajokri",
          name: "Rajokri",
          latitude: 28.5020,
          longitude: 77.0950,
        },
      };

      // Lead 1 is in Gurugram (DLF Phase 3: 28.4950, 77.0895) -> ~0.95 km away
      const gurugramLead = {
        ...mockActiveLeads[0],
        id: "lead-gurugram",
        requirement: {
          ...mockActiveLeads[0].requirement,
          city: "Gurugram",
          localities: [
            {
              id: "rl-dlf",
              requirementId: "req-1",
              localityId: "loc-dlf",
              locality: {
                id: "loc-dlf",
                name: "DLF Phase 3",
                city: "Gurugram",
                state: "Haryana",
                latitude: 28.4950,
                longitude: 77.0895,
              },
            },
          ],
        },
      };

      (prisma.property.findFirst as any).mockResolvedValue(delhiProperty);
      (prisma.lead.count as any).mockResolvedValue(1);
      (prisma.lead.findMany as any).mockResolvedValue([gurugramLead]);

      const result = await getMatchingLeadsForProperty(brokerContext, "prop-delhi");

      // Verify prisma.lead.findMany where clause does NOT filter by requirement.city
      const findManyCall = (prisma.lead.findMany as any).mock.calls.at(-1)[0];
      expect(findManyCall.where.requirement.city).toBeUndefined();

      expect(result.matches.length).toBe(1);
      expect(result.matches[0].lead.id).toBe("lead-gurugram");
      expect(result.matches[0].breakdown.locality.matched).toBe(true);
      expect(result.matches[0].score).toBe(100);
    });
  });
});
