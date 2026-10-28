import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  UserRole,
  PropertyCallingDisposition,
  SupplyValidationStatus,
  PropertyAvailabilityStatus,
  CallTargetType,
  TransactionType,
  AssignmentStatus,
  AssignmentTargetType,
} from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError, NotFoundError } from "@/server/errors";

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

type MockProperty = NonNullable<Awaited<ReturnType<typeof prisma.property.findFirst>>>;
type MockCallLog = Awaited<ReturnType<typeof prisma.callLog.create>>;

describe("Call Workspace DAL & Business Rules (Step 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const assignedTelecallerContext: TenantContext = {
    userId: "user-telecaller-assigned",
    tenantId: "tenant-apex",
    role: UserRole.TELECALLER,
    user: {
      id: "user-telecaller-assigned",
      email: "pooja@apex.in",
      name: "Pooja Sharma",
      role: UserRole.TELECALLER,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-tc-1",
      token: "tok-tc-1",
      expiresAt: new Date(),
    },
  };

  const unassignedTelecallerContext: TenantContext = {
    userId: "user-telecaller-unassigned",
    tenantId: "tenant-apex",
    role: UserRole.TELECALLER,
    user: {
      id: "user-telecaller-unassigned",
      email: "rohit@apex.in",
      name: "Rohit Verma",
      role: UserRole.TELECALLER,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-tc-2",
      token: "tok-tc-2",
      expiresAt: new Date(),
    },
  };

  const brokerOwnerContext: TenantContext = {
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
      id: "sess-bo-1",
      token: "tok-bo-1",
      expiresAt: new Date(),
    },
  };

  const mockProperty = {
    id: "prop-call-101",
    tenantId: "tenant-apex",
    societyName: "Magnolias",
    flatNumber: "Tower 2 - 801",
    localityName: "Golf Course Road",
    city: "Gurugram",
    preference: TransactionType.SALE,
    price: 35000000,
    area: 2800,
    areaType: "SUPER_BUILT_UP" as const,
    bedroomCount: 4,
    bathroomCount: 4,
    balconyCount: 3,
    ownerName: "Deepak Singhal",
    ownerMobile: "9876543210",
    ownerWillingnessConfirmed: false,
    validationStatus: SupplyValidationStatus.NOT_VALIDATED,
    availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
    isActiveSupply: false,
    submittingAgentId: "user-broker-1",
    assignments: [
      {
        id: "assign-101",
        assignedUserId: "user-telecaller-assigned",
        status: AssignmentStatus.ACTIVE,
        targetType: AssignmentTargetType.PROPERTY,
      },
    ],
    keyHolders: [],
    media: [],
    callLogs: [],
  };

  // 1. Authorized call logging for actively assigned telecaller
  it("allows assigned Telecaller to log a call outcome and creates CallLog record", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty as unknown as MockProperty);

    const createdCallLog = {
      id: "call-1",
      tenantId: "tenant-apex",
      callerId: "user-telecaller-assigned",
      callType: CallTargetType.PROPERTY_VALIDATION,
      propertyId: "prop-call-101",
      propertyDisposition: PropertyCallingDisposition.PROPERTY_AVAILABLE,
      notes: "Spoke with owner Deepak, confirms availability.",
      callbackScheduledAt: null,
      calledAt: new Date(),
    };

    const updatedProperty = {
      ...mockProperty,
      validationStatus: SupplyValidationStatus.IN_VALIDATION,
      callLogs: [createdCallLog],
    };

    vi.mocked(prisma.callLog.create).mockResolvedValueOnce(createdCallLog as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce(updatedProperty as unknown as MockProperty);

    const input: LogPropertyCallInput = {
      propertyId: "prop-call-101",
      disposition: PropertyCallingDisposition.PROPERTY_AVAILABLE,
      notes: "Spoke with owner Deepak, confirms availability.",
      confirmOwnerWillingness: false,
    };

    const result = await logPropertyCall(assignedTelecallerContext, input);

    expect(prisma.callLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-apex",
          callerId: "user-telecaller-assigned",
          propertyId: "prop-call-101",
          propertyDisposition: PropertyCallingDisposition.PROPERTY_AVAILABLE,
          notes: "Spoke with owner Deepak, confirms availability.",
        }),
      })
    );

    expect(result.id).toBe("prop-call-101");
  });

  // 2. Unassigned telecaller access denial
  it("strictly denies unassigned Telecaller from logging call outcome", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty as unknown as MockProperty);

    const input: LogPropertyCallInput = {
      propertyId: "prop-call-101",
      disposition: PropertyCallingDisposition.PROPERTY_AVAILABLE,
      notes: "Unassigned telecaller attempting call log",
    };

    await expect(
      logPropertyCall(unassignedTelecallerContext, input)
    ).rejects.toThrow(ForbiddenError);

    expect(prisma.callLog.create).not.toHaveBeenCalled();
    expect(prisma.property.update).not.toHaveBeenCalled();
  });

  // 3. Cross-tenant isolation (Anti-enumeration)
  it("denies access and throws NotFoundError when property belongs to different tenant", async () => {
    // findFirst returns null due to tenantId mismatch
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null);

    await expect(
      logPropertyCall(assignedTelecallerContext, {
        propertyId: "prop-cross-tenant-999",
        disposition: PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING,
      })
    ).rejects.toThrow(NotFoundError);

    expect(prisma.callLog.create).not.toHaveBeenCalled();
  });

  // 4. Mandatory callback scheduled date & time when disposition is CALL_BACK
  it("requires valid callbackScheduledAt date when disposition is CALL_BACK", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty as unknown as MockProperty);

    // Missing callback date
    await expect(
      logPropertyCall(brokerOwnerContext, {
        propertyId: "prop-call-101",
        disposition: PropertyCallingDisposition.CALL_BACK,
        notes: "Owner asked to call later",
      })
    ).rejects.toThrow("A callback date and time is required when disposition is Call Back.");

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty as unknown as MockProperty);

    // Invalid callback date format
    await expect(
      logPropertyCall(brokerOwnerContext, {
        propertyId: "prop-call-101",
        disposition: PropertyCallingDisposition.CALL_BACK,
        notes: "Owner asked to call later",
        callbackScheduledAt: "invalid-date-string",
      })
    ).rejects.toThrow("Invalid callback date and time format.");

    expect(prisma.callLog.create).not.toHaveBeenCalled();
  });

  // 5. Correct disposition handling & Active Supply Pool qualification rules
  it("qualifies property for Active Supply Pool ONLY when willingness is confirmed AND validated AND available", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty as unknown as MockProperty);

    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-willing" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockProperty,
      ownerWillingnessConfirmed: true,
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
      isActiveSupply: true,
    } as unknown as MockProperty);

    const input: LogPropertyCallInput = {
      propertyId: "prop-call-101",
      disposition: PropertyCallingDisposition.PROPERTY_AVAILABLE,
      confirmOwnerWillingness: true, // EXPLICIT MANDATE CONFIRMATION
      notes: "Owner explicitly authorized brokerage listing and visits.",
    };

    await logPropertyCall(brokerOwnerContext, input);

    expect(prisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerWillingnessConfirmed: true,
          validationStatus: SupplyValidationStatus.VALIDATED,
          availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
          isActiveSupply: true, // MUST be active
        }),
      })
    );
  });

  it("keeps property outside Active Supply Pool if available but owner willingness not confirmed", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty as unknown as MockProperty);

    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-unconfirmed" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockProperty,
      ownerWillingnessConfirmed: false,
      validationStatus: SupplyValidationStatus.IN_VALIDATION,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
      isActiveSupply: false,
    } as unknown as MockProperty);

    const input: LogPropertyCallInput = {
      propertyId: "prop-call-101",
      disposition: PropertyCallingDisposition.PROPERTY_AVAILABLE,
      confirmOwnerWillingness: false, // NOT CONFIRMED
    };

    await logPropertyCall(brokerOwnerContext, input);

    expect(prisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerWillingnessConfirmed: false,
          validationStatus: SupplyValidationStatus.IN_VALIDATION,
          availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
          isActiveSupply: false, // MUST remain false
        }),
      })
    );
  });

  it("handles OWNER_DECLINES_MANDATE by setting validation status to MANDATE_DECLINED", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty as unknown as MockProperty);

    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-declined" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockProperty,
      validationStatus: SupplyValidationStatus.MANDATE_DECLINED,
      ownerWillingnessConfirmed: false,
      isActiveSupply: false,
    } as unknown as MockProperty);

    await logPropertyCall(brokerOwnerContext, {
      propertyId: "prop-call-101",
      disposition: PropertyCallingDisposition.OWNER_DECLINES_MANDATE,
      notes: "Owner stated they do not want to work with any brokers.",
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

  it("handles PROPERTY_SOLD_OR_RENTED by updating availability status to SOLD or RENTED", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty as unknown as MockProperty);

    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-sold" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockProperty,
      availabilityStatus: PropertyAvailabilityStatus.SOLD,
      isActiveSupply: false,
    } as unknown as MockProperty);

    await logPropertyCall(brokerOwnerContext, {
      propertyId: "prop-call-101",
      disposition: PropertyCallingDisposition.PROPERTY_SOLD_OR_RENTED,
      notes: "Owner finalized deal directly last week.",
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

  it("handles TEMPORARILY_UNAVAILABLE by updating availability status", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty as unknown as MockProperty);

    vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-temp" } as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockProperty,
      availabilityStatus: PropertyAvailabilityStatus.TEMPORARILY_UNAVAILABLE,
      isActiveSupply: false,
    } as unknown as MockProperty);

    await logPropertyCall(brokerOwnerContext, {
      propertyId: "prop-call-101",
      disposition: PropertyCallingDisposition.TEMPORARILY_UNAVAILABLE,
      notes: "Flat under painting and deep cleaning until next month.",
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

  // 6. Append-only persistence check
  it("appends new CallLog records without overwriting or mutating previous calls", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty as unknown as MockProperty);

    const call1 = { id: "log-1", propertyDisposition: PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING };
    vi.mocked(prisma.callLog.create).mockResolvedValueOnce(call1 as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockProperty,
      callLogs: [call1],
    } as unknown as MockProperty);

    await logPropertyCall(brokerOwnerContext, {
      propertyId: "prop-call-101",
      disposition: PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING,
    });

    // Second call
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
      ...mockProperty,
      callLogs: [call1],
    } as unknown as MockProperty);

    const call2 = { id: "log-2", propertyDisposition: PropertyCallingDisposition.PROPERTY_AVAILABLE };
    vi.mocked(prisma.callLog.create).mockResolvedValueOnce(call2 as unknown as MockCallLog);
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...mockProperty,
      callLogs: [call2, call1],
    } as unknown as MockProperty);

    await logPropertyCall(brokerOwnerContext, {
      propertyId: "prop-call-101",
      disposition: PropertyCallingDisposition.PROPERTY_AVAILABLE,
      confirmOwnerWillingness: true,
    });

    expect(prisma.callLog.create).toHaveBeenCalledTimes(2);
  });
});
