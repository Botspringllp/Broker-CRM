import crypto from "crypto";

export interface GeneratedWebhookToken {
  /**
   * Cryptographically secure raw webhook token (64-character hex string).
   * Returned ONLY once upon generation/rotation to be shared with the portal.
   * MUST NEVER be logged or stored in the database.
   */
  rawToken: string;
  /**
   * SHA-256 hash of the raw token (64-character hex string).
   * Safe to persist in the database for future incoming webhook verification.
   */
  tokenHash: string;
}

export interface RotatedWebhookToken extends GeneratedWebhookToken {
  previousHash: string;
  rotatedAt: Date;
}

/**
 * Minimum acceptable length for a raw portal webhook token.
 */
const MIN_RAW_TOKEN_LENGTH = 32;

/**
 * Generates a cryptographically secure random token (256 bits of entropy / 64 hex characters)
 * and its corresponding SHA-256 hash.
 */
export function generateWebhookToken(): GeneratedWebhookToken {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashWebhookToken(rawToken);
  return { rawToken, tokenHash };
}

/**
 * Computes the SHA-256 hash of a raw webhook token.
 */
export function hashWebhookToken(rawToken: string): string {
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim().length === 0) {
    throw new Error("Cannot hash an empty or invalid webhook token.");
  }
  return crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
}

/**
 * Verifies a candidate raw webhook token against a stored SHA-256 hash
 * using constant-time comparison to prevent timing attack side-channels.
 */
export function verifyWebhookToken(candidateToken: string, storedHash: string): boolean {
  if (
    !candidateToken ||
    typeof candidateToken !== "string" ||
    candidateToken.trim().length < MIN_RAW_TOKEN_LENGTH ||
    !storedHash ||
    typeof storedHash !== "string"
  ) {
    return false;
  }

  const candidateHash = hashWebhookToken(candidateToken);

  // Both SHA-256 hex digests must be exactly 64 characters (32 bytes when hex decoded)
  const candidateBuf = Buffer.from(candidateHash, "hex");
  const storedBuf = Buffer.from(storedHash, "hex");

  if (candidateBuf.length !== 32 || storedBuf.length !== 32) {
    return false;
  }

  return crypto.timingSafeEqual(candidateBuf, storedBuf);
}

/**
 * Rotates a webhook token by generating a new cryptographically secure token/hash pair
 * while capturing the previous hash and rotation timestamp.
 */
export function rotateWebhookToken(currentHash: string): RotatedWebhookToken {
  if (!currentHash || typeof currentHash !== "string" || currentHash.length !== 64) {
    throw new Error("Invalid current token hash provided for rotation.");
  }

  const { rawToken, tokenHash } = generateWebhookToken();

  // Defense-in-depth: Ensure the rotated hash differs from the current hash
  if (tokenHash === currentHash) {
    throw new Error("Token rotation collision: generated token identical to previous token.");
  }

  return {
    rawToken,
    tokenHash,
    previousHash: currentHash,
    rotatedAt: new Date(),
  };
}

/**
 * Recursively serializes a JavaScript value into a deterministic canonical JSON string.
 *
 * Rules:
 * - Object keys are sorted lexicographically at every nesting depth.
 * - Array element order is strictly preserved.
 * - Primitives (string, number, boolean, null) are serialized per standard JSON specs.
 * - Undefined, functions, and symbols in objects are omitted (matching JSON.stringify).
 * - Undefined, functions, and symbols in arrays serialize to null (matching JSON.stringify).
 * - BigInt values throw a TypeError.
 * - Circular references throw a TypeError.
 * - Diamond / DAG structures (shared sub-object references without cycles) are safely serialized.
 * - Objects with `.toJSON()` methods (e.g., Date) are resolved prior to serialization.
 */
export function canonicalizeJson(value: unknown, stack = new Set<object>()): string {
  if (value === null) {
    return "null";
  }

  // Handle .toJSON() if present (e.g. Date or custom serializable objects)
  if (
    typeof value === "object" &&
    typeof (value as { toJSON?: unknown }).toJSON === "function"
  ) {
    value = (value as { toJSON: () => unknown }).toJSON();
    if (value === null) {
      return "null";
    }
  }

  const type = typeof value;

  if (type === "string") {
    return JSON.stringify(value);
  }

  if (type === "number") {
    // In JSON, NaN and Infinity serialize to null
    return Number.isFinite(value) ? String(value) : "null";
  }

  if (type === "boolean") {
    return value ? "true" : "false";
  }

  if (type === "bigint") {
    throw new TypeError("BigInt values are not supported in canonical JSON serialization.");
  }

  if (type !== "object") {
    // undefined, function, symbol at root level serialize to "null" in JSON context
    return "null";
  }

  const obj = value as object;

  if (stack.has(obj)) {
    throw new TypeError("Cyclic or circular payload reference detected during canonical serialization.");
  }

  stack.add(obj);

  try {
    if (Array.isArray(obj)) {
      const items = obj.map((item) => {
        if (
          item === undefined ||
          typeof item === "function" ||
          typeof item === "symbol"
        ) {
          return "null";
        }
        return canonicalizeJson(item, stack);
      });
      return `[${items.join(",")}]`;
    }

    // Plain object: sort keys lexicographically
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries: string[] = [];

    for (const key of keys) {
      const val = record[key];
      // In JSON objects, undefined, function, and symbol properties are omitted
      if (
        val === undefined ||
        typeof val === "function" ||
        typeof val === "symbol"
      ) {
        continue;
      }
      entries.push(`${JSON.stringify(key)}:${canonicalizeJson(val, stack)}`);
    }

    return `{${entries.join(",")}}`;
  } finally {
    stack.delete(obj);
  }
}

/**
 * Generates a deterministic idempotency key for portal payloads when
 * the external provider does not supply an explicit event identifier.
 * Uses recursive canonical JSON serialization to guarantee consistent hashing
 * across key ordering at every nesting level, while preserving array ordering
 * and safely rejecting cyclic structures.
 */
export function generatePayloadIdempotencyKey(payload: unknown): string {
  if (payload === null || payload === undefined) {
    throw new Error("Cannot generate an idempotency key for null or undefined payload.");
  }

  let target = payload;
  if (typeof target === "string") {
    const trimmed = target.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        target = JSON.parse(trimmed);
      } catch {
        target = trimmed;
      }
    } else {
      target = trimmed;
    }
  }

  const canonical =
    typeof target === "string" ? target : canonicalizeJson(target);

  const hash = crypto.createHash("sha256").update(canonical).digest("hex");
  return `payload_${hash}`;
}
