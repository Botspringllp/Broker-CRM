import { prisma } from "../db";
import { WebhookProcessingStatus } from "@prisma/client";

export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_CLEANUP_BATCH_SIZE = 500;

export const TERMINAL_WEBHOOK_STATUSES: WebhookProcessingStatus[] = [
  WebhookProcessingStatus.PROCESSED,
  WebhookProcessingStatus.FAILED,
  WebhookProcessingStatus.IGNORED,
];

export interface PortalRetentionCleanupOptions {
  /** Reference timestamp used to compute the 90-day cutoff (defaults to Date.now()) */
  now?: Date;
  /** Maximum number of records deleted per batch iteration (defaults to 500) */
  batchSize?: number;
  /** Optional tenant scoping (if omitted, cleans up eligible events across all tenants) */
  tenantId?: string;
  /** Number of retention days (defaults to 90) */
  retentionDays?: number;
}

export interface PortalRetentionCleanupResult {
  success: boolean;
  deletedCount: number;
  cutoffDate: Date;
  durationMs: number;
  error?: string;
}

/**
 * Calculates the UTC retention cutoff date for portal webhook events.
 */
export function calculateRetentionCutoffDate(
  now: Date = new Date(),
  retentionDays: number = DEFAULT_RETENTION_DAYS
): Date {
  const msInDay = 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - retentionDays * msInDay);
}

/**
 * Cleans up expired portal webhook events based on the 90-day retention policy.
 *
 * Retention Rules:
 * - Reference timestamp: `receivedAt`.
 * - Deleted records: `receivedAt <= cutoffDate` AND status IN ('PROCESSED', 'FAILED', 'IGNORED').
 * - Preserved records:
 *   - Any record with status = 'PENDING' (even if older than 90 days).
 *   - Any record where `receivedAt > cutoffDate` (regardless of status).
 *   - ALL core CRM business data (`Lead`, `Enquiry`, `Assignment`, `LeadRequirement`, etc.) are NEVER touched.
 *
 * Execution Properties:
 * - Uses bounded batch deletion to prevent long table locks and transaction log saturation.
 * - Repeated execution is strictly idempotent and safe.
 * - Emits safe operational metrics (counts, durations) with zero customer PII.
 */
export async function cleanupExpiredWebhookEvents(
  options?: PortalRetentionCleanupOptions
): Promise<PortalRetentionCleanupResult> {
  const startTime = Date.now();
  const retentionDays = options?.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoffDate = calculateRetentionCutoffDate(options?.now ?? new Date(), retentionDays);
  const batchSize = options?.batchSize ?? DEFAULT_CLEANUP_BATCH_SIZE;

  if (batchSize <= 0) {
    throw new Error("Batch size must be a positive integer.");
  }

  let totalDeleted = 0;

  try {
    while (true) {
      // 1. Fetch the primary keys of the next batch of eligible expired records
      const eligible = await prisma.portalWebhookEvent.findMany({
        where: {
          receivedAt: { lte: cutoffDate },
          status: { in: TERMINAL_WEBHOOK_STATUSES },
          ...(options?.tenantId ? { tenantId: options.tenantId } : {}),
        },
        select: { id: true },
        take: batchSize,
      });

      if (eligible.length === 0) {
        break;
      }

      const idsToDelete = eligible.map((item) => item.id);

      // 2. Delete strictly by the fetched IDs while re-validating all eligibility criteria
      // at execution time to guard against concurrent status transitions or modifications.
      const deleteResult = await prisma.portalWebhookEvent.deleteMany({
        where: {
          id: { in: idsToDelete },
          receivedAt: { lte: cutoffDate },
          status: { in: TERMINAL_WEBHOOK_STATUSES },
          ...(options?.tenantId ? { tenantId: options.tenantId } : {}),
        },
      });

      totalDeleted += deleteResult.count;

      // If fewer records were returned than batchSize, we have reached the end
      if (eligible.length < batchSize) {
        break;
      }
    }

    const durationMs = Date.now() - startTime;

    // Safe operational logging: zero customer PII
    console.info(
      `[Portal Webhook Retention Cleanup] Successfully deleted ${totalDeleted} expired event(s) older than ${cutoffDate.toISOString()} in ${durationMs}ms.`
    );

    return {
      success: true,
      deletedCount: totalDeleted,
      cutoffDate,
      durationMs,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    console.error(
      `[Portal Webhook Retention Cleanup Error] Failed after deleting ${totalDeleted} event(s) in ${durationMs}ms: ${errorMessage}`
    );

    throw err;
  }
}
