/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole, LeadStatus, Prisma } from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ValidationError, ForbiddenError } from "@/server/errors";

vi.mock("@/server/db", () => {
  const mockPrisma = {
    lead: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    leadChangeLog: {
      createMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    enquiry: {
      create: vi.fn(),
    },
    property: {
      findFirst: vi.fn(),
    },
    locality: {
      findMany: vi.fn().mockImplementation(async (args) => {
        return [
          {
            id: "loc-1",
            tenantId: args?.where?.tenantId || "tenant-alpha",
            name: "Sector 54",
            city: args?.where?.city?.equals || "Gurugram",
            latitude: null,
            longitude: null,
          },
          {
            id: "loc-2",
            tenantId: args?.where?.tenantId || "tenant-alpha",
            name: "Golf Course Road",
            city: args?.where?.city?.equals || "Gurugram",
            latitude: null,
            longitude: null,
          },
        ];
      }),
      findFirst: vi.fn(),
    },
    leadRequirementLocality: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    assignment: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async (args) => ({
        id: "mock-assignment-1",
        ...args.data,
        assignedAt: new Date(),
      })),
      update: vi.fn(),
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

vi.mock("@/server/tenant-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/tenant-context")>();
  return {
    ...actual,
    requireTenantContext: vi.fn(),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@/server/db";
import { requireTenantContext } from "@/server/tenant-context";
import { createLead, CreateLeadData } from "@/server/dal/leads";
import { createLeadAction } from "@/app/leads/actions";

describe("DV-03: Tenant-Scoped Buyer Deduplication & Enquiry Creation", () => {
  const tenantA = "tenant-broker-alpha";
  const tenantB = "tenant-broker-beta";

  const brokerContextA: TenantContext = {
    tenantId: tenantA,
    userId: "user-broker-a",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-broker-a",
      name: "Broker Owner Alpha",
      email: "alpha@broker.internal",
      role: UserRole.BROKER_OWNER,
      tenantId: tenantA,
      isActive: true,
      delegatedPermissions: [],
    },
    session: {
      id: "sess-a",
      token: "tok-a",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const brokerContextB: TenantContext = {
    tenantId: tenantB,
    userId: "user-broker-b",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-broker-b",
      name: "Broker Owner Beta",
      email: "beta@broker.internal",
      role: UserRole.BROKER_OWNER,
      tenantId: tenantB,
      isActive: true,
      delegatedPermissions: [],
    },
    session: {
      id: "sess-b",
      token: "tok-b",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const telecallerContext: TenantContext = {
    tenantId: tenantA,
    userId: "user-telecaller-1",
    role: UserRole.TELECALLER,
    user: {
      id: "user-telecaller-1",
      name: "Telecaller 1",
      email: "tc1@broker.internal",
      role: UserRole.TELECALLER,
      tenantId: tenantA,
      isActive: true,
      delegatedPermissions: [],
    },
    session: {
      id: "sess-tc",
      token: "tok-tc",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const unauthorizedContext: TenantContext = {
    tenantId: tenantA,
    userId: "user-verifier-1",
    role: UserRole.FIELD_VERIFIER,
    user: {
      id: "user-verifier-1",
      name: "Verifier 1",
      email: "v1@broker.internal",
      role: UserRole.FIELD_VERIFIER,
      tenantId: tenantA,
      isActive: true,
      delegatedPermissions: [],
    },
    session: {
      id: "sess-v",
      token: "tok-v",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireTenantContext).mockResolvedValue(brokerContextA);
    vi.mocked(prisma.$transaction).mockImplementation(async (arg: any) => {
      if (typeof arg === "function") {
        return arg(prisma);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg;
    });
  });

  // T1: New buyer creates Lead + Requirement + Enquiry
  it("T1: creates a new Lead, initial Requirement, and first Enquiry atomically when buyer does not exist", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null);

    const mockCreatedLead = {
      id: "lead-new-1",
      tenantId: tenantA,
      name: "Aman Gupta",
      primaryPhone: "9810011111",
      originalSource: "Direct Inquiry",
      status: LeadStatus.NOT_YET_VALIDATED,
      sourceCreatedAt: new Date("2026-01-01"),
      assignedTelecallerId: null,
      enquiries: [
        {
          id: "enquiry-1",
          tenantId: tenantA,
          leadId: "lead-new-1",
          source: "Direct Inquiry",
          advertisedPropertyRef: "REF-001",
          advertisedPropertyId: null,
          enquiryDetails: "Interested in 3BHK",
          createdAt: new Date(),
        },
      ],
      requirement: {
        id: "req-1",
        minBudget: 5000000,
        maxBudget: 15000000,
        city: "Gurugram",
        preference: "SALE",
      },
      callLogs: [],
    };

    vi.mocked(prisma.lead.create).mockResolvedValueOnce(mockCreatedLead as any);

    const result = await createLead(brokerContextA, {
      name: "Aman Gupta",
      primaryPhone: "+91 98100-11111",
      originalSource: "Direct Inquiry",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 5000000,
      maxBudget: 15000000,
      bedroomConfigurations: ["3 BHK"],
      advertisedPropertyRef: "REF-001",
      enquiryDetails: "Interested in 3BHK",
    });

    expect(result.isExistingBuyer).toBe(false);
    expect(result.lead.id).toBe("lead-new-1");
    expect(result.enquiry.id).toBe("enquiry-1");
    expect(prisma.lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: tenantA,
          name: "Aman Gupta",
          primaryPhone: "9810011111",
          status: LeadStatus.NOT_YET_VALIDATED,
          enquiries: expect.objectContaining({
            create: expect.objectContaining({
              source: "Direct Inquiry",
              advertisedPropertyRef: "REF-001",
              enquiryDetails: "Interested in 3BHK",
            }),
          }),
        }),
      })
    );
  });

  // T2: Existing buyer creates only a new Enquiry
  it("T2: reuses existing Lead and appends new Enquiry without creating a new Lead or Requirement", async () => {
    const existingLead = {
      id: "lead-existing-1",
      tenantId: tenantA,
      name: "Existing Buyer",
      primaryPhone: "9810011111",
      originalSource: "Walk-in",
      sourceCreatedAt: new Date("2025-10-10"),
      status: LeadStatus.NOT_YET_VALIDATED,
      assignedTelecallerId: "tc-existing",
      requirement: { id: "req-orig", minBudget: 4000000, maxBudget: 8000000 },
      enquiries: [{ id: "enq-prev" }],
      callLogs: [],
    };

    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(existingLead as any);
    vi.mocked(prisma.enquiry.create).mockResolvedValueOnce({
      id: "enquiry-new-2",
      tenantId: tenantA,
      leadId: "lead-existing-1",
      source: "99acres",
      createdAt: new Date(),
    } as any);
    vi.mocked(prisma.lead.findUnique).mockResolvedValueOnce(existingLead as any);

    const result = await createLead(brokerContextA, {
      name: "Existing Buyer Updated Name",
      primaryPhone: "9810011111",
      originalSource: "99acres",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 10000000,
      maxBudget: 20000000,
    });

    expect(result.isExistingBuyer).toBe(true);
    expect(result.lead.id).toBe("lead-existing-1");
    expect(result.enquiry.id).toBe("enquiry-new-2");
    expect(prisma.lead.create).not.toHaveBeenCalled();
    expect(prisma.enquiry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: tenantA,
          leadId: "lead-existing-1",
          source: "99acres",
        }),
      })
    );
  });

  // T3: Different phone formats normalize to the same identity
  it("T3: normalizes +91, 0-trunk, dashes, and spaces to the exact same 10-digit primary phone", async () => {
    const variations = [
      "+91 98100 22222",
      "09810022222",
      "919810022222",
      "+91-98100-22222",
      "9810022222",
    ];

    for (const phone of variations) {
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.lead.create).mockResolvedValueOnce({
        id: "lead-test",
        tenantId: tenantA,
        name: "Test",
        primaryPhone: "9810022222",
        status: LeadStatus.NOT_YET_VALIDATED,
        enquiries: [{ id: "enq-test" }],
      } as any);

      await createLead(brokerContextA, {
        name: "Test",
        primaryPhone: phone,
        originalSource: "Direct Inquiry",
        city: "Gurugram",
        preference: "SALE",
        minBudget: 1000000,
        maxBudget: 2000000,
      });

      expect(prisma.lead.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: tenantA,
            primaryPhone: "9810022222",
          }),
        })
      );
    }
  });

  // T4: Same phone in different tenants creates separate Leads
  it("T4: creates separate Leads for the same phone number across different tenants (strict tenant scoping)", async () => {
    // Tenant A creates lead
    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.lead.create).mockResolvedValueOnce({
      id: "lead-tenant-a",
      tenantId: tenantA,
      name: "Buyer In A",
      primaryPhone: "9810033333",
      status: LeadStatus.NOT_YET_VALIDATED,
      enquiries: [{ id: "enq-a" }],
    } as any);

    const resultA = await createLead(brokerContextA, {
      name: "Buyer In A",
      primaryPhone: "9810033333",
      originalSource: "Manual A",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 5000000,
      maxBudget: 10000000,
    });

    expect(resultA.lead.tenantId).toBe(tenantA);

    // Tenant B creates lead with same phone
    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null); // Not found in Tenant B!
    vi.mocked(prisma.lead.create).mockResolvedValueOnce({
      id: "lead-tenant-b",
      tenantId: tenantB,
      name: "Buyer In B",
      primaryPhone: "9810033333",
      status: LeadStatus.NOT_YET_VALIDATED,
      enquiries: [{ id: "enq-b" }],
    } as any);

    const resultB = await createLead(brokerContextB, {
      name: "Buyer In B",
      primaryPhone: "9810033333",
      originalSource: "Manual B",
      city: "Noida",
      preference: "RENT",
      minBudget: 25000,
      maxBudget: 50000,
    });

    expect(resultB.lead.tenantId).toBe(tenantB);
    expect(prisma.lead.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: tenantB,
          primaryPhone: "9810033333",
        }),
      })
    );
  });

  // T5: Confirmed P2002 duplicate race recovers correctly
  it("T5: recovers gracefully from P2002 unique constraint race condition on primaryPhone and appends enquiry", async () => {
    // 1. Initial lookup finds null
    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null);

    // 2. Simultaneous insert throws P2002
    const p2002Error = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`tenant_id`,`primary_phone`)",
      {
        code: "P2002",
        clientVersion: "5.0.0",
        meta: { target: ["primaryPhone", "tenantId"] },
      }
    );
    vi.mocked(prisma.lead.create).mockRejectedValueOnce(p2002Error);

    // 3. Recovery lookup finds winner lead
    const winnerLead = {
      id: "lead-winner-race",
      tenantId: tenantA,
      name: "Winner Lead",
      primaryPhone: "9810044444",
      status: LeadStatus.NOT_YET_VALIDATED,
      assignedTelecallerId: null,
      enquiries: [],
    };
    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(winnerLead as any);
    vi.mocked(prisma.enquiry.create).mockResolvedValueOnce({
      id: "enq-recovered",
      leadId: "lead-winner-race",
    } as any);
    vi.mocked(prisma.lead.findUnique).mockResolvedValueOnce(winnerLead as any);

    const result = await createLead(brokerContextA, {
      name: "Racer Lead",
      primaryPhone: "9810044444",
      originalSource: "Portals",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 5000000,
      maxBudget: 10000000,
    });

    expect(result.isExistingBuyer).toBe(true);
    expect(result.lead.id).toBe("lead-winner-race");
    expect(result.enquiry.id).toBe("enq-recovered");
  });

  // T6: Unrelated P2002 is rethrown
  it("T6: strictly rethrows unrelated P2002 unique constraint errors (e.g. ID conflict)", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null);

    const unrelatedP2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`id`)",
      {
        code: "P2002",
        clientVersion: "5.0.0",
        meta: { target: ["id"] },
      }
    );
    vi.mocked(prisma.lead.create).mockRejectedValueOnce(unrelatedP2002);

    await expect(
      createLead(brokerContextA, {
        name: "Test",
        primaryPhone: "9810055555",
        originalSource: "Direct Inquiry",
        city: "Gurugram",
        preference: "SALE",
        minBudget: 5000000,
        maxBudget: 10000000,
      })
    ).rejects.toThrow(unrelatedP2002);
  });

  // T7: Cross-tenant advertisedPropertyId is rejected
  it("T7: rejects advertisedPropertyId that does not exist in the caller's tenant with ValidationError", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null);

    await expect(
      createLead(brokerContextA, {
        name: "Test",
        primaryPhone: "9810066666",
        originalSource: "Direct Inquiry",
        city: "Gurugram",
        preference: "SALE",
        minBudget: 5000000,
        maxBudget: 10000000,
        advertisedPropertyId: "prop-belonging-to-other-tenant",
      })
    ).rejects.toThrow(ValidationError);

    expect(prisma.property.findFirst).toHaveBeenCalledWith({
      where: {
        id: "prop-belonging-to-other-tenant",
        tenantId: tenantA,
      },
      select: { id: true },
    });
  });

  // T8: Existing ACTIVE status remains unchanged
  it("T8: keeps status ACTIVE when existing active buyer submits a new enquiry", async () => {
    const activeLead = {
      id: "lead-active",
      tenantId: tenantA,
      status: LeadStatus.ACTIVE,
      primaryPhone: "9810077777",
      assignedTelecallerId: "tc-1",
      enquiries: [],
    };

    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(activeLead as any);
    vi.mocked(prisma.enquiry.create).mockResolvedValueOnce({ id: "enq-active-new" } as any);
    vi.mocked(prisma.lead.findUnique).mockResolvedValueOnce(activeLead as any);

    const result = await createLead(brokerContextA, {
      name: "Active Buyer",
      primaryPhone: "9810077777",
      originalSource: "MagicBricks",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 5000000,
      maxBudget: 10000000,
    });

    expect(result.lead.status).toBe(LeadStatus.ACTIVE);
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  // T9: Existing INACTIVE status becomes NOT_YET_VALIDATED
  it("T9: transitions existing INACTIVE buyer to NOT_YET_VALIDATED upon receiving a fresh enquiry", async () => {
    const inactiveLead = {
      id: "lead-inactive",
      tenantId: tenantA,
      status: LeadStatus.INACTIVE,
      primaryPhone: "9810088888",
      assignedTelecallerId: "tc-1",
      enquiries: [],
    };

    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(inactiveLead as any);
    vi.mocked(prisma.lead.update).mockResolvedValueOnce({
      ...inactiveLead,
      status: LeadStatus.NOT_YET_VALIDATED,
    } as any);
    vi.mocked(prisma.enquiry.create).mockResolvedValueOnce({ id: "enq-inactive-new" } as any);
    vi.mocked(prisma.lead.findUnique).mockResolvedValueOnce({
      ...inactiveLead,
      status: LeadStatus.NOT_YET_VALIDATED,
    } as any);

    const result = await createLead(brokerContextA, {
      name: "Re-inquiring Buyer",
      primaryPhone: "9810088888",
      originalSource: "99acres",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 5000000,
      maxBudget: 10000000,
    });

    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "lead-inactive" },
        data: expect.objectContaining({
          status: LeadStatus.NOT_YET_VALIDATED,
        }),
      })
    );
    expect(result.lead.status).toBe(LeadStatus.NOT_YET_VALIDATED);
  });

  // T10: Existing DNC flag remains true and lead is not reactivated
  it("T10: preserves isDoNotContact flag on existing DNC buyer upon receiving a fresh enquiry", async () => {
    const dncLead = {
      id: "lead-dnc",
      tenantId: tenantA,
      status: LeadStatus.INACTIVE,
      isDoNotContact: true,
      primaryPhone: "9810099999",
      assignedTelecallerId: "tc-1",
      enquiries: [],
    };

    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(dncLead as any);
    vi.mocked(prisma.enquiry.create).mockResolvedValueOnce({ id: "enq-dnc-new" } as any);
    vi.mocked(prisma.lead.findUnique).mockResolvedValueOnce({
      ...dncLead,
      status: LeadStatus.INACTIVE,
      isDoNotContact: true,
    } as any);

    const result = await createLead(brokerContextA, {
      name: "DNC Buyer",
      primaryPhone: "9810099999",
      originalSource: "Housing.com",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 5000000,
      maxBudget: 10000000,
    });

    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(result.lead.isDoNotContact).toBe(true);
    expect(result.lead.status).toBe(LeadStatus.INACTIVE);
  });

  // T11: Existing assigned telecaller remains unchanged
  it("T11: preserves existing telecaller assignment on repeat enquiry (no reassignment)", async () => {
    const assignedLead = {
      id: "lead-assigned",
      tenantId: tenantA,
      status: LeadStatus.NOT_YET_VALIDATED,
      primaryPhone: "9810012345",
      assignedTelecallerId: "tc-original",
      enquiries: [],
    };

    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(assignedLead as any);
    vi.mocked(prisma.enquiry.create).mockResolvedValueOnce({ id: "enq-repeat" } as any);
    vi.mocked(prisma.lead.findUnique).mockResolvedValueOnce(assignedLead as any);

    const result = await createLead(telecallerContext, {
      name: "Buyer",
      primaryPhone: "9810012345",
      originalSource: "Direct Inquiry",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 5000000,
      maxBudget: 10000000,
      assignedTelecallerId: "tc-attempted-overwrite",
    });

    expect(result.lead.assignedTelecallerId).toBe("tc-original");
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  // T12: Existing requirements, originalSource, primaryPhone, and sourceCreatedAt remain unchanged
  it("T12: preserves originalSource, primaryPhone, sourceCreatedAt, and existing requirements on existing buyer", async () => {
    const originalCreatedAt = new Date("2025-05-01");
    const existingLead = {
      id: "lead-immutability-check",
      tenantId: tenantA,
      status: LeadStatus.NOT_YET_VALIDATED,
      name: "Original Prospect",
      primaryPhone: "9810054321",
      originalSource: "Original Newspaper Ad",
      sourceCreatedAt: originalCreatedAt,
      assignedTelecallerId: "tc-1",
      requirement: {
        id: "req-original",
        minBudget: 3000000,
        maxBudget: 6000000,
        city: "Gurugram",
      },
      enquiries: [],
    };

    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(existingLead as any);
    vi.mocked(prisma.enquiry.create).mockResolvedValueOnce({ id: "enq-diff-specs" } as any);
    vi.mocked(prisma.lead.findUnique).mockResolvedValueOnce(existingLead as any);

    const result = await createLead(brokerContextA, {
      name: "Updated Name",
      primaryPhone: "9810054321",
      originalSource: "MagicBricks",
      city: "Noida",
      preference: "RENT",
      minBudget: 8000000,
      maxBudget: 15000000,
      bedroomConfigurations: ["4 BHK"],
    });

    expect(result.lead.originalSource).toBe("Original Newspaper Ad");
    expect(result.lead.sourceCreatedAt).toBe(originalCreatedAt);
    expect(result.lead.primaryPhone).toBe("9810054321");
    expect(result.lead.requirement?.minBudget).toBe(3000000);

    expect(prisma.enquiry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enquiryDetails: expect.stringContaining("[Submitted Requirements]"),
        }),
      })
    );
  });

  // T13: Repeated genuine enquiries are stored separately
  it("T13: creates separate Enquiry records for repeated genuine inquiries from the same buyer", async () => {
    const existingLead = {
      id: "lead-multi-enquiry",
      tenantId: tenantA,
      status: LeadStatus.NOT_YET_VALIDATED,
      primaryPhone: "9810065432",
      assignedTelecallerId: "tc-1",
      enquiries: [],
    };

    vi.mocked(prisma.lead.findFirst).mockResolvedValue(existingLead as any);
    vi.mocked(prisma.enquiry.create)
      .mockResolvedValueOnce({ id: "enquiry-portal-1", source: "99acres" } as any)
      .mockResolvedValueOnce({ id: "enquiry-portal-2", source: "MagicBricks" } as any);
    vi.mocked(prisma.lead.findUnique).mockResolvedValue(existingLead as any);

    const enq1 = await createLead(brokerContextA, {
      name: "Buyer",
      primaryPhone: "9810065432",
      originalSource: "99acres",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 5000000,
      maxBudget: 10000000,
    });

    const enq2 = await createLead(brokerContextA, {
      name: "Buyer",
      primaryPhone: "9810065432",
      originalSource: "MagicBricks",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 5000000,
      maxBudget: 10000000,
    });

    expect(enq1.enquiry.id).toBe("enquiry-portal-1");
    expect(enq2.enquiry.id).toBe("enquiry-portal-2");
    expect(prisma.enquiry.create).toHaveBeenCalledTimes(2);
  });

  // T14: Failed transaction does not leave partial data
  it("T14: executes atomicity via transaction: throws error when database write fails", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.lead.create).mockRejectedValueOnce(new Error("Database write failure"));

    await expect(
      createLead(brokerContextA, {
        name: "Failed Buyer",
        primaryPhone: "9810076543",
        originalSource: "Direct Inquiry",
        city: "Gurugram",
        preference: "SALE",
        minBudget: 5000000,
        maxBudget: 10000000,
      })
    ).rejects.toThrow("Database write failure");
  });

  // T15: Server action works for both new and existing buyers
  it("T15: createLeadAction successfully exposes lead view and isExistingBuyer flag", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.lead.create).mockResolvedValueOnce({
      id: "lead-action-1",
      tenantId: tenantA,
      name: "Action Buyer",
      primaryPhone: "9810087654",
      status: LeadStatus.NOT_YET_VALIDATED,
      originalSource: "Direct Inquiry",
      sourceCreatedAt: new Date(),
      enquiries: [{ id: "enq-act-1", source: "Direct Inquiry" }],
      requirement: { minBudget: 5000000, maxBudget: 10000000 },
      callLogs: [],
    } as any);

    vi.mocked(requireTenantContext).mockResolvedValueOnce(brokerContextA);

    const res = await createLeadAction({
      name: "Action Buyer",
      primaryPhone: "9810087654",
      originalSource: "Direct Inquiry",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 5000000,
      maxBudget: 10000000,
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.lead.name).toBe("Action Buyer");
      expect(res.isExistingBuyer).toBe(false);
      expect(res.enquiryId).toBe("enq-act-1");
    }
  });

  // T16: Invalid mobile numbers are rejected
  it("T16: rejects invalid mobile numbers with ValidationError", async () => {
    const invalidNumbers = [
      "12345",
      "5810012345", // Starts with 5
      "0123456789", // Starts with 01
      "981001234567", // Too long
      "98100abcd5", // Non-digits
    ];

    for (const phone of invalidNumbers) {
      await expect(
        createLead(brokerContextA, {
          name: "Invalid Phone Prospect",
          primaryPhone: phone,
          originalSource: "Direct Inquiry",
          city: "Gurugram",
          preference: "SALE",
          minBudget: 5000000,
          maxBudget: 10000000,
        })
      ).rejects.toThrow(ValidationError);
    }
  });

  // T17: Existing tenant and permission boundaries remain enforced
  it("T17: strictly enforces demand:create permission checks", async () => {
    await expect(
      createLead(unauthorizedContext, {
        name: "Unauthorized Attempt",
        primaryPhone: "9810098765",
        originalSource: "Direct Inquiry",
        city: "Gurugram",
        preference: "SALE",
        minBudget: 5000000,
        maxBudget: 10000000,
      })
    ).rejects.toThrow(ForbiddenError);
  });

  // T18: New enquiry correctly preserves advertised property and source details
  it("T18: correctly persists advertisedPropertyRef, advertisedPropertyId, and notes on enquiry", async () => {
    vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({ id: "prop-valid-1" } as any);
    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.lead.create).mockResolvedValueOnce({
      id: "lead-ad-1",
      tenantId: tenantA,
      name: "Ad Prospect",
      primaryPhone: "9810019283",
      status: LeadStatus.NOT_YET_VALIDATED,
      enquiries: [
        {
          id: "enq-ad-1",
          advertisedPropertyRef: "99A-DLF-PH5",
          advertisedPropertyId: "prop-valid-1",
          enquiryDetails: "Wants immediate inspection",
          source: "99acres",
        },
      ],
      requirement: { minBudget: 5000000, maxBudget: 10000000 },
      callLogs: [],
    } as any);

    const result = await createLead(brokerContextA, {
      name: "Ad Prospect",
      primaryPhone: "9810019283",
      originalSource: "99acres",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 5000000,
      maxBudget: 10000000,
      advertisedPropertyRef: "99A-DLF-PH5",
      advertisedPropertyId: "prop-valid-1",
      enquiryDetails: "Wants immediate inspection",
    });

    expect(result.enquiry.advertisedPropertyRef).toBe("99A-DLF-PH5");
    expect(result.enquiry.advertisedPropertyId).toBe("prop-valid-1");
    expect(result.enquiry.enquiryDetails).toBe("Wants immediate inspection");
    expect(result.enquiry.source).toBe("99acres");
  });
});
