"use server";

import { requireTenantContext } from "@/server/tenant-context";
import { provisionTenant, updateTenantStatus, ProvisionTenantData } from "@/server/dal/tenants";
import { revalidatePath } from "next/cache";

export async function provisionTenantAction(data: ProvisionTenantData) {
  try {
    const context = await requireTenantContext();
    const result = await provisionTenant(context, data);
    revalidatePath("/platform");
    return { success: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to provision tenant.";
    return { success: false, error: message };
  }
}

export async function toggleTenantStatusAction(tenantId: string, isActive: boolean) {
  try {
    const context = await requireTenantContext();
    const updated = await updateTenantStatus(context, tenantId, isActive);
    revalidatePath("/platform");
    return { success: true, tenant: updated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update tenant status.";
    return { success: false, error: message };
  }
}

