import { describe, it, expect } from "vitest";
import { UserRole } from "@prisma/client";
import { hasPermission, assertPermission } from "@/server/permissions";
import { TenantContext, ForbiddenError } from "@/server/tenant-context";

describe("RBAC Permissions Matrix (PRD §3)", () => {
  const createContext = (role: UserRole, tenantId = "tenant-apex"): TenantContext => ({
    userId: `user-${role.toLowerCase()}`,
    tenantId,
    role,
    user: {
      id: `user-${role.toLowerCase()}`,
      email: `${role.toLowerCase()}@example.in`,
      name: `Test ${role}`,
      role,
      tenantId,
      isActive: true,
    },
    session: {
      id: "sess-test",
      token: "tok-test",
      expiresAt: new Date(Date.now() + 60000),
    },
  });

  describe("Broker / Owner Role", () => {
    const ownerContext = createContext(UserRole.BROKER_OWNER);

    it("has access to overall brokerage metrics and user management", () => {
      expect(hasPermission(UserRole.BROKER_OWNER, "overview:view_brokerage_metrics")).toBe(true);
      expect(hasPermission(UserRole.BROKER_OWNER, "admin:manage_users")).toBe(true);
      expect(hasPermission(UserRole.BROKER_OWNER, "admin:manage_localities")).toBe(true);
      expect(() => assertPermission(ownerContext, "admin:manage_users")).not.toThrow();
    });

    it("has full access to supply, demand, matching, and visits", () => {
      expect(hasPermission(UserRole.BROKER_OWNER, "supply:view_all")).toBe(true);
      expect(hasPermission(UserRole.BROKER_OWNER, "demand:view_all")).toBe(true);
      expect(hasPermission(UserRole.BROKER_OWNER, "matching:view_matches")).toBe(true);
      expect(hasPermission(UserRole.BROKER_OWNER, "visits:schedule")).toBe(true);
      expect(hasPermission(UserRole.BROKER_OWNER, "assignment:assign_telecaller")).toBe(true);
    });

    it("does not have platform super admin privileges", () => {
      expect(hasPermission(UserRole.BROKER_OWNER, "platform:manage_tenants")).toBe(false);
      expect(hasPermission(UserRole.BROKER_OWNER, "overview:view_platform_metrics")).toBe(false);
      expect(() => assertPermission(ownerContext, "platform:manage_tenants")).toThrow(ForbiddenError);
    });
  });

  describe("Team Leader / Manager Role", () => {
    const tlContext = createContext(UserRole.TEAM_LEADER);

    it("has operational management permissions but not user account creation", () => {
      expect(hasPermission(UserRole.TEAM_LEADER, "overview:view_brokerage_metrics")).toBe(true);
      expect(hasPermission(UserRole.TEAM_LEADER, "supply:view_all")).toBe(true);
      expect(hasPermission(UserRole.TEAM_LEADER, "demand:view_all")).toBe(true);
      expect(hasPermission(UserRole.TEAM_LEADER, "assignment:assign_telecaller")).toBe(true);
      expect(hasPermission(UserRole.TEAM_LEADER, "admin:manage_localities")).toBe(true);

      // User account management is restricted to Owner & CRM Tenant Admin
      expect(hasPermission(UserRole.TEAM_LEADER, "admin:manage_users")).toBe(false);
      expect(() => assertPermission(tlContext, "admin:manage_users")).toThrow(ForbiddenError);
    });
  });

  describe("Telecaller Role", () => {
    const telecallerContext = createContext(UserRole.TELECALLER);

    it("has core telecaller permissions (assigned supply/demand, call logging, matching, visit scheduling)", () => {
      expect(hasPermission(UserRole.TELECALLER, "supply:view_assigned")).toBe(true);
      expect(hasPermission(UserRole.TELECALLER, "supply:log_call")).toBe(true);
      expect(hasPermission(UserRole.TELECALLER, "demand:view_assigned")).toBe(true);
      expect(hasPermission(UserRole.TELECALLER, "demand:log_call")).toBe(true);
      expect(hasPermission(UserRole.TELECALLER, "demand:activate")).toBe(true);
      expect(hasPermission(UserRole.TELECALLER, "demand:inactivate")).toBe(true);
      expect(hasPermission(UserRole.TELECALLER, "matching:query_active_pool")).toBe(true);
      expect(hasPermission(UserRole.TELECALLER, "matching:share_details")).toBe(true);
      expect(hasPermission(UserRole.TELECALLER, "visits:schedule")).toBe(true);
      expect(hasPermission(UserRole.TELECALLER, "visits:record_outcome")).toBe(true);
      expect(hasPermission(UserRole.TELECALLER, "visits:confirm_final")).toBe(true);
      expect(hasPermission(UserRole.TELECALLER, "assignment:assign_sales_agent")).toBe(true);
    });

    it("is denied managerial and admin permissions", () => {
      expect(hasPermission(UserRole.TELECALLER, "overview:view_brokerage_metrics")).toBe(false);
      expect(hasPermission(UserRole.TELECALLER, "supply:view_all")).toBe(false);
      expect(hasPermission(UserRole.TELECALLER, "demand:view_all")).toBe(false);
      expect(hasPermission(UserRole.TELECALLER, "assignment:assign_telecaller")).toBe(false);
      expect(hasPermission(UserRole.TELECALLER, "admin:manage_users")).toBe(false);
      expect(hasPermission(UserRole.TELECALLER, "admin:manage_localities")).toBe(false);

      expect(() => assertPermission(telecallerContext, "supply:view_all")).toThrow(ForbiddenError);
      expect(() => assertPermission(telecallerContext, "admin:manage_users")).toThrow(ForbiddenError);
    });
  });

  describe("Field Verifier Role", () => {
    const verifierContext = createContext(UserRole.FIELD_VERIFIER);

    it("only has property onboarding and media upload permissions", () => {
      expect(hasPermission(UserRole.FIELD_VERIFIER, "supply:create")).toBe(true);
      expect(hasPermission(UserRole.FIELD_VERIFIER, "supply:upload_media")).toBe(true);

      // Denied everything else
      expect(hasPermission(UserRole.FIELD_VERIFIER, "supply:view_assigned")).toBe(false);
      expect(hasPermission(UserRole.FIELD_VERIFIER, "demand:create")).toBe(false);
      expect(hasPermission(UserRole.FIELD_VERIFIER, "visits:view_assigned")).toBe(false);
      expect(() => assertPermission(verifierContext, "demand:create")).toThrow(ForbiddenError);
    });
  });

  describe("Field Sales Agent Role", () => {
    const agentContext = createContext(UserRole.FIELD_SALES_AGENT);

    it("has access only to assigned visits and outcome recording", () => {
      expect(hasPermission(UserRole.FIELD_SALES_AGENT, "visits:view_assigned")).toBe(true);
      expect(hasPermission(UserRole.FIELD_SALES_AGENT, "visits:record_outcome")).toBe(true);

      // Denied supply creation, demand creation, visit scheduling
      expect(hasPermission(UserRole.FIELD_SALES_AGENT, "supply:create")).toBe(false);
      expect(hasPermission(UserRole.FIELD_SALES_AGENT, "demand:create")).toBe(false);
      expect(hasPermission(UserRole.FIELD_SALES_AGENT, "visits:schedule")).toBe(false);
      expect(hasPermission(UserRole.FIELD_SALES_AGENT, "visits:view_all")).toBe(false);
      expect(() => assertPermission(agentContext, "visits:schedule")).toThrow(ForbiddenError);
    });
  });

  describe("CRM Tenant Admin Role", () => {
    const adminContext = createContext(UserRole.CRM_TENANT_ADMIN);

    it("can manage users and localities but not operational deals or platform config", () => {
      expect(hasPermission(UserRole.CRM_TENANT_ADMIN, "admin:manage_users")).toBe(true);
      expect(hasPermission(UserRole.CRM_TENANT_ADMIN, "admin:manage_localities")).toBe(true);

      expect(hasPermission(UserRole.CRM_TENANT_ADMIN, "supply:view_assigned")).toBe(false);
      expect(hasPermission(UserRole.CRM_TENANT_ADMIN, "demand:view_assigned")).toBe(false);
      expect(hasPermission(UserRole.CRM_TENANT_ADMIN, "platform:manage_tenants")).toBe(false);
      expect(() => assertPermission(adminContext, "supply:create")).toThrow(ForbiddenError);
    });
  });

  describe("Platform Super Admin Role (DEC-M1-03 Boundary)", () => {
    const superAdminContext = createContext(UserRole.PLATFORM_SUPER_ADMIN, "tenant-platform");

    it("has platform-level access but NO direct access to brokerage customer data", () => {
      expect(hasPermission(UserRole.PLATFORM_SUPER_ADMIN, "platform:manage_tenants")).toBe(true);
      expect(hasPermission(UserRole.PLATFORM_SUPER_ADMIN, "overview:view_platform_metrics")).toBe(true);

      // Strict Customer Data Isolation
      expect(hasPermission(UserRole.PLATFORM_SUPER_ADMIN, "supply:view_assigned")).toBe(false);
      expect(hasPermission(UserRole.PLATFORM_SUPER_ADMIN, "supply:view_all")).toBe(false);
      expect(hasPermission(UserRole.PLATFORM_SUPER_ADMIN, "supply:create")).toBe(false);
      expect(hasPermission(UserRole.PLATFORM_SUPER_ADMIN, "demand:view_assigned")).toBe(false);
      expect(hasPermission(UserRole.PLATFORM_SUPER_ADMIN, "demand:view_all")).toBe(false);
      expect(hasPermission(UserRole.PLATFORM_SUPER_ADMIN, "matching:view_matches")).toBe(false);
      expect(hasPermission(UserRole.PLATFORM_SUPER_ADMIN, "visits:view_all")).toBe(false);

      expect(() => assertPermission(superAdminContext, "supply:view_all")).toThrow(ForbiddenError);
      expect(() => assertPermission(superAdminContext, "demand:view_all")).toThrow(ForbiddenError);
    });
  });
});

