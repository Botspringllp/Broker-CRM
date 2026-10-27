import { UserRole } from "@prisma/client";
import { ForbiddenError } from "./errors";
import type { TenantContext } from "./tenant-context";

/**
 * Standard Operational & Administrative Actions across Phase 1 Domains
 */
export type AppAction =
  // Operational Overview
  | "overview:view_tenant"
  | "overview:view_brokerage_metrics"
  | "overview:view_platform_metrics"
  // Supply Domain
  | "supply:view_assigned"
  | "supply:view_all"
  | "supply:create"
  | "supply:log_call"
  | "supply:validate"
  | "supply:upload_media"
  | "supply:mark_sold_rented"
  // Demand Domain
  | "demand:view_assigned"
  | "demand:view_all"
  | "demand:create"
  | "demand:log_call"
  | "demand:activate"
  | "demand:inactivate"
  | "demand:view_changelog"
  // Matching Engine
  | "matching:view_matches"
  | "matching:query_active_pool"
  | "matching:share_details"
  // Site Visits Domain
  | "visits:schedule"
  | "visits:view_all"
  | "visits:view_assigned"
  | "visits:record_outcome"
  | "visits:confirm_final"
  | "visits:record_feedback"
  // Assignments & Teams
  | "assignment:assign_telecaller"
  | "assignment:assign_sales_agent"
  // User & Tenant Administration
  | "admin:view_users"
  | "admin:manage_users"
  | "admin:manage_roles"
  | "admin:assign_team_leader"
  | "admin:delegate_permissions"
  | "admin:manage_localities"
  // Platform Super Admin
  | "platform:manage_tenants";

/**
 * Explicit PRD Role Permissions Matrix
 * Grounded in docs/Broker PRD.pdf (pages 1-9) Section 3
 */
export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<AppAction>> = {
  [UserRole.BROKER_OWNER]: new Set<AppAction>([
    "overview:view_tenant",
    "overview:view_brokerage_metrics",
    "supply:view_assigned",
    "supply:view_all",
    "supply:create",
    "supply:log_call",
    "supply:validate",
    "supply:upload_media",
    "supply:mark_sold_rented",
    "demand:view_assigned",
    "demand:view_all",
    "demand:create",
    "demand:log_call",
    "demand:activate",
    "demand:inactivate",
    "demand:view_changelog",
    "matching:view_matches",
    "matching:query_active_pool",
    "matching:share_details",
    "visits:schedule",
    "visits:view_all",
    "visits:view_assigned",
    "visits:record_outcome",
    "visits:confirm_final",
    "visits:record_feedback",
    "assignment:assign_telecaller",
    "assignment:assign_sales_agent",
    "admin:view_users",
    "admin:manage_users",
    "admin:manage_roles",
    "admin:assign_team_leader",
    "admin:delegate_permissions",
    "admin:manage_localities",
  ]),

  [UserRole.TEAM_LEADER]: new Set<AppAction>([
    "overview:view_tenant",
    "overview:view_brokerage_metrics",
    "supply:view_assigned",
    "supply:view_all",
    "supply:create",
    "supply:log_call",
    "supply:validate",
    "supply:upload_media",
    "supply:mark_sold_rented",
    "demand:view_assigned",
    "demand:view_all",
    "demand:create",
    "demand:log_call",
    "demand:activate",
    "demand:inactivate",
    "demand:view_changelog",
    "matching:view_matches",
    "matching:query_active_pool",
    "matching:share_details",
    "visits:schedule",
    "visits:view_all",
    "visits:view_assigned",
    "visits:record_outcome",
    "visits:confirm_final",
    "visits:record_feedback",
    "assignment:assign_telecaller",
    "assignment:assign_sales_agent",
    "admin:view_users",
    "admin:assign_team_leader",
    "admin:delegate_permissions",
    "admin:manage_localities",
  ]),

  [UserRole.TELECALLER]: new Set<AppAction>([
    "overview:view_tenant",
    "supply:view_assigned",
    "supply:create",
    "supply:log_call",
    "supply:validate",
    "supply:upload_media",
    "supply:mark_sold_rented",
    "demand:view_assigned",
    "demand:create",
    "demand:log_call",
    "demand:activate",
    "demand:inactivate",
    "demand:view_changelog",
    "matching:view_matches",
    "matching:query_active_pool",
    "matching:share_details",
    "visits:schedule",
    "visits:view_assigned",
    "visits:record_outcome", // telecaller entering on behalf of agent (PRD §8.3)
    "visits:confirm_final",   // telecaller final review (PRD §8.3)
    "visits:record_feedback",
    "assignment:assign_sales_agent",
  ]),

  [UserRole.FIELD_VERIFIER]: new Set<AppAction>([
    "supply:view_assigned",
    "supply:create",
    "supply:upload_media",
    // NOTE: Keep property creation separate from permission to approve or finalize verification
  ]),

  [UserRole.FIELD_SALES_AGENT]: new Set<AppAction>([
    "visits:view_assigned",
    "visits:record_outcome", // direct field outcome entry (PRD §8.3)
    "visits:record_feedback",
  ]),

  [UserRole.CRM_TENANT_ADMIN]: new Set<AppAction>([
    "admin:view_users",
    "admin:manage_users",
    "admin:manage_roles",
    "admin:assign_team_leader",
    "admin:delegate_permissions",
    "admin:manage_localities",
    // NOTE: No default access to operational property, lead, or site-visit data
  ]),

  [UserRole.PLATFORM_SUPER_ADMIN]: new Set<AppAction>([
    "overview:view_platform_metrics",
    "platform:manage_tenants",
    // NOTE: Platform Super Admin has ZERO direct access
    // to brokerage customer data (properties, leads, visits, call logs).
  ]),
};

/**
 * Checks if a given role (and optional delegated permissions) is granted permission for the specified action.
 * Deny-by-default: returns false if not explicitly allowed.
 */
export function hasPermission(
  role: UserRole,
  action: AppAction,
  delegatedPermissions?: string[]
): boolean {
  const allowed = ROLE_PERMISSIONS[role];
  if (allowed && allowed.has(action)) {
    return true;
  }
  if (delegatedPermissions && delegatedPermissions.includes(action)) {
    return true;
  }
  return false;
}

/**
 * Asserts that the authenticated tenant context possesses the required permission.
 * Throws ForbiddenError if permission is denied.
 */
export function assertPermission(context: TenantContext, action: AppAction): void {
  const delegated = context.user.delegatedPermissions || context.delegatedPermissions;
  if (!hasPermission(context.role, action, delegated)) {
    throw new ForbiddenError(
      `Access denied: role '${context.role}' lacks permission for '${action}'.`
    );
  }
}

/**
 * Validates whether an actor role is permitted to assign a given target role.
 * Enforces strict role boundary rules:
 * - Broker Owner can assign: Team Leader, Telecaller, Field Verifier, Field Sales Agent, Tenant Admin.
 * - Tenant Admin can assign: Team Leader, Telecaller, Field Verifier, Field Sales Agent.
 * - Team Leader can assign only subordinates: Telecaller, Field Verifier, Field Sales Agent.
 * - No tenant user can ever grant Platform Super Admin.
 */
export function canAssignRole(actorRole: UserRole, targetRole: UserRole): boolean {
  switch (actorRole) {
    case UserRole.PLATFORM_SUPER_ADMIN: {
      const allowed: UserRole[] = [UserRole.CRM_TENANT_ADMIN];
      return allowed.includes(targetRole);
    }

    case UserRole.CRM_TENANT_ADMIN: {
      const allowed: UserRole[] = [
        UserRole.BROKER_OWNER,
        UserRole.TEAM_LEADER,
        UserRole.TELECALLER,
        UserRole.FIELD_VERIFIER,
        UserRole.FIELD_SALES_AGENT,
      ];
      return allowed.includes(targetRole);
    }

    case UserRole.BROKER_OWNER: {
      const allowed: UserRole[] = [
        UserRole.TEAM_LEADER,
        UserRole.TELECALLER,
        UserRole.FIELD_VERIFIER,
        UserRole.FIELD_SALES_AGENT,
      ];
      return allowed.includes(targetRole);
    }

    case UserRole.TEAM_LEADER: {
      const allowed: UserRole[] = [
        UserRole.TELECALLER,
        UserRole.FIELD_VERIFIER,
        UserRole.FIELD_SALES_AGENT,
      ];
      return allowed.includes(targetRole);
    }

    default:
      return false;
  }
}

/**
 * Validates whether an actor can delegate a specific permission to a subordinate.
 * Invariant: The granter MUST possess the permission themselves, and administrative
 * core privilege actions cannot be delegated.
 */
export function canDelegatePermission(
  actorRole: UserRole,
  action: AppAction,
  actorDelegated?: string[]
): boolean {
  // Disallowed from delegation (administrative lock)
  const nonDelegableActions: AppAction[] = [
    "admin:manage_users",
    "admin:manage_roles",
    "admin:delegate_permissions",
    "platform:manage_tenants",
  ];

  if (nonDelegableActions.includes(action)) {
    return false;
  }

  // CRM Tenant Admin has authority to configure operational permissions for tenant users
  if (actorRole === UserRole.CRM_TENANT_ADMIN) {
    return true;
  }

  // Actor must possess the permission to delegate it
  return hasPermission(actorRole, action, actorDelegated);
}

/**
 * Validates whether an actor context has authority to administer a target user.
 * Prevents self-escalation, cross-tenant leaks, and unauthorized team administration.
 */
export function canAdministerUser(
  actorContext: TenantContext,
  targetUser: {
    id: string;
    tenantId: string;
    role: UserRole;
    teamLeaderId?: string | null;
    brokerId?: string | null;
  }
): boolean {
  // Cross-tenant barrier
  if (targetUser.tenantId !== actorContext.tenantId) {
    return false;
  }

  // Self-escalation barrier: A user cannot modify their own administrative status or role
  if (targetUser.id === actorContext.userId) {
    return false;
  }

  // Platform Super Admin cannot administer tenant users directly
  if (actorContext.role === UserRole.PLATFORM_SUPER_ADMIN) {
    return false;
  }

  // Broker (BROKER_OWNER) can administer subordinates in their own team
  if (actorContext.role === UserRole.BROKER_OWNER) {
    // Cannot administer another Broker
    if (targetUser.role === UserRole.BROKER_OWNER) return false;
    // Cannot administer CRM Tenant Admin or Platform Super Admin
    if (
      targetUser.role === UserRole.CRM_TENANT_ADMIN ||
      targetUser.role === UserRole.PLATFORM_SUPER_ADMIN
    ) {
      return false;
    }
    // Cannot administer a user belonging to another Broker's team
    if (targetUser.brokerId && targetUser.brokerId !== actorContext.userId) {
      return false;
    }
    return true;
  }

  // CRM Tenant Admin can administer tenant users except other Tenant Admins or Platform Super Admin
  if (actorContext.role === UserRole.CRM_TENANT_ADMIN) {
    return (
      targetUser.role !== UserRole.CRM_TENANT_ADMIN &&
      targetUser.role !== UserRole.PLATFORM_SUPER_ADMIN
    );
  }

  // Team Leader can ONLY administer their own subordinates
  if (actorContext.role === UserRole.TEAM_LEADER) {
    const isSubordinate = targetUser.teamLeaderId === actorContext.userId;
    const subordinateRoles: UserRole[] = [
      UserRole.TELECALLER,
      UserRole.FIELD_VERIFIER,
      UserRole.FIELD_SALES_AGENT,
    ];
    const isSubordinateRole = subordinateRoles.includes(targetUser.role);
    return isSubordinate && isSubordinateRole;
  }

  return false;
}
