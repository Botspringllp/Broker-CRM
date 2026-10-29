/**
 * Pure Phase 1 Property Matching Engine
 * Grounded in docs/Broker PRD.pdf (Section 6) and docs/PRD-phase1.md (§6)
 */

export interface CriterionResult {
  matched: boolean;
  evaluated: boolean; // false if unspecified by buyer
  label: string;
  expected: string;
  actual: string;
  details?: string;
}

export interface MatchCriteriaBreakdown {
  preference: CriterionResult;
  budget: CriterionResult;
  locality: CriterionResult;
  propertyType: CriterionResult;
  bedroomCount: CriterionResult;
  area: CriterionResult;
}

export interface RawRequirementData {
  preference: string;
  minBudget: number;
  maxBudget: number;
  city: string;
  localities?: (string | { name: string; latitude?: number | null; longitude?: number | null })[];
  propertyTypes?: string[];
  bedroomConfigurations?: string[];
  minBedrooms?: number | null;
  maxBedrooms?: number | null;
  targetArea?: number | null;
}

export interface RawPropertyData {
  id: string;
  preference: string;
  price: number;
  city: string;
  localityName: string;
  locality?: { name: string; latitude?: number | null; longitude?: number | null } | null;
  propertyType: string;
  bedroomCount: number;
  area: number;
  validationStatus: string;
  availabilityStatus: string;
  ownerWillingnessConfirmed: boolean;
  isActiveSupply?: boolean;
}

/**
 * Calculates Haversine distance in kilometers between two geographic coordinates.
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Evaluates active supply eligibility helper.
 */
export function isPropertySupplyEligible(property: {
  ownerWillingnessConfirmed: boolean;
  validationStatus: string;
  availabilityStatus: string;
}): boolean {
  return (
    property.ownerWillingnessConfirmed === true &&
    property.validationStatus === "VALIDATED" &&
    property.availabilityStatus === "AVAILABLE"
  );
}

/**
 * Authoritative Phase 1 Property Matching Engine.
 * Evaluates up to 6 PRD Section 6 criteria:
 * 1. Transaction Preference (Mandatory hard gate)
 * 2. Budget (Stated min-max range OR midpoint ±25% tolerance window)
 * 3. Locality (Exact / substring match OR ≤ 3 km proximity when coordinates exist)
 * 4. Property Type (In buyer's acceptable property types)
 * 5. Bedroom Configuration (BHK match)
 * 6. Property Area (Target area within ±15% tolerance)
 *
 * Missing or unspecified buyer criteria are excluded from both numerator and denominator.
 * Matching Score (%) = (criteria matched / criteria evaluated) * 100
 */
export function evaluatePropertyMatch(
  requirement: RawRequirementData,
  property: RawPropertyData
): {
  score: number;
  isEligible: boolean;
  criteriaMatchedCount: number;
  criteriaEvaluatedCount: number;
  breakdown: MatchCriteriaBreakdown;
  unspecifiedCriteria: string[];
} {
  const unspecifiedCriteria: string[] = [];

  // HARD GATE 1: Transaction Preference (Mandatory hard condition - PRD §6.1)
  const normReqPref = requirement.preference.toUpperCase();
  const normPropPref = property.preference.toUpperCase();
  const preferenceMatched = normReqPref === normPropPref;

  // HARD GATE 2: Active Inventory Status (PRD §6.1)
  const normValStatus = property.validationStatus.toUpperCase();
  const normAvailStatus = property.availabilityStatus.toUpperCase();
  const isSupplyEligible =
    property.ownerWillingnessConfirmed === true &&
    (normValStatus === "VALIDATED" || normValStatus === "VALIDATED") &&
    (normAvailStatus === "AVAILABLE" || normAvailStatus === "AVAILABLE");

  const preferenceCriterion: CriterionResult = {
    matched: preferenceMatched,
    evaluated: true,
    label: "Transaction Preference",
    expected: normReqPref === "RENT" ? "Rent" : "Sale",
    actual: normPropPref === "RENT" ? "Rent" : "Sale",
    details: preferenceMatched
      ? `Exact transaction type matched (${normPropPref === "RENT" ? "Rent" : "Sale"})`
      : `Mismatch: Buyer wants ${normReqPref === "RENT" ? "Rent" : "Sale"} but property is for ${normPropPref === "RENT" ? "Rent" : "Sale"}`,
  };

  // If hard gates fail, reject immediately with 0 score (PRD §6.1)
  if (!preferenceMatched || !isSupplyEligible) {
    return {
      score: 0,
      isEligible: false,
      criteriaMatchedCount: 0,
      criteriaEvaluatedCount: 1,
      breakdown: {
        preference: preferenceCriterion,
        budget: {
          matched: false,
          evaluated: true,
          label: "Budget Range",
          expected: "Stated budget",
          actual: `₹${Number(property.price).toLocaleString("en-IN")}`,
          details: !isSupplyEligible
            ? "Ineligible: Property is not an active, validated available secondary unit"
            : "Ineligible: Hard preference gate failed",
        },
        locality: {
          matched: false,
          evaluated: false,
          label: "Locality / Location",
          expected: "N/A",
          actual: property.localityName,
          details: "Ineligible: Hard gate failed",
        },
        propertyType: {
          matched: false,
          evaluated: false,
          label: "Property Type",
          expected: "N/A",
          actual: property.propertyType,
          details: "Ineligible: Hard gate failed",
        },
        bedroomCount: {
          matched: false,
          evaluated: false,
          label: "Bedrooms (BHK)",
          expected: "N/A",
          actual: `${property.bedroomCount} BHK`,
          details: "Ineligible: Hard gate failed",
        },
        area: {
          matched: false,
          evaluated: false,
          label: "Property Area",
          expected: "N/A",
          actual: `${Number(property.area)} sq.ft`,
          details: "Ineligible: Hard gate failed",
        },
      },
      unspecifiedCriteria: [],
    };
  }

  let criteriaEvaluatedCount = 1; // Preference is evaluated
  let criteriaMatchedCount = 1; // Preference matched

  // CRITERION 2: Budget (PRD §6.2.2)
  // Stated min-max range OR midpoint ±25% tolerance window
  const minB = Number(requirement.minBudget || 0);
  const maxB = Number(requirement.maxBudget || 0);
  const price = Number(property.price);
  const midpoint = (minB + maxB) / 2;
  const toleranceMin = midpoint * 0.75;
  const toleranceMax = midpoint * 1.25;

  const inStatedRange = price >= minB && price <= maxB;
  const inToleranceWindow = price >= toleranceMin && price <= toleranceMax;
  const budgetMatched = inStatedRange || inToleranceWindow;

  criteriaEvaluatedCount += 1;
  if (budgetMatched) criteriaMatchedCount += 1;

  const budgetCriterion: CriterionResult = {
    matched: budgetMatched,
    evaluated: true,
    label: "Budget Range",
    expected: `₹${minB.toLocaleString("en-IN")} - ₹${maxB.toLocaleString("en-IN")} (Tolerance: ₹${Math.round(toleranceMin).toLocaleString("en-IN")} - ₹${Math.round(toleranceMax).toLocaleString("en-IN")})`,
    actual: `₹${price.toLocaleString("en-IN")}`,
    details: inStatedRange
      ? "Within stated buyer budget range"
      : inToleranceWindow
      ? "Within PRD ±25% midpoint tolerance window"
      : "Outside buyer budget range and tolerance",
  };

  // CRITERION 3: Locality (PRD §6.2.3)
  // Match property locality against buyer's selected localities; consider ≤ 3 km radius if coordinates exist
  let localityMatched = false;
  let localityEvaluated = false;
  const buyerLocs = requirement.localities || [];

  if (buyerLocs.length > 0) {
    localityEvaluated = true;
    criteriaEvaluatedCount += 1;

    const propLocName = (property.localityName || "").trim().toLowerCase();
    const propLat = property.locality?.latitude ? Number(property.locality.latitude) : null;
    const propLon = property.locality?.longitude ? Number(property.locality.longitude) : null;

    for (const rawLoc of buyerLocs) {
      const locName = typeof rawLoc === "string" ? rawLoc.trim().toLowerCase() : rawLoc.name.trim().toLowerCase();
      // Exact or substring match
      if (locName && (propLocName === locName || propLocName.includes(locName) || locName.includes(propLocName))) {
        localityMatched = true;
        break;
      }

      // Proximity distance check if coordinates exist on both sides (PRD §6.2.3)
      if (typeof rawLoc !== "string" && rawLoc.latitude && rawLoc.longitude && propLat !== null && propLon !== null) {
        const distKm = calculateHaversineDistanceKm(
          Number(rawLoc.latitude),
          Number(rawLoc.longitude),
          propLat,
          propLon
        );
        if (distKm <= 3.0) {
          localityMatched = true;
          break;
        }
      }
    }

    if (localityMatched) criteriaMatchedCount += 1;
  } else {
    unspecifiedCriteria.push("Locality");
  }

  const localityCriterion: CriterionResult = {
    matched: localityMatched,
    evaluated: localityEvaluated,
    label: "Locality / Location",
    expected: buyerLocs.length > 0 ? buyerLocs.map((l) => (typeof l === "string" ? l : l.name)).join(", ") : "Any in city",
    actual: property.localityName,
    details: !localityEvaluated
      ? "Unspecified by buyer (excluded from score)"
      : localityMatched
      ? "Locality matched (exact or ≤3km proximity)"
      : "Property locality not in buyer's preferred areas",
  };

  // CRITERION 4: Property Type (PRD §6.2.4)
  let propertyTypeMatched = false;
  let propertyTypeEvaluated = false;
  const buyerTypes = requirement.propertyTypes || [];

  if (buyerTypes.length > 0) {
    propertyTypeEvaluated = true;
    criteriaEvaluatedCount += 1;

    const normPropType = property.propertyType.toUpperCase();
    propertyTypeMatched = buyerTypes.some((t) => t.toUpperCase() === normPropType);

    if (propertyTypeMatched) criteriaMatchedCount += 1;
  } else {
    unspecifiedCriteria.push("Property Type");
  }

  const propertyTypeCriterion: CriterionResult = {
    matched: propertyTypeMatched,
    evaluated: propertyTypeEvaluated,
    label: "Property Type",
    expected: buyerTypes.length > 0 ? buyerTypes.map((t) => t.replace(/_/g, " ")).join(", ") : "Any Property Type",
    actual: property.propertyType.replace(/_/g, " "),
    details: !propertyTypeEvaluated
      ? "Unspecified by buyer (excluded from score)"
      : propertyTypeMatched
      ? `Property type matched (${property.propertyType.replace(/_/g, " ")})`
      : `Property type mismatch: ${property.propertyType.replace(/_/g, " ")}`,
  };

  // CRITERION 5: Bedroom Configuration (BHK) (PRD §6.2.5)
  let bhkMatched = false;
  let bhkEvaluated = false;
  const buyerBhks = requirement.bedroomConfigurations || [];
  const propBedrooms = property.bedroomCount;

  if (buyerBhks.length > 0 || requirement.minBedrooms !== undefined || requirement.maxBedrooms !== undefined) {
    bhkEvaluated = true;
    criteriaEvaluatedCount += 1;

    const propBhkStr = `${propBedrooms} BHK`;
    const inBhkList = buyerBhks.some((b) => {
      const trimmed = b.trim();
      if (trimmed === propBhkStr) return true;
      if (trimmed === "4+ BHK" && propBedrooms >= 4) return true;
      if (trimmed === "5+ BHK" && propBedrooms >= 5) return true;
      return false;
    });

    const inRange =
      (requirement.minBedrooms === null || requirement.minBedrooms === undefined || propBedrooms >= requirement.minBedrooms) &&
      (requirement.maxBedrooms === null || requirement.maxBedrooms === undefined || propBedrooms <= requirement.maxBedrooms);

    bhkMatched = inBhkList || (buyerBhks.length === 0 && inRange);
    if (bhkMatched) criteriaMatchedCount += 1;
  } else {
    unspecifiedCriteria.push("Bedroom Configuration");
  }

  const bedroomCriterion: CriterionResult = {
    matched: bhkMatched,
    evaluated: bhkEvaluated,
    label: "Bedrooms (BHK)",
    expected: buyerBhks.length > 0 ? buyerBhks.join(", ") : "Any BHK",
    actual: `${property.bedroomCount} BHK`,
    details: !bhkEvaluated
      ? "Unspecified by buyer (excluded from score)"
      : bhkMatched
      ? `Bedroom configuration matched (${property.bedroomCount} BHK)`
      : `Bedroom mismatch: Property is ${property.bedroomCount} BHK`,
  };

  // CRITERION 6: Property Area (PRD §6.2.6)
  // ±15% tolerance window around buyer's recorded targetArea
  let areaMatched = false;
  let areaEvaluated = false;
  const targetAreaNum = requirement.targetArea ? Number(requirement.targetArea) : null;

  if (targetAreaNum !== null && targetAreaNum > 0) {
    areaEvaluated = true;
    criteriaEvaluatedCount += 1;

    const propAreaNum = Number(property.area);
    const minArea = targetAreaNum * 0.85;
    const maxArea = targetAreaNum * 1.15;

    areaMatched = propAreaNum >= minArea && propAreaNum <= maxArea;
    if (areaMatched) criteriaMatchedCount += 1;
  } else {
    unspecifiedCriteria.push("Property Area");
  }

  const areaCriterion: CriterionResult = {
    matched: areaMatched,
    evaluated: areaEvaluated,
    label: "Property Area",
    expected: targetAreaNum ? `${targetAreaNum} sq.ft (±15%: ${Math.round(targetAreaNum * 0.85)} - ${Math.round(targetAreaNum * 1.15)} sq.ft)` : "Any Area",
    actual: `${Number(property.area)} sq.ft`,
    details: !areaEvaluated
      ? "Unspecified by buyer (excluded from score)"
      : areaMatched
      ? "Area falls within PRD ±15% target tolerance"
      : "Area outside buyer's ±15% tolerance range",
  };

  // Matching Score Formula (PRD §6.3):
  // (Number of criteria matched / Total criteria evaluated) * 100
  const score =
    criteriaEvaluatedCount > 0
      ? Math.round((criteriaMatchedCount / criteriaEvaluatedCount) * 100)
      : 0;

  return {
    score,
    isEligible: true,
    criteriaMatchedCount,
    criteriaEvaluatedCount,
    breakdown: {
      preference: preferenceCriterion,
      budget: budgetCriterion,
      locality: localityCriterion,
      propertyType: propertyTypeCriterion,
      bedroomCount: bedroomCriterion,
      area: areaCriterion,
    },
    unspecifiedCriteria,
  };
}

