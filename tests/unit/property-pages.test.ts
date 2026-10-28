import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole } from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ValidationError, DuplicatePropertyError, NotFoundError } from "@/server/errors";

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
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/server/db";
import {
  editProperty,
  getPropertyById,
  EditPropertyInput,
} from "@/server/dal/properties";

describe("Property Pages & Edit DAL - Step 2 Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const brokerContext: TenantContext = {
    userId: "user-broker-1",
    tenantId: "tenant-apex",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-broker-1",
      email: "broker@apex.in",
      name: "Broker Owner",
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
    userId: "user-telecaller-1",
    tenantId: "tenant-apex",
    role: UserRole.TELECALLER,
    user: {
      id: "user-telecaller-1",
      email: "telecaller@apex.in",
      name: "Telecaller Pooja",
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

  const fieldVerifierContext: TenantContext = {
    userId: "user-verifier-1",
    tenantId: "tenant-apex",
    role: UserRole.FIELD_VERIFIER,
    user: {
      id: "user-verifier-1",
      email: "verifier@apex.in",
      name: "Verifier Rahul",
      role: UserRole.FIELD_VERIFIER,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-3",
      token: "tok-3",
      expiresAt: new Date(),
    },
  };

  const mockExistingProperty = {
    id: "prop-123",
    tenantId: "tenant-apex",
    submittingAgentId: "user-broker-1",
    societyName: "Palm Springs",
    flatNumber: "Unit 402",
    localityName: "Golf Course Road",
    city: "Gurugram",
    preference: "SALE" as const,
    propertyType: "APARTMENT" as const,
    furnishingStatus: "SEMI_FURNISHED" as const,
    constructionStatus: "READY_TO_MOVE" as const,
    bedroomCount: 3,
    bathroomCount: 3,
    balconyCount: 2,
    area: "2100",
    areaType: "SUPER_BUILT_UP" as const,
    price: "28000000",
    ownerName: "Anand Verma",
    ownerMobile: "9812345678",
    amenities: ["Lift", "Security"],
    ownerWillingnessConfirmed: false,
    validationStatus: "NOT_VALIDATED",
    availabilityStatus: "AVAILABLE",
    isActiveSupply: false,
    entryChannel: "MANUAL",
    keyHolders: [],
    media: [],
    callLogs: [],
    assignments: [],
  };

  const validEditInput: EditPropertyInput = {
    propertyId: "prop-123",
    societyName: "Palm Springs",
    flatNumber: "Unit 402",
    localityName: "Golf Course Road",
    city: "Gurugram",
    preference: "SALE",
    propertyType: "APARTMENT",
    furnishingStatus: "FURNISHED",
    constructionStatus: "READY_TO_MOVE",
    bedroomCount: 3,
    bathroomCount: 3,
    balconyCount: 2,
    area: 2150,
    areaType: "SUPER_BUILT_UP",
    price: 29000000,
    ownerName: "Anand Verma Updated",
    ownerMobile: "9812345678",
    amenities: ["Lift", "Security", "Gym"],
  };

  // 1. Successful Edit by Broker
  it("successfully updates an existing property within tenant scope", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockExistingProperty,
      ownerName: "Anand Verma Updated",
      furnishingStatus: "FURNISHED",
      area: "2150",
      price: "29000000",
    } as unknown as Awaited<ReturnType<typeof prisma.property.update>>);

    const result = await editProperty(brokerContext, validEditInput);

    expect(result.ownerName).toBe("Anand Verma Updated");
    expect(prisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id_tenantId: {
            id: "prop-123",
            tenantId: "tenant-apex",
          },
        },
        data: expect.objectContaining({
          ownerName: "Anand Verma Updated",
          area: expect.any(Object),
          price: expect.any(Object),
          isActiveSupply: false, // strictly remains outside active supply
        }),
      })
    );
  });

  // 1b. Successful Edit by Telecaller
  it("allows Telecaller to edit property specifications when assigned", async () => {
    const assignedProperty = {
      ...mockExistingProperty,
      assignments: [
        {
          id: "asgn-1",
          assignedUserId: "user-telecaller-1",
          status: "ACTIVE",
          targetType: "PROPERTY",
          assignedAt: new Date(),
        },
      ],
    };

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      assignedProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...assignedProperty,
      ownerName: "Anand Verma Updated",
    } as unknown as Awaited<ReturnType<typeof prisma.property.update>>);

    const result = await editProperty(telecallerContext, validEditInput);
    expect(result.ownerName).toBe("Anand Verma Updated");
  });

  // 2. Mandatory field validations
  it("rejects edit if required fields are missing", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    await expect(
      editProperty(brokerContext, { ...validEditInput, societyName: "   " })
    ).rejects.toThrow(ValidationError);

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    await expect(
      editProperty(brokerContext, { ...validEditInput, flatNumber: "" })
    ).rejects.toThrow(ValidationError);

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    await expect(
      editProperty(brokerContext, { ...validEditInput, localityName: "" })
    ).rejects.toThrow(ValidationError);

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    await expect(
      editProperty(brokerContext, { ...validEditInput, city: "" })
    ).rejects.toThrow(ValidationError);

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    await expect(
      editProperty(brokerContext, { ...validEditInput, ownerName: "  " })
    ).rejects.toThrow(ValidationError);
  });

  // 3. Indian mobile validation
  it("rejects invalid Indian owner mobile numbers on edit", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    await expect(
      editProperty(brokerContext, { ...validEditInput, ownerMobile: "1234567890" })
    ).rejects.toThrow("valid 10-digit Indian mobile number");

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    await expect(
      editProperty(brokerContext, { ...validEditInput, ownerMobile: "98765" })
    ).rejects.toThrow("valid 10-digit Indian mobile number");
  });

  // 4. Numeric fields positive checks
  it("rejects non-positive area or price", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    await expect(
      editProperty(brokerContext, { ...validEditInput, area: 0 })
    ).rejects.toThrow("Property area must be greater than zero.");

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    await expect(
      editProperty(brokerContext, { ...validEditInput, price: -500 })
    ).rejects.toThrow("Property price must be greater than zero.");
  });

  // 5. Duplicate detection on changed society and flat
  it("detects duplicate property within tenant when society or flat changes to an existing property", async () => {
    // 1st findFirst: fetch current property
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    // 2nd findFirst in checkDuplicateProperty: found another property with same name
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
      id: "prop-other-456",
      societyName: "Magnolias",
      flatNumber: "Penthouse 1",
      tenantId: "tenant-apex",
    } as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>);

    await expect(
      editProperty(brokerContext, {
        ...validEditInput,
        societyName: "Magnolias",
        flatNumber: "Penthouse 1",
      })
    ).rejects.toThrow(DuplicatePropertyError);
  });

  it("permits updating to existing society & flat if confirmDuplicate is true", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockExistingProperty,
      societyName: "Magnolias",
      flatNumber: "Penthouse 1",
    } as unknown as Awaited<ReturnType<typeof prisma.property.update>>);

    const result = await editProperty(brokerContext, {
      ...validEditInput,
      societyName: "Magnolias",
      flatNumber: "Penthouse 1",
      confirmDuplicate: true,
    });

    expect(result.societyName).toBe("Magnolias");
  });

  it("does not trigger duplicate check if society and flat are unchanged", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>
    );
    vi.mocked(prisma.property.update).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.update>>
    );

    await editProperty(brokerContext, validEditInput);

    // Only 1 call to findFirst (to load existing property), not duplicate check
    expect(prisma.property.findFirst).toHaveBeenCalledTimes(1);
  });

  // 6. Active supply pool eligibility preservation
  it("strictly preserves active supply pool eligibility and does not activate unvalidated properties", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
      ...mockExistingProperty,
      ownerWillingnessConfirmed: false,
      validationStatus: "NOT_VALIDATED",
      availabilityStatus: "AVAILABLE",
      isActiveSupply: false,
    } as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>);
    vi.mocked(prisma.property.update).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.update>>
    );

    await editProperty(brokerContext, validEditInput);

    expect(prisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActiveSupply: false,
        }),
      })
    );
  });

  it("keeps property in active supply if already confirmed and validated", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
      ...mockExistingProperty,
      ownerWillingnessConfirmed: true,
      validationStatus: "VALIDATED",
      availabilityStatus: "AVAILABLE",
      isActiveSupply: true,
    } as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>);
    vi.mocked(prisma.property.update).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.update>>
    );

    await editProperty(brokerContext, validEditInput);

    expect(prisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActiveSupply: true,
        }),
      })
    );
  });

  // 7. Field Verifier permissions
  it("allows Field Verifier to edit only properties they personally submitted", async () => {
    // Property submitted by user-verifier-1
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
      ...mockExistingProperty,
      submittingAgentId: "user-verifier-1",
    } as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>);
    vi.mocked(prisma.property.update).mockResolvedValueOnce(
      mockExistingProperty as unknown as Awaited<ReturnType<typeof prisma.property.update>>
    );

    await expect(
      editProperty(fieldVerifierContext, validEditInput)
    ).resolves.toBeDefined();
  });

  it("rejects Field Verifier from editing properties submitted by another user", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
      ...mockExistingProperty,
      submittingAgentId: "user-broker-1", // different user
    } as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>);

    await expect(
      editProperty(fieldVerifierContext, validEditInput)
    ).rejects.toThrow("Field Verifiers may only edit properties submitted by themselves");
  });

  // 8. getPropertyById cross-tenant isolation (Anti-enumeration)
  it("throws NotFoundError when property belongs to another tenant in getPropertyById", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null);

    await expect(
      getPropertyById(brokerContext, "prop-cross-tenant")
    ).rejects.toThrow(NotFoundError);

    expect(prisma.property.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "prop-cross-tenant",
          tenantId: "tenant-apex",
        }),
      })
    );
  });
});
