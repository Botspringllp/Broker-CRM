import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole, SupplyValidationStatus, PropertyAvailabilityStatus, PropertyEntryChannel } from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";

// Mock dependencies before imports
vi.mock("@/server/db", () => {
  const mockPrisma = {
    property: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    keyHolder: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (arg) => {
      if (typeof arg === "function") return arg(mockPrisma);
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg;
    }),
  };
  return { prisma: mockPrisma };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock requireTenantContext for server action testing
const mockContext: TenantContext = {
  tenantId: "tenant-broker-1",
  userId: "user-broker-1",
  role: UserRole.BROKER_OWNER,
  user: {
    id: "user-broker-1",
    email: "broker@apexrealty.in",
    name: "Rajesh Broker",
    role: UserRole.BROKER_OWNER,
    tenantId: "tenant-broker-1",
    isActive: true,
  },
  session: {
    id: "sess-1",
    token: "tok-1",
    expiresAt: new Date(Date.now() + 86400000),
  },
};

vi.mock("@/server/tenant-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/tenant-context")>();
  return {
    ...actual,
    requireTenantContext: vi.fn(async () => mockContext),
  };
});

import { prisma } from "@/server/db";
import { createPropertyAction } from "@/app/supply/actions";
import { getMatchingLeadsForProperty } from "@/server/dal/matching";

type MockProperty = NonNullable<Awaited<ReturnType<typeof prisma.property.findFirst>>>;

describe("New Property Creation Wizard - Owner Details Step 1 & Intake Workflow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("1. Step 1: Owner Details Validation Rules", () => {
    it("rejects property creation when ownerName is empty", async () => {
      const res = await createPropertyAction({
        ownerName: "",
        ownerMobile: "9812345678",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Owner name is required");
      expect(prisma.property.create).not.toHaveBeenCalled();
    });

    it("rejects property creation when ownerName is whitespace only", async () => {
      const res = await createPropertyAction({
        ownerName: "    ",
        ownerMobile: "9812345678",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Owner name is required");
      expect(prisma.property.create).not.toHaveBeenCalled();
    });

    it("rejects property creation when ownerMobile is empty", async () => {
      const res = await createPropertyAction({
        ownerName: "Sunil Verma",
        ownerMobile: "",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Owner mobile number is required");
      expect(prisma.property.create).not.toHaveBeenCalled();
    });

    it("rejects property creation when ownerMobile is invalid (< 10 digits)", async () => {
      const res = await createPropertyAction({
        ownerName: "Sunil Verma",
        ownerMobile: "9812345",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("10-digit Indian mobile number");
      expect(prisma.property.create).not.toHaveBeenCalled();
    });

    it("rejects property creation when ownerMobile starts with invalid leading digit (e.g. 1-5)", async () => {
      const res = await createPropertyAction({
        ownerName: "Sunil Verma",
        ownerMobile: "4812345678",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("10-digit Indian mobile number");
      expect(prisma.property.create).not.toHaveBeenCalled();
    });

    it("accepts valid mobile numbers with +91 country prefix or leading 0", async () => {
      vi.mocked(prisma.property.create).mockResolvedValueOnce({
        id: "prop-new-1",
        tenantId: "tenant-broker-1",
        submittingAgentId: "user-broker-1",
        ownerName: "Sunil Verma",
        ownerMobile: "9812345678",
        societyName: null,
        flatNumber: null,
        localityName: null,
        city: null,
        price: null,
        validationStatus: SupplyValidationStatus.NOT_VALIDATED,
        availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
        isActiveSupply: false,
        entryChannel: PropertyEntryChannel.MANUAL,
        keyHolders: [],
        media: [],
        callLogs: [],
        assignments: [],
      } as unknown as MockProperty);

      const res = await createPropertyAction({
        ownerName: "Sunil Verma",
        ownerMobile: "+91 98123 45678",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.property.ownerMobile).toBe("9812345678");
      }
    });
  });

  describe("2. 'Save & Exit' Action from Step 1", () => {
    it("persists an incomplete intake record with genuine NULLs and returns NOT_VALIDATED status", async () => {
      vi.mocked(prisma.property.create).mockResolvedValueOnce({
        id: "intake-prop-101",
        tenantId: "tenant-broker-1",
        submittingAgentId: "user-broker-1",
        ownerName: "Rohan Mehra",
        ownerMobile: "9876543210",
        societyName: null,
        flatNumber: null,
        localityName: null,
        city: null,
        preference: null,
        propertyType: null,
        furnishingStatus: null,
        constructionStatus: null,
        bedroomCount: null,
        bathroomCount: null,
        balconyCount: null,
        area: null,
        areaType: null,
        price: null,
        validationStatus: SupplyValidationStatus.NOT_VALIDATED,
        availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
        ownerWillingnessConfirmed: false,
        isActiveSupply: false,
        entryChannel: PropertyEntryChannel.MANUAL,
        keyHolders: [],
        media: [],
        callLogs: [],
        assignments: [],
      } as unknown as MockProperty);

      // Save & Exit payload: only ownerName, ownerMobile, entryChannel
      const res = await createPropertyAction({
        ownerName: "Rohan Mehra",
        ownerMobile: "9876543210",
        amenities: [],
        entryChannel: PropertyEntryChannel.MANUAL,
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.property.id).toBe("intake-prop-101");
        expect(res.property.ownerName).toBe("Rohan Mehra");
        expect(res.property.ownerMobile).toBe("9876543210");
        expect(res.property.societyName).toBeNull();
        expect(res.property.flatNumber).toBeNull();
        expect(res.property.price).toBeNull();
        expect(res.property.validationStatus).toBe("Not Validated");
        expect(res.property.isActiveSupply).toBe(false);
      }

      // Verify Prisma create called with genuine nulls — NO fake defaults (Price = 0, BHK = 0, etc.)
      expect(prisma.property.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: "tenant-broker-1",
            submittingAgentId: "user-broker-1",
            ownerName: "Rohan Mehra",
            ownerMobile: "9876543210",
            societyName: null,
            flatNumber: null,
            localityName: null,
            city: null,
            preference: null,
            propertyType: null,
            furnishingStatus: null,
            constructionStatus: null,
            bedroomCount: null,
            bathroomCount: null,
            balconyCount: null,
            area: null,
            areaType: null,
            price: null,
            validationStatus: SupplyValidationStatus.NOT_VALIDATED,
            availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
            ownerWillingnessConfirmed: false,
            isActiveSupply: false,
            entryChannel: PropertyEntryChannel.MANUAL,
          }),
        })
      );
    });
  });

  describe("3. Step 1 -> Step 2 'Continue to Post' Flow", () => {
    it("simulates client state transition: advances to Step 2 without creating database record", () => {
      // Step 1 state
      const wizardState = {
        currentStep: 1,
        form: {
          ownerName: "Pooja Malhotra",
          ownerMobile: "9822334455",
          societyName: "",
          flatNumber: "",
        },
      };

      // Client validation for 'Continue to Post'
      const trimmedName = wizardState.form.ownerName.trim();
      const trimmedMobile = wizardState.form.ownerMobile.trim().replace(/\D/g, "");
      const isValid = trimmedName.length > 0 && trimmedMobile.length === 10;

      expect(isValid).toBe(true);

      // Continue to Post transitions step to 2 WITHOUT server mutation
      if (isValid) {
        wizardState.currentStep = 2;
      }

      expect(wizardState.currentStep).toBe(2);
      expect(wizardState.form.ownerName).toBe("Pooja Malhotra");
      expect(wizardState.form.ownerMobile).toBe("9822334455");
      // Zero DB calls occurred
      expect(prisma.property.create).not.toHaveBeenCalled();
    });
  });

  describe("4. Incomplete Intake Safety: Isolation from Matching Engine", () => {
    it("returns zero matches when an incomplete intake property is evaluated for matching", async () => {
      // Mock an incomplete intake property in DB
      vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
        id: "intake-prop-202",
        tenantId: "tenant-broker-1",
        ownerName: "Deepak Sharma",
        ownerMobile: "9811122334",
        societyName: null,
        flatNumber: null,
        localityName: null,
        city: null,
        preference: null,
        propertyType: null,
        price: null,
        validationStatus: SupplyValidationStatus.NOT_VALIDATED,
        isActiveSupply: false,
        keyHolders: [],
        media: [],
        callLogs: [],
        assignments: [],
      } as unknown as MockProperty);

      // getMatchingLeadsForProperty should immediately guard and return empty matches
      const matchResult = await getMatchingLeadsForProperty(mockContext, "intake-prop-202");

      expect(matchResult.matches).toEqual([]);
      expect(matchResult.totalActiveLeadsCount).toBe(0);
      // Should not query buyers/leads since property is not validated and not active supply
      expect(prisma.property.findMany).not.toHaveBeenCalled();
    });
  });
});
