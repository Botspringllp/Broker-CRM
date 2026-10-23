import { UserRole } from "@prisma/client";
import { TenantContext, ForbiddenError } from "./tenant-context";

/**
 * Standard Operational Actions across Phase 1 Domains
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
  // Tenant Administration
  | "admin:manage_users"
  | "admin:manage_localities"
  // Platform Super Admin
  | "platform:manage_tenants";

/**
 * Explicit PRD Role Permissions Matrix
 * Grounded in docs/Broker PRD.pdf (pages 1-9) Section 3
 */
const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<AppAction>> = {
  [UserRole.BROKER_OWNER]: new Set<AppAction>([
    "overview:view_tenant",
    "overview:view_brokerage_metrics",
    "supply:view_assigned",
    "supply:view_all",
    "supply:create",
    "supply:log_call",
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
    "admin:manage_users",
    "admin:manage_localities",
  ]),

  [UserRole.TEAM_LEADER]: new Set<AppAction>([
    "overview:view_tenant",
    "overview:view_brokerage_metrics",
    "supply:view_assigned",
    "supply:view_all",
    "supply:create",
    "supply:log_call",
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
    "admin:manage_localities",
  ]),

  [UserRole.TELECALLER]: new Set<AppAction>([
    "overview:view_tenant",
    "supply:view_assigned",
    "supply:create",
    "supply:log_call",
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
    "visits:view_all",
    "visits:view_assigned",
    "visits:record_outcome", // telecaller entering on behalf of agent (PRD §8.3)
    "visits:confirm_final",   // telecaller final review (PRD §8.3)
    "visits:record_feedback",
    "assignment:assign_sales_agent",
  ]),

  [UserRole.FIELD_VERIFIER]: new Set<AppAction>([
    "supply:create",
    "supply:upload_media",
  ]),

  [UserRole.FIELD_SALES_AGENT]: new Set<AppAction>([
    "visits:view_assigned",
    "visits:record_outcome", // direct field outcome entry (PRD §8.3)
  ]),

  [UserRole.CRM_TENANT_ADMIN]: new Set<AppAction>([
    "admin:manage_users",
    "admin:manage_localities",
  ]),

  [UserRole.PLATFORM_SUPER_ADMIN]: new Set<AppAction>([
    "overview:view_platform_metrics",
    "platform:manage_tenants",
    // NOTE (DEC-M1-03 Rule): Platform Super Admin has ZERO direct access
    // to brokerage customer data (properties, leads, visits, call logs).
  ]),
};

/**
 * Checks if a given role is granted permission for the specified action.
 * Deny-by-default: returns false if not explicitly allowed.
 */
export function hasPermission(role: UserRole, action: AppAction): boolean {
  const allowed = ROLE_PERMISSIONS[role];
  return allowed ? allowed.has(action) : false;
}

/**
 * Asserts that the authenticated tenant context possesses the required permission.
 * Throws ForbiddenError if permission is denied.
 */
export function assertPermission(context: TenantContext, action: AppAction): void {
  if (!hasPermission(context.role, action)) {
    throw new ForbiddenError(
      `Access denied: role '${context.role}' does not have permission '${action}'.`
    );
  }
}
