import { PortalProvider } from "@prisma/client";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import crypto from "crypto";

/**
 * Result of a rate limit evaluation.
 */
export interface RateLimitResult {
  /** Whether the request is permitted to proceed */
  allowed: boolean;
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Number of remaining requests allowed in the current window */
  remaining: number;
  /** Seconds until the rate limit resets (for Retry-After header) */
  resetSeconds: number;
}

/**
 * Minimal structural interface for an Upstash-compatible Ratelimit instance.
 */
export interface UpstashRatelimitLike {
  limit(identifier: string): Promise<{
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
  }>;
}

/**
 * Interface contract for external portal webhook rate limiting.
 * Designed for distributed stores (e.g. Upstash Redis, AWS ElastiCache) in serverless environments.
 * Strictly adheres to DEC-R-11.
 */
export interface PortalWebhookRateLimiter {
  /**
   * Returns whether a real distributed rate-limiting backend is configured and reachable.
   * If false, the public webhook endpoint must fail closed (HTTP 503) to prevent unmetered abuse.
   */
  isConfigured(): boolean;

  /**
   * Tier 1 (Pre-auth abuse protection): Evaluates client IP rate limit.
   * Default target: 60 requests/minute per client IP (sliding window).
   */
  checkIpRateLimit(clientIp: string): Promise<RateLimitResult>;

  /**
   * Tier 2 (Per-Tenant / Per-Token burst limit): Evaluates authenticated portal configuration rate limit.
   * Default target: 120 requests/minute per authenticated portal config (sliding window).
   */
  checkTenantRateLimit(tenantId: string, provider: PortalProvider): Promise<RateLimitResult>;
}

export interface DistributedWebhookRateLimiterOptions {
  ipLimit?: number;
  tenantLimit?: number;
  redis?: Redis;
  ipLimiter?: UpstashRatelimitLike;
  tenantLimiter?: UpstashRatelimitLike;
}

/**
 * Distributed rate limiter implementation backed by Redis/Upstash (DEC-R-11).
 * Uses atomic sliding-window algorithms to prevent burst abuse across multi-instance serverless deployments.
 * If credentials are not present, reports unconfigured so the endpoint fails closed safely (HTTP 503).
 */
export class DistributedWebhookRateLimiter implements PortalWebhookRateLimiter {
  private readonly defaultIpLimit: number;
  private readonly defaultTenantLimit: number;
  private redisClient?: Redis;
  private ipLimiter?: UpstashRatelimitLike;
  private tenantLimiter?: UpstashRatelimitLike;

  constructor(options?: DistributedWebhookRateLimiterOptions) {
    this.defaultIpLimit = options?.ipLimit ?? 60; // DEC-R-11: 60 req/min
    this.defaultTenantLimit = options?.tenantLimit ?? 120; // DEC-R-11: 120 req/min
    if (options?.redis) {
      this.redisClient = options.redis;
    }
    if (options?.ipLimiter) {
      this.ipLimiter = options.ipLimiter;
    }
    if (options?.tenantLimiter) {
      this.tenantLimiter = options.tenantLimiter;
    }
  }

  /**
   * Verifies whether distributed cache infrastructure credentials are configured.
   */
  isConfigured(): boolean {
    if (this.redisClient || this.ipLimiter || this.tenantLimiter) {
      return true;
    }
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    return Boolean(url && token);
  }

  private getClient(): Redis {
    if (!this.redisClient) {
      const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
      const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
      if (!url || !token) {
        throw new Error(
          "Distributed rate limiting service is unconfigured. A distributed Upstash Redis backend is required for public webhook ingestion."
        );
      }
      this.redisClient = new Redis({ url, token });
    }
    return this.redisClient;
  }

  private getIpLimiter(): UpstashRatelimitLike {
    if (!this.ipLimiter) {
      const redis = this.getClient();
      this.ipLimiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(this.defaultIpLimit, "1 m"),
        prefix: "broker_crm:ratelimit:ip",
        analytics: false,
      });
    }
    return this.ipLimiter;
  }

  private getTenantLimiter(): UpstashRatelimitLike {
    if (!this.tenantLimiter) {
      const redis = this.getClient();
      this.tenantLimiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(this.defaultTenantLimit, "1 m"),
        prefix: "broker_crm:ratelimit:tenant",
        analytics: false,
      });
    }
    return this.tenantLimiter;
  }

  /**
   * Tier 1: IP-based pre-authentication sliding-window limit (60 req/min).
   * Key identifier is an anonymous SHA-256 hash of the client IP to avoid PII exposure.
   */
  async checkIpRateLimit(clientIp: string): Promise<RateLimitResult> {
    if (!this.isConfigured()) {
      throw new Error(
        "Distributed rate limiting service is unconfigured. A distributed Redis backend is required for public webhook ingestion."
      );
    }

    const limiter = this.getIpLimiter();
    const rawIp = clientIp?.trim() || "unknown";
    const ipIdentifier = crypto
      .createHash("sha256")
      .update(rawIp.toLowerCase())
      .digest("hex")
      .slice(0, 32);

    const result = await limiter.limit(ipIdentifier);
    const now = Date.now();
    const resetSeconds = Math.max(1, Math.ceil((result.reset - now) / 1000));

    return {
      allowed: result.success,
      limit: result.limit,
      remaining: Math.max(0, result.remaining),
      resetSeconds,
    };
  }

  /**
   * Tier 2: Tenant-based post-authentication sliding-window burst limit (120 req/min).
   * Key identifier is scoped strictly to `${tenantId}:${provider}` without tokens or PII.
   */
  async checkTenantRateLimit(
    tenantId: string,
    provider: PortalProvider
  ): Promise<RateLimitResult> {
    if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
      throw new Error("Invalid tenantId provided for rate limiting.");
    }

    if (!this.isConfigured()) {
      throw new Error(
        "Distributed rate limiting service is unconfigured. A distributed Redis backend is required for public webhook ingestion."
      );
    }

    const limiter = this.getTenantLimiter();
    const tenantIdentifier = `${tenantId.trim()}:${provider}`;

    const result = await limiter.limit(tenantIdentifier);
    const now = Date.now();
    const resetSeconds = Math.max(1, Math.ceil((result.reset - now) / 1000));

    return {
      allowed: result.success,
      limit: result.limit,
      remaining: Math.max(0, result.remaining),
      resetSeconds,
    };
  }
}

let activeRateLimiter: PortalWebhookRateLimiter = new DistributedWebhookRateLimiter();

/**
 * Returns the currently active webhook rate limiter.
 */
export function getWebhookRateLimiter(): PortalWebhookRateLimiter {
  return activeRateLimiter;
}

/**
 * Injects a rate limiter implementation (primarily used for test doubles).
 */
export function setWebhookRateLimiter(limiter: PortalWebhookRateLimiter): void {
  activeRateLimiter = limiter;
}

/**
 * Resets the active rate limiter to the default production implementation.
 */
export function resetWebhookRateLimiter(): void {
  activeRateLimiter = new DistributedWebhookRateLimiter();
}

/**
 * Creates a controllable test double for unit and integration testing.
 */
export function createMockRateLimiter(options?: {
  configured?: boolean;
  ipAllowed?: boolean;
  tenantAllowed?: boolean;
  resetSeconds?: number;
}): PortalWebhookRateLimiter {
  const isConfigured = options?.configured ?? true;
  const ipAllowed = options?.ipAllowed ?? true;
  const tenantAllowed = options?.tenantAllowed ?? true;
  const resetSeconds = options?.resetSeconds ?? 60;

  return {
    isConfigured: () => isConfigured,
    checkIpRateLimit: async () => {
      if (!isConfigured) {
        throw new Error("Rate limiting backend is unconfigured.");
      }
      return {
        allowed: ipAllowed,
        limit: 60,
        remaining: ipAllowed ? 59 : 0,
        resetSeconds,
      };
    },
    checkTenantRateLimit: async () => {
      if (!isConfigured) {
        throw new Error("Rate limiting backend is unconfigured.");
      }
      return {
        allowed: tenantAllowed,
        limit: 120,
        remaining: tenantAllowed ? 119 : 0,
        resetSeconds,
      };
    },
  };
}
