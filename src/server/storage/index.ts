import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { ValidationError } from "../errors";

export const MAX_PHOTO_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_PHOTO_BATCH_COUNT = 10; // Max 10 photos per upload batch

export interface StorageFileResult {
  storageKey: string;
  sizeBytes: number;
  mimeType: string;
}

export interface StoredFileData {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
}

export interface StorageAdapter {
  savePhoto(params: {
    tenantId: string;
    propertyId: string;
    buffer: Buffer;
    mimeType: string;
    extension: string;
  }): Promise<StorageFileResult>;

  readPhoto(storageKey: string): Promise<StoredFileData>;

  deletePhoto(storageKey: string): Promise<void>;
}

/**
 * Validates image buffer using magic bytes (file signatures)
 * Supports JPEG, PNG, and WebP only.
 * Disallows SVG, PDF, Executables, HTML, MP4, etc.
 */
export function validateImageBuffer(buffer: Buffer): {
  isValid: boolean;
  mimeType: string;
  extension: string;
  error?: string;
} {
  if (!buffer || buffer.length === 0) {
    return { isValid: false, mimeType: "", extension: "", error: "File buffer is empty." };
  }

  if (buffer.length > MAX_PHOTO_FILE_SIZE_BYTES) {
    return {
      isValid: false,
      mimeType: "",
      extension: "",
      error: `File size (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of 5 MB.`,
    };
  }

  // Check JPEG signature: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { isValid: true, mimeType: "image/jpeg", extension: "jpg" };
  }

  // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { isValid: true, mimeType: "image/png", extension: "png" };
  }

  // Check WebP signature: RIFF .... WEBP
  // Offset 0-3: 52 49 46 46 (RIFF), Offset 8-11: 57 45 42 50 (WEBP)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { isValid: true, mimeType: "image/webp", extension: "webp" };
  }

  return {
    isValid: false,
    mimeType: "",
    extension: "",
    error: "Unsupported file format. Only JPEG, PNG, and WebP images are allowed.",
  };
}

/**
 * Local filesystem storage adapter.
 * Stores files outside the public directory in storage/uploads/{tenantId}/{propertyId}/
 * Prevents path traversal and uses cryptographically safe random filenames.
 */
export class LocalStorageAdapter implements StorageAdapter {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(process.cwd(), "storage", "uploads");
  }

  private resolveSafePath(storageKey: string): string {
    // Normalize and prevent directory traversal
    const safeKey = storageKey.replace(/\\/g, "/");
    const resolved = path.resolve(this.baseDir, safeKey);
    const resolvedBase = path.resolve(this.baseDir);

    if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
      throw new ValidationError("Invalid storage path reference.");
    }
    return resolved;
  }

  async savePhoto(params: {
    tenantId: string;
    propertyId: string;
    buffer: Buffer;
    mimeType: string;
    extension: string;
  }): Promise<StorageFileResult> {
    const fileId = crypto.randomUUID();
    const cleanExt = params.extension.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "jpg";
    const filename = `${fileId}.${cleanExt}`;

    // Target directory: {baseDir}/{tenantId}/{propertyId}
    const cleanTenant = params.tenantId.replace(/[^a-zA-Z0-9_-]/g, "");
    const cleanProperty = params.propertyId.replace(/[^a-zA-Z0-9_-]/g, "");
    const dirPath = path.join(this.baseDir, cleanTenant, cleanProperty);

    await fs.mkdir(dirPath, { recursive: true });

    const filePath = path.join(/*turbopackIgnore: true*/ dirPath, filename);
    await fs.writeFile(filePath, params.buffer);

    const storageKey = `${cleanTenant}/${cleanProperty}/${filename}`;

    return {
      storageKey,
      sizeBytes: params.buffer.length,
      mimeType: params.mimeType,
    };
  }

  async readPhoto(storageKey: string): Promise<StoredFileData> {
    const filePath = this.resolveSafePath(storageKey);
    try {
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase().replace(".", "");
      let mimeType = "image/jpeg";
      if (ext === "png") mimeType = "image/png";
      if (ext === "webp") mimeType = "image/webp";

      return {
        buffer,
        mimeType,
        sizeBytes: buffer.length,
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ValidationError("Requested media file does not exist on disk.");
      }
      throw err;
    }
  }

  async deletePhoto(storageKey: string): Promise<void> {
    if (!storageKey) return;
    try {
      const filePath = this.resolveSafePath(storageKey);
      await fs.unlink(filePath);
    } catch (err: unknown) {
      // Ignore if file was already removed
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[LocalStorageAdapter] Failed to delete file ${storageKey}:`, err);
      }
    }
  }
}

// Singleton storage instance
let currentAdapter: StorageAdapter = new LocalStorageAdapter();

export function getStorageAdapter(): StorageAdapter {
  return currentAdapter;
}

export function setStorageAdapterForTesting(adapter: StorageAdapter): void {
  currentAdapter = adapter;
}
