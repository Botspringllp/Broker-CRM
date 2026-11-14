/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  UserRole,
  SiteVisitStatus,
  SiteVisitItemOutcome,
  VisitOutcomeEntryChannel,
  BuyerInterestLevel,
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
    buyerPropertyInterest: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
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
  confirmSiteVisitOwnerAvailability,
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
        status: SiteVisitStatus.TENTATIVE_AWAITING_OWNER,
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
            status: SiteVisitStatus.TENTATIVE_AWAITING_OWNER,
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

    it("rejects site visit creation if caller lacks visits:schedule permission", async () => {
      await expect(
        createSiteVisit(salesAgentContext, {
          leadId: "lead-1",
          assignedSalesAgentId: "user-sales-1",
          scheduledDate: "2026-10-30T10:00:00.000Z",
          propertyIds: ["prop-1"],
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("rejects site visit creation if lead belongs to another tenant", async () => {
      // Lead lookup returns null because tenantId does not match
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null);

      await expect(
        createSiteVisit(telecallerContext, {
          leadId: "lead-cross-tenant",
          assignedSalesAgentId: "user-sales-1",
          scheduledDate: "2026-10-30T10:00:00.000Z",
          propertyIds: ["prop-1"],
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects site visit creation if selected property belongs to another tenant", async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce({
        id: "lead-1",
        tenantId: "tenant-broker-1",
      } as any);

      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "user-sales-1",
        tenantId: "tenant-broker-1",
        isActive: true,
      } as any);

      // Property lookup returns empty array because tenantId filter excluded it
      vi.mocked(prisma.property.findMany).mockResolvedValueOnce([]);

      await expect(
        createSiteVisit(telecallerContext, {
          leadId: "lead-1",
          assignedSalesAgentId: "user-sales-1",
          scheduledDate: "2026-10-30T10:00:00.000Z",
          propertyIds: ["prop-cross-tenant"],
        })
      ).rejects.toThrow(ValidationError);
    });

    it("verifies that newly created visit begins in TENTATIVE_AWAITING_OWNER status without auto-confirming owner", async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce({
        id: "lead-1",
        tenantId: "tenant-broker-1",
      } as any);

      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "user-sales-1",
        tenantId: "tenant-broker-1",
        isActive: true,
      } as any);

      vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
        {
          id: "prop-1",
          societyName: "The Camellias",
          isActiveSupply: true,
          availabilityStatus: "AVAILABLE",
        },
      ] as any);

      vi.mocked(prisma.siteVisit.create).mockResolvedValueOnce({
        id: "visit-tentative",
        tenantId: "tenant-broker-1",
        leadId: "lead-1",
        assignedSalesAgentId: "user-sales-1",
        status: SiteVisitStatus.TENTATIVE_AWAITING_OWNER,
        items: [{ id: "item-1", propertyId: "prop-1", visitOrder: 1 }],
      } as any);

      const created = await createSiteVisit(telecallerContext, {
        leadId: "lead-1",
        assignedSalesAgentId: "user-sales-1",
        scheduledDate: "2026-11-01T10:00:00.000Z",
        propertyIds: ["prop-1"],
      });

      expect(prisma.siteVisit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SiteVisitStatus.TENTATIVE_AWAITING_OWNER,
          }),
        })
      );
      expect(created.status).toBe(SiteVisitStatus.TENTATIVE_AWAITING_OWNER);
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

    it("does not prematurely complete or update the parent visit status when recording an item outcome", async () => {
      vi.mocked(prisma.siteVisitItem.findFirst).mockResolvedValueOnce({
        id: "item-1",
        tenantId: "tenant-broker-1",
        siteVisitId: "visit-1",
        siteVisit: {
          id: "visit-1",
          assignedSalesAgentId: "user-sales-1",
          status: SiteVisitStatus.CONFIRMED,
        },
      } as any);

      vi.mocked(prisma.siteVisitItem.update).mockResolvedValueOnce({
        id: "item-1",
        status: SiteVisitItemOutcome.VISIT_DONE,
      } as any);

      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        status: SiteVisitStatus.CONFIRMED,
      } as any);

      await recordVisitItemOutcome(salesAgentContext, "item-1", {
        status: SiteVisitItemOutcome.VISIT_DONE,
        agentTextNotes: "Showing finished",
      });

      // Item was updated
      expect(prisma.siteVisitItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "item-1" },
          data: expect.objectContaining({
            status: SiteVisitItemOutcome.VISIT_DONE,
          }),
        })
      );

      // Parent visit update was NOT called (no premature completion)
      expect(prisma.siteVisit.update).not.toHaveBeenCalled();
    });
  });

  describe("confirmSiteVisitOwnerAvailability", () => {
    it("authorized telecaller confirms owner availability transitioning tentative visit to confirmed", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        status: SiteVisitStatus.TENTATIVE_AWAITING_OWNER,
      } as any);

      vi.mocked(prisma.siteVisit.update).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        status: SiteVisitStatus.CONFIRMED,
      } as any);

      const confirmedVisit = await confirmSiteVisitOwnerAvailability(telecallerContext, "visit-1");

      expect(prisma.siteVisit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "visit-1",
            tenantId: "tenant-broker-1",
          },
        })
      );

      expect(prisma.siteVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "visit-1" },
          data: {
            status: SiteVisitStatus.CONFIRMED,
          },
        })
      );
    });

    it("rejects confirmation if visit is already confirmed", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        status: SiteVisitStatus.CONFIRMED,
      } as any);

      await expect(
        confirmSiteVisitOwnerAvailability(telecallerContext, "visit-1")
      ).rejects.toThrow(ValidationError);
      expect(prisma.siteVisit.update).not.toHaveBeenCalled();
    });

    it("rejects confirmation of cancelled or completed visits", async () => {
      // Cancelled
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        status: SiteVisitStatus.CANCELLED,
      } as any);

      await expect(
        confirmSiteVisitOwnerAvailability(telecallerContext, "visit-1")
      ).rejects.toThrow(ValidationError);

      // Completed
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        status: SiteVisitStatus.COMPLETED,
      } as any);

      await expect(
        confirmSiteVisitOwnerAvailability(telecallerContext, "visit-1")
      ).rejects.toThrow(ValidationError);
    });

    it("rejects cross-tenant owner confirmation", async () => {
      // Not found in caller's tenant
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce(null);

      await expect(
        confirmSiteVisitOwnerAvailability(telecallerContext, "visit-cross-tenant")
      ).rejects.toThrow(NotFoundError);
      expect(prisma.siteVisit.update).not.toHaveBeenCalled();
    });

    it("denies unauthorized users (e.g. Sales Agent) from confirming owner availability", async () => {
      await expect(
        confirmSiteVisitOwnerAvailability(salesAgentContext, "visit-1")
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("confirmSiteVisit", () => {
    it("finalizes visit as COMPLETED and records telecaller confirmation audit", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        status: SiteVisitStatus.CONFIRMED,
        items: [
          { id: "item-1", status: SiteVisitItemOutcome.VISIT_DONE },
          { id: "item-2", status: SiteVisitItemOutcome.VISIT_NOT_DONE },
        ],
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

    it("rejects finalizing a visit that is still awaiting owner availability confirmation", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        status: SiteVisitStatus.TENTATIVE_AWAITING_OWNER,
        items: [{ id: "item-1", status: SiteVisitItemOutcome.VISIT_DONE }],
      } as any);

      await expect(
        confirmSiteVisit(telecallerContext, "visit-1")
      ).rejects.toThrow(ValidationError);
      expect(prisma.siteVisit.update).not.toHaveBeenCalled();
    });

    it("rejects finalizing a visit if any itinerary item remains pending outcome", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        status: SiteVisitStatus.CONFIRMED,
        items: [
          { id: "item-1", status: SiteVisitItemOutcome.VISIT_DONE },
          { id: "item-2", status: SiteVisitItemOutcome.PENDING }, // PENDING!
        ],
      } as any);

      await expect(
        confirmSiteVisit(telecallerContext, "visit-1")
      ).rejects.toThrow(ValidationError);
      expect(prisma.siteVisit.update).not.toHaveBeenCalled();
    });

    it("rejects finalizing a cancelled or already completed site visit", async () => {
      // Cancelled
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        status: SiteVisitStatus.CANCELLED,
        items: [{ id: "item-1", status: SiteVisitItemOutcome.VISIT_DONE }],
      } as any);

      await expect(
        confirmSiteVisit(telecallerContext, "visit-1")
      ).rejects.toThrow(ValidationError);

      // Completed
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        status: SiteVisitStatus.COMPLETED,
        items: [{ id: "item-1", status: SiteVisitItemOutcome.VISIT_DONE }],
      } as any);

      await expect(
        confirmSiteVisit(telecallerContext, "visit-1")
      ).rejects.toThrow(ValidationError);
    });

    it("rejects finalizing a site visit with no itinerary items", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-broker-1",
        status: SiteVisitStatus.CONFIRMED,
        items: [],
      } as any);

      await expect(
        confirmSiteVisit(telecallerContext, "visit-1")
      ).rejects.toThrow(ValidationError);
    });

    it("denies unprivileged roles from finalizing visits", async () => {
      await expect(
        confirmSiteVisit(salesAgentContext, "visit-1")
      ).rejects.toThrow(ForbiddenError);
    });

    it("synchronizes BuyerPropertyInterest on successful finalization (creates new interest when none exists)", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-sync-1",
        tenantId: "tenant-broker-1",
        leadId: "lead-1",
        status: SiteVisitStatus.CONFIRMED,
        items: [
          {
            id: "item-1",
            propertyId: "prop-1",
            status: SiteVisitItemOutcome.VISIT_DONE,
            buyerInterestLevel: BuyerInterestLevel.HIGH,
            buyerFeedback: "Loves the garden view and floor plan.",
          },
        ],
      } as any);

      vi.mocked(prisma.buyerPropertyInterest.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.buyerPropertyInterest.create).mockResolvedValueOnce({
        id: "bpi-1",
      } as any);

      vi.mocked(prisma.siteVisit.update).mockResolvedValueOnce({
        id: "visit-sync-1",
        status: SiteVisitStatus.COMPLETED,
        telecallerConfirmedByUserId: "user-telecaller-1",
      } as any);

      await confirmSiteVisit(telecallerContext, "visit-sync-1", "Showing was successful.");

      expect(prisma.buyerPropertyInterest.create).toHaveBeenCalledWith({
        data: {
          tenantId: "tenant-broker-1",
          leadId: "lead-1",
          propertyId: "prop-1",
          interestLevel: BuyerInterestLevel.HIGH,
          feedbackNotes: "Loves the garden view and floor plan.",
        },
      });
    });

    it("updates existing BuyerPropertyInterest rather than creating a duplicate", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-sync-2",
        tenantId: "tenant-broker-1",
        leadId: "lead-1",
        status: SiteVisitStatus.CONFIRMED,
        items: [
          {
            id: "item-1",
            propertyId: "prop-1",
            status: SiteVisitItemOutcome.VISIT_DONE,
            buyerInterestLevel: BuyerInterestLevel.MEDIUM,
            buyerFeedback: "Wants to negotiate price by 5%.",
          },
        ],
      } as any);

      vi.mocked(prisma.buyerPropertyInterest.findUnique).mockResolvedValueOnce({
        id: "existing-bpi-1",
        tenantId: "tenant-broker-1",
        leadId: "lead-1",
        propertyId: "prop-1",
        interestLevel: BuyerInterestLevel.LOW,
        feedbackNotes: "First visit was lukewarm.",
      } as any);

      vi.mocked(prisma.buyerPropertyInterest.update).mockResolvedValueOnce({
        id: "existing-bpi-1",
        interestLevel: BuyerInterestLevel.MEDIUM,
      } as any);

      vi.mocked(prisma.siteVisit.update).mockResolvedValueOnce({
        id: "visit-sync-2",
        status: SiteVisitStatus.COMPLETED,
      } as any);

      await confirmSiteVisit(telecallerContext, "visit-sync-2");

      expect(prisma.buyerPropertyInterest.update).toHaveBeenCalledWith({
        where: { id: "existing-bpi-1" },
        data: {
          interestLevel: BuyerInterestLevel.MEDIUM,
          feedbackNotes: "Wants to negotiate price by 5%.",
        },
      });
      expect(prisma.buyerPropertyInterest.create).not.toHaveBeenCalled();
    });

    it("synchronizes multiple properties in one itinerary independently", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-multi-prop",
        tenantId: "tenant-broker-1",
        leadId: "lead-1",
        status: SiteVisitStatus.CONFIRMED,
        items: [
          {
            id: "item-1",
            propertyId: "prop-1",
            status: SiteVisitItemOutcome.VISIT_DONE,
            buyerInterestLevel: BuyerInterestLevel.HIGH,
            buyerFeedback: "Top choice for buyer.",
          },
          {
            id: "item-2",
            propertyId: "prop-2",
            status: SiteVisitItemOutcome.VISIT_NOT_DONE,
            buyerInterestLevel: BuyerInterestLevel.NOT_INTERESTED,
            buyerFeedback: "Location too far from school.",
          },
        ],
      } as any);

      vi.mocked(prisma.buyerPropertyInterest.findUnique)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      vi.mocked(prisma.buyerPropertyInterest.create)
        .mockResolvedValueOnce({ id: "bpi-1" } as any)
        .mockResolvedValueOnce({ id: "bpi-2" } as any);

      vi.mocked(prisma.siteVisit.update).mockResolvedValueOnce({
        id: "visit-multi-prop",
        status: SiteVisitStatus.COMPLETED,
      } as any);

      await confirmSiteVisit(telecallerContext, "visit-multi-prop");

      expect(prisma.buyerPropertyInterest.create).toHaveBeenCalledWith({
        data: {
          tenantId: "tenant-broker-1",
          leadId: "lead-1",
          propertyId: "prop-1",
          interestLevel: BuyerInterestLevel.HIGH,
          feedbackNotes: "Top choice for buyer.",
        },
      });

      expect(prisma.buyerPropertyInterest.create).toHaveBeenCalledWith({
        data: {
          tenantId: "tenant-broker-1",
          leadId: "lead-1",
          propertyId: "prop-2",
          interestLevel: BuyerInterestLevel.NOT_INTERESTED,
          feedbackNotes: "Location too far from school.",
        },
      });
    });

    it("blocks finalization and feedback synchronization when any item remains pending", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-pending",
        tenantId: "tenant-broker-1",
        leadId: "lead-1",
        status: SiteVisitStatus.CONFIRMED,
        items: [
          { id: "item-1", propertyId: "prop-1", status: SiteVisitItemOutcome.VISIT_DONE },
          { id: "item-2", propertyId: "prop-2", status: SiteVisitItemOutcome.PENDING },
        ],
      } as any);

      await expect(
        confirmSiteVisit(telecallerContext, "visit-pending")
      ).rejects.toThrow(ValidationError);

      expect(prisma.siteVisit.update).not.toHaveBeenCalled();
      expect(prisma.buyerPropertyInterest.create).not.toHaveBeenCalled();
      expect(prisma.buyerPropertyInterest.update).not.toHaveBeenCalled();
    });

    it("recording outcome alone does not synchronize feedback into BuyerPropertyInterest", async () => {
      vi.mocked(prisma.siteVisitItem.findFirst).mockResolvedValueOnce({
        id: "item-1",
        siteVisitId: "visit-1",
        status: SiteVisitItemOutcome.PENDING,
        siteVisit: {
          id: "visit-1",
          tenantId: "tenant-broker-1",
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

      await recordVisitItemOutcome(salesAgentContext, "item-1", {
        status: SiteVisitItemOutcome.VISIT_DONE,
        buyerFeedback: "Loves it",
        buyerInterestLevel: BuyerInterestLevel.HIGH,
      });

      expect(prisma.siteVisitItem.update).toHaveBeenCalled();
      expect(prisma.buyerPropertyInterest.create).not.toHaveBeenCalled();
      expect(prisma.buyerPropertyInterest.update).not.toHaveBeenCalled();
    });

    it("rolls back the entire transaction if BuyerPropertyInterest synchronization fails", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-rollback",
        tenantId: "tenant-broker-1",
        leadId: "lead-1",
        status: SiteVisitStatus.CONFIRMED,
        items: [
          {
            id: "item-1",
            propertyId: "prop-1",
            status: SiteVisitItemOutcome.VISIT_DONE,
            buyerInterestLevel: BuyerInterestLevel.HIGH,
          },
        ],
      } as any);

      vi.mocked(prisma.siteVisit.update).mockResolvedValueOnce({
        id: "visit-rollback",
        status: SiteVisitStatus.COMPLETED,
      } as any);

      vi.mocked(prisma.buyerPropertyInterest.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.buyerPropertyInterest.create).mockRejectedValueOnce(
        new Error("Database connection dropped during sync")
      );

      await expect(
        confirmSiteVisit(telecallerContext, "visit-rollback")
      ).rejects.toThrow("Database connection dropped during sync");
    });

    it("strictly scopes feedback synchronization to tenant and rejects cross-tenant records", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce(null);

      await expect(
        confirmSiteVisit(telecallerContext, "cross-tenant-visit")
      ).rejects.toThrow(NotFoundError);

      expect(prisma.siteVisit.update).not.toHaveBeenCalled();
      expect(prisma.buyerPropertyInterest.create).not.toHaveBeenCalled();
      expect(prisma.buyerPropertyInterest.update).not.toHaveBeenCalled();
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
