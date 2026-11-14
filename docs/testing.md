# Testing Strategy & Database Integration Guide

This document defines the dual-tier testing architecture for Broker CRM:
1. **Unit & Fast Mocked Tests (`npm test`)**
2. **Isolated PostgreSQL Integration Tests (`npm run test:integration`)**

---

## 1. Architecture Overview

Broker CRM enforces a strict boundary between unit and integration test suites:

| Category | Command | Target | Mocking | Count | Speed |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Unit Tests** | `npm test` | In-memory / V8 | Mocked Prisma (`vitest-mock-extended`) | 591 tests | ~10s |
| **Integration Tests** | `npm run test:integration` | Real PostgreSQL 16 (`broker_crm_test`) | None (Live DB queries & transactions) | 23 tests | ~4s |

### Isolation Principles
- **No Shared State:** Unit tests run entirely in-memory and never attempt database network connections.
- **Dedicated Test Database:** Integration tests run exclusively against a dedicated local database (`broker_crm_test`).
- **Untouched Development Database:** The development database (`broker_crm`) is never read, modified, or truncated by integration tests.
- **Zero Cloud Exposure:** Tests are forbidden from connecting to remote cloud services (Supabase, Vercel, Neon, AWS, etc.).

---

## 2. Dedicated Local Test Database Setup

Integration tests require the local Docker PostgreSQL 16 container (`broker-crm-postgres`) running on port `5433`.

### Environment Configuration
The database URL is configured via `TEST_DATABASE_URL` in `.env`:

```env
# Dedicated isolated integration test database (port 5433)
TEST_DATABASE_URL="postgresql://broker_admin:Docker_Dkashyap04@localhost:5433/broker_crm_test?schema=public"
```

A template is maintained in `.env.test.example`.

### Initialization Workflow

1. **Verify Connection & Safety Guard:**
   ```bash
   npm run test:db:verify
   ```
   Validates the URL parameters and performs a runtime SQL handshake asserting `current_database() === 'broker_crm_test'`.

2. **Automated Setup & Migration Deployment:**
   ```bash
   npm run test:db:setup
   ```
   Automatically provisions `broker_crm_test` if missing and applies all Prisma migrations (`npx prisma migrate deploy`).

### Applied Migrations Inventory
The integration test database (`broker_crm_test`) applies the exact 9 migrations present in `prisma/migrations/`:
1. `20261026090118_init` — Phase 1 base schema (tenants, users, sessions, accounts, verifications)
2. `20261026150051_add_team_hierarchy_and_user_audit` — Team leader hierarchy & audit logs
3. `20261026164155_add_broker_hierarchy_and_tenant_seats` — Broker hierarchy and tenant seat limits
4. `20261027062624_add_owner_willingness_confirmed` — Owner willingness field
5. `20261027102908_add_property_media_uploader` — Property media uploader relations
6. `20261027132038_add_field_verification` — Field verification lifecycle models
7. `20261106092016_add_demand_validation_lead_and_area_fields` — Demand management & lead models
8. `20261113050214_add_property_validated_at` — Property validation timestamp
9. `20261113172720_add_lead_requirement_confirmed_at` — Lead requirement confirmation fields

---

## 3. Fail-Closed Database Safety Guard

To prevent catastrophic data loss or accidental testing against production/development environments, every integration test run executes through a runtime fail-closed safety guard (`tests/integration/setup/db-guard.ts`):

### Enforced Rules
1. **Exclusively `TEST_DATABASE_URL`:** The runner strictly rejects reading from `DATABASE_URL` or `DIRECT_URL`.
2. **Local Host Only:** Hostname must be strictly `localhost` or `127.0.0.1`.
3. **Dedicated Port Only:** Port must be strictly `5433`.
4. **Target Name Restriction:** Database name must strictly equal `broker_crm_test`. Target `broker_crm` or any other database raises a fatal error immediately.
5. **Remote/Cloud Keyword Rejection:** Any URL containing `supabase`, `neon`, `vercel`, `pooler`, `aws`, `azure`, or `rds` is aborted before any connection attempt.
6. **Runtime SQL Handshake:** Before executing any test queries, the harness runs:
   ```sql
   SELECT current_database(), inet_server_addr(), inet_server_port();
   ```
   If `current_database() !== 'broker_crm_test'`, the process exits with an error.

---

## 4. Test Fixtures & Multi-Tenant Teardown

All test data is scoped to dynamically generated test tenants created via `tests/integration/helpers/tenant-helper.ts`:

```typescript
const fixture = await createTestTenant(prisma, "Tenant Label");
// ... run tests ...
await fixture.cleanup();
```

### Reverse Foreign-Key Dependency Cleanup
PostgreSQL enforces `onDelete: Restrict` on critical relations (e.g., `User` records referenced in `CallLog` or `SiteVisitItem`). The `fixture.cleanup()` function cleanly deletes child entities in strict dependency order:
1. Operational Visit Records: `SiteVisitItem`, `SiteVisitAccessLink`, `SiteVisitScheduleHistory`, `SiteVisit`
2. Feedback & Activities: `BuyerPropertyInterest`, `CallLog`, `Assignment`
3. Supply Records: `PropertyVerification`, `PropertyMedia`, `KeyHolder`, `Property`
4. Demand Records: `Enquiry`, `LeadRequirementLocality`, `LeadRequirement`, `LeadChangeLog`, `Lead`
5. User Records: `UserAuditLog`, `Session`, `User`
6. Master Data & Tenant: `Locality`, `Tenant`

---

## 5. Integration Test Suites Inventory

Located in `tests/integration/`:

### A. Constraints & Referential Integrity (`constraints.integration.test.ts`)
- Foreign key violation rejection (`P2003` on orphan `tenantId`).
- Tenant-scoped buyer mobile uniqueness (`P2002` on duplicate `primaryPhone` within the same tenant).
- Cross-tenant buyer mobile allowance (same mobile number in multiple brokerages without collision).
- Composite locality uniqueness (`P2002` on duplicate `[tenantId, city, name]`).
- Composite `SiteVisitItem` uniqueness (`P2002` on duplicate `[tenantId, siteVisitId, propertyId]`).
- Global token hash uniqueness (`P2002` on `tokenHash`).
- Cascade deletion verification (`SiteVisit` deletion deletes child items, links, and history).
- Restrictive deletion verification (deleting a `User` with existing `CallLog` fails with `P2003`).

### B. Multi-Tenancy & Tenant Boundary Enforcement (`multi-tenancy.integration.test.ts`)
- Query isolation: Tenant A cannot read Tenant B's leads via DAL or direct queries (`NotFoundError`).
- List isolation: Tenant A's lead list contains 0 records belonging to Tenant B.
- Mutation isolation: Tenant A cannot update Tenant B's leads (`NotFoundError`).
- Cross-tenant duplicate allowance: Simultaneous co-existence of identical buyer contacts across tenants.
- Visit query isolation: Tenant A cannot fetch Tenant B's site visits (`NotFoundError`).
- Cross-tenant property scheduling prevention: Scheduling a visit in Tenant A with Tenant B's property is rejected (`ValidationError`).
- Visit list isolation: `listSiteVisits` strictly scopes results to the caller's tenant.
- Feedback isolation: `BuyerPropertyInterest` records are strictly partition-scoped per tenant.

### C. Database Transactions & Atomicity (`transactions.integration.test.ts`)
- Generic complete rollback: Unhandled errors inside `$transaction` guarantee zero partial writes in PostgreSQL.
- Finalization atomicity (`confirmSiteVisit`): Atomically updates status to `COMPLETED`, revokes active access links, and synchronizes `BuyerPropertyInterest`.
- Finalization failure rollback (`confirmSiteVisit`): Injected failure during `BuyerPropertyInterest` upsert causes PostgreSQL rollback — visit status remains `CONFIRMED`, access link remains active/unrevoked, and zero interest records persist.
- Reschedule atomicity (`rescheduleSiteVisit`): Atomically updates scheduled date, revokes access links, and appends `SiteVisitScheduleHistory`.
- Reschedule failure rollback (`rescheduleSiteVisit`): Injected failure during `SiteVisitScheduleHistory` insert causes PostgreSQL rollback — scheduled date remains original, access link remains active/unrevoked, and zero history records persist.
- Agent reassignment atomicity (`reassignSiteVisitAgent`): Atomically updates `assignedSalesAgentId` and revokes prior agent's links.
- Cancellation atomicity (`cancelSiteVisit`): Atomically updates status to `CANCELLED`, revokes active links, and appends `SiteVisitScheduleHistory`.

---

## 6. Running Quality Gates

Before submitting any milestone or phase, run the full verification pipeline:

```bash
# 1. Prisma schema validation
npx prisma validate

# 2. TypeScript compilation check
npx tsc --noEmit

# 3. Next.js / ESLint code quality check
npm run lint

# 4. Fast mocked unit regression suite (591 tests)
npm test

# 5. Database safety verification
npm run test:db:verify

# 6. Isolated PostgreSQL integration tests (23 tests)
npm run test:integration

# 7. Next.js production build check
npm run build
```
