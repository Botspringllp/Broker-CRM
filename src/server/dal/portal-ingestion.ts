import crypto from "crypto";
import { prisma } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import {
  Prisma,
  WebhookProcessingStatus,
  LeadStatus,
  AssignmentMethod,
} from "@prisma/client";
import {
  IngestPortalLeadInput,
  PortalIngestionResult,
  PortalConfigurationDisabledError,
  NormalizedPortalLead,
} from "../integrations/portals/types";
import { getPortalAdapter } from "../integrations/portals/registry";
import { generatePayloadIdempotencyKey } from "../security/portal-tokens";
import { recordLeadFieldChanges } from "./lead-changelog";
import {
  pickRoundRobinTelecallerTx,
  recordLeadAssignmentTx,
} from "./assignments";

const MAX_INGESTION_RETRIES = 3;

/**
 * Checks if a Prisma error represents a unique constraint conflict on the portal webhook event idempotency key.
 */
function isIdempotencyKeyUniqueConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  const metaTarget = error.meta?.target;
  if (Array.isArray(metaTarget)) {
    return metaTarget.some(
      (f) =>
        typeof f === "string" &&
        (f.includes("idempotencyKey") ||
          f.includes("idempotency_key") ||
          f.includes("portal_webhook_events_tenantId_provider_idempotencyKey_key") ||
          f.includes("portal_webhook_events_tenant_id_provider_idempotency_key_key"))
    );
  }
  if (typeof metaTarget === "string") {
    return (
      metaTarget.includes("idempotencyKey") ||
      metaTarget.includes("idempotency_key") ||
      metaTarget.includes("portal_webhook_events_tenantId_provider_idempotencyKey_key")
    );
  }
  if (typeof error.message === "string") {
    return (
      error.message.includes("portal_webhook_events_tenantId_provider_idempotencyKey_key") ||
      error.message.includes("idempotencyKey")
    );
  }
  return false;
}

/**
 * Checks if a Prisma error represents a unique constraint conflict on (tenantId, primaryPhone) in the leads table.
 */
function isTenantPhoneUniqueConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  const metaTarget = error.meta?.target;
  if (Array.isArray(metaTarget)) {
    return metaTarget.some(
      (field) =>
        typeof field === "string" &&
        (field.includes("primaryPhone") ||
          field.includes("primary_phone") ||
          field.includes("leads_tenantId_primaryPhone_key") ||
          field.includes("leads_tenant_id_primary_phone_key"))
    );
  }
  if (typeof metaTarget === "string") {
    return (
      metaTarget.includes("primaryPhone") ||
      metaTarget.includes("primary_phone") ||
      metaTarget.includes("leads_tenantId_primaryPhone_key") ||
      metaTarget.includes("leads_tenant_id_primary_phone_key")
    );
  }
  if (typeof error.message === "string") {
    return (
      error.message.includes("leads_tenantId_primaryPhone_key") ||
      error.message.includes("leads_tenant_id_primary_phone_key") ||
      (error.message.includes("primaryPhone") && error.message.includes("tenantId")) ||
      (error.message.includes("primary_phone") && error.message.includes("tenant_id"))
    );
  }
  return false;
}

/**
 * Builds structured enquiry details combining buyer comments and portal search criteria.
 */
function buildPortalEnquiryDetails(
  normalized: NormalizedPortalLead,
  isExistingBuyer: boolean
): string | null {
  const parts: string[] = [];

  if (normalized.enquiryNotes?.trim()) {
    parts.push(normalized.enquiryNotes.trim());
  }

  const metaParts: string[] = [];
  if (normalized.preference) metaParts.push(`Type: ${normalized.preference}`);
  if (normalized.city) metaParts.push(`City: ${normalized.city}`);
  if (normalized.locality) metaParts.push(`Locality: ${normalized.locality}`);
  if (
    normalized.minBudget !== null &&
    normalized.minBudget !== undefined &&
    normalized.maxBudget !== null &&
    normalized.maxBudget !== undefined
  ) {
    metaParts.push(
      `Budget: ₹${normalized.minBudget.toLocaleString("en-IN")} - ₹${normalized.maxBudget.toLocaleString("en-IN")}`
    );
  }
  if (normalized.bedroomConfiguration) {
    metaParts.push(`BHK: ${normalized.bedroomConfiguration}`);
  }
  if (normalized.propertyType) {
    metaParts.push(`Property: ${normalized.propertyType}`);
  }

  if (metaParts.length > 0) {
    parts.push(`[${normalized.provider} Portal Criteria]: ${metaParts.join(" | ")}`);
  }

  if (isExistingBuyer) {
    parts.push(`[Re-enquiry via ${normalized.provider}]`);
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * Ingests an incoming lead from an external property portal into the Broker CRM.
 *
 * Enforces:
 * 1. Server-side tenant and provider configuration verification.
 * 2. Provider-specific adapter normalization.
 * 3. Robust idempotency handling:
 *    - Stable external event IDs are strictly deduplicated with strong guarantees.
 *    - Unkeyed deliveries receive safe receipt IDs so legitimate identical subsequent enquiries are not discarded.
 * 4. Tenant-scoped buyer deduplication:
 *    - New buyer: Creates Lead, LeadRequirement, Enquiry, Round-robin Assignment, and Changelog.
 *    - Existing buyer: Creates new Enquiry, preserves original source, phone, source timestamp,
 *      existing requirements, and assignment. Protects DNC buyers from inadvertent reactivation.
 * 5. Full transactional atomicity and concurrent conflict safety.
 */
export async function ingestPortalLead(
  input: IngestPortalLeadInput
): Promise<PortalIngestionResult> {
  const { tenantId, provider } = input;

  if (!tenantId || typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw new ValidationError("Trusted tenantId is required for lead ingestion.");
  }

  // 1. Resolve and validate tenant portal configuration
  const config = await prisma.tenantPortalConfig.findUnique({
    where: {
      tenantId_provider: {
        tenantId,
        provider,
      },
    },
  });

  if (!config) {
    throw new NotFoundError(
      `Portal integration for provider '${provider}' is not configured for this tenant.`
    );
  }

  if (!config.isEnabled) {
    throw new PortalConfigurationDisabledError(
      `Portal integration for provider '${provider}' is currently disabled for this tenant.`
    );
  }

  // 2. Parse and normalize payload via adapter
  const adapter = input.adapter ?? getPortalAdapter(provider);
  const parseResult = await adapter.parseAndNormalize(input.payload);

  if (!parseResult.success) {
    // Record FAILED webhook event for operational auditing
    try {
      await prisma.portalWebhookEvent.create({
        data: {
          tenantId,
          provider,
          idempotencyKey: `failed_${crypto.randomUUID()}`,
          status: WebhookProcessingStatus.FAILED,
          errorMessage: parseResult.error,
          rawPayload: (input.payload as Prisma.InputJsonValue) ?? null,
        },
      });
    } catch {
      // Ignore failure logging errors to prioritize throwing the validation error
    }

    throw new ValidationError(parseResult.error);
  }

  const normalized = parseResult.normalized;

  // 3. Compute canonical payload fingerprint and determine idempotency key
  const payloadFingerprint = generatePayloadIdempotencyKey(input.payload);
  const hasExternalId = Boolean(
    normalized.externalEventId && normalized.externalEventId.trim().length > 0
  );

  let idempotencyKey: string;
  let deduplicationGuarantee: "STRONG_KEYED" | "WEAK_UNKEYED";

  if (hasExternalId) {
    idempotencyKey = `${provider}_${normalized.externalEventId!.trim()}`;
    deduplicationGuarantee = "STRONG_KEYED";
  } else {
    // Unkeyed delivery: Use a unique receipt identifier to prevent permanently discarding legitimate identical re-enquiries
    idempotencyKey = `unkeyed_${crypto.randomUUID()}`;
    deduplicationGuarantee = "WEAK_UNKEYED";
  }

  // 4. Pre-check idempotency for keyed events
  if (hasExternalId) {
    const existingEvent = await prisma.portalWebhookEvent.findUnique({
      where: {
        tenantId_provider_idempotencyKey: {
          tenantId,
          provider,
          idempotencyKey,
        },
      },
    });

    if (existingEvent && existingEvent.status === WebhookProcessingStatus.PROCESSED) {
      const existingLead = await prisma.lead.findFirst({
        where: { tenantId, primaryPhone: existingEvent.leadPhone! },
        select: { id: true, status: true, assignedTelecallerId: true },
      });

      const existingEnquiry = await prisma.enquiry.findFirst({
        where: { tenantId, leadId: existingLead?.id, source: provider },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      return {
        success: true,
        eventId: existingEvent.id,
        idempotencyKey,
        provider,
        isDuplicate: true,
        isExistingBuyer: true,
        leadId: existingLead?.id ?? "",
        enquiryId: existingEnquiry?.id ?? "",
        deduplicationGuarantee: "STRONG_KEYED",
        payloadFingerprint,
        leadStatus: existingLead?.status ?? LeadStatus.NOT_YET_VALIDATED,
        assignedTelecallerId: existingLead?.assignedTelecallerId ?? null,
      };
    }
  }

  // Check for duplicate candidate in unkeyed deliveries (observability)
  let isDuplicateCandidate = false;
  if (!hasExternalId) {
    const priorCandidate = await prisma.portalWebhookEvent.findFirst({
      where: {
        tenantId,
        provider,
        leadPhone: normalized.mobile,
        status: WebhookProcessingStatus.PROCESSED,
      },
      select: { id: true },
    });
    isDuplicateCandidate = Boolean(priorCandidate);
  }

  // 5. Transactional Execution with retry loop for concurrent unique conflicts
  for (let attempt = 1; attempt <= MAX_INGESTION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // A. Record PENDING webhook event
        const webhookEvent = await tx.portalWebhookEvent.create({
          data: {
            tenantId,
            provider,
            externalEventId: normalized.externalEventId?.trim() || null,
            idempotencyKey,
            status: WebhookProcessingStatus.PENDING,
            eventAction: hasExternalId ? "PORTAL_LEAD_INGESTION" : "UNKEYED_PORTAL_DELIVERY",
            leadPhone: normalized.mobile,
            leadEmail: normalized.email?.trim().toLowerCase() || null,
            advertisedPropertyRef: normalized.advertisedPropertyRef?.trim() || null,
            rawPayload: {
              body: (input.payload as Prisma.InputJsonValue) ?? null,
              _metadata: {
                payloadFingerprint,
                deduplicationGuarantee,
                isKeyed: hasExternalId,
                isDuplicateCandidate,
              },
            },
          },
        });

        // B. Resolve advertised property reference (if valid tenant-scoped property)
        let validatedPropertyId: string | null = null;
        if (normalized.advertisedPropertyRef?.trim()) {
          const prop = await tx.property.findFirst({
            where: {
              tenantId,
              id: normalized.advertisedPropertyRef.trim(),
            },
            select: { id: true },
          });
          if (prop) {
            validatedPropertyId = prop.id;
          }
        }

        // C. Tenant-scoped buyer lookup
        const existingLead = await tx.lead.findFirst({
          where: {
            tenantId,
            primaryPhone: normalized.mobile,
          },
          include: {
            requirement: true,
          },
        });

        if (existingLead) {
          // -------------------------------------------------------------
          // CASE 1: EXISTING BUYER RE-ENQUIRY
          // -------------------------------------------------------------
          // DNC Protection (PRD §5.5): If DNC, never reactivate or reopen
          const shouldReopen =
            existingLead.status === LeadStatus.INACTIVE && !existingLead.isDoNotContact;
          const nextStatus = shouldReopen
            ? LeadStatus.NOT_YET_VALIDATED
            : existingLead.status;

          if (shouldReopen) {
            await tx.lead.update({
              where: { id: existingLead.id },
              data: { status: nextStatus },
            });

            await recordLeadFieldChanges({
              tx,
              tenantId,
              leadId: existingLead.id,
              changedByUserId: input.systemUserId || null,
              changeSource: "API",
              changes: [
                {
                  fieldName: "status",
                  previousValue: LeadStatus.INACTIVE,
                  newValue: LeadStatus.NOT_YET_VALIDATED,
                },
              ],
            });
          }

          // Build enquiry details
          const enquiryDetails = buildPortalEnquiryDetails(normalized, true);

          // Create new Enquiry linked to existing Lead
          const enquiry = await tx.enquiry.create({
            data: {
              tenantId,
              leadId: existingLead.id,
              source: provider,
              advertisedPropertyRef: normalized.advertisedPropertyRef?.trim() || null,
              advertisedPropertyId: validatedPropertyId,
              enquiryDetails,
            },
          });

          // Mark webhook event as PROCESSED
          await tx.portalWebhookEvent.update({
            where: { id: webhookEvent.id },
            data: {
              status: WebhookProcessingStatus.PROCESSED,
              processedAt: new Date(),
            },
          });

          return {
            success: true,
            eventId: webhookEvent.id,
            idempotencyKey,
            provider,
            isDuplicate: false,
            isExistingBuyer: true,
            leadId: existingLead.id,
            enquiryId: enquiry.id,
            deduplicationGuarantee,
            payloadFingerprint,
            isDuplicateCandidate,
            leadStatus: nextStatus,
            assignedTelecallerId: existingLead.assignedTelecallerId,
          };
        } else {
          // -------------------------------------------------------------
          // CASE 2: NEW BUYER INGESTION
          // -------------------------------------------------------------
          let targetTelecallerId: string | null = null;
          let assignmentMethod: AssignmentMethod | null = null;

          try {
            targetTelecallerId = await pickRoundRobinTelecallerTx(tx, tenantId);
            assignmentMethod = AssignmentMethod.ROUND_ROBIN;
          } catch (err) {
            if (err instanceof ValidationError) {
              // Fair fallback: If no active telecaller exists, leave unassigned without failing
              targetTelecallerId = null;
              assignmentMethod = null;
            } else {
              throw err;
            }
          }

          const enquiryDetails = buildPortalEnquiryDetails(normalized, false);

          // Create Lead + Requirement + first Enquiry atomically
          const newLead = await tx.lead.create({
            data: {
              tenantId,
              name: normalized.name.trim(),
              primaryPhone: normalized.mobile,
              email: normalized.email?.trim().toLowerCase() || null,
              originalSource: provider,
              assignedTelecallerId: targetTelecallerId,
              status: LeadStatus.NOT_YET_VALIDATED,
              requirement: {
                create: {
                  tenantId,
                  minBudget: new Prisma.Decimal(normalized.minBudget ?? 0),
                  maxBudget: new Prisma.Decimal(normalized.maxBudget ?? 0),
                  city: normalized.city.trim(),
                  preference: normalized.preference,
                  bedroomConfigurations: normalized.bedroomConfiguration
                    ? [normalized.bedroomConfiguration.trim()]
                    : [],
                  propertyTypes: normalized.propertyType ? [normalized.propertyType] : [],
                },
              },
              enquiries: {
                create: {
                  tenantId,
                  source: provider,
                  advertisedPropertyRef: normalized.advertisedPropertyRef?.trim() || null,
                  advertisedPropertyId: validatedPropertyId,
                  enquiryDetails,
                },
              },
            },
            include: {
              enquiries: true,
            },
          });

          // Record assignment if telecaller was assigned
          if (targetTelecallerId && assignmentMethod) {
            await recordLeadAssignmentTx({
              tx,
              tenantId,
              leadId: newLead.id,
              targetTelecallerId,
              assignedByUserId: input.systemUserId || null,
              method: assignmentMethod,
              notes: `Auto-assigned via ${provider} portal lead ingestion.`,
            });
          }

          // Record creation audit in changelog with changeSource: API
          await recordLeadFieldChanges({
            tx,
            tenantId,
            leadId: newLead.id,
            changedByUserId: input.systemUserId || null,
            changeSource: "API",
            changes: [
              {
                fieldName: "originalSource",
                previousValue: null,
                newValue: provider,
              },
              {
                fieldName: "status",
                previousValue: null,
                newValue: LeadStatus.NOT_YET_VALIDATED,
              },
            ],
          });

          // Mark webhook event as PROCESSED
          await tx.portalWebhookEvent.update({
            where: { id: webhookEvent.id },
            data: {
              status: WebhookProcessingStatus.PROCESSED,
              processedAt: new Date(),
            },
          });

          const createdEnquiry = newLead.enquiries[0];

          return {
            success: true,
            eventId: webhookEvent.id,
            idempotencyKey,
            provider,
            isDuplicate: false,
            isExistingBuyer: false,
            leadId: newLead.id,
            enquiryId: createdEnquiry.id,
            deduplicationGuarantee,
            payloadFingerprint,
            isDuplicateCandidate: false,
            leadStatus: LeadStatus.NOT_YET_VALIDATED,
            assignedTelecallerId: targetTelecallerId,
          };
        }
      });
    } catch (err) {
      // Safe recovery for concurrent duplicate delivery on idempotencyKey
      if (isIdempotencyKeyUniqueConflict(err)) {
        const existingEvent = await prisma.portalWebhookEvent.findUnique({
          where: {
            tenantId_provider_idempotencyKey: {
              tenantId,
              provider,
              idempotencyKey,
            },
          },
        });

        if (existingEvent) {
          const existingLead = await prisma.lead.findFirst({
            where: { tenantId, primaryPhone: existingEvent.leadPhone! },
            select: { id: true, status: true, assignedTelecallerId: true },
          });

          const existingEnquiry = await prisma.enquiry.findFirst({
            where: { tenantId, leadId: existingLead?.id, source: provider },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });

          return {
            success: true,
            eventId: existingEvent.id,
            idempotencyKey,
            provider,
            isDuplicate: true,
            isExistingBuyer: true,
            leadId: existingLead?.id ?? "",
            enquiryId: existingEnquiry?.id ?? "",
            deduplicationGuarantee: "STRONG_KEYED",
            payloadFingerprint,
            leadStatus: existingLead?.status ?? LeadStatus.NOT_YET_VALIDATED,
            assignedTelecallerId: existingLead?.assignedTelecallerId ?? null,
          };
        }
      }

      // Safe retry for concurrent primaryPhone conflicts
      if (isTenantPhoneUniqueConflict(err) && attempt < MAX_INGESTION_RETRIES) {
        continue;
      }

      throw err;
    }
  }

  throw new Error("Lead ingestion failed after maximum retry attempts.");
}
