import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenantContext, NotFoundError } from "@/server/tenant-context";
import { getTenantUserById } from "@/server/dal/users";
import { canAssignRole, canAdministerUser } from "@/server/permissions";
import { prisma } from "@/server/db";
import { UserRole } from "@prisma/client";
import { EditUserClient } from "./EditUserClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function EditUserData({ params }: PageProps) {
  const { id } = await params;
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

  let dbUser;
  try {
    dbUser = await getTenantUserById(context, id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      notFound();
    }
    throw err;
  }

  const isSelf = dbUser.id === context.userId;

  // If not self, verify admin authority
  if (!isSelf && !canAdministerUser(context, dbUser)) {
    redirect("/users");
  }

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
    <EditUserClient
      user={{
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
        phone: dbUser.phone || "",
        role: dbUser.role,
        isActive: dbUser.isActive,
        teamLeaderId: dbUser.teamLeaderId,
        brokerId: dbUser.brokerId,
        delegatedPermissions: dbUser.delegatedPermissions || [],
      }}
      assignableRoles={assignableRoles}
      teamLeaders={teamLeaders}
      brokers={brokers}
      currentUserRole={context.role}
      currentUserId={context.userId}
      isSelf={isSelf}
    />
  );
}

export default function EditUserPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <EditUserData params={params} />
    </Suspense>
  );
}

