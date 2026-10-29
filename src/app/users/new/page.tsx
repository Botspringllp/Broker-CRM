import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireTenantContext } from "@/server/tenant-context";
import { assertPermission, canAssignRole } from "@/server/permissions";
import { prisma } from "@/server/db";
import { UserRole } from "@prisma/client";
import { CreateUserClient } from "./CreateUserClient";

async function CreateUserData() {
  let context: Awaited<ReturnType<typeof requireTenantContext>> | null = null;

  try {
    context = await requireTenantContext();
  } catch {
    context = null;
  }

  if (!context) {
    redirect("/login");
  }

  if (context.role === UserRole.PLATFORM_SUPER_ADMIN) {
    redirect("/platform");
  }

  try {
    assertPermission(context, "admin:manage_users");
  } catch {
    redirect("/users");
  }

  // Calculate assignable roles based on current user's authority
  const allRoles: UserRole[] = [
    UserRole.BROKER_OWNER,
    UserRole.TEAM_LEADER,
    UserRole.TELECALLER,
    UserRole.FIELD_VERIFIER,
    UserRole.FIELD_SALES_AGENT,
  ];

  const assignableRoles = allRoles.filter((r) => canAssignRole(context.role, r));

  const [teamLeaders, brokers] = await Promise.all([
    prisma.user.findMany({
      where: {
        tenantId: context.tenantId,
        role: UserRole.TEAM_LEADER,
        isActive: true,
      },
      select: { id: true, name: true, email: true, brokerId: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: {
        tenantId: context.tenantId,
        role: UserRole.BROKER_OWNER,
        isActive: true,
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <CreateUserClient
      assignableRoles={assignableRoles}
      teamLeaders={teamLeaders}
      brokers={brokers}
      currentUserRole={context.role}
    />
  );
}

export default function CreateUserPage() {
  return (
    <Suspense fallback={null}>
      <CreateUserData />
    </Suspense>
  );
}

