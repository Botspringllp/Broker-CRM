import { prisma } from "../db";
import { PortalProvider, UserRole, WebhookProcessingStatus } from "@prisma/client";
import { TenantContext } from "../tenant-context";
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../errors";
import {
  generateWebhookToken,
  rotateWebhookToken,
} from "../security/portal-tokens";

/**
 * Safe public representation of a tenant's external portal configuration.
 * Strictly excludes sensitive security credentials such as `webhookTokenHash` and raw tokens.
 */
export interface TenantPortalConfigDTO {
  id: string;
  tenantId: string;
  provider: PortalProvider;
  isEnabled: boolean;
  tokenCreatedAt: Date;
  tokenRotatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Result of initial webhook token generation.
 * Contains the safe configuration metadata and the plaintext raw token disclosed EXACTLY ONCE.
 */
export interface GeneratedPortalConfigResult {
  config: TenantPortalConfigDTO;
  /**
   * Cryptographically secure raw token. Disclosed EXACTLY ONCE to the authorized caller.
   * MUST NEVER be logged, persisted in the database, or returned in subsequent queries.
   */
  rawToken: string;
}

/**
 * Result of webhook token rotation.
 * Contains the updated configuration metadata and the new plaintext raw token disclosed EXACTLY ONCE.
 */
export interface RotatedPortalConfigResult {
  config: TenantPortalConfigDTO;
  /**
   * Fresh cryptographically secure raw token. Disclosed EXACTLY ONCE upon rotation.
   * The previous token is immediately invalidated.
   */
  rawToken: string;
}

/**
 * Safe Prisma selector that strictly omits `webhookTokenHash`.
 */
export const SAFE_PORTAL_CONFIG_SELECT = {
  id: true,
  tenantId: true,
  provider: true,
  isEnabled: true,
  tokenCreatedAt: true,
  tokenRotatedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Validates that the caller's authenticated session belongs to a role authorized
 * to manage portal integrations (`BROKER_OWNER` or `CRM_TENANT_ADMIN`).
 */
export function assertAuthorizedPortalAdmin(context: TenantContext): void {
  if (!context || !context.tenantId) {
    throw new UnauthorizedError("Authentication required.");
  }

  if (
    context.role !== UserRole.BROKER_OWNER &&
    context.role !== UserRole.CRM_TENANT_ADMIN
  ) {
    throw new ForbiddenError(
      `Access denied: role '${context.role}' is not authorized to manage portal integrations.`
    );
  }
}

/**
 * Validates that a candidate provider value is an authorized Prisma PortalProvider enum member.
 */
export function validatePortalProvider(provider: unknown): PortalProvider {
  if (
    typeof provider !== "string" ||
    !Object.values(PortalProvider).includes(provider as PortalProvider)
  ) {
    throw new ValidationError(
      `Invalid portal provider: '${provider}'. Valid providers are: ${Object.values(PortalProvider).join(", ")}.`
    );
  }
  return provider as PortalProvider;
}

/**
 * Lists all portal configurations belonging strictly to the authenticated caller's tenant.
 * Does not expose configurations belonging to other tenants.
 * Does not expose token hashes or raw tokens.
 */
export async function listTenantPortalConfigs(
  context: TenantContext
): Promise<TenantPortalConfigDTO[]> {
  assertAuthorizedPortalAdmin(context);

  return prisma.tenantPortalConfig.findMany({
    where: {
      tenantId: context.tenantId,
    },
    select: SAFE_PORTAL_CONFIG_SELECT,
    orderBy: {
      provider: "asc",
    },
  });
}

/**
 * Retrieves a single portal configuration by provider for the authenticated tenant.
 * Returns null if not yet configured. Never exposes token hashes.
 */
export async function getTenantPortalConfig(
  context: TenantContext,
  provider: PortalProvider
): Promise<TenantPortalConfigDTO | null> {
  assertAuthorizedPortalAdmin(context);
  const validatedProvider = validatePortalProvider(provider);

  return prisma.tenantPortalConfig.findUnique({
    where: {
      tenantId_provider: {
        tenantId: context.tenantId,
        provider: validatedProvider,
      },
    },
    select: SAFE_PORTAL_CONFIG_SELECT,
  });
}

/**
 * Enables or disables portal lead ingestion for a specific provider in the authenticated tenant.
 * Scoped strictly to the caller's tenantId; cross-tenant updates are rejected.
 */
export async function setPortalIntegrationStatus(
  context: TenantContext,
  provider: PortalProvider,
  isEnabled: boolean
): Promise<TenantPortalConfigDTO> {
  assertAuthorizedPortalAdmin(context);
  const validatedProvider = validatePortalProvider(provider);

  if (typeof isEnabled !== "boolean") {
    throw new ValidationError("isEnabled must be a boolean value.");
  }

  const existing = await prisma.tenantPortalConfig.findUnique({
    where: {
      tenantId_provider: {
        tenantId: context.tenantId,
        provider: validatedProvider,
      },
    },
    select: { id: true },
  });

  if (!existing) {
    throw new NotFoundError(
      `Portal integration for provider '${validatedProvider}' is not configured for this tenant.`
    );
  }

  return prisma.tenantPortalConfig.update({
    where: {
      tenantId_provider: {
        tenantId: context.tenantId,
        provider: validatedProvider,
      },
    },
    data: {
      isEnabled,
    },
    select: SAFE_PORTAL_CONFIG_SELECT,
  });
}

/**
 * Generates an initial cryptographically secure webhook token for a provider in the caller's tenant.
 * - Stores only the SHA-256 hash in the database.
 * - Discloses the plaintext raw token EXACTLY ONCE to the caller.
 * - Rejects generation if a configuration already exists for this provider.
 */
export async function generatePortalWebhookToken(
  context: TenantContext,
  provider: PortalProvider,
  isEnabled = true
): Promise<GeneratedPortalConfigResult> {
  assertAuthorizedPortalAdmin(context);
  const validatedProvider = validatePortalProvider(provider);

  // Guard against duplicate initial generation for the same tenant + provider
  const existing = await prisma.tenantPortalConfig.findUnique({
    where: {
      tenantId_provider: {
        tenantId: context.tenantId,
        provider: validatedProvider,
      },
    },
    select: { id: true },
  });

  if (existing) {
    throw new ValidationError(
      `Portal integration for provider '${validatedProvider}' is already configured. Use rotatePortalWebhookToken to generate a new token.`
    );
  }

  const { rawToken, tokenHash } = generateWebhookToken();

  const config = await prisma.tenantPortalConfig.create({
    data: {
      tenantId: context.tenantId,
      provider: validatedProvider,
      isEnabled,
      webhookTokenHash: tokenHash,
      tokenCreatedAt: new Date(),
    },
    select: SAFE_PORTAL_CONFIG_SELECT,
  });

  return {
    config,
    rawToken,
  };
}

/**
 * Rotates the webhook token for a configured provider in the caller's tenant.
 * - Generates a fresh cryptographically secure token.
 * - Replaces the stored hash atomically in a database transaction.
 * - Updates rotation metadata (`tokenRotatedAt`).
 * - Immediately invalidates the previous token.
 * - Discloses the new raw token EXACTLY ONCE to the caller.
 */
export async function rotatePortalWebhookToken(
  context: TenantContext,
  provider: PortalProvider
): Promise<RotatedPortalConfigResult> {
  assertAuthorizedPortalAdmin(context);
  const validatedProvider = validatePortalProvider(provider);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.tenantPortalConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: context.tenantId,
          provider: validatedProvider,
        },
      },
    });

    if (!existing) {
      throw new NotFoundError(
        `Portal integration for provider '${validatedProvider}' is not configured for this tenant.`
      );
    }

    const { rawToken, tokenHash, rotatedAt } = rotateWebhookToken(existing.webhookTokenHash);

    // Atomic conditional update ensuring no concurrent rotation race overwrites
    const updateResult = await tx.tenantPortalConfig.updateMany({
      where: {
        id: existing.id,
        tenantId: context.tenantId,
        webhookTokenHash: existing.webhookTokenHash,
      },
      data: {
        webhookTokenHash: tokenHash,
        tokenRotatedAt: rotatedAt,
      },
    });

    if (updateResult.count === 0) {
      throw new ValidationError(
        "A concurrent token rotation was detected for this provider. Please refresh and try again."
      );
    }

    const updated = await tx.tenantPortalConfig.findUniqueOrThrow({
      where: { id: existing.id },
      select: SAFE_PORTAL_CONFIG_SELECT,
    });

    return {
      config: updated,
      rawToken,
    };
  });
}

/**
 * Safe health and operational metrics for a tenant's external portal integration.
 * Strictly excludes customer PII, phone numbers, emails, and raw webhook payloads.
 */
export interface PortalHealthMetricsDTO {
  provider: PortalProvider;
  lastReceivedAt: Date | null;
  lastProcessedAt: Date | null;
  processedCount: number;
  failedCount: number;
}

/**
 * Retrieves safe, aggregate operational health metrics for external portal webhooks
 * scoped strictly to the authenticated caller's tenant.
 * Never exposes raw payloads, contact details, or PII.
 */
export async function getTenantPortalHealthMetrics(
  context: TenantContext
): Promise<Record<PortalProvider, PortalHealthMetricsDTO>> {
  assertAuthorizedPortalAdmin(context);

  const providers = [
    PortalProvider.NINETY_NINE_ACRES,
    PortalProvider.MAGICBRICKS,
    PortalProvider.NOBROKER,
  ];

  const metricsEntries = await Promise.all(
    providers.map(async (provider) => {
      const [processedCount, failedCount, lastReceived, lastProcessed] = await Promise.all([
        prisma.portalWebhookEvent.count({
          where: {
            tenantId: context.tenantId,
            provider,
            status: WebhookProcessingStatus.PROCESSED,
          },
        }),
        prisma.portalWebhookEvent.count({
          where: {
            tenantId: context.tenantId,
            provider,
            status: WebhookProcessingStatus.FAILED,
          },
        }),
        prisma.portalWebhookEvent.findFirst({
          where: {
            tenantId: context.tenantId,
            provider,
          },
          orderBy: { receivedAt: "desc" },
          select: { receivedAt: true },
        }),
        prisma.portalWebhookEvent.findFirst({
          where: {
            tenantId: context.tenantId,
            provider,
            status: WebhookProcessingStatus.PROCESSED,
          },
          orderBy: { processedAt: "desc" },
          select: { processedAt: true },
        }),
      ]);

      const dto: PortalHealthMetricsDTO = {
        provider,
        lastReceivedAt: lastReceived?.receivedAt ?? null,
        lastProcessedAt: lastProcessed?.processedAt ?? null,
        processedCount,
        failedCount,
      };

      return [provider, dto] as const;
    })
  );

  return Object.fromEntries(metricsEntries) as Record<PortalProvider, PortalHealthMetricsDTO>;
}

