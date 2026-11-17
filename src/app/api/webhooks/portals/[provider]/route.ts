import { NextRequest, NextResponse } from "next/server";
import { PortalProvider } from "@prisma/client";
import { prisma } from "@/server/db";
import {
  hashWebhookToken,
  verifyWebhookToken,
} from "@/server/security/portal-tokens";
import {
  getWebhookRateLimiter,
  RateLimitResult,
} from "@/server/security/portal-rate-limiter";
import { getPortalAdapter } from "@/server/integrations/portals/registry";
import { ingestPortalLead } from "@/server/dal/portal-ingestion";
import {
  ValidationError,
  NotFoundError,
} from "@/server/errors";
import {
  PortalConfigurationDisabledError,
} from "@/server/integrations/portals/types";

/**
 * Maximum acceptable payload size: 256 KB (DEC-R-11).
 */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024; // 262,144 bytes

/**
 * Minimum acceptable length for a raw webhook token string.
 */
const MIN_RAW_TOKEN_LENGTH = 32;

/**
 * Maps and validates a candidate route parameter string to a Prisma PortalProvider enum value.
 * Accepts canonical names (e.g. "99acres", "99ACRES", "NINETY_NINE_ACRES", "magicbricks", "nobroker").
 * Returns null if the parameter is not a recognized portal provider.
 */
export function resolveRoutePortalProvider(param: string): PortalProvider | null {
  if (!param || typeof param !== "string") {
    return null;
  }
  const normalized = param.trim().toUpperCase();

  if (
    normalized === "99ACRES" ||
    normalized === "NINETY_NINE_ACRES" ||
    normalized === "99_ACRES"
  ) {
    return PortalProvider.NINETY_NINE_ACRES;
  }

  if (normalized === "MAGICBRICKS" || normalized === "MAGIC_BRICKS") {
    return PortalProvider.MAGICBRICKS;
  }

  if (normalized === "NOBROKER" || normalized === "NO_BROKER") {
    return PortalProvider.NOBROKER;
  }

  return null;
}

/**
 * Extracts the client IP address from proxy headers or the request environment.
 */
export function getClientIp(request: NextRequest | Request): string {
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(",")[0].trim();
    if (firstIp) return firstIp;
  }

  const xRealIp = request.headers.get("x-real-ip");
  if (xRealIp && xRealIp.trim().length > 0) {
    return xRealIp.trim();
  }

  if ("ip" in request && typeof (request as { ip?: string }).ip === "string") {
    const ip = (request as { ip?: string }).ip;
    if (ip) return ip;
  }

  return "127.0.0.1";
}

/**
 * Authenticates the incoming Bearer token against stored portal configurations in PostgreSQL.
 * Resolves the trusted tenantId strictly from the authenticated record.
 * Never trusts or reads tenant identity from the request body or query parameters.
 */
export async function authenticatePortalWebhook(
  request: NextRequest | Request,
  expectedProvider: PortalProvider
): Promise<
  | { success: true; tenantId: string; configId: string }
  | { success: false; status: 401; error: string }
> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader.trim().length === 0) {
    return { success: false, status: 401, error: "Missing Authorization header." };
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      success: false,
      status: 401,
      error: "Malformed Authorization header. Format must be 'Bearer <token>'.",
    };
  }

  const rawToken = match[1].trim();
  if (rawToken.length < MIN_RAW_TOKEN_LENGTH) {
    return { success: false, status: 401, error: "Invalid webhook token format." };
  }

  let tokenHash: string;
  try {
    tokenHash = hashWebhookToken(rawToken);
  } catch {
    return { success: false, status: 401, error: "Invalid webhook token format." };
  }

  const config = await prisma.tenantPortalConfig.findFirst({
    where: {
      webhookTokenHash: tokenHash,
    },
    select: {
      id: true,
      tenantId: true,
      provider: true,
      isEnabled: true,
      webhookTokenHash: true,
    },
  });

  if (!config) {
    return { success: false, status: 401, error: "Unauthorized: Invalid webhook token." };
  }

  // Constant-time token comparison against timing side-channel attacks
  const isTokenValid = verifyWebhookToken(rawToken, config.webhookTokenHash);
  if (!isTokenValid) {
    return { success: false, status: 401, error: "Unauthorized: Invalid webhook token." };
  }

  // Provider route match check: ensure token was generated for the requested provider endpoint
  if (config.provider !== expectedProvider) {
    return {
      success: false,
      status: 401,
      error: `Unauthorized: Webhook token is not configured for provider '${expectedProvider}'.`,
    };
  }

  // Integration enabled check
  if (!config.isEnabled) {
    return {
      success: false,
      status: 401,
      error: `Unauthorized: Portal integration for provider '${expectedProvider}' is disabled for this tenant.`,
    };
  }

  return { success: true, tenantId: config.tenantId, configId: config.id };
}

/**
 * Reads and parses the JSON request body, strictly enforcing the 256 KB body size limit
 * before and during parsing.
 */
export async function readJsonBodyWithSizeLimit(
  request: NextRequest | Request,
  maxBytes: number = MAX_WEBHOOK_BODY_BYTES
): Promise<
  | { success: true; data: Record<string, unknown> }
  | { success: false; status: 400 | 413; error: string }
> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!isNaN(contentLength) && contentLength > maxBytes) {
      return { success: false, status: 413, error: "Payload exceeds 256 KB limit." };
    }
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return { success: false, status: 400, error: "Failed to read request body." };
  }

  if (!rawText || rawText.trim().length === 0) {
    return { success: false, status: 400, error: "Empty request body." };
  }

  const byteLength = Buffer.byteLength(rawText, "utf-8");
  if (byteLength > maxBytes) {
    return { success: false, status: 413, error: "Payload exceeds 256 KB limit." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { success: false, status: 400, error: "Malformed JSON payload." };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      success: false,
      status: 400,
      error: "Invalid payload: root must be a JSON object.",
    };
  }

  return { success: true, data: parsed as Record<string, unknown> };
}

/**
 * Public inbound webhook route for external property portal lead ingestion.
 * POST /api/webhooks/portals/[provider]
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  // 1. Validate route provider parameter
  const { provider: rawProvider } = await params;
  const validatedProvider = resolveRoutePortalProvider(rawProvider);

  if (!validatedProvider) {
    return NextResponse.json(
      { error: `Unsupported portal provider route: '${rawProvider}'.` },
      { status: 404 }
    );
  }

  // 2. Validate Content-Type
  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { error: "Unsupported Content-Type. Expected 'application/json'." },
      { status: 415 }
    );
  }

  // 3. Pre-read Content-Length header guard (immediate 413 rejection)
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!isNaN(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
      return NextResponse.json(
        { error: "Payload exceeds 256 KB limit." },
        { status: 413 }
      );
    }
  }

  // 4. Rate Limiting Tier 1: Per-IP Unauthenticated Protection (DEC-R-11)
  const rateLimiter = getWebhookRateLimiter();
  if (!rateLimiter.isConfigured()) {
    return NextResponse.json(
      {
        error: "Service Unavailable: Distributed rate limiting service is unconfigured.",
      },
      {
        status: 503,
        headers: {
          "Retry-After": "60",
        },
      }
    );
  }

  const clientIp = getClientIp(request);
  let ipLimit: RateLimitResult;
  try {
    ipLimit = await rateLimiter.checkIpRateLimit(clientIp);
  } catch {
    return NextResponse.json(
      { error: "Service Unavailable: Rate limiter error." },
      { status: 503, headers: { "Retry-After": "60" } }
    );
  }

  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests: Client IP rate limit exceeded." },
      {
        status: 429,
        headers: {
          "Retry-After": String(ipLimit.resetSeconds || 60),
        },
      }
    );
  }

  // 5. Authenticate Bearer token & resolve trusted tenantId
  const authResult = await authenticatePortalWebhook(request, validatedProvider);
  if (!authResult.success) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status }
    );
  }

  const { tenantId } = authResult;

  // 6. Rate Limiting Tier 2: Per-Tenant / Per-Token Delivery Burst Limit (DEC-R-11)
  try {
    const tenantLimit = await rateLimiter.checkTenantRateLimit(tenantId, validatedProvider);
    if (!tenantLimit.allowed) {
      return NextResponse.json(
        { error: "Too Many Requests: Portal delivery rate limit exceeded." },
        {
          status: 429,
          headers: {
            "Retry-After": String(tenantLimit.resetSeconds || 60),
          },
        }
      );
    }
  } catch (err: unknown) {
    // Fail-open policy for authenticated requests if cache encounters transient error (DEC-R-11)
    console.warn("[Portal Webhook Warning] Authenticated rate limit check failed, failing open:", err);
  }

  // 7. Enforce 256 KB Body Size & Parse JSON
  const bodyResult = await readJsonBodyWithSizeLimit(request);
  if (!bodyResult.success) {
    return NextResponse.json(
      { error: bodyResult.error },
      { status: bodyResult.status }
    );
  }

  const payload = bodyResult.data;

  // 8. Resolve provider adapter and check verification boundary
  const adapter = getPortalAdapter(validatedProvider);
  if (!adapter.isVerified) {
    return NextResponse.json(
      {
        error: `Provider integration for '${validatedProvider}' is unverified. Webhook ingestion is disabled pending official partner API documentation.`,
      },
      { status: 400 }
    );
  }

  // 9. Ingest lead via Core Ingestion DAL
  try {
    const result = await ingestPortalLead({
      tenantId,
      provider: validatedProvider,
      payload,
      adapter,
    });

    return NextResponse.json(
      {
        success: true,
        eventId: result.eventId,
        leadId: result.leadId,
        enquiryId: result.enquiryId,
        isDuplicate: result.isDuplicate,
        isExistingBuyer: result.isExistingBuyer,
        deduplicationGuarantee: result.deduplicationGuarantee,
        isDuplicateCandidate: result.isDuplicateCandidate ?? false,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof PortalConfigurationDisabledError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }

    // Do NOT leak stack traces, database credentials, or PII
    console.error("[Portal Webhook Error] Unexpected error during lead ingestion:", {
      provider: validatedProvider,
      tenantId,
      errorType: err instanceof Error ? err.name : typeof err,
    });

    return NextResponse.json(
      { error: "An unexpected error occurred while processing lead." },
      { status: 500 }
    );
  }
}

/**
 * Disallows GET requests with 405 Method Not Allowed.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "Method Not Allowed. Only POST requests are supported." },
    { status: 405, headers: { Allow: "POST" } }
  );
}

/**
 * Disallows PUT requests with 405 Method Not Allowed.
 */
export async function PUT(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "Method Not Allowed. Only POST requests are supported." },
    { status: 405, headers: { Allow: "POST" } }
  );
}

/**
 * Disallows DELETE requests with 405 Method Not Allowed.
 */
export async function DELETE(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "Method Not Allowed. Only POST requests are supported." },
    { status: 405, headers: { Allow: "POST" } }
  );
}
