"use server";

import { requireTenantContext } from "@/server/tenant-context";
import {
  createTenantUser,
  updateUserRole,
  updateUserStatus,
  assignUserTeamLeader,
  assignUserBroker,
  updateDelegatedPermissions,
  resendTenantUserInvitation,
  verifyInvitationToken,
  activateUserAccount,
} from "@/server/dal/users";
import { UserRole } from "@prisma/client";
import { AppAction } from "@/server/permissions";
import { revalidatePath } from "next/cache";

export async function createUserAction(data: {
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  teamLeaderId?: string | null;
  brokerId?: string | null;
  password?: string;
  delegatedPermissions?: AppAction[];
}) {
  try {
    const context = await requireTenantContext();
    const newUser = await createTenantUser(context, data);
    revalidatePath("/users");
    return { success: true, user: newUser };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create user.";
    return { success: false, error: message };
  }
}

export async function updateUserRoleAction(targetUserId: string, newRole: UserRole) {
  try {
    const context = await requireTenantContext();
    const updated = await updateUserRole(context, targetUserId, newRole);
    revalidatePath("/users");
    return { success: true, user: updated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update role.";
    return { success: false, error: message };
  }
}

export async function updateUserStatusAction(targetUserId: string, isActive: boolean) {
  try {
    const context = await requireTenantContext();
    const updated = await updateUserStatus(context, targetUserId, isActive);
    revalidatePath("/users");
    return { success: true, user: updated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update user status.";
    return { success: false, error: message };
  }
}

export async function assignTeamLeaderAction(
  targetUserId: string,
  newTeamLeaderId: string | null
) {
  try {
    const context = await requireTenantContext();
    const updated = await assignUserTeamLeader(context, targetUserId, newTeamLeaderId);
    revalidatePath("/users");
    return { success: true, user: updated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to assign team leader.";
    return { success: false, error: message };
  }
}

export async function assignBrokerAction(
  targetUserId: string,
  newBrokerId: string | null
) {
  try {
    const context = await requireTenantContext();
    const updated = await assignUserBroker(context, targetUserId, newBrokerId);
    revalidatePath("/users");
    return { success: true, user: updated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to assign broker.";
    return { success: false, error: message };
  }
}

export async function updateDelegatedPermissionsAction(
  targetUserId: string,
  permissions: AppAction[]
) {
  try {
    const context = await requireTenantContext();
    const updated = await updateDelegatedPermissions(context, targetUserId, permissions);
    revalidatePath("/users");
    return { success: true, user: updated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update delegated permissions.";
    return { success: false, error: message };
  }
}

export async function resendInvitationAction(targetUserId: string) {
  try {
    const context = await requireTenantContext();
    const res = await resendTenantUserInvitation(context, targetUserId);
    revalidatePath("/users");
    return { success: true, email: res.email };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to resend invitation email.";
    return { success: false, error: message };
  }
}

export async function verifyInvitationTokenAction(token: string) {
  try {
    const data = await verifyInvitationToken(token);
    return {
      success: true,
      user: {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        role: data.user.role,
        tenantName: data.user.tenant.name,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid or expired invitation link.";
    return { success: false, error: message };
  }
}

export async function activateUserAccountAction(input: {
  token: string;
  password: string;
}) {
  try {
    const res = await activateUserAccount(input.token, input.password);
    return { success: true, email: res.email };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to activate account.";
    return { success: false, error: message };
  }
}
