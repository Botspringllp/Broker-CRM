/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole, LeadStatus, LeadCallingDisposition } from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";

vi.mock("@/server/db", () => {
  const mockPrisma = {
    lead: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    leadRequirement: {
      update: vi.fn(),
      upsert: vi.fn(),
    },
    callLog: {
      create: vi.fn(),
      findMany: vi.fn(),
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
  createLead,
  editLead,
  logLeadCall,
  updateLeadStatus,
  getLeadById,
} from "@/server/dal/leads";

describe("Demand Management: Dedicated Pages & Qualification Workspace Tests", () => {
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

  const telecallerContext: TenantContext = {
    tenantId: "tenant-apex-1",
    userId: "telecaller-1",
    role: UserRole.TELECALLER,
    user: {
      id: "telecaller-1",
      name: "Pooja Telecaller",
      email: "pooja@apexrealty.in",
      role: UserRole.TELECALLER,
      tenantId: "tenant-apex-1",
      isActive: true,
    },
    session: {
      id: "sess-2",
      token: "tok-2",
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
      id: "sess-3",
      token: "tok-3",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("1. Lead Registration Wizard Validation (createLead)", () => {
    it("validates required prospect name", async () => {
      await expect(
        createLead(brokerContext, {
          name: "  ",
          primaryPhone: "9810123456",
          originalSource: "Direct Inquiry",
          city: "Gurugram",
          preference: "SALE",
          minBudget: 5000000,
          maxBudget: 10000000,
        })
      ).rejects.toThrow(ValidationError);
    });

    it("validates 10-digit primary phone", async () => {
      await expect(
        createLead(brokerContext, {
          name: "Rahul Verma",
          primaryPhone: "12345",
          originalSource: "Direct Inquiry",
          city: "Gurugram",
          preference: "SALE",
          minBudget: 5000000,
          maxBudget: 10000000,
        })
      ).rejects.toThrow(ValidationError);
    });

    it("rejects negative budgets", async () => {
      await expect(
        createLead(brokerContext, {
          name: "Rahul Verma",
          primaryPhone: "9810123456",
          originalSource: "Direct Inquiry",
          city: "Gurugram",
          preference: "SALE",
          minBudget: -100,
          maxBudget: 10000000,
        })
      ).rejects.toThrow("Budget values cannot be negative.");
    });

    it("rejects maxBudget less than minBudget", async () => {
      await expect(
        createLead(brokerContext, {
          name: "Rahul Verma",
          primaryPhone: "9810123456",
          originalSource: "Direct Inquiry",
          city: "Gurugram",
          preference: "SALE",
          minBudget: 15000000,
          maxBudget: 10000000,
        })
      ).rejects.toThrow("Maximum budget cannot be less than minimum budget.");
    });

    it("successfully creates lead with NOT_YET_VALIDATED status", async () => {
      const mockCreated = {
        id: "lead-new-1",
        tenantId: "tenant-apex-1",
        name: "Rahul Verma",
        primaryPhone: "9810123456",
        status: LeadStatus.NOT_YET_VALIDATED,
        originalSource: "99acres",
        requirement: {
          minBudget: 5000000,
          maxBudget: 10000000,
          city: "Gurugram",
          preference: "SALE",
        },
      };

      (prisma.lead.create as any).mockResolvedValue(mockCreated);

      const result = await createLead(brokerContext, {
        name: "Rahul Verma",
        primaryPhone: "+91 9810123456",
        originalSource: "99acres",
        city: "Gurugram",
        preference: "SALE",
        minBudget: 5000000,
        maxBudget: 10000000,
      });

      expect(prisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: "tenant-apex-1",
            name: "Rahul Verma",
            primaryPhone: "919810123456",
            status: LeadStatus.NOT_YET_VALIDATED,
          }),
        })
      );
      expect(result.id).toBe("lead-new-1");
    });
  });

  describe("2. Edit Lead Page Validation & Persistence (editLead)", () => {
    const existingLead = {
      id: "lead-1",
      tenantId: "tenant-apex-1",
      name: "Amit Sharma",
      primaryPhone: "9811122233",
      assignedTelecallerId: "telecaller-1",
      status: LeadStatus.NOT_YET_VALIDATED,
      originalSource: "Direct Inquiry",
      requirement: {
        id: "req-1",
        leadId: "lead-1",
        minBudget: 6000000,
        maxBudget: 12000000,
        city: "Gurugram",
        preference: "SALE",
      },
    };

    it("rejects edit if prospect name is blank", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(existingLead);

      await expect(
        editLead(brokerContext, {
          id: "lead-1",
          name: "  ",
          primaryPhone: "9811122233",
          originalSource: "Direct Inquiry",
          city: "Gurugram",
          preference: "SALE",
          minBudget: 6000000,
          maxBudget: 12000000,
        })
      ).rejects.toThrow("Prospect name is required.");
    });

    it("rejects edit if maxBudget < minBudget", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(existingLead);

      await expect(
        editLead(brokerContext, {
          id: "lead-1",
          name: "Amit Sharma",
          primaryPhone: "9811122233",
          originalSource: "Direct Inquiry",
          city: "Gurugram",
          preference: "SALE",
          minBudget: 20000000,
          maxBudget: 10000000,
        })
      ).rejects.toThrow("Maximum budget cannot be less than minimum budget.");
    });

    it("enforces tenant boundary on editLead", async () => {
      // FindFirst returns null because tenantId does not match
      (prisma.lead.findFirst as any).mockResolvedValue(null);

      await expect(
        editLead(otherTenantContext, {
          id: "lead-1",
          name: "Cross Tenant Attack",
          primaryPhone: "9811122233",
          originalSource: "Direct Inquiry",
          city: "Gurugram",
          preference: "SALE",
          minBudget: 6000000,
          maxBudget: 12000000,
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("enforces telecaller scoping on editLead (denies editing unassigned lead)", async () => {
      // Unassigned lead
      (prisma.lead.findFirst as any).mockResolvedValue(null);

      await expect(
        editLead(telecallerContext, {
          id: "lead-unassigned-1",
          name: "Unassigned Lead",
          primaryPhone: "9811122233",
          originalSource: "Direct Inquiry",
          city: "Gurugram",
          preference: "SALE",
          minBudget: 6000000,
          maxBudget: 12000000,
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("successfully edits lead and updates requirements in transaction", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(existingLead);
      (prisma.lead.update as any).mockResolvedValue({
        ...existingLead,
        name: "Amit Sharma Updated",
      });
      (prisma.leadRequirement.upsert as any).mockResolvedValue({
        id: "req-1",
        leadId: "lead-1",
      });
      (prisma.lead.findUniqueOrThrow as any).mockResolvedValue({
        ...existingLead,
        name: "Amit Sharma Updated",
        requirement: {
          minBudget: 7000000,
          maxBudget: 15000000,
          city: "Gurugram",
          preference: "SALE",
        },
      });

      const result = await editLead(brokerContext, {
        id: "lead-1",
        name: "Amit Sharma Updated",
        primaryPhone: "9811122233",
        originalSource: "MagicBricks",
        city: "Gurugram",
        preference: "SALE",
        minBudget: 7000000,
        maxBudget: 15000000,
        bedroomConfigurations: ["3 BHK", "4 BHK"],
        propertyTypes: ["APARTMENT"],
      });

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id_tenantId: {
              id: "lead-1",
              tenantId: "tenant-apex-1",
            },
          },
          data: expect.objectContaining({
            name: "Amit Sharma Updated",
            primaryPhone: "9811122233",
            originalSource: "MagicBricks",
          }),
        })
      );

      expect(prisma.leadRequirement.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { leadId: "lead-1" },
          update: expect.objectContaining({
            city: "Gurugram",
            preference: "SALE",
            bedroomConfigurations: ["3 BHK", "4 BHK"],
            propertyTypes: ["APARTMENT"],
          }),
        })
      );

      expect(result.name).toBe("Amit Sharma Updated");
    });
  });

  describe("3. Dedicated Qualification Workspace & Dispositions (logLeadCall)", () => {
    const activeLead = {
      id: "lead-qual-1",
      tenantId: "tenant-apex-1",
      name: "Suresh Patel",
      primaryPhone: "9812345678",
      assignedTelecallerId: "telecaller-1",
      status: LeadStatus.NOT_YET_VALIDATED,
      unreachableAttemptsCount: 0,
      requirement: {
        city: "Gurugram",
        preference: "RENT",
      },
    };

    it("requires callback date/time when disposition is CALL_BACK", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(activeLead);

      await expect(
        logLeadCall(telecallerContext, {
          leadId: "lead-qual-1",
          disposition: "CALL_BACK",
          notes: "Buyer was driving",
        })
      ).rejects.toThrow("A callback date and time is required when disposition is Call Back.");
    });

    it("resets unreachable counter on CONNECTED call", async () => {
      const previouslyUnreachable = {
        ...activeLead,
        unreachableAttemptsCount: 2,
      };
      (prisma.lead.findFirst as any).mockResolvedValue(previouslyUnreachable);
      (prisma.callLog.create as any).mockResolvedValue({ id: "call-1" });
      (prisma.lead.update as any).mockResolvedValue({
        ...previouslyUnreachable,
        unreachableAttemptsCount: 0,
      });

      const updated = await logLeadCall(telecallerContext, {
        leadId: "lead-qual-1",
        disposition: "CONNECTED",
        notes: "Connected and spoke with prospect. Verified budget.",
      });

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            unreachableAttemptsCount: 0,
          }),
        })
      );
    });

    it("increments unreachable counter on RINGING_OR_NOT_ANSWERING", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(activeLead);
      (prisma.callLog.create as any).mockResolvedValue({ id: "call-2" });
      (prisma.lead.update as any).mockResolvedValue({
        ...activeLead,
        unreachableAttemptsCount: 1,
      });

      await logLeadCall(telecallerContext, {
        leadId: "lead-qual-1",
        disposition: "RINGING_OR_NOT_ANSWERING",
        notes: "No answer",
      });

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            unreachableAttemptsCount: 1,
            status: LeadStatus.NOT_YET_VALIDATED,
          }),
        })
      );
    });

    it("automatically marks lead INACTIVE on 3rd unreachable attempt", async () => {
      const twoAttemptsLead = {
        ...activeLead,
        unreachableAttemptsCount: 2,
      };
      (prisma.lead.findFirst as any).mockResolvedValue(twoAttemptsLead);
      (prisma.callLog.create as any).mockResolvedValue({ id: "call-3" });
      (prisma.lead.update as any).mockResolvedValue({
        ...twoAttemptsLead,
        unreachableAttemptsCount: 3,
        status: LeadStatus.INACTIVE,
      });

      await logLeadCall(telecallerContext, {
        leadId: "lead-qual-1",
        disposition: "RINGING_OR_NOT_ANSWERING",
        notes: "Third failed attempt",
      });

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            unreachableAttemptsCount: 3,
            status: LeadStatus.INACTIVE, // 3-attempt unreachable threshold enforced
          }),
        })
      );
    });

    it("immediately marks lead INACTIVE when buyer says not looking", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(activeLead);
      (prisma.callLog.create as any).mockResolvedValue({ id: "call-4" });
      (prisma.lead.update as any).mockResolvedValue({
        ...activeLead,
        status: LeadStatus.INACTIVE,
      });

      await logLeadCall(telecallerContext, {
        leadId: "lead-qual-1",
        disposition: "BUYER_SAYS_NOT_LOOKING",
        notes: "Prospect already bought a flat directly",
      });

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: LeadStatus.INACTIVE,
          }),
        })
      );
    });
  });

  describe("4. Requirements Confirmation & Activation (updateLeadStatus)", () => {
    const unvalidatedLead = {
      id: "lead-conf-1",
      tenantId: "tenant-apex-1",
      name: "Pooja Malhotra",
      primaryPhone: "9899887766",
      assignedTelecallerId: "telecaller-1",
      status: LeadStatus.NOT_YET_VALIDATED,
      requirement: {
        id: "req-conf-1",
        leadId: "lead-conf-1",
        isConfirmed: false,
      },
    };

    it("activates lead and confirms requirements atomically", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(unvalidatedLead);
      (prisma.leadRequirement.update as any).mockResolvedValue({
        ...unvalidatedLead.requirement,
        isConfirmed: true,
      });
      (prisma.lead.update as any).mockResolvedValue({
        ...unvalidatedLead,
        status: LeadStatus.ACTIVE,
      });

      const updated = await updateLeadStatus(brokerContext, "lead-conf-1", LeadStatus.ACTIVE);

      expect(prisma.leadRequirement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { leadId: "lead-conf-1" },
          data: { isConfirmed: true },
        })
      );

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id_tenantId: {
              id: "lead-conf-1",
              tenantId: "tenant-apex-1",
            },
          },
          data: { status: LeadStatus.ACTIVE },
        })
      );
    });
  });

  describe("5. Lead Details Retrieval & Authorization (getLeadById)", () => {
    it("returns lead for authorized broker owner", async () => {
      const mockLead = {
        id: "lead-det-1",
        tenantId: "tenant-apex-1",
        name: "Deepak Chopra",
        primaryPhone: "9876543210",
      };
      (prisma.lead.findFirst as any).mockResolvedValue(mockLead);

      const lead = await getLeadById(brokerContext, "lead-det-1");
      expect(lead.id).toBe("lead-det-1");
      expect(prisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "lead-det-1",
            tenantId: "tenant-apex-1",
          }),
        })
      );
    });

    it("prevents telecaller enumeration: throws NotFoundError for unassigned lead", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(null);

      await expect(
        getLeadById(telecallerContext, "lead-unassigned-secret")
      ).rejects.toThrow(NotFoundError);

      expect(prisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "lead-unassigned-secret",
            tenantId: "tenant-apex-1",
            assignedTelecallerId: "telecaller-1",
          }),
        })
      );
    });
  });
});

