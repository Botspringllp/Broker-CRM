import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenantContext } from "@/server/tenant-context";
import { getVerificationById } from "@/server/dal/verifications";
import { mapPrismaVerificationToView } from "@/server/dal/mappers";
import { VerificationTaskClient } from "./VerificationTaskClient";
import { UserRole } from "@prisma/client";

interface TaskPageProps {
  params: Promise<{ id: string }>;
}

async function TaskData({ params }: TaskPageProps) {
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

  if (context.role === UserRole.PLATFORM_SUPER_ADMIN) redirect("/platform");
  if (context.role === UserRole.CRM_TENANT_ADMIN) redirect("/users");
  if (context.role === UserRole.TELECALLER) redirect("/supply");

  let verification;
  try {
    const dbVerification = await getVerificationById(context, id);
    verification = mapPrismaVerificationToView(dbVerification);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string };
    if (errorObj?.code === "NOT_FOUND" || errorObj?.message?.includes("not found")) {
      notFound();
    }
    // If forbidden or other error, redirect back to dashboard
    redirect("/verifier");
  }

  if (!verification) {
    notFound();
  }

  return (
    <VerificationTaskClient
      initialVerification={verification}
      userName={context.user.name}
      userRole={context.user.role.replace(/_/g, " ")}
    />
  );
}

export default function VerificationTaskPage({ params }: TaskPageProps) {
  return (
    <Suspense fallback={null}>
      <TaskData params={params} />
    </Suspense>
  );
}
