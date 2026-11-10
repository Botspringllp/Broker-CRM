/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole, LeadStatus, LeadCallingDisposition, Prisma } from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { NotFoundError, ValidationError } from "@/server/errors";

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
      createMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    callLog: {
      create: vi.fn(),
      findMany: vi.fn(),
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
  editLead,
  updateLeadStatus,
  logLeadCall,
  createLead,
} from "@/server/dal/leads";

describe("DV-05 Phase 2A: Lead Change History Audit Logging Engine", () => {
  const brokerContext: TenantContext = {
    tenantId: "tenant-apex-1",
    userId: "broker-owner-1",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "broker-owner-1",
      name: "Broker Vikram",
      email: "vikram@apexrealty.in",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-apex-1",
      isActive: true,
    },
    session: {
      id: "sess-1",
      token: "tok-1",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const otherTenantContext: TenantContext = {
    tenantId: "tenant-apex-2",
    userId: "other-broker-1",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "other-broker-1",
      name: "Other Broker",
      email: "other@realty.in",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-apex-2",
      isActive: true,
    },
    session: {
      id: "sess-other",
      token: "tok-other",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const sampleLead = {
    id: "lead-100",
    tenantId: "tenant-apex-1",
    name: "Rohan Gupta",
    primaryPhone: "9876543210",
    alternatePhone: null,
    email: null,
    originalSource: "99acres",
    sourceCreatedAt: new Date("2026-10-01T10:00:00Z"),
    assignedTelecallerId: null,
    status: LeadStatus.NOT_YET_VALIDATED,
    unreachableAttemptsCount: 0,
    requirement: {
      id: "req-100",
      tenantId: "tenant-apex-1",
      leadId: "lead-100",
      minBudget: new Prisma.Decimal(5000000),
      maxBudget: new Prisma.Decimal(10000000),
      city: "Gurugram",
      preference: "SALE" as const,
      bedroomConfigurations: ["2 BHK"],
      propertyTypes: ["APARTMENT" as const],
      societies: ["DLF Phase 5"],
      targetArea: new Prisma.Decimal(1250),
      areaType: "SUPER_BUILT_UP" as const,
      isConfirmed: false,
      localities: [
        {
          id: "lrl-1",
          localityId: "loc-1",
          locality: { id: "loc-1", name: "Sector 54" },
        },
      ],
    },
    enquiries: [],
    callLogs: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // T1: A changed Lead field generates a correct log
  it("T1: records an audit log when a Lead field (e.g. name) is changed", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.lead.update as any).mockResolvedValue({
      ...sampleLead,
      name: "Rohan K. Gupta",
    });
    (prisma.leadRequirement.upsert as any).mockResolvedValue(sampleLead.requirement);
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValue({
      ...sampleLead,
      name: "Rohan K. Gupta",
    });

    await editLead(brokerContext, {
      id: "lead-100",
      name: "Rohan K. Gupta",
      primaryPhone: "9876543210",
      originalSource: "99acres",
      minBudget: 5000000,
      maxBudget: 10000000,
      city: "Gurugram",
      preference: "SALE",
      bedroomConfigurations: ["2 BHK"],
      propertyTypes: ["APARTMENT"],
      societies: ["DLF Phase 5"],
      targetArea: 1250,
      areaType: "SUPER_BUILT_UP",
    });

    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          tenantId: "tenant-apex-1",
          leadId: "lead-100",
          fieldName: "name",
          previousValue: "Rohan Gupta",
          newValue: "Rohan K. Gupta",
          changedByUserId: "broker-owner-1",
          changeSource: "USER",
        }),
      ],
    });
  });

  // T2: A changed LeadRequirement field generates a correct log
  it("T2: records an audit log when a LeadRequirement field (e.g. city) is changed", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.lead.update as any).mockResolvedValue(sampleLead);
    (prisma.leadRequirement.upsert as any).mockResolvedValue({
      ...sampleLead.requirement,
      city: "Noida",
    });
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValue({
      ...sampleLead,
      requirement: { ...sampleLead.requirement, city: "Noida" },
    });

    await editLead(brokerContext, {
      id: "lead-100",
      name: "Rohan Gupta",
      primaryPhone: "9876543210",
      originalSource: "99acres",
      minBudget: 5000000,
      maxBudget: 10000000,
      city: "Noida",
      preference: "SALE",
      bedroomConfigurations: ["2 BHK"],
      propertyTypes: ["APARTMENT"],
      societies: ["DLF Phase 5"],
      targetArea: 1250,
      areaType: "SUPER_BUILT_UP",
    });

    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          fieldName: "city",
          previousValue: "Gurugram",
          newValue: "Noida",
          changedByUserId: "broker-owner-1",
          changeSource: "USER",
        }),
      ],
    });
  });

  // T3: Multiple changed fields generate separate logs
  it("T3: records multiple separate audit records in the same batch when multiple fields change", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.lead.update as any).mockResolvedValue(sampleLead);
    (prisma.leadRequirement.upsert as any).mockResolvedValue(sampleLead.requirement);
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValue(sampleLead);

    await editLead(brokerContext, {
      id: "lead-100",
      name: "Rohan Gupta",
      primaryPhone: "9876543210",
      email: "rohan@example.com",
      originalSource: "99acres",
      minBudget: 6000000,
      maxBudget: 12000000,
      city: "Gurugram",
      preference: "SALE",
      bedroomConfigurations: ["3 BHK"],
      propertyTypes: ["APARTMENT"],
      societies: ["DLF Phase 5"],
      targetArea: 1250,
      areaType: "SUPER_BUILT_UP",
    });

    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledTimes(1);
    const callArgs = (prisma.leadChangeLog.createMany as any).mock.calls[0][0].data;
    const fieldNames = callArgs.map((c: any) => c.fieldName);

    expect(fieldNames).toContain("email");
    expect(fieldNames).toContain("minBudget");
    expect(fieldNames).toContain("maxBudget");
    expect(fieldNames).toContain("bedroomConfigurations");
    expect(fieldNames).toHaveLength(4);
  });

  // T4: Unchanged fields generate no logs (no-op suppression)
  it("T4: generates zero changelog entries when submitting unchanged identical values", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.lead.update as any).mockResolvedValue(sampleLead);
    (prisma.leadRequirement.upsert as any).mockResolvedValue(sampleLead.requirement);
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValue(sampleLead);

    await editLead(brokerContext, {
      id: "lead-100",
      name: "Rohan Gupta",
      primaryPhone: "9876543210",
      alternatePhone: null,
      email: null,
      originalSource: "99acres",
      minBudget: 5000000,
      maxBudget: 10000000,
      city: "Gurugram",
      preference: "SALE",
      bedroomConfigurations: ["2 BHK"],
      propertyTypes: ["APARTMENT"],
      societies: ["DLF Phase 5"],
      targetArea: 1250,
      areaType: "SUPER_BUILT_UP",
    });

    expect(prisma.leadChangeLog.createMany).not.toHaveBeenCalled();
  });

  // T5: Null-to-value transition
  it("T5: correctly records null-to-value transition with previousValue: null", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead); // alternatePhone is null
    (prisma.lead.update as any).mockResolvedValue(sampleLead);
    (prisma.leadRequirement.upsert as any).mockResolvedValue(sampleLead.requirement);
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValue(sampleLead);

    await editLead(brokerContext, {
      id: "lead-100",
      name: "Rohan Gupta",
      primaryPhone: "9876543210",
      alternatePhone: "9811122233",
      originalSource: "99acres",
      minBudget: 5000000,
      maxBudget: 10000000,
      city: "Gurugram",
      preference: "SALE",
      bedroomConfigurations: ["2 BHK"],
      propertyTypes: ["APARTMENT"],
      societies: ["DLF Phase 5"],
      targetArea: 1250,
      areaType: "SUPER_BUILT_UP",
    });

    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          fieldName: "alternatePhone",
          previousValue: null,
          newValue: "9811122233",
        }),
      ],
    });
  });

  // T6: Value-to-null transition
  it("T6: correctly records value-to-null transition with newValue: null", async () => {
    const leadWithEmail = { ...sampleLead, email: "rohan@example.com" };
    (prisma.lead.findFirst as any).mockResolvedValue(leadWithEmail);
    (prisma.lead.update as any).mockResolvedValue(sampleLead);
    (prisma.leadRequirement.upsert as any).mockResolvedValue(sampleLead.requirement);
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValue(sampleLead);

    await editLead(brokerContext, {
      id: "lead-100",
      name: "Rohan Gupta",
      primaryPhone: "9876543210",
      email: "", // Cleared email
      originalSource: "99acres",
      minBudget: 5000000,
      maxBudget: 10000000,
      city: "Gurugram",
      preference: "SALE",
      bedroomConfigurations: ["2 BHK"],
      propertyTypes: ["APARTMENT"],
      societies: ["DLF Phase 5"],
      targetArea: 1250,
      areaType: "SUPER_BUILT_UP",
    });

    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          fieldName: "email",
          previousValue: "rohan@example.com",
          newValue: null,
        }),
      ],
    });
  });

  // T7: Decimal serialization
  it("T7: serializes Prisma.Decimal and numeric budget values cleanly without scientific notation", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.lead.update as any).mockResolvedValue(sampleLead);
    (prisma.leadRequirement.upsert as any).mockResolvedValue(sampleLead.requirement);
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValue(sampleLead);

    await editLead(brokerContext, {
      id: "lead-100",
      name: "Rohan Gupta",
      primaryPhone: "9876543210",
      originalSource: "99acres",
      minBudget: 7500000.5,
      maxBudget: 15000000,
      city: "Gurugram",
      preference: "SALE",
      bedroomConfigurations: ["2 BHK"],
      propertyTypes: ["APARTMENT"],
      societies: ["DLF Phase 5"],
      targetArea: 1250,
      areaType: "SUPER_BUILT_UP",
    });

    const callArgs = (prisma.leadChangeLog.createMany as any).mock.calls[0][0].data;
    const minBudgetLog = callArgs.find((c: any) => c.fieldName === "minBudget");
    const maxBudgetLog = callArgs.find((c: any) => c.fieldName === "maxBudget");

    expect(minBudgetLog).toEqual(
      expect.objectContaining({
        previousValue: "5000000",
        newValue: "7500000.5",
      })
    );
    expect(maxBudgetLog).toEqual(
      expect.objectContaining({
        previousValue: "10000000",
        newValue: "15000000",
      })
    );
  });

  // T8: Array serialization
  it("T8: serializes string arrays deterministically as JSON strings", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.lead.update as any).mockResolvedValue(sampleLead);
    (prisma.leadRequirement.upsert as any).mockResolvedValue(sampleLead.requirement);
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValue(sampleLead);

    await editLead(brokerContext, {
      id: "lead-100",
      name: "Rohan Gupta",
      primaryPhone: "9876543210",
      originalSource: "99acres",
      minBudget: 5000000,
      maxBudget: 10000000,
      city: "Gurugram",
      preference: "SALE",
      bedroomConfigurations: ["2 BHK", "3 BHK"],
      propertyTypes: ["APARTMENT", "VILLA"],
      societies: ["DLF Phase 5"],
      targetArea: 1250,
      areaType: "SUPER_BUILT_UP",
    });

    const callArgs = (prisma.leadChangeLog.createMany as any).mock.calls[0][0].data;
    const bhkLog = callArgs.find((c: any) => c.fieldName === "bedroomConfigurations");
    const typeLog = callArgs.find((c: any) => c.fieldName === "propertyTypes");

    expect(bhkLog.previousValue).toBe(JSON.stringify(["2 BHK"]));
    expect(bhkLog.newValue).toBe(JSON.stringify(["2 BHK", "3 BHK"]));
    expect(typeLog.previousValue).toBe(JSON.stringify(["APARTMENT"]));
    expect(typeLog.newValue).toBe(JSON.stringify(["APARTMENT", "VILLA"]));
  });

  // T9: Locality additions/removals
  it("T9: records locality changes when localities list is modified", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.lead.update as any).mockResolvedValue(sampleLead);
    (prisma.leadRequirement.upsert as any).mockResolvedValue(sampleLead.requirement);
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValue(sampleLead);

    await editLead(brokerContext, {
      id: "lead-100",
      name: "Rohan Gupta",
      primaryPhone: "9876543210",
      originalSource: "99acres",
      minBudget: 5000000,
      maxBudget: 10000000,
      city: "Gurugram",
      preference: "SALE",
      bedroomConfigurations: ["2 BHK"],
      propertyTypes: ["APARTMENT"],
      societies: ["DLF Phase 5"],
      targetArea: 1250,
      areaType: "SUPER_BUILT_UP",
      localities: ["Sector 54", "Golf Course Road"],
    });

    const callArgs = (prisma.leadChangeLog.createMany as any).mock.calls[0][0].data;
    const localityLog = callArgs.find((c: any) => c.fieldName === "localities");

    expect(localityLog).toBeDefined();
    expect(localityLog.previousValue).toBe(JSON.stringify(["Sector 54"]));
    expect(localityLog.newValue).toBe(JSON.stringify(["Golf Course Road", "Sector 54"]));
  });

  // T10: Authenticated actor ID recorded
  it("T10: records the authenticated userId as changedByUserId", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.lead.update as any).mockResolvedValue(sampleLead);
    (prisma.leadRequirement.upsert as any).mockResolvedValue(sampleLead.requirement);
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValue(sampleLead);

    await editLead(brokerContext, {
      id: "lead-100",
      name: "Rohan Modern Gupta",
      primaryPhone: "9876543210",
      originalSource: "99acres",
      minBudget: 5000000,
      maxBudget: 10000000,
      city: "Gurugram",
      preference: "SALE",
      bedroomConfigurations: ["2 BHK"],
      propertyTypes: ["APARTMENT"],
      societies: ["DLF Phase 5"],
      targetArea: 1250,
      areaType: "SUPER_BUILT_UP",
    });

    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          changedByUserId: "broker-owner-1",
        }),
      ],
    });
  });

  // T11: USER change source on manual edit
  it("T11: records changeSource as 'USER' on manual editLead and updateLeadStatus", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.lead.update as any).mockResolvedValue({
      ...sampleLead,
      status: LeadStatus.ACTIVE,
    });
    (prisma.leadRequirement.update as any).mockResolvedValue({
      ...sampleLead.requirement,
      isConfirmed: true,
    });

    await updateLeadStatus(brokerContext, "lead-100", LeadStatus.ACTIVE);

    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          fieldName: "status",
          previousValue: "NOT_YET_VALIDATED",
          newValue: "ACTIVE",
          changeSource: "USER",
        }),
        expect.objectContaining({
          fieldName: "isConfirmed",
          previousValue: "false",
          newValue: "true",
          changeSource: "USER",
        }),
      ]),
    });
  });

  // T12: SYSTEM change source on call disposition status transition
  it("T12: records changeSource as 'SYSTEM' when call logging triggers automatic status transition", async () => {
    const leadTwoAttempts = {
      ...sampleLead,
      unreachableAttemptsCount: 2,
      status: LeadStatus.NOT_YET_VALIDATED,
    };
    (prisma.lead.findFirst as any).mockResolvedValue(leadTwoAttempts);
    (prisma.callLog.create as any).mockResolvedValue({ id: "call-1" });
    (prisma.lead.update as any).mockResolvedValue({
      ...leadTwoAttempts,
      status: LeadStatus.INACTIVE,
      unreachableAttemptsCount: 3,
    });

    await logLeadCall(brokerContext, {
      leadId: "lead-100",
      disposition: LeadCallingDisposition.RINGING_OR_NOT_ANSWERING,
      notes: "3rd attempt - no answer",
    });

    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          fieldName: "status",
          previousValue: "NOT_YET_VALIDATED",
          newValue: "INACTIVE",
          changeSource: "SYSTEM",
          changedByUserId: "broker-owner-1",
        }),
      ],
    });
  });

  // T13: Re-inquiry status transition logging (SYSTEM)
  it("T13: records changeSource as 'SYSTEM' when existing INACTIVE buyer is reopened to NOT_YET_VALIDATED", async () => {
    const inactiveLead = {
      ...sampleLead,
      status: LeadStatus.INACTIVE,
      assignedTelecallerId: null,
    };
    (prisma.lead.findFirst as any).mockResolvedValue(inactiveLead);
    (prisma.lead.update as any).mockResolvedValue({
      ...inactiveLead,
      status: LeadStatus.NOT_YET_VALIDATED,
    });
    (prisma.enquiry.create as any).mockResolvedValue({ id: "enq-200" });
    (prisma.lead.findUnique as any).mockResolvedValue({
      ...inactiveLead,
      status: LeadStatus.NOT_YET_VALIDATED,
    });

    const result = await createLead(brokerContext, {
      name: "Rohan Gupta",
      primaryPhone: "9876543210",
      originalSource: "Housing.com",
      city: "Gurugram",
      preference: "SALE",
      minBudget: 5000000,
      maxBudget: 10000000,
    });

    expect(result.isExistingBuyer).toBe(true);
    expect(prisma.leadChangeLog.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          fieldName: "status",
          previousValue: "INACTIVE",
          newValue: "NOT_YET_VALIDATED",
          changeSource: "SYSTEM",
        }),
      ]),
    });
  });

  // T14: Immutable fields cannot be changed through editLead (throws ValidationError)
  it("T14: rejects attempts to change immutable fields (primaryPhone, originalSource) with ValidationError", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);

    // Primary phone change attempt
    await expect(
      editLead(brokerContext, {
        id: "lead-100",
        name: "Rohan Gupta",
        primaryPhone: "9999988888",
        originalSource: "99acres",
        minBudget: 5000000,
        maxBudget: 10000000,
        city: "Gurugram",
        preference: "SALE",
      })
    ).rejects.toThrow(ValidationError);

    await expect(
      editLead(brokerContext, {
        id: "lead-100",
        name: "Rohan Gupta",
        primaryPhone: "9999988888",
        originalSource: "99acres",
        minBudget: 5000000,
        maxBudget: 10000000,
        city: "Gurugram",
        preference: "SALE",
      })
    ).rejects.toThrow("Primary phone number is immutable and cannot be changed.");

    // Original source change attempt
    await expect(
      editLead(brokerContext, {
        id: "lead-100",
        name: "Rohan Gupta",
        primaryPhone: "9876543210",
        originalSource: "MagicBricks",
        minBudget: 5000000,
        maxBudget: 10000000,
        city: "Gurugram",
        preference: "SALE",
      })
    ).rejects.toThrow("Lead source is immutable and cannot be changed.");
  });

  // T15: Cross-tenant updates are rejected
  it("T15: strictly rejects edits from other tenants with NotFoundError", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(null);

    await expect(
      editLead(otherTenantContext, {
        id: "lead-100",
        name: "Rohan Malicious",
        primaryPhone: "9876543210",
        originalSource: "99acres",
        minBudget: 5000000,
        maxBudget: 10000000,
        city: "Gurugram",
        preference: "SALE",
      })
    ).rejects.toThrow(NotFoundError);
  });

  // T16: Audit insertion failure rolls back the entire transaction
  it("T16: rolls back the entire transaction if audit log persistence fails", async () => {
    (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
    (prisma.leadChangeLog.createMany as any).mockRejectedValue(
      new Error("Database write error: connection lost")
    );

    await expect(
      editLead(brokerContext, {
        id: "lead-100",
        name: "Rohan Failing",
        primaryPhone: "9876543210",
        originalSource: "99acres",
        minBudget: 5000000,
        maxBudget: 10000000,
        city: "Gurugram",
        preference: "SALE",
      })
    ).rejects.toThrow("Database write error: connection lost");

    // Because createMany threw inside the transaction, the update on lead and upsert on leadRequirement fail
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });
});
