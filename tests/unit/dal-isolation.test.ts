import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole, SiteVisitItemOutcome } from "@prisma/client";
import { TenantContext, NotFoundError, ForbiddenError } from "@/server/tenant-context";

// Mock Prisma DB module
vi.mock("@/server/db", () => ({
  prisma: {
    property: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    lead: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    siteVisit: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    siteVisitItem: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/server/db";
import { listProperties, getPropertyById, updateProperty } from "@/server/dal/properties";
import { listLeads, getLeadById, updateLead } from "@/server/dal/leads";
import { listSiteVisits, getSiteVisitById, recordVisitItemOutcome } from "@/server/dal/visits";

describe("Tenant Data Access Layer (DAL) Isolation & Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const apexContext: TenantContext = {
    userId: "user-pooja",
    tenantId: "tenant-apex",
    role: UserRole.TELECALLER,
    user: {
      id: "user-pooja",
      email: "pooja@apex.in",
      name: "Pooja Sharma",
      role: UserRole.TELECALLER,
      tenantId: "tenant-apex",
      isActive: true,
    },
    session: {
      id: "sess-apex",
      token: "tok-apex",
      expiresAt: new Date(),
    },
  };

  const horizonContext: TenantContext = {
    userId: "user-rahul",
    tenantId: "tenant-horizon",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-rahul",
      email: "rahul@horizon.in",
      name: "Rahul Verma",
      role: UserRole.BROKER_OWNER,
      tenantId: "tenant-horizon",
      isActive: true,
    },
    session: {
      id: "sess-horizon",
      token: "tok-horizon",
      expiresAt: new Date(),
    },
  };

  describe("Property DAL Isolation", () => {
    it("always enforces tenantId filter in listProperties", async () => {
      vi.mocked(prisma.property.findMany).mockResolvedValueOnce([]);

      await listProperties(apexContext);

      expect(prisma.property.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-apex",
          }),
        })
      );
    });

    it("prevents unauthorized roles from listing properties", async () => {
      const fieldAgentContext: TenantContext = {
        ...apexContext,
        role: UserRole.FIELD_SALES_AGENT,
      };

      await expect(listProperties(fieldAgentContext)).rejects.toThrow(ForbiddenError);
      expect(prisma.property.findMany).not.toHaveBeenCalled();
    });

    it("throws NotFoundError when reading another tenant's property (anti-enumeration)", async () => {
      // Simulate database finding nothing because property belongs to tenant-horizon, not tenant-apex
      vi.mocked(prisma.property.findFirst).mockResolvedValueOnce(null);

      await expect(getPropertyById(apexContext, "prop-foreign-999")).rejects.toThrow(NotFoundError);

      expect(prisma.property.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "prop-foreign-999",
            tenantId: "tenant-apex", // Verified tenant scope query
          },
        })
      );
    });

    it("uses compound unique key id_tenantId for atomic updates", async () => {
      // 1. getPropertyById succeeds for tenant
      vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
        id: "prop-apex-1",
        tenantId: "tenant-apex",
      } as unknown as Awaited<ReturnType<typeof prisma.property.findFirst>>);

      // 2. update succeeds
      vi.mocked(prisma.property.update).mockResolvedValueOnce({
        id: "prop-apex-1",
        tenantId: "tenant-apex",
      } as unknown as Awaited<ReturnType<typeof prisma.property.update>>);

      await updateProperty(apexContext, "prop-apex-1", {
        price: 9500000,
      });

      expect(prisma.property.update).toHaveBeenCalledWith({
        where: {
          id_tenantId: {
            id: "prop-apex-1",
            tenantId: "tenant-apex", // Atomic tenant scope check
          },
        },
        data: { price: 9500000 },
      });
    });
  });

  describe("Lead DAL Isolation & Role Scoping", () => {
    it("restricts telecallers to assigned leads while scoping to tenant", async () => {
      vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([]);

      await listLeads(apexContext);

      expect(prisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-apex",
            assignedTelecallerId: "user-pooja", // Auto-scoped for telecaller
          }),
        })
      );
    });

    it("allows Broker Owner to view all leads within their tenant", async () => {
      vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([]);

      await listLeads(horizonContext);

      expect(prisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: "tenant-horizon", // Scoped to horizon tenant without telecaller restriction
          },
        })
      );
    });

    it("throws NotFoundError when reading another tenant's lead (anti-enumeration)", async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null);

      await expect(getLeadById(apexContext, "lead-foreign-999")).rejects.toThrow(NotFoundError);

      expect(prisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "lead-foreign-999",
            tenantId: "tenant-apex",
          }),
        })
      );
    });

    it("rejects cross-tenant lead mutations", async () => {
      // User from Horizon attempts to mutate a lead in Apex
      vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null);

      await expect(
        updateLead(horizonContext, "lead-apex-1", { name: "Hacked" })
      ).rejects.toThrow(NotFoundError);

      expect(prisma.lead.update).not.toHaveBeenCalled();
    });
  });

  describe("Site Visits DAL Isolation & Dual-Identity Audit", () => {
    it("throws NotFoundError when reading another tenant's site visit", async () => {
      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce(null);

      await expect(getSiteVisitById(apexContext, "visit-foreign-999")).rejects.toThrow(
        NotFoundError
      );

      expect(prisma.siteVisit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "visit-foreign-999",
            tenantId: "tenant-apex",
          },
        })
      );
    });

    it("restricts Field Sales Agents to their assigned visits", async () => {
      const fieldAgentContext: TenantContext = {
        userId: "agent-vikram",
        tenantId: "tenant-apex",
        role: UserRole.FIELD_SALES_AGENT,
        user: {
          id: "agent-vikram",
          email: "vikram@apex.in",
          name: "Vikram Malhotra",
          role: UserRole.FIELD_SALES_AGENT,
          tenantId: "tenant-apex",
          isActive: true,
        },
        session: {
          id: "sess-vikram",
          token: "tok-vikram",
          expiresAt: new Date(),
        },
      };

      vi.mocked(prisma.siteVisit.findMany).mockResolvedValueOnce([]);

      await listSiteVisits(fieldAgentContext);

      expect(prisma.siteVisit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: "tenant-apex",
            assignedSalesAgentId: "agent-vikram", // Scoped strictly to field agent
          },
        })
      );
    });

    it("enforces tenant boundary and dual-identity audit on outcome entry", async () => {
      // Telecaller entering outcome on behalf of field agent
      vi.mocked(prisma.siteVisitItem.findFirst).mockResolvedValueOnce({
        id: "item-1",
        tenantId: "tenant-apex",
        siteVisitId: "visit-1",
        siteVisit: {
          id: "visit-1",
          assignedSalesAgentId: "agent-vikram",
        },
      } as unknown as Awaited<ReturnType<typeof prisma.siteVisitItem.findFirst>>);

      vi.mocked(prisma.siteVisitItem.update).mockResolvedValueOnce({
        id: "item-1",
      } as unknown as Awaited<ReturnType<typeof prisma.siteVisitItem.update>>);

      vi.mocked(prisma.siteVisit.findFirst).mockResolvedValueOnce({
        id: "visit-1",
        tenantId: "tenant-apex",
      } as unknown as Awaited<ReturnType<typeof prisma.siteVisit.findFirst>>);

      await recordVisitItemOutcome(apexContext, "item-1", {
        status: SiteVisitItemOutcome.VISIT_DONE,
        agentTextNotes: "Buyer liked the terrace.",
        reportedByUserId: "agent-vikram",
      });

      expect(prisma.siteVisitItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "item-1" },
          data: expect.objectContaining({
            status: SiteVisitItemOutcome.VISIT_DONE,
            reportedByUserId: "agent-vikram",
            enteredByUserId: "user-pooja", // Telecaller entering data
          }),
        })
      );
    });

    it("rejects visit outcome recording for items belonging to another tenant", async () => {
      vi.mocked(prisma.siteVisitItem.findFirst).mockResolvedValueOnce(null);

      await expect(
        recordVisitItemOutcome(horizonContext, "item-foreign", {
          status: SiteVisitItemOutcome.VISIT_NOT_DONE,
        })
      ).rejects.toThrow(NotFoundError);

      expect(prisma.siteVisitItem.update).not.toHaveBeenCalled();
    });
  });
});
