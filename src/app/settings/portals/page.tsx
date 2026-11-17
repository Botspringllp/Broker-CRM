import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import {
  listTenantPortalConfigs,
  getTenantPortalHealthMetrics,
} from "@/server/dal/portal-config";
import { UserRole } from "@prisma/client";
import { AppShell } from "@/components/layout/AppShell";
import { PortalSettingsClient, SerializedPortalConfig, SerializedHealthMetrics } from "./PortalSettingsClient";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

async function PortalSettingsContent() {
  let context: Awaited<ReturnType<typeof requireTenantContext>> | null = null;

  try {
    context = await requireTenantContext();
  } catch {
    context = null;
  }

  if (!context) {
    redirect("/login");
  }

  // Strict server-side authorization: BROKER_OWNER and CRM_TENANT_ADMIN only
  if (
    context.role !== UserRole.BROKER_OWNER &&
    context.role !== UserRole.CRM_TENANT_ADMIN
  ) {
    return (
      <div className="min-h-[500px] flex items-center justify-center p-6">
        <div className="bg-white border border-[#E4DFD5] rounded-lg p-8 max-w-md w-full text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-red-50 text-[#B3261E] flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-[#1E2A32] mb-2">Access Denied</h2>
          <p className="text-sm text-[#667085] mb-6">
            You do not have permission to manage portal integrations. This area is restricted to Broker Owners and Tenant Administrators.
          </p>
        </div>
      </div>
    );
  }

  const [rawConfigs, rawHealth] = await Promise.all([
    listTenantPortalConfigs(context).catch(() => []),
    getTenantPortalHealthMetrics(context).catch(() => ({} as Awaited<ReturnType<typeof getTenantPortalHealthMetrics>>)),
  ]);

  // Resolve base URL for webhook presentation
  const reqHeaders = await headers();
  const host = reqHeaders.get("x-forwarded-host") || reqHeaders.get("host") || "localhost:3000";
  const proto = reqHeaders.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const baseUrl = process.env.APP_BASE_URL || `${proto}://${host}`;

  // Serialize dates for Client Component hydration
  const serializedConfigs: SerializedPortalConfig[] = rawConfigs.map((c) => ({
    id: c.id,
    tenantId: c.tenantId,
    provider: c.provider,
    isEnabled: c.isEnabled,
    tokenCreatedAt: c.tokenCreatedAt.toISOString(),
    tokenRotatedAt: c.tokenRotatedAt ? c.tokenRotatedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  const serializedHealth: Record<string, SerializedHealthMetrics> = {};
  for (const [provider, metrics] of Object.entries(rawHealth)) {
    if (metrics) {
      serializedHealth[provider] = {
        provider: metrics.provider,
        lastReceivedAt: metrics.lastReceivedAt ? metrics.lastReceivedAt.toISOString() : null,
        lastProcessedAt: metrics.lastProcessedAt ? metrics.lastProcessedAt.toISOString() : null,
        processedCount: metrics.processedCount,
        failedCount: metrics.failedCount,
      };
    }
  }

  return (
    <PortalSettingsClient
      initialConfigs={serializedConfigs}
      initialHealth={serializedHealth}
      baseUrl={baseUrl}
      currentUserRole={context.role}
    />
  );
}

export default function PortalSettingsPage() {
  return (
    <AppShell activePage="/settings/portals">
      <Suspense
        fallback={
          <div className="p-8 flex items-center justify-center min-h-[300px]">
            <div className="flex items-center gap-3 text-sm text-[#667085]">
              <div className="w-4 h-4 border-2 border-[#1F6F6B] border-t-transparent rounded-full animate-spin" />
              Loading portal configurations...
            </div>
          </div>
        }
      >
        <PortalSettingsContent />
      </Suspense>
    </AppShell>
  );
}
