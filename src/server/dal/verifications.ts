import { prisma } from "../db";
import { TenantContext } from "../tenant-context";
import { assertPermission } from "../permissions";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import {
  PropertyVerificationStatus,
  UnableToVerifyReason,
  PropertyCondition,
  VerificationOccupancyState,
  UserRole,
  AssignmentStatus,
  AssignmentTargetType,
  AssignmentRole,
  Prisma,
} from "@prisma/client";

export interface SubmitVerificationInput {
  verificationId: string;
  physicalMatch: boolean;
  occupancyState: VerificationOccupancyState;
  actualBedrooms: number;
  actualBathrooms: number;
  propertyCondition: PropertyCondition;
  amenitiesConfirmed?: string[];
  keyHolderConfirmed: boolean;
  discrepancies?: string;
  verifierRemarks?: string;
  checklistResults?: Record<string, unknown>;
}

export interface UnableToVerifyInput {
  verificationId: string;
  reason: UnableToVerifyReason;
  notes: string;
}

export interface ReviewVerificationInput {
  verificationId: string;
  decision: "APPROVE" | "REJECT";
  reviewNotes?: string;
}

export interface VerificationFilterOptions {
  status?: PropertyVerificationStatus;
  search?: string;
}

/**
 * Lists verification tasks strictly scoped to the tenant.
 * - Field Verifiers can only view their own assigned verifications.
 * - Team Leaders and Broker Owners view tenant-wide verifications.
 */
export async function listVerifications(
  context: TenantContext,
  filters?: VerificationFilterOptions
) {
  assertPermission(context, "verification:view_assigned");

  const where: Prisma.PropertyVerificationWhereInput = {
    tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
  };

  // Field Verifiers see only their assigned verifications
  if (context.role === UserRole.FIELD_VERIFIER) {
    where.verifierId = context.userId;
  }

  if (filters?.status) {
    where.status = filters.status;
  }

  if (filters?.search && filters.search.trim()) {
    const s = filters.search.trim();
    where.property = {
      OR: [
        { societyName: { contains: s, mode: "insensitive" } },
        { localityName: { contains: s, mode: "insensitive" } },
        { flatNumber: { contains: s, mode: "insensitive" } },
      ],
    };
  }

  return prisma.propertyVerification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      property: {
        include: {
          keyHolders: true,
          media: {
            orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
          },
        },
      },
      verifier: {
        select: { id: true, name: true, email: true, phone: true, role: true },
      },
      assignedByUser: {
        select: { id: true, name: true, role: true },
      },
      reviewedByUser: {
        select: { id: true, name: true, role: true },
      },
      media: {
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

/**
 * Retrieves a single verification record strictly scoped to tenant and role.
 */
export async function getVerificationById(
  context: TenantContext,
  verificationId: string
) {
  assertPermission(context, "verification:view_assigned");

  if (!verificationId || typeof verificationId !== "string" || !verificationId.trim()) {
    throw new ValidationError("Verification ID is required.");
  }

  const verification = await prisma.propertyVerification.findFirst({
    where: {
      id: verificationId.trim(),
      tenantId: context.tenantId, // STRICT TENANT SCOPE
    },
    include: {
      property: {
        include: {
          keyHolders: true,
          media: {
            orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
          },
        },
      },
      verifier: {
        select: { id: true, name: true, email: true, phone: true, role: true },
      },
      assignedByUser: {
        select: { id: true, name: true, role: true },
      },
      reviewedByUser: {
        select: { id: true, name: true, role: true },
      },
      media: {
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!verification) {
    throw new NotFoundError("Verification record not found.");
  }

  // Enforce Field Verifier isolation: only their own tasks
  if (
    context.role === UserRole.FIELD_VERIFIER &&
    verification.verifierId !== context.userId
  ) {
    throw new ForbiddenError(
      "Field Verifiers may only access verification tasks assigned to them."
    );
  }

  return verification;
}

/**
 * Starts a field verification visit.
 * - Transitions status from ASSIGNED -> IN_PROGRESS
 * - Captures server-side startedAt timestamp
 * - Only the assigned Field Verifier can start the visit
 */
export async function startVerificationVisit(
  context: TenantContext,
  verificationId: string
) {
  assertPermission(context, "verification:start_visit");

  const verification = await getVerificationById(context, verificationId);

  if (
    context.role === UserRole.FIELD_VERIFIER &&
    verification.verifierId !== context.userId
  ) {
    throw new ForbiddenError("Only the assigned field verifier can start this visit.");
  }

  if (verification.status !== PropertyVerificationStatus.ASSIGNED) {
    throw new ValidationError(
      `Cannot start visit: current status is '${verification.status}', expected 'ASSIGNED'.`
    );
  }

  return prisma.propertyVerification.update({
    where: { id: verification.id },
    data: {
      status: PropertyVerificationStatus.IN_PROGRESS,
      startedAt: new Date(),
    },
    include: {
      property: true,
      verifier: true,
    },
  });
}

/**
 * Records that a visit could not be completed (e.g. locked door, unreachable keyholder).
 * - Transitions status from ASSIGNED/IN_PROGRESS -> UNABLE_TO_VERIFY
 * - Requires standard reason and explanatory notes
 */
export async function recordUnableToVerify(
  context: TenantContext,
  input: UnableToVerifyInput
) {
  assertPermission(context, "verification:submit_report");

  if (!input.verificationId || typeof input.verificationId !== "string" || !input.verificationId.trim()) {
    throw new ValidationError("Verification ID is required.");
  }
  if (!input.reason || !Object.values(UnableToVerifyReason).includes(input.reason)) {
    throw new ValidationError("A valid unable-to-verify reason is required.");
  }
  if (!input.notes || typeof input.notes !== "string" || !input.notes.trim()) {
    throw new ValidationError("Explanatory notes are required when marking a visit unable to verify.");
  }

  const verification = await getVerificationById(context, input.verificationId);

  if (
    context.role === UserRole.FIELD_VERIFIER &&
    verification.verifierId !== context.userId
  ) {
    throw new ForbiddenError("Only the assigned field verifier can update this task.");
  }

  const allowedStatuses: PropertyVerificationStatus[] = [
    PropertyVerificationStatus.ASSIGNED,
    PropertyVerificationStatus.IN_PROGRESS,
  ];

  if (!allowedStatuses.includes(verification.status)) {
    throw new ValidationError(
      `Cannot mark unable to verify: current status is '${verification.status}'.`
    );
  }

  return prisma.propertyVerification.update({
    where: { id: verification.id },
    data: {
      status: PropertyVerificationStatus.UNABLE_TO_VERIFY,
      unableToVerifyReason: input.reason,
      unableToVerifyNotes: input.notes.trim(),
      submittedAt: new Date(),
    },
    include: {
      property: true,
      verifier: true,
    },
  });
}

/**
 * Submits the physical verification inspection report.
 * - Transitions status from IN_PROGRESS -> SUBMITTED
 * - Validates all mandatory checklist fields
 * - Requires at least one piece of evidence (photo)
 * - Freezes report against further field edits
 */
export async function submitVerificationReport(
  context: TenantContext,
  input: SubmitVerificationInput
) {
  assertPermission(context, "verification:submit_report");

  if (!input.verificationId || typeof input.verificationId !== "string" || !input.verificationId.trim()) {
    throw new ValidationError("Verification ID is required.");
  }

  const verification = await getVerificationById(context, input.verificationId);

  if (
    context.role === UserRole.FIELD_VERIFIER &&
    verification.verifierId !== context.userId
  ) {
    throw new ForbiddenError("Only the assigned field verifier can submit this report.");
  }

  if (verification.status !== PropertyVerificationStatus.IN_PROGRESS) {
    throw new ValidationError(
      `Cannot submit verification report: visit has not been started. Current status is '${verification.status}'.`
    );
  }

  // Validate required checklist fields
  if (typeof input.physicalMatch !== "boolean") {
    throw new ValidationError("Physical existence and address match is required.");
  }
  if (
    !input.occupancyState ||
    !Object.values(VerificationOccupancyState).includes(input.occupancyState)
  ) {
    throw new ValidationError("A valid occupancy state is required.");
  }
  if (
    typeof input.actualBedrooms !== "number" ||
    isNaN(input.actualBedrooms) ||
    input.actualBedrooms < 0
  ) {
    throw new ValidationError("Observed bedroom count must be a non-negative number.");
  }
  if (
    typeof input.actualBathrooms !== "number" ||
    isNaN(input.actualBathrooms) ||
    input.actualBathrooms < 0
  ) {
    throw new ValidationError("Observed bathroom count must be a non-negative number.");
  }
  if (
    !input.propertyCondition ||
    !Object.values(PropertyCondition).includes(input.propertyCondition)
  ) {
    throw new ValidationError("Property condition rating is required.");
  }
  if (typeof input.keyHolderConfirmed !== "boolean") {
    throw new ValidationError("Key-holder availability confirmation is required.");
  }

  // Check that at least one photo has been attached to this verification task
  const mediaCount = await prisma.propertyMedia.count({
    where: {
      tenantId: context.tenantId,
      verificationId: verification.id,
    },
  });

  if (mediaCount === 0) {
    throw new ValidationError(
      "At least one inspection photo must be uploaded before submitting the verification report."
    );
  }

  return prisma.propertyVerification.update({
    where: { id: verification.id },
    data: {
      status: PropertyVerificationStatus.SUBMITTED,
      physicalMatch: input.physicalMatch,
      occupancyState: input.occupancyState,
      actualBedrooms: input.actualBedrooms,
      actualBathrooms: input.actualBathrooms,
      propertyCondition: input.propertyCondition,
      amenitiesConfirmed: input.amenitiesConfirmed || [],
      keyHolderConfirmed: input.keyHolderConfirmed,
      discrepancies: input.discrepancies?.trim() || null,
      verifierRemarks: input.verifierRemarks?.trim() || null,
      checklistResults: (input.checklistResults as Prisma.InputJsonValue) || undefined,
      submittedAt: new Date(),
    },
    include: {
      property: true,
      verifier: true,
      media: true,
    },
  });
}

/**
 * Reviews a submitted verification report (or Unable to Verify report).
 * - Authorized for Team Leader and Broker Owner.
 * - Prevents Field Verifiers from reviewing or approving their own reports.
 * - On APPROVE: Marks verification APPROVED, updates property isFieldVerified=true, fieldVerifiedAt=now.
 * - On REJECT: Requires explanatory review notes for what needs re-verification.
 */
export async function reviewVerificationReport(
  context: TenantContext,
  input: ReviewVerificationInput
) {
  assertPermission(context, "verification:review_report");

  if (!input.verificationId || typeof input.verificationId !== "string" || !input.verificationId.trim()) {
    throw new ValidationError("Verification ID is required.");
  }

  if (input.decision !== "APPROVE" && input.decision !== "REJECT") {
    throw new ValidationError("Decision must be either 'APPROVE' or 'REJECT'.");
  }

  const verification = await getVerificationById(context, input.verificationId);

  // Self-approval barrier
  if (verification.verifierId === context.userId) {
    throw new ForbiddenError(
      "Field Verifiers are strictly prohibited from reviewing or approving their own verification reports."
    );
  }

  const reviewableStatuses: PropertyVerificationStatus[] = [
    PropertyVerificationStatus.SUBMITTED,
    PropertyVerificationStatus.UNABLE_TO_VERIFY,
  ];

  if (!reviewableStatuses.includes(verification.status)) {
    throw new ValidationError(
      `Cannot review report: current status is '${verification.status}', expected 'SUBMITTED' or 'UNABLE_TO_VERIFY'.`
    );
  }

  if (input.decision === "REJECT") {
    if (!input.reviewNotes || typeof input.reviewNotes !== "string" || !input.reviewNotes.trim()) {
      throw new ValidationError(
        "Feedback notes are required when rejecting or requesting re-verification."
      );
    }

    return prisma.propertyVerification.update({
      where: { id: verification.id },
      data: {
        status: PropertyVerificationStatus.REJECTED,
        reviewedAt: new Date(),
        reviewedByUserId: context.userId,
        reviewNotes: input.reviewNotes.trim(),
      },
      include: {
        property: true,
        verifier: true,
        reviewedByUser: true,
      },
    });
  }

  // Decision === "APPROVE"
  return prisma.$transaction(async (tx) => {
    // 1. Update verification record
    const updatedVerification = await tx.propertyVerification.update({
      where: { id: verification.id },
      data: {
        status: PropertyVerificationStatus.APPROVED,
        reviewedAt: new Date(),
        reviewedByUserId: context.userId,
        reviewNotes: input.reviewNotes?.trim() || null,
      },
      include: {
        property: true,
        verifier: true,
        reviewedByUser: true,
      },
    });

    // 2. Mark property as Field Verified (only upon review approval)
    await tx.property.update({
      where: { id: verification.propertyId },
      data: {
        isFieldVerified: true,
        fieldVerifiedAt: new Date(),
      },
    });

    // 3. Mark active assignment as COMPLETED
    await tx.assignment.updateMany({
      where: {
        tenantId: context.tenantId,
        propertyId: verification.propertyId,
        assignedUserId: verification.verifierId,
        roleInAssignment: AssignmentRole.FIELD_VERIFIER,
        targetType: AssignmentTargetType.PROPERTY,
        status: AssignmentStatus.ACTIVE,
      },
      data: {
        status: AssignmentStatus.COMPLETED,
        unassignedAt: new Date(),
      },
    });

    return updatedVerification;
  });
}

/**
 * Returns statistics for verification tasks scoped strictly to the caller's authorized purview.
 */
export async function getVerificationStats(context: TenantContext) {
  assertPermission(context, "verification:view_assigned");

  const where: Prisma.PropertyVerificationWhereInput = {
    tenantId: context.tenantId,
  };

  if (context.role === UserRole.FIELD_VERIFIER) {
    where.verifierId = context.userId;
  }

  const [
    total,
    assigned,
    inProgress,
    submitted,
    approved,
    unableToVerify,
    rejected,
  ] = await Promise.all([
    prisma.propertyVerification.count({ where }),
    prisma.propertyVerification.count({
      where: { ...where, status: PropertyVerificationStatus.ASSIGNED },
    }),
    prisma.propertyVerification.count({
      where: { ...where, status: PropertyVerificationStatus.IN_PROGRESS },
    }),
    prisma.propertyVerification.count({
      where: { ...where, status: PropertyVerificationStatus.SUBMITTED },
    }),
    prisma.propertyVerification.count({
      where: { ...where, status: PropertyVerificationStatus.APPROVED },
    }),
    prisma.propertyVerification.count({
      where: { ...where, status: PropertyVerificationStatus.UNABLE_TO_VERIFY },
    }),
    prisma.propertyVerification.count({
      where: { ...where, status: PropertyVerificationStatus.REJECTED },
    }),
  ]);

  return {
    total,
    assigned,
    inProgress,
    submitted,
    approved,
    unableToVerify,
    rejected,
  };
}
