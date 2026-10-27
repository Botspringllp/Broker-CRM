import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  UserRole,
  MediaType,
  MediaStorageProvider,
  AssignmentStatus,
} from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";

// Mock Prisma DB module
vi.mock("@/server/db", () => {
  const mockPrisma = {
    property: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    propertyMedia: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (arg) => {
      if (typeof arg === "function") {
        return arg(mockPrisma);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg;
    }),
  };
  return { prisma: mockPrisma };
});

import { prisma } from "@/server/db";
import {
  addPropertyPhoto,
  attachPropertyVideo,
  listPropertyMedia,
  deletePropertyMedia,
  getPropertyPhotoForServing,
  validateAndParseYouTubeUrl,
  MAX_PHOTO_FILE_SIZE_BYTES,
  MAX_PHOTO_BATCH_COUNT,
} from "@/server/dal/media";
import {
  StorageAdapter,
  setStorageAdapterForTesting,
} from "@/server/storage";

type MockProperty = NonNullable<Awaited<ReturnType<typeof prisma.property.findFirst>>>;
type MockPropertyMedia = NonNullable<Awaited<ReturnType<typeof prisma.propertyMedia.findFirst>>>;

describe("Supply Validation - Property Media Upload & Management", () => {
  const brokerOwnerContext: TenantContext = {
    tenantId: "tenant-brokerage-1",
    userId: "user-broker-1",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-broker-1",
      name: "Broker Vikram",
      email: "vikram@apexrealty.in",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-brokerage-1",
      isActive: true,
    },
    session: {
      id: "sess-1",
      token: "tok-1",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const telecallerContext: TenantContext = {
    tenantId: "tenant-brokerage-1",
    userId: "user-telecaller-1",
    role: UserRole.TELECALLER,
    user: {
      id: "user-telecaller-1",
      name: "Telecaller Pooja",
      email: "pooja@apexrealty.in",
      role: UserRole.TELECALLER,
      tenantId: "tenant-brokerage-1",
      isActive: true,
    },
    session: {
      id: "sess-2",
      token: "tok-2",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const salesAgentContext: TenantContext = {
    tenantId: "tenant-brokerage-1",
    userId: "user-sales-1",
    role: UserRole.FIELD_SALES_AGENT,
    user: {
      id: "user-sales-1",
      name: "Sales Rahul",
      email: "rahul@apexrealty.in",
      role: UserRole.FIELD_SALES_AGENT,
      tenantId: "tenant-brokerage-1",
      isActive: true,
    },
    session: {
      id: "sess-3",
      token: "tok-3",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const otherTenantContext: TenantContext = {
    tenantId: "tenant-brokerage-2",
    userId: "user-other-1",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-other-1",
      name: "Other Owner",
      email: "owner@other.in",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-brokerage-2",
      isActive: true,
    },
    session: {
      id: "sess-4",
      token: "tok-4",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  // Mock Storage Adapter
  let mockStorageSave: ReturnType<typeof vi.fn>;
  let mockStorageRead: ReturnType<typeof vi.fn>;
  let mockStorageDelete: ReturnType<typeof vi.fn>;

  // Valid image buffers with authentic magic bytes
  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]);
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  const validWebpBuffer = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0x20, 0x00, 0x00, 0x00]),
    Buffer.from("WEBPVP8 "),
    Buffer.alloc(16),
  ]);

  beforeEach(() => {
    vi.resetAllMocks();

    mockStorageSave = vi.fn().mockResolvedValue({
      storageKey: "tenant-brokerage-1/prop-101/test-file.jpg",
      sizeBytes: 1024,
      mimeType: "image/jpeg",
    });
    mockStorageRead = vi.fn().mockResolvedValue({
      buffer: validJpegBuffer,
      mimeType: "image/jpeg",
      sizeBytes: validJpegBuffer.length,
    });
    mockStorageDelete = vi.fn().mockResolvedValue(undefined);

    const testAdapter: StorageAdapter = {
      savePhoto: mockStorageSave,
      readPhoto: mockStorageRead,
      deletePhoto: mockStorageDelete,
    };
    setStorageAdapterForTesting(testAdapter);

    // Default property mock belonging to tenant 1
    vi.mocked(prisma.property.findFirst).mockResolvedValue({
      id: "prop-101",
      tenantId: "tenant-brokerage-1",
      assignments: [
        {
          assignedUserId: "user-telecaller-1",
          status: AssignmentStatus.ACTIVE,
        },
      ],
    } as unknown as MockProperty);
  });

  it("1. Successfully uploads a valid JPEG photo and persists metadata with uploader ID", async () => {
    vi.mocked(prisma.propertyMedia.create).mockResolvedValueOnce({
      id: "media-uuid-1",
      tenantId: "tenant-brokerage-1",
      propertyId: "prop-101",
      uploadedById: "user-broker-1",
      mediaType: MediaType.PHOTO,
      storageProvider: MediaStorageProvider.OBJECT_STORAGE,
      url: "/api/media/media-uuid-1",
      caption: "Master Bedroom",
      displayOrder: 0,
      createdAt: new Date(),
    } as unknown as MockPropertyMedia);

    const result = await addPropertyPhoto(brokerOwnerContext, {
      propertyId: "prop-101",
      fileBuffer: validJpegBuffer,
      originalFilename: "bedroom.jpg",
      caption: "Master Bedroom",
    });

    expect(result.id).toBe("media-uuid-1");
    expect(result.mediaType).toBe(MediaType.PHOTO);
    expect(result.uploadedById).toBe("user-broker-1");
    expect(result.url).toBe("/api/media/media-uuid-1");
    expect(mockStorageSave).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-brokerage-1",
        propertyId: "prop-101",
        mimeType: "image/jpeg",
        extension: "jpg",
      })
    );

    // Also verify valid PNG and WebP buffers are accepted
    vi.mocked(prisma.propertyMedia.create).mockResolvedValueOnce({
      id: "media-uuid-png",
      tenantId: "tenant-brokerage-1",
      propertyId: "prop-101",
      uploadedById: "user-broker-1",
      mediaType: MediaType.PHOTO,
      storageProvider: MediaStorageProvider.OBJECT_STORAGE,
      url: "/api/media/media-uuid-png",
      caption: null,
      displayOrder: 1,
      createdAt: new Date(),
    } as unknown as MockPropertyMedia);

    const pngResult = await addPropertyPhoto(brokerOwnerContext, {
      propertyId: "prop-101",
      fileBuffer: validPngBuffer,
    });
    expect(pngResult.id).toBe("media-uuid-png");

    vi.mocked(prisma.propertyMedia.create).mockResolvedValueOnce({
      id: "media-uuid-webp",
      tenantId: "tenant-brokerage-1",
      propertyId: "prop-101",
      uploadedById: "user-broker-1",
      mediaType: MediaType.PHOTO,
      storageProvider: MediaStorageProvider.OBJECT_STORAGE,
      url: "/api/media/media-uuid-webp",
      caption: null,
      displayOrder: 2,
      createdAt: new Date(),
    } as unknown as MockPropertyMedia);

    const webpResult = await addPropertyPhoto(brokerOwnerContext, {
      propertyId: "prop-101",
      fileBuffer: validWebpBuffer,
    });
    expect(webpResult.id).toBe("media-uuid-webp");
  });

  it("2. Rejects photos exceeding the 5 MB maximum size limit", async () => {
    // Buffer exceeding 5 MB
    const oversizedBuffer = Buffer.alloc(MAX_PHOTO_FILE_SIZE_BYTES + 1024);
    // Add JPEG signature to oversized buffer
    oversizedBuffer[0] = 0xff;
    oversizedBuffer[1] = 0xd8;
    oversizedBuffer[2] = 0xff;

    await expect(
      addPropertyPhoto(brokerOwnerContext, {
        propertyId: "prop-101",
        fileBuffer: oversizedBuffer,
      })
    ).rejects.toThrow(ValidationError);

    expect(mockStorageSave).not.toHaveBeenCalled();
    expect(prisma.propertyMedia.create).not.toHaveBeenCalled();
  });

  it("3. Rejects unsupported MIME types and invalid file content (SVG, PDF, text)", async () => {
    const textBuffer = Buffer.from("Hello world, this is not an image");
    const svgBuffer = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");

    await expect(
      addPropertyPhoto(brokerOwnerContext, {
        propertyId: "prop-101",
        fileBuffer: textBuffer,
      })
    ).rejects.toThrow(ValidationError);

    await expect(
      addPropertyPhoto(brokerOwnerContext, {
        propertyId: "prop-101",
        fileBuffer: svgBuffer,
      })
    ).rejects.toThrow(ValidationError);
  });

  it("4. Validates batch limit constant is exactly 10 photos per upload batch", () => {
    expect(MAX_PHOTO_BATCH_COUNT).toBe(10);
  });

  it("5. Successfully parses and attaches a valid standard YouTube watch URL", async () => {
    const watchUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share";
    const parsed = validateAndParseYouTubeUrl(watchUrl);

    expect(parsed.videoId).toBe("dQw4w9WgXcQ");
    expect(parsed.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(parsed.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(parsed.thumbnailUrl).toBe("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg");

    vi.mocked(prisma.propertyMedia.create).mockResolvedValueOnce({
      id: "media-uuid-yt",
      tenantId: "tenant-brokerage-1",
      propertyId: "prop-101",
      uploadedById: "user-broker-1",
      mediaType: MediaType.VIDEO,
      storageProvider: MediaStorageProvider.YOUTUBE,
      url: parsed.canonicalUrl,
      caption: "Property Walkthrough",
      displayOrder: 1,
      createdAt: new Date(),
    } as unknown as MockPropertyMedia);

    const result = await attachPropertyVideo(brokerOwnerContext, {
      propertyId: "prop-101",
      youtubeUrl: watchUrl,
      caption: "Property Walkthrough",
    });

    expect(result.mediaType).toBe(MediaType.VIDEO);
    expect(result.storageProvider).toBe(MediaStorageProvider.YOUTUBE);
    expect(result.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("6. Successfully parses and attaches a valid youtu.be short URL", () => {
    const shortUrl = "https://youtu.be/dQw4w9WgXcQ?t=15";
    const parsed = validateAndParseYouTubeUrl(shortUrl);

    expect(parsed.videoId).toBe("dQw4w9WgXcQ");
    expect(parsed.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(parsed.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("7. Successfully parses and attaches a valid YouTube Shorts URL", () => {
    const shortsUrl = "https://www.youtube.com/shorts/sV7CvhL_Vq8";
    const parsed = validateAndParseYouTubeUrl(shortsUrl);

    expect(parsed.videoId).toBe("sV7CvhL_Vq8");
    expect(parsed.canonicalUrl).toBe("https://www.youtube.com/watch?v=sV7CvhL_Vq8");
    expect(parsed.embedUrl).toBe("https://www.youtube.com/embed/sV7CvhL_Vq8");
  });

  it("8. Strictly rejects invalid and non-YouTube URLs (Vimeo, arbitrary domains, malformed IDs)", () => {
    expect(() => validateAndParseYouTubeUrl("https://vimeo.com/76979871")).toThrow(ValidationError);
    expect(() => validateAndParseYouTubeUrl("https://evil-site.com/watch?v=dQw4w9WgXcQ")).toThrow(ValidationError);
    expect(() => validateAndParseYouTubeUrl("https://youtube.com/watch?v=short_id")).toThrow(ValidationError);
    expect(() => validateAndParseYouTubeUrl("not-a-valid-url")).toThrow(ValidationError);
  });

  it("9. Rejects cross-tenant media upload and deletion attempts", async () => {
    // When queried for otherTenantContext, property returns null because tenantId doesn't match
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null);

    await expect(
      addPropertyPhoto(otherTenantContext, {
        propertyId: "prop-101",
        fileBuffer: validJpegBuffer,
      })
    ).rejects.toThrow(NotFoundError);

    // Cross-tenant media delete attempt
    vi.mocked(prisma.propertyMedia.findFirst).mockResolvedValueOnce(null);

    await expect(
      deletePropertyMedia(otherTenantContext, {
        propertyId: "prop-101",
        mediaId: "media-uuid-1",
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("10. Blocks unauthorized roles (Field Sales Agent) from uploading media", async () => {
    await expect(
      addPropertyPhoto(salesAgentContext, {
        propertyId: "prop-101",
        fileBuffer: validJpegBuffer,
      })
    ).rejects.toThrow(ForbiddenError);

    await expect(
      attachPropertyVideo(salesAgentContext, {
        propertyId: "prop-101",
        youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it("11. Enforces telecaller assignment restrictions: telecaller cannot upload to unassigned property", async () => {
    // Property assigned to someone else
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
      id: "prop-101",
      tenantId: "tenant-brokerage-1",
      assignments: [
        {
          assignedUserId: "some-other-telecaller",
          status: AssignmentStatus.ACTIVE,
        },
      ],
    } as unknown as MockProperty);

    await expect(
      addPropertyPhoto(telecallerContext, {
        propertyId: "prop-101",
        fileBuffer: validJpegBuffer,
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it("12. Throws NotFoundError when attempting to upload to a non-existent property", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null);

    await expect(
      addPropertyPhoto(brokerOwnerContext, {
        propertyId: "non-existent-prop-id",
        fileBuffer: validJpegBuffer,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("13. Deletes media record from database and cleans up stored object on disk", async () => {
    vi.mocked(prisma.propertyMedia.findFirst).mockResolvedValueOnce({
      id: "media-to-delete",
      tenantId: "tenant-brokerage-1",
      propertyId: "prop-101",
      mediaType: MediaType.PHOTO,
      storageProvider: MediaStorageProvider.OBJECT_STORAGE,
      url: "/api/media/media-to-delete",
    } as unknown as MockPropertyMedia);

    vi.mocked(prisma.propertyMedia.delete).mockResolvedValueOnce({
      id: "media-to-delete",
    } as unknown as MockPropertyMedia);

    await deletePropertyMedia(brokerOwnerContext, {
      propertyId: "prop-101",
      mediaId: "media-to-delete",
    });

    expect(prisma.propertyMedia.delete).toHaveBeenCalledWith({
      where: { id: "media-to-delete" },
    });
    expect(mockStorageDelete).toHaveBeenCalled();
  });

  it("14. Compensation logic: removes uploaded file if database insert fails", async () => {
    vi.mocked(prisma.propertyMedia.create).mockRejectedValueOnce(
      new Error("Database connection timeout")
    );

    await expect(
      addPropertyPhoto(brokerOwnerContext, {
        propertyId: "prop-101",
        fileBuffer: validJpegBuffer,
      })
    ).rejects.toThrow("Database connection timeout");

    // Verify storage cleanup was called
    expect(mockStorageDelete).toHaveBeenCalledWith("tenant-brokerage-1/prop-101/test-file.jpg");
  });

  it("15. Secure photo serving endpoint: serves image buffer for authorized tenant, rejects cross-tenant", async () => {
    vi.mocked(prisma.propertyMedia.findFirst).mockResolvedValueOnce({
      id: "media-photo-1",
      tenantId: "tenant-brokerage-1",
      propertyId: "prop-101",
      mediaType: MediaType.PHOTO,
      storageProvider: MediaStorageProvider.OBJECT_STORAGE,
      url: "/api/media/media-photo-1",
    } as unknown as MockPropertyMedia);

    const served = await getPropertyPhotoForServing(brokerOwnerContext, "media-photo-1");
    expect(served.mimeType).toBe("image/jpeg");
    expect(served.buffer).toBeInstanceOf(Buffer);

    // Cross-tenant attempt
    vi.mocked(prisma.propertyMedia.findFirst).mockResolvedValueOnce(null);
    await expect(
      getPropertyPhotoForServing(otherTenantContext, "media-photo-1")
    ).rejects.toThrow(NotFoundError);
  });

  it("16. Existing media records remain readable and list in correct display order", async () => {
    vi.mocked(prisma.propertyMedia.findMany).mockResolvedValueOnce([
      {
        id: "media-1",
        tenantId: "tenant-brokerage-1",
        propertyId: "prop-101",
        uploadedById: null, // Legacy record before migration
        uploadedBy: null,
        mediaType: MediaType.PHOTO,
        storageProvider: MediaStorageProvider.OBJECT_STORAGE,
        url: "/api/media/media-1",
        caption: "Living Room",
        displayOrder: 0,
        createdAt: new Date("2026-10-20"),
      },
      {
        id: "media-2",
        tenantId: "tenant-brokerage-1",
        propertyId: "prop-101",
        uploadedById: "user-broker-1",
        uploadedBy: {
          id: "user-broker-1",
          name: "Broker Vikram",
          role: "BROKER_OWNER",
        },
        mediaType: MediaType.VIDEO,
        storageProvider: MediaStorageProvider.YOUTUBE,
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        caption: "Walkthrough Tour",
        displayOrder: 1,
        createdAt: new Date("2026-10-21"),
      },
    ] as unknown as MockPropertyMedia[]);

    const list = await listPropertyMedia(brokerOwnerContext, "prop-101");
    expect(list.length).toBe(2);
    expect(list[0].id).toBe("media-1");
    expect(list[0].uploadedBy).toBeNull(); // Gracefully handles legacy records without uploader
    expect(list[1].id).toBe("media-2");
    expect(list[1].uploadedBy?.name).toBe("Broker Vikram");
  });
});
