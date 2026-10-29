import { Suspense } from "react";
import { requireTenantContext } from "@/server/tenant-context";
import { hasPermission } from "@/server/permissions";
import { listEligibleTelecallers } from "@/server/dal/assignments";
import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { NewLeadClient } from "./NewLeadClient";

async function NewLeadData() {
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

  if (context.role === UserRole.CRM_TENANT_ADMIN) {
    redirect("/users");
  }

  if (context.role === UserRole.FIELD_VERIFIER) {
    redirect("/verifier");
  }

  const canCreate = hasPermission(
    context.role,
    "demand:create",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  if (!canCreate) {
    redirect("/leads");
  }

  const canAssignTelecaller = hasPermission(
    context.role,
    "assignment:assign_telecaller",
    context.user?.delegatedPermissions || context.delegatedPermissions
  );

  let eligibleTelecallers: { id: string; name: string; email: string; phone: string }[] = [];
  if (canAssignTelecaller) {
    try {
      const list = await listEligibleTelecallers(context);
      eligibleTelecallers = list.map((t) => ({
        id: t.id,
        name: t.name,
        email: t.email,
        phone: t.phone,
      }));
    } catch {
      eligibleTelecallers = [];
    }
  }

  return (
    <NewLeadClient
      userRole={context.role}
      userName={context.user.name}
      canAssignTelecaller={canAssignTelecaller}
      eligibleTelecallers={eligibleTelecallers}
    />
  );
}

export default function NewLeadPage() {
  return (
    <Suspense fallback={null}>
      <NewLeadData />
    </Suspense>
  );
}

