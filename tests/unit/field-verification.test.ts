/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  UserRole,
  AssignmentTargetType,
  AssignmentRole,
  AssignmentStatus,
  PropertyVerificationStatus,
  UnableToVerifyReason,
  PropertyCondition,
  VerificationOccupancyState,
  SupplyValidationStatus,
  PropertyAvailabilityStatus,
  MediaType,
  MediaStorageProvider,
} from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";
import { ForbiddenError, ValidationError, NotFoundError } from "@/server/errors";

// Mock Prisma DB module
vi.mock("@/server/db", () => {
  const mockPrisma = {
    property: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    assignment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    propertyVerification: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    propertyMedia: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
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
  listEligibleFieldVerifiers,
  assignPropertyToFieldVerifier,
} from "@/server/dal/assignments";
import {
  listVerifications,
  getVerificationById,
  startVerificationVisit,
  submitVerificationReport,
  recordUnableToVerify,
  reviewVerificationReport,
  getVerificationStats,
} from "@/server/dal/verifications";
import { addPropertyPhoto } from "@/server/dal/media";
import { StorageAdapter, setStorageAdapterForTesting } from "@/server/storage";

// In-memory fake storage adapter for testing media uploads
class MockStorageAdapter implements StorageAdapter {
  saved: any[] = [];
  async savePhoto(params: {
    tenantId: string;
    propertyId: string;
    buffer: Buffer;
    mimeType: string;
    extension: string;
  }) {
    const key = `mock/${params.tenantId}/${params.propertyId}/test.${params.extension}`;
    this.saved.push({ key, ...params });
    return { storageKey: key, sizeBytes: params.buffer.length, mimeType: params.mimeType };
  }
  async readPhoto(_storageKey: string) {
    return { buffer: Buffer.from([]), mimeType: "image/jpeg", sizeBytes: 0 };
  }
  async deletePhoto(key: string) {
    this.saved = this.saved.filter((s) => s.key !== key);
  }
}

describe("Phase 1 Field Verification - DAL & Security Test Suite", () => {
  let mockStorage: MockStorageAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = new MockStorageAdapter();
    setStorageAdapterForTesting(mockStorage);
  });

  const tenantA = "tenant-brokerage-alpha";
  const tenantB = "tenant-brokerage-beta";

  const createContext = (
    userId: string,
    role: UserRole,
    tenantId: string,
    name: string
  ): TenantContext => ({
    tenantId,
    userId,
    role,
    user: {
      id: userId,
      name,
      email: `${userId}@${tenantId}.crm`,
      role,
      isActive: true,
      tenantId,
    },
    session: {
      id: `sess-${userId}`,
      token: `tok-${userId}`,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });

  const brokerOwnerContext = createContext(
    "user-broker-owner",
    UserRole.BROKER_OWNER,
    tenantA,
    "Rajesh Broker"
  );
  const teamLeaderContext = createContext(
    "user-team-leader",
    UserRole.TEAM_LEADER,
    tenantA,
    "Pooja TL"
  );
  const fieldVerifierContext = createContext(
    "user-verifier-1",
    UserRole.FIELD_VERIFIER,
    tenantA,
    "Amit Verifier"
  );
  const anotherVerifierContext = createContext(
    "user-verifier-2",
    UserRole.FIELD_VERIFIER,
    tenantA,
    "Rohan Verifier"
  );
  const telecallerContext = createContext(
    "user-telecaller",
    UserRole.TELECALLER,
    tenantA,
    "Suresh Telecaller"
  );
  const tenantBVerifierContext = createContext(
    "user-verifier-beta",
    UserRole.FIELD_VERIFIER,
    tenantB,
    "Beta Verifier"
  );

  // Valid JPEG header bytes for media upload tests
  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  ]);

  // =========================================================================
  // 1. ASSIGNMENT WORKFLOW TESTS
  // =========================================================================
  describe("1. Assignment Workflow & Permissions", () => {
    it("lists eligible active Field Verifiers strictly scoped to the tenant", async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValueOnce([
        {
          id: "user-verifier-1",
          name: "Amit Verifier",
          email: "amit@alpha.crm",
          phone: "9876543212",
          role: UserRole.FIELD_VERIFIER,
          isActive: true,
        },
      ] as any);

      const verifiers = await listEligibleFieldVerifiers(teamLeaderContext);
      expect(verifiers).toHaveLength(1);
      expect(verifiers[0].name).toBe("Amit Verifier");
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: tenantA,
            role: UserRole.FIELD_VERIFIER,
            isActive: true,
          }),
        })
      );
    });

    it("rejects listing Field Verifiers for unauthorized roles (e.g. Field Verifier)", async () => {
      await expect(listEligibleFieldVerifiers(fieldVerifierContext)).rejects.toThrow(
        ForbiddenError
      );
    });

    it("assigns an Active Supply Pool property to a Field Verifier", async () => {
      vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
        id: "prop-1",
        tenantId: tenantA,
        isActiveSupply: true,
        validationStatus: SupplyValidationStatus.VALIDATED,
        availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
      } as any);

      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "user-verifier-1",
        name: "Amit Verifier",
        role: UserRole.FIELD_VERIFIER,
        isActive: true,
      } as any);

      vi.mocked(prisma.assignment.findFirst).mockResolvedValueOnce(null);

      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValueOnce(null);

      vi.mocked(prisma.assignment.create).mockResolvedValueOnce({
        id: "assign-1",
        tenantId: tenantA,
        propertyId: "prop-1",
        assignedUserId: "user-verifier-1",
        status: AssignmentStatus.ACTIVE,
      } as any);

      vi.mocked(prisma.propertyVerification.create).mockResolvedValueOnce({
        id: "verif-1",
        tenantId: tenantA,
        propertyId: "prop-1",
        verifierId: "user-verifier-1",
        status: PropertyVerificationStatus.ASSIGNED,
      } as any);

      const result = await assignPropertyToFieldVerifier(teamLeaderContext, {
        propertyId: "prop-1",
        verifierId: "user-verifier-1",
        instructions: "Verify flat condition and keys",
      });

      expect(result.assignment.id).toBe("assign-1");
      expect(result.verification.id).toBe("verif-1");
    });

    it("strictly prevents Telecallers from assigning properties to field verifiers", async () => {
      await expect(
        assignPropertyToFieldVerifier(telecallerContext, {
          propertyId: "prop-1",
          verifierId: "user-verifier-1",
          instructions: "Telecaller scheduled on-site inspection",
        })
      ).rejects.toThrow(ForbiddenError);

      expect(prisma.assignment.create).not.toHaveBeenCalled();
      expect(prisma.propertyVerification.create).not.toHaveBeenCalled();
    });

    it("rejects assigning properties that are NOT in the Active Supply Pool", async () => {
      vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
        id: "prop-unvalidated",
        tenantId: tenantA,
        isActiveSupply: false,
        validationStatus: SupplyValidationStatus.NOT_VALIDATED,
        availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
      } as any);

      await expect(
        assignPropertyToFieldVerifier(brokerOwnerContext, {
          propertyId: "prop-unvalidated",
          verifierId: "user-verifier-1",
        })
      ).rejects.toThrow(ValidationError);
    });

    it("prevents duplicate active verification assignment to the exact same verifier", async () => {
      vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
        id: "prop-1",
        tenantId: tenantA,
        isActiveSupply: true,
        validationStatus: SupplyValidationStatus.VALIDATED,
        availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
      } as any);

      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "user-verifier-1",
        name: "Amit Verifier",
        role: UserRole.FIELD_VERIFIER,
        isActive: true,
      } as any);

      // Existing active assignment to same verifier
      vi.mocked(prisma.assignment.findFirst).mockResolvedValueOnce({
        id: "existing-assign",
        assignedUserId: "user-verifier-1",
        status: AssignmentStatus.ACTIVE,
      } as any);

      await expect(
        assignPropertyToFieldVerifier(brokerOwnerContext, {
          propertyId: "prop-1",
          verifierId: "user-verifier-1",
        })
      ).rejects.toThrow(ValidationError);
    });

    it("prevents Field Verifiers from assigning properties to themselves or others", async () => {
      await expect(
        assignPropertyToFieldVerifier(fieldVerifierContext, {
          propertyId: "prop-1",
          verifierId: "user-verifier-1",
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("prevents cross-tenant assignment (target user in different tenant)", async () => {
      vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
        id: "prop-1",
        tenantId: tenantA,
        isActiveSupply: true,
        validationStatus: SupplyValidationStatus.VALIDATED,
        availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
      } as any);

      // findFirst returns null because tenantId doesn't match
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

      await expect(
        assignPropertyToFieldVerifier(brokerOwnerContext, {
          propertyId: "prop-1",
          verifierId: "user-verifier-beta",
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  // =========================================================================
  // 2. VERIFICATION STATE MACHINE & VISITS
  // =========================================================================
  describe("2. Visit Lifecycle & State Transitions", () => {
    it("starts a visit: ASSIGNED -> IN_PROGRESS and records startedAt", async () => {
      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValueOnce({
        id: "verif-1",
        tenantId: tenantA,
        propertyId: "prop-1",
        verifierId: fieldVerifierContext.userId,
        status: PropertyVerificationStatus.ASSIGNED,
      } as any);

      vi.mocked(prisma.propertyVerification.update).mockResolvedValueOnce({
        id: "verif-1",
        status: PropertyVerificationStatus.IN_PROGRESS,
        startedAt: new Date(),
      } as any);

      const result = await startVerificationVisit(fieldVerifierContext, "verif-1");
      expect(result.status).toBe(PropertyVerificationStatus.IN_PROGRESS);
      expect(prisma.propertyVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "verif-1" },
          data: expect.objectContaining({
            status: PropertyVerificationStatus.IN_PROGRESS,
            startedAt: expect.any(Date),
          }),
        })
      );
    });

    it("rejects starting a visit if the caller is not the assigned Field Verifier", async () => {
      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValueOnce({
        id: "verif-1",
        tenantId: tenantA,
        propertyId: "prop-1",
        verifierId: "user-verifier-1", // Assigned to verifier 1
        status: PropertyVerificationStatus.ASSIGNED,
      } as any);

      // Called by verifier 2
      await expect(
        startVerificationVisit(anotherVerifierContext, "verif-1")
      ).rejects.toThrow(ForbiddenError);
    });

    it("rejects starting a visit if status is not ASSIGNED (e.g. already SUBMITTED)", async () => {
      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValueOnce({
        id: "verif-1",
        tenantId: tenantA,
        propertyId: "prop-1",
        verifierId: fieldVerifierContext.userId,
        status: PropertyVerificationStatus.SUBMITTED,
      } as any);

      await expect(
        startVerificationVisit(fieldVerifierContext, "verif-1")
      ).rejects.toThrow(ValidationError);
    });

    it("records unable to verify with standard reason and notes", async () => {
      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValueOnce({
        id: "verif-1",
        tenantId: tenantA,
        propertyId: "prop-1",
        verifierId: fieldVerifierContext.userId,
        status: PropertyVerificationStatus.IN_PROGRESS,
      } as any);

      vi.mocked(prisma.propertyVerification.update).mockResolvedValueOnce({
        id: "verif-1",
        status: PropertyVerificationStatus.UNABLE_TO_VERIFY,
        unableToVerifyReason: UnableToVerifyReason.DOOR_LOCKED,
        unableToVerifyNotes: "Nobody answered the door bell.",
      } as any);

      const result = await recordUnableToVerify(fieldVerifierContext, {
        verificationId: "verif-1",
        reason: UnableToVerifyReason.DOOR_LOCKED,
        notes: "Nobody answered the door bell.",
      });

      expect(result.status).toBe(PropertyVerificationStatus.UNABLE_TO_VERIFY);
    });
  });

  // =========================================================================
  // 3. REPORT SUBMISSION VALIDATIONS
  // =========================================================================
  describe("3. Report Submission Validations", () => {
    it("submits verification report: IN_PROGRESS -> SUBMITTED when all requirements met", async () => {
      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValueOnce({
        id: "verif-1",
        tenantId: tenantA,
        propertyId: "prop-1",
        verifierId: fieldVerifierContext.userId,
        status: PropertyVerificationStatus.IN_PROGRESS,
      } as any);

      // Has 2 uploaded photos
      vi.mocked(prisma.propertyMedia.count).mockResolvedValueOnce(2);

      vi.mocked(prisma.propertyVerification.update).mockResolvedValueOnce({
        id: "verif-1",
        status: PropertyVerificationStatus.SUBMITTED,
        submittedAt: new Date(),
        actualBedrooms: 3,
        actualBathrooms: 3,
      } as any);

      const result = await submitVerificationReport(fieldVerifierContext, {
        verificationId: "verif-1",
        physicalMatch: true,
        occupancyState: VerificationOccupancyState.VACANT,
        actualBedrooms: 3,
        actualBathrooms: 3,
        propertyCondition: PropertyCondition.EXCELLENT,
        keyHolderConfirmed: true,
        amenitiesConfirmed: ["Lift / Elevator", "Power Backup"],
        discrepancies: "None",
        verifierRemarks: "Well maintained flat",
      });

      expect(result.status).toBe(PropertyVerificationStatus.SUBMITTED);
    });

    it("rejects report submission if 0 photos have been attached", async () => {
      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValueOnce({
        id: "verif-1",
        tenantId: tenantA,
        propertyId: "prop-1",
        verifierId: fieldVerifierContext.userId,
        status: PropertyVerificationStatus.IN_PROGRESS,
      } as any);

      // 0 photos uploaded
      vi.mocked(prisma.propertyMedia.count).mockResolvedValueOnce(0);

      await expect(
        submitVerificationReport(fieldVerifierContext, {
          verificationId: "verif-1",
          physicalMatch: true,
          occupancyState: VerificationOccupancyState.VACANT,
          actualBedrooms: 3,
          actualBathrooms: 3,
          propertyCondition: PropertyCondition.GOOD,
          keyHolderConfirmed: true,
        })
      ).rejects.toThrow(ValidationError);
    });

    it("rejects report submission if visit was not started (status is still ASSIGNED)", async () => {
      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValueOnce({
        id: "verif-1",
        tenantId: tenantA,
        propertyId: "prop-1",
        verifierId: fieldVerifierContext.userId,
        status: PropertyVerificationStatus.ASSIGNED, // Not started!
      } as any);

      await expect(
        submitVerificationReport(fieldVerifierContext, {
          verificationId: "verif-1",
          physicalMatch: true,
          occupancyState: VerificationOccupancyState.VACANT,
          actualBedrooms: 2,
          actualBathrooms: 2,
          propertyCondition: PropertyCondition.GOOD,
          keyHolderConfirmed: true,
        })
      ).rejects.toThrow(ValidationError);
    });

    it("strictly prevents Telecallers from submitting verification reports", async () => {
      await expect(
        submitVerificationReport(telecallerContext, {
          verificationId: "verif-1",
          physicalMatch: true,
          occupancyState: VerificationOccupancyState.VACANT,
          actualBedrooms: 2,
          actualBathrooms: 2,
          propertyCondition: PropertyCondition.GOOD,
          keyHolderConfirmed: true,
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // =========================================================================
  // 4. SUPERVISORY REVIEW & BADGE UPDATES
  // =========================================================================
  describe("4. Supervisory Review & Badge Updates", () => {
    it("approves verification: marks APPROVED and updates property isFieldVerified=true", async () => {
      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValueOnce({
        id: "verif-1",
        tenantId: tenantA,
        propertyId: "prop-1",
        verifierId: "user-verifier-1",
        status: PropertyVerificationStatus.SUBMITTED,
      } as any);

      vi.mocked(prisma.propertyVerification.update).mockResolvedValueOnce({
        id: "verif-1",
        status: PropertyVerificationStatus.APPROVED,
        reviewedByUserId: teamLeaderContext.userId,
      } as any);

      vi.mocked(prisma.property.update).mockResolvedValueOnce({
        id: "prop-1",
        isFieldVerified: true,
        fieldVerifiedAt: new Date(),
      } as any);

      vi.mocked(prisma.assignment.updateMany).mockResolvedValueOnce({ count: 1 } as any);

      const result = await reviewVerificationReport(teamLeaderContext, {
        verificationId: "verif-1",
        decision: "APPROVE",
        reviewNotes: "Approved upon review",
      });

      expect(result.status).toBe(PropertyVerificationStatus.APPROVED);
      expect(prisma.property.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "prop-1" },
          data: expect.objectContaining({
            isFieldVerified: true,
            fieldVerifiedAt: expect.any(Date),
          }),
        })
      );
    });

    it("prevents Field Verifiers from reviewing or approving their own reports", async () => {
      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValueOnce({
        id: "verif-1",
        tenantId: tenantA,
        propertyId: "prop-1",
        verifierId: fieldVerifierContext.userId,
        status: PropertyVerificationStatus.SUBMITTED,
      } as any);

      await expect(
        reviewVerificationReport(fieldVerifierContext, {
          verificationId: "verif-1",
          decision: "APPROVE",
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("rejects verification with required feedback notes without marking property verified", async () => {
      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValueOnce({
        id: "verif-1",
        tenantId: tenantA,
        propertyId: "prop-1",
        verifierId: "user-verifier-1",
        status: PropertyVerificationStatus.SUBMITTED,
      } as any);

      vi.mocked(prisma.propertyVerification.update).mockResolvedValueOnce({
        id: "verif-1",
        status: PropertyVerificationStatus.REJECTED,
        reviewNotes: "Please re-check bathroom leakages and balcony facing",
      } as any);

      const result = await reviewVerificationReport(teamLeaderContext, {
        verificationId: "verif-1",
        decision: "REJECT",
        reviewNotes: "Please re-check bathroom leakages and balcony facing",
      });

      expect(result.status).toBe(PropertyVerificationStatus.REJECTED);
      // Ensure property was NOT marked verified
      expect(prisma.property.update).not.toHaveBeenCalled();
    });

    it("rejects review rejection without mandatory feedback notes", async () => {
      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValueOnce({
        id: "verif-1",
        tenantId: tenantA,
        propertyId: "prop-1",
        verifierId: "user-verifier-1",
        status: PropertyVerificationStatus.SUBMITTED,
      } as any);

      await expect(
        reviewVerificationReport(teamLeaderContext, {
          verificationId: "verif-1",
          decision: "REJECT",
          reviewNotes: "   ", // Blank notes
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  // =========================================================================
  // 5. CRITICAL MEDIA SECURITY FIX
  // =========================================================================
  describe("5. Critical Media Security Fix", () => {
    it("denies Field Verifier photo upload to an unassigned property", async () => {
      // Property exists in tenant, but is NOT assigned to this verifier
      vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
        id: "prop-unassigned",
        tenantId: tenantA,
        submittingAgentId: "other-user",
        assignments: [],
        verifications: [],
      } as any);

      await expect(
        addPropertyPhoto(fieldVerifierContext, {
          propertyId: "prop-unassigned",
          fileBuffer: validJpegBuffer,
          caption: "Unauthorized test",
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("permits Field Verifier photo upload when property has an active verification task for them", async () => {
      vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
        id: "prop-assigned",
        tenantId: tenantA,
        submittingAgentId: null,
        assignments: [],
        verifications: [
          {
            verifierId: fieldVerifierContext.userId,
            status: PropertyVerificationStatus.IN_PROGRESS,
          },
        ],
      } as any);

      vi.mocked(prisma.propertyMedia.findFirst).mockResolvedValueOnce({
        displayOrder: 0,
      } as any);

      vi.mocked(prisma.propertyMedia.create).mockResolvedValueOnce({
        id: "media-1",
        tenantId: tenantA,
        propertyId: "prop-assigned",
        uploadedById: fieldVerifierContext.userId,
        mediaType: MediaType.PHOTO,
        url: "/api/media/media-1",
        caption: "Living Room",
        displayOrder: 1,
      } as any);

      const photo = await addPropertyPhoto(fieldVerifierContext, {
        propertyId: "prop-assigned",
        fileBuffer: validJpegBuffer,
        caption: "Living Room",
      });

      expect(photo.id).toBe("media-1");
      expect(photo.uploadedById).toBe(fieldVerifierContext.userId);
    });

    it("blocks linking verification evidence to another tenant's verification task", async () => {
      vi.mocked(prisma.property.findFirst).mockReset();
      vi.mocked(prisma.property.findFirst).mockResolvedValueOnce({
        id: "prop-assigned",
        tenantId: tenantA,
        submittingAgentId: null,
        assignments: [],
        verifications: [
          {
            verifierId: fieldVerifierContext.userId,
            status: PropertyVerificationStatus.IN_PROGRESS,
          },
        ],
      } as any);

      // Verification does not exist in this tenant/property
      vi.mocked(prisma.propertyVerification.findFirst).mockReset();
      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValue(null);

      await expect(
        addPropertyPhoto(fieldVerifierContext, {
          propertyId: "prop-assigned",
          verificationId: "foreign-verif-id",
          fileBuffer: validJpegBuffer,
          caption: "Cross-tenant test",
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  // =========================================================================
  // 6. CROSS-TENANT ISOLATION
  // =========================================================================
  describe("6. Cross-Tenant Isolation", () => {
    it("strictly isolates verification tasks across tenants", async () => {
      // Beta verifier tries to fetch Alpha verification
      vi.mocked(prisma.propertyVerification.findFirst).mockResolvedValueOnce(null);

      await expect(
        getVerificationById(tenantBVerifierContext, "verif-alpha-1")
      ).rejects.toThrow(NotFoundError);

      expect(prisma.propertyVerification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "verif-alpha-1",
            tenantId: tenantB, // STRICT SERVER-ENFORCED TENANT
          }),
        })
      );
    });
  });
});
