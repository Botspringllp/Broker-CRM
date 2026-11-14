/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole, LeadStatus, Prisma } from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ValidationError, ForbiddenError } from "@/server/errors";

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
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    locality: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    leadRequirementLocality: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
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
  getVerifiedLocalities,
  validateAreaRequirements,
  confirmLeadRequirements,
  updateLead,
} from "@/server/dal/leads";
import { mapPrismaLeadToView } from "@/server/dal/mappers";

describe("DV-06 Requirement Capture: Full Implementation", () => {
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

  const masterLocalities = [
    {
      id: "loc-sec-54",
      tenantId: "tenant-apex-1",
      name: "Sector 54",
      city: "Gurugram",
      latitude: 28.4356,
      longitude: 77.1089,
    },
    {
      id: "loc-gcr",
      tenantId: "tenant-apex-1",
      name: "Golf Course Road",
      city: "Gurugram",
      latitude: 28.4595,
      longitude: 77.0967,
    },
    {
      id: "loc-dlf-5",
      tenantId: "tenant-apex-1",
      name: "DLF Phase 5",
      city: "Gurugram",
      latitude: 28.4522,
      longitude: 77.0988,
    },
  ];

  const sampleLead = {
    id: "lead-200",
    tenantId: "tenant-apex-1",
    name: "Sunita Sharma",
    primaryPhone: "9811122233",
    alternatePhone: null,
    email: "sunita@example.com",
    originalSource: "Direct Inquiry",
    sourceCreatedAt: new Date(),
    status: LeadStatus.NOT_YET_VALIDATED,
    assignedTelecallerId: null,
    isDoNotContact: false,
    callingAttemptsCount: 0,
    requirement: {
      id: "req-200",
      tenantId: "tenant-apex-1",
      leadId: "lead-200",
      preference: "SALE",
      minBudget: new Prisma.Decimal("10000000"),
      maxBudget: new Prisma.Decimal("20000000"),
      bedroomConfigurations: ["3 BHK"],
      propertyTypes: ["APARTMENT"],
      city: "Gurugram",
      targetArea: new Prisma.Decimal("1850"),
      minArea: new Prisma.Decimal("1600"),
      maxArea: new Prisma.Decimal("2200"),
      areaUnit: "sq.ft",
      areaType: "SUPER_BUILT_UP",
      societies: ["DLF The Aralias"],
      isConfirmed: false,
      confirmedAt: null,
      localities: [
        {
          id: "req-loc-1",
          tenantId: "tenant-apex-1",
          requirementId: "req-200",
          localityId: "loc-sec-54",
          locality: masterLocalities[0],
        },
      ],
    },
    enquiries: [],
    callLogs: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.locality.findMany as any).mockResolvedValue(masterLocalities);
    (prisma.leadRequirementLocality.findMany as any).mockResolvedValue([]);
    (prisma.leadRequirementLocality.createMany as any).mockResolvedValue({ count: 2 });
    (prisma.leadRequirementLocality.deleteMany as any).mockResolvedValue({ count: 0 });
  });

  describe("1. Area Requirement Validations", () => {
    it("accepts valid area specifications with minArea <= maxArea and valid unit/type", () => {
      expect(() =>
        validateAreaRequirements({
          minArea: 1500,
          maxArea: 2500,
          areaUnit: "sq.ft",
          areaType: "SUPER_BUILT_UP",
          targetArea: 2000,
        })
      ).not.toThrow();
    });

    it("rejects negative minArea with ValidationError", () => {
      expect(() =>
        validateAreaRequirements({
          minArea: -100,
        })
      ).toThrow(ValidationError);
      expect(() =>
        validateAreaRequirements({
          minArea: -100,
        })
      ).toThrow("Minimum area cannot be negative");
    });

    it("rejects negative maxArea with ValidationError", () => {
      expect(() =>
        validateAreaRequirements({
          maxArea: -50,
        })
      ).toThrow(ValidationError);
      expect(() =>
        validateAreaRequirements({
          maxArea: -50,
        })
      ).toThrow("Maximum area cannot be negative");
    });

    it("rejects maxArea less than minArea with ValidationError", () => {
      expect(() =>
        validateAreaRequirements({
          minArea: 2500,
          maxArea: 1500,
        })
      ).toThrow(ValidationError);
      expect(() =>
        validateAreaRequirements({
          minArea: 2500,
          maxArea: 1500,
        })
      ).toThrow("Maximum area cannot be less than minimum area");
    });

    it("rejects negative targetArea with ValidationError", () => {
      expect(() =>
        validateAreaRequirements({
          targetArea: -10,
        })
      ).toThrow(ValidationError);
      expect(() =>
        validateAreaRequirements({
          targetArea: -10,
        })
      ).toThrow("Target area cannot be negative");
    });

    it("rejects invalid area units with ValidationError", () => {
      expect(() =>
        validateAreaRequirements({
          areaUnit: "acres",
        })
      ).toThrow(ValidationError);
      expect(() =>
        validateAreaRequirements({
          areaUnit: "hectares",
        })
      ).toThrow("Invalid area unit");
    });

    it("rejects invalid area types with ValidationError", () => {
      expect(() =>
        validateAreaRequirements({
          areaType: "GARDEN" as any,
        })
      ).toThrow(ValidationError);
      expect(() =>
        validateAreaRequirements({
          areaType: "INVALID" as any,
        })
      ).toThrow("Invalid area type");
    });
  });

  describe("2. Lead Creation with Complete Requirements", () => {
    it("creates lead with all 10 requirement fields and synchronizes verified localities", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(null); // No duplicate
      (prisma.lead.create as any).mockResolvedValue({
        ...sampleLead,
        id: "lead-created-1",
      });
      (prisma.lead.findUniqueOrThrow as any).mockResolvedValue({
        ...sampleLead,
        id: "lead-created-1",
      });

      const result = await createLead(brokerContext, {
        name: "Sunita Sharma",
        primaryPhone: "9811122233",
        originalSource: "Direct Inquiry",
        preference: "SALE",
        minBudget: 10000000,
        maxBudget: 20000000,
        city: "Gurugram",
        bedroomConfigurations: ["3 BHK"],
        propertyTypes: ["APARTMENT"],
        societies: ["DLF The Aralias", "Ireo Grand Arch"],
        localities: ["Sector 54", "Golf Course Road"],
        minArea: 1600,
        maxArea: 2200,
        targetArea: 1850,
        areaUnit: "sq.ft",
        areaType: "SUPER_BUILT_UP",
      });

      expect(result.lead.id).toBe("lead-created-1");
      expect(result.isExistingBuyer).toBe(false);

      // Verify create payload passed to prisma.lead.create
      const createCall = (prisma.lead.create as any).mock.calls[0][0];
      expect(createCall.data.name).toBe("Sunita Sharma");
      expect(createCall.data.tenantId).toBe("tenant-apex-1");
      expect(createCall.data.requirement.create.city).toBe("Gurugram");
      expect(createCall.data.requirement.create.societies).toEqual([
        "DLF The Aralias",
        "Ireo Grand Arch",
      ]);
      expect(createCall.data.requirement.create.minArea?.toString()).toBe("1600");
      expect(createCall.data.requirement.create.maxArea?.toString()).toBe("2200");
      expect(createCall.data.requirement.create.targetArea?.toString()).toBe("1850");
      expect(createCall.data.requirement.create.areaUnit).toBe("sq.ft");
      expect(createCall.data.requirement.create.areaType).toBe("SUPER_BUILT_UP");

      // Verify localities were resolved against master and persisted in join table
      expect(prisma.leadRequirementLocality.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            tenantId: "tenant-apex-1",
            localityId: "loc-sec-54",
          }),
          expect.objectContaining({
            tenantId: "tenant-apex-1",
            localityId: "loc-gcr",
          }),
        ]),
        skipDuplicates: true,
      });
    });

    it("rejects unverified localities that do not exist in master data", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(null);
      (prisma.lead.create as any).mockResolvedValue({
        ...sampleLead,
        id: "lead-unverified-loc",
      });

      await expect(
        createLead(brokerContext, {
          name: "Amitabh Roy",
          primaryPhone: "9822233344",
          originalSource: "Direct Inquiry",
          preference: "SALE",
          minBudget: 10000000,
          maxBudget: 20000000,
          city: "Gurugram",
          bedroomConfigurations: ["3 BHK"],
          propertyTypes: ["APARTMENT"],
          localities: ["NonExistentSector999"],
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        createLead(brokerContext, {
          name: "Amitabh Roy",
          primaryPhone: "9822233344",
          originalSource: "Direct Inquiry",
          preference: "SALE",
          minBudget: 10000000,
          maxBudget: 20000000,
          city: "Gurugram",
          bedroomConfigurations: ["3 BHK"],
          propertyTypes: ["APARTMENT"],
          localities: ["NonExistentSector999"],
        })
      ).rejects.toThrow(
        "Locality 'NonExistentSector999' does not exist in the verified locality master for city 'Gurugram'"
      );
    });

    it("normalizes and deduplicates localities input before master resolution", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(null);
      (prisma.lead.create as any).mockResolvedValue({
        ...sampleLead,
        id: "lead-norm-loc",
      });
      (prisma.lead.findUniqueOrThrow as any).mockResolvedValue({
        ...sampleLead,
        id: "lead-norm-loc",
      });

      await createLead(brokerContext, {
        name: "Karan Johar",
        primaryPhone: "9833344455",
        originalSource: "Direct Inquiry",
        preference: "SALE",
        minBudget: 10000000,
        maxBudget: 20000000,
        city: "Gurugram",
        bedroomConfigurations: ["3 BHK"],
        propertyTypes: ["APARTMENT"],
        localities: ["  Sector 54  ", "SECTOR 54", "sector 54", "  "],
      });

      expect(prisma.leadRequirementLocality.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            tenantId: "tenant-apex-1",
            localityId: "loc-sec-54",
          }),
        ],
        skipDuplicates: true,
      });
    });
  });

  describe("3. Lead Requirement Editing & Audit Logging", () => {
    it("updates requirement area range, unit, type, societies, and localities, recording audit logs", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
      (prisma.lead.update as any).mockResolvedValue(sampleLead);
      (prisma.leadRequirement.upsert as any).mockResolvedValue(sampleLead.requirement);
      (prisma.lead.findUniqueOrThrow as any).mockResolvedValue(sampleLead);

      // Existing locality join records for sampleLead has loc-sec-54
      (prisma.leadRequirementLocality.findMany as any).mockResolvedValue([
        {
          id: "req-loc-1",
          localityId: "loc-sec-54",
        },
      ]);

      await editLead(brokerContext, {
        id: "lead-200",
        name: "Sunita Sharma",
        primaryPhone: "9811122233",
        originalSource: "Direct Inquiry",
        preference: "SALE",
        minBudget: 10000000,
        maxBudget: 20000000,
        city: "Gurugram",
        bedroomConfigurations: ["3 BHK"],
        propertyTypes: ["APARTMENT"],
        societies: ["DLF Phase 5", "Tata Primanti"], // Changed
        localities: ["Golf Course Road"], // Removed Sector 54, added Golf Course Road
        minArea: 1750, // Changed from 1600
        maxArea: 2400, // Changed from 2200
        areaUnit: "sq.yd", // Changed from sq.ft
        areaType: "CARPET", // Changed from SUPER_BUILT_UP
        targetArea: 2000, // Changed from 1850
      });

      // Verify locality synchronization deleted removed locality and added new one
      expect(prisma.leadRequirementLocality.deleteMany).toHaveBeenCalledWith({
        where: {
          tenantId: "tenant-apex-1",
          requirementId: "req-200",
          localityId: { in: ["loc-sec-54"] },
        },
      });

      expect(prisma.leadRequirementLocality.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            tenantId: "tenant-apex-1",
            requirementId: "req-200",
            localityId: "loc-gcr",
          }),
        ],
        skipDuplicates: true,
      });

      // Verify audit logs were generated for all requirement modifications
      expect(prisma.leadChangeLog.createMany).toHaveBeenCalled();
      const loggedChanges = (prisma.leadChangeLog.createMany as any).mock.calls[0][0].data;

      const minAreaLog = loggedChanges.find((c: any) => c.fieldName === "minArea");
      const maxAreaLog = loggedChanges.find((c: any) => c.fieldName === "maxArea");
      const areaUnitLog = loggedChanges.find((c: any) => c.fieldName === "areaUnit");
      const areaTypeLog = loggedChanges.find((c: any) => c.fieldName === "areaType");
      const targetAreaLog = loggedChanges.find((c: any) => c.fieldName === "targetArea");
      const societiesLog = loggedChanges.find((c: any) => c.fieldName === "societies");
      const localitiesLog = loggedChanges.find((c: any) => c.fieldName === "localities");

      expect(minAreaLog).toEqual(
        expect.objectContaining({
          previousValue: "1600",
          newValue: "1750",
          changedByUserId: "broker-owner-1",
        })
      );
      expect(maxAreaLog).toEqual(
        expect.objectContaining({
          previousValue: "2200",
          newValue: "2400",
        })
      );
      expect(areaUnitLog).toEqual(
        expect.objectContaining({
          previousValue: "sq.ft",
          newValue: "sq.yd",
        })
      );
      expect(areaTypeLog).toEqual(
        expect.objectContaining({
          previousValue: "SUPER_BUILT_UP",
          newValue: "CARPET",
        })
      );
      expect(targetAreaLog).toEqual(
        expect.objectContaining({
          previousValue: "1850",
          newValue: "2000",
        })
      );
      expect(societiesLog).toEqual(
        expect.objectContaining({
          previousValue: JSON.stringify(["DLF The Aralias"]),
          newValue: JSON.stringify(["DLF Phase 5", "Tata Primanti"]),
        })
      );
      expect(localitiesLog).toEqual(
        expect.objectContaining({
          previousValue: JSON.stringify(["Sector 54"]),
          newValue: JSON.stringify(["Golf Course Road"]),
        })
      );
    });

    it("preserves unchanged locality associations and only deletes removed ones", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
      (prisma.lead.update as any).mockResolvedValue(sampleLead);
      (prisma.leadRequirement.upsert as any).mockResolvedValue(sampleLead.requirement);
      (prisma.lead.findUniqueOrThrow as any).mockResolvedValue(sampleLead);

      // Existing localities: loc-sec-54 and loc-gcr
      (prisma.leadRequirementLocality.findMany as any).mockResolvedValue([
        { id: "req-loc-1", localityId: "loc-sec-54" },
        { id: "req-loc-2", localityId: "loc-gcr" },
      ]);

      // Submitting Sector 54, Golf Course Road, and DLF Phase 5 (adding DLF Phase 5, preserving first two)
      await editLead(brokerContext, {
        id: "lead-200",
        name: "Sunita Sharma",
        primaryPhone: "9811122233",
        originalSource: "Direct Inquiry",
        preference: "SALE",
        minBudget: 10000000,
        maxBudget: 20000000,
        city: "Gurugram",
        bedroomConfigurations: ["3 BHK"],
        propertyTypes: ["APARTMENT"],
        localities: ["Sector 54", "Golf Course Road", "DLF Phase 5"],
      });

      // No deletions since neither existing locality was removed
      expect(prisma.leadRequirementLocality.deleteMany).not.toHaveBeenCalled();

      // Only DLF Phase 5 should be created
      expect(prisma.leadRequirementLocality.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            tenantId: "tenant-apex-1",
            localityId: "loc-dlf-5",
          }),
        ],
        skipDuplicates: true,
      });
    });
  });

  describe("4. getVerifiedLocalities DAL", () => {
    it("returns verified localities scoped by tenantId and city", async () => {
      (prisma.locality.findMany as any).mockResolvedValue(masterLocalities);

      const locs = await getVerifiedLocalities(brokerContext, "Gurugram");

      expect(prisma.locality.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: "tenant-apex-1",
          city: { equals: "Gurugram", mode: "insensitive" },
        },
        select: {
          id: true,
          name: true,
          city: true,
          latitude: true,
          longitude: true,
        },
        orderBy: { name: "asc" },
      });
      expect(locs).toHaveLength(3);
      expect(locs[0].name).toBe("Sector 54");
    });

    it("returns all tenant localities when city is omitted", async () => {
      (prisma.locality.findMany as any).mockResolvedValue(masterLocalities);

      await getVerifiedLocalities(brokerContext);

      expect(prisma.locality.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: "tenant-apex-1",
        },
        select: {
          id: true,
          name: true,
          city: true,
          latitude: true,
          longitude: true,
        },
        orderBy: { name: "asc" },
      });
    });
  });

  describe("5. View Model Mapper Validation", () => {
    it("maps all requirement fields faithfully into Lead view model", () => {
      const view = mapPrismaLeadToView(sampleLead as any);

      expect(view.requirements).toEqual(
        expect.objectContaining({
          city: "Gurugram",
          preference: "Sale",
          minBudget: 10000000,
          maxBudget: 20000000,
          bedroomConfigurations: ["3 BHK"],
          propertyTypes: ["APARTMENT"],
          societies: ["DLF The Aralias"],
          localities: ["Sector 54"],
          minArea: 1600,
          maxArea: 2200,
          areaUnit: "sq.ft",
          areaType: "SUPER_BUILT_UP",
          targetArea: 1850,
          isConfirmed: false,
        })
      );
    });

    it("handles null requirement gracefully with safe defaults", () => {
      const leadWithoutReq = {
        ...sampleLead,
        requirement: null,
      };

      const view = mapPrismaLeadToView(leadWithoutReq as any);

      expect(view.requirements.city).toBe("Not Specified");
      expect(view.requirements.societies).toEqual([]);
      expect(view.requirements.localities).toEqual([]);
      expect(view.requirements.minArea).toBeNull();
      expect(view.requirements.maxArea).toBeNull();
      expect(view.requirements.areaUnit).toBe("sq.ft");
      expect(view.requirements.isConfirmed).toBe(false);
    });
  });

  describe("6. Repeat Enquiry Requirements Preservation (DV-04)", () => {
    it("preserves original buyer requirements when an existing buyer creates a repeat enquiry", async () => {
      // Existing active buyer found
      (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
      (prisma.enquiry.create as any).mockResolvedValue({
        id: "enq-99",
        leadId: "lead-200",
        tenantId: "tenant-apex-1",
      });

      const result = await createLead(brokerContext, {
        name: "Sunita Sharma",
        primaryPhone: "9811122233",
        originalSource: "Housing.com",
        preference: "RENT", // Different from existing SALE
        minBudget: 50000,
        maxBudget: 75000,
        city: "Delhi",
        bedroomConfigurations: ["1 BHK"],
        propertyTypes: ["BUILDER_FLOOR"],
        minArea: 800,
        maxArea: 1000,
      });

      expect(result.isExistingBuyer).toBe(true);
      expect(result.lead.id).toBe("lead-200");

      // Verify that leadRequirement was NOT updated
      expect(prisma.leadRequirement.update).not.toHaveBeenCalled();
      expect(prisma.leadRequirement.upsert).not.toHaveBeenCalled();

      // Verify new enquiry was logged with the advertised/inquiry context
      expect(prisma.enquiry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          leadId: "lead-200",
          tenantId: "tenant-apex-1",
          source: "Housing.com",
        }),
      });
    });
  });

  describe("7. Buyer Requirement Confirmation Lifecycle (confirmedAt)", () => {
    it("sets confirmedAt and isConfirmed = true on first caller confirmation", async () => {
      (prisma.lead.findFirst as any).mockResolvedValue(sampleLead);
      (prisma.leadRequirement.update as any).mockResolvedValue({
        ...sampleLead.requirement,
        isConfirmed: true,
        confirmedAt: new Date("2026-05-10T10:00:00Z"),
      });
      (prisma.lead.findUniqueOrThrow as any).mockResolvedValue({
        ...sampleLead,
        requirement: {
          ...sampleLead.requirement,
          isConfirmed: true,
          confirmedAt: new Date("2026-05-10T10:00:00Z"),
        },
      });

      await confirmLeadRequirements(brokerContext, "lead-200");

      expect(prisma.leadRequirement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { leadId: "lead-200" },
          data: expect.objectContaining({
            isConfirmed: true,
            confirmedAt: expect.any(Date),
          }),
        })
      );

      expect(prisma.leadChangeLog.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            fieldName: "isConfirmed",
            newValue: "true",
          }),
          expect.objectContaining({
            fieldName: "confirmedAt",
            previousValue: null,
          }),
        ]),
      });
    });

    it("re-confirmation after requirement change updates confirmedAt to current timestamp", async () => {
      const alreadyConfirmedLead = {
        ...sampleLead,
        requirement: {
          ...sampleLead.requirement,
          isConfirmed: true,
          confirmedAt: new Date("2026-01-01T10:00:00Z"),
        },
      };

      (prisma.lead.findFirst as any).mockResolvedValue(alreadyConfirmedLead);
      (prisma.leadRequirement.update as any).mockResolvedValue({
        ...alreadyConfirmedLead.requirement,
        confirmedAt: new Date("2026-06-01T12:00:00Z"),
      });
      (prisma.lead.findUniqueOrThrow as any).mockResolvedValue(alreadyConfirmedLead);

      await confirmLeadRequirements(brokerContext, "lead-200");

      expect(prisma.leadRequirement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { leadId: "lead-200" },
          data: expect.objectContaining({
            isConfirmed: true,
            confirmedAt: expect.any(Date),
          }),
        })
      );
    });

    it("ordinary requirement edit without caller verification does NOT update confirmedAt", async () => {
      const confirmedLead = {
        ...sampleLead,
        requirement: {
          ...sampleLead.requirement,
          isConfirmed: true,
          confirmedAt: new Date("2026-01-01T10:00:00Z"),
        },
      };

      (prisma.lead.findFirst as any).mockResolvedValue(confirmedLead);
      (prisma.leadRequirement.upsert as any).mockResolvedValue({
        ...confirmedLead.requirement,
        minBudget: new Prisma.Decimal("15000000"),
      });
      (prisma.lead.findUniqueOrThrow as any).mockResolvedValue(confirmedLead);
      (prisma.lead.update as any).mockResolvedValue(confirmedLead);

      await editLead(brokerContext, {
        id: "lead-200",
        name: "Sunita Sharma",
        primaryPhone: "9811122233",
        originalSource: "Direct Inquiry",
        minBudget: 15000000,
        maxBudget: 25000000,
        city: "Gurugram",
        preference: "SALE",
      });

      // Verify upsert update payload did NOT touch confirmedAt
      expect(prisma.leadRequirement.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.not.objectContaining({
            confirmedAt: expect.anything(),
          }),
        })
      );
    });

    it("unrelated lead update does not update confirmedAt", async () => {
      const confirmedLead = {
        ...sampleLead,
        requirement: {
          ...sampleLead.requirement,
          isConfirmed: true,
          confirmedAt: new Date("2026-01-01T10:00:00Z"),
        },
      };

      (prisma.lead.findFirst as any).mockResolvedValue(confirmedLead);
      (prisma.lead.update as any).mockResolvedValue(confirmedLead);

      await updateLead(brokerContext, "lead-200", {
        name: "Sunita S. Sharma",
        email: "sunita.new@example.com",
      });

      // Verify requirement table was not touched
      expect(prisma.leadRequirement.update).not.toHaveBeenCalled();
      expect(prisma.leadRequirement.upsert).not.toHaveBeenCalled();
    });

    it("unauthorized user lacking demand:log_call cannot confirm requirements", async () => {
      const unauthorizedContext: TenantContext = {
        ...brokerContext,
        role: UserRole.FIELD_VERIFIER,
      };

      await expect(confirmLeadRequirements(unauthorizedContext, "lead-200")).rejects.toThrow(
        ForbiddenError
      );
    });
  });
});
