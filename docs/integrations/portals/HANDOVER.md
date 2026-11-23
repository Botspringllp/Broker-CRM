# External Property Portal Inbound Webhook Integration — Technical Handover Specification

**Document Version:** 1.0.0-final  
**Target Audience:** Project Owner, External Integration Engineering Teams (99acres, Magicbricks, NoBroker), Broker CRM Engineering  
**System Name:** Broker CRM Portal Lead Ingestion Service  
**Date:** November 22, 2026  
**Implementation Status:** Core Ingestion Verified / Provider Stubs Unverified (`isVerified: false`)  

---

## 1. Executive Summary

This handover document provides a technical specification of the inbound webhook integration architecture implemented in **Broker CRM**. It is designed to assist the project owner in coordinating technical discussions with external property portal engineering teams, specifically **99acres** (Info Edge India Ltd.), **Magicbricks** (Times Internet Ltd.), and **NoBroker** (NoBroker Technologies Solutions Pvt. Ltd.).

Broker CRM provides a push-based HTTP webhook service allowing external portals to deliver real-time buyer inquiries, property leads, and requirement matches directly into a brokerage's CRM database. The platform ensures:
- **Zero Cross-Tenant Leakage:** Server-side tenant resolution using high-entropy Bearer tokens.
- **Robust Idempotency:** Duplicate delivery suppression based on portal query identifiers or deterministic canonical payload hashing.
- **Intelligent Buyer Lifecycle Management:** Automatic phone deduplication, linking repeat inquiries to existing buyer profiles without altering original lead source attribution or violating Do-Not-Contact (DNC) preferences.
- **Automated Agent Workload Balancing:** Immediate assignment of new prospective buyers to active telecallers using fair round-robin scheduling.
- **Production Defense-in-Depth:** Distributed rate limiting (Upstash Redis sliding window), payload size caps (256 KB), and automated 90-day retention purging.

> [!WARNING]
> **CRITICAL VERIFICATION DISCLAIMER**  
> While the core ingestion engine, data access layer, database schemas, and security controls are fully implemented and verified in the Broker CRM codebase, **the real provider adapters (`99acres`, `magicbricks`, `nobroker`) currently have `isVerified = false`**.  
> The inbound webhook route strictly enforces this security boundary: any incoming HTTP request targeting `/api/webhooks/portals/99acres`, `/magicbricks`, or `/nobroker` will fail closed with `HTTP 400 Bad Request` until official partner API documentation, payload schemas, and signed test samples are reviewed and the adapters are marked `isVerified = true`.  
> The canonical Generic Mock payload format documented herein represents the proposed technical standard for partner alignment.

---

## 2. Integration Objective and Scope

### 2.1 Business Objective
The primary objective of this integration is to replace manual lead extraction (CSV exports, email forwarding, portal dashboard copy-pasting) with an automated, push-based webhook pipeline. This enables:
1. **Sub-second Lead Response Time:** Immediate lead ingestion allows brokerage telecallers to initiate contact within minutes of a consumer submitting an inquiry.
2. **Accurate Lead Attribution:** Preserving original portal campaign source, advertised property references, and consumer inquiry notes.
3. **Data Integrity & De-duplication:** Ensuring multiple inquiries from the same consumer on the same or different portal listings are consolidated under a single CRM buyer record.

### 2.2 Phase 1 Scope Boundary
Per the canonical Product Requirements Document (`docs/Broker PRD.pdf`, pages 1–9), Phase 1 encompasses:
- Inbound lead reception, validation, and normalization.
- Tenant isolation and token-based authentication.
- Lead and enquiry persistence in PostgreSQL.
- Initial round-robin assignment to telecallers.
- Site visit scheduling and feedback recording.

**Explicitly Out of Scope for Phase 1:**
- Post-visit deal stages (`Negotiation`, `Token`, `Final Deal`).
- Commission accounting, GST billing, and invoicing modules.
- Outbound lead synchronization back to portal dashboards.
- Broker website template generation.

---

## 3. System Architecture and Data Flow

The following sequence outlines the end-to-end lifecycle of an incoming webhook push:

```
┌─────────────────┐       HTTPS POST /api/webhooks/portals/{provider}       ┌──────────────────┐
│                 │       Authorization: Bearer <token>                     │                  │
│ External Portal │────────────────────────────────────────────────────────>│  Next.js Edge /  │
│ Dispatcher      │       Content-Type: application/json                    │  Route Handler   │
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
                                                                         - Idempotency check on externalEventId
                                                                         - Indian mobile normalization (+91 / 10-digit)
                                                                         - Tenant-scoped buyer deduplication
                                                                         - DNC protection & preference preservation
                                                                         - Round-robin telecaller assignment
                                                                         - Atomic PostgreSQL $transaction
                                                                                     │
                                                                                     ▼
                                                                            HTTP 200 OK Response
                                                                            { success, leadId, enquiryId }
```

### Stage-by-Stage Processing
1. **Network & Protocol Verification:**
   The route handler verifies the HTTP method is `POST`, headers contain `Content-Type: application/json`, and body size is strictly $\le 256\text{ KB}$ (262,144 bytes).
2. **Tier 1 Rate Limiting (Pre-Authentication):**
   Client IP is hashed and checked against an Upstash Redis sliding window (60 requests/minute). If Redis is unreachable or unconfigured in production, the endpoint safely returns `HTTP 503 Service Unavailable`.
3. **Bearer Token Authentication:**
   The `Authorization: Bearer <token>` header is parsed. The plaintext token is hashed using SHA-256 and matched against the database using `crypto.timingSafeEqual`. The tenant ID is bound strictly from the authenticated record.
4. **Tier 2 Rate Limiting (Post-Authentication):**
   Authenticated tenant traffic is throttled to 120 requests/minute per provider.
5. **Adapter Verification Check:**
   The system retrieves the registered adapter for `{provider}`. If `adapter.isVerified` is `false`, execution halts and returns `HTTP 400 Bad Request`.
6. **Data Access Layer (DAL) Ingestion:**
   - Evaluates `externalEventId`. If already processed within 90 days, acknowledges immediately with existing IDs and `isDuplicate: true`.
   - Normalizes mobile number to 10-digit Indian standard (`^[6-9]\d{9}$`).
   - Checks if mobile exists within the tenant.
     - **Existing Buyer:** Appends new `Enquiry` record; keeps existing `Lead` and `LeadRequirement`; preserves `isDoNotContact` flag.
     - **New Buyer:** Atomically creates `Lead` (status `NOT_YET_VALIDATED`), `LeadRequirement`, initial `Enquiry`, `Assignment` (via telecaller round-robin), and `LeadChangeLog`.

---

## 4. API Endpoint and HTTP Method

### 4.1 URL Structure
```http
POST https://<broker-domain>/api/webhooks/portals/{provider}
```

- `<broker-domain>`: Fully qualified domain of the brokerage instance (e.g., `crm.brokerage.com` or `localhost:3000` for local sandbox).
- `{provider}`: Case-insensitive route parameter identifying the portal.

### 4.2 Supported Route Providers
The endpoint resolves the following string variants:
- **99acres:** `99acres`, `99ACRES`, `NINETY_NINE_ACRES`, `99_ACRES` $\rightarrow$ resolves to Prisma `PortalProvider.NINETY_NINE_ACRES`.
- **Magicbricks:** `magicbricks`, `MAGICBRICKS`, `MAGIC_BRICKS` $\rightarrow$ resolves to Prisma `PortalProvider.MAGICBRICKS`.
- **NoBroker:** `nobroker`, `NOBROKER`, `NO_BROKER` $\rightarrow$ resolves to Prisma `PortalProvider.NOBROKER`.
- *Any other string:* Returns `HTTP 404 Not Found` with `{ "error": "Unsupported portal provider route: '<provider>'." }`.

### 4.3 HTTP Methods
- **`POST`:** The **only** supported method for lead delivery.
- **`GET`, `PUT`, `DELETE`:** Strictly disallowed. Returns `HTTP 405 Method Not Allowed` with response header `Allow: POST`.

---

## 5. Authentication Requirements

### 5.1 Token Specification
- **Format:** 64-character hexadecimal string representing 32 cryptographically random bytes (256 bits of entropy) generated via Node.js `crypto.randomBytes(32).toString("hex")`.
- **Minimum Acceptable Length:** 32 characters.
- **Transport:** Delivered exclusively via the HTTP standard `Authorization` header:
  ```http
  Authorization: Bearer <64-character-token>
  ```
- **Prohibited:** Tokens in query parameters (e.g. `?token=...`) or basic authentication headers are rejected with `HTTP 401 Unauthorized`.

### 5.2 Token Lifecycle & Storage Security
- **Generation:** Brokerage administrators generate portal tokens in the CRM UI under `/settings/portals`.
- **Single Disclosure:** The plaintext token is disclosed **exactly once** in a secure modal upon creation or rotation.
- **Database Storage:** The CRM database never stores plaintext tokens. It stores only the `SHA-256` digest (`webhookTokenHash`, 64 hex characters).
- **Rotation:** Token rotation immediately invalidates the previous token, generates a fresh secret, records `tokenRotatedAt`, and archives `previousHash`.
- **Provider Binding:** Tokens are bound to a specific provider. A token generated for 99acres cannot be used against the Magicbricks webhook endpoint (returns `HTTP 401 Unauthorized`).

---

## 6. JSON Request Format

All incoming requests must conform to standard JSON encoding:
- **`Content-Type` Header:** Must be `application/json` (optional charset `utf-8`). Requests with XML, `application/x-www-form-urlencoded`, or multipart data are rejected with `HTTP 415 Unsupported Media Type`.
- **Root Element:** Must be a valid JSON Object (`{ ... }`). JSON arrays or scalar values are rejected with `HTTP 400 Bad Request`.
- **Size Limitation:** Maximum body size is strictly capped at **256 KB (262,144 bytes)**. Requests indicating or delivering exceeding payloads are rejected with `HTTP 413 Payload Too Large`.

---

## 7. Field Definitions and Required/Optional Fields

The canonical contract accepted by the core ingestion engine (and verified in `GenericMockPortalAdapter`) is structured as follows:

| Field Name | Data Type | Required? | Constraints & Format | Description |
| :--- | :--- | :---: | :--- | :--- |
| `name` | `string` | **Yes** | Min 1, Max 255 chars | Full name of the prospect/buyer. |
| `mobile` | `string` | **Yes** | Indian Phone Regex | Primary 10-digit mobile number starting with 6, 7, 8, or 9. Accepts prefixes `+91`, `91`, `0` and formatting spaces/hyphens. |
| `city` | `string` | **Yes** | Min 1, Max 100 chars | Target property search city (e.g. "Gurugram", "Bengaluru"). |
| `preference` | `string` | No | Enum: `SALE`, `RENT`, `BUY`, `PURCHASE`, `RENTAL` | Transaction type. Defaults to `SALE` (except in NoBroker draft stub which defaults to `RENT`). |
| `externalEventId`| `string` | No | Min 1, Max 255 chars | Portal's unique lead/query ID. **Highly recommended** to guarantee idempotent deduplication. |
| `email` | `string` | No | Valid email format | Prospect email address. Trimmed and stored in lowercase. |
| `locality` | `string` | No | Max 255 chars | Target micro-market, sector, or neighborhood. |
| `minBudget` | `number` | No | Numeric $\ge 0$ | Minimum budget in INR (e.g. `15000000` for ₹1.5 Cr). |
| `maxBudget` | `number` | No | Numeric $\ge \text{minBudget}$ | Maximum budget in INR. If both provided, `maxBudget` must be $\ge \text{minBudget}$. |
| `propertyType` | `string` | No | CRM Enum | One of: `APARTMENT`, `INDEPENDENT_HOUSE`, `VILLA`, `BUILDER_FLOOR`, `PLOT`, `COMMERCIAL`, `OTHER`. |
| `bedroomConfiguration`| `string` | No | Max 100 chars | Desired configuration string (e.g. "2 BHK", "3 BHK"). |
| `advertisedPropertyRef`| `string` | No | Max 255 chars | External listing ID of the advertised property inquired upon. |
| `enquiryNotes` | `string` | No | Max 2000 chars | Consumer comments or portal-generated search criteria text. |

### Anticipated Provider-Specific Wire Aliases (Draft Stubs)
The unverified provider stubs (`src/server/integrations/portals/adapters/provider-stubs.ts`) currently inspect the following alternative aliases:
- **99acres Aliases:**
  - `externalEventId`: `externalEventId`, `query_id`, `QueryId`, `queryId`, `lead_id`
  - `name`: `name`, `buyer_name`, `User_Name`
  - `mobile`: `mobile`, `phone`, `User_Mobile`
  - `city`: `city`, `City_Name`
  - `enquiryNotes`: `query_message`, `message`, `enquiryNotes`
  - `advertisedPropertyRef`: `prop_id`, `Property_ID`
- **Magicbricks Aliases:**
  - `externalEventId`: `externalEventId`, `id`, `lead_id`, `queryid`
  - `name`: `name`, `lead_name`
  - `mobile`: `mobile`, `phone`, `contact_number`
  - `city`: `city`, `city_name`
  - `preference`: `preference`, `trans_type`
  - `enquiryNotes`: `comments`, `enquiryNotes`
  - `advertisedPropertyRef`: `property_id`, `mb_prop_id`
- **NoBroker Aliases:**
  - `externalEventId`: `externalEventId`, `event_id`, `enquiry_id`, `lead_id`
  - `name`: `name`, `user_name`
  - `mobile`: `phone`, `mobile`, `user_phone`
  - `city`: `city`, `city_name`
  - `preference`: `preference`, `rent_or_sale` (defaults to `RENT`)

---

## 8. Sample Request and Response

### 8.1 Complete Request Payload (Proposed Canonical Standard)
```json
{
  "externalEventId": "99a_qry_20261122_987654",
  "name": "Aman Verma",
  "mobile": "9810011223",
  "email": "aman.verma@example.com",
  "city": "Gurugram",
  "locality": "Sector 54",
  "preference": "SALE",
  "minBudget": 15000000,
  "maxBudget": 25000000,
  "propertyType": "APARTMENT",
  "bedroomConfiguration": "3 BHK",
  "advertisedPropertyRef": "prop-ref-101",
  "enquiryNotes": "Looking for ready-to-move 3 BHK apartment near Sector 54 metro station."
}
```

### 8.2 Minimal Required Request Payload
```json
{
  "name": "Pooja Sharma",
  "mobile": "+91 98765 43210",
  "city": "Noida",
  "preference": "RENT"
}
```

### 8.3 Success Responses (`HTTP 200 OK`)

#### Case A: New Prospective Buyer Ingested
```json
{
  "success": true,
  "eventId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "leadId": "7b2e9c12-3a4b-4f5d-8a1e-123456789abc",
  "enquiryId": "8c3f0d23-4b5c-5e6f-9b2f-234567890bcd",
  "isDuplicate": false,
  "isExistingBuyer": false,
  "deduplicationGuarantee": "STRONG_KEYED",
  "isDuplicateCandidate": false
}
```

#### Case B: Repeat Inquiry from Existing Buyer
```json
{
  "success": true,
  "eventId": "a12bc34d-58cc-4372-a567-0e02b2c3d480",
  "leadId": "7b2e9c12-3a4b-4f5d-8a1e-123456789abc",
  "enquiryId": "9d4e1f34-4b5c-5e6f-9b2f-345678901cde",
  "isDuplicate": false,
  "isExistingBuyer": true,
  "deduplicationGuarantee": "STRONG_KEYED",
  "isDuplicateCandidate": false
}
```

#### Case C: Idempotent Delivery Replay (Duplicate Event)
```json
{
  "success": true,
  "eventId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "leadId": "7b2e9c12-3a4b-4f5d-8a1e-123456789abc",
  "enquiryId": "8c3f0d23-4b5c-5e6f-9b2f-234567890bcd",
  "isDuplicate": true,
  "isExistingBuyer": false,
  "deduplicationGuarantee": "STRONG_KEYED",
  "isDuplicateCandidate": false
}
```

---

## 9. Validation and Error Handling

All error responses return a standardized JSON object containing a human-readable `error` string:
```json
{
  "error": "Descriptive error message"
}
```

### Complete HTTP Status Code Catalog

| HTTP Status | Trigger Condition | Exact Error Message / Behavior | Partner Dispatcher Action |
| :--- | :--- | :--- | :--- |
| **`400 Bad Request`** | Unverified Adapter Guard | `"Provider integration for '<provider>' is unverified. Webhook ingestion is disabled pending official partner API documentation."` | Do not retry. Contact Broker CRM team to activate verified adapter. |
| **`400 Bad Request`** | Validation Failure | `"Prospect name is required."` / `"Invalid Indian mobile number..."` / `"Maximum budget cannot be less than minimum budget."` | Fix payload formatting. Do not retry identical request. |
| **`400 Bad Request`** | Malformed JSON | `"Malformed JSON payload."` / `"Invalid payload: root must be a JSON object."` / `"Empty request body."` | Check JSON serialization in dispatcher. |
| **`401 Unauthorized`** | Missing Header | `"Missing Authorization header."` | Add `Authorization: Bearer <token>` header. |
| **`401 Unauthorized`** | Malformed Header | `"Malformed Authorization header. Format must be 'Bearer <token>'."` | Ensure header matches exact format. |
| **`401 Unauthorized`** | Invalid Token | `"Unauthorized: Invalid webhook token."` | Verify token string with brokerage administrator. |
| **`401 Unauthorized`** | Provider Mismatch | `"Unauthorized: Webhook token is not configured for provider '<provider>'."` | Ensure token was generated for the specific endpoint. |
| **`401 Unauthorized`** | Integration Disabled| `"Unauthorized: Portal integration for provider '<provider>' is disabled for this tenant."` | Tenant administrator must toggle integration `Enabled` in CRM settings. |
| **`404 Not Found`** | Unknown Provider Route| `"Unsupported portal provider route: '<provider>'."` | Correct URL spelling (`/99acres`, `/magicbricks`, `/nobroker`). |
| **`405 Method Not Allowed`**| Non-POST Method | `"Method Not Allowed. Only POST requests are supported."` | Configure dispatcher to use HTTP `POST`. |
| **`413 Payload Too Large`**| Body $> 256\text{ KB}$| `"Payload exceeds 256 KB limit."` | Truncate large embedded comments or attachments. |
| **`415 Unsupported Media Type`**| Non-JSON Content-Type| `"Unsupported Content-Type. Expected 'application/json'."` | Set header `Content-Type: application/json`. |
| **`429 Too Many Requests`**| IP Rate Limit Exceeded | `"Too Many Requests: Client IP rate limit exceeded."` | Read `Retry-After` header and defer dispatches. |
| **`429 Too Many Requests`**| Tenant Burst Exceeded | `"Too Many Requests: Portal delivery rate limit exceeded."` | Read `Retry-After` header and back off. |
| **`500 Internal Server Error`**| Unexpected Runtime Bug | `"An unexpected error occurred while processing lead."` (Sanitized; zero credentials leaked). | Retry with exponential backoff using same `externalEventId`. |
| **`503 Service Unavailable`** | Rate Limiter Unconfigured| `"Service Unavailable: Distributed rate limiting service is unconfigured."` (`Retry-After: 60`). | CRM infrastructure dependency missing. Retry after 60s. |

---

## 10. Idempotency and Duplicate Enquiry Handling

### 10.1 Keyed Deduplication (`STRONG_KEYED`)
- When the portal dispatcher sends an `externalEventId`, Broker CRM constructs an idempotency key:
  $$\text{idempotencyKey} = \text{provider} + \text{"\_"} + \text{externalEventId}$$
- If a delivery with the same `(tenantId, provider, idempotencyKey)` has already been processed within the 90-day retention window, the database rejects insertion via a unique constraint.
- The route catches this constraint, queries the original event, and returns `HTTP 200 OK` with `isDuplicate: true` and the original `leadId` and `enquiryId`.
- **Guarantee:** Zero duplicate leads or inquiries can be created across retries, timeouts, or network replays.

### 10.2 Unkeyed Ingestion (`WEAK_UNKEYED`)
- If the portal omits `externalEventId`, Broker CRM generates an unkeyed receipt key:
  $$\text{receiptKey} = \text{"unkeyed\_"} + \text{UUID}$$
- Legitimate repeat inquiries with identical buyer criteria submitted at different times are accepted and recorded as distinct enquiries under the buyer's lead record.

### 10.3 Tenant-Scoped Buyer Deduplication
- Broker CRM indexes leads by `(tenantId, primaryPhone)`.
- When an inquiry arrives:
  1. If the phone number does **not** exist in the tenant: A new `Lead` (status `NOT_YET_VALIDATED`), `LeadRequirement`, initial `Enquiry`, and round-robin `Assignment` are created.
  2. If the phone number **already exists**: A new `Enquiry` record is appended to the existing `Lead`. The original `Lead.source`, creation date, and requirement profile are preserved.
  3. **Do-Not-Contact (DNC) Protection:** If the existing buyer is marked `isDoNotContact = true`, this protection flag is strictly preserved. Inbound inquiries will be logged in the history, but the buyer will not be re-queued for cold calling.

---

## 11. Provider Integration Responsibilities

External portal engineering teams integrating with Broker CRM must ensure:
1. **Push Protocol Compliance:** Deliver leads via HTTPS `POST` requests to the assigned URL.
2. **Standard Authentication:** Include `Authorization: Bearer <token>` with every delivery.
3. **Payload Formatting:** Send JSON conforming to `enquiry.schema.json`.
4. **Stable Query Identifiers:** Include an immutable, unique query/lead identifier in `externalEventId`.
5. **Backoff and Retry Policy:**
   - On network drop, socket timeout, `500`, or `503`: Retry with exponential backoff using the **exact same `externalEventId`**. Recommended intervals: 5s, 15s, 60s, 300s, 1800s.
   - On `429 Too Many Requests`: Parse the `Retry-After` header (seconds) and pause delivery queue for that duration.
   - On `400 Bad Request` or `401 Unauthorized`: **Halt retries** and alert operations. Retrying will not succeed without administrative intervention.
6. **Payload Size Guard:** Guarantee that payload size does not exceed 256 KB.

---

## 12. CRM Integration Responsibilities

Broker CRM guarantees:
1. **Constant-Time Verification:** Webhook tokens are verified using `crypto.timingSafeEqual` against SHA-256 hashes.
2. **Tenant Scoping:** All operations are strictly sandboxed by `tenantId`. No data from one brokerage is visible or accessible to another.
3. **Transaction Atomicity:** Lead, Requirement, Enquiry, Assignment, and Changelog records are committed within a single atomic PostgreSQL `$transaction`.
4. **Fair Workload Assignment:** New buyers are automatically distributed across active telecallers in balanced round-robin order.
5. **Auditing & Retention:** Raw webhook payloads are preserved in `portal_webhook_events` for 90 days for operational debugging, after which they are purged automatically by a nightly cleanup cron. Core CRM records (`Lead`, `Enquiry`) are preserved indefinitely.

---

## 13. Security Requirements

- **No Cleartext Secrets:** Plaintext webhook tokens are never logged, persisted in application databases, or exposed in error messages.
- **Timing Attack Mitigation:** Token comparison uses constant-time byte buffers (`crypto.timingSafeEqual`), eliminating side-channel timing disclosures.
- **Tenant Isolation:** Inbound tenant identity is determined solely by the database lookup of the token hash. Request payloads or headers cannot specify or spoof `tenantId`.
- **DoS & Memory Protection:** Pre-read `Content-Length` checks and streaming byte counters reject any body over 256 KB before full memory allocation.
- **Information Leakage Prevention:** `HTTP 500` error responses return sanitized, generic messages (`"An unexpected error occurred while processing lead."`). Database connection strings, credentials, and internal stack traces are stripped.
- **PII Data Protection:** Inbound lead contact numbers and names are accessible only to authenticated CRM users. Shared property links and public views mask private contact details.

---

## 14. Rate Limiting and Infrastructure Prerequisites

### 14.1 Two-Tier Sliding Window Limiter
Broker CRM implements distributed rate limiting via Upstash Redis (`@upstash/ratelimit`):
1. **Tier 1 (Pre-Authentication IP Protection):**
   - **Limit:** 60 requests per minute per client IP.
   - **Algorithm:** Sliding window.
   - **Purpose:** Protects endpoint against unauthenticated floods and credential brute-forcing.
2. **Tier 2 (Post-Authentication Tenant Burst Limiter):**
   - **Limit:** 120 requests per minute per authenticated `(tenantId, provider)` pair.
   - **Algorithm:** Sliding window.
   - **Purpose:** Prevents high-volume bulk imports from exhausting application concurrency.

### 14.2 Fail-Safe Policies
- **Pre-Auth Check Failure:** If Redis is unconfigured or unreachable during the pre-auth check, the endpoint **fails closed** with `HTTP 503 Service Unavailable` and header `Retry-After: 60`.
- **Post-Auth Check Failure:** If Redis experiences a transient error after token authentication has succeeded, the endpoint **fails open** with a warning log, ensuring valid customer leads are not dropped due to temporary cache latency.

### 14.3 Infrastructure Dependencies
For distributed rate limiting to function in production, the following environment variables **must** be populated in the production runtime (e.g. Vercel Project Settings):
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

---

## 15. Current Implementation Status

| Component | Implemented in Code? | Automated Tests? | Production Ready? | Current Operational Status |
| :--- | :---: | :---: | :---: | :--- |
| **Inbound Webhook Route Handler** | Yes | 15/15 Pass | Yes | Fully functional (`src/app/api/webhooks/portals/[provider]/route.ts`). |
| **Token Auth & Constant-Time Hash** | Yes | 14/14 Pass | Yes | Fully functional (`src/server/security/portal-tokens.ts`). |
| **Generic Mock Adapter** | Yes | 18/18 Pass | Yes | Fully functional reference implementation (`generic-mock.ts`). |
| **99acres Adapter** | Yes (Draft) | Unit Tested | **No** | **Unverified (`isVerified: false`)**. Fails closed with `HTTP 400`. |
| **Magicbricks Adapter** | Yes (Draft) | Unit Tested | **No** | **Unverified (`isVerified: false`)**. Fails closed with `HTTP 400`. |
| **NoBroker Adapter** | Yes (Draft) | Unit Tested | **No** | **Unverified (`isVerified: false`)**. Fails closed with `HTTP 400`. |
| **Distributed Rate Limiting (Redis)**| Yes | Unit Tested | **Pending Env**| Implemented via Upstash. Returns `503` if env vars omitted. |
| **Core Ingestion DAL (Idempotency)** | Yes | 15/15 Pass | Yes | Fully functional (`src/server/dal/portal-ingestion.ts`). |
| **90-Day Retention Cron** | Yes | 15/15 Pass | **Pending Env**| Implemented (`portal-retention.ts`). Requires `CRON_SECRET`. |
| **Portal Settings UI & Health** | Yes | 14/14 Pass | Yes | Fully functional UI under `/settings/portals`. |

---

## 16. Production Readiness and Outstanding Dependencies

To transition the portal integration from the current development/staging state to live production:

### 1. Database Migrations Status (Confirmed Deployed)
- **Production Supabase Status:** Verified complete. According to the November 17, 2026 production verification audit record, all 10 Prisma migrations (`20261026090118_init` through `20261115100000_add_tenant_portal_configs_and_events`) have been successfully applied to the production Supabase PostgreSQL cluster.
- **Database Objects Live:** The `tenant_portal_configs` and `portal_webhook_events` tables, along with custom enums (`PortalProvider`, `WebhookProcessingStatus`), unique constraints, foreign keys, and indexes, are already fully deployed in production.
- **Deployment Requirement:** No additional database migration deployment (`npx prisma migrate deploy`) is currently required for the existing portal integration schema.
- **Local vs. Production Disambiguation:** The local Docker PostgreSQL environment maintains a separate development migration state (where Migration 10 was not applied locally due to offline Docker status) and must not be confused with the live production Supabase database.

### 2. Environment Variables Configuration
Populate the following production secrets in Vercel:
- `UPSTASH_REDIS_REST_URL`: Upstash Redis instance REST endpoint.
- `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis REST access token.
- `CRON_SECRET`: High-entropy Bearer token to authorize Vercel Cron nightly calls to `/api/cron/cleanup-webhooks`.

### 3. Official Provider Documentation Review
- Secure official API specifications and webhook documentation from 99acres, Magicbricks, and NoBroker.
- Confirm wire format (JSON vs XML), authentication headers, and field aliases.

### 4. Adapter Activation (`isVerified: true`)
- Once sample payloads from each vendor are verified against the unit test suite, toggle `readonly isVerified = true` in `src/server/integrations/portals/adapters/provider-stubs.ts`.

---

## 17. Provider Onboarding Checklist

The project owner must obtain the following information from each portal provider's technical representative:

```markdown
### Portal Onboarding Information Gathering Sheet

Provider Name: [ ] 99acres   [ ] Magicbricks   [ ] NoBroker

1. Integration Architecture & Dispatch Protocol:
   [ ] Real-time HTTP Push Webhook
   [ ] Pull REST API (CRM must poll on an interval)
   [ ] SFTP / FTP CSV Export Batch
   [ ] Email Lead Forwarding

2. Webhook Transport & Wire Format:
   [ ] JSON over HTTPS POST (Content-Type: application/json)
   [ ] XML over HTTPS POST (Content-Type: application/xml)
   [ ] Form-encoded POST (application/x-www-form-urlencoded)

3. Authentication & Security Headers:
   [ ] Custom Bearer Token Header (Authorization: Bearer <token>)
   [ ] Query Parameter Secret (e.g. ?token=...)
   [ ] HTTP Basic Authentication (Username / Password)
   [ ] Webhook HMAC Signature (e.g. X-Portal-Signature-256)
       - If yes, what is the hashing algorithm? (HMAC-SHA256)
       - How is the secret provisioned?

4. Payload Schema & Unique Identifiers:
   [ ] Official JSON / XML Schema documentation provided.
   [ ] Exactly which field contains the unique, immutable Lead/Query ID?
       (e.g., query_id, QueryId, lead_id, event_id)
   [ ] Are multi-listing bulk leads delivered as a single array or individual pushes?
   [ ] How are budget values formatted? (Raw numbers in INR vs text strings like "1.5 Cr")
   [ ] How are property types represented? (String names vs numeric category codes)

5. Retry, Timeouts, and Acknowledgments:
   [ ] What is the dispatch timeout limit? (e.g. 5 seconds, 10 seconds)
   [ ] What retry schedule is used on failure? (e.g. 5 retries with exponential backoff)
   [ ] Does the dispatcher parse and respect the HTTP 429 "Retry-After" response header?
   [ ] What response format is expected on success? (HTTP 200 with JSON vs HTTP 204 No Content)

6. Testing & Sandbox Access:
   [ ] Is a sandbox / staging testing environment provided?
   [ ] Can sample test leads be triggered manually via a partner test console?
   [ ] IP address whitelist / egress CIDR blocks of provider dispatchers (if applicable).

7. Operational & Technical Contacts:
   - Primary Technical Contact Name: _______________________
   - Support / Escalation Email: _______________________
   - Phone / Slack / Teams Channel: _______________________
```

---

## 18. Testing and Acceptance Criteria

Partner engineering teams can test connectivity and validation behavior using `curl`:

### Step 1: Health & Authentication Verification
Send a request without an `Authorization` header:
```bash
curl -i -X POST "https://<broker-domain>/api/webhooks/portals/99acres" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","mobile":"9810011223","city":"Gurugram"}'
```
- **Expected Result:** `HTTP/1.1 401 Unauthorized` with `{ "error": "Missing Authorization header." }`.

### Step 2: Unverified Adapter Guard Verification
Send a valid request with an authorized Bearer token:
```bash
curl -i -X POST "https://<broker-domain>/api/webhooks/portals/99acres" \
  -H "Authorization: Bearer <valid_token>" \
  -H "Content-Type: application/json" \
  -d @sample-enquiry.json
```
- **Expected Result:** `HTTP/1.1 400 Bad Request` with:
  ```json
  {
    "error": "Provider integration for 'NINETY_NINE_ACRES' is unverified. Webhook ingestion is disabled pending official partner API documentation."
  }
  ```
  *(Confirms that networking, SSL, token verification, and fail-closed guards are operating correctly).*

### Step 3: Payload Validation Testing
Send an invalid mobile number or negative budget:
```bash
curl -i -X POST "https://<broker-domain>/api/webhooks/portals/99acres" \
  -H "Authorization: Bearer <valid_token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Aman","mobile":"12345","city":"Gurugram"}'
```
- **Expected Result:** `HTTP/1.1 400 Bad Request` with descriptive validation error.

### Step 4: Disallowed HTTP Methods
Attempt a `GET` request:
```bash
curl -i -X GET "https://<broker-domain>/api/webhooks/portals/99acres"
```
- **Expected Result:** `HTTP/1.1 405 Method Not Allowed` with response header `Allow: POST`.

---

## 19. Official Provider Specification Requirements

The following specific questions must be resolved with each vendor before their adapter can be verified and activated:

### 1. 99acres (Info Edge)
- **Question 1:** Does 99acres deliver leads via HTTPS push webhooks, or does the broker CRM need to poll their "Query API" periodically using an API Key?
- **Question 2:** If webhooks are used, is the payload serialized as JSON or XML?
- **Question 3:** What is the exact casing of the query identifier (`QueryId`, `query_id`, or `lead_id`)?
- **Question 4:** Does the 99acres webhook dispatcher support standard HTTP `Authorization: Bearer <token>` headers, or are credentials passed as query string parameters?

### 2. Magicbricks (Times Internet)
- **Question 1:** What lead delivery mechanism is authorized for the broker's account tier (Push Webhook, Polling API, or FTP CSV)?
- **Question 2:** Does Magicbricks deliver property categories as string names (e.g. "Multistorey Apartment") or numeric IDs (e.g. `10002`)?
- **Question 3:** How is the consumer budget transmitted? Are separate minimum and maximum numbers provided, or a combined text string (e.g. "50 Lac - 1 Cr")?

### 3. NoBroker
- **Question 1:** What is the primary transaction preference for leads delivered? (Historic stubs defaulted to `RENT`; does NoBroker push resale buyer leads under the same webhook)?
- **Question 2:** Where are structured budget ranges and BHK preferences stored? Are they discrete JSON properties or combined within the enquiry comments string?
- **Question 3:** Does NoBroker require webhook signature verification (`X-NoBroker-Signature`) using a shared secret?

---

## 20. Contact and Handover Notes

### Project Contacts
- **Project Owner / Business Lead:** [Insert Project Owner Name & Contact]
- **Broker CRM Technical Integration Team:** Core Engineering Team (`C:\Users\divya\Desktop\Broker-CRM`)
- **Integration Package Documentation Path:** `docs/integrations/portals/`

### Package Inventory
- [`HANDOVER.md`](./HANDOVER.md) — Comprehensive technical handover and operational manual (this document).
- [`README.md`](./README.md) — Architecture overview, quick start, and package inventory.
- [`integration-guide.md`](./integration-guide.md) — Step-by-step developer guide for portal engineering teams.
- [`provider-field-mapping.md`](./provider-field-mapping.md) — Field alias mappings and draft stub analysis.
- [`openapi.yaml`](./openapi.yaml) — OpenAPI 3.1 specification.
- [`enquiry.schema.json`](./enquiry.schema.json) — JSON Schema (Draft 2020-12) validation standard.
- [`sample-enquiry.json`](./sample-enquiry.json) — Reference JSON payload example.

### Key Codebase References for Developers
- Webhook Route Handler: `src/app/api/webhooks/portals/[provider]/route.ts`
- Core Ingestion DAL: `src/server/dal/portal-ingestion.ts`
- Token Management & Cryptography: `src/server/security/portal-tokens.ts`
- Rate Limiting Service: `src/server/security/portal-rate-limiter.ts`
- Retention Cleanup Engine: `src/server/dal/portal-retention.ts`
- Retention Cron Route: `src/app/api/cron/cleanup-webhooks/route.ts`
- Provider Adapter Registry & Stubs: `src/server/integrations/portals/`
- Portal Settings UI: `src/app/settings/portals/PortalSettingsClient.tsx`
