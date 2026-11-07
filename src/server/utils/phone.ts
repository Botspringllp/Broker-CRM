import { ValidationError } from "../errors";

/**
 * Normalizes and validates an Indian mobile number.
 *
 * Supported formats:
 * - 10 digits: "9810012345"
 * - Country code prefixed: "+91 98100 12345", "+919810012345", "919810012345"
 * - Trunk prefix: "09810012345"
 * - Common formatting characters: spaces, hyphens, parentheses, dots
 * - Combined prefix: "+91 (0) 98100 12345", "+91-09810012345"
 *
 * Normalization & Validation Rules:
 * - Strips common formatting characters (+, -, (, ), spaces, dots).
 * - Strips standard prefixes (0091, +910, 910, +91, 91, 0) strictly when the remaining digits form a valid length.
 * - Does NOT silently truncate arbitrary longer numbers.
 * - Enforces exact 10 digits.
 * - Enforces valid Indian mobile starting digit: ^[6-9]\d{9}$.
 * - Throws a typed ValidationError on invalid inputs.
 */
export function normalizeIndianMobile(raw: string): string {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    throw new ValidationError("Mobile number is required.");
  }

  const trimmed = raw.trim();

  // Strip common punctuation characters
  let cleaned = trimmed.replace(/[\s\-\(\)\.]/g, "");

  // Strip leading international '+' prefix
  if (cleaned.startsWith("+")) {
    cleaned = cleaned.slice(1);
  }

  // Handle standard international / trunk prefixes strictly by length
  if (cleaned.length === 14 && cleaned.startsWith("0091")) {
    cleaned = cleaned.slice(4);
  } else if (cleaned.length === 13 && cleaned.startsWith("910")) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.length === 12 && cleaned.startsWith("91")) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.length === 11 && cleaned.startsWith("0")) {
    cleaned = cleaned.slice(1);
  }

  // Verify that only digits remain
  if (!/^\d+$/.test(cleaned)) {
    throw new ValidationError(
      `Invalid mobile number format "${raw}". Only numeric digits and standard prefixes are allowed.`
    );
  }

  // Verify length
  if (cleaned.length !== 10) {
    throw new ValidationError(
      `Invalid mobile number length for "${raw}". Expected a 10-digit Indian mobile number.`
    );
  }

  // Verify Indian mobile number prefix (starts with 6, 7, 8, or 9)
  if (!/^[6-9]\d{9}$/.test(cleaned)) {
    throw new ValidationError(
      `Invalid Indian mobile number "${raw}". Indian mobile numbers must start with 6, 7, 8, or 9.`
    );
  }

  return cleaned;
}

/**
 * Checks whether the given string is a valid Indian mobile number without throwing.
 */
export function isValidIndianMobile(raw: string): boolean {
  try {
    normalizeIndianMobile(raw);
    return true;
  } catch {
    return false;
  }
}
