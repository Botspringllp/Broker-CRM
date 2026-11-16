import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { cleanupExpiredWebhookEvents } from "@/server/dal/portal-retention";

/**
 * Validates the incoming request's Bearer token against the configured CRON_SECRET
 * using constant-time comparison to prevent timing attack side-channels.
 */
export function verifyCronAuthorization(request: NextRequest | Request): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || cronSecret.trim().length === 0) {
    // If CRON_SECRET is not configured on the server, deny access defensively
    return false;
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  const providedToken = authHeader.slice(7).trim();
  const expectedToken = cronSecret.trim();

  const providedBuf = Buffer.from(providedToken);
  const expectedBuf = Buffer.from(expectedToken);

  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

async function handleCleanupRequest(request: NextRequest): Promise<NextResponse> {
  // 1. Authenticate request via CRON_SECRET Bearer token
  if (!verifyCronAuthorization(request)) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing cron secret authorization header." },
      { status: 401 }
    );
  }

  // 2. Execute 90-day retention cleanup
  try {
    const result = await cleanupExpiredWebhookEvents();
    return NextResponse.json(
      {
        success: true,
        deletedCount: result.deletedCount,
        cutoffDate: result.cutoffDate.toISOString(),
        durationMs: result.durationMs,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Retention cleanup encountered an unexpected error.";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleCleanupRequest(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleCleanupRequest(request);
}
