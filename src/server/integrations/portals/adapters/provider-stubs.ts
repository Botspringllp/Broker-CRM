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
 * 99acres Lead Ingestion Adapter (DRAFT / UNVERIFIED)
 *
 * ATTENTION / DISCLAIMER:
 * This adapter mapping is UNVERIFIED pending official 99acres partner API documentation
 * and production webhook sample verification.
 * Supported fields map anticipated XML/JSON query lead pushes.
 */
export class NinetyNineAcresAdapter implements PortalLeadAdapter {
  readonly provider = PortalProvider.NINETY_NINE_ACRES;
  readonly isVerified = false;
  readonly description =
    "99acres Lead Webhook Adapter (DRAFT - Unverified against live partner documentation)";

  parseAndNormalize(payload: unknown): PortalAdapterResult {
    if (!payload || typeof payload !== "object") {
      return { success: false, error: "99acres payload must be a non-null object." };
    }

    const raw = payload as Record<string, unknown>;

    // Anticipated 99acres field names: QueryId / query_id / lead_id (with externalEventId fallback)
    const externalEventId =
      typeof raw.externalEventId === "string" && raw.externalEventId.trim().length > 0
        ? raw.externalEventId.trim()
        : typeof raw.query_id === "string" || typeof raw.query_id === "number"
        ? String(raw.query_id).trim()
        : typeof raw.QueryId === "string" || typeof raw.QueryId === "number"
        ? String(raw.QueryId).trim()
        : typeof raw.queryId === "string"
        ? raw.queryId.trim()
        : typeof raw.lead_id === "string"
        ? raw.lead_id.trim()
        : null;

    // Prospect Name: name / buyer_name / User_Name
    const name =
      typeof raw.name === "string"
        ? raw.name.trim()
        : typeof raw.buyer_name === "string"
        ? raw.buyer_name.trim()
        : typeof raw.User_Name === "string"
        ? raw.User_Name.trim()
        : "";

    if (!name) {
      return { success: false, error: "Missing required buyer name in 99acres payload." };
    }

    // Phone / Mobile: mobile / phone / User_Mobile
    const rawMobile =
      typeof raw.mobile === "string"
        ? raw.mobile
        : typeof raw.phone === "string"
        ? raw.phone
        : typeof raw.User_Mobile === "string"
        ? raw.User_Mobile
        : "";

    if (!rawMobile) {
      return { success: false, error: "Missing required mobile number in 99acres payload." };
    }

    let mobile: string;
    try {
      mobile = normalizeIndianMobile(rawMobile);
    } catch (err) {
      return {
        success: false,
        error: `Invalid Indian mobile in 99acres payload: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // City: city / City_Name / target_city
    const city =
      typeof raw.city === "string"
        ? raw.city.trim()
        : typeof raw.City_Name === "string"
        ? raw.City_Name.trim()
        : "";

    if (!city) {
      return { success: false, error: "Missing required target city in 99acres payload." };
    }

    // Preference: Buy/Rent
    const rawPref =
      typeof raw.preference === "string"
        ? raw.preference.trim().toUpperCase()
        : typeof raw.type === "string"
        ? raw.type.trim().toUpperCase()
        : "SALE";

    const preference =
      rawPref.includes("RENT") ? TransactionType.RENT : TransactionType.SALE;

    // Optional email
    const email =
      typeof raw.email === "string" && raw.email.trim().length > 0
        ? raw.email.trim().toLowerCase()
        : typeof raw.User_Email === "string" && raw.User_Email.trim().length > 0
        ? raw.User_Email.trim().toLowerCase()
        : null;

    // Optional locality
    const locality =
      typeof raw.locality === "string" && raw.locality.trim().length > 0
        ? raw.locality.trim()
        : typeof raw.Locality_Name === "string" && raw.Locality_Name.trim().length > 0
        ? raw.Locality_Name.trim()
        : null;

    // Optional property reference: prop_id / Property_ID / listing_id
    const advertisedPropertyRef =
      typeof raw.prop_id === "string" && raw.prop_id.trim().length > 0
        ? raw.prop_id.trim()
        : typeof raw.Property_ID === "string" && raw.Property_ID.trim().length > 0
        ? raw.Property_ID.trim()
        : typeof raw.advertisedPropertyRef === "string" && raw.advertisedPropertyRef.trim().length > 0
        ? raw.advertisedPropertyRef.trim()
        : null;

    // Optional notes
    const enquiryNotes =
      typeof raw.query_message === "string" && raw.query_message.trim().length > 0
        ? raw.query_message.trim()
        : typeof raw.message === "string" && raw.message.trim().length > 0
        ? raw.message.trim()
        : typeof raw.enquiryNotes === "string" && raw.enquiryNotes.trim().length > 0
        ? raw.enquiryNotes.trim()
        : null;

    // Optional budget range
    let minBudget: number | null = null;
    let maxBudget: number | null = null;
    if (raw.minBudget !== undefined && raw.minBudget !== null) {
      const parsed = Number(raw.minBudget);
      if (!isNaN(parsed) && parsed >= 0) minBudget = parsed;
    }
    if (raw.maxBudget !== undefined && raw.maxBudget !== null) {
      const parsed = Number(raw.maxBudget);
      if (!isNaN(parsed) && parsed >= 0) maxBudget = parsed;
    }

    // Optional property type
    let propertyType: PropertyType | null = null;
    if (typeof raw.propertyType === "string" && raw.propertyType.trim().length > 0) {
      const upper = raw.propertyType.trim().toUpperCase();
      if (Object.values(PropertyType).includes(upper as PropertyType)) {
        propertyType = upper as PropertyType;
      }
    }

    // Optional bedroom configuration
    const bedroomConfiguration =
      typeof raw.bedroomConfiguration === "string" && raw.bedroomConfiguration.trim().length > 0
        ? raw.bedroomConfiguration.trim()
        : typeof raw.bhk === "string" && raw.bhk.trim().length > 0
        ? raw.bhk.trim()
        : null;

    const normalized: NormalizedPortalLead = {
      provider: PortalProvider.NINETY_NINE_ACRES,
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

    return { success: true, normalized };
  }
}

/**
 * Magicbricks Lead Ingestion Adapter (DRAFT / UNVERIFIED)
 *
 * ATTENTION / DISCLAIMER:
 * This adapter mapping is UNVERIFIED pending official Magicbricks partner API documentation
 * and production lead delivery format verification.
 */
export class MagicbricksAdapter implements PortalLeadAdapter {
  readonly provider = PortalProvider.MAGICBRICKS;
  readonly isVerified = false;
  readonly description =
    "Magicbricks Lead API Adapter (DRAFT - Unverified against live partner documentation)";

  parseAndNormalize(payload: unknown): PortalAdapterResult {
    if (!payload || typeof payload !== "object") {
      return { success: false, error: "Magicbricks payload must be a non-null object." };
    }

    const raw = payload as Record<string, unknown>;

    // Anticipated Magicbricks identifiers: id / lead_id / queryid (with externalEventId fallback)
    const externalEventId =
      typeof raw.externalEventId === "string" && raw.externalEventId.trim().length > 0
        ? raw.externalEventId.trim()
        : typeof raw.id === "string" || typeof raw.id === "number"
        ? String(raw.id).trim()
        : typeof raw.lead_id === "string" || typeof raw.lead_id === "number"
        ? String(raw.lead_id).trim()
        : typeof raw.queryid === "string"
        ? raw.queryid.trim()
        : null;

    // Prospect Name
    const name =
      typeof raw.name === "string"
        ? raw.name.trim()
        : typeof raw.lead_name === "string"
        ? raw.lead_name.trim()
        : "";

    if (!name) {
      return { success: false, error: "Missing required prospect name in Magicbricks payload." };
    }

    // Mobile
    const rawMobile =
      typeof raw.mobile === "string"
        ? raw.mobile
        : typeof raw.phone === "string"
        ? raw.phone
        : typeof raw.contact_number === "string"
        ? raw.contact_number
        : "";

    if (!rawMobile) {
      return { success: false, error: "Missing required mobile number in Magicbricks payload." };
    }

    let mobile: string;
    try {
      mobile = normalizeIndianMobile(rawMobile);
    } catch (err) {
      return {
        success: false,
        error: `Invalid Indian mobile in Magicbricks payload: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // City
    const city =
      typeof raw.city === "string"
        ? raw.city.trim()
        : typeof raw.city_name === "string"
        ? raw.city_name.trim()
        : "";

    if (!city) {
      return { success: false, error: "Missing required city in Magicbricks payload." };
    }

    // Preference
    const rawPref =
      typeof raw.preference === "string"
        ? raw.preference.trim().toUpperCase()
        : typeof raw.trans_type === "string"
        ? raw.trans_type.trim().toUpperCase()
        : "SALE";

    const preference =
      rawPref.includes("RENT") ? TransactionType.RENT : TransactionType.SALE;

    // Optional email
    const email =
      typeof raw.email === "string" && raw.email.trim().length > 0
        ? raw.email.trim().toLowerCase()
        : null;

    // Optional locality
    const locality =
      typeof raw.locality === "string" && raw.locality.trim().length > 0
        ? raw.locality.trim()
        : typeof raw.locality_name === "string" && raw.locality_name.trim().length > 0
        ? raw.locality_name.trim()
        : null;

    // Optional property ref
    const advertisedPropertyRef =
      typeof raw.property_id === "string" && raw.property_id.trim().length > 0
        ? raw.property_id.trim()
        : typeof raw.mb_prop_id === "string" && raw.mb_prop_id.trim().length > 0
        ? raw.mb_prop_id.trim()
        : null;

    // Optional notes
    const enquiryNotes =
      typeof raw.comments === "string" && raw.comments.trim().length > 0
        ? raw.comments.trim()
        : typeof raw.enquiryNotes === "string" && raw.enquiryNotes.trim().length > 0
        ? raw.enquiryNotes.trim()
        : null;

    // Optional budget range
    let minBudget: number | null = null;
    let maxBudget: number | null = null;
    if (raw.minBudget !== undefined && raw.minBudget !== null) {
      const parsed = Number(raw.minBudget);
      if (!isNaN(parsed) && parsed >= 0) minBudget = parsed;
    }
    if (raw.maxBudget !== undefined && raw.maxBudget !== null) {
      const parsed = Number(raw.maxBudget);
      if (!isNaN(parsed) && parsed >= 0) maxBudget = parsed;
    }

    // Optional property type
    let propertyType: PropertyType | null = null;
    if (typeof raw.propertyType === "string" && raw.propertyType.trim().length > 0) {
      const upper = raw.propertyType.trim().toUpperCase();
      if (Object.values(PropertyType).includes(upper as PropertyType)) {
        propertyType = upper as PropertyType;
      }
    }

    // Optional bedroom configuration
    const bedroomConfiguration =
      typeof raw.bedroomConfiguration === "string" && raw.bedroomConfiguration.trim().length > 0
        ? raw.bedroomConfiguration.trim()
        : typeof raw.bhk === "string" && raw.bhk.trim().length > 0
        ? raw.bhk.trim()
        : null;

    const normalized: NormalizedPortalLead = {
      provider: PortalProvider.MAGICBRICKS,
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

    return { success: true, normalized };
  }
}

/**
 * NoBroker Lead Ingestion Adapter (DRAFT / UNVERIFIED)
 *
 * ATTENTION / DISCLAIMER:
 * This adapter mapping is UNVERIFIED pending official NoBroker partner API documentation
 * and production webhook payload verification.
 */
export class NoBrokerAdapter implements PortalLeadAdapter {
  readonly provider = PortalProvider.NOBROKER;
  readonly isVerified = false;
  readonly description =
    "NoBroker Lead Webhook Adapter (DRAFT - Unverified against live partner documentation)";

  parseAndNormalize(payload: unknown): PortalAdapterResult {
    if (!payload || typeof payload !== "object") {
      return { success: false, error: "NoBroker payload must be a non-null object." };
    }

    const raw = payload as Record<string, unknown>;

    // Anticipated NoBroker identifiers: event_id / enquiry_id / lead_id (with externalEventId fallback)
    const externalEventId =
      typeof raw.externalEventId === "string" && raw.externalEventId.trim().length > 0
        ? raw.externalEventId.trim()
        : typeof raw.event_id === "string"
        ? raw.event_id.trim()
        : typeof raw.enquiry_id === "string"
        ? raw.enquiry_id.trim()
        : typeof raw.lead_id === "string"
        ? raw.lead_id.trim()
        : null;

    // Prospect Name
    const name =
      typeof raw.name === "string"
        ? raw.name.trim()
        : typeof raw.user_name === "string"
        ? raw.user_name.trim()
        : "";

    if (!name) {
      return { success: false, error: "Missing required prospect name in NoBroker payload." };
    }

    // Mobile
    const rawMobile =
      typeof raw.phone === "string"
        ? raw.phone
        : typeof raw.mobile === "string"
        ? raw.mobile
        : typeof raw.user_phone === "string"
        ? raw.user_phone
        : "";

    if (!rawMobile) {
      return { success: false, error: "Missing required mobile number in NoBroker payload." };
    }

    let mobile: string;
    try {
      mobile = normalizeIndianMobile(rawMobile);
    } catch (err) {
      return {
        success: false,
        error: `Invalid Indian mobile in NoBroker payload: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // City
    const city =
      typeof raw.city === "string"
        ? raw.city.trim()
        : typeof raw.city_name === "string"
        ? raw.city_name.trim()
        : "";

    if (!city) {
      return { success: false, error: "Missing required city in NoBroker payload." };
    }

    // Preference
    const rawPref =
      typeof raw.preference === "string"
        ? raw.preference.trim().toUpperCase()
        : typeof raw.rent_or_sale === "string"
        ? raw.rent_or_sale.trim().toUpperCase()
        : "RENT"; // NoBroker defaults predominantly to rentals

    const preference =
      rawPref.includes("SALE") || rawPref.includes("BUY")
        ? TransactionType.SALE
        : TransactionType.RENT;

    // Optional email
    const email =
      typeof raw.email === "string" && raw.email.trim().length > 0
        ? raw.email.trim().toLowerCase()
        : null;

    // Optional locality
    const locality =
      typeof raw.locality === "string" && raw.locality.trim().length > 0
        ? raw.locality.trim()
        : null;

    // Optional property ref
    const advertisedPropertyRef =
      typeof raw.property_id === "string" && raw.property_id.trim().length > 0
        ? raw.property_id.trim()
        : null;

    // Optional notes
    const enquiryNotes =
      typeof raw.message === "string" && raw.message.trim().length > 0
        ? raw.message.trim()
        : typeof raw.enquiryNotes === "string" && raw.enquiryNotes.trim().length > 0
        ? raw.enquiryNotes.trim()
        : null;

    const normalized: NormalizedPortalLead = {
      provider: PortalProvider.NOBROKER,
      externalEventId,
      name,
      mobile,
      email,
      city,
      locality,
      preference,
      advertisedPropertyRef,
      enquiryNotes,
      rawPayload: payload,
    };

    return { success: true, normalized };
  }
}
