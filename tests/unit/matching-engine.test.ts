/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateHaversineDistanceKm,
  isPropertySupplyEligible,
  evaluatePropertyMatch,
  RawRequirementData,
  RawPropertyData,
} from "@/lib/matching-engine";
import { UserRole, SupplyValidationStatus, PropertyAvailabilityStatus, LeadStatus } from "@prisma/client";
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

  describe("3. Pure Scoring Engine: Criteria Evaluation & Tolerances (PRD §6.2)", () => {
    const baseRequirement: RawRequirementData = {
      preference: "SALE",
      minBudget: 15000000, // 1.5 Cr
      maxBudget: 20000000, // 2.0 Cr
      city: "Gurugram",
      localities: [{ name: "DLF Phase 5", latitude: 28.455, longitude: 77.095 }],
      propertyTypes: ["APARTMENT", "BUILDER_FLOOR"],
      bedroomConfigurations: ["3 BHK", "4 BHK"],
      targetArea: 2000,
    };

    const eligibleBaseProp: RawPropertyData = {
      id: "prop-valid",
      preference: "SALE",
      price: 17500000, // 1.75 Cr (midpoint)
      city: "Gurugram",
      localityName: "DLF Phase 5",
      locality: { name: "DLF Phase 5", latitude: 28.455, longitude: 77.095 },
      propertyType: "APARTMENT",
      bedroomCount: 3,
      area: 2000,
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
      // Property at Sector 42 (28.465, 77.095) - approx 1.1 km from DLF Phase 5 (28.455, 77.095)
      const propNearby: RawPropertyData = {
        ...eligibleBaseProp,
        localityName: "Sector 42",
        locality: { name: "Sector 42", latitude: 28.465, longitude: 77.095 },
      };

      const result = evaluatePropertyMatch(baseRequirement, propNearby);
      expect(result.breakdown.locality.matched).toBe(true);
      expect(result.breakdown.locality.details).toContain("≤3km proximity");
    });

    it("rejects locality when coordinate distance > 3 km and name does not match", () => {
      // Property at Sohna Road (28.405, 77.045) - approx 7 km away
      const propFar: RawPropertyData = {
        ...eligibleBaseProp,
        localityName: "Sohna Road",
        locality: { name: "Sohna Road", latitude: 28.405, longitude: 77.045 },
      };

      const result = evaluatePropertyMatch(baseRequirement, propFar);
      expect(result.breakdown.locality.matched).toBe(false);
      expect(result.breakdown.locality.details).toContain("not in buyer's preferred areas");
    });

    it("matches locality by substring / text match when coordinates are null", () => {
      const propNoCoords: RawPropertyData = {
        ...eligibleBaseProp,
        localityName: "DLF Phase 5, Golf Course Road",
        locality: null,
      };

      const result = evaluatePropertyMatch(baseRequirement, propNoCoords);
      expect(result.breakdown.locality.matched).toBe(true);
    });

    it("matches property area within PRD ±15% tolerance of targetArea", () => {
      // Target area: 2000 sq.ft. Tolerance: [1700, 2300 sq.ft]
      const propInArea: RawPropertyData = { ...eligibleBaseProp, area: 1800 };
      const resultIn = evaluatePropertyMatch(baseRequirement, propInArea);
      expect(resultIn.breakdown.area.matched).toBe(true);
      expect(resultIn.breakdown.area.details).toBe("Area falls within PRD ±15% target tolerance");

      // Area 1600 sq.ft is below 1700 min
      const propTooSmall: RawPropertyData = { ...eligibleBaseProp, area: 1600 };
      const resultSmall = evaluatePropertyMatch(baseRequirement, propTooSmall);
      expect(resultSmall.breakdown.area.matched).toBe(false);
      expect(resultSmall.breakdown.area.details).toBe("Area outside buyer's ±15% tolerance range");

      // Area 2400 sq.ft is above 2300 max
      const propTooLarge: RawPropertyData = { ...eligibleBaseProp, area: 2400 };
      const resultLarge = evaluatePropertyMatch(baseRequirement, propTooLarge);
      expect(resultLarge.breakdown.area.matched).toBe(false);
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

  describe("4. Pure Scoring Engine: Missing / Unspecified Buyer Criteria (PRD §6.3)", () => {
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
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "prop-80",
        tenantId: "tenant-broker-1",
        preference: "SALE",
        price: BigInt(18000000),
        city: "Gurugram",
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
  });
});
