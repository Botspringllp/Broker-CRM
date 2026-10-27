import { prisma } from "../db";
import { TenantContext } from "../tenant-context";
import { assertPermission } from "../permissions";
import { NotFoundError, ValidationError } from "../errors";
import {
  UserRole,
  AssignmentTargetType,
  AssignmentRole,
  AssignmentMethod,
  AssignmentStatus,
} from "@prisma/client";

export interface AssignPropertyInput {
  propertyId: string;
  telecallerId: string;
  notes?: string;
}

export interface RoundRobinPropertyInput {
  propertyId: string;
  notes?: string;
}

export interface EligibleTelecaller {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
}

/**
 * Lists eligible active telecallers strictly scoped to the authenticated tenant.
 * Authorized for Broker Owners and Team Leaders.
 */
export async function listEligibleTelecallers(
  context: TenantContext
): Promise<EligibleTelecaller[]> {
  assertPermission(context, "assignment:assign_telecaller");

  const telecallers = await prisma.user.findMany({
    where: {
      tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
      role: UserRole.TELECALLER,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  return telecallers;
}

/**
 * Manually assigns a property validation task to a designated telecaller.
 * - Enforces "assignment:assign_telecaller" permission (Broker Owner, Team Leader).
 * - Enforces property and target user belong strictly to context.tenantId.
 * - Validates target user is an active telecaller.
 * - Prevents duplicate active assignment to the exact same telecaller.
 * - Preserves assignment history by marking previous active assignment as REASSIGNED.
 * - Persists assignment with MANUAL method and records assigning user.
 */
export async function assignPropertyManually(
  context: TenantContext,
  input: AssignPropertyInput
) {
  assertPermission(context, "assignment:assign_telecaller");

  if (!input.propertyId || typeof input.propertyId !== "string" || !input.propertyId.trim()) {
    throw new ValidationError("Property ID is required.");
  }
  if (!input.telecallerId || typeof input.telecallerId !== "string" || !input.telecallerId.trim()) {
    throw new ValidationError("Telecaller ID is required.");
  }

  // 1. Verify property belongs to the authenticated tenant
  const property = await prisma.property.findFirst({
    where: {
      id: input.propertyId.trim(),
      tenantId: context.tenantId, // STRICT TENANT SCOPE
    },
    select: { id: true, tenantId: true },
  });

  if (!property) {
    throw new NotFoundError("Property not found.");
  }

  // 2. Verify target telecaller exists, is active, is a TELECALLER, and belongs to tenant
  const targetUser = await prisma.user.findFirst({
    where: {
      id: input.telecallerId.trim(),
      tenantId: context.tenantId, // STRICT TENANT SCOPE
      role: UserRole.TELECALLER,
      isActive: true,
    },
    select: { id: true, name: true, role: true, isActive: true },
  });

  if (!targetUser) {
    throw new ValidationError(
      "Target user is not an eligible active telecaller in this brokerage."
    );
  }

  // 3. Atomically reassign and record history in a transaction
  return prisma.$transaction(async (tx) => {
    // Check for existing active assignment
    const existingActive = await tx.assignment.findFirst({
      where: {
        propertyId: property.id,
        tenantId: context.tenantId,
        targetType: AssignmentTargetType.PROPERTY,
        status: AssignmentStatus.ACTIVE,
      },
    });

    // Duplicate active-assignment prevention
    if (existingActive && existingActive.assignedUserId === targetUser.id) {
      throw new ValidationError("Property is already actively assigned to this telecaller.");
    }

    // Reassign previous assignment if one was active
    if (existingActive) {
      await tx.assignment.update({
        where: { id: existingActive.id },
        data: {
          status: AssignmentStatus.REASSIGNED,
          unassignedAt: new Date(),
        },
      });
    }

    // Create new active assignment
    const newAssignment = await tx.assignment.create({
      data: {
        tenantId: context.tenantId,
        targetType: AssignmentTargetType.PROPERTY,
        propertyId: property.id,
        assignedUserId: targetUser.id,
        assignedByUserId: context.userId,
        roleInAssignment: AssignmentRole.TELECALLER_VALIDATION,
        assignmentMethod: AssignmentMethod.MANUAL,
        status: AssignmentStatus.ACTIVE,
        notes: input.notes?.trim() || null,
      },
      include: {
        assignedUser: true,
        assignedByUser: true,
      },
    });

    await tx.property.update({
      where: { id: property.id },
      data: { updatedAt: new Date() },
    });

    return newAssignment;
  });
}

/**
 * Automatically assigns a property validation task to eligible telecallers using fair round-robin.
 * - Balances workload: selects eligible telecaller with the lowest active assignment count.
 * - If workload is tied: selects the telecaller with the oldest last assigned timestamp.
 * - Reassigns cleanly if property already has an active assignment.
 * - Throws ValidationError if no eligible telecallers exist in the tenant.
 */
export async function assignPropertyRoundRobin(
  context: TenantContext,
  input: RoundRobinPropertyInput
) {
  assertPermission(context, "assignment:assign_telecaller");

  if (!input.propertyId || typeof input.propertyId !== "string" || !input.propertyId.trim()) {
    throw new ValidationError("Property ID is required.");
  }

  // 1. Verify property belongs to the authenticated tenant
  const property = await prisma.property.findFirst({
    where: {
      id: input.propertyId.trim(),
      tenantId: context.tenantId, // STRICT TENANT SCOPE
    },
    select: { id: true, tenantId: true },
  });

  if (!property) {
    throw new NotFoundError("Property not found.");
  }

  // 2. Fetch all active telecallers in tenant
  const eligibleTelecallers = await prisma.user.findMany({
    where: {
      tenantId: context.tenantId,
      role: UserRole.TELECALLER,
      isActive: true,
    },
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  if (eligibleTelecallers.length === 0) {
    throw new ValidationError("No eligible active telecallers available in this brokerage.");
  }

  // 3. Atomically compute fair assignment and persist in transaction
  return prisma.$transaction(async (tx) => {
    // Check for existing active assignment
    const existingActive = await tx.assignment.findFirst({
      where: {
        propertyId: property.id,
        tenantId: context.tenantId,
        targetType: AssignmentTargetType.PROPERTY,
        status: AssignmentStatus.ACTIVE,
      },
    });

    // Calculate active load and latest assignment for each eligible telecaller
    const telecallerWorkloads = await Promise.all(
      eligibleTelecallers.map(async (t) => {
        const activeCount = await tx.assignment.count({
          where: {
            tenantId: context.tenantId,
            assignedUserId: t.id,
            targetType: AssignmentTargetType.PROPERTY,
            status: AssignmentStatus.ACTIVE,
          },
        });

        const lastAssignment = await tx.assignment.findFirst({
          where: {
            tenantId: context.tenantId,
            assignedUserId: t.id,
            targetType: AssignmentTargetType.PROPERTY,
          },
          orderBy: { assignedAt: "desc" },
          select: { assignedAt: true },
        });

        return {
          telecaller: t,
          activeCount,
          lastAssignedTimestamp: lastAssignment?.assignedAt ? lastAssignment.assignedAt.getTime() : 0,
        };
      })
    );

    // Sort by:
    // 1. lowest active assignment count (fair workload)
    // 2. oldest last assignment time (longest idle time)
    // 3. deterministic createdAt order
    telecallerWorkloads.sort((a, b) => {
      if (a.activeCount !== b.activeCount) {
        return a.activeCount - b.activeCount;
      }
      if (a.lastAssignedTimestamp !== b.lastAssignedTimestamp) {
        return a.lastAssignedTimestamp - b.lastAssignedTimestamp;
      }
      return a.telecaller.createdAt.getTime() - b.telecaller.createdAt.getTime();
    });

    // Select candidate: if currently active on this property and multiple telecallers exist, pick the next candidate
    let selected = telecallerWorkloads[0];
    if (
      existingActive &&
      existingActive.assignedUserId === selected.telecaller.id &&
      telecallerWorkloads.length > 1
    ) {
      selected = telecallerWorkloads[1];
    } else if (
      existingActive &&
      existingActive.assignedUserId === selected.telecaller.id &&
      telecallerWorkloads.length === 1
    ) {
      throw new ValidationError("Property is already actively assigned to this telecaller.");
    }

    // Reassign previous assignment if active
    if (existingActive) {
      await tx.assignment.update({
        where: { id: existingActive.id },
        data: {
          status: AssignmentStatus.REASSIGNED,
          unassignedAt: new Date(),
        },
      });
    }

    // Create new active assignment with ROUND_ROBIN method
    const newAssignment = await tx.assignment.create({
      data: {
        tenantId: context.tenantId,
        targetType: AssignmentTargetType.PROPERTY,
        propertyId: property.id,
        assignedUserId: selected.telecaller.id,
        assignedByUserId: context.userId,
        roleInAssignment: AssignmentRole.TELECALLER_VALIDATION,
        assignmentMethod: AssignmentMethod.ROUND_ROBIN,
        status: AssignmentStatus.ACTIVE,
        notes: input.notes?.trim() || null,
      },
      include: {
        assignedUser: true,
        assignedByUser: true,
      },
    });

    await tx.property.update({
      where: { id: property.id },
      data: { updatedAt: new Date() },
    });

    return newAssignment;
  });
}

/**
 * Retrieves the full assignment audit trail for a property strictly within the tenant.
 */
export async function getPropertyAssignmentHistory(
  context: TenantContext,
  propertyId: string
) {
  assertPermission(context, "supply:view_assigned");

  const property = await prisma.property.findFirst({
    where: {
      id: propertyId,
      tenantId: context.tenantId,
    },
    select: { id: true },
  });

  if (!property) {
    throw new NotFoundError("Property not found.");
  }

  return prisma.assignment.findMany({
    where: {
      propertyId,
      tenantId: context.tenantId,
      targetType: AssignmentTargetType.PROPERTY,
    },
    orderBy: { assignedAt: "desc" },
    include: {
      assignedUser: true,
      assignedByUser: true,
    },
  });
}
