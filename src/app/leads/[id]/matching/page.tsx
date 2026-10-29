import { Suspense } from "react";
import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function LeadMatchingRedirectData({ params }: PageProps) {
  const { id } = await params;
  redirect(`/matching/${id}`);
  return null;
}

export default function LeadMatchingRedirectPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <LeadMatchingRedirectData params={params} />
    </Suspense>
  );
}

