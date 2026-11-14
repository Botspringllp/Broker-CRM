/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  UserRole,
  LeadStatus,
  LeadCallingDisposition,
  TransactionType,
  PropertyType,
  Prisma,
} from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError } from "@/server/errors";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    callLog: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    locality: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
    },
    leadRequirementLocality: {
      findMany: vi.fn().mockResolvedValue([]),
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
import { requireTenantContext } from "@/server/tenant-context";
import {
  getCallerDashboardMetrics,
  getManagerDemandMetrics,
  listLeads,
} from "@/server/dal/leads";
import {
  getCallerDashboardMetricsAction,
  getManagerDemandMetricsAction,
} from "@/app/leads/actions";
import { OverviewClient } from "@/app/OverviewClient";
import { CallerDashboardMetrics, ManagerDemandMetrics } from "@/types/crm";

describe("DV-09: Caller & Manager Dashboard Metrics & All 7 PRD Filters", () => {
  const tenantId = "tenant-crm-alpha";
  const otherTenantId = "tenant-crm-beta";
  const telecallerId = "telecaller-pooja-1";

  const telecallerContext: TenantContext = {
    tenantId,
    userId: telecallerId,
    role: UserRole.TELECALLER,
    user: {
      id: telecallerId,
      name: "Pooja Sharma",
      email: "pooja@brokerage.in",
      role: UserRole.TELECALLER,
      tenantId,
      isActive: true,
      delegatedPermissions: [],
    },
    session: {
      id: "sess-tc-1",
      token: "tok-1",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const managerContext: TenantContext = {
    tenantId,
    userId: "manager-vikram-1",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "manager-vikram-1",
      name: "Vikram Broker",
      email: "vikram@brokerage.in",
      role: UserRole.BROKER_OWNER,
      tenantId,
      isActive: true,
      delegatedPermissions: [],
    },
    session: {
      id: "sess-mgr-1",
      token: "tok-2",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const otherTenantTelecallerContext: TenantContext = {
    tenantId: otherTenantId,
    userId: "tc-other-tenant",
    role: UserRole.TELECALLER,
    user: {
      id: "tc-other-tenant",
      name: "Other TC",
      email: "other@other.in",
      role: UserRole.TELECALLER,
      tenantId: otherTenantId,
      isActive: true,
      delegatedPermissions: [],
    },
    session: {
      id: "sess-other",
      token: "tok-3",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. CALLER DASHBOARD METRICS
  // =========================================================================

  it("1. getCallerDashboardMetrics aggregates assigned total, pending, active, and inactive lead counts", async () => {
    (prisma.lead.count as any).mockImplementation(async (args: any) => {
      const status = args?.where?.status;
      if (status === LeadStatus.NOT_YET_VALIDATED) return 12;
      if (status === LeadStatus.ACTIVE) return 25;
      if (status === LeadStatus.INACTIVE) return 8;
      if (args?.where?.unreachableAttemptsCount === 2) return 3;
      return 45; // total assigned
    });

    (prisma.callLog.count as any).mockImplementation(async (args: any) => {
      if (args?.where?.leadDisposition === LeadCallingDisposition.CONNECTED) return 7;
      return 15; // total calls
    });

    vi.mocked(prisma.callLog.findMany).mockResolvedValueOnce([]); // no pending callbacks

    const metrics = await getCallerDashboardMetrics(telecallerContext);

    expect(metrics.assignedTotal).toBe(45);
    expect(metrics.pendingValidation).toBe(12);
    expect(metrics.activeLeads).toBe(25);
    expect(metrics.inactiveLeads).toBe(8);
    expect(metrics.unreachableNearLimit).toBe(3);

    // Verify tenant and caller scoping in Prisma queries
    expect(prisma.lead.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          assignedTelecallerId: telecallerId,
        }),
      })
    );
  });

  it("2. getCallerDashboardMetrics counts calls logged today and connected calls today", async () => {
    vi.mocked(prisma.lead.count).mockResolvedValue(0);

    (prisma.callLog.count as any).mockImplementation(async (args: any) => {
      if (args?.where?.leadDisposition === LeadCallingDisposition.CONNECTED) return 9;
      return 22; // total logged today
    });

    vi.mocked(prisma.callLog.findMany).mockResolvedValueOnce([]);

    const metrics = await getCallerDashboardMetrics(telecallerContext);

    expect(metrics.callsLoggedToday).toBe(22);
    expect(metrics.connectedToday).toBe(9);

    // Verify callerId and calledAt boundaries
    expect(prisma.callLog.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          callerId: telecallerId,
          calledAt: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      })
    );
  });

  it("3. getCallerDashboardMetrics calculates callbacks due today and overdue accurately", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T10:00:00Z"));

    try {
      vi.mocked(prisma.lead.count).mockResolvedValue(10);
      vi.mocked(prisma.callLog.count).mockResolvedValue(5);

      const now = new Date("2026-05-15T10:00:00Z");
      const overdueDate = new Date(now.getTime() - 86400000 * 2); // 2 days ago (strictly before today)
      const todayDate = new Date(now.getTime() + 1800000); // 30 min from now (today)
      const futureDate = new Date(now.getTime() + 86400000 * 2); // 2 days later

    const mockCallbackLogs = [
      {
        id: "call-overdue",
        leadId: "lead-1",
        callbackScheduledAt: overdueDate,
        lead: {
          id: "lead-1",
          name: "Overdue Prospect",
          primaryPhone: "9810011111",
          status: LeadStatus.NOT_YET_VALIDATED,
          isDoNotContact: false,
          callLogs: [{ id: "call-overdue", leadDisposition: LeadCallingDisposition.CALL_BACK }],
          requirement: { city: "Gurugram" },
        },
      },
      {
        id: "call-today",
        leadId: "lead-2",
        callbackScheduledAt: todayDate,
        lead: {
          id: "lead-2",
          name: "Today Prospect",
          primaryPhone: "9810022222",
          status: LeadStatus.NOT_YET_VALIDATED,
          isDoNotContact: false,
          callLogs: [{ id: "call-today", leadDisposition: LeadCallingDisposition.CALL_BACK }],
          requirement: { city: "Gurugram" },
        },
      },
      {
        id: "call-future",
        leadId: "lead-3",
        callbackScheduledAt: futureDate,
        lead: {
          id: "lead-3",
          name: "Future Prospect",
          primaryPhone: "9810033333",
          status: LeadStatus.NOT_YET_VALIDATED,
          isDoNotContact: false,
          callLogs: [{ id: "call-future", leadDisposition: LeadCallingDisposition.CALL_BACK }],
          requirement: { city: "Gurugram" },
        },
      },
    ];

    vi.mocked(prisma.callLog.findMany).mockResolvedValueOnce(mockCallbackLogs as any);

    const metrics = await getCallerDashboardMetrics(telecallerContext);

    expect(metrics.callbacksOverdue).toBe(1);
    expect(metrics.callbacksDueToday).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

  it("4. getCallerDashboardMetrics tracks unreachable attempts near the 3-attempt limit", async () => {
    (prisma.lead.count as any).mockImplementation(async (args: any) => {
      if (args?.where?.unreachableAttemptsCount === 2) return 5;
      return 10;
    });
    vi.mocked(prisma.callLog.count).mockResolvedValue(0);
    vi.mocked(prisma.callLog.findMany).mockResolvedValueOnce([]);

    const metrics = await getCallerDashboardMetrics(telecallerContext);

    expect(metrics.unreachableNearLimit).toBe(5);
    expect(prisma.lead.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          assignedTelecallerId: telecallerId,
          unreachableAttemptsCount: 2,
          status: { not: LeadStatus.INACTIVE },
          isDoNotContact: false,
        }),
      })
    );
  });

  // =========================================================================
  // 2. MANAGER DEMAND METRICS
  // =========================================================================

  it("5. getManagerDemandMetrics returns tenant-wide lead counts, unassigned count, and daily calls", async () => {
    (prisma.lead.count as any).mockImplementation(async (args: any) => {
      if (args?.where?.assignedTelecallerId === null) return 14; // unassigned
      if (args?.where?.status === LeadStatus.NOT_YET_VALIDATED) return 30;
      if (args?.where?.status === LeadStatus.ACTIVE) return 60;
      if (args?.where?.status === LeadStatus.INACTIVE) return 20;
      return 110; // total
    });

    (prisma.callLog.count as any).mockImplementation(async (args: any) => {
      if (args?.where?.leadDisposition === LeadCallingDisposition.CONNECTED) return 18;
      return 50; // total team calls
    });

    vi.mocked(prisma.callLog.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([]);

    const metrics = await getManagerDemandMetrics(managerContext);

    expect(metrics.totalLeads).toBe(110);
    expect(metrics.unassignedLeads).toBe(14);
    expect(metrics.pendingValidation).toBe(30);
    expect(metrics.activeLeads).toBe(60);
    expect(metrics.inactiveLeads).toBe(20);
    expect(metrics.callsLoggedToday).toBe(50);
    expect(metrics.connectedToday).toBe(18);
  });

  it("6. getManagerDemandMetrics aggregates active telecaller workloads", async () => {
    (prisma.lead.count as any).mockImplementation(async (args: any) => {
      if (args?.where?.assignedTelecallerId === "tc-1" && args?.where?.status === LeadStatus.ACTIVE) return 15;
      if (args?.where?.assignedTelecallerId === "tc-1" && args?.where?.status === LeadStatus.NOT_YET_VALIDATED) return 8;
      if (args?.where?.assignedTelecallerId === "tc-2" && args?.where?.status === LeadStatus.ACTIVE) return 20;
      if (args?.where?.assignedTelecallerId === "tc-2" && args?.where?.status === LeadStatus.NOT_YET_VALIDATED) return 5;
      return 50;
    });

    vi.mocked(prisma.callLog.count).mockResolvedValue(0);
    vi.mocked(prisma.callLog.findMany).mockResolvedValueOnce([]);

    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([
      { id: "tc-1", name: "Pooja Sharma", email: "pooja@brokerage.in" },
      { id: "tc-2", name: "Rahul Verma", email: "rahul@brokerage.in" },
    ] as any);

    const metrics = await getManagerDemandMetrics(managerContext);

    expect(metrics.telecallerWorkloads).toHaveLength(2);
    expect(metrics.telecallerWorkloads[0]).toEqual(
      expect.objectContaining({
        telecallerId: "tc-1",
        telecallerName: "Pooja Sharma",
        activeLeadCount: 15,
        pendingValidationCount: 8,
      })
    );
    expect(metrics.telecallerWorkloads[1]).toEqual(
      expect.objectContaining({
        telecallerId: "tc-2",
        telecallerName: "Rahul Verma",
        activeLeadCount: 20,
        pendingValidationCount: 5,
      })
    );
  });

  // =========================================================================
  // 3. SECURITY & RBAC
  // =========================================================================

  it("7. getManagerDemandMetrics strictly rejects Telecaller with ForbiddenError", async () => {
    await expect(getManagerDemandMetrics(telecallerContext)).rejects.toThrow(ForbiddenError);
  });

  it("8. getCallerDashboardMetrics strictly enforces tenant isolation", async () => {
    vi.mocked(prisma.lead.count).mockResolvedValue(0);
    vi.mocked(prisma.callLog.count).mockResolvedValue(0);
    vi.mocked(prisma.callLog.findMany).mockResolvedValueOnce([]);

    await getCallerDashboardMetrics(otherTenantTelecallerContext);

    expect(prisma.lead.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: otherTenantId,
          assignedTelecallerId: "tc-other-tenant",
        }),
      })
    );
  });

  // =========================================================================
  // 4. SERVER ACTIONS
  // =========================================================================

  it("9. getCallerDashboardMetricsAction returns metrics for authenticated caller", async () => {
    vi.mocked(requireTenantContext).mockResolvedValueOnce(telecallerContext);
    vi.mocked(prisma.lead.count).mockResolvedValue(10);
    vi.mocked(prisma.callLog.count).mockResolvedValue(4);
    vi.mocked(prisma.callLog.findMany).mockResolvedValueOnce([]);

    const res = await getCallerDashboardMetricsAction();

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.metrics.assignedTotal).toBe(10);
    }
  });

  it("10. getManagerDemandMetricsAction rejects Telecaller and returns success for Manager", async () => {
    vi.mocked(requireTenantContext).mockResolvedValueOnce(telecallerContext);
    const failRes = await getManagerDemandMetricsAction();
    expect(failRes.success).toBe(false);

    vi.mocked(requireTenantContext).mockResolvedValueOnce(managerContext);
    vi.mocked(prisma.lead.count).mockResolvedValue(100);
    vi.mocked(prisma.callLog.count).mockResolvedValue(20);
    vi.mocked(prisma.callLog.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([]);

    const successRes = await getManagerDemandMetricsAction();
    expect(successRes.success).toBe(true);
  });

  // =========================================================================
  // 5. ALL SEVEN PRD §5.6 FILTERS IN listLeads
  // =========================================================================

  it("11. listLeads filters by minimum and maximum budget (PRD Filter 1)", async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([]);

    await listLeads(managerContext, {
      minBudget: 5000000,
      maxBudget: 15000000,
    });

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          requirement: expect.objectContaining({
            AND: [
              { maxBudget: { gte: new Prisma.Decimal(5000000) } },
              { minBudget: { lte: new Prisma.Decimal(15000000) } },
            ],
          }),
        }),
      })
    );
  });

  it("12. listLeads filters by verified locality (PRD Filter 2)", async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([]);

    await listLeads(managerContext, {
      localityId: "loc-sector-54",
    });

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          requirement: expect.objectContaining({
            localities: {
              some: { localityId: "loc-sector-54" },
            },
          }),
        }),
      })
    );
  });

  it("13. listLeads filters by City (PRD Filter 3)", async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([]);

    await listLeads(managerContext, {
      city: "Gurugram",
    });

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          requirement: expect.objectContaining({
            city: "Gurugram",
          }),
        }),
      })
    );
  });

  it("14. listLeads filters by Lead Status (PRD Filter 4)", async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([]);

    await listLeads(managerContext, {
      status: LeadStatus.NOT_YET_VALIDATED,
    });

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          status: LeadStatus.NOT_YET_VALIDATED,
        }),
      })
    );
  });

  it("15. listLeads filters by Transaction Preference (PRD Filter 5)", async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([]);

    await listLeads(managerContext, {
      preference: TransactionType.SALE,
    });

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          requirement: expect.objectContaining({
            preference: TransactionType.SALE,
          }),
        }),
      })
    );
  });

  it("16. listLeads filters by Bedroom Configuration (PRD Filter 6)", async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([]);

    await listLeads(managerContext, {
      bedroomConfigurations: ["2 BHK", "3 BHK"],
    });

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          requirement: expect.objectContaining({
            bedroomConfigurations: {
              hasSome: ["2 BHK", "3 BHK"],
            },
          }),
        }),
      })
    );
  });

  it("17. listLeads filters by Property Type with multi-select support (PRD Filter 7)", async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([]);

    await listLeads(managerContext, {
      propertyTypes: [PropertyType.APARTMENT, PropertyType.VILLA],
    });

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          requirement: expect.objectContaining({
            propertyTypes: {
              hasSome: [PropertyType.APARTMENT, PropertyType.VILLA],
            },
          }),
        }),
      })
    );
  });

  it("18. listLeads combines all 7 PRD filters into a unified database query", async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([]);

    await listLeads(managerContext, {
      status: LeadStatus.ACTIVE,
      preference: TransactionType.SALE,
      city: "Gurugram",
      localityId: "loc-dlf-phase-5",
      minBudget: 10000000,
      maxBudget: 25000000,
      bedroomConfigurations: ["3 BHK"],
      propertyTypes: [PropertyType.APARTMENT],
    });

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          status: LeadStatus.ACTIVE,
          requirement: expect.objectContaining({
            city: "Gurugram",
            preference: TransactionType.SALE,
            localities: { some: { localityId: "loc-dlf-phase-5" } },
            bedroomConfigurations: { hasSome: ["3 BHK"] },
            propertyTypes: { hasSome: [PropertyType.APARTMENT] },
            AND: [
              { maxBudget: { gte: new Prisma.Decimal(10000000) } },
              { minBudget: { lte: new Prisma.Decimal(25000000) } },
            ],
          }),
        }),
      })
    );
  });

  it("19. listLeads allows managers to query unassigned leads", async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([]);

    await listLeads(managerContext, {
      assignedTelecallerId: "UNASSIGNED",
    });

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          assignedTelecallerId: null,
        }),
      })
    );
  });

  it("20. listLeads strictly scopes Telecaller to assigned leads regardless of client input", async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([]);

    await listLeads(telecallerContext, {
      assignedTelecallerId: "other-agent-attempted-bypass",
    });

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          assignedTelecallerId: telecallerId,
        }),
      })
    );
  });

  // =========================================================================
  // 6. UI RENDERING TESTS
  // =========================================================================

  it("21. OverviewClient renders Caller Dashboard with 8 summary cards and callback alert for telecaller", () => {
    const callerMetrics: CallerDashboardMetrics = {
      assignedTotal: 34,
      pendingValidation: 12,
      activeLeads: 18,
      inactiveLeads: 4,
      callsLoggedToday: 15,
      connectedToday: 7,
      callbacksDueToday: 3,
      callbacksOverdue: 1,
      unreachableNearLimit: 2,
    };

    const html = renderToString(
      <OverviewClient
        initialProperties={[]}
        initialLeads={[]}
        initialVisits={[]}
        userName="Pooja Sharma"
        userRole="TELECALLER"
        rawRole="TELECALLER"
        callerMetrics={callerMetrics}
        isAuthenticated={true}
      />
    );

    // Verify Title & Telecaller Badge
    expect(html).toContain("Caller Dashboard &amp; Daily Workspace");
    expect(html).toContain("Active Telecaller:");
    expect(html).toContain("Pooja Sharma");

    // Verify 8 Metric Card Labels
    expect(html).toContain("Assigned");
    expect(html).toContain("Pending Call");
    expect(html).toContain("Active Leads");
    expect(html).toContain("Inactive");
    expect(html).toContain("Calls Today");
    expect(html).toContain("Connected");
    expect(html).toContain("Due Today");
    expect(html).toContain("Overdue");

    // Verify Metric Values
    expect(html).toContain("34");
    expect(html).toContain("12");
    expect(html).toContain("18");
    expect(html).toContain("15");
    expect(html).toContain("7");

    // Verify Urgent Callback Alert Banner
    expect(html).toContain("Action Required: Scheduled Callbacks Due");
    expect(html).toMatch(/1.*overdue callback/);
    expect(html).toMatch(/3.*callback.*due today/);

    // Verify Unreachable Near-Limit Notice
    expect(html).toMatch(/2.*prospects?/);
    expect(html).toContain("reached 2 unsuccessful call attempts");
  });

  it("22. OverviewClient renders Manager Dashboard with unassigned alert and telecaller workloads", () => {
    const managerMetrics: ManagerDemandMetrics = {
      totalLeads: 120,
      pendingValidation: 35,
      activeLeads: 70,
      inactiveLeads: 15,
      unassignedLeads: 8,
      callsLoggedToday: 42,
      connectedToday: 19,
      callbacksDueToday: 6,
      callbacksOverdue: 2,
      telecallerWorkloads: [
        {
          telecallerId: "tc-1",
          telecallerName: "Pooja Sharma",
          telecallerEmail: "pooja@brokerage.in",
          activeLeadCount: 30,
          pendingValidationCount: 15,
          callbacksDueTodayCount: 4,
        },
      ],
    };

    const html = renderToString(
      <OverviewClient
        initialProperties={[]}
        initialLeads={[]}
        initialVisits={[]}
        userName="Vikram Broker"
        userRole="BROKER OWNER"
        rawRole="BROKER_OWNER"
        managerMetrics={managerMetrics}
        isAuthenticated={true}
      />
    );

    // Verify Header
    expect(html).toContain("Brokerage Operations &amp; Demand Overview");

    // Verify Unassigned Alert
    expect(html).toContain("Assignment Backlog: Unassigned Leads Detected");
    expect(html).toMatch(/8.*unassigned lead/);
    expect(html).toContain("Allocate Leads Now →");

    // Verify Telecaller Workload Section
    expect(html).toContain("Telecaller Workload &amp; Execution Distribution");
    expect(html).toContain("Pooja Sharma");
    expect(html).toContain("pooja@brokerage.in");
    expect(html).toContain("30");
  });
});
