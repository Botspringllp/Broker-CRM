/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  UserRole,
  SiteVisitStatus,
  SiteVisitItemOutcome,
  VisitOutcomeEntryChannel,
} from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";

vi.mock("@/server/db", () => {
  const mockPrisma = {
    siteVisit: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    siteVisitItem: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    siteVisitScheduleHistory: {
      create: vi.fn(),
    },
    lead: {
      findFirst: vi.fn(),
    },
    property: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => {
      if (typeof cb === "function") return cb(mockPrisma);
      return cb;
    }),
  };
  return { prisma: mockPrisma };
});

import { prisma } from "@/server/db";
import {
  createSiteVisit,
  recordVisitItemOutcome,
  confirmSiteVisit,
  getSiteVisitById,
  listSiteVisits,
  rescheduleSiteVisit,
  reassignSiteVisitAgent,
  cancelSiteVisit,
} from "@/server/dal/visits";

describe("Site Visits DAL & Workflow Management", () => {
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

  const salesAgentContext: TenantContext = {
    tenantId: "tenant-broker-1",
    userId: "user-sales-1",
    role: UserRole.FIELD_SALES_AGENT,
    user: {
      id: "user-sales-1",
      name: "Rahul Sales",
      email: "rahul@apexrealty.in",
      role: UserRole.FIELD_SALES_AGENT,
      tenantId: "tenant-broker-1",
      isActive: true,
    },
    session: {
      id: "sess-3",
      token: "tok-3",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  const otherSalesAgentContext: TenantContext = {
    tenantId: "tenant-broker-1",
    userId: "user-sales-other",
    role: UserRole.FIELD_SALES_AGENT,
    user: {
      id: "user-sales-other",
      name: "Other Sales",
      email: "othersales@apexrealty.in",
      role: UserRole.FIELD_SALES_AGENT,
      tenantId: "tenant-broker-1",
      isActive: true,
    },
    session: {
      id: "sess-4",
      token: "tok-4",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("createSiteVisit", () => {
    it("successfully creates multi-property visit for active supply pool properties", async () => {
      // 1. Mock lead exists
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce({
        id: "lead-1",
        tenantId: "tenant-broker-1",
        name: "Aman Sood",
        status: "ACTIVE",
      } as any);

      // 2. Mock sales agent exists
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "user-sales-1",
        tenantId: "tenant-broker-1",
        name: "Rahul Sales",
        role: UserRole.FIELD_SALES_AGENT,
      } as any);

      // 3. Mock properties exist and belong to Active Supply Pool
      vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
        {
          id: "prop-1",
          societyName: "The Camellias",
          isActiveSupply: true,
          availabilityStatus: "AVAILABLE",
        },
        {
          id: "prop-2",
          societyName: "Magnolias",
          isActiveSupply: true,
          availabilityStatus: "AVAILABLE",
        },
      ] as any);

      // 4. Mock site visit creation
      vi.mocked(prisma.siteVisit.create).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        leadId: "lead-1",
        assignedSalesAgentId: "user-sales-1",
        status: SiteVisitStatus.CONFIRMED,
        items: [
          { id: "item-1", propertyId: "prop-1", visitOrder: 1 },
          { id: "item-2", propertyId: "prop-2", visitOrder: 2 },
        ],
      } as any);

      const visit = await createSiteVisit(telecallerContext, {
        leadId: "lead-1",
        assignedSalesAgentId: "user-sales-1",
        scheduledDate: "2026-10-30T10:00:00.000Z",
        propertyIds: ["prop-1", "prop-2"],
        notes: "Buyer interested in golf-facing units",
      });

      expect(visit.id).toBe("visit-1");
      expect(prisma.siteVisit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: "tenant-broker-1",
            leadId: "lead-1",
            assignedSalesAgentId: "user-sales-1",
            status: SiteVisitStatus.CONFIRMED,
            items: {
              create: [
                expect.objectContaining({ propertyId: "prop-1", visitOrder: 1 }),
                expect.objectContaining({ propertyId: "prop-2", visitOrder: 2 }),
              ],
            },
          }),
        })
      );
    });

    it("rejects site visit creation if any selected property is not in Active Supply Pool", async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce({
        id: "lead-1",
        tenantId: "tenant-broker-1",
      } as any);

      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "user-sales-1",
        tenantId: "tenant-broker-1",
      } as any);

      // One property is still pending verification
      vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
        {
          id: "prop-1",
          societyName: "The Camellias",
          isActiveSupply: true,
          availabilityStatus: "AVAILABLE",
        },
        {
          id: "prop-2",
          societyName: "Unverified Towers",
          isActiveSupply: false, // NOT ACTIVE
          availabilityStatus: "PENDING_VERIFICATION",
        },
      ] as any);

      await expect(
        createSiteVisit(telecallerContext, {
          leadId: "lead-1",
          assignedSalesAgentId: "user-sales-1",
          scheduledDate: "2026-10-30T10:00:00.000Z",
          propertyIds: ["prop-1", "prop-2"],
        })
      ).rejects.toThrow(ValidationError);
    });

    it("rejects site visit creation without any property selected", async () => {
      await expect(
        createSiteVisit(telecallerContext, {
          leadId: "lead-1",
          assignedSalesAgentId: "user-sales-1",
          scheduledDate: "2026-10-30T10:00:00.000Z",
          propertyIds: [], // Empty
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("recordVisitItemOutcome", () => {
    it("allows assigned Field Sales Agent to directly record outcome", async () => {
      vi.mocked(prisma.siteVisitItem.findFirst).mockResolvedValueOnce({
        id: "item-1",
        tenantId: "tenant-broker-1",
        siteVisitId: "visit-1",
        siteVisit: {
          id: "visit-1",
          assignedSalesAgentId: "user-sales-1", // Matches caller
        },
      } as any);

      vi.mocked(prisma.siteVisitItem.update).mockResolvedValueOnce({
        id: "item-1",
        status: SiteVisitItemOutcome.VISIT_DONE,
      } as any);

      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
      } as any);

      await recordVisitItemOutcome(salesAgentContext, "item-1", {
        status: SiteVisitItemOutcome.VISIT_DONE,
        agentTextNotes: "Customer spent 45 minutes, loved the view.",
        entryChannel: VisitOutcomeEntryChannel.FIELD_AGENT_DIRECT,
      });

      expect(prisma.siteVisitItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "item-1" },
          data: expect.objectContaining({
            status: SiteVisitItemOutcome.VISIT_DONE,
            reportedByUserId: "user-sales-1",
            enteredByUserId: "user-sales-1",
            entryChannel: VisitOutcomeEntryChannel.FIELD_AGENT_DIRECT,
          }),
        })
      );
    });

    it("allows telecaller to enter outcome on behalf of field sales agent with dual-identity audit", async () => {
      vi.mocked(prisma.siteVisitItem.findFirst).mockResolvedValueOnce({
        id: "item-1",
        tenantId: "tenant-broker-1",
        siteVisitId: "visit-1",
        siteVisit: {
          id: "visit-1",
          assignedSalesAgentId: "user-sales-1",
        },
      } as any);

      vi.mocked(prisma.siteVisitItem.update).mockResolvedValueOnce({
        id: "item-1",
        status: SiteVisitItemOutcome.VISIT_DONE,
      } as any);

      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
      } as any);

      await recordVisitItemOutcome(telecallerContext, "item-1", {
        status: SiteVisitItemOutcome.VISIT_DONE,
        agentTextNotes: "Agent called: buyer requested layout plan.",
        reportedByUserId: "user-sales-1", // Reported by sales agent
        entryChannel: VisitOutcomeEntryChannel.TELECALLER_ON_BEHALF,
      });

      expect(prisma.siteVisitItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "item-1" },
          data: expect.objectContaining({
            status: SiteVisitItemOutcome.VISIT_DONE,
            reportedByUserId: "user-sales-1", // Reported by
            enteredByUserId: "user-telecaller-1", // Entered by
            entryChannel: VisitOutcomeEntryChannel.TELECALLER_ON_BEHALF,
          }),
        })
      );
    });

    it("prevents unassigned Field Sales Agent from recording outcome on another agent's visit", async () => {
      vi.mocked(prisma.siteVisitItem.findFirst).mockResolvedValueOnce({
        id: "item-1",
        tenantId: "tenant-broker-1",
        siteVisitId: "visit-1",
        siteVisit: {
          id: "visit-1",
          assignedSalesAgentId: "user-sales-1", // Assigned to Rahul, not other agent
        },
      } as any);

      await expect(
        recordVisitItemOutcome(otherSalesAgentContext, "item-1", {
          status: SiteVisitItemOutcome.VISIT_DONE,
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("confirmSiteVisit", () => {
    it("finalizes visit as COMPLETED and records telecaller confirmation audit", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        status: SiteVisitStatus.CONFIRMED,
      } as any);

      vi.mocked(prisma.siteVisit.update).mockResolvedValueOnce({
        id: "visit-1",
        status: SiteVisitStatus.COMPLETED,
        telecallerConfirmedByUserId: "user-telecaller-1",
      } as any);

      await confirmSiteVisit(telecallerContext, "visit-1", "Customer completed both showings successfully.");

      expect(prisma.siteVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "visit-1" },
          data: expect.objectContaining({
            status: SiteVisitStatus.COMPLETED,
            telecallerConfirmedByUserId: "user-telecaller-1",
            notes: "Customer completed both showings successfully.",
          }),
        })
      );
    });

    it("denies unprivileged roles from finalizing visits", async () => {
      await expect(
        confirmSiteVisit(salesAgentContext, "visit-1")
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("rescheduleSiteVisit", () => {
    it("reschedules visit and creates immutable schedule history audit record", async () => {
      const prevDate = new Date("2026-11-01T10:00:00Z");
      const newDate = new Date("2026-11-03T14:00:00Z");

      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        scheduledDate: prevDate,
        status: SiteVisitStatus.CONFIRMED,
      } as any);

      vi.mocked(prisma.siteVisit.update).mockResolvedValueOnce({
        id: "visit-1",
        scheduledDate: newDate,
        status: SiteVisitStatus.CONFIRMED,
      } as any);

      await rescheduleSiteVisit(telecallerContext, {
        visitId: "visit-1",
        newScheduledDate: newDate,
        reason: "Buyer requested weekend afternoon slot instead.",
      });

      expect(prisma.siteVisitScheduleHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            siteVisitId: "visit-1",
            previousScheduledAt: prevDate,
            newScheduledAt: newDate,
            changeType: "RESCHEDULED",
            reason: "Buyer requested weekend afternoon slot instead.",
            recordedByUserId: "user-telecaller-1",
          }),
        })
      );

      expect(prisma.siteVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "visit-1" },
          data: expect.objectContaining({
            scheduledDate: newDate,
          }),
        })
      );
    });

    it("throws ValidationError when reason is missing", async () => {
      await expect(
        rescheduleSiteVisit(telecallerContext, {
          visitId: "visit-1",
          newScheduledDate: new Date(),
          reason: "   ",
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("reassignSiteVisitAgent", () => {
    it("reassigns agent to an active sales agent in the tenant", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        assignedSalesAgentId: "user-sales-1",
      } as any);

      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "user-sales-2",
        name: "Amit Agent",
        role: UserRole.FIELD_SALES_AGENT,
      } as any);

      vi.mocked(prisma.siteVisit.update).mockResolvedValueOnce({
        id: "visit-1",
        assignedSalesAgentId: "user-sales-2",
      } as any);

      await reassignSiteVisitAgent(brokerContext, {
        visitId: "visit-1",
        newSalesAgentId: "user-sales-2",
        reason: "Original agent on leave.",
      });

      expect(prisma.siteVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "visit-1" },
          data: expect.objectContaining({
            assignedSalesAgentId: "user-sales-2",
          }),
        })
      );
    });

    it("throws NotFoundError if target sales agent is inactive or not found", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
      } as any);

      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

      await expect(
        reassignSiteVisitAgent(brokerContext, {
          visitId: "visit-1",
          newSalesAgentId: "user-nonexistent",
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("cancelSiteVisit", () => {
    it("cancels site visit and logs schedule history entry", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        scheduledDate: new Date("2026-11-01T10:00:00Z"),
        status: SiteVisitStatus.CONFIRMED,
      } as any);

      vi.mocked(prisma.siteVisit.update).mockResolvedValueOnce({
        id: "visit-1",
        status: SiteVisitStatus.CANCELLED,
      } as any);

      await cancelSiteVisit(telecallerContext, {
        visitId: "visit-1",
        reason: "Owner out of town unexpectedly.",
      });

      expect(prisma.siteVisitScheduleHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            siteVisitId: "visit-1",
            changeType: "CANCELLED",
            reason: "Owner out of town unexpectedly.",
          }),
        })
      );

      expect(prisma.siteVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "visit-1" },
          data: expect.objectContaining({
            status: SiteVisitStatus.CANCELLED,
            cancellationReason: "Owner out of town unexpectedly.",
          }),
        })
      );
    });
  });
});
