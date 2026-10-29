import { Suspense } from "react";
import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function DemandQualifyRedirectData({ params }: PageProps) {
  const { id } = await params;
  redirect(`/leads/${id}/qualify`);
  return null;
}

export default function DemandQualifyRedirectPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <DemandQualifyRedirectData params={params} />
    </Suspense>
  );
}
