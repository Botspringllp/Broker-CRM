import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { PortalProvider, LeadStatus } from "@prisma/client";
import {
  POST,
  GET,
  PUT,
  DELETE,
  resolveRoutePortalProvider,
  readJsonBodyWithSizeLimit,
  authenticatePortalWebhook,
  getClientIp,
  MAX_WEBHOOK_BODY_BYTES,
} from "@/app/api/webhooks/portals/[provider]/route";
import {
  setWebhookRateLimiter,
  resetWebhookRateLimiter,
  createMockRateLimiter,
} from "@/server/security/portal-rate-limiter";
import {
  getPortalAdapter,
  registerPortalAdapter,
  resetPortalAdapters,
} from "@/server/integrations/portals/registry";
import { GenericMockPortalAdapter } from "@/server/integrations/portals/adapters/generic-mock";
import {
  hashWebhookToken,
} from "@/server/security/portal-tokens";
import { prisma } from "@/server/db";
import * as portalIngestionModule from "@/server/dal/portal-ingestion";

describe("Public Inbound Portal Webhook Route: Unit Tests (Stage 3B)", () => {
  const mockTenantId = "tenant-alpha-uuid";
  const mockRawToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const mockTokenHash = hashWebhookToken(mockRawToken);

  const mockDbConfig = {
    id: "cfg-alpha-99",
    tenantId: mockTenantId,
    provider: PortalProvider.NINETY_NINE_ACRES,
    isEnabled: true,
    webhookTokenHash: mockTokenHash,
    tokenCreatedAt: new Date(),
    tokenRotatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    resetPortalAdapters();
    // Default test rate limiter: configured and permissive
    setWebhookRateLimiter(
      createMockRateLimiter({ configured: true, ipAllowed: true, tenantAllowed: true })
    );

    // Default DB mock: returns active 99acres config for mockTokenHash
    vi.spyOn(prisma.tenantPortalConfig, "findFirst").mockImplementation(((args?: { where?: { webhookTokenHash?: string } }) => {
      if (args?.where?.webhookTokenHash === mockTokenHash) {
        return Promise.resolve(mockDbConfig) as unknown as ReturnType<typeof prisma.tenantPortalConfig.findFirst>;
      }
      return Promise.resolve(null) as unknown as ReturnType<typeof prisma.tenantPortalConfig.findFirst>;
    }) as unknown as typeof prisma.tenantPortalConfig.findFirst);
  });

  afterEach(() => {
    resetPortalAdapters();
    resetWebhookRateLimiter();
    vi.restoreAllMocks();
  });

  function createRequest(options: {
    body?: unknown;
    rawBody?: string;
    token?: string;
    authHeader?: string;
    contentType?: string | null;
    contentLength?: number;
    ip?: string;
    url?: string;
  }): NextRequest {
    const headers = new Headers();
    if (options.contentType !== null) {
      headers.set("content-type", options.contentType ?? "application/json");
    }
    if (options.authHeader !== undefined) {
      headers.set("authorization", options.authHeader);
    } else if (options.token) {
      headers.set("authorization", `Bearer ${options.token}`);
    }
    if (options.contentLength !== undefined) {
      headers.set("content-length", String(options.contentLength));
    }
    if (options.ip) {
      headers.set("x-forwarded-for", options.ip);
    }

    const bodyStr =
      options.rawBody !== undefined
        ? options.rawBody
        : options.body !== undefined
        ? JSON.stringify(options.body)
        : JSON.stringify({
            name: "Sunil Sharma",
            mobile: "9810011223",
            city: "Gurugram",
            preference: "SALE",
          });

    return new NextRequest(
      options.url ?? "http://localhost:3000/api/webhooks/portals/99acres",
      {
        method: "POST",
        headers,
        body: bodyStr,
      }
    );
  }

  // 1. Valid provider accepted
  it("1. Valid provider route parameters are accepted and mapped to PortalProvider enum", () => {
    expect(resolveRoutePortalProvider("99acres")).toBe(PortalProvider.NINETY_NINE_ACRES);
    expect(resolveRoutePortalProvider("99ACRES")).toBe(PortalProvider.NINETY_NINE_ACRES);
    expect(resolveRoutePortalProvider("ninety_nine_acres")).toBe(PortalProvider.NINETY_NINE_ACRES);
    expect(resolveRoutePortalProvider("NINETY_NINE_ACRES")).toBe(PortalProvider.NINETY_NINE_ACRES);
    expect(resolveRoutePortalProvider("magicbricks")).toBe(PortalProvider.MAGICBRICKS);
    expect(resolveRoutePortalProvider("MAGICBRICKS")).toBe(PortalProvider.MAGICBRICKS);
    expect(resolveRoutePortalProvider("nobroker")).toBe(PortalProvider.NOBROKER);
    expect(resolveRoutePortalProvider("NOBROKER")).toBe(PortalProvider.NOBROKER);
  });

  // 2. Invalid provider rejected
  it("2. Invalid provider route parameters are rejected with 404", async () => {
    expect(resolveRoutePortalProvider("housing")).toBeNull();
    expect(resolveRoutePortalProvider("unknown")).toBeNull();
    expect(resolveRoutePortalProvider("")).toBeNull();

    const req = createRequest({ token: mockRawToken });
    const res = await POST(req, { params: Promise.resolve({ provider: "invalid_portal" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/unsupported portal provider route/i);
  });

  // 3. Missing Bearer token rejected
  it("3. Missing Bearer token is rejected with 401", async () => {
    const req = createRequest({}); // No token
    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/missing authorization/i);
  });

  // 4. Malformed authorization rejected
  it("4. Malformed authorization headers are rejected with 401", async () => {
    // Non-Bearer scheme
    const req1 = createRequest({ authHeader: "Basic dXNlcjpwYXNz" });
    const res1 = await POST(req1, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res1.status).toBe(401);
    expect((await res1.json()).error).toMatch(/malformed authorization/i);

    // Short token (< 32 characters)
    const req2 = createRequest({ authHeader: "Bearer short_token" });
    const res2 = await POST(req2, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res2.status).toBe(401);
    expect((await res2.json()).error).toMatch(/invalid webhook token format/i);
  });

  // 5. Invalid token rejected
  it("5. Invalid token not found in database is rejected with 401", async () => {
    const unconfiguredToken = "f".repeat(64);
    const req = createRequest({ token: unconfiguredToken });
    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/unauthorized.*invalid webhook token/i);
  });

  // 6. Disabled integration rejected
  it("6. Disabled portal integration is rejected safely with 401", async () => {
    vi.spyOn(prisma.tenantPortalConfig, "findFirst").mockResolvedValue({
      ...mockDbConfig,
      isEnabled: false,
    } as unknown as Awaited<ReturnType<typeof prisma.tenantPortalConfig.findFirst>>);

    const req = createRequest({ token: mockRawToken });
    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/integration.*disabled/i);
  });

  // 7. Wrong provider/configuration combination rejected
  it("7. Wrong provider/configuration combination is rejected with 401", async () => {
    // Config exists for MAGICBRICKS, but request sent to 99acres route
    vi.spyOn(prisma.tenantPortalConfig, "findFirst").mockResolvedValue({
      ...mockDbConfig,
      provider: PortalProvider.MAGICBRICKS,
    } as unknown as Awaited<ReturnType<typeof prisma.tenantPortalConfig.findFirst>>);

    const req = createRequest({ token: mockRawToken });
    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/token is not configured for provider 'NINETY_NINE_ACRES'/i);
  });

  // 8. Missing Content-Type rejected
  it("8. Missing Content-Type header is rejected with 415", async () => {
    const req = createRequest({ token: mockRawToken, contentType: null });
    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(/unsupported content-type/i);
  });

  // 9. Unsupported Content-Type rejected
  it("9. Unsupported Content-Type header is rejected with 415", async () => {
    const req = createRequest({ token: mockRawToken, contentType: "application/xml" });
    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(/expected 'application\/json'/i);
  });

  // 10. Malformed JSON rejected
  it("10. Malformed JSON payload is rejected safely with 400", async () => {
    // Register verified mock adapter so verification check passes to test JSON parsing
    registerPortalAdapter(PortalProvider.NINETY_NINE_ACRES, new GenericMockPortalAdapter(PortalProvider.NINETY_NINE_ACRES));

    // Syntax error
    const req1 = createRequest({ token: mockRawToken, rawBody: "{ invalid: json " });
    const res1 = await POST(req1, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res1.status).toBe(400);
    expect((await res1.json()).error).toMatch(/malformed json/i);

    // Array root instead of object
    const req2 = createRequest({ token: mockRawToken, rawBody: "[1, 2, 3]" });
    const res2 = await POST(req2, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res2.status).toBe(400);
    expect((await res2.json()).error).toMatch(/root must be a json object/i);
  });

  // 11. Payload above 256 KB rejected
  it("11. Payload exceeding 256 KB limit is rejected with 413", async () => {
    // Header guard: Content-Length above 256 KB
    const reqHeader = createRequest({
      token: mockRawToken,
      contentLength: MAX_WEBHOOK_BODY_BYTES + 1,
    });
    const resHeader = await POST(reqHeader, { params: Promise.resolve({ provider: "99acres" }) });
    expect(resHeader.status).toBe(413);
    expect((await resHeader.json()).error).toMatch(/payload exceeds 256 kb/i);

    // Stream/body guard: Large string body exceeding 256 KB
    const largeStr = "x".repeat(MAX_WEBHOOK_BODY_BYTES + 10);
    const reqBody = createRequest({
      token: mockRawToken,
      rawBody: JSON.stringify({ hugeField: largeStr }),
    });
    const resBody = await POST(reqBody, { params: Promise.resolve({ provider: "99acres" }) });
    expect(resBody.status).toBe(413);
    expect((await resBody.json()).error).toMatch(/payload exceeds 256 kb/i);
  });

  // 12. Rate-limit exceeded returns 429 and Retry-After
  it("12. Rate-limit exceeded returns 429 and Retry-After header for both IP and Tenant tiers", async () => {
    // Tier 1: Client IP rate limit exceeded
    setWebhookRateLimiter(
      createMockRateLimiter({ configured: true, ipAllowed: false, resetSeconds: 45 })
    );
    const reqIp = createRequest({ token: mockRawToken });
    const resIp = await POST(reqIp, { params: Promise.resolve({ provider: "99acres" }) });
    expect(resIp.status).toBe(429);
    expect(resIp.headers.get("retry-after")).toBe("45");
    expect((await resIp.json()).error).toMatch(/ip rate limit exceeded/i);

    // Tier 2: Tenant delivery rate limit exceeded
    setWebhookRateLimiter(
      createMockRateLimiter({ configured: true, ipAllowed: true, tenantAllowed: false, resetSeconds: 30 })
    );
    const reqTenant = createRequest({ token: mockRawToken });
    const resTenant = await POST(reqTenant, { params: Promise.resolve({ provider: "99acres" }) });
    expect(resTenant.status).toBe(429);
    expect(resTenant.headers.get("retry-after")).toBe("30");
    expect((await resTenant.json()).error).toMatch(/portal delivery rate limit exceeded/i);
  });

  // 13. Rate-limit backend unavailable returns 503
  it("13. Distributed rate-limit backend unconfigured or unavailable returns 503 with Retry-After", async () => {
    setWebhookRateLimiter(createMockRateLimiter({ configured: false }));

    const req = createRequest({ token: mockRawToken });
    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    expect((await res.json()).error).toMatch(/rate limiting service is unconfigured/i);
  });

  // 14. Rate-limit check failure does not proceed to ingestion
  it("14. Rate-limit check failure halts pipeline before database authentication or ingestion", async () => {
    setWebhookRateLimiter(createMockRateLimiter({ configured: false }));
    const dbSpy = vi.spyOn(prisma.tenantPortalConfig, "findFirst");
    const ingestionSpy = vi.spyOn(portalIngestionModule, "ingestPortalLead");

    const req = createRequest({ token: mockRawToken });
    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });

    expect(res.status).toBe(503);
    expect(dbSpy).not.toHaveBeenCalled();
    expect(ingestionSpy).not.toHaveBeenCalled();
  });

  // 15. Valid normalized lead reaches existing ingestion DAL
  it("15. Valid verified request reaches existing ingestion DAL and returns 200", async () => {
    // Register verified mock adapter
    registerPortalAdapter(
      PortalProvider.NINETY_NINE_ACRES,
      new GenericMockPortalAdapter(PortalProvider.NINETY_NINE_ACRES)
    );

    const mockIngestionResult = {
      success: true,
      eventId: "event-1234",
      idempotencyKey: "99acres_lead_1",
      provider: PortalProvider.NINETY_NINE_ACRES,
      isDuplicate: false,
      isExistingBuyer: false,
      leadId: "lead-abc",
      enquiryId: "enq-xyz",
      deduplicationGuarantee: "STRONG_KEYED" as const,
      payloadFingerprint: "fingerprint-abc",
      leadStatus: LeadStatus.NOT_YET_VALIDATED,
      assignedTelecallerId: "telecaller-1",
    };

    const ingestionSpy = vi
      .spyOn(portalIngestionModule, "ingestPortalLead")
      .mockResolvedValue(mockIngestionResult);

    const payload = {
      externalEventId: "lead_1",
      name: "Rohit Bansal",
      mobile: "9810022334",
      city: "Gurugram",
      preference: "SALE",
    };

    const req = createRequest({ token: mockRawToken, body: payload });
    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.eventId).toBe("event-1234");
    expect(body.leadId).toBe("lead-abc");
    expect(body.enquiryId).toBe("enq-xyz");
    expect(body.isDuplicate).toBe(false);

    expect(ingestionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: mockTenantId,
        provider: PortalProvider.NINETY_NINE_ACRES,
        payload,
      })
    );
  });

  // 16. Keyed duplicate is safely acknowledged
  it("16. Keyed duplicate delivery is acknowledged with 200 and isDuplicate: true", async () => {
    registerPortalAdapter(
      PortalProvider.NINETY_NINE_ACRES,
      new GenericMockPortalAdapter(PortalProvider.NINETY_NINE_ACRES)
    );

    vi.spyOn(portalIngestionModule, "ingestPortalLead").mockResolvedValue({
      success: true,
      eventId: "event-existing",
      idempotencyKey: "99acres_dup_1",
      provider: PortalProvider.NINETY_NINE_ACRES,
      isDuplicate: true,
      isExistingBuyer: true,
      leadId: "lead-existing",
      enquiryId: "enq-existing",
      deduplicationGuarantee: "STRONG_KEYED",
      payloadFingerprint: "fingerprint-dup",
      leadStatus: LeadStatus.NOT_YET_VALIDATED,
      assignedTelecallerId: "telecaller-1",
    });

    const req = createRequest({ token: mockRawToken });
    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.isDuplicate).toBe(true);
    expect(body.leadId).toBe("lead-existing");
  });

  // 16b. Unkeyed submission with matching payload fingerprint is NOT marked as duplicate delivery
  it("16b. Unkeyed submission with matched payload fingerprint returns normal 200 with isDuplicate: false and isDuplicateCandidate: true", async () => {
    registerPortalAdapter(
      PortalProvider.NINETY_NINE_ACRES,
      new GenericMockPortalAdapter(PortalProvider.NINETY_NINE_ACRES)
    );

    vi.spyOn(portalIngestionModule, "ingestPortalLead").mockResolvedValue({
      success: true,
      eventId: "event-receipt-uuid-2",
      idempotencyKey: "unkeyed_receipt_uuid_2",
      provider: PortalProvider.NINETY_NINE_ACRES,
      isDuplicate: false, // NOT an automatic duplicate!
      isExistingBuyer: true,
      leadId: "lead-existing",
      enquiryId: "enq-new-2",
      deduplicationGuarantee: "WEAK_UNKEYED",
      payloadFingerprint: "fingerprint-shared",
      isDuplicateCandidate: true, // Flagged for observability
      leadStatus: LeadStatus.NOT_YET_VALIDATED,
      assignedTelecallerId: "telecaller-1",
    });

    const req = createRequest({
      token: mockRawToken,
      body: { name: "Buyer", mobile: "9810011223", city: "Noida", preference: "SALE" },
    });
    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.isDuplicate).toBe(false);
    expect(body.isExistingBuyer).toBe(true);
    expect(body.isDuplicateCandidate).toBe(true);
    expect(body.deduplicationGuarantee).toBe("WEAK_UNKEYED");
    expect(body.eventId).toBe("event-receipt-uuid-2");
    expect(body.enquiryId).toBe("enq-new-2");
  });

  // 17. Internal errors do not expose secrets or PII
  it("17. Internal server errors return safe 500 without leaking credentials, stack traces, or PII", async () => {
    registerPortalAdapter(
      PortalProvider.NINETY_NINE_ACRES,
      new GenericMockPortalAdapter(PortalProvider.NINETY_NINE_ACRES)
    );

    // Simulate database connection failure with credentials in error
    vi.spyOn(portalIngestionModule, "ingestPortalLead").mockRejectedValue(
      new Error("FATAL: postgresql://admin:super_secret_db_pass@10.0.0.1:5432/broker_crm query timeout")
    );

    const req = createRequest({
      token: mockRawToken,
      body: { name: "Confidential Prospect", mobile: "9812345678", email: "secret@buyer.com" },
    });
    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("An unexpected error occurred while processing lead.");
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toMatch(/super_secret_db_pass/);
    expect(bodyStr).not.toMatch(/postgresql:/);
    expect(bodyStr).not.toMatch(/9812345678/);
    expect(bodyStr).not.toMatch(/secret@buyer\.com/);
  });

  // 18. Unverified real provider adapters are not treated as production verified
  it("18. Unverified real provider adapters fail safely with 400 and do not proceed to ingestion", async () => {
    // Default 99acres adapter in registry has isVerified: false
    const defaultAdapter = getPortalAdapter(PortalProvider.NINETY_NINE_ACRES);
    expect(defaultAdapter.isVerified).toBe(false);

    const ingestionSpy = vi.spyOn(portalIngestionModule, "ingestPortalLead");

    const req = createRequest({ token: mockRawToken });
    const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unverified/i);
    expect(ingestionSpy).not.toHaveBeenCalled();
  });

  // Non-POST methods return 405
  it("Disallows GET, PUT, DELETE methods with HTTP 405 Method Not Allowed", async () => {
    const getRes = await GET();
    expect(getRes.status).toBe(405);
    expect(getRes.headers.get("allow")).toBe("POST");

    const putRes = await PUT();
    expect(putRes.status).toBe(405);
    expect(putRes.headers.get("allow")).toBe("POST");

    const delRes = await DELETE();
    expect(delRes.status).toBe(405);
    expect(delRes.headers.get("allow")).toBe("POST");
  });

  describe("Helper function unit tests", () => {
    it("getClientIp resolves client IP from x-forwarded-for, x-real-ip, or defaults to 127.0.0.1", () => {
      const req1 = new Request("http://localhost", {
        headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18" },
      });
      expect(getClientIp(req1)).toBe("203.0.113.195");

      const req2 = new Request("http://localhost", {
        headers: { "x-real-ip": "198.51.100.17" },
      });
      expect(getClientIp(req2)).toBe("198.51.100.17");

      const req3 = new Request("http://localhost");
      expect(getClientIp(req3)).toBe("127.0.0.1");
    });

    it("authenticatePortalWebhook directly authenticates valid tokens and rejects invalid/disabled", async () => {
      // Valid authentication
      const validReq = new Request("http://localhost", {
        headers: { authorization: `Bearer ${mockRawToken}` },
      });
      const validAuth = await authenticatePortalWebhook(validReq, PortalProvider.NINETY_NINE_ACRES);
      expect(validAuth.success).toBe(true);
      if (validAuth.success) {
        expect(validAuth.tenantId).toBe(mockTenantId);
      }

      // Missing header
      const missingReq = new Request("http://localhost");
      const missingAuth = await authenticatePortalWebhook(missingReq, PortalProvider.NINETY_NINE_ACRES);
      expect(missingAuth.success).toBe(false);

      // Wrong provider
      const wrongProviderAuth = await authenticatePortalWebhook(validReq, PortalProvider.MAGICBRICKS);
      expect(wrongProviderAuth.success).toBe(false);
    });

    it("readJsonBodyWithSizeLimit parses valid JSON and rejects empty/malformed/oversized payloads", async () => {
      // Valid JSON
      const validReq = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ key: "value" }),
      });
      const validBody = await readJsonBodyWithSizeLimit(validReq);
      expect(validBody.success).toBe(true);

      // Empty body
      const emptyReq = new Request("http://localhost", {
        method: "POST",
        body: "",
      });
      const emptyBody = await readJsonBodyWithSizeLimit(emptyReq);
      expect(emptyBody.success).toBe(false);

      // Oversized via header
      const oversizedReq = new Request("http://localhost", {
        method: "POST",
        headers: { "content-length": "300000" },
        body: JSON.stringify({ key: "value" }),
      });
      const oversizedRes = await readJsonBodyWithSizeLimit(oversizedReq);
      expect(oversizedRes.success).toBe(false);
      if (!oversizedRes.success) {
        expect(oversizedRes.status).toBe(413);
      }
    });
  });
});
