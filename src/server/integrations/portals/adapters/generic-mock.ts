import {
  PortalProvider,
  TransactionType,
  PropertyType,
} from "@prisma/client";
import {
  PortalLeadAdapter,
  PortalAdapterResult,
  NormalizedPortalLead,
} from "../types";
import { normalizeIndianMobile } from "@/server/utils/phone";

/**
 * Generic mock adapter used for end-to-end testing and structured ingestion.
 * Follows the standard Broker CRM normalized schema directly.
 */
export class GenericMockPortalAdapter implements PortalLeadAdapter {
  readonly provider: PortalProvider;
  readonly isVerified: boolean = true;
  readonly description: string = "Standard Generic/Mock Portal Lead Adapter";

  constructor(provider: PortalProvider = PortalProvider.NINETY_NINE_ACRES) {
    this.provider = provider;
  }

  parseAndNormalize(payload: unknown): PortalAdapterResult {
    if (!payload || typeof payload !== "object") {
      return {
        success: false,
        error: "Payload must be a non-null object.",
      };
    }

    const raw = payload as Record<string, unknown>;

    // 1. Prospect Name
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) {
      return {
        success: false,
        error: "Prospect name is required.",
      };
    }

    // 2. Primary Mobile
    const rawMobile =
      typeof raw.mobile === "string"
        ? raw.mobile
        : typeof raw.phone === "string"
        ? raw.phone
        : typeof raw.primaryPhone === "string"
        ? raw.primaryPhone
        : "";

    if (!rawMobile) {
      return {
        success: false,
        error: "Prospect mobile phone is required.",
      };
    }

    let mobile: string;
    try {
      mobile = normalizeIndianMobile(rawMobile);
    } catch (err) {
      return {
        success: false,
        error: `Invalid Indian mobile number: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 3. City
    const city = typeof raw.city === "string" ? raw.city.trim() : "";
    if (!city) {
      return {
        success: false,
        error: "Target city is required.",
      };
    }

    // 4. Preference (Transaction Type: SALE / RENT)
    const rawPref =
      typeof raw.preference === "string"
        ? raw.preference.trim().toUpperCase()
        : typeof raw.transactionType === "string"
        ? raw.transactionType.trim().toUpperCase()
        : "SALE";

    let preference: TransactionType;
    if (rawPref === "RENT" || rawPref === "RENTAL") {
      preference = TransactionType.RENT;
    } else if (rawPref === "SALE" || rawPref === "BUY" || rawPref === "PURCHASE") {
      preference = TransactionType.SALE;
    } else {
      return {
        success: false,
        error: `Invalid transaction preference '${rawPref}'. Must be SALE or RENT.`,
      };
    }

    // 5. External Event ID
    const externalEventId =
      typeof raw.externalEventId === "string" && raw.externalEventId.trim().length > 0
        ? raw.externalEventId.trim()
        : typeof raw.eventId === "string" && raw.eventId.trim().length > 0
        ? raw.eventId.trim()
        : typeof raw.leadId === "string" && raw.leadId.trim().length > 0
        ? raw.leadId.trim()
        : typeof raw.queryId === "string" && raw.queryId.trim().length > 0
        ? raw.queryId.trim()
        : null;

    // 6. Optional Email
    const email =
      typeof raw.email === "string" && raw.email.trim().length > 0
        ? raw.email.trim().toLowerCase()
        : null;

    // 7. Optional Locality
    const locality =
      typeof raw.locality === "string" && raw.locality.trim().length > 0
        ? raw.locality.trim()
        : null;

    // 8. Optional Budget Range
    let minBudget: number | null = null;
    let maxBudget: number | null = null;

    if (raw.minBudget !== undefined && raw.minBudget !== null) {
      const parsed = Number(raw.minBudget);
      if (isNaN(parsed) || parsed < 0) {
        return { success: false, error: "Minimum budget must be a non-negative number." };
      }
      minBudget = parsed;
    }

    if (raw.maxBudget !== undefined && raw.maxBudget !== null) {
      const parsed = Number(raw.maxBudget);
      if (isNaN(parsed) || parsed < 0) {
        return { success: false, error: "Maximum budget must be a non-negative number." };
      }
      maxBudget = parsed;
    }

    if (minBudget !== null && maxBudget !== null && maxBudget < minBudget) {
      return {
        success: false,
        error: "Maximum budget cannot be less than minimum budget.",
      };
    }

    // 9. Optional Property Type
    let propertyType: PropertyType | null = null;
    if (typeof raw.propertyType === "string" && raw.propertyType.trim().length > 0) {
      const upper = raw.propertyType.trim().toUpperCase();
      if (Object.values(PropertyType).includes(upper as PropertyType)) {
        propertyType = upper as PropertyType;
      }
    }

    // 10. Optional Bedroom Configuration
    const bedroomConfiguration =
      typeof raw.bedroomConfiguration === "string" && raw.bedroomConfiguration.trim().length > 0
        ? raw.bedroomConfiguration.trim()
        : typeof raw.bhk === "string" && raw.bhk.trim().length > 0
        ? raw.bhk.trim()
        : null;

    // 11. Optional Advertised Property Ref
    const advertisedPropertyRef =
      typeof raw.advertisedPropertyRef === "string" && raw.advertisedPropertyRef.trim().length > 0
        ? raw.advertisedPropertyRef.trim()
        : typeof raw.propertyRef === "string" && raw.propertyRef.trim().length > 0
        ? raw.propertyRef.trim()
        : null;

    // 12. Optional Enquiry Notes
    const enquiryNotes =
      typeof raw.enquiryNotes === "string" && raw.enquiryNotes.trim().length > 0
        ? raw.enquiryNotes.trim()
        : typeof raw.notes === "string" && raw.notes.trim().length > 0
        ? raw.notes.trim()
        : typeof raw.message === "string" && raw.message.trim().length > 0
        ? raw.message.trim()
        : null;

    const normalized: NormalizedPortalLead = {
      provider: this.provider,
      externalEventId,
      name,
      mobile,
      email,
      city,
      locality,
      preference,
      minBudget,
      maxBudget,
      propertyType,
      bedroomConfiguration,
      advertisedPropertyRef,
      enquiryNotes,
      rawPayload: payload,
    };

    return {
      success: true,
      normalized,
    };
  }
}
