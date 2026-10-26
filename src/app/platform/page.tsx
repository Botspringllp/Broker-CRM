import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listTenants } from "@/server/dal/tenants";
import { UserRole } from "@prisma/client";
import { PlatformAdminClient, TenantViewItem } from "./PlatformAdminClient";
import { AppShell } from "@/components/layout/AppShell";
import Link from "next/link";

async function PlatformAdminData() {
  let context: Awaited<ReturnType<typeof requireTenantContext>> | null = null;
  let hasAuthError = false;

  try {
    context = await requireTenantContext();
  } catch {
    hasAuthError = true;
  }

  if (hasAuthError || !context) {
    return (
      <AppShell activePage="platform">
        <div className="bg-white p-8 rounded-lg border border-[#E4DFD5] text-center max-w-lg mx-auto mt-12 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-[#B7791F]/10 text-[#B7791F] flex items-center justify-center mx-auto mb-4 font-bold text-lg">
            !
          </div>
          <h2 className="text-xl font-bold text-[#1E2A32] mb-2">Authentication Required</h2>
          <p className="text-sm text-[#667085] mb-6">
            Please sign in as a Platform Super Administrator to access platform provisioning.
          </p>
          <Link
            href="/login"
            className="inline-block px-4 py-2 bg-[#1F6F6B] text-white text-sm font-semibold rounded-md hover:bg-[#165451] transition-colors"
          >
            Sign In
          </Link>
        </div>
      </AppShell>
    );
  }

  if (context.role !== UserRole.PLATFORM_SUPER_ADMIN) {
    return (
      <AppShell activePage="platform">
        <div className="bg-white p-8 rounded-lg border border-[#E4DFD5] text-center max-w-lg mx-auto mt-12 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-[#B3261E]/10 text-[#B3261E] flex items-center justify-center mx-auto mb-4 font-bold text-lg">
            ✕
          </div>
          <h2 className="text-xl font-bold text-[#1E2A32] mb-2">Access Denied</h2>
          <p className="text-sm text-[#667085] mb-6">
            Platform administration is strictly restricted to Platform Super Administrators.
          </p>
          <Link
            href="/"
            className="inline-block px-4 py-2 bg-[#1F6F6B] text-white text-sm font-semibold rounded-md hover:bg-[#165451] transition-colors"
          >
            Return to Dashboard
          </Link>
        </div>
      </AppShell>
    );
  }

  const rawTenants = await listTenants(context);
  const tenants: TenantViewItem[] = rawTenants.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    contactEmail: t.contactEmail,
    contactPhone: t.contactPhone,
    maxSeats: t.maxSeats,
    isActive: t.isActive,
    createdAt: t.createdAt.toISOString(),
    _count: t._count,
  }));

  return <PlatformAdminClient initialTenants={tenants} />;
}

export default function PlatformAdminPage() {
  return (
    <Suspense
      fallback={
        <AppShell activePage="platform">
          <div className="p-8 text-center text-[#667085] text-sm">
            Loading platform tenants...
          </div>
        </AppShell>
      }
    >
      <PlatformAdminData />
    </Suspense>
  );
}

