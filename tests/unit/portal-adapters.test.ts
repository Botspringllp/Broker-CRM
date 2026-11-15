import { describe, it, expect, beforeEach } from "vitest";
import {
  PortalProvider,
  TransactionType,
  PropertyType,
} from "@prisma/client";
import { GenericMockPortalAdapter } from "@/server/integrations/portals/adapters/generic-mock";
import {
  NinetyNineAcresAdapter,
  MagicbricksAdapter,
  NoBrokerAdapter,
} from "@/server/integrations/portals/adapters/provider-stubs";
import {
  getPortalAdapter,
  registerPortalAdapter,
  resetPortalAdapters,
} from "@/server/integrations/portals/registry";
import { PortalLeadAdapter } from "@/server/integrations/portals/types";

describe("Portal Lead Adapters & Normalization Contract", () => {
  beforeEach(() => {
    resetPortalAdapters();
  });

  describe("1. Generic Mock Adapter (Core Contract)", () => {
    const adapter = new GenericMockPortalAdapter(PortalProvider.NINETY_NINE_ACRES);

    it("parses and normalizes a complete valid lead payload", () => {
      const payload = {
        externalEventId: "evt_test_101",
        name: "Aman Verma",
        mobile: "+91 98100 11223",
        email: "Aman.Verma@Example.COM",
        city: "Gurugram",
        locality: "Golf Course Road",
        preference: "SALE",
        minBudget: 15000000,
        maxBudget: 25000000,
        propertyType: "APARTMENT",
        bedroomConfiguration: "3 BHK",
        advertisedPropertyRef: "prop-ref-999",
        enquiryNotes: "Interested in high-floor units.",
      };

      const result = adapter.parseAndNormalize(payload);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.normalized).toEqual({
          provider: PortalProvider.NINETY_NINE_ACRES,
          externalEventId: "evt_test_101",
          name: "Aman Verma",
          mobile: "9810011223",
          email: "aman.verma@example.com",
          city: "Gurugram",
          locality: "Golf Course Road",
          preference: TransactionType.SALE,
          minBudget: 15000000,
          maxBudget: 25000000,
          propertyType: PropertyType.APARTMENT,
          bedroomConfiguration: "3 BHK",
          advertisedPropertyRef: "prop-ref-999",
          enquiryNotes: "Interested in high-floor units.",
          rawPayload: payload,
        });
      }
    });

    it("normalizes minimal required fields with valid defaults", () => {
      const payload = {
        name: "Pooja Sharma",
        mobile: "9876543210",
        city: "Noida",
        preference: "RENT",
      };

      const result = adapter.parseAndNormalize(payload);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.normalized.name).toBe("Pooja Sharma");
        expect(result.normalized.mobile).toBe("9876543210");
        expect(result.normalized.city).toBe("Noida");
        expect(result.normalized.preference).toBe(TransactionType.RENT);
        expect(result.normalized.externalEventId).toBeNull();
        expect(result.normalized.email).toBeNull();
        expect(result.normalized.minBudget).toBeNull();
        expect(result.normalized.maxBudget).toBeNull();
      }
    });

    it("normalizes preference synonyms: BUY -> SALE, RENTAL -> RENT", () => {
      const buyPayload = { name: "Test", mobile: "9810011223", city: "Delhi", preference: "BUY" };
      const rentPayload = { name: "Test", mobile: "9810011223", city: "Delhi", preference: "RENTAL" };

      const buyRes = adapter.parseAndNormalize(buyPayload);
      const rentRes = adapter.parseAndNormalize(rentPayload);

      expect(buyRes.success && buyRes.normalized.preference).toBe(TransactionType.SALE);
      expect(rentRes.success && rentRes.normalized.preference).toBe(TransactionType.RENT);
    });

    it("rejects non-object or null payloads", () => {
      expect(adapter.parseAndNormalize(null).success).toBe(false);
      expect(adapter.parseAndNormalize("not an object").success).toBe(false);
      expect(adapter.parseAndNormalize(123).success).toBe(false);
    });

    it("rejects missing or empty prospect name", () => {
      const payload = { mobile: "9810011223", city: "Delhi", preference: "SALE" };
      const res = adapter.parseAndNormalize(payload);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toMatch(/Prospect name is required/);
      }
    });

    it("rejects invalid Indian mobile numbers", () => {
      const payloadInvalid = { name: "Test", mobile: "12345", city: "Delhi" };
      const res = adapter.parseAndNormalize(payloadInvalid);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toMatch(/Invalid Indian mobile/);
      }
    });

    it("rejects missing target city", () => {
      const payload = { name: "Test", mobile: "9810011223", city: "  " };
      const res = adapter.parseAndNormalize(payload);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toMatch(/Target city is required/);
      }
    });

    it("rejects negative budgets and maxBudget less than minBudget", () => {
      const payloadNegative = {
        name: "Test",
        mobile: "9810011223",
        city: "Delhi",
        minBudget: -500,
      };
      expect(adapter.parseAndNormalize(payloadNegative).success).toBe(false);

      const payloadInverted = {
        name: "Test",
        mobile: "9810011223",
        city: "Delhi",
        minBudget: 10000000,
        maxBudget: 5000000,
      };
      const resInverted = adapter.parseAndNormalize(payloadInverted);
      expect(resInverted.success).toBe(false);
      if (!resInverted.success) {
        expect(resInverted.error).toMatch(/Maximum budget cannot be less than minimum budget/);
      }
    });
  });

  describe("2. Provider Stubs (Unverified Mapping Safeguards)", () => {
    it("99acres stub is clearly marked unverified and maps query_id correctly", () => {
      const adapter = new NinetyNineAcresAdapter();
      expect(adapter.isVerified).toBe(false);
      expect(adapter.description).toMatch(/DRAFT/);

      const payload = {
        query_id: "99a_qry_554433",
        name: "Rahul Verma",
        mobile: "9810011223",
        city: "Gurugram",
        query_message: "Need 3BHK flat",
        prop_id: "prop_99_12",
      };

      const res = adapter.parseAndNormalize(payload);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.normalized.provider).toBe(PortalProvider.NINETY_NINE_ACRES);
        expect(res.normalized.externalEventId).toBe("99a_qry_554433");
        expect(res.normalized.enquiryNotes).toBe("Need 3BHK flat");
        expect(res.normalized.advertisedPropertyRef).toBe("prop_99_12");
      }
    });

    it("Magicbricks stub is clearly marked unverified and maps id correctly", () => {
      const adapter = new MagicbricksAdapter();
      expect(adapter.isVerified).toBe(false);
      expect(adapter.description).toMatch(/DRAFT/);

      const payload = {
        id: "mb_lead_9988",
        lead_name: "Sneha Kapur",
        contact_number: "9810099887",
        city: "Noida",
        comments: "Looking for immediate possession",
      };

      const res = adapter.parseAndNormalize(payload);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.normalized.provider).toBe(PortalProvider.MAGICBRICKS);
        expect(res.normalized.externalEventId).toBe("mb_lead_9988");
        expect(res.normalized.name).toBe("Sneha Kapur");
        expect(res.normalized.mobile).toBe("9810099887");
      }
    });

    it("NoBroker stub is clearly marked unverified and defaults to rental transaction type", () => {
      const adapter = new NoBrokerAdapter();
      expect(adapter.isVerified).toBe(false);
      expect(adapter.description).toMatch(/DRAFT/);

      const payload = {
        event_id: "nb_evt_1122",
        user_name: "Deepak Joshi",
        user_phone: "9810055443",
        city: "Bengaluru",
      };

      const res = adapter.parseAndNormalize(payload);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.normalized.provider).toBe(PortalProvider.NOBROKER);
        expect(res.normalized.externalEventId).toBe("nb_evt_1122");
        expect(res.normalized.preference).toBe(TransactionType.RENT);
      }
    });
  });

  describe("3. Adapter Registry & Dependency Injection", () => {
    it("returns the appropriate registered adapter for each portal provider", () => {
      const a99 = getPortalAdapter(PortalProvider.NINETY_NINE_ACRES);
      const aMB = getPortalAdapter(PortalProvider.MAGICBRICKS);
      const aNB = getPortalAdapter(PortalProvider.NOBROKER);

      expect(a99.provider).toBe(PortalProvider.NINETY_NINE_ACRES);
      expect(aMB.provider).toBe(PortalProvider.MAGICBRICKS);
      expect(aNB.provider).toBe(PortalProvider.NOBROKER);
    });

    it("allows registering and overriding a custom adapter for testing", () => {
      const customMock: PortalLeadAdapter = {
        provider: PortalProvider.NINETY_NINE_ACRES,
        isVerified: true,
        description: "Custom Mock for Unit Testing",
        parseAndNormalize: (payload) => ({
          success: true,
          normalized: {
            provider: PortalProvider.NINETY_NINE_ACRES,
            name: "Mocked User",
            mobile: "9810011223",
            city: "Custom City",
            preference: TransactionType.SALE,
            rawPayload: payload,
          },
        }),
      };

      registerPortalAdapter(PortalProvider.NINETY_NINE_ACRES, customMock);
      const resolved = getPortalAdapter(PortalProvider.NINETY_NINE_ACRES);
      expect(resolved.description).toBe("Custom Mock for Unit Testing");

      resetPortalAdapters();
      const restored = getPortalAdapter(PortalProvider.NINETY_NINE_ACRES);
      expect(restored.description).not.toBe("Custom Mock for Unit Testing");
    });
  });
});
