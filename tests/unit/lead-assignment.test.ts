/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  UserRole,
  AssignmentTargetType,
  AssignmentRole,
  AssignmentMethod,
  AssignmentStatus,
  LeadStatus,
} from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError, ValidationError, NotFoundError } from "@/server/errors";

// Mock Prisma DB module
vi.mock("@/server/db", () => {
  const mockPrisma = {
    lead: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    leadRequirement: {
      update: vi.fn(),
      upsert: vi.fn(),
    },
    leadChangeLog: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn(),
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
    enquiry: {
      create: vi.fn(),
    },
    property: {
      findFirst: vi.fn(),
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
  assignLeadManually,
  assignLeadRoundRobin,
  getLeadAssignmentHistory,
} from "@/server/dal/assignments";
import { createLead } from "@/server/dal/leads";

describe("DV-08: Lead Assignment Engine & Workload Tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const tenantId = "tenant-apex";

  const brokerContext: TenantContext = {
    userId: "user-broker",
    tenantId,
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-broker",
      email: "broker@apex.in",
      name: "Vikram Broker",
      role: UserRole.BROKER_OWNER,
      tenantId,
      isActive: true,
    },
    session: {
      id: "sess-broker",
      token: "tok-broker",
      expiresAt: new Date(),
    },
  };

  const teamLeaderContext: TenantContext = {
    userId: "user-leader",
    tenantId,
    role: UserRole.TEAM_LEADER,
    user: {
      id: "user-leader",
      email: "leader@apex.in",
      name: "Sunil Leader",
      role: UserRole.TEAM_LEADER,
      tenantId,
      isActive: true,
    },
    session: {
      id: "sess-leader",
      token: "tok-leader",
      expiresAt: new Date(),
    },
  };

  const telecallerContext: TenantContext = {
    userId: "user-telecaller-1",
    tenantId,
    role: UserRole.TELECALLER,
    user: {
      id: "user-telecaller-1",
      email: "caller1@apex.in",
      name: "Pooja Caller",
      role: UserRole.TELECALLER,
      tenantId,
      isActive: true,
    },
    session: {
      id: "sess-caller1",
      token: "tok-caller1",
      expiresAt: new Date(),
    },
  };

  const sampleLead = {
    id: "lead-101",
    tenantId,
    name: "Aman Sharma",
    primaryPhone: "9876543210",
    alternatePhone: null,
    email: "aman@example.com",
    originalSource: "Direct Inquiry",
    sourceCreatedAt: new Date("2026-11-01"),
    assignedTelecallerId: null,
    status: LeadStatus.NOT_YET_VALIDATED,
    unreachableAttemptsCount: 0,
    isDoNotContact: false,
    createdAt: new Date("2026-11-01"),
    updatedAt: new Date("2026-11-01"),
    requirement: {
      id: "req-101",
      city: "Gurugram",
      minBudget: 5000000,
      maxBudget: 15000000,
      preference: "SALE",
      bedroomConfigurations: ["2 BHK", "3 BHK"],
      propertyTypes: ["APARTMENT"],
      societies: [],
      targetArea: null,
      isConfirmed: false,
    },
    enquiries: [],
    callLogs: [],
    assignments: [],
    assignedTelecaller: null,
  };

  const telecaller1 = {
    id: "user-telecaller-1",
    tenantId,
    name: "Pooja Caller",
    email: "caller1@apex.in",
    phone: "9811111111",
    role: UserRole.TELECALLER,
    isActive: true,
    createdAt: new Date("2026-01-01"),
  };

  const telecaller2 = {
    id: "user-telecaller-2",
    tenantId,
    name: "Rahul Sharma",
    email: "caller2@apex.in",
    phone: "9822222222",
    role: UserRole.TELECALLER,
    isActive: true,
    createdAt: new Date("2026-01-02"),
  };

  // -------------------------------------------------------------
  // Test 1: Manual Assignment
  // -------------------------------------------------------------
  it("1. successfully assigns a lead manually to an eligible telecaller", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.user.findFirst as any).mockResolvedValue(telecaller1);
    (prisma.assignment.findFirst as any).mockResolvedValue(null);
    (prisma.lead.update as any).mockResolvedValue({
      ...sampleLead,
      assignedTelecallerId: telecaller1.id,
    });
    (prisma.assignment.create as any).mockResolvedValue({
      id: "asgn-1",
      tenantId,
      targetType: AssignmentTargetType.LEAD,
      leadId: sampleLead.id,
      assignedUserId: telecaller1.id,
      assignedByUserId: brokerContext.userId,
      roleInAssignment: AssignmentRole.TELECALLER_VALIDATION,
      assignmentMethod: AssignmentMethod.MANUAL,
      status: AssignmentStatus.ACTIVE,
      notes: "Priority high budget buyer",
      assignedAt: new Date(),
      assignedUser: telecaller1,
      assignedByUser: brokerContext.user,
    });

    const result = await assignLeadManually(brokerContext, {
      leadId: sampleLead.id,
      telecallerId: telecaller1.id,
      notes: "Priority high budget buyer",
    });

    expect(result.id).toBe("asgn-1");
    expect(result.assignedUserId).toBe(telecaller1.id);
    expect(result.assignmentMethod).toBe(AssignmentMethod.MANUAL);
    expect(result.status).toBe(AssignmentStatus.ACTIVE);
    expect(prisma.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          targetType: AssignmentTargetType.LEAD,
          leadId: sampleLead.id,
          assignedUserId: telecaller1.id,
          assignmentMethod: AssignmentMethod.MANUAL,
          roleInAssignment: AssignmentRole.TELECALLER_VALIDATION,
        }),
      })
    );
  });

  // -------------------------------------------------------------
  // Test 2: Round-Robin Assignment
  // -------------------------------------------------------------
  it("2. successfully assigns a lead via automatic round-robin", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.user.findMany as any).mockResolvedValue([telecaller1, telecaller2]);
    (prisma.assignment.findFirst as any).mockResolvedValue(null);
    (prisma.assignment.count as any)
      .mockResolvedValueOnce(2) // telecaller1 has 2 leads
      .mockResolvedValueOnce(0); // telecaller2 has 0 leads
    (prisma.lead.update as any).mockResolvedValue({
      ...sampleLead,
      assignedTelecallerId: telecaller2.id,
    });
    (prisma.assignment.create as any).mockResolvedValue({
      id: "asgn-rr-1",
      tenantId,
      targetType: AssignmentTargetType.LEAD,
      leadId: sampleLead.id,
      assignedUserId: telecaller2.id,
      assignedByUserId: brokerContext.userId,
      assignmentMethod: AssignmentMethod.ROUND_ROBIN,
      status: AssignmentStatus.ACTIVE,
      assignedUser: telecaller2,
      assignedByUser: brokerContext.user,
    });

    const result = await assignLeadRoundRobin(brokerContext, {
      leadId: sampleLead.id,
    });

    expect(result.assignedUserId).toBe(telecaller2.id);
    expect(result.assignmentMethod).toBe(AssignmentMethod.ROUND_ROBIN);
  });

  // -------------------------------------------------------------
  // Test 3: Least-Loaded Selection
  // -------------------------------------------------------------
  it("3. fairly selects the telecaller with the lowest active lead workload", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.user.findMany as any).mockResolvedValue([telecaller1, telecaller2]);
    (prisma.assignment.findFirst as any).mockResolvedValue(null);
    (prisma.assignment.count as any)
      .mockResolvedValueOnce(5) // caller 1
      .mockResolvedValueOnce(1); // caller 2 (least loaded)

    (prisma.lead.update as any).mockResolvedValue({
      ...sampleLead,
      assignedTelecallerId: telecaller2.id,
    });
    (prisma.assignment.create as any).mockResolvedValue({
      id: "asgn-least-load",
      assignedUserId: telecaller2.id,
      assignmentMethod: AssignmentMethod.ROUND_ROBIN,
    });

    const result = await assignLeadRoundRobin(teamLeaderContext, {
      leadId: sampleLead.id,
    });

    expect(result.assignedUserId).toBe(telecaller2.id);
  });

  // -------------------------------------------------------------
  // Test 4: Tie-breaking by oldest assignment timestamp
  // -------------------------------------------------------------
  it("4. tie-breaks using oldest assignment timestamp when workloads are equal", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.user.findMany as any).mockResolvedValue([telecaller1, telecaller2]);
    (prisma.assignment.findFirst as any)
      .mockResolvedValueOnce(null) // existingActive check on lead
      .mockResolvedValueOnce({ assignedAt: new Date("2026-11-10T10:00:00Z") }) // caller1 assigned 1 hour ago
      .mockResolvedValueOnce({ assignedAt: new Date("2026-11-09T10:00:00Z") }); // caller2 assigned yesterday (idle longest)

    (prisma.assignment.count as any)
      .mockResolvedValueOnce(2) // caller 1 count = 2
      .mockResolvedValueOnce(2); // caller 2 count = 2 (tied)

    (prisma.lead.update as any).mockResolvedValue(sampleLead);
    (prisma.assignment.create as any).mockResolvedValue({
      id: "asgn-tie-break",
      assignedUserId: telecaller2.id,
    });

    const result = await assignLeadRoundRobin(brokerContext, {
      leadId: sampleLead.id,
    });

    expect(result.assignedUserId).toBe(telecaller2.id);
  });

  // -------------------------------------------------------------
  // Test 5: No Eligible Telecallers
  // -------------------------------------------------------------
  it("5. throws ValidationError when no eligible telecallers exist in the tenant", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.user.findMany as any).mockResolvedValue([]); // No telecallers

    await expect(
      assignLeadRoundRobin(brokerContext, { leadId: sampleLead.id })
    ).rejects.toThrow(ValidationError);
  });

  // -------------------------------------------------------------
  // Test 6: Invalid Telecaller ID
  // -------------------------------------------------------------
  it("6. throws ValidationError when target telecaller ID is invalid", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.user.findFirst as any).mockResolvedValue(null); // Not found

    await expect(
      assignLeadManually(brokerContext, {
        leadId: sampleLead.id,
        telecallerId: "non-existent-user",
      })
    ).rejects.toThrow(ValidationError);
  });

  // -------------------------------------------------------------
  // Test 7: Cross-tenant Telecaller Rejection
  // -------------------------------------------------------------
  it("7. rejects assignment when telecaller belongs to a different tenant", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    // User query includes tenantId: context.tenantId so returns null
    (prisma.user.findFirst as any).mockResolvedValue(null);

    await expect(
      assignLeadManually(brokerContext, {
        leadId: sampleLead.id,
        telecallerId: "other-tenant-caller",
      })
    ).rejects.toThrow(ValidationError);
  });

  // -------------------------------------------------------------
  // Test 8: Inactive Telecaller Rejection
  // -------------------------------------------------------------
  it("8. rejects assignment when target telecaller is deactivated", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.user.findFirst as any).mockResolvedValue(null); // query requires isActive: true

    await expect(
      assignLeadManually(brokerContext, {
        leadId: sampleLead.id,
        telecallerId: "inactive-caller",
      })
    ).rejects.toThrow(ValidationError);
  });

  // -------------------------------------------------------------
  // Test 9: Non-TELECALLER Role Rejection
  // -------------------------------------------------------------
  it("9. rejects assignment when target user is not a TELECALLER", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.user.findFirst as any).mockResolvedValue(null); // query requires role: UserRole.TELECALLER

    await expect(
      assignLeadManually(brokerContext, {
        leadId: sampleLead.id,
        telecallerId: "sales-agent-id",
      })
    ).rejects.toThrow(ValidationError);
  });

  // -------------------------------------------------------------
  // Test 10: Unauthorized Role Rejection
  // -------------------------------------------------------------
  it("10. rejects assignment attempts from unauthorized callers (e.g. Telecaller)", async () => {
    await expect(
      assignLeadManually(telecallerContext, {
        leadId: sampleLead.id,
        telecallerId: telecaller2.id,
      })
    ).rejects.toThrow(ForbiddenError);

    await expect(
      assignLeadRoundRobin(telecallerContext, {
        leadId: sampleLead.id,
      })
    ).rejects.toThrow(ForbiddenError);
  });

  // -------------------------------------------------------------
  // Test 11: Duplicate Assignment Prevention
  // -------------------------------------------------------------
  it("11. prevents duplicate active assignment to the exact same telecaller", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue({
      ...sampleLead,
      assignedTelecallerId: telecaller1.id,
    });
    (prisma.user.findFirst as any).mockResolvedValue(telecaller1);
    (prisma.assignment.findFirst as any).mockResolvedValue({
      id: "asgn-existing-1",
      assignedUserId: telecaller1.id,
      status: AssignmentStatus.ACTIVE,
    });

    await expect(
      assignLeadManually(brokerContext, {
        leadId: sampleLead.id,
        telecallerId: telecaller1.id,
      })
    ).rejects.toThrow("Lead is already actively assigned to this telecaller.");
  });

  // -------------------------------------------------------------
  // Test 12: Reassignment History Preservation
  // -------------------------------------------------------------
  it("12. marks previous assignment REASSIGNED with unassignedAt upon reassignment", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue({
      ...sampleLead,
      assignedTelecallerId: telecaller1.id,
    });
    (prisma.user.findFirst as any).mockResolvedValue(telecaller2);
    (prisma.assignment.findFirst as any).mockResolvedValue({
      id: "asgn-old-1",
      assignedUserId: telecaller1.id,
      status: AssignmentStatus.ACTIVE,
    });
    (prisma.lead.update as any).mockResolvedValue({
      ...sampleLead,
      assignedTelecallerId: telecaller2.id,
    });
    (prisma.assignment.update as any).mockResolvedValue({
      id: "asgn-old-1",
      status: AssignmentStatus.REASSIGNED,
    });
    (prisma.assignment.create as any).mockResolvedValue({
      id: "asgn-new-2",
      assignedUserId: telecaller2.id,
      status: AssignmentStatus.ACTIVE,
    });

    const result = await assignLeadManually(brokerContext, {
      leadId: sampleLead.id,
      telecallerId: telecaller2.id,
      notes: "Reassigning for follow-up",
    });

    expect(prisma.assignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "asgn-old-1" },
        data: expect.objectContaining({
          status: AssignmentStatus.REASSIGNED,
          unassignedAt: expect.any(Date),
        }),
      })
    );
    expect(result.id).toBe("asgn-new-2");
  });

  // -------------------------------------------------------------
  // Test 13: LeadChangeLog Creation
  // -------------------------------------------------------------
  it("13. records assignedTelecallerId audit log in LeadChangeLog upon reassignment", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue({
      ...sampleLead,
      assignedTelecallerId: telecaller1.id,
    });
    (prisma.user.findFirst as any).mockResolvedValue(telecaller2);
    (prisma.assignment.findFirst as any).mockResolvedValue({
      id: "asgn-old-1",
      assignedUserId: telecaller1.id,
      status: AssignmentStatus.ACTIVE,
    });
    (prisma.lead.update as any).mockResolvedValue(sampleLead);
    (prisma.assignment.update as any).mockResolvedValue({});
    (prisma.assignment.create as any).mockResolvedValue({
      id: "asgn-new-2",
      assignedUserId: telecaller2.id,
    });

    await assignLeadManually(brokerContext, {
      leadId: sampleLead.id,
      telecallerId: telecaller2.id,
    });

    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            fieldName: "assignedTelecallerId",
            previousValue: telecaller1.id,
            newValue: telecaller2.id,
            changeSource: "USER",
          }),
        ]),
      })
    );
  });

  // -------------------------------------------------------------
  // Test 14: No-op Audit Suppression
  // -------------------------------------------------------------
  it("14. does not create duplicate LeadChangeLog or Assignment when reassigning to same assignee", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue({
      ...sampleLead,
      assignedTelecallerId: telecaller1.id,
    });
    (prisma.user.findFirst as any).mockResolvedValue(telecaller1);
    (prisma.assignment.findFirst as any).mockResolvedValue({
      id: "asgn-1",
      assignedUserId: telecaller1.id,
      status: AssignmentStatus.ACTIVE,
    });

    await expect(
      assignLeadManually(brokerContext, {
        leadId: sampleLead.id,
        telecallerId: telecaller1.id,
      })
    ).rejects.toThrow();

    expect(prisma.leadChangeLog.createMany).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------
  // Test 15: Manager-created lead automatic round-robin
  // -------------------------------------------------------------
  it("15. createLead automatically assigns lead via round-robin when manager leaves telecaller unselected", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(null); // No duplicate buyer
    (prisma.user.findMany as any).mockResolvedValue([telecaller1, telecaller2]);
    (prisma.assignment.count as any).mockResolvedValue(0);
    (prisma.assignment.findFirst as any).mockResolvedValue(null);

    const createdLeadData = {
      ...sampleLead,
      id: "new-lead-auto",
      assignedTelecallerId: telecaller1.id,
    };
    (prisma.lead.create as any).mockResolvedValue(createdLeadData);
    (prisma.user.findFirst as any).mockResolvedValue(telecaller1);
    (prisma.assignment.create as any).mockResolvedValue({
      id: "asgn-auto",
      assignedUserId: telecaller1.id,
      assignmentMethod: AssignmentMethod.ROUND_ROBIN,
    });

    const res = await createLead(brokerContext, {
      name: "Auto Assigned Buyer",
      primaryPhone: "9812345678",
      originalSource: "MagicBricks",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 10000000,
      maxBudget: 20000000,
    });

    expect(res.lead.assignedTelecallerId).toBe(telecaller1.id);
    expect(prisma.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignmentMethod: AssignmentMethod.ROUND_ROBIN,
          assignedUserId: telecaller1.id,
        }),
      })
    );
  });

  // -------------------------------------------------------------
  // Test 16: Manager-created lead manual assignment
  // -------------------------------------------------------------
  it("16. createLead manually assigns lead and creates Assignment record when manager selects a telecaller", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(null);
    (prisma.user.findFirst as any).mockResolvedValue(telecaller2);
    (prisma.assignment.findFirst as any).mockResolvedValue(null);

    const createdLeadData = {
      ...sampleLead,
      id: "new-lead-manual",
      assignedTelecallerId: telecaller2.id,
    };
    (prisma.lead.create as any).mockResolvedValue(createdLeadData);
    (prisma.assignment.create as any).mockResolvedValue({
      id: "asgn-manual",
      assignedUserId: telecaller2.id,
      assignmentMethod: AssignmentMethod.MANUAL,
    });

    const res = await createLead(brokerContext, {
      name: "Manual Assigned Buyer",
      primaryPhone: "9812345679",
      originalSource: "Direct Call",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 10000000,
      maxBudget: 20000000,
      assignedTelecallerId: telecaller2.id,
    });

    expect(res.lead.assignedTelecallerId).toBe(telecaller2.id);
    expect(prisma.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignmentMethod: AssignmentMethod.MANUAL,
          assignedUserId: telecaller2.id,
        }),
      })
    );
  });

  // -------------------------------------------------------------
  // Test 17: Telecaller self-assignment
  // -------------------------------------------------------------
  it("17. createLead self-assigns lead to telecaller when telecaller creates it directly", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(null);
    (prisma.user.findFirst as any).mockResolvedValue(telecaller1);
    (prisma.assignment.findFirst as any).mockResolvedValue(null);

    const createdLeadData = {
      ...sampleLead,
      id: "new-caller-lead",
      assignedTelecallerId: telecallerContext.userId,
    };
    (prisma.lead.create as any).mockResolvedValue(createdLeadData);
    (prisma.assignment.create as any).mockResolvedValue({
      id: "asgn-self",
      assignedUserId: telecallerContext.userId,
      assignmentMethod: AssignmentMethod.MANUAL,
    });

    const res = await createLead(telecallerContext, {
      name: "Walk-in Prospect",
      primaryPhone: "9812345680",
      originalSource: "Walk-in",
      city: "Gurugram",
      preference: "RENT",
      minBudget: 30000,
      maxBudget: 50000,
    });

    expect(res.lead.assignedTelecallerId).toBe(telecallerContext.userId);
  });

  // -------------------------------------------------------------
  // Test 18: Repeat enquiry preserves existing assignment
  // -------------------------------------------------------------
  it("18. repeat enquiry for duplicate buyer preserves existing assignment without reassignment", async () => {
    const existingActiveLead = {
      ...sampleLead,
      id: "existing-lead-1",
      assignedTelecallerId: telecaller1.id,
      status: LeadStatus.NOT_YET_VALIDATED,
    };

    (prisma.lead.findFirst as any).mockResolvedValue(existingActiveLead);
    (prisma.enquiry.create as any).mockResolvedValue({ id: "enq-repeat-1" });
    (prisma.lead.findUnique as any).mockResolvedValue(existingActiveLead);

    const res = await createLead(brokerContext, {
      name: "Existing Buyer",
      primaryPhone: "9876543210",
      originalSource: "99acres",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 5000000,
      maxBudget: 15000000,
      assignedTelecallerId: telecaller2.id, // Manager provides different telecaller on repeat
    });

    expect(res.isExistingBuyer).toBe(true);
    // Preserves telecaller1; does NOT reassign to telecaller2
    expect(res.lead.assignedTelecallerId).toBe(telecaller1.id);
    expect(prisma.assignment.update).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------
  // Test 19: Concurrent Assignment Consistency
  // -------------------------------------------------------------
  it("19. locks lead during round-robin transaction to guarantee concurrency safety", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.user.findMany as any).mockResolvedValue([telecaller1]);
    (prisma.assignment.count as any).mockResolvedValue(0);
    (prisma.assignment.findFirst as any).mockResolvedValue(null);
    (prisma.lead.update as any).mockResolvedValue(sampleLead);
    (prisma.assignment.create as any).mockResolvedValue({
      id: "asgn-concurrent",
      assignedUserId: telecaller1.id,
    });

    await assignLeadRoundRobin(brokerContext, { leadId: sampleLead.id });

    // Verifies lead.update was called first to obtain row lock
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: sampleLead.id },
        data: expect.objectContaining({
          updatedAt: expect.any(Date),
        }),
      })
    );
  });

  // -------------------------------------------------------------
  // Test 20: Assignment History Tenant & Telecaller Scoping
  // -------------------------------------------------------------
  it("20. getLeadAssignmentHistory enforces tenant isolation and blocks unassigned telecallers", async () => {
    // Lead assigned to telecaller2
    (prisma.lead.findFirst as any).mockResolvedValue({
      id: "lead-peer",
      tenantId,
      assignedTelecallerId: telecaller2.id,
    });

    // Telecaller1 tries to view history of lead assigned to peer telecaller2
    await expect(
      getLeadAssignmentHistory(telecallerContext, "lead-peer")
    ).rejects.toThrow(NotFoundError);

    // Broker can view
    (prisma.assignment.findMany as any).mockResolvedValue([
      {
        id: "asgn-hist-1",
        tenantId,
        leadId: "lead-peer",
        assignedUserId: telecaller2.id,
        assignedByUserId: brokerContext.userId,
        assignmentMethod: AssignmentMethod.MANUAL,
        status: AssignmentStatus.ACTIVE,
        notes: null,
        assignedAt: new Date(),
        unassignedAt: null,
        assignedUser: telecaller2,
        assignedByUser: brokerContext.user,
      },
    ]);

    const history = await getLeadAssignmentHistory(brokerContext, "lead-peer");
    expect(history.length).toBe(1);
    expect(history[0].assignedUserId).toBe(telecaller2.id);
  });
});
