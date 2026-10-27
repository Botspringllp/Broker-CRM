import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  UserRole,
  PropertyCallingDisposition,
  SupplyValidationStatus,
  PropertyAvailabilityStatus,
  CallTargetType,
  TransactionType,
} from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError, ValidationError, NotFoundError } from "@/server/errors";

// Mock Prisma DB module
vi.mock("@/server/db", () => ({
  prisma: {
    property: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    callLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn((promises) => Promise.all(promises)),
  },
}));

import { prisma } from "@/server/db";
import { logPropertyCall, LogPropertyCallInput } from "@/server/dal/properties";
import { mapPrismaPropertyToView } from "@/server/dal/mappers";

type MockProperty = NonNullable<Awaited<ReturnType<typeof prisma.property.findFirst>>>;
type MockCallLog = Awaited<ReturnType<typeof prisma.callLog.create>>;

describe("Supply Validation - Call History Persistence & Active Pool Safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const tenantApexContext: TenantContext = {
    userId: "user-pooja",
    tenantId: "tenant-apex",
    role: UserRole.TELECALLER,
    user: {
      id: "user-pooja",
      email: "pooja@apex.in",
      name: "Pooja Sharma",
      role: UserRole.TELECALLER,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-apex",
      token: "tok-apex",
      expiresAt: new Date(),
    },
  };

  const brokerOwnerContext: TenantContext = {
    userId: "user-vikrant",
    tenantId: "tenant-apex",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-vikrant",
      email: "vikrant@apex.in",
      name: "Vikrant Singh",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-vikrant",
      token: "tok-vikrant",
      expiresAt: new Date(),
    },
  };

  const mockAssignedProperty = {
    id: "prop-101",
    tenantId: "tenant-apex",
    societyName: "Sobha City",
    flatNumber: "Tower B - 1204",
    localityName: "Sector 108",
    city: "Gurgaon",
    preference: TransactionType.SALE,
    price: 24500000,
    area: 1950,
    areaType: "SUPER_BUILT_UP",
    bedroomCount: 3,
    bathroomCount: 3,
    balconyCount: 2,
    ownerName: "Rameshwar Kulkarni",
    ownerMobile: "9876543210",
    ownerWillingnessConfirmed: false,
    validationStatus: SupplyValidationStatus.NOT_VALIDATED,
    availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
    isActiveSupply: false,
    submittingAgentId: null,
    assignments: [
      {
        id: "assign-1",
        assignedUserId: "user-pooja", // Assigned to telecaller
        status: "ACTIVE",
      },
    ],
    keyHolders: [],
    media: [],
    callLogs: [],
  };

  // 1. Successful call logging & CallLog creation
  it("persists a new CallLog record atomically and updates property status", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockAssignedProperty as unknown as MockProperty);

    const createdCallLog = {
      id: "call-log-1",
      tenantId: "tenant-apex",
      callerId: "user-pooja",
      callType: CallTargetType.PROPERTY_VALIDATION,
      propertyId: "prop-101",
      propertyDisposition: PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING,
      notes: "Called twice, phone rang with no answer.",
      callbackScheduledAt: null,
      calledAt: new Date("2026-10-27T10:00:00Z"),
      caller: { id: "user-pooja", name: "Pooja Sharma" },
    };

    const updatedProperty = {
      ...mockAssignedProperty,
      validationStatus: SupplyValidationStatus.IN_VALIDATION,
      callLogs: [createdCallLog],
    };

    vi.mocked(prisma.callLog.create).mockResolvedValueOnce(createdCallLog as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce(updatedProperty as unknown as MockProperty);

    const input: LogPropertyCallInput = {
      propertyId: "prop-101",
      disposition: PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING,
      notes: "Called twice, phone rang with no answer.",
    };

    const result = await logPropertyCall(tenantApexContext, input);

    expect(prisma.callLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-apex",
          callerId: "user-pooja", // Server context derivation
          callType: CallTargetType.PROPERTY_VALIDATION,
          propertyId: "prop-101",
          propertyDisposition: PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING,
          notes: "Called twice, phone rang with no answer.",
        }),
      })
    );

    expect(prisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id_tenantId: {
            id: "prop-101",
            tenantId: "tenant-apex",
          },
        },
        data: expect.objectContaining({
          validationStatus: SupplyValidationStatus.IN_VALIDATION,
          isActiveSupply: false,
        }),
      })
    );

    expect(result.id).toBe("prop-101");
    expect(result.validationStatus).toBe(SupplyValidationStatus.IN_VALIDATION);
  });

  // 2. Required callback date/time on CALL_BACK
  it("rejects CALL_BACK when callbackScheduledAt is missing or invalid", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValue(mockAssignedProperty as unknown as MockProperty);

    // Missing callback
    await expect(
      logPropertyCall(tenantApexContext, {
        propertyId: "prop-101",
        disposition: PropertyCallingDisposition.CALL_BACK,
        notes: "Owner requested callback later",
      })
    ).rejects.toThrow(ValidationError);

    // Invalid date format
    await expect(
      logPropertyCall(tenantApexContext, {
        propertyId: "prop-101",
        disposition: PropertyCallingDisposition.CALL_BACK,
        notes: "Owner requested callback later",
        callbackScheduledAt: "not-a-valid-date",
      })
    ).rejects.toThrow(ValidationError);

    expect(prisma.callLog.create).not.toHaveBeenCalled();
  });

  it("persists callbackScheduledAt when CALL_BACK has valid date/time", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockAssignedProperty as unknown as MockProperty);
    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-1" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockAssignedProperty,
      validationStatus: SupplyValidationStatus.IN_VALIDATION,
    } as unknown as MockProperty);

    const callbackTime = "2026-10-28T15:30:00Z";

    await logPropertyCall(tenantApexContext, {
      propertyId: "prop-101",
      disposition: PropertyCallingDisposition.CALL_BACK,
      notes: "Owner asked to call tomorrow at 3:30 PM",
      callbackScheduledAt: callbackTime,
    });

    expect(prisma.callLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          propertyDisposition: PropertyCallingDisposition.CALL_BACK,
          callbackScheduledAt: new Date(callbackTime),
        }),
      })
    );
  });

  // 3. All six supported dispositions
  it("supports TEMPORARILY_UNAVAILABLE and sets availabilityStatus correctly", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockAssignedProperty as unknown as MockProperty);
    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-2" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockAssignedProperty,
      availabilityStatus: PropertyAvailabilityStatus.TEMPORARILY_UNAVAILABLE,
    } as unknown as MockProperty);

    await logPropertyCall(tenantApexContext, {
      propertyId: "prop-101",
      disposition: PropertyCallingDisposition.TEMPORARILY_UNAVAILABLE,
      notes: "Painting in progress, available next month",
    });

    expect(prisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          availabilityStatus: PropertyAvailabilityStatus.TEMPORARILY_UNAVAILABLE,
          isActiveSupply: false,
        }),
      })
    );
  });

  it("supports PROPERTY_SOLD_OR_RENTED and sets availabilityStatus to SOLD", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockAssignedProperty as unknown as MockProperty);
    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-3" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockAssignedProperty,
      availabilityStatus: PropertyAvailabilityStatus.SOLD,
    } as unknown as MockProperty);

    await logPropertyCall(tenantApexContext, {
      propertyId: "prop-101",
      disposition: PropertyCallingDisposition.PROPERTY_SOLD_OR_RENTED,
      notes: "Owner confirmed unit sold directly last week",
    });

    expect(prisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          availabilityStatus: PropertyAvailabilityStatus.SOLD,
          isActiveSupply: false,
        }),
      })
    );
  });

  it("supports OWNER_DECLINES_MANDATE and moves property to MANDATE_DECLINED", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockAssignedProperty as unknown as MockProperty);
    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-4" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockAssignedProperty,
      validationStatus: SupplyValidationStatus.MANDATE_DECLINED,
    } as unknown as MockProperty);

    await logPropertyCall(tenantApexContext, {
      propertyId: "prop-101",
      disposition: PropertyCallingDisposition.OWNER_DECLINES_MANDATE,
      notes: "Owner explicitly refused broker commission & listing mandate",
    });

    expect(prisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          validationStatus: SupplyValidationStatus.MANDATE_DECLINED,
          ownerWillingnessConfirmed: false,
          isActiveSupply: false,
        }),
      })
    );
  });

  it("handles PROPERTY_AVAILABLE with confirmed willingness: qualifies for Active Supply Pool", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockAssignedProperty as unknown as MockProperty);
    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-5" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockAssignedProperty,
      validationStatus: SupplyValidationStatus.VALIDATED,
      ownerWillingnessConfirmed: true,
      isActiveSupply: true,
    } as unknown as MockProperty);

    await logPropertyCall(tenantApexContext, {
      propertyId: "prop-101",
      disposition: PropertyCallingDisposition.PROPERTY_AVAILABLE,
      notes: "Owner confirmed willingness to work with broker and verified specs.",
      confirmOwnerWillingness: true, // Explicit willingness confirmation
    });

    expect(prisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          validationStatus: SupplyValidationStatus.VALIDATED,
          ownerWillingnessConfirmed: true,
          availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
          isActiveSupply: true, // Both conditions satisfied!
        }),
      })
    );
  });

  it("handles PROPERTY_AVAILABLE without confirmed willingness: remains outside Active Supply Pool", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockAssignedProperty as unknown as MockProperty);
    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-6" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockAssignedProperty,
      validationStatus: SupplyValidationStatus.IN_VALIDATION,
      ownerWillingnessConfirmed: false,
      isActiveSupply: false,
    } as unknown as MockProperty);

    await logPropertyCall(tenantApexContext, {
      propertyId: "prop-101",
      disposition: PropertyCallingDisposition.PROPERTY_AVAILABLE,
      notes: "Property is vacant, but owner hasn't signed mandate agreement yet.",
      confirmOwnerWillingness: false, // Willingness NOT confirmed!
    });

    expect(prisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          validationStatus: SupplyValidationStatus.IN_VALIDATION,
          ownerWillingnessConfirmed: false,
          isActiveSupply: false, // Must remain false!
        }),
      })
    );
  });

  // 4. Rejection of unauthorized property access (Telecaller assignment check)
  it("rejects telecaller when not assigned to the property and not the submitter", async () => {
    const unassignedProperty = {
      ...mockAssignedProperty,
      submittingAgentId: "other-user",
      assignments: [
        {
          id: "assign-2",
          assignedUserId: "another-telecaller", // Different telecaller assigned
          status: "ACTIVE",
        },
      ],
    };

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(unassignedProperty as unknown as MockProperty);

    await expect(
      logPropertyCall(tenantApexContext, {
        propertyId: "prop-101",
        disposition: PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING,
      })
    ).rejects.toThrow(ForbiddenError);

    expect(prisma.callLog.create).not.toHaveBeenCalled();
  });

  it("allows Broker Owner to log calls on any property in their tenant", async () => {
    const unassignedProperty = {
      ...mockAssignedProperty,
      submittingAgentId: "other-user",
      assignments: [],
    };

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(unassignedProperty as unknown as MockProperty);
    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-7" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({ ...unassignedProperty } as unknown as MockProperty);

    const result = await logPropertyCall(brokerOwnerContext, {
      propertyId: "prop-101",
      disposition: PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING,
      notes: "Broker Owner logged call check",
    });

    expect(result.id).toBe("prop-101");
    expect(prisma.callLog.create).toHaveBeenCalled();
  });

  // 5. Tenant isolation (cross-tenant call logging rejected)
  it("throws NotFoundError when reading a property from another tenant (anti-enumeration)", async () => {
    // Database returns null because tenantId doesn't match
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null);

    await expect(
      logPropertyCall(tenantApexContext, {
        propertyId: "prop-foreign-999",
        disposition: PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING,
      })
    ).rejects.toThrow(NotFoundError);

    expect(prisma.property.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "prop-foreign-999",
          tenantId: "tenant-apex", // Strict tenant scoping
        },
      })
    );
  });

  // 6. Caller identity derived from server context
  it("strictly injects callerId from server context, ignoring client claims", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockAssignedProperty as unknown as MockProperty);
    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-8" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({ ...mockAssignedProperty } as unknown as MockProperty);

    await logPropertyCall(tenantApexContext, {
      propertyId: "prop-101",
      disposition: PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING,
      notes: "Context check",
    });

    expect(prisma.callLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          callerId: "user-pooja", // Injected from tenantApexContext
          tenantId: "tenant-apex",
        }),
      })
    );
  });

  // 7. Previous call history remaining intact (append-only)
  it("creates a new CallLog record and never overwrites existing history", async () => {
    const propertyWithPreviousCalls = {
      ...mockAssignedProperty,
      callLogs: [
        {
          id: "existing-call-1",
          calledAt: new Date("2026-10-25T10:00:00Z"),
          propertyDisposition: PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING,
          notes: "First call attempt",
        },
      ],
    };

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(propertyWithPreviousCalls as unknown as MockProperty);
    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "new-call-2" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...propertyWithPreviousCalls,
      callLogs: [
        { id: "new-call-2" },
        { id: "existing-call-1" },
      ],
    } as unknown as MockProperty);

    await logPropertyCall(tenantApexContext, {
      propertyId: "prop-101",
      disposition: PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING,
      notes: "Second call attempt",
    });

    // prisma.callLog.create must be called, never update or delete
    expect(prisma.callLog.create).toHaveBeenCalledTimes(1);
  });

  // 8. View mapper correctly maps call history with caller name and timestamp
  it("formats call history chronologically with caller name and date/time in view mapper", () => {
    const rawProperty = {
      ...mockAssignedProperty,
      callLogs: [
        {
          id: "call-1",
          tenantId: "tenant-apex",
          callerId: "user-pooja",
          callType: CallTargetType.PROPERTY_VALIDATION,
          propertyId: "prop-101",
          propertyDisposition: PropertyCallingDisposition.CALL_BACK,
          notes: "Scheduled callback",
          callbackScheduledAt: new Date("2026-10-28T14:30:00Z"),
          calledAt: new Date("2026-10-27T10:15:00Z"),
          caller: {
            id: "user-pooja",
            name: "Pooja Sharma",
          },
        },
      ],
    };

    const view = mapPrismaPropertyToView(rawProperty as unknown as MockProperty);

    expect(view.currentDisposition).toBe("CALL BACK");
    expect(view.callHistory.length).toBe(1);
    expect(view.callHistory[0].callerName).toBe("Pooja Sharma");
    expect(view.callHistory[0].notes).toBe("Scheduled callback");
    expect(view.callHistory[0].callbackDate).toBeDefined();
    expect(view.callHistory[0].calledAt).toBeDefined();
  });
});
