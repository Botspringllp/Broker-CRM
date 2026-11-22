# External Property Portal Inbound Webhook Integration Package

> [!WARNING]
> **DRAFT / NOT OFFICIALLY VERIFIED DISCLAIMER**  
> This documentation package represents the implemented Broker CRM inbound webhook ingestion contract as of November 2026. While the core ingestion engine, authentication layer, distributed rate limiter, and database persistence are fully implemented and verified, **real provider integrations (99acres, Magicbricks, and NoBroker) remain explicitly unverified (`isVerified: false`)** pending official partner API documentation, production webhook signing secrets, and verified payload samples.
>
> In the current codebase, incoming requests targeting `/api/webhooks/portals/99acres`, `/magicbricks`, or `/nobroker` fail closed with `HTTP 400 Bad Request` until their respective adapters are officially verified. The canonical Generic Mock payload format documented herein serves as the proposed standard contract for technical alignment.

---

## 1. Package Overview

This integration package defines the technical specification, API contract, and operational requirements for external real estate portals to push lead and enquiry data directly into the **Broker CRM** platform.

### Target Platforms
- **99acres** (`NINETY_NINE_ACRES`)
- **Magicbricks** (`MAGICBRICKS`)
- **NoBroker** (`NOBROKER`)

### Key Capabilities
- **Push-Based Inbound Ingestion:** Real-time HTTP push webhooks deliver consumer enquiries instantly to brokerages without polling delays.
- **Tenant Isolation:** Every webhook delivery is bound server-side to the authenticated brokerage tenant.
- **Deduplication & Idempotency:** Duplicate webhook events are detected via unique event keys, preventing redundant CRM records.
- **Buyer Lifecycle Integration:** Automatically matches prospective buyers by mobile number within the tenant; existing buyers receive an appended enquiry while preserving original lead source and Do-Not-Contact (DNC) settings.
- **Automated Workload Balancing:** New buyers are automatically assigned to active telecallers using fair round-robin distribution.

---

## 2. Package Inventory

This documentation package contains the following technical resources:

| File | Purpose |
| :--- | :--- |
| [`README.md`](./README.md) | Overview, architecture, onboarding steps, and verification disclaimer (this document). |
| [`integration-guide.md`](./integration-guide.md) | Step-by-step developer guide for portal engineering teams (headers, retries, idempotency, testing). |
| [`provider-field-mapping.md`](./provider-field-mapping.md) | Detailed analysis of current field aliases, canonical mappings, and unverified assumptions for 99acres, Magicbricks, and NoBroker. |
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.1 specification for the inbound webhook endpoint, models, and HTTP responses. |
| [`enquiry.schema.json`](./enquiry.schema.json) | JSON Schema (Draft 2020-12) defining validation rules for the canonical enquiry payload. |
| [`sample-enquiry.json`](./sample-enquiry.json) | Valid JSON payload example conforming to the canonical enquiry schema with dummy data. |

---

## 3. Architecture & Webhook Workflow

```
┌─────────────────┐       HTTPS POST /api/webhooks/portals/{provider}       ┌──────────────────┐
│                 │       Authorization: Bearer <token>                     │                  │
│ External Portal │────────────────────────────────────────────────────────>│  Next.js Edge /  │
│ (e.g. 99acres)  │                                                         │  API Route       │
└─────────────────┘                                                         └────────┬─────────┘
                                                                                     │
                                                      ┌──────────────────────────────┴──────────────────────────────┐
                                                      │                                                             │
                                                      ▼                                                             ▼
                                           [Tier 1: IP Rate Limit]                                      [Header & Size Guards]
                                           60 req/min per IP hash                                       Content-Type: application/json
                                           (Upstash Redis sliding window)                               Content-Length <= 256 KB
                                                      │                                                             │
                                                      └──────────────────────────────┬──────────────────────────────┘
                                                                                     │
                                                                                     ▼
                                                                        [Token Authentication]
                                                                        SHA-256 hash lookup in
                                                                        tenant_portal_configs table
                                                                        (crypto.timingSafeEqual)
                                                                                     │
                                                                                     ▼
                                                                       [Tier 2: Tenant Rate Limit]
                                                                       120 req/min per tenant/provider
                                                                       (Upstash Redis sliding window)
                                                                                     │
                                                                                     ▼
                                                                       [Adapter Verification Guard]
                                                                       isVerified == true check
                                                                       (Fails closed with 400 if false)
                                                                                     │
                                                                                     ▼
                                                                        [Core Ingestion Pipeline]
                                                                        - External ID Idempotency Check
                                                                        - Tenant-scoped Buyer Match
                                                                        - DNC Status Preservation
                                                                        - Telecaller Round-Robin
                                                                        - Atomic PostgreSQL $transaction
                                                                                     │
                                                                                     ▼
                                                                            HTTP 200 OK Response
                                                                            { success, leadId, enquiryId }
```

### Ingestion Lifecycle Stages
1. **Network & Rate Limiting Guard:** The client IP is checked against a 60 requests/minute sliding window. The payload size is verified to be under 256 KB.
2. **Bearer Token Authentication:** The Bearer token is validated against the tenant's stored SHA-256 hash using constant-time comparison. The tenant context is bound server-side.
3. **Tenant Burst Limiter:** Delivery frequency is throttled to 120 requests/minute per tenant/provider pair.
4. **Adapter Normalization:** The provider-specific adapter extracts and normalizes the payload into the unified `NormalizedPortalLead` contract.
5. **Idempotency & Database Processing:**
   - If the portal supplies an `externalEventId`, duplicate requests return the existing event data (`isDuplicate: true`) without creating new records.
   - If the mobile number matches an existing buyer in the tenant, a new `Enquiry` is created and linked to the existing `Lead`. If the buyer has `isDoNotContact: true`, their status is strictly preserved.
   - If the buyer is new, a `Lead` (status `NOT_YET_VALIDATED`), `LeadRequirement`, initial `Enquiry`, and round-robin `Assignment` are created atomically inside a PostgreSQL transaction.

---

## 4. Provider Onboarding Steps

To connect an external property portal to a Broker CRM tenant:

1. **Token Generation (Broker Admin):**
   - The broker navigates to `/settings/portals` in the Broker CRM web application.
   - The broker selects the portal provider (e.g. 99acres) and generates an integration token.
   - The plaintext token (64-character hex string) is displayed **exactly once** in a secure modal. The broker copies the token and the unique webhook URL.
2. **Webhook Registration (Portal Dashboard):**
   - The broker or portal account manager enters the webhook URL:
     `https://<domain>/api/webhooks/portals/{provider}`
   - The Bearer token is configured in the portal's webhook settings or lead-forwarding configuration.
3. **Payload Verification (Technical Partner Team):**
   - The portal engineering team configures webhook delivery using JSON format over HTTPS POST.
   - The payload format is aligned with the schema defined in [`enquiry.schema.json`](./enquiry.schema.json) or mapped using the provider-specific field rules in [`provider-field-mapping.md`](./provider-field-mapping.md).
4. **Adapter Activation:**
   - Once sample payloads and signing procedures are officially verified by the Broker CRM engineering team, the provider adapter is marked `isVerified: true` in the codebase.
   - Live lead deliveries begin processing immediately into the broker's active enquiry pool.

---

## 5. Current Implementation Constraints & Limitations

| Feature / Constraint | Implemented Status | Operational Limitation |
| :--- | :---: | :--- |
| **Transport Protocol** | HTTPS POST Only | GET, PUT, and DELETE methods return `405 Method Not Allowed`. |
| **Content-Type** | `application/json` | XML, SOAP, and form-urlencoded requests return `415 Unsupported Media Type`. |
| **Authentication** | `Authorization: Bearer <token>` | Query string tokens (`?token=...`) and basic auth are rejected (`401 Unauthorized`). |
| **Payload Size** | $\le 256\text{ KB}$ | Payloads exceeding 262,144 bytes return `413 Payload Too Large`. |
| **Payload Signatures** | Not Implemented | HMAC-SHA256 headers (`X-Hub-Signature`, etc.) are not currently validated. |
| **Rate Limiting** | Active (Upstash Redis) | 60 req/min per IP, 120 req/min per tenant. Returns `429 Too Many Requests` on overflow. |
| **Retention Policy** | Active (90 Days) | Processed webhook events are retained for 90 days before automated daily purging. |
| **Provider Stubs** | Unverified (`isVerified: false`) | Inbound webhook route returns `400 Bad Request` for real provider routes until verified. |

---

## 6. Feedback & Inquiries

For technical questions, schema verification, or payload sample submission, please contact the Broker CRM Core Engineering Team.
