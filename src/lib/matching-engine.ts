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

export interface LocalityItem {
  id?: string | null;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  isVerified?: boolean;
}

export interface RawRequirementData {
  preference: string;
  minBudget?: number | null;
  maxBudget?: number | null;
  city?: string;
  localities?: (string | LocalityItem)[];
  propertyTypes?: string[];
  bedroomConfigurations?: string[];
  minBedrooms?: number | null;
  maxBedrooms?: number | null;
  targetArea?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  areaUnit?: string | null;
  areaType?: string | null;
}

export interface RawPropertyData {
  id: string;
  preference: string;
  price: number;
  city: string;
  localityId?: string | null;
  localityName: string;
  locality?: {
    id?: string | null;
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    isVerified?: boolean;
  } | null;
  propertyType: string;
  bedroomCount: number;
  area: number;
  areaUnit?: string | null;
  areaType?: string | null;
  validationStatus: string;
  availabilityStatus: string;
  ownerWillingnessConfirmed: boolean;
  isActiveSupply?: boolean;
  validatedAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

/**
 * Normalizes locality name for exact comparison (case-insensitive, trims extra spaces).
 */
export function normalizeLocalityName(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Checks whether coordinate values are verified and geographically plausible.
 */
export function areCoordinatesVerified(item?: {
  latitude?: number | null;
  longitude?: number | null;
  isVerified?: boolean;
} | null): boolean {
  if (!item) return false;
  if (item.isVerified === false) return false;
  if (item.latitude == null || item.longitude == null) return false;
  const lat = Number(item.latitude);
  const lon = Number(item.longitude);
  if (isNaN(lat) || isNaN(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  if (lat === 0 && lon === 0) return false;
  return true;
}

/**
 * Normalizes area unit string to standard forms (e.g. sq.ft).
 */
export function normalizeAreaUnit(unit?: string | null): string {
  const u = (unit || "sq.ft").trim().toLowerCase().replace(/[\s._-]/g, "");
  if (u === "sqft" || u === "sqfeet" || u === "squarefeet" || u === "squareft") {
    return "sq.ft";
  }
  if (u === "sqyd" || u === "sqyard" || u === "squareyard" || u === "squareyards") {
    return "sq.yd";
  }
  if (u === "sqm" || u === "sqmeter" || u === "sqmeters" || u === "squaremeter") {
    return "sq.m";
  }
  return u;
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

  // CRITERION 2: Budget (PRD §6.2.2 & M2)
  const hasMinB = requirement.minBudget != null && Number(requirement.minBudget) > 0;
  const hasMaxB = requirement.maxBudget != null && Number(requirement.maxBudget) > 0;
  const budgetSpecified = hasMinB || hasMaxB;
  let budgetMatched = false;
  let budgetEvaluated = false;
  let budgetDetails = "";
  const price = Number(property.price);

  if (budgetSpecified) {
    budgetEvaluated = true;
    criteriaEvaluatedCount += 1;

    const minB = hasMinB ? Number(requirement.minBudget) : 0;
    const maxB = hasMaxB ? Number(requirement.maxBudget) : Infinity;

    if (hasMinB && hasMaxB) {
      const midpoint = (minB + maxB) / 2;
      const toleranceMin = midpoint * 0.75;
      const toleranceMax = midpoint * 1.25;

      const inStatedRange = price >= minB && price <= maxB;
      const inToleranceWindow = price >= toleranceMin && price <= toleranceMax;
      budgetMatched = inStatedRange || inToleranceWindow;

      budgetDetails = inStatedRange
        ? "Within stated buyer budget range"
        : inToleranceWindow
        ? "Within PRD ±25% midpoint tolerance window"
        : "Outside buyer budget range and tolerance";
    } else if (hasMinB) {
      const toleranceMin = minB * 0.75;
      budgetMatched = price >= toleranceMin;
      budgetDetails = price >= minB
        ? "Above stated minimum budget"
        : budgetMatched
        ? "Within minimum budget tolerance (≥ 75%)"
        : "Below minimum budget threshold";
    } else {
      const toleranceMax = maxB * 1.25;
      budgetMatched = price <= toleranceMax;
      budgetDetails = price <= maxB
        ? "Within stated maximum budget"
        : budgetMatched
        ? "Within maximum budget tolerance (≤ 125%)"
        : "Exceeds maximum budget threshold";
    }

    if (budgetMatched) criteriaMatchedCount += 1;
  } else {
    unspecifiedCriteria.push("Budget");
    budgetDetails = "Unspecified by buyer (excluded from score)";
  }

  const budgetExpected = hasMinB && hasMaxB
    ? `₹${Number(requirement.minBudget).toLocaleString("en-IN")} - ₹${Number(requirement.maxBudget).toLocaleString("en-IN")}`
    : hasMinB
    ? `≥ ₹${Number(requirement.minBudget).toLocaleString("en-IN")}`
    : hasMaxB
    ? `≤ ₹${Number(requirement.maxBudget).toLocaleString("en-IN")}`
    : "Any Budget";

  const budgetCriterion: CriterionResult = {
    matched: budgetMatched,
    evaluated: budgetEvaluated,
    label: "Budget Range",
    expected: budgetExpected,
    actual: `₹${price.toLocaleString("en-IN")}`,
    details: budgetDetails,
  };

  // CRITERION 3: Locality (PRD §6.2.3 & M4)
  // Use rules in strict order:
  // 1. Same verified locality ID -> match.
  // 2. Different locality IDs: if both coordinates verified and distance <= 3 km -> match.
  // 3. If coordinates unavailable or unverified: allow only normalized exact locality name matching.
  // 4. Never use partial substring matching.
  let localityMatched = false;
  let localityEvaluated = false;
  let localityDetails = "";
  const buyerLocs = requirement.localities || [];

  if (buyerLocs.length > 0) {
    localityEvaluated = true;
    criteriaEvaluatedCount += 1;

    const propLocId = property.localityId || property.locality?.id || null;
    const propNormName = normalizeLocalityName(property.locality?.name || property.localityName || "");
    const propLocObj = property.locality || {
      id: propLocId,
      name: property.localityName,
      latitude: null,
      longitude: null,
    };
    const propCoordsVerified = areCoordinatesVerified(propLocObj);

    for (const rawLoc of buyerLocs) {
      const locId = typeof rawLoc === "string" ? null : (rawLoc.id || null);
      const locName = typeof rawLoc === "string" ? rawLoc : rawLoc.name;
      const reqNormName = normalizeLocalityName(locName || "");
      const reqCoordsVerified = typeof rawLoc !== "string" && areCoordinatesVerified(rawLoc);

      // Rule 1: Same verified locality ID: locality match
      if (locId && propLocId && locId === propLocId) {
        localityMatched = true;
        localityDetails = `Matched by verified locality ID (${locId})`;
        break;
      }

      // Rule 2: Different locality IDs: if both locality coordinates are verified and distance is 3 km or less, locality match
      if (reqCoordsVerified && propCoordsVerified && typeof rawLoc !== "string") {
        const distKm = calculateHaversineDistanceKm(
          Number(rawLoc.latitude),
          Number(rawLoc.longitude),
          Number(propLocObj.latitude),
          Number(propLocObj.longitude)
        );
        if (distKm <= 3.0) {
          localityMatched = true;
          localityDetails = `Matched by verified coordinates within ${distKm.toFixed(2)} km (≤ 3 km threshold)`;
          break;
        }
      }

      // Rule 3 & 4: If coordinates are unavailable or not verified: allow only normalized exact locality name matching.
      // Never use partial substring matching.
      if (reqNormName && propNormName && reqNormName === propNormName) {
        localityMatched = true;
        localityDetails = `Matched by exact normalized locality name ("${locName}")`;
        break;
      }
    }

    if (localityMatched) {
      criteriaMatchedCount += 1;
    } else {
      localityDetails = "Property locality does not match buyer's preferred localities (no exact match or verified proximity within 3 km)";
    }
  } else {
    unspecifiedCriteria.push("Locality");
    localityDetails = "Unspecified by buyer (excluded from score)";
  }

  const localityCriterion: CriterionResult = {
    matched: localityMatched,
    evaluated: localityEvaluated,
    label: "Locality / Location",
    expected: buyerLocs.length > 0 ? buyerLocs.map((l) => (typeof l === "string" ? l : l.name)).join(", ") : "Any in city",
    actual: property.localityName,
    details: localityDetails,
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

  // CRITERION 5: Bedroom Configuration (BHK) (PRD §6.2.5 & M2)
  let bhkMatched = false;
  let bhkEvaluated = false;
  const buyerBhks = (requirement.bedroomConfigurations || []).filter((b) => Boolean(b && b.trim()));
  const hasMinBedrooms = requirement.minBedrooms != null && requirement.minBedrooms > 0;
  const hasMaxBedrooms = requirement.maxBedrooms != null && requirement.maxBedrooms > 0;
  const isBhkSpecified = buyerBhks.length > 0 || hasMinBedrooms || hasMaxBedrooms;
  const propBedrooms = property.bedroomCount;

  if (isBhkSpecified) {
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
      (!hasMinBedrooms || propBedrooms >= (requirement.minBedrooms as number)) &&
      (!hasMaxBedrooms || propBedrooms <= (requirement.maxBedrooms as number));

    bhkMatched = buyerBhks.length > 0 ? inBhkList : inRange;
    if (bhkMatched) criteriaMatchedCount += 1;
  } else {
    unspecifiedCriteria.push("Bedroom Configuration");
  }

  const bedroomCriterion: CriterionResult = {
    matched: bhkMatched,
    evaluated: bhkEvaluated,
    label: "Bedrooms (BHK)",
    expected: buyerBhks.length > 0
      ? buyerBhks.join(", ")
      : hasMinBedrooms && hasMaxBedrooms
      ? `${requirement.minBedrooms} - ${requirement.maxBedrooms} BHK`
      : hasMinBedrooms
      ? `≥ ${requirement.minBedrooms} BHK`
      : hasMaxBedrooms
      ? `≤ ${requirement.maxBedrooms} BHK`
      : "Any BHK",
    actual: `${property.bedroomCount} BHK`,
    details: !bhkEvaluated
      ? "Unspecified by buyer (excluded from score)"
      : bhkMatched
      ? `Bedroom configuration matched (${property.bedroomCount} BHK)`
      : `Bedroom mismatch: Property is ${property.bedroomCount} BHK`,
  };

  // CRITERION 6: Property Area (M5 — APPROVED RANGE RULE)
  // Evaluated ONLY when minArea or maxArea is provided.
  // Old targetArea ±15% tolerance is completely removed.
  let areaMatched = false;
  let areaEvaluated = false;
  let areaDetails = "";
  const hasMinArea = requirement.minArea != null && Number(requirement.minArea) > 0;
  const hasMaxArea = requirement.maxArea != null && Number(requirement.maxArea) > 0;
  const isAreaSpecified = hasMinArea || hasMaxArea;

  if (isAreaSpecified) {
    areaEvaluated = true;
    criteriaEvaluatedCount += 1;

    const propAreaNum = Number(property.area);
    if (isNaN(propAreaNum) || propAreaNum <= 0) {
      areaMatched = false;
      areaDetails = "Comparable property area data is unavailable or invalid";
    } else {
      // Unit conversion check
      const reqUnit = normalizeAreaUnit(requirement.areaUnit);
      const propUnit = normalizeAreaUnit(property.areaUnit);
      let conversionFactor = 1;
      let unitsCompatible = true;

      if (reqUnit === propUnit) {
        conversionFactor = 1;
      } else if (reqUnit === "sq.yd" && propUnit === "sq.ft") {
        conversionFactor = 9; // 1 sq.yd = 9 sq.ft
      } else if (reqUnit === "sq.m" && propUnit === "sq.ft") {
        conversionFactor = 10.7639; // 1 sq.m = 10.7639 sq.ft
      } else if (reqUnit === "sq.ft" && propUnit === "sq.yd") {
        conversionFactor = 1 / 9;
      } else if (reqUnit === "sq.ft" && propUnit === "sq.m") {
        conversionFactor = 1 / 10.7639;
      } else {
        unitsCompatible = false;
      }

      // Area type check
      let areaTypesCompatible = true;
      if (requirement.areaType && requirement.areaType.trim()) {
        const reqAreaType = requirement.areaType.trim().toUpperCase().replace(/[\s-]/g, "_");
        const propAreaType = (property.areaType || "").trim().toUpperCase().replace(/[\s-]/g, "_");
        if (!propAreaType) {
          areaTypesCompatible = false;
          areaDetails = `Comparable area type data unavailable on property (buyer requires ${reqAreaType})`;
        } else if (reqAreaType !== propAreaType) {
          areaTypesCompatible = false;
          areaDetails = `Area type mismatch: buyer requested ${reqAreaType} but property is ${propAreaType}`;
        }
      }

      if (!unitsCompatible) {
        areaMatched = false;
        areaDetails = `Incompatible area units: buyer requested ${requirement.areaUnit || "sq.ft"} but property is in ${property.areaUnit || "sq.ft"} with no valid conversion`;
      } else if (!areaTypesCompatible) {
        areaMatched = false;
      } else {
        // Converted property area into buyer's requirement unit
        const propAreaInReqUnits = propAreaNum / conversionFactor;
        const minA = hasMinArea ? Number(requirement.minArea) : null;
        const maxA = hasMaxArea ? Number(requirement.maxArea) : null;

        if (minA != null && maxA != null) {
          areaMatched = propAreaInReqUnits >= minA && propAreaInReqUnits <= maxA;
          areaDetails = areaMatched
            ? `Area falls within specified range (${minA} - ${maxA} ${requirement.areaUnit || "sq.ft"})`
            : propAreaInReqUnits < minA
            ? `Area (${propAreaInReqUnits.toFixed(0)}) is below minimum requirement (${minA} ${requirement.areaUnit || "sq.ft"})`
            : `Area (${propAreaInReqUnits.toFixed(0)}) exceeds maximum requirement (${maxA} ${requirement.areaUnit || "sq.ft"})`;
        } else if (minA != null) {
          areaMatched = propAreaInReqUnits >= minA;
          areaDetails = areaMatched
            ? `Area meets or exceeds minimum requirement (≥ ${minA} ${requirement.areaUnit || "sq.ft"})`
            : `Area (${propAreaInReqUnits.toFixed(0)}) is below minimum requirement (${minA} ${requirement.areaUnit || "sq.ft"})`;
        } else if (maxA != null) {
          areaMatched = propAreaInReqUnits <= maxA;
          areaDetails = areaMatched
            ? `Area is within maximum requirement (≤ ${maxA} ${requirement.areaUnit || "sq.ft"})`
            : `Area (${propAreaInReqUnits.toFixed(0)}) exceeds maximum requirement (${maxA} ${requirement.areaUnit || "sq.ft"})`;
        }
      }
    }

    if (areaMatched) criteriaMatchedCount += 1;
  } else {
    unspecifiedCriteria.push("Property Area");
    areaDetails = "Unspecified by buyer (excluded from score)";
  }

  const minAreaNum = hasMinArea ? Number(requirement.minArea) : null;
  const maxAreaNum = hasMaxArea ? Number(requirement.maxArea) : null;
  const areaExpected = minAreaNum != null && maxAreaNum != null
    ? `${minAreaNum} - ${maxAreaNum} ${requirement.areaUnit || "sq.ft"}`
    : minAreaNum != null
    ? `≥ ${minAreaNum} ${requirement.areaUnit || "sq.ft"}`
    : maxAreaNum != null
    ? `≤ ${maxAreaNum} ${requirement.areaUnit || "sq.ft"}`
    : "Any Area";

  const areaCriterion: CriterionResult = {
    matched: areaMatched,
    evaluated: areaEvaluated,
    label: "Property Area",
    expected: areaExpected,
    actual: `${Number(property.area)} ${property.areaUnit || "sq.ft"}${property.areaType ? ` (${property.areaType})` : ""}`,
    details: areaDetails,
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

