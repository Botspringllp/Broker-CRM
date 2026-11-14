import { Suspense } from "react";
import { getSiteVisitByAccessToken } from "@/server/dal/visits";
import { MobileSiteVisitClient } from "./MobileSiteVisitClient";

interface PageProps {
  params: Promise<{ token: string }>;
}

async function MobileSiteVisitData({ params }: PageProps) {
  const { token } = await params;

  let data: Awaited<ReturnType<typeof getSiteVisitByAccessToken>> | null = null;
  let initialError: {
    type: "EXPIRED" | "REVOKED" | "CANCELLED" | "NOT_FOUND";
    message: string;
  } | null = null;

  try {
    data = await getSiteVisitByAccessToken(token);
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Invalid or expired site visit access link.";

    let errorType: "EXPIRED" | "REVOKED" | "CANCELLED" | "NOT_FOUND" = "NOT_FOUND";
    if (errorMessage.toLowerCase().includes("expired")) {
      errorType = "EXPIRED";
    } else if (errorMessage.toLowerCase().includes("revoked")) {
      errorType = "REVOKED";
    } else if (errorMessage.toLowerCase().includes("cancelled")) {
      errorType = "CANCELLED";
    }

    initialError = {
      type: errorType,
      message: errorMessage,
    };
  }

  if (initialError || !data) {
    return (
      <MobileSiteVisitClient
        rawToken={token}
        initialError={initialError ?? { type: "NOT_FOUND", message: "Site visit link not found." }}
      />
    );
  }

  return (
    <MobileSiteVisitClient
      rawToken={token}
      initialVisit={data.visit}
      tenantName={data.tenantName}
      salesAgentName={data.salesAgentName}
      expiresAt={data.expiresAt.toISOString()}
    />
  );
}

export default function MobileSiteVisitPage({ params }: PageProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center p-4">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-3 border-[#1F6F6B] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-[#667085] font-medium">Loading visit itinerary...</p>
          </div>
        </div>
      }
    >
      <MobileSiteVisitData params={params} />
    </Suspense>
  );
}
