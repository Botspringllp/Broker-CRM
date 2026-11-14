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
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    siteVisitItem: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    siteVisitAccessLink: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    siteVisitScheduleHistory: {
      create: vi.fn(),
    },
    buyerPropertyInterest: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
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
  generateSiteVisitToken,
  hashSiteVisitToken,
  verifySiteVisitTokenHash,
  isValidSiteVisitTokenFormat,
} from "@/server/tokens/site-visit-token";
import {
  createSiteVisitAccessLink,
  getSiteVisitByAccessToken,
  revokeSiteVisitAccessLink,
  recordVisitItemOutcomeViaToken,
  cancelSiteVisit,
  reassignSiteVisitAgent,
  rescheduleSiteVisit,
  confirmSiteVisit,
} from "@/server/dal/visits";
import { serializeBuyerSafeItinerary } from "@/server/dal/mappers";
import { checkRateLimit, resetRateLimit, clearRateLimitStore } from "@/server/security/rate-limiter";

describe("DV-12 Phase 4: Field Agent Mobile Token Access & Security", () => {
  const brokerContext: TenantContext = {
    tenantId: "tenant-apex-1",
    userId: "user-broker-1",
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-broker-1",
      name: "Vikram Broker",
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
    userId: "user-telecaller-1",
    role: UserRole.TELECALLER,
    user: {
      id: "user-telecaller-1",
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

  const unauthorizedAgentContext: TenantContext = {
    tenantId: "tenant-apex-1",
    userId: "user-sales-1",
    role: UserRole.FIELD_SALES_AGENT,
    user: {
      id: "user-sales-1",
      name: "Rahul Sales",
      email: "rahul@apexrealty.in",
      role: UserRole.FIELD_SALES_AGENT,
      tenantId: "tenant-apex-1",
      isActive: true,
    },
    session: {
      id: "sess-3",
      token: "tok-3",
      expiresAt: new Date(Date.now() + 86400000),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitStore();
  });

  // -----------------------------------------------------------------
  // 1. CRYPTOGRAPHIC TOKEN UTILITIES
  // -----------------------------------------------------------------
  describe("1. Cryptographic Token Utilities (site-visit-token.ts)", () => {
    it("generates a 64-character hexadecimal raw token and its SHA-256 hash", () => {
      const { rawToken, tokenHash } = generateSiteVisitToken();

      expect(typeof rawToken).toBe("string");
      expect(rawToken).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(rawToken)).toBe(true);

      expect(typeof tokenHash).toBe("string");
      expect(tokenHash).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(tokenHash)).toBe(true);
    });

    it("ensures each generated token is unique with 256 bits of entropy", () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const { rawToken } = generateSiteVisitToken();
        tokens.add(rawToken);
      }
      expect(tokens.size).toBe(50);
    });

    it("computes deterministic SHA-256 hashes matching Node crypto standards", () => {
      const { rawToken, tokenHash } = generateSiteVisitToken();
      const computed = hashSiteVisitToken(rawToken);
      expect(computed).toBe(tokenHash);
    });

    it("verifies matching raw token against stored hash using constant-time check", () => {
      const { rawToken, tokenHash } = generateSiteVisitToken();
      expect(verifySiteVisitTokenHash(rawToken, tokenHash)).toBe(true);
    });

    it("rejects altered or corrupted tokens against stored hash", () => {
      const { rawToken, tokenHash } = generateSiteVisitToken();
      const corrupted = rawToken.slice(0, 63) + (rawToken[63] === "a" ? "b" : "a");
      expect(verifySiteVisitTokenHash(corrupted, tokenHash)).toBe(false);
    });

    it("rejects malformed token strings during format check and hashing", () => {
      expect(isValidSiteVisitTokenFormat("")).toBe(false);
      expect(isValidSiteVisitTokenFormat("abc")).toBe(false);
      expect(isValidSiteVisitTokenFormat("g".repeat(64))).toBe(false); // non-hex
      expect(isValidSiteVisitTokenFormat(null)).toBe(false);
      expect(isValidSiteVisitTokenFormat(undefined)).toBe(false);

      expect(() => hashSiteVisitToken("short-token")).toThrow(ValidationError);
      expect(verifySiteVisitTokenHash("invalid", "invalid")).toBe(false);
    });
  });

  // -----------------------------------------------------------------
  // 2. RATE LIMITING & SECURITY INFRASTRUCTURE
  // -----------------------------------------------------------------
  describe("2. Rate Limiting Utility (rate-limiter.ts)", () => {
    it("allows requests under the rate limit threshold", () => {
      const ip = "192.168.1.100";
      const res1 = checkRateLimit(ip, { maxRequests: 3, windowMs: 10000 });
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(2);

      const res2 = checkRateLimit(ip, { maxRequests: 3, windowMs: 10000 });
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(1);
    });

    it("blocks requests that exceed the rate limit threshold", () => {
      const ip = "192.168.1.101";
      checkRateLimit(ip, { maxRequests: 2, windowMs: 10000 });
      checkRateLimit(ip, { maxRequests: 2, windowMs: 10000 });

      const blocked = checkRateLimit(ip, { maxRequests: 2, windowMs: 10000 });
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
    });

    it("isolates rate limit windows across distinct identifiers/IPs", () => {
      const ip1 = "10.0.0.1";
      const ip2 = "10.0.0.2";

      checkRateLimit(ip1, { maxRequests: 1, windowMs: 10000 });
      const blocked1 = checkRateLimit(ip1, { maxRequests: 1, windowMs: 10000 });
      expect(blocked1.allowed).toBe(false);

      const allowed2 = checkRateLimit(ip2, { maxRequests: 1, windowMs: 10000 });
      expect(allowed2.allowed).toBe(true);
    });
  });

  // -----------------------------------------------------------------
  // 3. ACCESS LINK CREATION IN THE DAL
  // -----------------------------------------------------------------
  describe("3. Access Link Creation (createSiteVisitAccessLink)", () => {
    it("generates a new mobile link with 24-hour post-visit expiry (DEC-M1-05)", async () => {
      const scheduledDate = new Date("2026-11-20T14:00:00Z");
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-1",
        tenantId: "tenant-apex-1",
        assignedSalesAgentId: "agent-1",
        scheduledDate,
        status: SiteVisitStatus.CONFIRMED,
        assignedSalesAgent: { id: "agent-1", isActive: true },
      });

      (prisma.siteVisitAccessLink.create as any).mockImplementation(({ data }: any) => ({
        id: "link-1",
        ...data,
      }));

      const res = await createSiteVisitAccessLink(telecallerContext, "visit-1");

      expect(res.rawToken).toHaveLength(64);
      expect(res.linkId).toBe("link-1");
      expect(res.mobileUrl).toBe(`/m/visits/${res.rawToken}`);

      // Expiry should be scheduledDate + 24 hours
      const expectedExpiry = new Date(scheduledDate.getTime() + 24 * 60 * 60 * 1000);
      expect(new Date(res.expiresAt).getTime()).toBe(expectedExpiry.getTime());

      // DB should store only hash
      expect((prisma.siteVisitAccessLink.create as any)).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: "tenant-apex-1",
            siteVisitId: "visit-1",
            salesAgentId: "agent-1",
            tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          }),
        })
      );
    });

    it("revokes existing active links before creating a fresh link (prevents duplicate active tokens)", async () => {
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-1",
        tenantId: "tenant-apex-1",
        assignedSalesAgentId: "agent-1",
        scheduledDate: new Date(),
        status: SiteVisitStatus.CONFIRMED,
        assignedSalesAgent: { id: "agent-1", isActive: true },
      });
      (prisma.siteVisitAccessLink.create as any).mockResolvedValue({
        id: "link-2",
        expiresAt: new Date(),
      });

      await createSiteVisitAccessLink(telecallerContext, "visit-1");

      expect((prisma.siteVisitAccessLink.updateMany as any)).toHaveBeenCalledWith({
        where: {
          siteVisitId: "visit-1",
          tenantId: "tenant-apex-1",
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });
    });

    it("rejects link generation if user lacks 'visits:schedule' permission", async () => {
      await expect(
        createSiteVisitAccessLink(unauthorizedAgentContext, "visit-1")
      ).rejects.toThrow(ForbiddenError);
    });

    it("rejects link generation for a cancelled site visit", async () => {
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-1",
        tenantId: "tenant-apex-1",
        status: SiteVisitStatus.CANCELLED,
        assignedSalesAgent: { id: "agent-1", isActive: true },
      });

      await expect(createSiteVisitAccessLink(telecallerContext, "visit-1")).rejects.toThrow(
        ValidationError
      );
    });

    it("rejects link generation for an already completed site visit", async () => {
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-1",
        tenantId: "tenant-apex-1",
        status: SiteVisitStatus.COMPLETED,
        assignedSalesAgent: { id: "agent-1", isActive: true },
      });

      await expect(createSiteVisitAccessLink(telecallerContext, "visit-1")).rejects.toThrow(
        ValidationError
      );
    });

    it("rejects link generation if assigned agent is inactive", async () => {
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-1",
        tenantId: "tenant-apex-1",
        status: SiteVisitStatus.CONFIRMED,
        assignedSalesAgent: { id: "agent-1", isActive: false },
      });

      await expect(createSiteVisitAccessLink(telecallerContext, "visit-1")).rejects.toThrow(
        ValidationError
      );
    });
  });

  // -----------------------------------------------------------------
  // 4. TOKEN RESOLUTION & VALIDATION (getSiteVisitByAccessToken)
  // -----------------------------------------------------------------
  describe("4. Token Resolution & Access Validation (getSiteVisitByAccessToken)", () => {
    const validRawToken = "a".repeat(64);
    const validHash = hashSiteVisitToken(validRawToken);

    const validMockVisit = {
      id: "visit-100",
      tenantId: "tenant-apex-1",
      scheduledDate: new Date("2026-11-20T10:00:00Z"),
      status: SiteVisitStatus.CONFIRMED,
      assignedSalesAgentId: "agent-100",
      lead: {
        id: "lead-1",
        name: "Arun Verma",
        primaryPhone: "9876543210",
        alternatePhone: "9876543211",
        email: "arun@example.com",
      },
      assignedSalesAgent: {
        id: "agent-100",
        name: "Siddharth Agent",
        email: "sid@apex.in",
        isActive: true,
      },
      items: [
        {
          id: "item-1",
          visitOrder: 1,
          status: SiteVisitItemOutcome.PENDING,
          property: {
            id: "prop-1",
            societyName: "Prestige Shantiniketan",
            localityName: "Whitefield",
            city: "Bengaluru",
            bedroomCount: 3,
            flatNumber: "Flat 402, Tower B",
            ownerName: "Deepak Sharma",
            ownerMobile: "9888877777",
            price: 15000000,
            area: 1650,
            propertyType: "Apartment",
            furnishingStatus: "Semi-Furnished",
            keyHolders: [
              {
                id: "kh-1",
                name: "Ramesh Guard",
                mobile: "9111122222",
                persona: "GUARD",
                notes: "Available at main gate",
              },
            ],
            media: [
              { id: "media-1", url: "/api/media/m1.jpg", caption: "Living Room", displayOrder: 1 },
            ],
          },
        },
      ],
      scheduleHistories: [],
      accessLinks: [],
    };

    it("resolves site visit with complete contacts and photos for valid bearer token", async () => {
      (prisma.siteVisitAccessLink.findUnique as any).mockResolvedValue({
        id: "link-1",
        tenantId: "tenant-apex-1",
        salesAgentId: "agent-100",
        expiresAt: new Date(Date.now() + 3600000), // 1 hour in future
        isRevoked: false,
        tenant: { id: "tenant-apex-1", name: "Apex Realty", isActive: true },
        salesAgent: { id: "agent-100", name: "Siddharth Agent", email: "sid@apex.in", isActive: true },
        siteVisit: validMockVisit,
      });
      (prisma.siteVisitAccessLink.update as any).mockResolvedValue({});

      const res = await getSiteVisitByAccessToken(validRawToken);

      expect(res.visit.id).toBe("visit-100");
      expect(res.visit.buyerName).toBe("Arun Verma");
      expect(res.visit.buyerPhone).toBe("9876543210");
      expect(res.visit.buyerAlternatePhone).toBe("9876543211");
      expect(res.visit.buyerEmail).toBe("arun@example.com");

      // Verify item details
      const item = res.visit.items[0];
      expect(item.propertyTitle).toBe("3 BHK Prestige Shantiniketan");
      expect(item.flatNumber).toBe("Flat 402, Tower B");
      expect(item.ownerName).toBe("Deepak Sharma");
      expect(item.ownerMobile).toBe("9888877777");
      expect(item.keyHolder.name).toBe("Ramesh Guard");
      expect(item.keyHolder.persona).toBe("Guard");
      expect(item.photos).toHaveLength(1);
      expect(item.photos![0].caption).toBe("Living Room");

      // Verify accessedAt update
      expect((prisma.siteVisitAccessLink.update as any)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "link-1" },
          data: { accessedAt: expect.any(Date) },
        })
      );
    });

    it("rejects expired tokens (DEC-M1-05)", async () => {
      (prisma.siteVisitAccessLink.findUnique as any).mockResolvedValue({
        id: "link-expired",
        expiresAt: new Date(Date.now() - 10000), // in the past
        isRevoked: false,
        tenant: { isActive: true },
        salesAgent: { isActive: true },
        siteVisit: validMockVisit,
      });

      await expect(getSiteVisitByAccessToken(validRawToken)).rejects.toThrow(ForbiddenError);
    });

    it("rejects revoked tokens", async () => {
      (prisma.siteVisitAccessLink.findUnique as any).mockResolvedValue({
        id: "link-revoked",
        expiresAt: new Date(Date.now() + 3600000),
        isRevoked: true,
        tenant: { isActive: true },
        salesAgent: { isActive: true },
        siteVisit: validMockVisit,
      });

      await expect(getSiteVisitByAccessToken(validRawToken)).rejects.toThrow(ForbiddenError);
    });

    it("rejects tokens for deactivated tenants", async () => {
      (prisma.siteVisitAccessLink.findUnique as any).mockResolvedValue({
        id: "link-1",
        expiresAt: new Date(Date.now() + 3600000),
        isRevoked: false,
        tenant: { isActive: false }, // inactive
        salesAgent: { isActive: true },
        siteVisit: validMockVisit,
      });

      await expect(getSiteVisitByAccessToken(validRawToken)).rejects.toThrow(ForbiddenError);
    });

    it("rejects tokens when assigned sales agent was reassigned to another agent", async () => {
      (prisma.siteVisitAccessLink.findUnique as any).mockResolvedValue({
        id: "link-1",
        salesAgentId: "agent-100",
        expiresAt: new Date(Date.now() + 3600000),
        isRevoked: false,
        tenant: { isActive: true },
        salesAgent: { id: "agent-100", isActive: true },
        siteVisit: {
          ...validMockVisit,
          assignedSalesAgentId: "agent-DIFFERENT", // reassigned!
        },
      });

      await expect(getSiteVisitByAccessToken(validRawToken)).rejects.toThrow(ForbiddenError);
    });

    it("rejects tokens for cancelled site visits", async () => {
      (prisma.siteVisitAccessLink.findUnique as any).mockResolvedValue({
        id: "link-1",
        salesAgentId: "agent-100",
        expiresAt: new Date(Date.now() + 3600000),
        isRevoked: false,
        tenant: { isActive: true },
        salesAgent: { id: "agent-100", isActive: true },
        siteVisit: {
          ...validMockVisit,
          status: SiteVisitStatus.CANCELLED,
        },
      });

      await expect(getSiteVisitByAccessToken(validRawToken)).rejects.toThrow(ForbiddenError);
    });
  });

  // -----------------------------------------------------------------
  // 5. LIFECYCLE REVOCATION TRIGGERS
  // -----------------------------------------------------------------
  describe("5. Lifecycle Revocation Triggers (Visits DAL)", () => {
    it("cancelSiteVisit revokes all active links in the transaction", async () => {
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-1",
        tenantId: "tenant-apex-1",
        scheduledDate: new Date(),
        status: SiteVisitStatus.CONFIRMED,
        lead: { id: "l-1", name: "Lead", primaryPhone: "123" },
        assignedSalesAgent: { id: "a-1", name: "Agent", email: "a@a.com" },
        items: [],
      });
      (prisma.siteVisitScheduleHistory.create as any).mockResolvedValue({});
      (prisma.siteVisit.update as any).mockResolvedValue({
        id: "visit-1",
        status: SiteVisitStatus.CANCELLED,
        lead: { id: "l-1", name: "Lead", primaryPhone: "123" },
        assignedSalesAgent: { id: "a-1", name: "Agent", email: "a@a.com" },
        items: [],
      });

      await cancelSiteVisit(telecallerContext, {
        visitId: "visit-1",
        reason: "Owner unavailable",
      });

      expect((prisma.siteVisitAccessLink.updateMany as any)).toHaveBeenCalledWith({
        where: {
          siteVisitId: "visit-1",
          tenantId: "tenant-apex-1",
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });
    });

    it("reassignSiteVisitAgent revokes previous agent active links in transaction", async () => {
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-1",
        tenantId: "tenant-apex-1",
        assignedSalesAgentId: "old-agent",
        lead: { id: "l-1", name: "Lead", primaryPhone: "123" },
        assignedSalesAgent: { id: "old-agent", name: "Old Agent", email: "old@a.com" },
        items: [],
      });
      (prisma.user.findFirst as any).mockResolvedValue({
        id: "new-agent",
        name: "New Agent",
        isActive: true,
      });
      (prisma.siteVisit.update as any).mockResolvedValue({
        id: "visit-1",
        assignedSalesAgentId: "new-agent",
        lead: { id: "l-1", name: "Lead", primaryPhone: "123" },
        assignedSalesAgent: { id: "new-agent", name: "New Agent", email: "new@a.com" },
        items: [],
      });

      await reassignSiteVisitAgent(telecallerContext, {
        visitId: "visit-1",
        newSalesAgentId: "new-agent",
        reason: "Old agent on leave",
      });

      expect((prisma.siteVisitAccessLink.updateMany as any)).toHaveBeenCalledWith({
        where: {
          siteVisitId: "visit-1",
          tenantId: "tenant-apex-1",
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });
    });

    it("rescheduleSiteVisit revokes existing links in transaction", async () => {
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-1",
        tenantId: "tenant-apex-1",
        scheduledDate: new Date("2026-11-20T10:00:00Z"),
        status: SiteVisitStatus.CONFIRMED,
        lead: { id: "l-1", name: "Lead", primaryPhone: "123" },
        assignedSalesAgent: { id: "a-1", name: "Agent", email: "a@a.com" },
        items: [],
      });
      (prisma.siteVisitScheduleHistory.create as any).mockResolvedValue({});
      (prisma.siteVisit.update as any).mockResolvedValue({
        id: "visit-1",
        scheduledDate: new Date("2026-11-22T10:00:00Z"),
        status: SiteVisitStatus.CONFIRMED,
        lead: { id: "l-1", name: "Lead", primaryPhone: "123" },
        assignedSalesAgent: { id: "a-1", name: "Agent", email: "a@a.com" },
        items: [],
      });

      await rescheduleSiteVisit(telecallerContext, {
        visitId: "visit-1",
        newScheduledDate: "2026-11-22T10:00:00Z",
        reason: "Buyer requested Sunday slot",
      });

      expect((prisma.siteVisitAccessLink.updateMany as any)).toHaveBeenCalledWith({
        where: {
          siteVisitId: "visit-1",
          tenantId: "tenant-apex-1",
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });
    });

    it("confirmSiteVisit (completion) revokes active links in transaction", async () => {
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-1",
        tenantId: "tenant-apex-1",
        status: SiteVisitStatus.CONFIRMED,
        leadId: "lead-1",
        lead: { id: "lead-1", name: "Lead", primaryPhone: "123" },
        assignedSalesAgent: { id: "a-1", name: "Agent", email: "a@a.com" },
        items: [
          {
            id: "item-1",
            propertyId: "p-1",
            status: SiteVisitItemOutcome.VISIT_DONE,
            agentTextNotes: "Great unit",
            buyerInterestLevel: BuyerInterestLevel.HIGH,
            property: {
              id: "p-1",
              societyName: "Prestige",
              localityName: "Whitefield",
              city: "BLR",
              bedroomCount: 2,
              flatNumber: "101",
              ownerName: "Owner",
              ownerMobile: "123",
            },
          },
        ],
      });
      (prisma.siteVisit.update as any).mockResolvedValue({
        id: "visit-1",
        status: SiteVisitStatus.COMPLETED,
        lead: { id: "lead-1", name: "Lead", primaryPhone: "123" },
        assignedSalesAgent: { id: "a-1", name: "Agent", email: "a@a.com" },
        items: [],
      });
      (prisma.buyerPropertyInterest.findUnique as any).mockResolvedValue(null);
      (prisma.buyerPropertyInterest.create as any).mockResolvedValue({});

      await confirmSiteVisit(telecallerContext, "visit-1", "Telecaller approved");

      expect((prisma.siteVisitAccessLink.updateMany as any)).toHaveBeenCalledWith({
        where: {
          siteVisitId: "visit-1",
          tenantId: "tenant-apex-1",
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });
    });
  });

  // -----------------------------------------------------------------
  // 6. TOKEN OUTCOME SUBMISSION (recordVisitItemOutcomeViaToken)
  // -----------------------------------------------------------------
  describe("6. Token Outcome Submission (recordVisitItemOutcomeViaToken)", () => {
    const rawToken = "b".repeat(64);
    const mockLink = {
      id: "link-token-1",
      salesAgentId: "agent-sales-1",
      tenantId: "tenant-apex-1",
      expiresAt: new Date(Date.now() + 3600000),
      isRevoked: false,
      tenant: { id: "tenant-apex-1", isActive: true, name: "Apex" },
      salesAgent: { id: "agent-sales-1", name: "Rahul Sales", isActive: true },
      siteVisit: {
        id: "visit-tok-1",
        status: SiteVisitStatus.CONFIRMED,
        scheduledDate: new Date(),
        assignedSalesAgentId: "agent-sales-1",
        lead: { id: "l-1", name: "Lead Buyer", primaryPhone: "9998887777" },
        assignedSalesAgent: { id: "agent-sales-1", name: "Rahul Sales", email: "rahul@apex.in" },
        items: [],
        scheduleHistories: [],
        accessLinks: [],
      },
    };

    it("submits VISIT_DONE with dual-identity audit: channel=FIELD_AGENT_DIRECT, reportedBy=salesAgent, enteredBy=salesAgent", async () => {
      (prisma.siteVisitAccessLink.findUnique as any).mockResolvedValue(mockLink);
      (prisma.siteVisitItem.findFirst as any).mockResolvedValue({
        id: "item-1",
        siteVisitId: "visit-tok-1",
        tenantId: "tenant-apex-1",
      });
      (prisma.siteVisitItem.update as any).mockResolvedValue({});
      (prisma.siteVisitAccessLink.update as any).mockResolvedValue({});

      await recordVisitItemOutcomeViaToken(rawToken, "item-1", {
        status: SiteVisitItemOutcome.VISIT_DONE,
        agentTextNotes: "Customer loved the high ceiling and parking space.",
        buyerFeedback: "Wants to check financing options next week.",
        buyerInterestLevel: BuyerInterestLevel.HIGH,
      });

      expect((prisma.siteVisitItem.update as any)).toHaveBeenCalledWith({
        where: { id: "item-1" },
        data: expect.objectContaining({
          status: SiteVisitItemOutcome.VISIT_DONE,
          agentTextNotes: "Customer loved the high ceiling and parking space.",
          buyerFeedback: "Wants to check financing options next week.",
          buyerInterestLevel: BuyerInterestLevel.HIGH,
          reportedByUserId: "agent-sales-1",
          enteredByUserId: "agent-sales-1",
          entryChannel: VisitOutcomeEntryChannel.FIELD_AGENT_DIRECT,
          reportedOutcomeAt: expect.any(Date),
        }),
      });
    });

    it("submits VISIT_NOT_DONE with notes correctly", async () => {
      (prisma.siteVisitAccessLink.findUnique as any).mockResolvedValue(mockLink);
      (prisma.siteVisitItem.findFirst as any).mockResolvedValue({
        id: "item-2",
        siteVisitId: "visit-tok-1",
        tenantId: "tenant-apex-1",
      });
      (prisma.siteVisitItem.update as any).mockResolvedValue({});
      (prisma.siteVisitAccessLink.update as any).mockResolvedValue({});

      await recordVisitItemOutcomeViaToken(rawToken, "item-2", {
        status: SiteVisitItemOutcome.VISIT_NOT_DONE,
        agentTextNotes: "Keyholder was not available at site.",
      });

      expect((prisma.siteVisitItem.update as any)).toHaveBeenCalledWith({
        where: { id: "item-2" },
        data: expect.objectContaining({
          status: SiteVisitItemOutcome.VISIT_NOT_DONE,
          agentTextNotes: "Keyholder was not available at site.",
          entryChannel: VisitOutcomeEntryChannel.FIELD_AGENT_DIRECT,
        }),
      });
    });

    it("rejects outcome submission for an item ID belonging to a different visit", async () => {
      (prisma.siteVisitAccessLink.findUnique as any).mockResolvedValue(mockLink);
      // Item NOT found in this visit/tenant
      (prisma.siteVisitItem.findFirst as any).mockResolvedValue(null);

      await expect(
        recordVisitItemOutcomeViaToken(rawToken, "item-UNAUTHORIZED-CROSS-VISIT", {
          status: SiteVisitItemOutcome.VISIT_DONE,
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects outcome submission if visit is already completed (locked editing)", async () => {
      (prisma.siteVisitAccessLink.findUnique as any).mockResolvedValue({
        ...mockLink,
        siteVisit: {
          ...mockLink.siteVisit,
          status: SiteVisitStatus.COMPLETED,
        },
      });

      await expect(
        recordVisitItemOutcomeViaToken(rawToken, "item-1", {
          status: SiteVisitItemOutcome.VISIT_DONE,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("validates voice note URL length and duration if provided", async () => {
      (prisma.siteVisitAccessLink.findUnique as any).mockResolvedValue(mockLink);
      (prisma.siteVisitItem.findFirst as any).mockResolvedValue({
        id: "item-1",
        siteVisitId: "visit-tok-1",
        tenantId: "tenant-apex-1",
      });

      // Invalid negative duration
      await expect(
        recordVisitItemOutcomeViaToken(rawToken, "item-1", {
          status: SiteVisitItemOutcome.VISIT_DONE,
          voiceNoteUrl: "/storage/voice/vn1.m4a",
          voiceNoteDurationSeconds: -10,
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  // -----------------------------------------------------------------
  // 7. BUYER CONFIDENTIALITY SERIALIZER
  // -----------------------------------------------------------------
  describe("7. Buyer Confidentiality Serializer (serializeBuyerSafeItinerary)", () => {
    it("strictly strips flatNumber, ownerName, ownerMobile, and keyHolders from buyer view (PRD §7.2)", () => {
      const fullVisit: any = {
        id: "visit-99",
        scheduledDate: new Date("2026-11-20T10:00:00Z"),
        status: SiteVisitStatus.CONFIRMED,
        lead: { id: "l-1", name: "Ananya Iyer", primaryPhone: "9876543210" },
        items: [
          {
            visitOrder: 1,
            property: {
              id: "prop-99",
              societyName: "Brigade Gateway",
              localityName: "Malleshwaram",
              city: "Bengaluru",
              bedroomCount: 2,
              flatNumber: "Flat 1204, Tower 3", // PRIVATE UNIT NUMBER
              ownerName: "Secret Owner Name",   // PRIVATE OWNER NAME
              ownerMobile: "9999988888",         // PRIVATE OWNER PHONE
              keyHolders: [
                { name: "Private Guard", mobile: "9888811111", persona: "GUARD" },
              ],
              price: 12000000,
              area: 1250,
              propertyType: "Apartment",
              furnishingStatus: "Furnished",
              amenities: ["Gym", "Pool"],
              media: [{ id: "m1", url: "/photos/b1.jpg", caption: "Balcony" }],
            },
          },
        ],
      };

      const buyerSafe = serializeBuyerSafeItinerary(fullVisit);

      expect(buyerSafe.buyerName).toBe("Ananya Iyer");
      expect(buyerSafe.properties).toHaveLength(1);

      const prop = buyerSafe.properties[0];
      expect(prop.societyName).toBe("Brigade Gateway");
      expect(prop.locality).toBe("Malleshwaram");
      expect(prop.priceFormatted).toBe("₹1,20,00,000");
      expect(prop.photos).toHaveLength(1);

      // Verify privacy boundary assertions
      expect((prop as any).flatNumber).toBeUndefined();
      expect((prop as any).ownerName).toBeUndefined();
      expect((prop as any).ownerMobile).toBeUndefined();
      expect((prop as any).keyHolders).toBeUndefined();
      expect((prop as any).keyHolder).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------
  // 8. SCHEDULE-ANCHORED EXPIRY & COMPLETION REVOCATION AUDIT TESTS
  // -----------------------------------------------------------------
  describe("8. Schedule-Anchored Expiry & Completion Revocation Audit", () => {
    it("calculates expiry anchored to scheduled visit tomorrow + 24 hours (not token creation time)", async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-tomorrow",
        tenantId: "tenant-apex-1",
        assignedSalesAgentId: "agent-1",
        scheduledDate: tomorrow,
        status: SiteVisitStatus.CONFIRMED,
        assignedSalesAgent: { id: "agent-1", isActive: true },
      });

      (prisma.siteVisitAccessLink.create as any).mockImplementation(({ data }: any) => ({
        id: "link-tomorrow",
        ...data,
      }));

      const res = await createSiteVisitAccessLink(telecallerContext, "visit-tomorrow");

      const expectedExpiry = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
      expect(new Date(res.expiresAt).getTime()).toBe(expectedExpiry.getTime());
      // Must be roughly 48 hours from now
      expect(new Date(res.expiresAt).getTime() - Date.now()).toBeGreaterThan(47 * 60 * 60 * 1000);
    });

    it("calculates expiry anchored to scheduled visit 5 days later + 24 hours", async () => {
      const fiveDaysLater = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-5days",
        tenantId: "tenant-apex-1",
        assignedSalesAgentId: "agent-1",
        scheduledDate: fiveDaysLater,
        status: SiteVisitStatus.CONFIRMED,
        assignedSalesAgent: { id: "agent-1", isActive: true },
      });

      (prisma.siteVisitAccessLink.create as any).mockImplementation(({ data }: any) => ({
        id: "link-5days",
        ...data,
      }));

      const res = await createSiteVisitAccessLink(telecallerContext, "visit-5days");

      const expectedExpiry = new Date(fiveDaysLater.getTime() + 24 * 60 * 60 * 1000);
      expect(new Date(res.expiresAt).getTime()).toBe(expectedExpiry.getTime());
      // Must be roughly 6 days from now
      expect(new Date(res.expiresAt).getTime() - Date.now()).toBeGreaterThan(5.9 * 24 * 60 * 60 * 1000);
    });

    it("rejects access link creation if the visit schedule + 24h validity has already elapsed", async () => {
      // Scheduled 3 days ago
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-past",
        tenantId: "tenant-apex-1",
        assignedSalesAgentId: "agent-1",
        scheduledDate: threeDaysAgo,
        status: SiteVisitStatus.CONFIRMED,
        assignedSalesAgent: { id: "agent-1", isActive: true },
      });

      await expect(
        createSiteVisitAccessLink(telecallerContext, "visit-past")
      ).rejects.toThrow(ValidationError);
    });

    it("rescheduling revokes previous link atomically and recalculates expiry for the new schedule", async () => {
      const originalDate = new Date("2026-11-20T10:00:00Z");
      const rescheduledDate = new Date("2026-11-25T15:00:00Z");

      // Mock visit for rescheduling
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-resched",
        tenantId: "tenant-apex-1",
        scheduledDate: originalDate,
        status: SiteVisitStatus.CONFIRMED,
        assignedSalesAgentId: "agent-1",
        assignedSalesAgent: { id: "agent-1", isActive: true },
      });

      (prisma.siteVisit.update as any).mockImplementation(({ data }: any) => ({
        id: "visit-resched",
        tenantId: "tenant-apex-1",
        scheduledDate: data.scheduledDate,
        status: SiteVisitStatus.CONFIRMED,
        assignedSalesAgentId: "agent-1",
      }));

      // 1. Perform reschedule
      await rescheduleSiteVisit(telecallerContext, {
        visitId: "visit-resched",
        newScheduledDate: rescheduledDate.toISOString(),
        reason: "Buyer requested postponement to next week",
      });

      // Verify old links were atomically revoked in transaction
      expect((prisma.siteVisitAccessLink.updateMany as any)).toHaveBeenCalledWith({
        where: {
          siteVisitId: "visit-resched",
          tenantId: "tenant-apex-1",
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });

      // 2. Generate new link after reschedule
      (prisma.siteVisit.findFirst as any).mockResolvedValue({
        id: "visit-resched",
        tenantId: "tenant-apex-1",
        scheduledDate: rescheduledDate,
        status: SiteVisitStatus.CONFIRMED,
        assignedSalesAgentId: "agent-1",
        assignedSalesAgent: { id: "agent-1", isActive: true },
      });

      (prisma.siteVisitAccessLink.create as any).mockImplementation(({ data }: any) => ({
        id: "link-new-schedule",
        ...data,
      }));

      const newLinkRes = await createSiteVisitAccessLink(telecallerContext, "visit-resched");

      // Verify new expiry is anchored to the new scheduled date + 24 hours
      const expectedNewExpiry = new Date(rescheduledDate.getTime() + 24 * 60 * 60 * 1000);
      expect(new Date(newLinkRes.expiresAt).getTime()).toBe(expectedNewExpiry.getTime());
    });

    it("confirmSiteVisit atomically revokes active access links and locks token outcome reporting", async () => {
      const visitMock = {
        id: "visit-to-confirm",
        tenantId: "tenant-apex-1",
        leadId: "lead-1",
        status: SiteVisitStatus.CONFIRMED,
        items: [
          {
            id: "item-done-1",
            propertyId: "prop-1",
            status: SiteVisitItemOutcome.VISIT_DONE,
            buyerInterestLevel: BuyerInterestLevel.HIGH,
            buyerFeedback: "Interested in making an offer",
            agentTextNotes: "Great showing",
          },
        ],
      };

      (prisma.siteVisit.findFirst as any).mockResolvedValue(visitMock);
      (prisma.siteVisit.update as any).mockResolvedValue({
        ...visitMock,
        status: SiteVisitStatus.COMPLETED,
      });

      // Confirm the site visit
      await confirmSiteVisit(telecallerContext, "visit-to-confirm", "Telecaller approved finalization");

      // Verify active access links were atomically revoked in transaction
      expect((prisma.siteVisitAccessLink.updateMany as any)).toHaveBeenCalledWith({
        where: {
          siteVisitId: "visit-to-confirm",
          tenantId: "tenant-apex-1",
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });

      // Verify token outcome submission on finalized visit is rejected
      const rawToken = "b".repeat(64);
      const tokenHash = hashSiteVisitToken(rawToken);

      (prisma.siteVisitAccessLink.findUnique as any).mockResolvedValue({
        id: "link-revoked-on-confirm",
        tokenHash,
        expiresAt: new Date(Date.now() + 86400000),
        isRevoked: true, // revoked upon finalization
        tenant: { id: "tenant-apex-1", isActive: true },
        salesAgent: { id: "agent-1", isActive: true },
        siteVisit: {
          id: "visit-to-confirm",
          status: SiteVisitStatus.COMPLETED,
          assignedSalesAgentId: "agent-1",
        },
      });

      await expect(
        recordVisitItemOutcomeViaToken(rawToken, "item-done-1", {
          status: SiteVisitItemOutcome.VISIT_DONE,
          agentTextNotes: "Attempting to change outcome after completion",
        })
      ).rejects.toThrow("Cannot modify outcomes for an already finalized site visit");

      // Verify token resolution provides clear completion feedback
      await expect(
        getSiteVisitByAccessToken(rawToken)
      ).rejects.toThrow("This site visit has already been finalized and completed");
    });
  });
});
