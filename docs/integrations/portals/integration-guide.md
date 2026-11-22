# External Portal Webhook Integration Guide

> [!WARNING]
> **DRAFT INTEGRATION GUIDE — PENDING PARTNER VERIFICATION**  
> This guide is an engineering draft prepared by the Broker CRM team for technical integration partners. Real provider webhook routes (`99acres`, `magicbricks`, `nobroker`) currently fail closed with `HTTP 400 Bad Request` until official partner documentation, API keys, and verified sample payloads are provided.
> 
> The payload schema and request/response specifications documented below reflect the **canonical Generic Mock contract** implemented in the Broker CRM core ingestion engine.

---

## 1. Quick Reference

| Parameter | Specification |
| :--- | :--- |
| **Protocol** | HTTPS POST |
| **Endpoint Format** | `https://<broker-domain>/api/webhooks/portals/{provider}` |
| **Supported Providers** | `99acres`, `magicbricks`, `nobroker` |
| **Authentication** | `Authorization: Bearer <64-character-hex-token>` |
| **Content-Type** | `application/json; charset=utf-8` |
| **Maximum Body Size** | 256 KB (262,144 bytes) |
| **Tier 1 Rate Limit** | 60 requests/minute per client IP |
| **Tier 2 Rate Limit** | 120 requests/minute per tenant/provider |

---

## 2. Authentication & Request Headers

Every webhook dispatch must include the following HTTP headers:

```http
POST /api/webhooks/portals/99acres HTTP/1.1
Host: <broker-domain>
Authorization: Bearer 3c9b7a4e8d2f1056c7a8e9b0d1f234567890abcdef1234567890abcdef123456
Content-Type: application/json
Content-Length: 428
```

### Header Specifications

1. **`Authorization: Bearer <token>` (Required)**
   - The token is a 64-character hex string (256 bits of entropy) provisioned by the subscribing brokerage via the Broker CRM web application (`/settings/portals`).
   - Plaintext tokens are displayed **only once** upon generation. Broker CRM stores only the `SHA-256` hash.
   - Tokens are tenant-scoped and provider-specific. A token generated for 99acres cannot be used to submit leads to `/api/webhooks/portals/magicbricks` (returns `HTTP 401`).
2. **`Content-Type: application/json` (Required)**
   - Must be `application/json`. XML, SOAP, or multipart form data will return `HTTP 415 Unsupported Media Type`.
3. **`Content-Length` (Recommended)**
   - Must accurately reflect body size. Requests indicating or delivering over 256 KB return `HTTP 413 Payload Too Large`.

---

## 3. Webhook Delivery Payload

The payload must be a JSON object conforming to [`enquiry.schema.json`](./enquiry.schema.json).

### Recommended Full Payload Example

```json
{
  "externalEventId": "99a_lead_20261120_001",
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
  "advertisedPropertyRef": "prop_listing_9912",
  "enquiryNotes": "Buyer is seeking a ready-to-move 3 BHK apartment near the metro."
}
```

### Minimal Required Payload

```json
{
  "name": "Pooja Sharma",
  "mobile": "9876543210",
  "city": "Noida",
  "preference": "RENT"
}
```

### Field Descriptions

- **`externalEventId` (Recommended for Idempotency):** The portal's unique query or enquiry ID. When present, Broker CRM enforces strong deduplication. Retried requests with the same ID return `isDuplicate: true` without creating redundant leads.
- **`name` (Required):** Full name of the consumer submitting the query.
- **`mobile` (Required):** Consumer's primary mobile phone. Must resolve to a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9. The schema pattern (`^(?:(?:\+?91|0)[\s\-\.]?)?[6-9]\d{4}[\s\-\.]?\d{5}$`) accepts standard unseparated 10 digits (`9810011223`), country prefix (`+91`, `91`) or trunk prefix (`0`), and optional 5-digit block spacing (`+91 98100 11223`, `+91-9810011223`). *(Note: At runtime, `normalizeIndianMobile()` further tolerates parentheses and dots, but callers are advised to format per schema).*
- **`city` (Required):** Target property search city.
- **`preference` (Optional, defaults to SALE):** Transaction preference. Canonical values are `"SALE"` (Buy) and `"RENT"`. Synonyms (`"BUY"`, `"PURCHASE"`, `"RENTAL"`) are normalized automatically. Defaults to `"SALE"` if omitted in generic ingestion. *(Note: In the unverified NoBroker stub adapter, omitted preferences default to `"RENT"`).*
- **`minBudget` / `maxBudget` (Optional):** Budget in INR (e.g. `15000000` for 1.5 Crores). If both are provided, `maxBudget` must be greater than or equal to `minBudget` (strictly enforced server-side; requests with `maxBudget < minBudget` return `HTTP 400 Bad Request`).
- **`propertyType` (Optional):** One of `"APARTMENT"`, `"INDEPENDENT_HOUSE"`, `"VILLA"`, `"BUILDER_FLOOR"`, `"PLOT"`, `"COMMERCIAL"`, `"OTHER"`.
- **`bedroomConfiguration` (Optional):** Bedroom configuration string (e.g. `"2 BHK"`, `"3 BHK"`).
- **`advertisedPropertyRef` (Optional):** Portal's listing reference ID.
- **`enquiryNotes` (Optional):** Consumer enquiry text or portal filter details.

---

## 4. Responses & Status Codes

Broker CRM returns structured JSON responses for all requests.

### Success Response (`HTTP 200 OK`)

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

### Response Field Meanings
- **`isDuplicate: true`:** The delivery was already processed previously using the provided `externalEventId`. The existing record IDs are returned; no action was repeated.
- **`isExistingBuyer: true`:** A buyer with this phone number already exists in the brokerage. A new `Enquiry` was appended to their existing `Lead` profile without altering original source attribution or DNC status.
- **`deduplicationGuarantee`:** `"STRONG_KEYED"` when `externalEventId` is supplied; `"WEAK_UNKEYED"` when omitted.

---

## 5. Error Handling & Troubleshooting

| HTTP Status | Reason | Partner Action |
| :--- | :--- | :--- |
| **`400 Bad Request`** | Validation failure (invalid mobile, missing required fields, or unverified provider). | Check the `error` message in the response. Do NOT retry without fixing payload. |
| **`401 Unauthorized`** | Missing, malformed, or invalid Bearer token; provider mismatch; or integration disabled. | Verify the configured token with the brokerage. Do NOT retry until token is confirmed. |
| **`404 Not Found`** | Unknown provider route parameter. | Check route spelling (`/api/webhooks/portals/99acres`, `/magicbricks`, `/nobroker`). |
| **`405 Method Not Allowed`** | Request method was not POST. | Ensure dispatcher uses `POST`. |
| **`413 Payload Too Large`** | Body exceeds 256 KB. | Truncate large embedded attachments or notes under 256 KB before sending. |
| **`415 Unsupported Media Type`** | Header is not `application/json`. | Set `Content-Type: application/json`. |
| **`429 Too Many Requests`** | Rate limit exceeded. | Read the `Retry-After` header (seconds) and pause delivery queue accordingly. |
| **`500 Internal Error`** | Temporary database or runtime failure. | Retry with exponential backoff using the same `externalEventId`. |
| **`503 Service Unavailable`** | Infrastructure dependency unconfigured. | Retry with exponential backoff after 60 seconds. |

---

## 6. Retries & Idempotency Best Practices

To guarantee zero duplicate leads during network failures or server restarts:

1. **Always Supply `externalEventId`:**
   - Include your internal enquiry or query ID in `externalEventId`.
   - Broker CRM uses this identifier to build an idempotency key: `{provider}_{externalEventId}`.
2. **Safe Retries:**
   - If your delivery encounters a timeout, connection drop, `500 Internal Error`, or `503 Service Unavailable`, retry the request with the **exact same `externalEventId`**.
   - If the previous delivery succeeded before the network failed, the retried request will return `HTTP 200 OK` with `isDuplicate: true`, guaranteeing safe idempotency.
3. **Handling Rate Limits (`HTTP 429`):**
   - The response includes a `Retry-After: <seconds>` header.
   - Defer subsequent dispatches for the duration indicated before resuming.
4. **Exponential Backoff:**
   - Recommended schedule: 5s, 15s, 60s, 300s, 1800s.

---

## 7. Testing Instructions (Sandbox Verification)

Until official vendor integrations are verified in production:

1. **Verify Token & Endpoint Accessibility:**
   ```bash
   # Replace <broker-domain> with your brokerage instance hostname (e.g. crm.yourbrokerage.com or http://localhost:3000 for local test)
   curl -X POST "https://<broker-domain>/api/webhooks/portals/99acres" \
     -H "Authorization: Bearer <valid_token>" \
     -H "Content-Type: application/json" \
     -d @sample-enquiry.json
   ```
2. **Observe Unverified Adapter Block:**
   The endpoint will return:
   ```json
   {
     "error": "Provider integration for 'NINETY_NINE_ACRES' is unverified. Webhook ingestion is disabled pending official partner API documentation."
   }
   ```
   *(This confirms that authentication and routing succeeded, and the fail-closed protection guard is active).*

---

## 8. Production Onboarding Checklist

- [ ] Webhook URL confirmed: `https://<broker-domain>/api/webhooks/portals/{provider}`
- [ ] Bearer token generated by broker in `/settings/portals` and securely configured in portal dispatcher.
- [ ] Payload format validated against [`enquiry.schema.json`](./enquiry.schema.json).
- [ ] Indian mobile normalization verified (`10-digit numeric`, starts with `6-9`).
- [ ] Stable query ID mapped to `externalEventId` for idempotency.
- [ ] Rate limits respected (max 60 req/min per IP, 120 req/min per tenant).
- [ ] `Retry-After` header parsing implemented for `429` responses.
- [ ] Production payload samples submitted to Broker CRM engineering team to mark adapter `isVerified: true`.
