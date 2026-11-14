import crypto from "crypto";
import { ValidationError } from "../errors";

export interface GeneratedSiteVisitToken {
  /** Raw 64-character hex bearer token returned ONLY at creation time to authorized user */
  rawToken: string;
  /** SHA-256 hex hash stored in database `SiteVisitAccessLink.tokenHash` */
  tokenHash: string;
}

const HEX_64_REGEX = /^[0-9a-f]{64}$/i;

/**
 * Validates that a string matches the required 64-character hex format for site visit tokens.
 */
export function isValidSiteVisitTokenFormat(token: unknown): token is string {
  if (typeof token !== "string") return false;
  return HEX_64_REGEX.test(token.trim());
}

/**
 * Generates a cryptographically secure 256-bit bearer token and its SHA-256 hash.
 * - Uses `crypto.randomBytes(32)` to provide 256 bits of entropy.
 * - The raw token is returned ONLY for delivery in the URL (`/m/visits/[token]`).
 * - Only `tokenHash` should ever be persisted in the database (`SiteVisitAccessLink.tokenHash`).
 */
export function generateSiteVisitToken(): GeneratedSiteVisitToken {
  const tokenBytes = crypto.randomBytes(32);
  const rawToken = tokenBytes.toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  return { rawToken, tokenHash };
}

/**
 * Computes the SHA-256 hash of a raw token after validating its 64-character hex format.
 * Throws a ValidationError if the token format is invalid.
 * Never logs or reveals the raw token in error messages.
 */
export function hashSiteVisitToken(rawToken: string): string {
  if (!isValidSiteVisitTokenFormat(rawToken)) {
    throw new ValidationError("Invalid site visit access token format.");
  }
  return crypto.createHash("sha256").update(rawToken.trim().toLowerCase()).digest("hex");
}

/**
 * Constant-time comparison to verify a raw token against a stored SHA-256 hash.
 * Prevents timing attacks by comparing hash buffers using `crypto.timingSafeEqual`.
 * Returns false rather than throwing if inputs are malformed.
 */
export function verifySiteVisitTokenHash(rawToken: string, storedHash: string): boolean {
  if (!isValidSiteVisitTokenFormat(rawToken) || !isValidSiteVisitTokenFormat(storedHash)) {
    return false;
  }

  try {
    const computedHash = crypto
      .createHash("sha256")
      .update(rawToken.trim().toLowerCase())
      .digest("hex");

    const computedBuffer = Buffer.from(computedHash, "hex");
    const storedBuffer = Buffer.from(storedHash.trim().toLowerCase(), "hex");

    if (computedBuffer.length !== storedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(computedBuffer, storedBuffer);
  } catch {
    return false;
  }
}
