import { Suspense } from "react";
import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function DemandEditRedirectData({ params }: PageProps) {
  const { id } = await params;
  redirect(`/leads/${id}/edit`);
  return null;
}

export default function DemandEditRedirectPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <DemandEditRedirectData params={params} />
    </Suspense>
  );
}
