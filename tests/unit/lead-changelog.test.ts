import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  serializeAuditValue,
  areAuditValuesEqual,
  recordLeadFieldChanges,
} from "@/server/dal/lead-changelog";

describe("Lead Change Log Helper (DV-05 Engine)", () => {
  describe("serializeAuditValue", () => {
    it("returns null for null or undefined without storing 'null' string", () => {
      expect(serializeAuditValue(null)).toBeNull();
      expect(serializeAuditValue(undefined)).toBeNull();
    });

    it("serializes strings and trims whitespace, returning null for empty strings", () => {
      expect(serializeAuditValue("  Vikramaditya  ")).toBe("Vikramaditya");
      expect(serializeAuditValue("")).toBeNull();
      expect(serializeAuditValue("   ")).toBeNull();
    });

    it("serializes numbers and finite values", () => {
      expect(serializeAuditValue(42)).toBe("42");
      expect(serializeAuditValue(0)).toBe("0");
      expect(serializeAuditValue(NaN)).toBeNull();
    });

    it("serializes booleans to 'true' and 'false'", () => {
      expect(serializeAuditValue(true)).toBe("true");
      expect(serializeAuditValue(false)).toBe("false");
    });

    it("serializes Dates to ISO 8601 strings", () => {
      const date = new Date("2026-05-15T10:30:00.000Z");
      expect(serializeAuditValue(date)).toBe("2026-05-15T10:30:00.000Z");
      expect(serializeAuditValue(new Date("invalid"))).toBeNull();
    });

    it("serializes Prisma.Decimal and numeric decimals to normalized strings", () => {
      const dec = new Prisma.Decimal("15000000.00");
      expect(serializeAuditValue(dec)).toBe("15000000");
    });

    it("serializes arrays to deterministic JSON, returning null for empty arrays", () => {
      expect(serializeAuditValue([])).toBeNull();
      expect(serializeAuditValue(["2 BHK", "3 BHK"])).toBe('["2 BHK","3 BHK"]');
    });
  });

  describe("areAuditValuesEqual", () => {
    it("recognizes identical primitives and nulls as equal", () => {
      expect(areAuditValuesEqual(null, null)).toBe(true);
      expect(areAuditValuesEqual(undefined, null)).toBe(true);
      expect(areAuditValuesEqual("Gurugram", "Gurugram")).toBe(true);
      expect(areAuditValuesEqual(100, 100)).toBe(true);
      expect(areAuditValuesEqual(true, true)).toBe(true);
    });

    it("recognizes empty string and null as equal (no spurious log)", () => {
      expect(areAuditValuesEqual("", null)).toBe(true);
      expect(areAuditValuesEqual(null, "  ")).toBe(true);
    });

    it("recognizes empty array and null as equal", () => {
      expect(areAuditValuesEqual([], null)).toBe(true);
      expect(areAuditValuesEqual(null, [])).toBe(true);
      expect(areAuditValuesEqual([], [])).toBe(true);
    });

    it("recognizes numeric values and Decimal equivalents as equal", () => {
      const dec = new Prisma.Decimal("5000000.00");
      expect(areAuditValuesEqual(dec, 5000000)).toBe(true);
      expect(areAuditValuesEqual(5000000, dec)).toBe(true);
      expect(areAuditValuesEqual(new Prisma.Decimal("5000000"), new Prisma.Decimal("5000000.00"))).toBe(true);
      expect(areAuditValuesEqual(dec, 6000000)).toBe(false);
    });

    it("detects array differences", () => {
      expect(areAuditValuesEqual(["2 BHK"], ["2 BHK"])).toBe(true);
      expect(areAuditValuesEqual(["2 BHK"], ["3 BHK"])).toBe(false);
      expect(areAuditValuesEqual(["2 BHK"], ["2 BHK", "3 BHK"])).toBe(false);
    });
  });

  describe("recordLeadFieldChanges", () => {
    it("inserts records into tx.leadChangeLog for changed fields and skips unchanged fields", async () => {
      const mockCreateMany = vi.fn().mockResolvedValue({ count: 2 });
      const mockTx = {
        leadChangeLog: {
          createMany: mockCreateMany,
        },
      } as unknown as Prisma.TransactionClient;

      const count = await recordLeadFieldChanges({
        tx: mockTx,
        tenantId: "tenant-alpha",
        leadId: "lead-1",
        changedByUserId: "user-123",
        changeSource: "USER",
        changes: [
          { fieldName: "name", previousValue: "Old Name", newValue: "New Name" },
          { fieldName: "minBudget", previousValue: new Prisma.Decimal(5000000), newValue: 5000000 }, // No-op!
          { fieldName: "city", previousValue: "Delhi", newValue: "Gurugram" },
          { fieldName: "alternatePhone", previousValue: null, newValue: null }, // No-op!
        ],
      });

      expect(count).toBe(2);
      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          {
            tenantId: "tenant-alpha",
            leadId: "lead-1",
            fieldName: "name",
            previousValue: "Old Name",
            newValue: "New Name",
            changedByUserId: "user-123",
            changeSource: "USER",
          },
          {
            tenantId: "tenant-alpha",
            leadId: "lead-1",
            fieldName: "city",
            previousValue: "Delhi",
            newValue: "Gurugram",
            changedByUserId: "user-123",
            changeSource: "USER",
          },
        ],
      });
    });

    it("returns 0 and does not call createMany when all fields are identical (no-op update)", async () => {
      const mockCreateMany = vi.fn();
      const mockTx = {
        leadChangeLog: {
          createMany: mockCreateMany,
        },
      } as unknown as Prisma.TransactionClient;

      const count = await recordLeadFieldChanges({
        tx: mockTx,
        tenantId: "tenant-alpha",
        leadId: "lead-1",
        changedByUserId: "user-123",
        changeSource: "USER",
        changes: [
          { fieldName: "name", previousValue: "Same", newValue: "Same" },
          { fieldName: "preference", previousValue: "SALE", newValue: "SALE" },
        ],
      });

      expect(count).toBe(0);
      expect(mockCreateMany).not.toHaveBeenCalled();
    });

    it("handles null-to-value and value-to-null transitions properly", async () => {
      const mockCreateMany = vi.fn().mockResolvedValue({ count: 2 });
      const mockTx = {
        leadChangeLog: {
          createMany: mockCreateMany,
        },
      } as unknown as Prisma.TransactionClient;

      const count = await recordLeadFieldChanges({
        tx: mockTx,
        tenantId: "tenant-alpha",
        leadId: "lead-1",
        changedByUserId: null,
        changeSource: "SYSTEM",
        changes: [
          { fieldName: "email", previousValue: null, newValue: "prospect@example.com" }, // Null-to-value
          { fieldName: "alternatePhone", previousValue: "9810012345", newValue: null }, // Value-to-null
        ],
      });

      expect(count).toBe(2);
      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          {
            tenantId: "tenant-alpha",
            leadId: "lead-1",
            fieldName: "email",
            previousValue: null,
            newValue: "prospect@example.com",
            changedByUserId: null,
            changeSource: "SYSTEM",
          },
          {
            tenantId: "tenant-alpha",
            leadId: "lead-1",
            fieldName: "alternatePhone",
            previousValue: "9810012345",
            newValue: null,
            changedByUserId: null,
            changeSource: "SYSTEM",
          },
        ],
      });
    });
  });
});
