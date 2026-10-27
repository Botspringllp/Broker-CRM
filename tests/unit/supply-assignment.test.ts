import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  UserRole,
  AssignmentTargetType,
  AssignmentRole,
  AssignmentMethod,
  AssignmentStatus,
  TransactionType,
  SupplyValidationStatus,
  PropertyAvailabilityStatus,
  PropertyCallingDisposition,
} from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError, ValidationError, NotFoundError } from "@/server/errors";

// Mock Prisma DB module
vi.mock("@/server/db", () => {
  const mockPrisma = {
    property: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    assignment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    callLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (arg) => {
      if (typeof arg === "function") {
        return arg(mockPrisma);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg;
    }),
  };
  return { prisma: mockPrisma };
});

import { prisma } from "@/server/db";
import {
  assignPropertyManually,
  assignPropertyRoundRobin,
  listEligibleTelecallers,
  getPropertyAssignmentHistory,
} from "@/server/dal/assignments";
import { listProperties, logPropertyCall } from "@/server/dal/properties";

type MockProperty = NonNullable<Awaited<ReturnType<typeof prisma.property.findFirst>>>;
type MockUser = NonNullable<Awaited<ReturnType<typeof prisma.user.findFirst>>>;
type MockAssignment = NonNullable<Awaited<ReturnType<typeof prisma.assignment.findFirst>>>;

describe("Supply Validation - Property Assignment & Telecaller Access Control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const brokerOwnerContext: TenantContext = {
    userId: "user-vikram",
    tenantId: "tenant-apex",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-vikram",
      email: "vikram.owner@apexrealty.in",
      name: "Vikram Mehta",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-vikram",
      token: "tok-vikram",
      expiresAt: new Date(),
    },
  };

  const teamLeaderContext: TenantContext = {
    userId: "user-sunil",
    tenantId: "tenant-apex",
    role: UserRole.TEAM_LEADER,
    user: {
      id: "user-sunil",
      email: "sunil.manager@apexrealty.in",
      name: "Sunil Grover",
      role: UserRole.TEAM_LEADER,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-sunil",
      token: "tok-sunil",
      expiresAt: new Date(),
    },
  };

  const telecallerContext: TenantContext = {
    userId: "user-pooja",
    tenantId: "tenant-apex",
    role: UserRole.TELECALLER,
    user: {
      id: "user-pooja",
      email: "pooja.telecaller@apexrealty.in",
      name: "Pooja Sharma",
      role: UserRole.TELECALLER,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-pooja",
      token: "tok-pooja",
      expiresAt: new Date(),
    },
  };

  const fieldSalesContext: TenantContext = {
    userId: "user-rahul",
    tenantId: "tenant-apex",
    role: UserRole.FIELD_SALES_AGENT,
    user: {
      id: "user-rahul",
      email: "rahul.sales@apexrealty.in",
      name: "Rahul Varma",
      role: UserRole.FIELD_SALES_AGENT,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-rahul",
      token: "tok-rahul",
      expiresAt: new Date(),
    },
  };

  const crossTenantManagerContext: TenantContext = {
    userId: "user-other-mgr",
    tenantId: "tenant-horizon",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-other-mgr",
      email: "other@horizon.in",
      name: "Other Manager",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-horizon",
      isActive: true,
    },
    session: {
      id: "sess-other",
      token: "tok-other",
      expiresAt: new Date(),
    },
  };

  const mockProperty: MockProperty = {
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
    propertyType: "APARTMENT",
    furnishingStatus: "SEMI_FURNISHED",
    constructionStatus: "READY_TO_MOVE",
    ownerName: "Rameshwar Kulkarni",
    ownerMobile: "+91 98111 22334",
    ownerWillingnessConfirmed: false,
    validationStatus: SupplyValidationStatus.NOT_VALIDATED,
    availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
    isActiveSupply: false,
    amenities: ["GYM", "SWIMMING_POOL"],
    rentedAt: null,
    revalidationStatus: "NONE",
    submittingAgentId: "user-pooja",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as MockProperty;

  const mockTelecaller1: MockUser = {
    id: "user-pooja",
    tenantId: "tenant-apex",
    name: "Pooja Sharma",
    email: "pooja.telecaller@apexrealty.in",
    phone: "+91 98000 00003",
    role: UserRole.TELECALLER,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date(),
    emailVerified: true,
    image: null,
    brokerId: null,
    teamLeaderId: null,
    delegatedPermissions: [],
  } as unknown as MockUser;

  const mockTelecaller2: MockUser = {
    id: "user-rohit",
    tenantId: "tenant-apex",
    name: "Rohit Verma",
    email: "rohit.telecaller@apexrealty.in",
    phone: "+91 98000 00004",
    role: UserRole.TELECALLER,
    isActive: true,
    createdAt: new Date("2026-01-02T00:00:00Z"),
    updatedAt: new Date(),
    emailVerified: true,
    image: null,
    brokerId: null,
    teamLeaderId: null,
    delegatedPermissions: [],
  } as unknown as MockUser;

  // -------------------------------------------------------------
  // Test 1: Successful manual assignment
  // -------------------------------------------------------------
  it("1. successfully assigns a property manually to an eligible telecaller", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(mockTelecaller1);
    vi.mocked(prisma.assignment.findFirst).mockResolvedValueOnce(null); // No previous active assignment
    vi.mocked(prisma.assignment.create).mockResolvedValueOnce({
      id: "assign-new-1",
      tenantId: "tenant-apex",
      targetType: AssignmentTargetType.PROPERTY,
      propertyId: "prop-101",
      assignedUserId: "user-pooja",
      assignedByUserId: "user-vikram",
      roleInAssignment: AssignmentRole.TELECALLER_VALIDATION,
      assignmentMethod: AssignmentMethod.MANUAL,
      status: AssignmentStatus.ACTIVE,
      notes: "High priority owner",
      assignedAt: new Date(),
      unassignedAt: null,
      assignedUser: mockTelecaller1,
      assignedByUser: brokerOwnerContext.user,
    } as unknown as MockAssignment);
    vi.mocked(prisma.property.update).mockResolvedValueOnce(mockProperty);

    const result = await assignPropertyManually(brokerOwnerContext, {
      propertyId: "prop-101",
      telecallerId: "user-pooja",
      notes: "High priority owner",
    });

    expect(result.id).toBe("assign-new-1");
    expect(result.assignedUserId).toBe("user-pooja");
    expect(result.assignmentMethod).toBe(AssignmentMethod.MANUAL);
    expect(result.status).toBe(AssignmentStatus.ACTIVE);
    expect(prisma.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-apex",
          propertyId: "prop-101",
          assignedUserId: "user-pooja",
          assignedByUserId: "user-vikram",
          assignmentMethod: AssignmentMethod.MANUAL,
          status: AssignmentStatus.ACTIVE,
          notes: "High priority owner",
        }),
      })
    );
  });

  // -------------------------------------------------------------
  // Test 2: Successful round-robin assignment
  // -------------------------------------------------------------
  it("2. successfully assigns a property via automatic round-robin", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([mockTelecaller1, mockTelecaller2]);
    vi.mocked(prisma.assignment.findFirst)
      .mockResolvedValueOnce(null) // existingActive check
      .mockResolvedValueOnce(null) // lastAssignment telecaller 1
      .mockResolvedValueOnce(null); // lastAssignment telecaller 2
    vi.mocked(prisma.assignment.count).mockResolvedValue(0);

    vi.mocked(prisma.assignment.create).mockResolvedValueOnce({
      id: "assign-rr-1",
      tenantId: "tenant-apex",
      targetType: AssignmentTargetType.PROPERTY,
      propertyId: "prop-101",
      assignedUserId: "user-pooja",
      assignedByUserId: "user-sunil",
      roleInAssignment: AssignmentRole.TELECALLER_VALIDATION,
      assignmentMethod: AssignmentMethod.ROUND_ROBIN,
      status: AssignmentStatus.ACTIVE,
      notes: null,
      assignedAt: new Date(),
      unassignedAt: null,
      assignedUser: mockTelecaller1,
      assignedByUser: teamLeaderContext.user,
    } as unknown as MockAssignment);
    vi.mocked(prisma.property.update).mockResolvedValueOnce(mockProperty);

    const result = await assignPropertyRoundRobin(teamLeaderContext, {
      propertyId: "prop-101",
    });

    expect(result.id).toBe("assign-rr-1");
    expect(result.assignmentMethod).toBe(AssignmentMethod.ROUND_ROBIN);
    expect(result.status).toBe(AssignmentStatus.ACTIVE);
    expect(prisma.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignmentMethod: AssignmentMethod.ROUND_ROBIN,
          status: AssignmentStatus.ACTIVE,
          assignedByUserId: "user-sunil",
        }),
      })
    );
  });

  // -------------------------------------------------------------
  // Test 3: Fair distribution across eligible telecallers
  // -------------------------------------------------------------
  it("3. fairly selects the telecaller with the lowest active workload", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([mockTelecaller1, mockTelecaller2]);
    vi.mocked(prisma.assignment.findFirst)
      .mockResolvedValueOnce(null) // existingActive
      .mockResolvedValueOnce({ assignedAt: new Date("2026-10-25T10:00:00Z") } as unknown as MockAssignment) // last telecaller 1
      .mockResolvedValueOnce({ assignedAt: new Date("2026-10-24T10:00:00Z") } as unknown as MockAssignment); // last telecaller 2

    // Telecaller 1 has 3 active assignments; Telecaller 2 has only 1 active assignment
    vi.mocked(prisma.assignment.count)
      .mockResolvedValueOnce(3) // telecaller 1
      .mockResolvedValueOnce(1); // telecaller 2

    vi.mocked(prisma.assignment.create).mockResolvedValueOnce({
      id: "assign-rr-fair",
      assignedUserId: "user-rohit", // Rohit chosen because of lower count (1 < 3)
      assignmentMethod: AssignmentMethod.ROUND_ROBIN,
      status: AssignmentStatus.ACTIVE,
    } as unknown as MockAssignment);
    vi.mocked(prisma.property.update).mockResolvedValueOnce(mockProperty);

    const result = await assignPropertyRoundRobin(brokerOwnerContext, {
      propertyId: "prop-101",
    });

    expect(prisma.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignedUserId: "user-rohit", // Rohit selected because of lowest workload
        }),
      })
    );
    expect(result.assignedUserId).toBe("user-rohit");
  });

  // -------------------------------------------------------------
  // Test 4: No eligible telecallers available
  // -------------------------------------------------------------
  it("4. throws ValidationError when no eligible telecallers exist in the tenant", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([]); // 0 telecallers

    await expect(
      assignPropertyRoundRobin(brokerOwnerContext, {
        propertyId: "prop-101",
      })
    ).rejects.toThrow(ValidationError);

    expect(prisma.assignment.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------
  // Test 5: Cross-tenant assignment rejection
  // -------------------------------------------------------------
  it("5. rejects assignment when property belongs to another tenant (anti-enumeration)", async () => {
    // Property not found under cross-tenant's tenantId
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null);

    await expect(
      assignPropertyManually(crossTenantManagerContext, {
        propertyId: "prop-101",
        telecallerId: "user-pooja",
      })
    ).rejects.toThrow(NotFoundError);

    expect(prisma.assignment.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------
  // Test 6: Unauthorized assignment rejection
  // -------------------------------------------------------------
  it("6. rejects assignment attempts from unauthorized roles (e.g. Field Sales Agent or Telecaller)", async () => {
    await expect(
      assignPropertyManually(fieldSalesContext, {
        propertyId: "prop-101",
        telecallerId: "user-pooja",
      })
    ).rejects.toThrow(ForbiddenError);

    await expect(
      assignPropertyRoundRobin(telecallerContext, {
        propertyId: "prop-101",
      })
    ).rejects.toThrow(ForbiddenError);

    expect(prisma.assignment.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------
  // Test 7: Duplicate active-assignment prevention
  // -------------------------------------------------------------
  it("7. prevents duplicate active assignment to the exact same telecaller", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(mockTelecaller1);
    vi.mocked(prisma.assignment.findFirst).mockResolvedValueOnce({
      id: "assign-active-1",
      propertyId: "prop-101",
      assignedUserId: "user-pooja", // Already assigned to Pooja!
      status: AssignmentStatus.ACTIVE,
    } as unknown as MockAssignment);

    await expect(
      assignPropertyManually(brokerOwnerContext, {
        propertyId: "prop-101",
        telecallerId: "user-pooja",
      })
    ).rejects.toThrow(ValidationError);

    expect(prisma.assignment.create).not.toHaveBeenCalled();
    expect(prisma.assignment.update).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------
  // Test 8: Reassignment preserving previous assignment history
  // -------------------------------------------------------------
  it("8. preserves history upon reassignment: marks old assignment REASSIGNED and creates new ACTIVE record", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(mockTelecaller2); // Reassigning to Rohit
    const existingActive = {
      id: "assign-active-old",
      propertyId: "prop-101",
      assignedUserId: "user-pooja",
      status: AssignmentStatus.ACTIVE,
    } as unknown as MockAssignment;

    vi.mocked(prisma.assignment.findFirst).mockResolvedValueOnce(existingActive);
    vi.mocked(prisma.assignment.update).mockResolvedValueOnce({
      ...existingActive,
      status: AssignmentStatus.REASSIGNED,
      unassignedAt: new Date(),
    } as unknown as MockAssignment);

    vi.mocked(prisma.assignment.create).mockResolvedValueOnce({
      id: "assign-new-rohit",
      propertyId: "prop-101",
      assignedUserId: "user-rohit",
      status: AssignmentStatus.ACTIVE,
      assignmentMethod: AssignmentMethod.MANUAL,
    } as unknown as MockAssignment);
    vi.mocked(prisma.property.update).mockResolvedValueOnce(mockProperty);

    const result = await assignPropertyManually(brokerOwnerContext, {
      propertyId: "prop-101",
      telecallerId: "user-rohit",
    });

    // Verify old assignment was marked REASSIGNED with unassignedAt timestamp
    expect(prisma.assignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "assign-active-old" },
        data: expect.objectContaining({
          status: AssignmentStatus.REASSIGNED,
          unassignedAt: expect.any(Date),
        }),
      })
    );

    // Verify new assignment created as ACTIVE for new assignee
    expect(prisma.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignedUserId: "user-rohit",
          status: AssignmentStatus.ACTIVE,
        }),
      })
    );
    expect(result.id).toBe("assign-new-rohit");
  });

  // -------------------------------------------------------------
  // Test 9: Telecaller access restricted to currently assigned properties
  // -------------------------------------------------------------
  it("9. restricts telecaller validation queue strictly to actively assigned properties", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([]);

    await listProperties(telecallerContext);

    // Verify query where clause strictly checks active assignment for this telecaller
    expect(prisma.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-apex",
          assignments: {
            some: {
              assignedUserId: "user-pooja",
              status: AssignmentStatus.ACTIVE,
              targetType: AssignmentTargetType.PROPERTY,
            },
          },
        }),
      })
    );
  });

  // -------------------------------------------------------------
  // Test 10: Call logging rejected for unassigned properties
  // -------------------------------------------------------------
  it("10. rejects call logging for telecaller when property is not actively assigned to them, even if submitter", async () => {
    // Property submitted by Pooja, but assigned to another telecaller
    const unassignedProperty = {
      ...mockProperty,
      submittingAgentId: "user-pooja", // Submitter
      assignments: [
        {
          id: "assign-rohit",
          assignedUserId: "user-rohit", // Different assignee
          status: AssignmentStatus.ACTIVE,
          targetType: AssignmentTargetType.PROPERTY,
        },
      ],
    };

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(
      unassignedProperty as unknown as MockProperty
    );

    await expect(
      logPropertyCall(telecallerContext, {
        propertyId: "prop-101",
        disposition: PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING,
      })
    ).rejects.toThrow(ForbiddenError);

    expect(prisma.callLog.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------
  // Test 11: Validation queue excluding properties that should not be in the queue
  // -------------------------------------------------------------
  it("11. excludes active-supply properties from leaking into the telecaller validation queue", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([]);

    // Query validation queue (isActiveSupply not set or false)
    await listProperties(telecallerContext, { isActiveSupply: false });

    // Verify query does not include OR with isActiveSupply: true leak
    const callArgs = vi.mocked(prisma.property.findMany).mock.calls[0][0];
    expect(callArgs?.where?.assignments).toEqual({
      some: {
        assignedUserId: "user-pooja",
        status: AssignmentStatus.ACTIVE,
        targetType: AssignmentTargetType.PROPERTY,
      },
    });
    // Ensure isActiveSupply: true is NOT in OR
    expect(callArgs?.where?.OR).toBeUndefined();
  });

  // -------------------------------------------------------------
  // Test 12: Concurrent requests handling
  // -------------------------------------------------------------
  it("12. handles concurrent assignment requests safely via atomic transaction", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValue(mockProperty);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(mockTelecaller1);
    vi.mocked(prisma.assignment.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.assignment.create).mockResolvedValue({
      id: "assign-concurrent",
      status: AssignmentStatus.ACTIVE,
    } as unknown as MockAssignment);
    vi.mocked(prisma.property.update).mockResolvedValue(mockProperty);

    // Run parallel assignment invocations
    const [res1, res2] = await Promise.all([
      assignPropertyManually(brokerOwnerContext, {
        propertyId: "prop-101",
        telecallerId: "user-pooja",
      }),
      assignPropertyManually(teamLeaderContext, {
        propertyId: "prop-101",
        telecallerId: "user-pooja",
      }),
    ]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(res1).toBeDefined();
    expect(res2).toBeDefined();
  });

  // -------------------------------------------------------------
  // Extra: getPropertyAssignmentHistory & listEligibleTelecallers
  // -------------------------------------------------------------
  it("successfully retrieves assignment audit history and eligible telecallers", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([mockTelecaller1, mockTelecaller2]);
    const telecallers = await listEligibleTelecallers(brokerOwnerContext);
    expect(telecallers).toHaveLength(2);

    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(mockProperty);
    vi.mocked(prisma.assignment.findMany).mockResolvedValueOnce([
      { id: "assign-1", status: AssignmentStatus.ACTIVE } as unknown as MockAssignment,
      { id: "assign-0", status: AssignmentStatus.REASSIGNED } as unknown as MockAssignment,
    ]);

    const history = await getPropertyAssignmentHistory(brokerOwnerContext, "prop-101");
    expect(history).toHaveLength(2);
    expect(prisma.assignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          propertyId: "prop-101",
          tenantId: "tenant-apex",
          targetType: AssignmentTargetType.PROPERTY,
        },
        orderBy: { assignedAt: "desc" },
      })
    );
  });
});
