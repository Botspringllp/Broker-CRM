import { getSiteVisitByAccessToken } from "@/server/dal/visits";
import { MobileSiteVisitClient } from "./MobileSiteVisitClient";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function MobileSiteVisitPage({ params }: PageProps) {
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
