import { describe, it, expect } from "vitest";
import { normalizeIndianMobile, isValidIndianMobile } from "@/server/utils/phone";
import { ValidationError } from "@/server/errors";

describe("normalizeIndianMobile utility", () => {
  it("normalizes a standard 10-digit number starting with 6, 7, 8, or 9", () => {
    expect(normalizeIndianMobile("9810012345")).toBe("9810012345");
    expect(normalizeIndianMobile("8810012345")).toBe("8810012345");
    expect(normalizeIndianMobile("7810012345")).toBe("7810012345");
    expect(normalizeIndianMobile("6810012345")).toBe("6810012345");
  });

  it("normalizes numbers with +91 country code prefix and spaces/dashes", () => {
    expect(normalizeIndianMobile("+91 9810012345")).toBe("9810012345");
    expect(normalizeIndianMobile("+91-98100-12345")).toBe("9810012345");
    expect(normalizeIndianMobile("+91 98100 12345")).toBe("9810012345");
    expect(normalizeIndianMobile("+919810012345")).toBe("9810012345");
  });

  it("normalizes numbers with 91 prefix without plus sign", () => {
    expect(normalizeIndianMobile("919810012345")).toBe("9810012345");
  });

  it("normalizes numbers with leading 0 trunk prefix", () => {
    expect(normalizeIndianMobile("09810012345")).toBe("9810012345");
    expect(normalizeIndianMobile("0 98100 12345")).toBe("9810012345");
  });

  it("normalizes numbers with parentheses and mixed formatting", () => {
    expect(normalizeIndianMobile("+91 (98100) 12345")).toBe("9810012345");
    expect(normalizeIndianMobile("+91 (0) 98100 12345")).toBe("9810012345");
    expect(normalizeIndianMobile("(098100) 12345")).toBe("9810012345");
    expect(normalizeIndianMobile("0091 98100 12345")).toBe("9810012345");
  });

  it("rejects numbers starting with invalid digits (0-5)", () => {
    expect(() => normalizeIndianMobile("5810012345")).toThrow(ValidationError);
    expect(() => normalizeIndianMobile("+91 4810012345")).toThrow(ValidationError);
    expect(() => normalizeIndianMobile("0123456789")).toThrow(ValidationError);
  });

  it("rejects numbers that are too short", () => {
    expect(() => normalizeIndianMobile("981001234")).toThrow(ValidationError);
    expect(() => normalizeIndianMobile("12345")).toThrow(ValidationError);
  });

  it("rejects arbitrary numbers that are too long (does not silently truncate)", () => {
    expect(() => normalizeIndianMobile("98100123456")).toThrow(ValidationError);
    expect(() => normalizeIndianMobile("91981001234567")).toThrow(ValidationError);
  });

  it("rejects non-numeric characters", () => {
    expect(() => normalizeIndianMobile("98100abcde")).toThrow(ValidationError);
    expect(() => normalizeIndianMobile("+91 98100-TEST")).toThrow(ValidationError);
  });

  it("rejects empty, whitespace-only, or invalid input", () => {
    expect(() => normalizeIndianMobile("")).toThrow(ValidationError);
    expect(() => normalizeIndianMobile("   ")).toThrow(ValidationError);
    expect(() => normalizeIndianMobile(null as unknown as string)).toThrow(ValidationError);
  });

  it("isValidIndianMobile returns boolean correctly", () => {
    expect(isValidIndianMobile("+91 98100 12345")).toBe(true);
    expect(isValidIndianMobile("09810012345")).toBe(true);
    expect(isValidIndianMobile("invalid")).toBe(false);
    expect(isValidIndianMobile("5810012345")).toBe(false);
  });
});
