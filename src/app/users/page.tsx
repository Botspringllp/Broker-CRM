import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { listTenantUsers, listUserAuditLogs } from "@/server/dal/users";
import { prisma } from "@/server/db";
import { UserRole } from "@prisma/client";
import { UsersManagementClient, UserViewItem, UserAuditItem } from "./UsersManagementClient";
import { AppShell } from "@/components/layout/AppShell";
import Link from "next/link";

async function UsersManagementData() {
  let users: UserViewItem[] = [];
  let teamLeaders: { id: string; name: string; email: string; brokerId?: string | null }[] = [];
  let brokers: { id: string; name: string; email: string }[] = [];
  let auditLogs: UserAuditItem[] = [];
  let currentUserRole: UserRole = UserRole.BROKER_OWNER;
  let currentUserId = "";

  try {
    const context = await requireTenantContext();
    currentUserRole = context.role;
    currentUserId = context.userId;

    const [rawUsers, leaders, rawBrokers, rawLogs] = await Promise.all([
      listTenantUsers(context).catch(() => []),
      prisma.user.findMany({
        where: {
          tenantId: context.tenantId,
          role: UserRole.TEAM_LEADER,
          isActive: true,
        },
        select: { id: true, name: true, email: true, brokerId: true },
      }).catch(() => []),
      prisma.user.findMany({
        where: {
          tenantId: context.tenantId,
          role: UserRole.BROKER_OWNER,
          isActive: true,
        },
        select: { id: true, name: true, email: true },
      }).catch(() => []),
      listUserAuditLogs(context).catch(() => []),
    ]);

    users = rawUsers.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      isActive: u.isActive,
      brokerId: u.brokerId,
      teamLeaderId: u.teamLeaderId,
      delegatedPermissions: u.delegatedPermissions || [],
      createdAt: u.createdAt.toISOString(),
      broker: u.broker,
      teamLeader: u.teamLeader,
      subordinates: u.subordinates?.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        role: s.role,
        isActive: s.isActive,
      })),
    }));

    teamLeaders = leaders;
    brokers = rawBrokers;
    auditLogs = rawLogs.map((l) => ({
      id: l.id,
      action: l.action,
      createdAt: l.createdAt.toISOString(),
      details: l.details as Record<string, unknown> | null,
      actorUser: l.actorUser,
      targetUser: l.targetUser || { id: "", name: "System", role: UserRole.PLATFORM_SUPER_ADMIN },
    }));
  } catch (err: unknown) {
    // If forbidden or unauthenticated, render clear access boundary state
    const isForbidden =
      err instanceof Error &&
      (err.name === "ForbiddenError" || err.message.includes("Access denied"));

    return (
      <AppShell>
        <div className="max-w-md mx-auto text-center py-16 space-y-3">
          <div className="w-12 h-12 rounded-full bg-red-100 text-[#B3261E] mx-auto flex items-center justify-center text-xl font-bold">
            🛡️
          </div>
          <h2 className="text-base font-bold text-[#1E2A32]">
            {isForbidden ? "Administrative Access Restricted" : "Authentication Required"}
          </h2>
          <p className="text-xs text-[#667085] leading-relaxed">
            {isForbidden
              ? "User administration is strictly restricted to Broker Owners, CRM Tenant Admins, and authorized Team Leaders."
              : "Please sign in to access your tenant user and permission directory."}
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="px-3.5 py-1.5 text-xs font-semibold rounded bg-[#1F6F6B] text-white hover:bg-[#165451] shadow-2xs inline-block"
            >
              ← Return to Overview
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <UsersManagementClient
      initialUsers={users}
      teamLeaders={teamLeaders}
      brokers={brokers}
      auditLogs={auditLogs}
      currentUserRole={currentUserRole}
      currentUserId={currentUserId}
    />
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={null}>
      <UsersManagementData />
    </Suspense>
  );
}
