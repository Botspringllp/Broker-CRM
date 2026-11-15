import {
  PortalProvider,
  TransactionType,
  PropertyType,
  LeadStatus,
} from "@prisma/client";

/**
 * Normalized representation of a lead/enquiry received from an external property portal.
 * Independent of portal-specific wire formats and payloads.
 */
export interface NormalizedPortalLead {
  /** The originating property portal */
  provider: PortalProvider;

  /** Stable external query, enquiry, or lead identifier from the portal (if supplied) */
  externalEventId?: string | null;

  /** Prospect / buyer full name */
  name: string;

  /** Primary phone number (canonical 10-digit Indian mobile) */
  mobile: string;

  /** Optional buyer email address */
  email?: string | null;

  /** Target city for the enquiry */
  city: string;

  /** Preferred locality name or area within the city */
  locality?: string | null;

  /** Transaction preference: SALE (Buy) or RENT */
  preference: TransactionType;

  /** Budget range */
  minBudget?: number | null;
  maxBudget?: number | null;

  /** Property type requested */
  propertyType?: PropertyType | null;

  /** Bedroom configuration (e.g. "2 BHK", "3 BHK") */
  bedroomConfiguration?: string | null;

  /** External property listing reference or advertised property code */
  advertisedPropertyRef?: string | null;

  /** Free-form buyer notes, comments, or enquiry message */
  enquiryNotes?: string | null;

  /** Raw un-transformed payload preserved for audit and debugging */
  rawPayload?: unknown;
}

/**
 * Result of adapter parsing and normalization.
 */
export interface PortalAdapterSuccess {
  success: true;
  normalized: NormalizedPortalLead;
}

export interface PortalAdapterFailure {
  success: false;
  error: string;
  details?: unknown;
}

export type PortalAdapterResult = PortalAdapterSuccess | PortalAdapterFailure;

/**
 * Generic portal adapter contract.
 * Translates provider-specific wire payloads into the unified NormalizedPortalLead contract.
 */
export interface PortalLeadAdapter {
  /** The portal provider this adapter supports */
  readonly provider: PortalProvider;

  /** Whether the mapping has been verified against official partner API documentation or live feeds */
  readonly isVerified: boolean;

  /** Human-readable description of the adapter and mapping status */
  readonly description: string;

  /**
   * Parses, validates, and normalizes a portal payload.
   */
  parseAndNormalize(payload: unknown): Promise<PortalAdapterResult> | PortalAdapterResult;
}

/**
 * Ingestion options and execution parameters for ingestPortalLead.
 */
export interface IngestPortalLeadInput {
  /** Trusted tenant ID resolved by authenticated server context */
  tenantId: string;

  /** The portal provider */
  provider: PortalProvider;

  /** The incoming raw webhook or API payload */
  payload: unknown;

  /** Optional adapter override (e.g. for testing or custom mappings) */
  adapter?: PortalLeadAdapter;

  /** Optional user ID if the ingestion is triggered on behalf of a specific user/system */
  systemUserId?: string | null;
}

/**
 * Result returned upon successful or duplicate lead ingestion.
 */
export interface PortalIngestionResult {
  success: boolean;
  eventId: string;
  idempotencyKey: string;
  provider: PortalProvider;
  isDuplicate: boolean;
  isExistingBuyer: boolean;
  leadId: string;
  enquiryId: string;
  deduplicationGuarantee: "STRONG_KEYED" | "WEAK_UNKEYED";
  payloadFingerprint: string;
  isDuplicateCandidate?: boolean;
  leadStatus: LeadStatus;
  assignedTelecallerId: string | null;
}

/**
 * Error thrown when a portal integration is disabled in tenant configuration.
 */
export class PortalConfigurationDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalConfigurationDisabledError";
  }
}
