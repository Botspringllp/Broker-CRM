import { describe, it, expect } from "vitest";
import {
  generateWebhookToken,
  hashWebhookToken,
  verifyWebhookToken,
  rotateWebhookToken,
  generatePayloadIdempotencyKey,
  canonicalizeJson,
} from "@/server/security/portal-tokens";

describe("Portal Token Security & Hashing Utilities", () => {
  it("1. Token generation produces sufficiently random, cryptographically secure 256-bit tokens", () => {
    const { rawToken, tokenHash } = generateWebhookToken();

    // 32 bytes = 64 hex characters
    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);

    // Verify randomness across multiple samples (no duplicates in 100 iterations)
    const samples = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const generated = generateWebhookToken();
      expect(samples.has(generated.rawToken)).toBe(false);
      samples.add(generated.rawToken);
    }
    expect(samples.size).toBe(100);
  });

  it("2. Different generated tokens produce different SHA-256 hashes", () => {
    const tokenA = generateWebhookToken();
    const tokenB = generateWebhookToken();

    expect(tokenA.rawToken).not.toBe(tokenB.rawToken);
    expect(tokenA.tokenHash).not.toBe(tokenB.tokenHash);

    // Verify hash matches independent computation
    const recomputedHashA = hashWebhookToken(tokenA.rawToken);
    expect(recomputedHashA).toBe(tokenA.tokenHash);
  });

  it("3. Valid token verification succeeds using constant-time comparison", () => {
    const { rawToken, tokenHash } = generateWebhookToken();

    const isValid = verifyWebhookToken(rawToken, tokenHash);
    expect(isValid).toBe(true);
  });

  it("4. Invalid token verification fails reliably across tampering vectors", () => {
    const { rawToken, tokenHash } = generateWebhookToken();

    // Tampered raw token
    const tamperedToken = rawToken.slice(0, -1) + (rawToken.slice(-1) === "a" ? "b" : "a");
    expect(verifyWebhookToken(tamperedToken, tokenHash)).toBe(false);

    // Completely different token
    const otherToken = generateWebhookToken().rawToken;
    expect(verifyWebhookToken(otherToken, tokenHash)).toBe(false);

    // Empty or short tokens
    expect(verifyWebhookToken("", tokenHash)).toBe(false);
    expect(verifyWebhookToken("short-token", tokenHash)).toBe(false);

    // Empty or invalid hash
    expect(verifyWebhookToken(rawToken, "")).toBe(false);
    expect(verifyWebhookToken(rawToken, "invalid-hash")).toBe(false);
  });

  it("5. Token rotation invalidates the previous token and issues a fresh valid pair", () => {
    const initial = generateWebhookToken();

    // Rotate token
    const rotated = rotateWebhookToken(initial.tokenHash);

    expect(rotated.rawToken).not.toBe(initial.rawToken);
    expect(rotated.tokenHash).not.toBe(initial.tokenHash);
    expect(rotated.previousHash).toBe(initial.tokenHash);
    expect(rotated.rotatedAt instanceof Date).toBe(true);

    // New token verifies against new hash
    expect(verifyWebhookToken(rotated.rawToken, rotated.tokenHash)).toBe(true);

    // Old raw token FAILS verification against new hash
    expect(verifyWebhookToken(initial.rawToken, rotated.tokenHash)).toBe(false);

    // New raw token FAILS verification against old hash
    expect(verifyWebhookToken(rotated.rawToken, initial.tokenHash)).toBe(false);
  });

  it("6. generatePayloadIdempotencyKey generates deterministic keys and normalizes key order", () => {
    const payload1 = {
      lead_id: "lead_123",
      name: "Ramesh Kumar",
      phone: "9810011223",
      city: "Gurugram",
    };

    // Payload with reversed key order
    const payload2 = {
      city: "Gurugram",
      phone: "9810011223",
      name: "Ramesh Kumar",
      lead_id: "lead_123",
    };

    const key1 = generatePayloadIdempotencyKey(payload1);
    const key2 = generatePayloadIdempotencyKey(payload2);

    expect(key1).toBe(key2);
    expect(key1).toMatch(/^payload_[0-9a-f]{64}$/);

    // Different payload produces different idempotency key
    const payloadDifferent = { ...payload1, phone: "9810099887" };
    const keyDifferent = generatePayloadIdempotencyKey(payloadDifferent);
    expect(keyDifferent).not.toBe(key1);
  });

  it("7. Canonical JSON serialization sorts keys recursively at all nesting depths", () => {
    const deepObj1 = {
      z_outer: "last",
      a_outer: {
        y_inner: 200,
        x_inner: {
          beta: "second",
          alpha: "first",
        },
      },
    };

    const deepObj2 = {
      a_outer: {
        x_inner: {
          alpha: "first",
          beta: "second",
        },
        y_inner: 200,
      },
      z_outer: "last",
    };

    const canonical1 = canonicalizeJson(deepObj1);
    const canonical2 = canonicalizeJson(deepObj2);

    expect(canonical1).toBe(canonical2);
    expect(canonical1).toBe(
      '{"a_outer":{"x_inner":{"alpha":"first","beta":"second"},"y_inner":200},"z_outer":"last"}'
    );

    const key1 = generatePayloadIdempotencyKey(deepObj1);
    const key2 = generatePayloadIdempotencyKey(deepObj2);
    expect(key1).toBe(key2);
  });

  it("8. Array ordering is strictly preserved while objects inside arrays are recursively sorted", () => {
    const payloadA = {
      items: [
        { z: 9, a: 1 },
        { y: 8, b: 2 },
      ],
    };

    // Same array order, but inverted keys within the array objects
    const payloadB = {
      items: [
        { a: 1, z: 9 },
        { b: 2, y: 8 },
      ],
    };

    // Reversed array elements
    const payloadReversedArray = {
      items: [
        { b: 2, y: 8 },
        { a: 1, z: 9 },
      ],
    };

    const keyA = generatePayloadIdempotencyKey(payloadA);
    const keyB = generatePayloadIdempotencyKey(payloadB);
    const keyReversed = generatePayloadIdempotencyKey(payloadReversedArray);

    // Normalizing keys within array items matches
    expect(keyA).toBe(keyB);

    // Changing array order MUST produce a different hash
    expect(keyA).not.toBe(keyReversed);

    // Raw array tests
    expect(canonicalizeJson([1, 2, 3])).toBe("[1,2,3]");
    expect(canonicalizeJson([3, 2, 1])).toBe("[3,2,1]");
    expect(canonicalizeJson([1, 2, 3])).not.toBe(canonicalizeJson([3, 2, 1]));
  });

  it("9. Materially different nested values produce different hashes", () => {
    const base = {
      buyer: {
        name: "Vikram Malhotra",
        contact: {
          phone: "9810011223",
          email: "vikram@example.com",
        },
      },
    };

    const variation1 = {
      buyer: {
        name: "Vikram Malhotra",
        contact: {
          phone: "9810099887", // different phone
          email: "vikram@example.com",
        },
      },
    };

    const variation2 = {
      buyer: {
        name: "Vikram Malhotra",
        contact: {
          phone: "9810011223",
          email: "vikram.m@example.com", // different email
        },
      },
    };

    const keyBase = generatePayloadIdempotencyKey(base);
    const keyVar1 = generatePayloadIdempotencyKey(variation1);
    const keyVar2 = generatePayloadIdempotencyKey(variation2);

    expect(keyBase).not.toBe(keyVar1);
    expect(keyBase).not.toBe(keyVar2);
    expect(keyVar1).not.toBe(keyVar2);
  });

  it("10. Correctly handles primitive types, null, empty structures, and stringified JSON", () => {
    // Preserves null values in objects
    const objWithNull = { name: "Rajesh", phone: null };
    expect(canonicalizeJson(objWithNull)).toBe('{"name":"Rajesh","phone":null}');

    // Empty object and array
    expect(canonicalizeJson({})).toBe("{}");
    expect(canonicalizeJson([])).toBe("[]");

    const keyEmptyObj = generatePayloadIdempotencyKey({});
    const keyEmptyArr = generatePayloadIdempotencyKey([]);
    expect(keyEmptyObj).toMatch(/^payload_[0-9a-f]{64}$/);
    expect(keyEmptyArr).toMatch(/^payload_[0-9a-f]{64}$/);
    expect(keyEmptyObj).not.toBe(keyEmptyArr);

    // Numbers, booleans, Date handling
    const mixed = {
      active: true,
      pending: false,
      count: 42,
      price: 15000000.5,
      date: new Date("2026-11-15T10:00:00.000Z"),
    };
    expect(canonicalizeJson(mixed)).toBe(
      '{"active":true,"count":42,"date":"2026-11-15T10:00:00.000Z","pending":false,"price":15000000.5}'
    );

    // Stringified JSON matching parsed object
    const rawJsonString = '{"b": 2, "a": 1}';
    const parsedObject = { a: 1, b: 2 };
    expect(generatePayloadIdempotencyKey(rawJsonString)).toBe(
      generatePayloadIdempotencyKey(parsedObject)
    );

    // Throws on null or undefined payload argument
    expect(() => generatePayloadIdempotencyKey(null)).toThrow(
      "Cannot generate an idempotency key for null or undefined payload."
    );
    expect(() => generatePayloadIdempotencyKey(undefined)).toThrow(
      "Cannot generate an idempotency key for null or undefined payload."
    );
  });

  it("11. Rejects cyclic and circular references safely with a TypeError", () => {
    // Direct circular object reference
    const cyclicObj: Record<string, unknown> = { name: "Loop" };
    cyclicObj.self = cyclicObj;

    expect(() => canonicalizeJson(cyclicObj)).toThrow(TypeError);
    expect(() => canonicalizeJson(cyclicObj)).toThrow(
      /Cyclic or circular payload reference detected/
    );
    expect(() => generatePayloadIdempotencyKey(cyclicObj)).toThrow(TypeError);

    // Indirect circular object reference
    const nodeA: Record<string, unknown> = { id: "A" };
    const nodeB: Record<string, unknown> = { id: "B" };
    nodeA.next = nodeB;
    nodeB.prev = nodeA;

    expect(() => canonicalizeJson(nodeA)).toThrow(TypeError);
    expect(() => generatePayloadIdempotencyKey(nodeA)).toThrow(TypeError);

    // Circular array reference
    const cyclicArray: unknown[] = ["start"];
    cyclicArray.push(cyclicArray);

    expect(() => canonicalizeJson(cyclicArray)).toThrow(TypeError);
    expect(() => generatePayloadIdempotencyKey(cyclicArray)).toThrow(TypeError);
  });

  it("12. Correctly serializes non-cyclic DAGs (shared sub-object references) without false positives", () => {
    // Shared sub-object referenced in multiple places (Diamond/DAG dependency, NOT a cycle)
    const sharedMetadata = { source: "portal_api", version: 1 };
    const payloadWithShared = {
      firstContact: sharedMetadata,
      secondContact: sharedMetadata,
    };

    expect(() => canonicalizeJson(payloadWithShared)).not.toThrow();
    expect(canonicalizeJson(payloadWithShared)).toBe(
      '{"firstContact":{"source":"portal_api","version":1},"secondContact":{"source":"portal_api","version":1}}'
    );

    const key = generatePayloadIdempotencyKey(payloadWithShared);
    expect(key).toMatch(/^payload_[0-9a-f]{64}$/);
  });

  it("13. Safely rejects unsupported BigInt values with a TypeError", () => {
    const payloadWithBigInt = { id: BigInt(123) };

    expect(() => canonicalizeJson(payloadWithBigInt)).toThrow(TypeError);
    expect(() => canonicalizeJson(payloadWithBigInt)).toThrow(
      /BigInt values are not supported/
    );
    expect(() => generatePayloadIdempotencyKey(payloadWithBigInt)).toThrow(TypeError);
  });
});
