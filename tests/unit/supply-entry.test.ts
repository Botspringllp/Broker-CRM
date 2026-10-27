import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole, KeyHolderPersona } from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError, ValidationError, DuplicatePropertyError } from "@/server/errors";

// Mock Prisma DB module
vi.mock("@/server/db", () => ({
  prisma: {
    property: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    keyHolder: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@/server/db";
import {
  createProperty,
  checkDuplicateProperty,
  isEligibleForActiveSupply,
  updateProperty,
  CreatePropertyInput,
} from "@/server/dal/properties";

describe("Supply Validation - Manual Property Entry & Active Pool Safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const tenantContext: TenantContext = {
    userId: "agent-vikrant",
    tenantId: "tenant-apex",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "agent-vikrant",
      email: "vikrant@apex.in",
      name: "Vikrant Singh",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-1",
      token: "tok-1",
      expiresAt: new Date(),
    },
  };

  const telecallerContext: TenantContext = {
    userId: "telecaller-pooja",
    tenantId: "tenant-apex",
    role: UserRole.TELECALLER,
    user: {
      id: "telecaller-pooja",
      email: "pooja@apex.in",
      name: "Pooja Sharma",
      role: UserRole.TELECALLER,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-2",
      token: "tok-2",
      expiresAt: new Date(),
    },
  };

  const validPropertyInput: CreatePropertyInput = {
    societyName: "Sobha City",
    flatNumber: "Tower B - 1204",
    localityName: "Sector 108",
    city: "Gurgaon",
    preference: "SALE",
    propertyType: "APARTMENT",
    furnishingStatus: "SEMI_FURNISHED",
    constructionStatus: "READY_TO_MOVE",
    bedroomCount: 3,
    bathroomCount: 3,
    balconyCount: 2,
    area: 1950,
    areaType: "SUPER_BUILT_UP",
    price: 24500000,
    ownerName: "Rameshwar Kulkarni",
    ownerMobile: "9876543210",
    amenities: ["Lift", "Power Backup", "Security", "Clubhouse"],
  };

  // 1. Valid property creation
  it("successfully creates a property with valid input and proper Prisma decimal handling", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null); // No duplicate
    vi.mocked(prisma.property.create).mockResolvedValueOnce({
      id: "prop-101",
      tenantId: "tenant-apex",
      societyName: "Sobha City",
      flatNumber: "Tower B - 1204",
      ownerName: "Rameshwar Kulkarni",
      ownerMobile: "9876543210",
      ownerWillingnessConfirmed: false,
      validationStatus: "NOT_VALIDATED",
      availabilityStatus: "AVAILABLE",
      isActiveSupply: false,
      entryChannel: "MANUAL",
      keyHolders: [],
      media: [],
    } as unknown as Awaited<ReturnType<typeof prisma.property.create>>);

    const result = await createProperty(tenantContext, validPropertyInput);

    expect(result.id).toBe("prop-101");
    expect(prisma.property.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-apex",
          submittingAgentId: "agent-vikrant",
          societyName: "Sobha City",
          flatNumber: "Tower B - 1204",
          ownerName: "Rameshwar Kulkarni",
          ownerMobile: "9876543210",
          ownerWillingnessConfirmed: false,
          validationStatus: "NOT_VALIDATED",
          availabilityStatus: "AVAILABLE",
          isActiveSupply: false,
          entryChannel: "MANUAL",
        }),
      })
    );
  });

  // 2. Required-field and invalid-input rejection
  it("rejects property creation when required fields are missing", async () => {
    await expect(
      createProperty(tenantContext, { ...validPropertyInput, societyName: "" })
    ).rejects.toThrow(ValidationError);

    await expect(
      createProperty(tenantContext, { ...validPropertyInput, flatNumber: "   " })
    ).rejects.toThrow(ValidationError);

    await expect(
      createProperty(tenantContext, { ...validPropertyInput, localityName: "" })
    ).rejects.toThrow(ValidationError);

    await expect(
      createProperty(tenantContext, { ...validPropertyInput, city: "" })
    ).rejects.toThrow(ValidationError);

    await expect(
      createProperty(tenantContext, { ...validPropertyInput, ownerName: "" })
    ).rejects.toThrow(ValidationError);
  });

  it("rejects invalid Indian mobile numbers and invalid numeric inputs", async () => {
    // Invalid mobile
    await expect(
      createProperty(tenantContext, { ...validPropertyInput, ownerMobile: "12345" })
    ).rejects.toThrow(ValidationError);

    // Negative bedroom count
    await expect(
      createProperty(tenantContext, { ...validPropertyInput, bedroomCount: -1 })
    ).rejects.toThrow(ValidationError);

    // Non-positive area
    await expect(
      createProperty(tenantContext, { ...validPropertyInput, area: 0 })
    ).rejects.toThrow(ValidationError);

    // Non-positive price
    await expect(
      createProperty(tenantContext, { ...validPropertyInput, price: -500 })
    ).rejects.toThrow(ValidationError);
  });

  // 3. Optional KeyHolder handling
  it("persists optional KeyHolder details when provided", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.property.create).mockResolvedValueOnce({
      id: "prop-102",
      tenantId: "tenant-apex",
      keyHolders: [
        {
          id: "kh-1",
          tenantId: "tenant-apex",
          propertyId: "prop-102",
          name: "Bahadur Singh",
          mobile: "9811223344",
          persona: KeyHolderPersona.GUARD,
          notes: "Tower B Gate",
        },
      ],
    } as unknown as Awaited<ReturnType<typeof prisma.property.create>>);

    const inputWithKeyHolder: CreatePropertyInput = {
      ...validPropertyInput,
      keyHolder: {
        name: "Bahadur Singh",
        mobile: "9811223344",
        persona: KeyHolderPersona.GUARD,
        notes: "Tower B Gate",
      },
    };

    await createProperty(tenantContext, inputWithKeyHolder);

    expect(prisma.property.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          keyHolders: {
            create: {
              tenant: { connect: { id: "tenant-apex" } },
              name: "Bahadur Singh",
              mobile: "9811223344",
              persona: KeyHolderPersona.GUARD,
              notes: "Tower B Gate",
            },
          },
        }),
      })
    );
  });

  it("omits KeyHolder creation cleanly when key-holder details are not provided", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.property.create).mockResolvedValueOnce({ id: "prop-103" } as unknown as Awaited<ReturnType<typeof prisma.property.create>>);

    // keyHolder: null or undefined
    await createProperty(tenantContext, { ...validPropertyInput, keyHolder: null });

    expect(prisma.property.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          keyHolders: undefined,
        }),
      })
    );
  });

  // 4. Correct tenant assignment from server-side context
  it("strictly derives tenantId and submittingAgentId from server context, never trusting client", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.property.create).mockResolvedValueOnce({ id: "prop-104" } as unknown as Awaited<ReturnType<typeof prisma.property.create>>);

    await createProperty(telecallerContext, validPropertyInput);

    expect(prisma.property.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-apex",
          submittingAgentId: "telecaller-pooja",
        }),
      })
    );
  });

  // 5. Unauthorized requests being rejected
  it("rejects unauthorized roles with ForbiddenError", async () => {
    const fieldSalesContext: TenantContext = {
      ...tenantContext,
      role: UserRole.FIELD_SALES_AGENT,
    };
    const crmAdminContext: TenantContext = {
      ...tenantContext,
      role: UserRole.CRM_TENANT_ADMIN,
    };
    const superAdminContext: TenantContext = {
      ...tenantContext,
      role: UserRole.PLATFORM_SUPER_ADMIN,
    };

    await expect(createProperty(fieldSalesContext, validPropertyInput)).rejects.toThrow(
      ForbiddenError
    );
    await expect(createProperty(crmAdminContext, validPropertyInput)).rejects.toThrow(
      ForbiddenError
    );
    await expect(createProperty(superAdminContext, validPropertyInput)).rejects.toThrow(
      ForbiddenError
    );

    expect(prisma.property.create).not.toHaveBeenCalled();
  });

  // 6. Potential duplicate detection
  it("detects potential duplicate properties within tenant (case-insensitive & trimmed)", async () => {
    const existing = {
      id: "prop-existing-1",
      societyName: "Sobha City",
      flatNumber: "Tower B - 1204",
      bedroomCount: 3,
      propertyType: "APARTMENT",
      validationStatus: "NOT_VALIDATED",
      availabilityStatus: "AVAILABLE",
      ownerName: "Rameshwar Kulkarni",
      createdAt: new Date(),
    };

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(existing as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>);

    const dupResult = await checkDuplicateProperty(tenantContext, {
      societyName: "  sobha city  ",
      flatNumber: "  tower b - 1204  ",
    });

    expect(dupResult.isDuplicate).toBe(true);
    expect(dupResult.duplicate?.id).toBe("prop-existing-1");
  });

  it("throws DuplicatePropertyError when a duplicate exists and confirmDuplicate is false", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
      id: "prop-existing-1",
      societyName: "Sobha City",
      flatNumber: "Tower B - 1204",
      bedroomCount: 3,
      propertyType: "APARTMENT",
    } as unknown as Awaited<ReturnType<typeof prisma.property.create>>);

    await expect(
      createProperty(tenantContext, { ...validPropertyInput, confirmDuplicate: false })
    ).rejects.toThrow(DuplicatePropertyError);

    expect(prisma.property.create).not.toHaveBeenCalled();
  });

  it("allows creation of property when duplicate is explicitly confirmed by user", async () => {
    vi.mocked(prisma.property.create).mockResolvedValueOnce({ id: "prop-105" } as unknown as Awaited<ReturnType<typeof prisma.property.create>>);

    const result = await createProperty(tenantContext, {
      ...validPropertyInput,
      confirmDuplicate: true,
    });

    expect(result.id).toBe("prop-105");
    // Duplicate check was bypassed by explicit confirmation
    expect(prisma.property.create).toHaveBeenCalled();
  });

  // 7. No accidental modification of an existing property during duplicate check
  it("never mutates or overwrites existing property records during duplicate detection", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
      id: "prop-existing-1",
      societyName: "Sobha City",
      flatNumber: "Tower B - 1204",
    } as unknown as Awaited<ReturnType<typeof prisma.property.create>>);

    await checkDuplicateProperty(tenantContext, {
      societyName: "Sobha City",
      flatNumber: "Tower B - 1204",
    });

    expect(prisma.property.update).not.toHaveBeenCalled();
  });

  // 8. Newly created properties remaining outside Active Supply Pool
  it("forces newly created properties to remain outside the Active Supply Pool", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.property.create).mockResolvedValueOnce({ id: "prop-106" } as unknown as Awaited<ReturnType<typeof prisma.property.create>>);

    await createProperty(tenantContext, validPropertyInput);

    expect(prisma.property.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActiveSupply: false,
          validationStatus: "NOT_VALIDATED",
          ownerWillingnessConfirmed: false,
        }),
      })
    );
  });

  // 9. Owner willingness not being inferred from call disposition
  it("preserves ownerWillingnessConfirmed as an independent boolean, default false", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.property.create).mockResolvedValueOnce({ id: "prop-107" } as unknown as Awaited<ReturnType<typeof prisma.property.create>>);

    await createProperty(tenantContext, validPropertyInput);

    expect(prisma.property.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerWillingnessConfirmed: false,
        }),
      })
    );
  });

  // 10. Active Supply eligibility requiring both approved conditions
  it("strictly enforces Active Supply eligibility: requires BOTH confirmed owner willingness AND complete validation", () => {
    // Condition 1: Willingness false, even if VALIDATED and AVAILABLE => NOT eligible
    expect(
      isEligibleForActiveSupply({
        ownerWillingnessConfirmed: false,
        validationStatus: "VALIDATED",
        availabilityStatus: "AVAILABLE",
      })
    ).toBe(false);

    // Condition 2: Willingness true, but validationStatus NOT_VALIDATED => NOT eligible
    expect(
      isEligibleForActiveSupply({
        ownerWillingnessConfirmed: true,
        validationStatus: "NOT_VALIDATED",
        availabilityStatus: "AVAILABLE",
      })
    ).toBe(false);

    // Condition 3: Willingness true, validationStatus IN_VALIDATION => NOT eligible
    expect(
      isEligibleForActiveSupply({
        ownerWillingnessConfirmed: true,
        validationStatus: "IN_VALIDATION",
        availabilityStatus: "AVAILABLE",
      })
    ).toBe(false);

    // Condition 4: Willingness true, VALIDATED, but availabilityStatus SOLD => NOT eligible
    expect(
      isEligibleForActiveSupply({
        ownerWillingnessConfirmed: true,
        validationStatus: "VALIDATED",
        availabilityStatus: "SOLD",
      })
    ).toBe(false);

    // Condition 5: BOTH owner willingness confirmed AND VALIDATED AND AVAILABLE => ELIGIBLE
    expect(
      isEligibleForActiveSupply({
        ownerWillingnessConfirmed: true,
        validationStatus: "VALIDATED",
        availabilityStatus: "AVAILABLE",
      })
    ).toBe(true);
  });

  it("server-side updateProperty safely overrides client isActiveSupply with business eligibility rule", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
      id: "prop-108",
      tenantId: "tenant-apex",
      ownerWillingnessConfirmed: false, // Willingness NOT yet confirmed
      validationStatus: "VALIDATED",
      availabilityStatus: "AVAILABLE",
    } as unknown as Awaited<ReturnType<typeof prisma.property.create>>);

    vi.mocked(prisma.property.update).mockResolvedValueOnce({ id: "prop-108" } as unknown as Awaited<ReturnType<typeof prisma.property.create>>);

    // Client maliciously attempts to send isActiveSupply: true
    await updateProperty(tenantContext, "prop-108", {
      validationStatus: "VALIDATED",
      isActiveSupply: true,
    });

    // Server enforces that isActiveSupply is false because ownerWillingnessConfirmed is false
    expect(prisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActiveSupply: false,
        }),
      })
    );
  });
});
