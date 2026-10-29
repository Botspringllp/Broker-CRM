import { prisma } from "../db";
import { TenantContext } from "../tenant-context";
import {
  assertPermission,
  canAssignRole,
  canDelegatePermission,
  canAdministerUser,
  AppAction,
} from "../permissions";
import { ForbiddenError, NotFoundError } from "../errors";
import { UserRole, Prisma } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { randomBytes } from "crypto";
import {
  sendUserInvitation,
  sendRoleChangeNotification,
  sendAccountStatusNotification,
} from "../email";

export interface CreateUserData {
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  teamLeaderId?: string | null;
  brokerId?: string | null;
  password?: string;
  delegatedPermissions?: AppAction[];
}

/**
 * Lists users within the authorized tenant and team scope.
 * - CRM Tenant Admin: All tenant users.
 * - Broker (BROKER_OWNER): Scoped to their own broker team members and themselves.
 * - Team Leader: Strictly scoped to their own subordinate team members and themselves.
 * - Other roles: Denied by default.
 */
export async function listTenantUsers(
  context: TenantContext,
  filters?: {
    role?: UserRole;
    isActive?: boolean;
    searchTerm?: string;
    brokerId?: string;
  }
) {
  assertPermission(context, "admin:view_users");

  const where: Prisma.UserWhereInput = {
    tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
  };

  // Team Leader scoping: Subordinates only (or self)
  if (context.role === UserRole.TEAM_LEADER) {
    where.OR = [
      { teamLeaderId: context.userId },
      { id: context.userId },
    ];
  } else if (context.role === UserRole.BROKER_OWNER) {
    // Broker scoping: Their assigned team leaders and subordinates only (or self)
    where.OR = [
      { brokerId: context.userId },
      { id: context.userId },
    ];
  }

  if (filters?.role) where.role = filters.role;
  if (typeof filters?.isActive === "boolean") where.isActive = filters.isActive;
  if (filters?.brokerId) where.brokerId = filters.brokerId;

  if (filters?.searchTerm) {
    const searchConditions = [
      { name: { contains: filters.searchTerm, mode: "insensitive" as const } },
      { email: { contains: filters.searchTerm, mode: "insensitive" as const } },
      { phone: { contains: filters.searchTerm } },
    ];
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: searchConditions }];
      delete where.OR;
    } else {
      where.OR = searchConditions;
    }
  }

  return prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tenantId: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      brokerId: true,
      teamLeaderId: true,
      delegatedPermissions: true,
      createdAt: true,
      updatedAt: true,
      broker: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      teamLeader: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
      subordinates: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      },
    },
  });
}

/**
 * Retrieves a user by ID strictly scoped to the tenant and authorization boundaries.
 */
export async function getTenantUserById(context: TenantContext, targetUserId: string) {
  assertPermission(context, "admin:view_users");

  const targetUser = await prisma.user.findFirst({
    where: {
      id: targetUserId,
      tenantId: context.tenantId, // STRICT TENANT SCOPE
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      brokerId: true,
      teamLeaderId: true,
      delegatedPermissions: true,
      createdAt: true,
      updatedAt: true,
      broker: {
        select: { id: true, name: true, email: true },
      },
      teamLeader: {
        select: { id: true, name: true, email: true, role: true },
      },
      subordinates: {
        select: { id: true, name: true, email: true, role: true, isActive: true },
      },
    },
  });

  if (!targetUser) {
    throw new NotFoundError("User not found.");
  }

  // If actor is Team Leader, target must be their subordinate or self
  if (
    context.role === UserRole.TEAM_LEADER &&
    targetUser.id !== context.userId &&
    targetUser.teamLeaderId !== context.userId
  ) {
    throw new NotFoundError("User not found.");
  }

  // If actor is Broker, target must belong to their broker team or self
  if (
    context.role === UserRole.BROKER_OWNER &&
    targetUser.id !== context.userId &&
    targetUser.brokerId !== context.userId
  ) {
    throw new NotFoundError("User not found.");
  }

  return targetUser;
}

/**
 * Creates or invites a user within the tenant.
 * Enforces seat limits, role boundaries, hierarchy relationships, and Better Auth credential setup.
 */
export async function createTenantUser(context: TenantContext, data: CreateUserData) {
  assertPermission(context, "admin:manage_users");

  // 1. Validate role grant authority
  if (!canAssignRole(context.role, data.role)) {
    throw new ForbiddenError(
      `Role '${context.role}' is not authorized to create or assign role '${data.role}'.`
    );
  }

  // 2. Enforce tenant seat limits
  const tenant = await prisma.tenant.findUnique({
    where: { id: context.tenantId },
    select: { name: true, maxSeats: true },
  });

  if (tenant?.maxSeats) {
    const activeUserCount = await prisma.user.count({
      where: { tenantId: context.tenantId, isActive: true },
    });
    if (activeUserCount >= tenant.maxSeats) {
      throw new ForbiddenError(
        `Tenant seat limit reached (${activeUserCount}/${tenant.maxSeats}). Cannot provision additional users.`
      );
    }
  }

  // 3. Resolve Broker and Team Leader hierarchy
  let assignedBrokerId = data.brokerId ?? null;
  let assignedTeamLeaderId = data.teamLeaderId ?? null;

  if (context.role === UserRole.BROKER_OWNER) {
    // When a Broker creates a user, they are assigned to this Broker's team
    assignedBrokerId = context.userId;

    // If assigning a team leader, verify that the designated team leader belongs to this Broker
    if (assignedTeamLeaderId) {
      const leader = await prisma.user.findFirst({
        where: {
          id: assignedTeamLeaderId,
          tenantId: context.tenantId,
          role: UserRole.TEAM_LEADER,
          brokerId: context.userId,
        },
      });
      if (!leader) {
        throw new ForbiddenError(
          "Designated team leader does not exist or does not belong to your team."
        );
      }
    }
  } else if (context.role === UserRole.TEAM_LEADER) {
    // When a Team Leader creates a user, they are direct subordinates of this Team Leader
    assignedTeamLeaderId = context.userId;
    // Inherit the Team Leader's broker
    assignedBrokerId = context.brokerId ?? context.user.brokerId ?? null;
  } else if (context.role === UserRole.CRM_TENANT_ADMIN) {
    // CRM Tenant Admin creating a Team Leader or subordinate
    if (data.role === UserRole.BROKER_OWNER) {
      assignedBrokerId = null;
      assignedTeamLeaderId = null;
    } else if (data.role === UserRole.TEAM_LEADER) {
      // Must associate Team Leader with a Broker
      if (assignedBrokerId) {
        const broker = await prisma.user.findFirst({
          where: {
            id: assignedBrokerId,
            tenantId: context.tenantId,
            role: UserRole.BROKER_OWNER,
          },
        });
        if (!broker) {
          throw new ForbiddenError("Designated Broker does not exist or is not a Broker in this tenant.");
        }
      }
    } else {
      // Subordinate operational role: verify broker / team leader if specified
      if (assignedBrokerId) {
        const broker = await prisma.user.findFirst({
          where: {
            id: assignedBrokerId,
            tenantId: context.tenantId,
            role: UserRole.BROKER_OWNER,
          },
        });
        if (!broker) {
          throw new ForbiddenError("Designated Broker does not exist in this tenant.");
        }
      }
      if (assignedTeamLeaderId) {
        const leader = await prisma.user.findFirst({
          where: {
            id: assignedTeamLeaderId,
            tenantId: context.tenantId,
            role: UserRole.TEAM_LEADER,
          },
        });
        if (!leader) {
          throw new ForbiddenError("Designated Team Leader does not exist in this tenant.");
        }
      }
    }
  }

  // 4. Validate delegated permissions if provided at creation
  const delegated = data.delegatedPermissions || [];
  for (const perm of delegated) {
    if (!canDelegatePermission(context.role, perm, context.user.delegatedPermissions)) {
      throw new ForbiddenError(
        `Cannot delegate permission '${perm}' which the granter does not possess.`
      );
    }
  }

  // 5. Hash password if provided
  let hashedPassword: string | null = null;
  if (data.password) {
    if (data.password.length < 8) {
      throw new ForbiddenError("User password must be at least 8 characters long.");
    }
    hashedPassword = await hashPassword(data.password);
  }

  const result = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        tenantId: context.tenantId,
        name: data.name,
        email: data.email.toLowerCase().trim(),
        phone: data.phone ?? "",
        role: data.role,
        isActive: true,
        brokerId: assignedBrokerId,
        teamLeaderId: assignedTeamLeaderId,
        delegatedPermissions: delegated,
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        brokerId: true,
        teamLeaderId: true,
        delegatedPermissions: true,
      },
    });

    // If password provided, initialize Better Auth credential account
    if (hashedPassword) {
      await tx.account.create({
        data: {
          userId: newUser.id,
          providerId: "credential",
          accountId: newUser.id,
          password: hashedPassword,
        },
      });
    }

    // Generate secure single-use invitation token (48h expiry)
    const invitationToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await tx.verification.create({
      data: {
        identifier: `invitation:${invitationToken}`,
        value: newUser.id,
        expiresAt,
      },
    });

    // Record immutable audit log
    await tx.userAuditLog.create({
      data: {
        tenantId: context.tenantId,
        targetUserId: newUser.id,
        actorUserId: context.userId,
        action: "USER_CREATED",
        details: {
          role: newUser.role,
          brokerId: newUser.brokerId,
          teamLeaderId: newUser.teamLeaderId,
          delegatedPermissions: newUser.delegatedPermissions,
        },
      },
    });

    return { newUser, invitationToken };
  });

  // Asynchronously dispatch user invitation email
  sendUserInvitation({
    name: result.newUser.name,
    email: result.newUser.email,
    role: result.newUser.role.replace(/_/g, " "),
    tenantName: tenant?.name || "Your Brokerage",
    token: result.invitationToken,
    expiresInHours: 48,
  }).catch((err) => {
    console.error("[Email Service Error] Failed to send invitation email:", err);
  });

  return result.newUser;
}

/**
 * Updates a user's role with strict self-escalation and privilege grant boundaries.
 */
export async function updateUserRole(
  context: TenantContext,
  targetUserId: string,
  newRole: UserRole
) {
  assertPermission(context, "admin:manage_roles");

  // Prevent self-role modification
  if (targetUserId === context.userId) {
    throw new ForbiddenError("Users are strictly prohibited from modifying their own role.");
  }

  const targetUser = await getTenantUserById(context, targetUserId);

  // Validate management authority over this target user
  if (!canAdministerUser(context, targetUser)) {
    throw new ForbiddenError("You are not authorized to administer this user.");
  }

  // Validate role grant privilege
  if (!canAssignRole(context.role, newRole)) {
    throw new ForbiddenError(
      `Role '${context.role}' is not authorized to assign role '${newRole}'.`
    );
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { role: newRole },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  });

  // Audit log
  await prisma.userAuditLog.create({
    data: {
      tenantId: context.tenantId,
      targetUserId,
      actorUserId: context.userId,
      action: "ROLE_UPDATED",
      details: {
        previousRole: targetUser.role,
        newRole,
      },
    },
  });

  // Asynchronously dispatch role update notification
  prisma.tenant
    .findUnique({
      where: { id: context.tenantId },
      select: { name: true },
    })
    .then((tenant) => {
      sendRoleChangeNotification({
        email: updated.email,
        name: updated.name,
        tenantName: tenant?.name || "Your Brokerage",
        oldRole: targetUser.role.replace(/_/g, " "),
        newRole: newRole.replace(/_/g, " "),
      }).catch((err) => {
        console.error("[Email Notification Error] Failed to send role change email:", err);
      });
    })
    .catch(() => {});

  return updated;
}

/**
 * Activates or deactivates a user account.
 * Safeguard: Cannot deactivate self or the last Broker Owner.
 */
export async function updateUserStatus(
  context: TenantContext,
  targetUserId: string,
  isActive: boolean
) {
  assertPermission(context, "admin:manage_users");

  // Prevent self-deactivation
  if (targetUserId === context.userId) {
    throw new ForbiddenError("Users are strictly prohibited from modifying their own active status.");
  }

  const targetUser = await getTenantUserById(context, targetUserId);

  if (!canAdministerUser(context, targetUser)) {
    throw new ForbiddenError("You are not authorized to administer this user.");
  }

  // Prevent deactivating the last active Broker Owner
  if (targetUser.role === UserRole.BROKER_OWNER && !isActive) {
    const ownerCount = await prisma.user.count({
      where: { tenantId: context.tenantId, role: UserRole.BROKER_OWNER, isActive: true },
    });
    if (ownerCount <= 1) {
      throw new ForbiddenError("Cannot deactivate the last active Broker Owner of the tenant.");
    }
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { isActive },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
    },
  });

  await prisma.userAuditLog.create({
    data: {
      tenantId: context.tenantId,
      targetUserId,
      actorUserId: context.userId,
      action: "STATUS_UPDATED",
      details: {
        previousStatus: targetUser.isActive,
        newStatus: isActive,
      },
    },
  });

  // Asynchronously dispatch account status notification
  prisma.tenant
    .findUnique({
      where: { id: context.tenantId },
      select: { name: true },
    })
    .then((tenant) => {
      sendAccountStatusNotification({
        email: updated.email,
        name: updated.name,
        tenantName: tenant?.name || "Your Brokerage",
        isActive,
      }).catch((err) => {
        console.error("[Email Notification Error] Failed to send account status email:", err);
      });
    })
    .catch(() => {});

  return updated;
}

/**
 * Assigns or reassigns a user's Team Leader.
 */
export async function assignUserTeamLeader(
  context: TenantContext,
  targetUserId: string,
  newTeamLeaderId: string | null
) {
  assertPermission(context, "admin:assign_team_leader");

  const targetUser = await getTenantUserById(context, targetUserId);

  if (!canAdministerUser(context, targetUser)) {
    throw new ForbiddenError("You are not authorized to administer this user.");
  }

  // Prevent self-assignment as team leader
  if (newTeamLeaderId === targetUserId) {
    throw new ForbiddenError("A user cannot be assigned as their own Team Leader.");
  }

  // If actor is Team Leader, can only assign to themselves
  if (context.role === UserRole.TEAM_LEADER && newTeamLeaderId !== context.userId) {
    throw new ForbiddenError("Team Leaders can only assign subordinates to their own team.");
  }

  // Verify leader exists and has TEAM_LEADER role in this tenant
  if (newTeamLeaderId) {
    const leader = await prisma.user.findFirst({
      where: {
        id: newTeamLeaderId,
        tenantId: context.tenantId,
        role: UserRole.TEAM_LEADER,
      },
    });
    if (!leader) {
      throw new ForbiddenError("Designated team leader does not exist or is not a Team Leader.");
    }

    // If actor is Broker, verify team leader belongs to this Broker
    if (context.role === UserRole.BROKER_OWNER && leader.brokerId !== context.userId) {
      throw new ForbiddenError("Cannot assign subordinate to a Team Leader outside your team.");
    }
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { teamLeaderId: newTeamLeaderId },
    select: {
      id: true,
      name: true,
      teamLeaderId: true,
    },
  });

  await prisma.userAuditLog.create({
    data: {
      tenantId: context.tenantId,
      targetUserId,
      actorUserId: context.userId,
      action: "TEAM_LEADER_ASSIGNED",
      details: {
        previousTeamLeaderId: targetUser.teamLeaderId,
        newTeamLeaderId,
      },
    },
  });

  return updated;
}

/**
 * Assigns or reassigns a user (Team Leader or team member) to a Broker.
 * Restricted to CRM Tenant Admin.
 */
export async function assignUserBroker(
  context: TenantContext,
  targetUserId: string,
  newBrokerId: string | null
) {
  assertPermission(context, "admin:manage_users");

  // Only CRM Tenant Admin can assign brokers to teams
  if (context.role !== UserRole.CRM_TENANT_ADMIN) {
    throw new ForbiddenError("Only CRM Tenant Admins can assign users to Broker teams.");
  }

  const targetUser = await getTenantUserById(context, targetUserId);

  if (!canAdministerUser(context, targetUser)) {
    throw new ForbiddenError("You are not authorized to administer this user.");
  }

  // Cannot assign a Broker to another Broker
  if (targetUser.role === UserRole.BROKER_OWNER) {
    throw new ForbiddenError("Brokers cannot be assigned to another Broker.");
  }

  // Prevent self-assignment
  if (newBrokerId === targetUserId) {
    throw new ForbiddenError("A user cannot be assigned as their own Broker.");
  }

  // Verify new broker exists and has BROKER_OWNER role in this tenant
  if (newBrokerId) {
    const broker = await prisma.user.findFirst({
      where: {
        id: newBrokerId,
        tenantId: context.tenantId,
        role: UserRole.BROKER_OWNER,
      },
    });
    if (!broker) {
      throw new ForbiddenError("Designated broker does not exist or is not a Broker in this tenant.");
    }
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { brokerId: newBrokerId },
    select: {
      id: true,
      name: true,
      brokerId: true,
    },
  });

  await prisma.userAuditLog.create({
    data: {
      tenantId: context.tenantId,
      targetUserId,
      actorUserId: context.userId,
      action: "BROKER_ASSIGNED",
      details: {
        previousBrokerId: targetUser.brokerId,
        newBrokerId,
      },
    },
  });

  return updated;
}

/**
 * Updates delegated permissions of a subordinate user.
 * Boundary check: Granter can ONLY grant permissions they possess, and cannot delegate core admin privileges.
 */
export async function updateDelegatedPermissions(
  context: TenantContext,
  targetUserId: string,
  permissions: AppAction[]
) {
  assertPermission(context, "admin:delegate_permissions");

  // Prevent self-delegation
  if (targetUserId === context.userId) {
    throw new ForbiddenError("Users cannot edit their own delegated permissions.");
  }

  const targetUser = await getTenantUserById(context, targetUserId);

  if (!canAdministerUser(context, targetUser)) {
    throw new ForbiddenError("You are not authorized to delegate permissions to this user.");
  }

  // Enforce granter authority for every single permission
  for (const perm of permissions) {
    if (perm === ("none" as AppAction)) continue;
    if (!canDelegatePermission(context.role, perm, context.user.delegatedPermissions)) {
      throw new ForbiddenError(
        `Cannot delegate permission '${perm}': Granter does not possess this permission.`
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { delegatedPermissions: permissions },
    select: {
      id: true,
      name: true,
      role: true,
      delegatedPermissions: true,
    },
  });

  await prisma.userAuditLog.create({
    data: {
      tenantId: context.tenantId,
      targetUserId,
      actorUserId: context.userId,
      action: "PERMISSIONS_DELEGATED",
      details: {
        previousPermissions: targetUser.delegatedPermissions,
        newPermissions: permissions,
      },
    },
  });

  return updated;
}

/**
 * Retrieves audit logs for user administration within tenant and team boundaries.
 */
export async function listUserAuditLogs(context: TenantContext, targetUserId?: string) {
  assertPermission(context, "admin:view_users");

  const where: Prisma.UserAuditLogWhereInput = {
    tenantId: context.tenantId,
  };

  if (targetUserId) {
    // Check access to target user
    await getTenantUserById(context, targetUserId);
    where.targetUserId = targetUserId;
  } else if (context.role === UserRole.TEAM_LEADER) {
    // Team Leader only sees logs for their subordinates or actions they took
    where.OR = [
      { targetUser: { teamLeaderId: context.userId } },
      { actorUserId: context.userId },
    ];
  } else if (context.role === UserRole.BROKER_OWNER) {
    // Broker sees logs for their team members or actions they took
    where.OR = [
      { targetUser: { brokerId: context.userId } },
      { actorUserId: context.userId },
    ];
  }

  return prisma.userAuditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      actorUser: {
        select: { id: true, name: true, role: true },
      },
      targetUser: {
        select: { id: true, name: true, role: true },
      },
    },
    take: 50,
  });
}

/**
 * Resends an invitation email with a freshly generated secure token.
 */
export async function resendTenantUserInvitation(
  context: TenantContext,
  targetUserId: string
) {
  assertPermission(context, "admin:manage_users");

  const targetUser = await getTenantUserById(context, targetUserId);
  if (!targetUser.isActive) {
    throw new ForbiddenError("Cannot send invitation to a deactivated user account.");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: context.tenantId },
    select: { name: true },
  });

  // Invalidate any existing invitation tokens for this user
  await prisma.verification.deleteMany({
    where: {
      value: targetUser.id,
      identifier: { startsWith: "invitation:" },
    },
  });

  const invitationToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  await prisma.verification.create({
    data: {
      identifier: `invitation:${invitationToken}`,
      value: targetUser.id,
      expiresAt,
    },
  });

  await prisma.userAuditLog.create({
    data: {
      tenantId: context.tenantId,
      targetUserId: targetUser.id,
      actorUserId: context.userId,
      action: "INVITATION_RESENT",
      details: {
        email: targetUser.email,
      },
    },
  });

  const emailResult = await sendUserInvitation({
    name: targetUser.name,
    email: targetUser.email,
    role: targetUser.role.replace(/_/g, " "),
    tenantName: tenant?.name || "Your Brokerage",
    token: invitationToken,
    expiresInHours: 48,
  });

  return { success: emailResult.success, email: targetUser.email, error: emailResult.error };
}

/**
 * Verifies an invitation token and retrieves user & tenant details for activation.
 */
export async function verifyInvitationToken(token: string) {
  if (!token || typeof token !== "string" || !token.trim()) {
    throw new NotFoundError("Invalid invitation token.");
  }

  const verification = await prisma.verification.findFirst({
    where: {
      identifier: `invitation:${token.trim()}`,
    },
  });

  if (!verification) {
    throw new NotFoundError("Invitation link is invalid or does not exist.");
  }

  if (verification.expiresAt < new Date()) {
    throw new ForbiddenError("Invitation link has expired. Please contact your administrator for a new invite.");
  }

  const user = await prisma.user.findUnique({
    where: { id: verification.value },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      tenantId: true,
      tenant: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!user || !user.isActive) {
    throw new ForbiddenError("User account is inactive or not found.");
  }

  return {
    user,
    verification,
  };
}

/**
 * Activates a user account by setting their password using the valid invitation token.
 * Consumes the token atomically.
 */
export async function activateUserAccount(token: string, password: string) {
  if (!password || password.length < 8) {
    throw new ForbiddenError("Password must be at least 8 characters long.");
  }

  const { user, verification } = await verifyInvitationToken(token);
  const hashedPassword = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    // 1. Upsert credential account with new password
    await tx.account.upsert({
      where: {
        providerId_accountId: {
          providerId: "credential",
          accountId: user.id,
        },
      },
      update: {
        password: hashedPassword,
        updatedAt: new Date(),
      },
      create: {
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: hashedPassword,
      },
    });

    // 2. Mark user email as verified
    await tx.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        updatedAt: new Date(),
      },
    });

    // 3. Delete the invitation verification token so it cannot be reused
    await tx.verification.delete({
      where: { id: verification.id },
    });

    // 4. Record audit log
    await tx.userAuditLog.create({
      data: {
        tenantId: user.tenantId,
        targetUserId: user.id,
        actorUserId: user.id,
        action: "ACCOUNT_ACTIVATED",
        details: {
          email: user.email,
        },
      },
    });

    return { success: true, email: user.email };
  });
}

export interface UpdateTenantUserProfileData {
  name?: string;
  phone?: string;
  role?: UserRole;
  teamLeaderId?: string | null;
  brokerId?: string | null;
  isActive?: boolean;
  delegatedPermissions?: AppAction[];
}

/**
 * Updates a tenant user's profile, role, hierarchy, or active status transactionally.
 * Strictly verifies admin authority, role assignment privileges, and logs audit record.
 */
export async function updateTenantUserProfile(
  context: TenantContext,
  targetUserId: string,
  data: UpdateTenantUserProfileData
) {
  assertPermission(context, "admin:manage_users");

  const targetUser = await getTenantUserById(context, targetUserId);

  if (!canAdministerUser(context, targetUser)) {
    throw new ForbiddenError("Not authorized to administer this user account.");
  }

  return prisma.$transaction(async (tx) => {
    const updatePayload: Prisma.UserUpdateInput = {};

    if (data.name !== undefined && data.name.trim()) {
      updatePayload.name = data.name.trim();
    }

    if (data.phone !== undefined) {
      updatePayload.phone = data.phone.trim();
    }

    if (data.role && data.role !== targetUser.role) {
      if (!canAssignRole(context.role, data.role)) {
        throw new ForbiddenError(
          `Role '${context.role}' is not authorized to assign role '${data.role}'.`
        );
      }
      updatePayload.role = data.role;
    }

    if (data.teamLeaderId !== undefined) {
      if (data.teamLeaderId) {
        const tl = await tx.user.findFirst({
          where: {
            id: data.teamLeaderId,
            tenantId: context.tenantId,
            role: UserRole.TEAM_LEADER,
            isActive: true,
          },
        });
        if (!tl) throw new NotFoundError("Assigned team leader not found or inactive.");
        updatePayload.teamLeader = { connect: { id: data.teamLeaderId } };
      } else {
        updatePayload.teamLeader = { disconnect: true };
      }
    }

    if (data.brokerId !== undefined) {
      if (data.brokerId) {
        const br = await tx.user.findFirst({
          where: {
            id: data.brokerId,
            tenantId: context.tenantId,
            role: UserRole.BROKER_OWNER,
            isActive: true,
          },
        });
        if (!br) throw new NotFoundError("Assigned broker not found or inactive.");
        updatePayload.broker = { connect: { id: data.brokerId } };
      } else {
        updatePayload.broker = { disconnect: true };
      }
    }

    if (typeof data.isActive === "boolean" && data.isActive !== targetUser.isActive) {
      updatePayload.isActive = data.isActive;
      if (!data.isActive) {
        await tx.session.deleteMany({
          where: { userId: targetUser.id },
        });
      }
    }

    if (data.delegatedPermissions !== undefined) {
      for (const perm of data.delegatedPermissions) {
        if (!canDelegatePermission(context.role, perm)) {
          throw new ForbiddenError(
            `Role '${context.role}' is not authorized to delegate permission '${perm}'.`
          );
        }
      }
      updatePayload.delegatedPermissions = data.delegatedPermissions;
    }

    const updated = await tx.user.update({
      where: { id: targetUser.id },
      data: updatePayload,
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        brokerId: true,
        teamLeaderId: true,
        delegatedPermissions: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await tx.userAuditLog.create({
      data: {
        tenantId: context.tenantId,
        targetUserId: targetUser.id,
        actorUserId: context.userId,
        action: "PROFILE_UPDATED",
        details: {
          changes: JSON.parse(JSON.stringify(data)),
        },
      },
    });

    return updated;
  });
}
