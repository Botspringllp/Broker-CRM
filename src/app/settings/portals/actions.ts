"use server";

import { requireTenantContext } from "@/server/tenant-context";
import {
  listTenantPortalConfigs,
  setPortalIntegrationStatus,
  generatePortalWebhookToken,
  rotatePortalWebhookToken,
  getTenantPortalHealthMetrics,
  validatePortalProvider,
  TenantPortalConfigDTO,
  PortalHealthMetricsDTO,
} from "@/server/dal/portal-config";
import { PortalProvider } from "@prisma/client";
import { revalidatePath } from "next/cache";

export interface PortalConfigActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Lists all portal configurations and safe health metrics for the authenticated tenant.
 * Requires BROKER_OWNER or CRM_TENANT_ADMIN role.
 */
export async function getPortalConfigurationsAction(): Promise<
  PortalConfigActionResult<{
    configs: TenantPortalConfigDTO[];
    healthMetrics: Record<PortalProvider, PortalHealthMetricsDTO>;
  }>
> {
  try {
    const context = await requireTenantContext();
    const [configs, healthMetrics] = await Promise.all([
      listTenantPortalConfigs(context),
      getTenantPortalHealthMetrics(context),
    ]);

    return {
      success: true,
      data: {
        configs,
        healthMetrics,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load portal configurations.";
    return { success: false, error: message };
  }
}

/**
 * Toggles the enabled/disabled state of an external portal integration.
 * Requires BROKER_OWNER or CRM_TENANT_ADMIN role.
 */
export async function togglePortalIntegrationStatusAction(
  provider: PortalProvider,
  isEnabled: boolean
): Promise<PortalConfigActionResult<TenantPortalConfigDTO>> {
  try {
    const context = await requireTenantContext();
    const validatedProvider = validatePortalProvider(provider);
    const updated = await setPortalIntegrationStatus(context, validatedProvider, isEnabled);
    revalidatePath("/settings/portals");

    return {
      success: true,
      data: updated,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update portal integration status.";
    return { success: false, error: message };
  }
}

/**
 * Generates an initial webhook token for a portal integration.
 * Discloses the raw token EXACTLY ONCE to the authorized caller.
 * Requires BROKER_OWNER or CRM_TENANT_ADMIN role.
 */
export async function generatePortalWebhookTokenAction(
  provider: PortalProvider,
  isEnabled = true
): Promise<
  PortalConfigActionResult<{
    config: TenantPortalConfigDTO;
    rawToken: string;
  }>
> {
  try {
    const context = await requireTenantContext();
    const validatedProvider = validatePortalProvider(provider);
    const result = await generatePortalWebhookToken(context, validatedProvider, isEnabled);
    revalidatePath("/settings/portals");

    return {
      success: true,
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate webhook token.";
    return { success: false, error: message };
  }
}

/**
 * Rotates the webhook token for a configured portal integration.
 * Immediately invalidates the previous token and returns the new raw token EXACTLY ONCE.
 * Requires BROKER_OWNER or CRM_TENANT_ADMIN role.
 */
export async function rotatePortalWebhookTokenAction(
  provider: PortalProvider
): Promise<
  PortalConfigActionResult<{
    config: TenantPortalConfigDTO;
    rawToken: string;
  }>
> {
  try {
    const context = await requireTenantContext();
    const validatedProvider = validatePortalProvider(provider);
    const result = await rotatePortalWebhookToken(context, validatedProvider);
    revalidatePath("/settings/portals");

    return {
      success: true,
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to rotate webhook token.";
    return { success: false, error: message };
  }
}
