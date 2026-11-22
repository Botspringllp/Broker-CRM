# External Portal Provider Field Mappings & Draft Specification Analysis

> [!WARNING]
> **DRAFT / PROVISIONAL FIELD MAPPING SPECIFICATION**  
> The field mappings documented in this file are provisional reverse-engineered mappings extracted from the Broker CRM draft adapter codebase (`src/server/integrations/portals/adapters/provider-stubs.ts`).
> 
> **These mappings have NOT been officially verified against partner production specifications.** All three adapters currently specify `readonly isVerified = false` and fail closed (`HTTP 400`) at the webhook route until verified partner documentation and payload samples are confirmed.

---

## 1. Overview of Canonical Target Model

Regardless of portal-specific wire naming, the Broker CRM core ingestion engine maps all incoming payloads to the `NormalizedPortalLead` contract defined in `src/server/integrations/portals/types.ts`:

| Canonical Field | Type | Mandatory? | Description |
| :--- | :--- | :---: | :--- |
| `provider` | `PortalProvider` | Yes | Enum: `NINETY_NINE_ACRES`, `MAGICBRICKS`, `NOBROKER`. |
| `externalEventId` | `string \| null` | No | External portal query/lead ID used for strong idempotency. |
| `name` | `string` | **Yes** | Prospect full name. |
| `mobile` | `string` | **Yes** | 10-digit Indian mobile number (`^[6-9]\d{9}$`). Normalized via `normalizeIndianMobile()`. |
| `email` | `string \| null` | No | Prospect email address. |
| `city` | `string` | **Yes** | Target search city. |
| `locality` | `string \| null` | No | Locality or sector name. |
| `preference` | `TransactionType` | **Yes (Internal)** | Always resolved to `SALE` or `RENT`. Optional in wire payload: defaults to `SALE` (Generic, 99acres, Magicbricks) or `RENT` (NoBroker). |
| `minBudget` | `number \| null` | No | Minimum budget in INR. |
| `maxBudget` | `number \| null` | No | Maximum budget in INR. |
| `propertyType` | `PropertyType \| null` | No | Property category enum (`APARTMENT`, `VILLA`, etc.). |
| `bedroomConfiguration`| `string \| null` | No | BHK string (e.g. `"2 BHK"`, `"3 BHK"`). |
| `advertisedPropertyRef`| `string \| null` | No | Portal property/listing identifier. |
| `enquiryNotes` | `string \| null` | No | Free-form enquiry comments and criteria details. |
| `rawPayload` | `unknown` | No | Preserved JSON payload stored in `portal_webhook_events`. |

---

## 2. 99acres Field Mapping Analysis

**Adapter Class:** `NinetyNineAcresAdapter`  
**Source Location:** `src/server/integrations/portals/adapters/provider-stubs.ts` (Lines 21–194)  
**Verification Status:** `isVerified = false` (Unverified Draft)  

### Current Implemented Field Extraction

| Canonical Field | Accepted Code-Level Field Aliases | Implementation Details |
| :--- | :--- | :--- |
| `externalEventId` | `externalEventId`, `query_id`, `QueryId`, `queryId`, `lead_id` | Priority order: `externalEventId` $\rightarrow$ `query_id` $\rightarrow$ `QueryId` $\rightarrow$ `queryId` $\rightarrow$ `lead_id`. Stringified and trimmed. |
| `name` | `name`, `buyer_name`, `User_Name` | Priority order: `name` $\rightarrow$ `buyer_name` $\rightarrow$ `User_Name`. Throws 400 if empty. |
| `mobile` | `mobile`, `phone`, `User_Mobile` | Normalized via `normalizeIndianMobile()`. Throws 400 if missing or invalid. |
| `city` | `city`, `City_Name` | Trimmed string. Throws 400 if missing. |
| `preference` | `preference`, `type` | If value contains `"RENT"`, maps to `TransactionType.RENT`; otherwise defaults to `TransactionType.SALE`. |
| `email` | `email`, `User_Email` | Trimmed and lowercased. Stored as null if empty. |
| `locality` | `locality`, `Locality_Name` | Trimmed string or null. |
| `advertisedPropertyRef` | `prop_id`, `Property_ID`, `advertisedPropertyRef` | Trimmed listing identifier or null. |
| `enquiryNotes` | `query_message`, `message`, `enquiryNotes` | Free-form prospect query text. |
| `minBudget` / `maxBudget` | `minBudget`, `maxBudget` | Numeric conversion; must be $\ge 0$. |
| `propertyType` | `propertyType` | Matched against Prisma `PropertyType` enum values. |
| `bedroomConfiguration` | `bedroomConfiguration`, `bhk` | Trimmed string or null. |

### Unresolved Vendor Assumptions & Missing Documentation
1. **Wire Transport & Serialization:** Real 99acres lead integrations historically employ XML-over-HTTP or form-encoded POST requests rather than JSON. Confirmation is required from 99acres technical integration documentation.
2. **Field Names & Casing:** Real 99acres query pushes often use PascalCase (e.g. `Query_Id`, `User_Name`, `Query_Date`) or underscore separated lower-case (`query_id`).
3. **Authentication Mechanism:** It is unknown whether 99acres supports custom `Authorization: Bearer <token>` headers or requires query string API keys (`?api_key=...`) or basic HTTP authentication.
4. **Signature Verification:** 99acres webhook dispatchers may include an HMAC signature header that is not yet handled.

---

## 3. Magicbricks Field Mapping Analysis

**Adapter Class:** `MagicbricksAdapter`  
**Source Location:** `src/server/integrations/portals/adapters/provider-stubs.ts` (Lines 203–366)  
**Verification Status:** `isVerified = false` (Unverified Draft)  

### Current Implemented Field Extraction

| Canonical Field | Accepted Code-Level Field Aliases | Implementation Details |
| :--- | :--- | :--- |
| `externalEventId` | `externalEventId`, `id`, `lead_id`, `queryid` | Priority order: `externalEventId` $\rightarrow$ `id` $\rightarrow$ `lead_id` $\rightarrow$ `queryid`. Stringified and trimmed. |
| `name` | `name`, `lead_name` | Priority order: `name` $\rightarrow$ `lead_name`. Throws 400 if missing. |
| `mobile` | `mobile`, `phone`, `contact_number` | Normalized via `normalizeIndianMobile()`. Throws 400 if missing or invalid. |
| `city` | `city`, `city_name` | Trimmed string. Throws 400 if missing. |
| `preference` | `preference`, `trans_type` | If value contains `"RENT"`, maps to `TransactionType.RENT`; otherwise defaults to `TransactionType.SALE`. |
| `email` | `email` | Trimmed and lowercased or null. |
| `locality` | `locality`, `locality_name` | Trimmed string or null. |
| `advertisedPropertyRef` | `property_id`, `mb_prop_id` | Trimmed listing identifier or null. |
| `enquiryNotes` | `comments`, `enquiryNotes` | Prospect comment text or null. |
| `minBudget` / `maxBudget` | `minBudget`, `maxBudget` | Numeric conversion; must be $\ge 0$. |
| `propertyType` | `propertyType` | Matched against Prisma `PropertyType` enum values. |
| `bedroomConfiguration` | `bedroomConfiguration`, `bhk` | Trimmed string or null. |

### Unresolved Vendor Assumptions & Missing Documentation
1. **Push vs. Pull Protocol:** Many Magicbricks broker tiers use pull-based lead APIs (REST endpoint polling by the CRM) or FTP CSV batch drops rather than real-time inbound push webhooks. We must verify if real-time push webhooks are offered for the target broker account tier.
2. **Budget Representation:** Magicbricks often delivers budget as combined range strings (e.g. `"budget": "1 Cr to 1.5 Cr"` or `"budget_min": "10000000"`) rather than pure numeric values.
3. **Property Categorization:** Magicbricks uses numeric property type codes (e.g. `101 = Multistorey Apartment`, `102 = Builder Floor`) that require an explicit translation table.
4. **Header Authentication:** Confirmation is required whether Magicbricks' dispatcher supports custom HTTP Authorization headers.

---

## 4. NoBroker Field Mapping Analysis

**Adapter Class:** `NoBrokerAdapter`  
**Source Location:** `src/server/integrations/portals/adapters/provider-stubs.ts` (Lines 375–502)  
**Verification Status:** `isVerified = false` (Unverified Draft)  

### Current Implemented Field Extraction

| Canonical Field | Accepted Code-Level Field Aliases | Implementation Details |
| :--- | :--- | :--- |
| `externalEventId` | `externalEventId`, `event_id`, `enquiry_id`, `lead_id` | Priority order: `externalEventId` $\rightarrow$ `event_id` $\rightarrow$ `enquiry_id` $\rightarrow$ `lead_id`. Stringified and trimmed. |
| `name` | `name`, `user_name` | Priority order: `name` $\rightarrow$ `user_name`. Throws 400 if missing. |
| `mobile` | `phone`, `mobile`, `user_phone` | Priority order: `phone` $\rightarrow$ `mobile` $\rightarrow$ `user_phone`. Normalized via `normalizeIndianMobile()`. Throws 400 if missing or invalid. |
| `city` | `city`, `city_name` | Trimmed string. Throws 400 if missing. |
| `preference` | `preference`, `rent_or_sale` | If string contains `"SALE"` or `"BUY"`, maps to `SALE`; otherwise **defaults to `RENT`** (reflecting NoBroker's rental heritage). Note: Values like `"PURCHASE"` that lack `"SALE"` or `"BUY"` map to `RENT` in the current draft stub. |
| `email` | `email` | Trimmed and lowercased or null. |
| `locality` | `locality` | Trimmed string or null. |
| `advertisedPropertyRef` | `property_id` | Trimmed property ID or null. |
| `enquiryNotes` | `message`, `enquiryNotes` | Free-form enquiry notes. |

### Unresolved Vendor Assumptions & Missing Documentation
1. **Default Transaction Preference:** Current code defaults NoBroker leads to `TransactionType.RENT` if unspecified. While appropriate for historical NoBroker rental flows, modern NoBroker resale/buyer leads may default incorrectly if the payload omits transaction type.
2. **Authentication & Security:** Need confirmation on NoBroker's webhook delivery security standard (Bearer token vs. shared secret query parameter vs. webhook HMAC signature).
3. **Budget & BHK Parsing:** NoBroker stubs currently omit `minBudget`, `maxBudget`, and `bedroomConfiguration` extraction, expecting them only inside `enquiryNotes`. The partner specification must clarify how structured requirement filters are pushed.

---

## 5. Comparison: Existing Code Stubs vs. Production-Ready Requirements

| Dimension | Existing Code Stubs (Stage 3B) | Production Integration Requirement |
| :--- | :--- | :--- |
| **Verification Gate** | `isVerified: false` $\rightarrow$ Fails closed with 400 | Set `isVerified: true` once partner documentation is confirmed. |
| **Payload Schemas** | Heuristic guesses with multiple fallback aliases | Strict mapping to confirmed JSON/XML property paths. |
| **Authentication Transport**| Exclusively `Authorization: Bearer <token>` | Support vendor-mandated auth format (e.g. query param tokens, custom headers, or basic auth). |
| **Signature Verification** | None | Implement HMAC-SHA256 signature verification if required by vendor. |
| **Error Handling** | Generic validation error strings | Return vendor-compliant acknowledgment formats if expected. |
| **Currency / Budget Parsing**| Numeric INR only (`15000000`) | Parser needed for Indian numbering text (`"1.5 Cr"`, `"45 L"`). |

---

## 6. Action Items to Finalize Provider Contracts

1. **Obtain Official Documentation:** Secure the official API / Webhook Developer Guides from:
   - 99acres Developer Support
   - Magicbricks Integration Support
   - NoBroker Business API Support
2. **Review Sample Payloads:** Collect 3–5 real sanitized payload samples from active production feeds for each vendor.
3. **Update Stubs:** Update `provider-stubs.ts` with confirmed field paths and unit test fixtures in `tests/unit/portal-adapters.test.ts`.
4. **Activate Adapters:** Toggle `readonly isVerified = true` in each adapter class once verified.
