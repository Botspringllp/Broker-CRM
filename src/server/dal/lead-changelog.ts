import { Prisma } from "@prisma/client";

export type ChangeSource = "USER" | "SYSTEM" | "API";

export interface FieldComparison {
  fieldName: string;
  previousValue: unknown;
  newValue: unknown;
}

/**
 * Normalizes any value deterministically into a database-storable string or null.
 * - Decimal: normalized numeric string.
 * - Date: ISO 8601 string.
 * - Enum: string value.
 * - Boolean: "true" | "false".
 * - Arrays: deterministic JSON representation.
 * - Null/Undefined: actual null (not "null" string).
 */
export function serializeAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (
    Prisma.Decimal.isDecimal(value) ||
    (typeof value === "object" && value !== null && "toFixed" in value && "d" in value)
  ) {
    return new Prisma.Decimal(value as string | number | Prisma.Decimal).toString();
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Compares two values to determine if an actual semantic change occurred.
 * Returns true if equal (no-op), false if changed.
 */
export function areAuditValuesEqual(prev: unknown, next: unknown): boolean {
  // If both null or undefined
  if ((prev === null || prev === undefined) && (next === null || next === undefined)) {
    return true;
  }

  // If one is Decimal or numeric
  if (
    (typeof prev === "number" || Prisma.Decimal.isDecimal(prev)) &&
    (typeof next === "number" || Prisma.Decimal.isDecimal(next))
  ) {
    try {
      const dPrev = new Prisma.Decimal(prev as string | number | Prisma.Decimal);
      const dNext = new Prisma.Decimal(next as string | number | Prisma.Decimal);
      return dPrev.equals(dNext);
    } catch {
      // fallback to string comparison below
    }
  }

  // If arrays
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length === 0 && next.length === 0) return true;
    return JSON.stringify(prev) === JSON.stringify(next);
  }

  // If one is null/undefined and the other is empty array or empty string
  if (
    (prev === null || prev === undefined) &&
    ((Array.isArray(next) && next.length === 0) || (typeof next === "string" && next.trim() === ""))
  ) {
    return true;
  }
  if (
    (next === null || next === undefined) &&
    ((Array.isArray(prev) && prev.length === 0) || (typeof prev === "string" && prev.trim() === ""))
  ) {
    return true;
  }

  // String / general serialization comparison
  const sPrev = serializeAuditValue(prev);
  const sNext = serializeAuditValue(next);
  return sPrev === sNext;
}

export interface RecordLeadFieldChangesInput {
  tx: Prisma.TransactionClient;
  tenantId: string;
  leadId: string;
  changedByUserId?: string | null;
  changeSource: ChangeSource;
  changes: FieldComparison[];
}

/**
 * Atomically inserts LeadChangeLog records for changed fields within a Prisma transaction.
 * Skips unchanged fields (no-ops).
 */
export async function recordLeadFieldChanges({
  tx,
  tenantId,
  leadId,
  changedByUserId = null,
  changeSource,
  changes,
}: RecordLeadFieldChangesInput): Promise<number> {
  const recordsToInsert: Prisma.LeadChangeLogCreateManyInput[] = [];

  for (const change of changes) {
    if (!areAuditValuesEqual(change.previousValue, change.newValue)) {
      recordsToInsert.push({
        tenantId,
        leadId,
        fieldName: change.fieldName,
        previousValue: serializeAuditValue(change.previousValue),
        newValue: serializeAuditValue(change.newValue),
        changedByUserId: changedByUserId ?? null,
        changeSource,
      });
    }
  }

  if (recordsToInsert.length === 0) {
    return 0;
  }

  if (tx.leadChangeLog?.createMany) {
    await tx.leadChangeLog.createMany({
      data: recordsToInsert,
    });
  }

  return recordsToInsert.length;
}
