import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calculateRetentionCutoffDate,
  DEFAULT_RETENTION_DAYS,
} from "@/server/dal/portal-retention";
import { verifyCronAuthorization, GET, POST } from "@/app/api/cron/cleanup-webhooks/route";
import { NextRequest } from "next/server";
import * as retentionDal from "@/server/dal/portal-retention";

describe("Portal Webhook Retention: Unit Tests & Authorization", () => {
  const originalEnv = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "super-secret-cron-token-123456";
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalEnv;
    vi.restoreAllMocks();
  });

  describe("1. Cutoff Date Calculation", () => {
    it("accurately calculates the 90-day retention cutoff date in UTC", () => {
      const referenceNow = new Date("2026-11-15T12:00:00.000Z");
      const cutoff = calculateRetentionCutoffDate(referenceNow, 90);

      // 90 days * 24h * 60m * 60s * 1000ms = 7,776,000,000 ms
      const expectedTime = referenceNow.getTime() - 90 * 24 * 60 * 60 * 1000;
      expect(cutoff.getTime()).toBe(expectedTime);
      expect(cutoff.toISOString()).toBe("2026-08-17T12:00:00.000Z");
    });

    it("defaults to 90 days if retentionDays parameter is omitted", () => {
      const referenceNow = new Date("2026-11-15T00:00:00.000Z");
      const cutoff = calculateRetentionCutoffDate(referenceNow);
      const diffDays = (referenceNow.getTime() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBe(DEFAULT_RETENTION_DAYS);
    });

    it("supports custom retention days for audit scenarios", () => {
      const referenceNow = new Date("2026-11-15T00:00:00.000Z");
      const cutoff = calculateRetentionCutoffDate(referenceNow, 30);
      const diffDays = (referenceNow.getTime() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBe(30);
    });
  });

  describe("2. Cron Route Authorization (verifyCronAuthorization)", () => {
    it("accepts valid Bearer token matching CRON_SECRET using constant-time comparison", () => {
      const request = new Request("http://localhost:3000/api/cron/cleanup-webhooks", {
        headers: {
          Authorization: "Bearer super-secret-cron-token-123456",
        },
      });

      expect(verifyCronAuthorization(request)).toBe(true);
    });

    it("rejects request when Authorization header is missing", () => {
      const request = new Request("http://localhost:3000/api/cron/cleanup-webhooks");
      expect(verifyCronAuthorization(request)).toBe(false);
    });

    it("rejects request when Authorization header does not start with Bearer", () => {
      const request = new Request("http://localhost:3000/api/cron/cleanup-webhooks", {
        headers: {
          Authorization: "Basic dXNlcjpwYXNz",
        },
      });
      expect(verifyCronAuthorization(request)).toBe(false);
    });

    it("rejects request when Bearer token is tampered or incorrect", () => {
      const requestDifferent = new Request("http://localhost:3000/api/cron/cleanup-webhooks", {
        headers: {
          Authorization: "Bearer wrong-token-abcdef",
        },
      });
      expect(verifyCronAuthorization(requestDifferent)).toBe(false);

      const requestPrefixMatch = new Request("http://localhost:3000/api/cron/cleanup-webhooks", {
        headers: {
          Authorization: "Bearer super-secret-cron-token", // shorter
        },
      });
      expect(verifyCronAuthorization(requestPrefixMatch)).toBe(false);
    });

    it("defensively rejects request when CRON_SECRET is not configured on the server", () => {
      delete process.env.CRON_SECRET;

      const request = new Request("http://localhost:3000/api/cron/cleanup-webhooks", {
        headers: {
          Authorization: "Bearer any-token",
        },
      });

      expect(verifyCronAuthorization(request)).toBe(false);
    });
  });

  describe("3. Route Handler Endpoint (GET & POST)", () => {
    it("returns 401 Unauthorized when request lacks valid cron secret", async () => {
      const unauthorizedReq = new NextRequest("http://localhost:3000/api/cron/cleanup-webhooks");
      const resGet = await GET(unauthorizedReq);
      expect(resGet.status).toBe(401);

      const bodyGet = await resGet.json();
      expect(bodyGet.error).toMatch(/Unauthorized/);

      const resPost = await POST(unauthorizedReq);
      expect(resPost.status).toBe(401);
    });

    it("returns 200 with deletion statistics when authorized", async () => {
      const spy = vi.spyOn(retentionDal, "cleanupExpiredWebhookEvents").mockResolvedValue({
        success: true,
        deletedCount: 14,
        cutoffDate: new Date("2026-08-17T00:00:00.000Z"),
        durationMs: 45,
      });

      const authorizedReq = new NextRequest("http://localhost:3000/api/cron/cleanup-webhooks", {
        headers: {
          Authorization: "Bearer super-secret-cron-token-123456",
        },
      });

      const res = await GET(authorizedReq);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.deletedCount).toBe(14);
      expect(body.cutoffDate).toBe("2026-08-17T00:00:00.000Z");
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("returns 500 when cleanup DAL throws an error without silently reporting success", async () => {
      vi.spyOn(retentionDal, "cleanupExpiredWebhookEvents").mockRejectedValue(
        new Error("Database connection timeout during cleanup")
      );

      const authorizedReq = new NextRequest("http://localhost:3000/api/cron/cleanup-webhooks", {
        headers: {
          Authorization: "Bearer super-secret-cron-token-123456",
        },
      });

      const res = await GET(authorizedReq);
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain("Database connection timeout during cleanup");
    });
  });
});
