import { Suspense } from "react";
import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function DemandDetailsRedirectData({ params }: PageProps) {
  const { id } = await params;
  redirect(`/leads/${id}`);
  return null;
}

export default function DemandDetailsRedirectPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <DemandDetailsRedirectData params={params} />
    </Suspense>
  );
}
