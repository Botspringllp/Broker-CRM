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
      create: vi.fn(),
      update: vi.fn(),
    },
    leadRequirement: {
      update: vi.fn(),
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
import { createLead, logLeadCall, updateLeadStatus, getLeadById } from "@/server/dal/leads";

describe("Demand / Lead Management DAL", () => {
  const brokerContext: TenantContext = {
    tenantId: "tenant-broker-1",
    userId: "user-broker-1",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-broker-1",
      name: "Broker Vikram",
      email: "vikram@apexrealty.in",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-broker-1",
      isActive: true,
    },
    session: {
      id: "sess-1",
      token: "tok-1",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const telecallerContext: TenantContext = {
    tenantId: "tenant-broker-1",
    userId: "user-telecaller-1",
    role: UserRole.TELECALLER,
    user: {
      id: "user-telecaller-1",
      name: "Pooja Telecaller",
      email: "pooja@apexrealty.in",
      role: UserRole.TELECALLER,
      tenantId: "tenant-broker-1",
      isActive: true,
    },
    session: {
      id: "sess-2",
      token: "tok-2",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const otherTenantContext: TenantContext = {
    tenantId: "tenant-broker-2",
    userId: "user-other-1",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-other-1",
      name: "Other Broker",
      email: "other@brokerage.in",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-broker-2",
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

  describe("createLead", () => {
    it("successfully creates lead with normalized phone and requirement profile", async () => {
      vi.mocked(prisma.lead.create).mockResolvedValueOnce({
        id: "lead-new-1",
        tenantId: "tenant-broker-1",
        name: "Rohit Verma",
        primaryPhone: "9810012345",
        status: LeadStatus.NOT_YET_VALIDATED,
        callLogs: [],
      } as any);

      const result = await createLead(brokerContext, {
        name: "Rohit Verma",
        primaryPhone: "+91 98100-12345",
        originalSource: "Direct Inquiry",
        preference: "SALE",
        city: "Gurugram",
        minBudget: 5000000,
        maxBudget: 15000000,
        bedroomConfigurations: ["2 BHK", "3 BHK"],
        propertyTypes: ["APARTMENT"],
      });

      expect(result.id).toBe("lead-new-1");
      expect(prisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: "tenant-broker-1",
            name: "Rohit Verma",
            primaryPhone: "919810012345",
            status: LeadStatus.NOT_YET_VALIDATED,
          }),
        })
      );
    });

    it("rejects lead creation with invalid phone number", async () => {
      await expect(
        createLead(brokerContext, {
          name: "Rohit Verma",
          primaryPhone: "123", // Too short
          originalSource: "Direct Inquiry",
          city: "Gurugram",
          preference: "SALE",
          minBudget: 5000000,
          maxBudget: 15000000,
        })
      ).rejects.toThrow(ValidationError);
    });

    it("rejects lead creation with invalid budget (min > max)", async () => {
      await expect(
        createLead(brokerContext, {
          name: "Rohit Verma",
          primaryPhone: "9810012345",
          originalSource: "Direct Inquiry",
          city: "Gurugram",
          preference: "SALE",
          minBudget: 20000000,
          maxBudget: 10000000,
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("logLeadCall", () => {
    it("logs CONNECTED call outcome without changing active/inactive status", async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce({
        id: "lead-1",
        tenantId: "tenant-broker-1",
        name: "Anand Gupta",
        status: LeadStatus.NOT_YET_VALIDATED,
        unreachableAttemptsCount: 0,
        assignedTelecallerId: "user-telecaller-1",
      } as any);

      vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-1" } as any);
      vi.mocked(prisma.lead.update).mockResolvedValueOnce({
        id: "lead-1",
        status: LeadStatus.NOT_YET_VALIDATED,
        currentDisposition: "CONNECTED",
        unreachableAttemptsCount: 0,
        callLogs: [],
      } as any);

      const updated = await logLeadCall(telecallerContext, {
        leadId: "lead-1",
        disposition: "Connected",
        notes: "Discussed 3 BHK requirement near Golf Course Road.",
      });

      expect(prisma.callLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadId: "lead-1",
            callerId: "user-telecaller-1",
            leadDisposition: LeadCallingDisposition.CONNECTED,
          }),
        })
      );

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id_tenantId: {
              id: "lead-1",
              tenantId: "tenant-broker-1",
            },
          },
          data: expect.objectContaining({
            unreachableAttemptsCount: 0,
          }),
        })
      );
    });

    it("requires callback scheduled datetime when disposition is Call Back", async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce({
        id: "lead-1",
        tenantId: "tenant-broker-1",
        assignedTelecallerId: "user-telecaller-1",
      } as any);

      await expect(
        logLeadCall(telecallerContext, {
          leadId: "lead-1",
          disposition: "Call Back",
          notes: "Call back tomorrow morning",
          // missing callbackScheduledAt
        })
      ).rejects.toThrow(ValidationError);
    });

    it("increments unreachable attempts on Ringing / Not Answering", async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce({
        id: "lead-1",
        tenantId: "tenant-broker-1",
        status: LeadStatus.NOT_YET_VALIDATED,
        unreachableAttemptsCount: 1,
        assignedTelecallerId: "user-telecaller-1",
      } as any);

      vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-2" } as any);
      vi.mocked(prisma.lead.update).mockResolvedValueOnce({
        id: "lead-1",
        unreachableAttemptsCount: 2,
        status: LeadStatus.NOT_YET_VALIDATED,
        callLogs: [],
      } as any);

      await logLeadCall(telecallerContext, {
        leadId: "lead-1",
        disposition: "Ringing / Not Answering",
      });

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            unreachableAttemptsCount: 2,
            status: LeadStatus.NOT_YET_VALIDATED,
          }),
        })
      );
    });

    it("automatically marks lead INACTIVE on 3rd unreachable attempt (PRD §5.5 limit)", async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce({
        id: "lead-1",
        tenantId: "tenant-broker-1",
        status: LeadStatus.NOT_YET_VALIDATED,
        unreachableAttemptsCount: 2, // 2 prior attempts
        assignedTelecallerId: "user-telecaller-1",
      } as any);

      vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-3" } as any);
      vi.mocked(prisma.lead.update).mockResolvedValueOnce({
        id: "lead-1",
        unreachableAttemptsCount: 3,
        status: LeadStatus.INACTIVE,
        callLogs: [],
      } as any);

      await logLeadCall(telecallerContext, {
        leadId: "lead-1",
        disposition: "Ringing / Not Answering",
      });

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            unreachableAttemptsCount: 3,
            status: LeadStatus.INACTIVE,
          }),
        })
      );
    });

    it("automatically marks lead INACTIVE when prospect says not looking", async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce({
        id: "lead-1",
        tenantId: "tenant-broker-1",
        status: LeadStatus.NOT_YET_VALIDATED,
        unreachableAttemptsCount: 0,
        assignedTelecallerId: "user-telecaller-1",
      } as any);

      vi.mocked(prisma.callLog.create).mockResolvedValueOnce({ id: "call-4" } as any);
      vi.mocked(prisma.lead.update).mockResolvedValueOnce({
        id: "lead-1",
        status: LeadStatus.INACTIVE,
        callLogs: [],
      } as any);

      await logLeadCall(telecallerContext, {
        leadId: "lead-1",
        disposition: "Buyer / Tenant Says Not Looking",
        notes: "Purchased another unit in DLF Phase 5.",
      });

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: LeadStatus.INACTIVE,
          }),
        })
      );
    });

    it("enforces telecaller assignment scoping: telecaller cannot log call on lead assigned to peer", async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce({
        id: "lead-1",
        tenantId: "tenant-broker-1",
        assignedTelecallerId: "user-telecaller-other", // Not user-telecaller-1
      } as any);

      await expect(
        logLeadCall(telecallerContext, {
          leadId: "lead-1",
          disposition: "Connected",
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("updateLeadStatus", () => {
    it("updates lead status to ACTIVE for Broker Owner", async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce({
        id: "lead-1",
        tenantId: "tenant-broker-1",
        status: LeadStatus.NOT_YET_VALIDATED,
        requirement: {
          id: "req-1",
          status: "NOT_CONFIRMED",
        },
      } as any);

      vi.mocked(prisma.lead.update).mockResolvedValueOnce({
        id: "lead-1",
        status: LeadStatus.ACTIVE,
        callLogs: [],
      } as any);

      const res = await updateLeadStatus(brokerContext, "lead-1", LeadStatus.ACTIVE);
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id_tenantId: {
              id: "lead-1",
              tenantId: "tenant-broker-1",
            },
          },
          data: expect.objectContaining({
            status: LeadStatus.ACTIVE,
          }),
        })
      );
    });

    it("throws NotFoundError when updating lead belonging to another tenant", async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null);

      await expect(
        updateLeadStatus(otherTenantContext, "lead-1", LeadStatus.ACTIVE)
      ).rejects.toThrow(NotFoundError);
    });
  });
});
