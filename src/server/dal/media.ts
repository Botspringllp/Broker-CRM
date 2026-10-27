import crypto from "crypto";
import { prisma } from "../db";
import { TenantContext } from "../tenant-context";
import { assertPermission } from "../permissions";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import {
  MediaType,
  MediaStorageProvider,
  PropertyMedia,
  UserRole,
  AssignmentStatus,
} from "@prisma/client";
import {
  getStorageAdapter,
  validateImageBuffer,
  MAX_PHOTO_FILE_SIZE_BYTES,
  MAX_PHOTO_BATCH_COUNT,
  StoredFileData,
} from "../storage";

export { MAX_PHOTO_FILE_SIZE_BYTES, MAX_PHOTO_BATCH_COUNT };

export interface ParsedYouTubeVideo {
  videoId: string;
  canonicalUrl: string;
  embedUrl: string;
  thumbnailUrl: string;
}

/**
 * Validates and parses public or unlisted YouTube URLs.
 * Supports standard watch, short youtu.be, and shorts URLs.
 * Strictly validates hostname and 11-character video ID.
 */
export function validateAndParseYouTubeUrl(rawUrl: string): ParsedYouTubeVideo {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new ValidationError("YouTube URL is required.");
  }

  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError("Invalid video URL format. Please provide a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ValidationError("Video URL must use HTTPS.");
  }

  const hostname = parsed.hostname.toLowerCase();
  let videoId: string | null = null;

  if (
    hostname === "youtube.com" ||
    hostname === "www.youtube.com" ||
    hostname === "m.youtube.com"
  ) {
    if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v");
    } else if (parsed.pathname.startsWith("/shorts/")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      videoId = parts[1] || null;
    } else if (parsed.pathname.startsWith("/embed/")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      videoId = parts[1] || null;
    }
  } else if (hostname === "youtu.be") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    videoId = parts[0] || null;
  } else {
    throw new ValidationError(
      "Only official YouTube links (youtube.com, youtu.be) are supported for property walkthrough videos."
    );
  }

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw new ValidationError(
      "Could not extract a valid 11-character YouTube video ID. Please check the video link."
    );
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  };
}

/**
 * Checks that the property belongs to the tenant, and that if the caller is
 * a TELECALLER, the property is actively assigned to them.
 */
async function verifyPropertyAccess(
  context: TenantContext,
  propertyId: string
): Promise<{ id: string; tenantId: string }> {
  const property = await prisma.property.findFirst({
    where: {
      id: propertyId,
      tenantId: context.tenantId, // STRICT TENANT ISOLATION
    },
    select: {
      id: true,
      tenantId: true,
      assignments: {
        where: {
          status: AssignmentStatus.ACTIVE,
        },
        select: {
          assignedUserId: true,
        },
      },
    },
  });

  if (!property) {
    throw new NotFoundError("Target property not found in your brokerage.");
  }

  // Telecallers may only upload media to actively assigned properties
  if (context.role === UserRole.TELECALLER) {
    const isAssigned = property.assignments.some(
      (a) => a.assignedUserId === context.userId
    );
    if (!isAssigned) {
      throw new ForbiddenError(
        "Telecallers may only upload or manage media for properties actively assigned to them."
      );
    }
  }

  return { id: property.id, tenantId: property.tenantId };
}

/**
 * Adds a validated property photo to storage and persists metadata in database.
 * Uses compensation to remove stored file if database transaction fails.
 */
export async function addPropertyPhoto(
  context: TenantContext,
  params: {
    propertyId: string;
    fileBuffer: Buffer;
    originalFilename?: string;
    caption?: string;
  }
): Promise<PropertyMedia> {
  assertPermission(context, "supply:upload_media");
  const property = await verifyPropertyAccess(context, params.propertyId);

  // Validate photo buffer and file signature (magic bytes)
  const validation = validateImageBuffer(params.fileBuffer);
  if (!validation.isValid) {
    throw new ValidationError(validation.error || "Invalid image file.");
  }

  // Calculate next display order
  const highestOrder = await prisma.propertyMedia.findFirst({
    where: {
      tenantId: context.tenantId,
      propertyId: property.id,
    },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });
  const nextDisplayOrder = (highestOrder?.displayOrder ?? -1) + 1;

  // Generate safe storage key and media ID
  const mediaId = crypto.randomUUID();
  const storageAdapter = getStorageAdapter();

  const saved = await storageAdapter.savePhoto({
    tenantId: context.tenantId,
    propertyId: property.id,
    buffer: params.fileBuffer,
    mimeType: validation.mimeType,
    extension: validation.extension,
  });

  // Persist record in database. If DB insert fails, cleanup file from storage
  try {
    const record = await prisma.propertyMedia.create({
      data: {
        id: mediaId,
        tenantId: context.tenantId, // STRICT SERVER-DERIVED TENANT
        propertyId: property.id,
        uploadedById: context.userId, // STRICT SERVER-DERIVED UPLOADER
        mediaType: MediaType.PHOTO,
        storageProvider: MediaStorageProvider.OBJECT_STORAGE,
        url: `/api/media/${mediaId}`, // Authenticated serving route
        caption: params.caption?.trim() || null,
        displayOrder: nextDisplayOrder,
      },
    });

    return record;
  } catch (dbErr) {
    // Compensation cleanup
    await storageAdapter.deletePhoto(saved.storageKey);
    throw dbErr;
  }
}

/**
 * Attaches an external YouTube walkthrough video link.
 */
export async function attachPropertyVideo(
  context: TenantContext,
  params: {
    propertyId: string;
    youtubeUrl: string;
    caption?: string;
  }
): Promise<PropertyMedia> {
  assertPermission(context, "supply:upload_media");
  const property = await verifyPropertyAccess(context, params.propertyId);

  const parsed = validateAndParseYouTubeUrl(params.youtubeUrl);

  const highestOrder = await prisma.propertyMedia.findFirst({
    where: {
      tenantId: context.tenantId,
      propertyId: property.id,
    },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });
  const nextDisplayOrder = (highestOrder?.displayOrder ?? -1) + 1;

  const mediaId = crypto.randomUUID();

  return prisma.propertyMedia.create({
    data: {
      id: mediaId,
      tenantId: context.tenantId,
      propertyId: property.id,
      uploadedById: context.userId,
      mediaType: MediaType.VIDEO,
      storageProvider: MediaStorageProvider.YOUTUBE,
      url: parsed.canonicalUrl,
      caption: params.caption?.trim() || null,
      displayOrder: nextDisplayOrder,
    },
  });
}

/**
 * Lists all media for a property in ascending display order.
 */
export async function listPropertyMedia(
  context: TenantContext,
  propertyId: string
): Promise<
  (PropertyMedia & {
    uploadedBy: { id: string; name: string; role: string } | null;
  })[]
> {
  await verifyPropertyAccess(context, propertyId);

  return prisma.propertyMedia.findMany({
    where: {
      tenantId: context.tenantId,
      propertyId,
    },
    include: {
      uploadedBy: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Deletes a property media item and its corresponding file on disk.
 */
export async function deletePropertyMedia(
  context: TenantContext,
  params: {
    propertyId: string;
    mediaId: string;
  }
): Promise<void> {
  assertPermission(context, "supply:upload_media");
  await verifyPropertyAccess(context, params.propertyId);

  const media = await prisma.propertyMedia.findFirst({
    where: {
      id: params.mediaId,
      propertyId: params.propertyId,
      tenantId: context.tenantId, // STRICT TENANT ISOLATION
    },
  });

  if (!media) {
    throw new NotFoundError("Media record not found in your brokerage.");
  }

  // Delete from database
  await prisma.propertyMedia.delete({
    where: { id: media.id },
  });

  // If local object storage, delete physical file
  if (media.storageProvider === MediaStorageProvider.OBJECT_STORAGE) {
    const storageAdapter = getStorageAdapter();
    // Storage key convention: {tenantId}/{propertyId}/{filename}
    // We search and remove files matching {tenantId}/{propertyId}/{media.id}.*
    const tenantClean = context.tenantId.replace(/[^a-zA-Z0-9_-]/g, "");
    const propertyClean = params.propertyId.replace(/[^a-zA-Z0-9_-]/g, "");

    // Check extensions
    for (const ext of ["jpg", "png", "webp", "jpeg"]) {
      const key = `${tenantClean}/${propertyClean}/${media.id}.${ext}`;
      await storageAdapter.deletePhoto(key);
    }
  }
}

/**
 * Updates the display ordering of property media items.
 */
export async function reorderPropertyMedia(
  context: TenantContext,
  params: {
    propertyId: string;
    mediaIdsInOrder: string[];
  }
): Promise<void> {
  assertPermission(context, "supply:upload_media");
  await verifyPropertyAccess(context, params.propertyId);

  if (!params.mediaIdsInOrder || params.mediaIdsInOrder.length === 0) {
    return;
  }

  await prisma.$transaction(
    params.mediaIdsInOrder.map((mediaId, index) =>
      prisma.propertyMedia.updateMany({
        where: {
          id: mediaId,
          propertyId: params.propertyId,
          tenantId: context.tenantId,
        },
        data: {
          displayOrder: index,
        },
      })
    )
  );
}

/**
 * Retrieves the stored photo buffer for the authenticated media endpoint.
 */
export async function getPropertyPhotoForServing(
  context: TenantContext,
  mediaId: string
): Promise<StoredFileData> {
  const media = await prisma.propertyMedia.findFirst({
    where: {
      id: mediaId,
      tenantId: context.tenantId, // STRICT TENANT ISOLATION
    },
  });

  if (!media) {
    throw new NotFoundError("Requested photo not found.");
  }

  if (media.mediaType !== MediaType.PHOTO) {
    throw new ValidationError("Requested media is not a photo.");
  }

  const storageAdapter = getStorageAdapter();
  const tenantClean = media.tenantId.replace(/[^a-zA-Z0-9_-]/g, "");
  const propertyClean = media.propertyId.replace(/[^a-zA-Z0-9_-]/g, "");

  // Try finding file with valid extension
  for (const ext of ["jpg", "png", "webp", "jpeg"]) {
    const key = `${tenantClean}/${propertyClean}/${media.id}.${ext}`;
    try {
      return await storageAdapter.readPhoto(key);
    } catch {
      // Continue searching
    }
  }

  throw new NotFoundError("Image file not found on disk.");
}

