import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/server/tenant-context";
import { getPropertyPhotoForServing } from "@/server/dal/media";
import { NotFoundError, ForbiddenError } from "@/server/errors";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const context = await requireTenantContext();
    const { mediaId } = await params;

    if (!mediaId) {
      return new NextResponse("Media ID is required", { status: 400 });
    }

    const fileData = await getPropertyPhotoForServing(context, mediaId);

    // Convert Buffer to Uint8Array for NextResponse body
    const uint8Array = new Uint8Array(fileData.buffer);

    return new NextResponse(uint8Array, {
      status: 200,
      headers: {
        "Content-Type": fileData.mimeType,
        "Content-Length": String(fileData.sizeBytes),
        "Cache-Control": "private, max-age=3600, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new NextResponse(err.message, { status: 404 });
    }
    if (err instanceof ForbiddenError) {
      return new NextResponse(err.message, { status: 403 });
    }
    return new NextResponse("Unauthorized or file unavailable", { status: 401 });
  }
}

