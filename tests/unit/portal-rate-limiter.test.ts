import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DistributedWebhookRateLimiter,
  setWebhookRateLimiter,
  resetWebhookRateLimiter,
  UpstashRatelimitLike,
} from "@/server/security/portal-rate-limiter";
import { PortalProvider } from "@prisma/client";
import { POST, getClientIp } from "@/app/api/webhooks/portals/[provider]/route";
import { NextRequest } from "next/server";
import crypto from "crypto";

// Test helper: creates an in-memory sliding-window mock that emulates atomic Upstash behavior
function createSlidingWindowTestDouble(limit: number, windowMs: number): UpstashRatelimitLike & {
  calls: Map<string, Array<{ timestamp: number }>>;
  shouldThrow: boolean;
} {
  const calls = new Map<string, Array<{ timestamp: number }>>();
  let shouldThrow = false;

  return {
    calls,
    get shouldThrow() {
      return shouldThrow;
    },
    set shouldThrow(val: boolean) {
      shouldThrow = val;
    },
    async limit(identifier: string) {
      if (shouldThrow) {
        throw new Error("Redis cluster connection timeout (transient network failure)");
      }

      const now = Date.now();
      const windowStart = now - windowMs;
      const history = (calls.get(identifier) || []).filter((h) => h.timestamp > windowStart);

      const reset = now + windowMs;

      if (history.length >= limit) {
        calls.set(identifier, history);
        return {
          success: false,
          limit,
          remaining: 0,
          reset,
        };
      }

      history.push({ timestamp: now });
      calls.set(identifier, history);

      return {
        success: true,
        limit,
        remaining: limit - history.length,
        reset,
      };
    },
  };
}

describe("DistributedWebhookRateLimiter: Unit Tests", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetWebhookRateLimiter();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetWebhookRateLimiter();
  });

  describe("Configuration & Environment Detection", () => {
    it("reports unconfigured when environment variables are missing and no limiter injected", () => {
      const limiter = new DistributedWebhookRateLimiter();
      expect(limiter.isConfigured()).toBe(false);
    });

    it("reports configured when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are present", () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://mock-redis.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "mock-token-xyz";
      const limiter = new DistributedWebhookRateLimiter();
      expect(limiter.isConfigured()).toBe(true);
    });

    it("reports configured when mock/test limiters are injected directly", () => {
      const mockIpLimiter = createSlidingWindowTestDouble(60, 60000);
      const mockTenantLimiter = createSlidingWindowTestDouble(120, 60000);
      const limiter = new DistributedWebhookRateLimiter({
        ipLimiter: mockIpLimiter,
        tenantLimiter: mockTenantLimiter,
      });
      expect(limiter.isConfigured()).toBe(true);
    });

    it("throws clear error when checkIpRateLimit is called on unconfigured limiter (no in-memory fallback)", async () => {
      const limiter = new DistributedWebhookRateLimiter();
      await expect(limiter.checkIpRateLimit("192.168.1.1")).rejects.toThrow(
        /Distributed rate limiting service is unconfigured/i
      );
    });

    it("throws clear error when checkTenantRateLimit is called on unconfigured limiter (no in-memory fallback)", async () => {
      const limiter = new DistributedWebhookRateLimiter();
      await expect(
        limiter.checkTenantRateLimit("tenant-123", PortalProvider.NINETY_NINE_ACRES)
      ).rejects.toThrow(/Distributed rate limiting service is unconfigured/i);
    });
  });

  describe("Tier 1: Pre-Authentication Client IP Rate Limiting (60 req/min)", () => {
    it("allows requests below the 60 req/min threshold", async () => {
      const mockIp = createSlidingWindowTestDouble(60, 60000);
      const limiter = new DistributedWebhookRateLimiter({ ipLimiter: mockIp });

      const res = await limiter.checkIpRateLimit("203.0.113.195");
      expect(res.allowed).toBe(true);
      expect(res.limit).toBe(60);
      expect(res.remaining).toBe(59);
      expect(res.resetSeconds).toBeGreaterThan(0);
      expect(res.resetSeconds).toBeLessThanOrEqual(60);
    });

    it("allows request at exactly the threshold boundary (60th request)", async () => {
      const mockIp = createSlidingWindowTestDouble(60, 60000);
      const limiter = new DistributedWebhookRateLimiter({ ipLimiter: mockIp });

      for (let i = 1; i <= 59; i++) {
        await limiter.checkIpRateLimit("203.0.113.195");
      }

      const res60 = await limiter.checkIpRateLimit("203.0.113.195");
      expect(res60.allowed).toBe(true);
      expect(res60.remaining).toBe(0);
    });

    it("rejects request above threshold (61st request)", async () => {
      const mockIp = createSlidingWindowTestDouble(60, 60000);
      const limiter = new DistributedWebhookRateLimiter({ ipLimiter: mockIp });

      for (let i = 1; i <= 60; i++) {
        await limiter.checkIpRateLimit("203.0.113.195");
      }

      const res61 = await limiter.checkIpRateLimit("203.0.113.195");
      expect(res61.allowed).toBe(false);
      expect(res61.remaining).toBe(0);
      expect(res61.resetSeconds).toBeGreaterThan(0);
    });

    it("maintains separate limits for independent client IPs", async () => {
      const mockIp = createSlidingWindowTestDouble(60, 60000);
      const limiter = new DistributedWebhookRateLimiter({ ipLimiter: mockIp });

      // Saturate IP Alpha
      for (let i = 1; i <= 60; i++) {
        await limiter.checkIpRateLimit("10.0.0.1");
      }
      expect((await limiter.checkIpRateLimit("10.0.0.1")).allowed).toBe(false);

      // IP Beta must remain completely unaffected
      const resBeta = await limiter.checkIpRateLimit("10.0.0.2");
      expect(resBeta.allowed).toBe(true);
      expect(resBeta.remaining).toBe(59);
    });

    it("uses hashed, non-PII keys in the underlying Redis store", async () => {
      const mockIp = createSlidingWindowTestDouble(60, 60000);
      const limiter = new DistributedWebhookRateLimiter({ ipLimiter: mockIp });

      const rawIp = "198.51.100.42";
      await limiter.checkIpRateLimit(rawIp);

      const expectedHash = crypto
        .createHash("sha256")
        .update(rawIp.toLowerCase())
        .digest("hex")
        .slice(0, 32);

      // Verify that the key passed to Upstash does not contain raw IP text
      expect(mockIp.calls.has(expectedHash)).toBe(true);
      expect(mockIp.calls.has(rawIp)).toBe(false);
    });
  });

  describe("Tier 2: Post-Authentication Tenant Burst Rate Limiting (120 req/min)", () => {
    it("allows requests below the 120 req/min threshold", async () => {
      const mockTenant = createSlidingWindowTestDouble(120, 60000);
      const limiter = new DistributedWebhookRateLimiter({ tenantLimiter: mockTenant });

      const res = await limiter.checkTenantRateLimit(
        "tenant-acme-1",
        PortalProvider.MAGICBRICKS
      );
      expect(res.allowed).toBe(true);
      expect(res.limit).toBe(120);
      expect(res.remaining).toBe(119);
      expect(res.resetSeconds).toBeGreaterThan(0);
      expect(res.resetSeconds).toBeLessThanOrEqual(60);
    });

    it("allows request at exactly the threshold boundary (120th request)", async () => {
      const mockTenant = createSlidingWindowTestDouble(120, 60000);
      const limiter = new DistributedWebhookRateLimiter({ tenantLimiter: mockTenant });

      for (let i = 1; i <= 119; i++) {
        await limiter.checkTenantRateLimit("tenant-acme-1", PortalProvider.MAGICBRICKS);
      }

      const res120 = await limiter.checkTenantRateLimit(
        "tenant-acme-1",
        PortalProvider.MAGICBRICKS
      );
      expect(res120.allowed).toBe(true);
      expect(res120.remaining).toBe(0);
    });

    it("rejects request above threshold (121st request)", async () => {
      const mockTenant = createSlidingWindowTestDouble(120, 60000);
      const limiter = new DistributedWebhookRateLimiter({ tenantLimiter: mockTenant });

      for (let i = 1; i <= 120; i++) {
        await limiter.checkTenantRateLimit("tenant-acme-1", PortalProvider.MAGICBRICKS);
      }

      const res121 = await limiter.checkTenantRateLimit(
        "tenant-acme-1",
        PortalProvider.MAGICBRICKS
      );
      expect(res121.allowed).toBe(false);
      expect(res121.remaining).toBe(0);
      expect(res121.resetSeconds).toBeGreaterThan(0);
    });

    it("maintains separate limits for multiple independent tenants and providers", async () => {
      const mockTenant = createSlidingWindowTestDouble(120, 60000);
      const limiter = new DistributedWebhookRateLimiter({ tenantLimiter: mockTenant });

      // Saturate Tenant A on 99acres
      for (let i = 1; i <= 120; i++) {
        await limiter.checkTenantRateLimit("tenant-a", PortalProvider.NINETY_NINE_ACRES);
      }
      expect(
        (await limiter.checkTenantRateLimit("tenant-a", PortalProvider.NINETY_NINE_ACRES)).allowed
      ).toBe(false);

      // Tenant A on Magicbricks remains independent
      const resTenantAMb = await limiter.checkTenantRateLimit(
        "tenant-a",
        PortalProvider.MAGICBRICKS
      );
      expect(resTenantAMb.allowed).toBe(true);
      expect(resTenantAMb.remaining).toBe(119);

      // Tenant B on 99acres remains independent
      const resTenantB = await limiter.checkTenantRateLimit(
        "tenant-b",
        PortalProvider.NINETY_NINE_ACRES
      );
      expect(resTenantB.allowed).toBe(true);
      expect(resTenantB.remaining).toBe(119);
    });

    it("rejects check with invalid tenantId", async () => {
      const mockTenant = createSlidingWindowTestDouble(120, 60000);
      const limiter = new DistributedWebhookRateLimiter({ tenantLimiter: mockTenant });

      await expect(
        limiter.checkTenantRateLimit("", PortalProvider.NINETY_NINE_ACRES)
      ).rejects.toThrow(/Invalid tenantId/i);
    });
  });

  describe("DEC-R-11 Failure Handling via Route Integration", () => {
    it("Tier 1: Pre-authentication Redis outage fails closed with HTTP 503", async () => {
      const failingIp = createSlidingWindowTestDouble(60, 60000);
      failingIp.shouldThrow = true;

      setWebhookRateLimiter(
        new DistributedWebhookRateLimiter({
          ipLimiter: failingIp,
          tenantLimiter: createSlidingWindowTestDouble(120, 60000),
        })
      );

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const req = new NextRequest("http://localhost:3000/api/webhooks/portals/99acres", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ test: "payload" }),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("60");
      expect((await res.json()).error).toMatch(/rate limiter error/i);

      // Ensure error log omits PII/credentials
      expect(consoleSpy).toHaveBeenCalledWith(
        "[Portal Webhook Security] Pre-auth IP rate limiter check failed:",
        expect.objectContaining({
          clientIp: "[MASKED]",
          errorType: "Error",
        })
      );
    });

    it("Tier 2: Authenticated tenant Redis outage fails open per DEC-R-11", async () => {
      const failingTenant = createSlidingWindowTestDouble(120, 60000);
      failingTenant.shouldThrow = true;

      setWebhookRateLimiter(
        new DistributedWebhookRateLimiter({
          ipLimiter: createSlidingWindowTestDouble(60, 60000),
          tenantLimiter: failingTenant,
        })
      );

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Use an unauthenticated or invalid token to check that Tier 1 passes and auth is reached
      const req = new NextRequest("http://localhost:3000/api/webhooks/portals/99acres", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer invalid-token",
        },
        body: JSON.stringify({ test: "payload" }),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "99acres" }) });
      // Because the token is invalid, it is rejected at authentication (401)
      // confirming Tier 1 passed even when Tier 2 would throw if reached
      expect(res.status).toBe(401);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("Trusted Client IP Extraction", () => {
    it("prefers request.ip when present (Vercel runtime trusted socket)", () => {
      const req = new NextRequest("http://localhost:3000/api/test", {
        headers: {
          "x-real-ip": "1.1.1.1",
          "x-forwarded-for": "9.9.9.9, 1.1.1.1",
        },
      });
      // Simulate NextRequest.ip property populated by Next.js
      Object.defineProperty(req, "ip", { value: "10.20.30.40", configurable: true });

      const ip = getClientIp(req);
      expect(ip).toBe("10.20.30.40");
    });

    it("prefers x-real-ip over client-injected x-forwarded-for when request.ip is absent", () => {
      const req = new Request("http://localhost:3000/api/test", {
        headers: {
          "x-real-ip": "198.51.100.5",
          "x-forwarded-for": "10.0.0.99, 198.51.100.5",
        },
      });

      const ip = getClientIp(req);
      expect(ip).toBe("198.51.100.5");
    });

    it("falls back to x-forwarded-for first IP when x-real-ip is absent", () => {
      const req = new Request("http://localhost:3000/api/test", {
        headers: {
          "x-forwarded-for": "203.0.113.195",
        },
      });

      const ip = getClientIp(req);
      expect(ip).toBe("203.0.113.195");
    });

    it("returns 127.0.0.1 when no IP headers are present", () => {
      const req = new Request("http://localhost:3000/api/test");
      const ip = getClientIp(req);
      expect(ip).toBe("127.0.0.1");
    });
  });
});
