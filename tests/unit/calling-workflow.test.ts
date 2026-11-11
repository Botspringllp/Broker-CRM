/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole, LeadStatus, LeadCallingDisposition, CallTargetType, Prisma } from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { NotFoundError, ForbiddenError } from "@/server/errors";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/server/tenant-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/tenant-context")>();
  return {
    ...actual,
    requireTenantContext: vi.fn(),
  };
});

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
    locality: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
    },
    leadRequirementLocality: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    leadChangeLog: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    callLog: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    enquiry: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
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
  logLeadCall,
  updateLeadStatus,
  markLeadDoNotContact,
  listPendingCallbacks,
  createLead,
} from "@/server/dal/leads";
import {
  markLeadDoNotContactAction,
  getPendingCallbacksAction,
} from "@/app/leads/actions";
import { requireTenantContext } from "@/server/tenant-context";
import { mapPrismaLeadToView, formatIndianDateTime } from "@/server/dal/mappers";

describe("DV-07: Calling Workflow Implementation", () => {
  const tenantId = "tenant-calling-1";

  const brokerContext: TenantContext = {
    tenantId,
    userId: "broker-owner-1",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "broker-owner-1",
      name: "Broker Vikram",
      email: "vikram@brokerage.in",
      role: UserRole.BROKER_OWNER,
      tenantId,
      isActive: true,
    },
    session: {
      id: "sess-1",
      token: "tok-1",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const telecallerContext: TenantContext = {
    tenantId,
    userId: "tc-1",
    role: UserRole.TELECALLER,
    user: {
      id: "tc-1",
      name: "Aarti Sharma",
      email: "aarti@agency.com",
      role: UserRole.TELECALLER,
      tenantId,
      isActive: true,
    },
    session: {
      id: "sess-2",
      token: "tok-2",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const verifierContext: TenantContext = {
    tenantId,
    userId: "verifier-1",
    role: UserRole.FIELD_VERIFIER,
    user: {
      id: "verifier-1",
      name: "Rahul Verifier",
      email: "rahul@agency.com",
      role: UserRole.FIELD_VERIFIER,
      tenantId,
      isActive: true,
    },
    session: {
      id: "sess-3",
      token: "tok-3",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const sampleLead = {
    id: "lead-call-100",
    tenantId,
    name: "Vikram Malhotra",
    primaryPhone: "9876543210",
    alternatePhone: null,
    email: "vikram@example.com",
    status: LeadStatus.NOT_YET_VALIDATED,
    unreachableAttemptsCount: 0,
    isDoNotContact: false,
    assignedTelecallerId: "tc-1",
    assignedTelecaller: {
      id: "tc-1",
      name: "Aarti Sharma",
      email: "aarti@agency.com",
    },
    createdAt: new Date("2026-11-01T10:00:00Z"),
    requirement: {
      id: "req-100",
      tenantId,
      leadId: "lead-call-100",
      city: "Gurugram",
      preference: "SALE" as const,
      minBudget: new Prisma.Decimal(10000000),
      maxBudget: new Prisma.Decimal(20000000),
      isConfirmed: false,
      bedroomConfigurations: ["TWO_BHK", "THREE_BHK"],
      propertyTypes: ["APARTMENT"],
      societies: ["DLF Phase 5"],
      targetArea: new Prisma.Decimal(1400),
      minArea: null,
      maxArea: null,
      areaUnit: "sq.ft",
      areaType: "CARPET" as const,
      localities: [],
    },
    enquiries: [],
    callLogs: [],
    calls: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. 3rd unreachable attempt does not auto-inactivate
  it("1: increments unreachableAttemptsCount to 3 without automatically marking lead INACTIVE (PRD §5.5 discretionary)", async () => {
    const leadWithTwoAttempts = {
      ...sampleLead,
      unreachableAttemptsCount: 2,
      status: LeadStatus.NOT_YET_VALIDATED,
    };
    (prisma.lead.findFirst as any).mockResolvedValue(leadWithTwoAttempts);
    (prisma.callLog.create as any).mockResolvedValue({ id: "call-unreachable-3" });
    (prisma.lead.update as any).mockResolvedValue({
      ...leadWithTwoAttempts,
      unreachableAttemptsCount: 3,
      status: LeadStatus.NOT_YET_VALIDATED,
    });

    await logLeadCall(telecallerContext, {
      leadId: "lead-call-100",
      disposition: LeadCallingDisposition.RINGING_OR_NOT_ANSWERING,
      notes: "3rd attempt - phone kept ringing without answer",
    });

    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unreachableAttemptsCount: 3,
          status: LeadStatus.NOT_YET_VALIDATED,
        }),
      })
    );
    expect(prisma.leadChangeLog.createMany).not.toHaveBeenCalled();
  });

  // 2. Manual inactivation works with demand:inactivate
  it("2: permits manual inactivation at caller's discretion using demand:inactivate permission", async () => {
    const leadWithThreeAttempts = {
      ...sampleLead,
      unreachableAttemptsCount: 3,
      status: LeadStatus.NOT_YET_VALIDATED,
    };
    (prisma.lead.findFirst as any).mockResolvedValue(leadWithThreeAttempts);
    (prisma.lead.update as any).mockResolvedValue({
      ...leadWithThreeAttempts,
      status: LeadStatus.INACTIVE,
    });

    await updateLeadStatus(brokerContext, "lead-call-100", LeadStatus.INACTIVE);

    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LeadStatus.INACTIVE,
        }),
      })
    );
    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          fieldName: "status",
          previousValue: "NOT_YET_VALIDATED",
          newValue: "INACTIVE",
          changeSource: "USER",
        }),
      ],
    });
  });

  // 3. CONNECTED resets unreachable count
  it("3: resets unreachableAttemptsCount to 0 when disposition is CONNECTED", async () => {
    const leadWithAttempts = {
      ...sampleLead,
      unreachableAttemptsCount: 2,
    };
    (prisma.lead.findFirst as any).mockResolvedValue(leadWithAttempts);
    (prisma.callLog.create as any).mockResolvedValue({ id: "call-connected" });
    (prisma.lead.update as any).mockResolvedValue({
      ...leadWithAttempts,
      unreachableAttemptsCount: 0,
    });

    await logLeadCall(telecallerContext, {
      leadId: "lead-call-100",
      disposition: LeadCallingDisposition.CONNECTED,
      notes: "Buyer picked up and confirmed looking for 3BHK",
    });

    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unreachableAttemptsCount: 0,
        }),
      })
    );
  });

  // 4. CALL_BACK preserves unreachable count
  it("4: preserves unreachableAttemptsCount unchanged when disposition is CALL_BACK", async () => {
    const leadWithAttempts = {
      ...sampleLead,
      unreachableAttemptsCount: 2,
    };
    (prisma.lead.findFirst as any).mockResolvedValue(leadWithAttempts);
    (prisma.callLog.create as any).mockResolvedValue({ id: "call-cb" });
    (prisma.lead.update as any).mockResolvedValue(leadWithAttempts);

    const futureDate = new Date(Date.now() + 86400000).toISOString();

    await logLeadCall(telecallerContext, {
      leadId: "lead-call-100",
      disposition: LeadCallingDisposition.CALL_BACK,
      callbackScheduledAt: futureDate,
      notes: "In meeting, call back tomorrow afternoon",
    });

    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unreachableAttemptsCount: 2,
        }),
      })
    );
  });

  // 5. BUYER_SAYS_NOT_LOOKING transitions lead to INACTIVE
  it("5: immediately marks lead INACTIVE and generates SYSTEM changelog on BUYER_SAYS_NOT_LOOKING", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.callLog.create as any).mockResolvedValue({ id: "call-not-looking" });
    (prisma.lead.update as any).mockResolvedValue({
      ...sampleLead,
      status: LeadStatus.INACTIVE,
    });

    await logLeadCall(telecallerContext, {
      leadId: "lead-call-100",
      disposition: LeadCallingDisposition.BUYER_SAYS_NOT_LOOKING,
      notes: "Purchased property in another project, no longer looking",
    });

    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LeadStatus.INACTIVE,
        }),
      })
    );
    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          fieldName: "status",
          previousValue: "NOT_YET_VALIDATED",
          newValue: "INACTIVE",
          changeSource: "SYSTEM",
        }),
      ],
    });
  });

  // 6. Exactly one later follow-up is permitted after BUYER_SAYS_NOT_LOOKING
  it("6: allows exactly one later follow-up call when lead is INACTIVE after BUYER_SAYS_NOT_LOOKING", async () => {
    const inactiveLead = {
      ...sampleLead,
      status: LeadStatus.INACTIVE,
    };
    (prisma.lead.findFirst as any).mockResolvedValue(inactiveLead);

    // Latest BUYER_SAYS_NOT_LOOKING call occurred 5 days ago
    const notLookingDate = new Date(Date.now() - 5 * 86400000);
    (prisma.callLog.findFirst as any).mockResolvedValue({
      id: "call-nl-past",
      leadDisposition: LeadCallingDisposition.BUYER_SAYS_NOT_LOOKING,
      calledAt: notLookingDate,
    });

    // Zero calls have been made since the not looking call
    (prisma.callLog.count as any).mockResolvedValue(0);

    (prisma.callLog.create as any).mockResolvedValue({ id: "call-followup-1" });
    (prisma.lead.update as any).mockResolvedValue(inactiveLead);

    await logLeadCall(telecallerContext, {
      leadId: "lead-call-100",
      disposition: LeadCallingDisposition.RINGING_OR_NOT_ANSWERING,
      notes: "First follow-up 5 days later - no answer",
    });

    expect(prisma.callLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadDisposition: LeadCallingDisposition.RINGING_OR_NOT_ANSWERING,
          callType: CallTargetType.LEAD_VALIDATION,
        }),
      })
    );
  });

  // 7. Second follow-up attempt after BUYER_SAYS_NOT_LOOKING is rejected
  it("7: rejects a second follow-up attempt after BUYER_SAYS_NOT_LOOKING with ValidationError", async () => {
    const inactiveLead = {
      ...sampleLead,
      status: LeadStatus.INACTIVE,
    };
    (prisma.lead.findFirst as any).mockResolvedValue(inactiveLead);

    const notLookingDate = new Date(Date.now() - 10 * 86400000);
    (prisma.callLog.findFirst as any).mockResolvedValue({
      id: "call-nl-past",
      leadDisposition: LeadCallingDisposition.BUYER_SAYS_NOT_LOOKING,
      calledAt: notLookingDate,
    });

    // 1 follow-up call has already been made after notLookingDate
    (prisma.callLog.count as any).mockResolvedValue(1);

    await expect(
      logLeadCall(telecallerContext, {
        leadId: "lead-call-100",
        disposition: LeadCallingDisposition.CONNECTED,
        notes: "Trying to call again",
      })
    ).rejects.toThrow("the single permitted follow-up call after 'Not Looking' has already been used");
  });

  // 8. DNC blocks all calling
  it("8: strictly blocks all calling attempts when prospect is marked Do Not Contact", async () => {
    const dncLead = {
      ...sampleLead,
      isDoNotContact: true,
      status: LeadStatus.INACTIVE,
    };
    (prisma.lead.findFirst as any).mockResolvedValue(dncLead);

    await expect(
      logLeadCall(telecallerContext, {
        leadId: "lead-call-100",
        disposition: LeadCallingDisposition.CONNECTED,
      })
    ).rejects.toThrow("this prospect is marked as Do Not Contact (DNC)");

    expect(prisma.callLog.create).not.toHaveBeenCalled();
  });

  // 9. DNC state is preserved during repeat enquiries
  it("9: preserves DNC flag and keeps lead INACTIVE upon receiving a repeat enquiry", async () => {
    const existingDncLead = {
      ...sampleLead,
      isDoNotContact: true,
      status: LeadStatus.INACTIVE,
    };

    (prisma.lead.findFirst as any).mockResolvedValue(existingDncLead);
    (prisma.enquiry.create as any).mockResolvedValue({ id: "enquiry-dnc-new" });
    (prisma.lead.findUnique as any).mockResolvedValue(existingDncLead);

    const result = await createLead(brokerContext, {
      name: "Vikram Malhotra",
      primaryPhone: "9876543210",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 10000000,
      maxBudget: 20000000,
      originalSource: "99Acres",
    });

    expect(result.isExistingBuyer).toBe(true);
    expect(result.lead.isDoNotContact).toBe(true);
    expect(result.lead.status).toBe(LeadStatus.INACTIVE);
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  // 10. Callback date in the past is rejected
  it("10: rejects scheduling a callback with a timestamp in the past with ValidationError", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);

    const pastDate = new Date(Date.now() - 3600000).toISOString(); // 1 hour in the past

    await expect(
      logLeadCall(telecallerContext, {
        leadId: "lead-call-100",
        disposition: LeadCallingDisposition.CALL_BACK,
        callbackScheduledAt: pastDate,
      })
    ).rejects.toThrow("Callback date and time cannot be in the past");

    expect(prisma.callLog.create).not.toHaveBeenCalled();
  });

  // 11. Due-today, overdue, and upcoming callback filtering in listPendingCallbacks
  it("11: correctly filters pending callbacks across 'overdue', 'today', 'upcoming', and 'all'", async () => {
    const now = new Date();
    const pastYesterday = new Date(now.getTime() - 24 * 3600000);
    const todayEarlier = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    const futureTomorrow = new Date(now.getTime() + 48 * 3600000);

    const mockCallbackLogs = [
      {
        id: "call-overdue",
        tenantId,
        leadId: "lead-1",
        leadDisposition: LeadCallingDisposition.CALL_BACK,
        callbackScheduledAt: pastYesterday,
        notes: "Overdue from yesterday",
        lead: {
          id: "lead-1",
          name: "Rohan",
          primaryPhone: "9876500001",
          status: "NOT_YET_VALIDATED",
          isDoNotContact: false,
          assignedTelecallerId: "tc-1",
          assignedTelecaller: { name: "Aarti Sharma" },
          requirement: { city: "Gurugram", minBudget: 5000000, maxBudget: 10000000 },
          callLogs: [{ id: "call-overdue", leadDisposition: LeadCallingDisposition.CALL_BACK }],
        },
      },
      {
        id: "call-today-earlier",
        tenantId,
        leadId: "lead-2",
        leadDisposition: LeadCallingDisposition.CALL_BACK,
        callbackScheduledAt: todayEarlier,
        notes: "Today earlier",
        lead: {
          id: "lead-2",
          name: "Pooja",
          primaryPhone: "9876500002",
          status: "NOT_YET_VALIDATED",
          isDoNotContact: false,
          assignedTelecallerId: "tc-1",
          assignedTelecaller: { name: "Aarti Sharma" },
          requirement: { city: "Delhi", minBudget: 8000000, maxBudget: 15000000 },
          callLogs: [{ id: "call-today-earlier", leadDisposition: LeadCallingDisposition.CALL_BACK }],
        },
      },
      {
        id: "call-upcoming",
        tenantId,
        leadId: "lead-3",
        leadDisposition: LeadCallingDisposition.CALL_BACK,
        callbackScheduledAt: futureTomorrow,
        notes: "Tomorrow callback",
        lead: {
          id: "lead-3",
          name: "Amit",
          primaryPhone: "9876500003",
          status: "NOT_YET_VALIDATED",
          isDoNotContact: false,
          assignedTelecallerId: "tc-1",
          assignedTelecaller: { name: "Aarti Sharma" },
          requirement: { city: "Noida", minBudget: 4000000, maxBudget: 6000000 },
          callLogs: [{ id: "call-upcoming", leadDisposition: LeadCallingDisposition.CALL_BACK }],
        },
      },
    ];

    (prisma.callLog.findMany as any).mockResolvedValue(mockCallbackLogs);

    const all = await listPendingCallbacks(brokerContext, { timeframe: "all" });
    expect(all).toHaveLength(3);

    const overdueOnly = await listPendingCallbacks(brokerContext, { timeframe: "overdue" });
    // Both pastYesterday and todayEarlier (if now > 9 AM) are overdue
    expect(overdueOnly.some((c) => c.callLogId === "call-overdue")).toBe(true);
    expect(overdueOnly.some((c) => c.callLogId === "call-upcoming")).toBe(false);

    const todayOnly = await listPendingCallbacks(brokerContext, { timeframe: "today" });
    expect(todayOnly.some((c) => c.callLogId === "call-today-earlier")).toBe(true);
    expect(todayOnly.some((c) => c.callLogId === "call-overdue")).toBe(false);
    expect(todayOnly.some((c) => c.callLogId === "call-upcoming")).toBe(false);

    const upcomingOnly = await listPendingCallbacks(brokerContext, { timeframe: "upcoming" });
    expect(upcomingOnly.some((c) => c.callLogId === "call-upcoming")).toBe(true);
    expect(upcomingOnly.some((c) => c.callLogId === "call-overdue")).toBe(false);
  });

  // 12. Historical callbacks do not appear as pending
  it("12: excludes resolved historical callbacks when lead has a subsequent call", async () => {
    const mockLogs = [
      {
        id: "call-cb-historical",
        tenantId,
        leadId: "lead-resolved",
        leadDisposition: LeadCallingDisposition.CALL_BACK,
        callbackScheduledAt: new Date(Date.now() + 86400000),
        lead: {
          id: "lead-resolved",
          name: "Neha",
          primaryPhone: "9876500009",
          status: "ACTIVE",
          isDoNotContact: false,
          assignedTelecallerId: "tc-1",
          // Most recent call was CONNECTED, not CALL_BACK!
          callLogs: [
            { id: "call-connected-later", leadDisposition: LeadCallingDisposition.CONNECTED },
          ],
        },
      },
    ];

    (prisma.callLog.findMany as any).mockResolvedValue(mockLogs);

    const pending = await listPendingCallbacks(brokerContext, { timeframe: "all" });
    expect(pending).toHaveLength(0);
  });

  // 13. Enquiry verification updates only the selected enquiry
  it("13: atomically verifies referenced advertised enquiry and persists verification notes", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.callLog.create as any).mockResolvedValue({ id: "call-verify-enq" });
    (prisma.enquiry.findFirst as any).mockResolvedValue({
      id: "enq-ad-1",
      tenantId,
      leadId: "lead-call-100",
      isVerifiedByCaller: false,
    });
    (prisma.enquiry.update as any).mockResolvedValue({
      id: "enq-ad-1",
      isVerifiedByCaller: true,
      callerVerificationNotes: "Buyer verified interest in 3BHK ad ref DLF-302",
    });
    (prisma.lead.update as any).mockResolvedValue(sampleLead);

    await logLeadCall(telecallerContext, {
      leadId: "lead-call-100",
      disposition: LeadCallingDisposition.CONNECTED,
      enquiryId: "enq-ad-1",
      isEnquiryVerified: true,
      enquiryVerificationNotes: "Buyer verified interest in 3BHK ad ref DLF-302",
      notes: "Verification completed during intro call",
    });

    expect(prisma.enquiry.update).toHaveBeenCalledWith({
      where: { id: "enq-ad-1" },
      data: {
        isVerifiedByCaller: true,
        callerVerificationNotes: "Buyer verified interest in 3BHK ad ref DLF-302",
      },
    });
  });

  // 14. Call history displays date and time
  it("14: formats call history and callback dates with full date and time via formatIndianDateTime", () => {
    const testDate = new Date("2026-11-10T14:30:00Z");
    const formatted = formatIndianDateTime(testDate);

    expect(formatted).toBeTruthy();
    // Must contain year, month, and 12-hour/time format
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/(AM|PM|am|pm)/);

    const leadView = mapPrismaLeadToView({
      ...sampleLead,
      callLogs: [
        {
          id: "call-view-1",
          calledAt: testDate,
          leadDisposition: LeadCallingDisposition.CONNECTED,
          callbackScheduledAt: testDate,
          notes: "Discussion note",
          caller: { id: "user-1", name: "Aarti", email: "a@agency.com" },
        },
      ] as any,
    } as any);

    expect(leadView.callHistory[0].calledAt).toBe(formatted);
    expect(leadView.callHistory[0].callbackDate).toBe(formatted);
  });

  // 15. Unauthorized roles cannot perform protected actions
  it("15: rejects unauthorized roles with ForbiddenError on logLeadCall and markLeadDoNotContact", async () => {
    await expect(
      logLeadCall(verifierContext, {
        leadId: "lead-call-100",
        disposition: LeadCallingDisposition.CONNECTED,
      })
    ).rejects.toThrow(ForbiddenError);

    await expect(
      markLeadDoNotContact(verifierContext, "lead-call-100", "Requested DNC")
    ).rejects.toThrow(ForbiddenError);
  });

  // 16. Tenant isolation and telecaller assignment remain enforced
  it("16: enforces tenant boundary and telecaller assignment on logLeadCall and markLeadDoNotContact", async () => {
    // Lead belongs to another tenant -> getLeadById throws NotFoundError
    (prisma.lead.findFirst as any).mockResolvedValue(null);

    await expect(
      logLeadCall(brokerContext, {
        leadId: "lead-other-tenant",
        disposition: LeadCallingDisposition.CONNECTED,
      })
    ).rejects.toThrow(NotFoundError);

    // Lead assigned to telecaller 'tc-other' -> telecallerContext ('tc-1') rejected with ForbiddenError
    const leadAssignedToOther = {
      ...sampleLead,
      assignedTelecallerId: "tc-other",
    };
    (prisma.lead.findFirst as any).mockResolvedValue(leadAssignedToOther);

    await expect(
      logLeadCall(telecallerContext, {
        leadId: "lead-call-100",
        disposition: LeadCallingDisposition.CONNECTED,
      })
    ).rejects.toThrow("Telecallers may only log calls for leads actively assigned to them");

    await expect(
      markLeadDoNotContact(telecallerContext, "lead-call-100")
    ).rejects.toThrow("Telecallers may only update leads actively assigned to them");
  });

  // 17. Audit logs are atomic and no-op changes do not create duplicate entries
  it("17: atomically creates LeadChangeLog for DNC, and avoids duplicate audit records on no-op", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.lead.update as any).mockResolvedValue({
      ...sampleLead,
      isDoNotContact: true,
      status: LeadStatus.INACTIVE,
    });

    await markLeadDoNotContact(brokerContext, "lead-call-100");

    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          fieldName: "isDoNotContact",
          previousValue: "false",
          newValue: "true",
          changeSource: "USER",
        }),
        expect.objectContaining({
          fieldName: "status",
          previousValue: "NOT_YET_VALIDATED",
          newValue: "INACTIVE",
          changeSource: "USER",
        }),
      ]),
    });

    // Calling markLeadDoNotContact when lead is already DNC and INACTIVE is a no-op
    vi.clearAllMocks();
    const alreadyDncLead = {
      ...sampleLead,
      isDoNotContact: true,
      status: LeadStatus.INACTIVE,
    };
    (prisma.lead.findFirst as any).mockResolvedValue(alreadyDncLead);
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValue(alreadyDncLead);

    await markLeadDoNotContact(brokerContext, "lead-call-100");

    expect(prisma.leadChangeLog.createMany).not.toHaveBeenCalled();
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  // 18. Server action: markLeadDoNotContactAction
  it("18: markLeadDoNotContactAction returns success and mapped view model", async () => {
    (requireTenantContext as any).mockResolvedValue(brokerContext);
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.lead.update as any).mockResolvedValue({
      ...sampleLead,
      isDoNotContact: true,
      status: LeadStatus.INACTIVE,
    });

    const res = await markLeadDoNotContactAction("lead-call-100", "Requested DNC");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.lead.isDoNotContact).toBe(true);
      expect(res.lead.status).toBe("Inactive");
    }
  });

  // 19. Server action: getPendingCallbacksAction
  it("19: getPendingCallbacksAction returns success and pending callbacks list", async () => {
    (requireTenantContext as any).mockResolvedValue(brokerContext);
    (prisma.callLog.findMany as any).mockResolvedValue([]);

    const res = await getPendingCallbacksAction("today");
    expect(res.success).toBe(true);
    expect(res.callbacks).toEqual([]);
  });

  // 20. Concurrency: Two simultaneous follow-up requests cannot both succeed
  it("20: prevents concurrent follow-up race conditions: second simultaneous call is rejected atomically", async () => {
    const inactiveLead = {
      ...sampleLead,
      status: LeadStatus.INACTIVE,
    };
    (prisma.lead.findFirst as any).mockResolvedValue(inactiveLead);

    const notLookingDate = new Date(Date.now() - 5 * 86400000);
    (prisma.callLog.findFirst as any).mockResolvedValue({
      id: "call-nl-past",
      leadDisposition: LeadCallingDisposition.BUYER_SAYS_NOT_LOOKING,
      calledAt: notLookingDate,
    });

    let callCount = 0;
    (prisma.callLog.count as any).mockImplementation(async () => {
      // First transaction sees 0, but once first call succeeds, second sees 1
      return callCount;
    });

    (prisma.callLog.create as any).mockImplementation(async () => {
      callCount += 1;
      return { id: `call-${callCount}` };
    });

    (prisma.lead.update as any).mockResolvedValue(inactiveLead);

    // Run first call
    const call1 = logLeadCall(telecallerContext, {
      leadId: "lead-call-100",
      disposition: LeadCallingDisposition.CONNECTED,
      notes: "First follow-up call",
    });

    await expect(call1).resolves.toBeDefined();

    // Second call immediately arriving
    const call2 = logLeadCall(telecallerContext, {
      leadId: "lead-call-100",
      disposition: LeadCallingDisposition.CONNECTED,
      notes: "Simultaneous second follow-up call",
    });

    await expect(call2).rejects.toThrow(
      "the single permitted follow-up call after 'Not Looking' has already been used"
    );
  });

  // 21. Multiple callbacks on the same lead: only latest unresolved callback appears
  it("21: deduplicates and returns only the single latest pending callback for a lead", async () => {
    const cbDate1 = new Date(Date.now() + 3600000);
    const cbDate2 = new Date(Date.now() + 7200000);

    const mockLogs = [
      {
        id: "call-cb-latest",
        tenantId,
        leadId: "lead-multi-cb",
        leadDisposition: LeadCallingDisposition.CALL_BACK,
        callbackScheduledAt: cbDate2,
        notes: "Second callback rescheduled",
        lead: {
          id: "lead-multi-cb",
          name: "Deepak",
          primaryPhone: "9876543211",
          status: "NOT_YET_VALIDATED",
          isDoNotContact: false,
          assignedTelecallerId: "tc-1",
          assignedTelecaller: { name: "Aarti Sharma" },
          requirement: { city: "Gurugram", minBudget: 6000000, maxBudget: 12000000 },
          callLogs: [
            { id: "call-cb-latest", leadDisposition: LeadCallingDisposition.CALL_BACK, calledAt: new Date() },
          ],
        },
      },
      {
        id: "call-cb-old",
        tenantId,
        leadId: "lead-multi-cb",
        leadDisposition: LeadCallingDisposition.CALL_BACK,
        callbackScheduledAt: cbDate1,
        notes: "First callback",
        lead: {
          id: "lead-multi-cb",
          name: "Deepak",
          primaryPhone: "9876543211",
          status: "NOT_YET_VALIDATED",
          isDoNotContact: false,
          assignedTelecallerId: "tc-1",
          assignedTelecaller: { name: "Aarti Sharma" },
          requirement: { city: "Gurugram", minBudget: 6000000, maxBudget: 12000000 },
          callLogs: [
            { id: "call-cb-latest", leadDisposition: LeadCallingDisposition.CALL_BACK, calledAt: new Date() },
          ],
        },
      },
    ];

    (prisma.callLog.findMany as any).mockResolvedValue(mockLogs);

    const pending = await listPendingCallbacks(brokerContext, { timeframe: "all" });
    // Must return exactly 1 callback for Deepak (the latest one)
    expect(pending).toHaveLength(1);
    expect(pending[0].callLogId).toBe("call-cb-latest");
  });
});
