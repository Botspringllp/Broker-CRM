import { describe, it, expect } from "vitest";
import { UserRole } from "@prisma/client";
import {
  hasPermission,
  assertPermission,
  canAssignRole,
  canDelegatePermission,
  canAdministerUser,
} from "@/server/permissions";
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
      expect(hasPermission(UserRole.BROKER_OWNER, "verification:assign")).toBe(true);
      expect(hasPermission(UserRole.BROKER_OWNER, "verification:review_report")).toBe(true);
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
      expect(hasPermission(UserRole.TEAM_LEADER, "verification:assign")).toBe(true);
      expect(hasPermission(UserRole.TEAM_LEADER, "verification:review_report")).toBe(true);

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
      expect(hasPermission(UserRole.TELECALLER, "verification:assign")).toBe(false);
      expect(hasPermission(UserRole.TELECALLER, "verification:submit_report")).toBe(false);
      expect(hasPermission(UserRole.TELECALLER, "verification:review_report")).toBe(false);
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

    it("has property onboarding, media upload, and assigned view permissions, but strictly denied validation approval", () => {
      expect(hasPermission(UserRole.FIELD_VERIFIER, "supply:create")).toBe(true);
      expect(hasPermission(UserRole.FIELD_VERIFIER, "supply:upload_media")).toBe(true);
      expect(hasPermission(UserRole.FIELD_VERIFIER, "supply:view_assigned")).toBe(true);
      expect(hasPermission(UserRole.FIELD_VERIFIER, "verification:view_assigned")).toBe(true);
      expect(hasPermission(UserRole.FIELD_VERIFIER, "verification:start_visit")).toBe(true);
      expect(hasPermission(UserRole.FIELD_VERIFIER, "verification:submit_report")).toBe(true);
      expect(hasPermission(UserRole.FIELD_VERIFIER, "verification:assign")).toBe(false);
      expect(hasPermission(UserRole.FIELD_VERIFIER, "verification:review_report")).toBe(false);

      // Creation is strictly separated from verification approval (PRD §3)
      expect(hasPermission(UserRole.FIELD_VERIFIER, "supply:validate")).toBe(false);
      expect(() => assertPermission(verifierContext, "supply:validate")).toThrow(ForbiddenError);

      // Denied non-verifier operations
      expect(hasPermission(UserRole.FIELD_VERIFIER, "demand:create")).toBe(false);
      expect(hasPermission(UserRole.FIELD_VERIFIER, "visits:view_assigned")).toBe(false);
      expect(() => assertPermission(verifierContext, "demand:create")).toThrow(ForbiddenError);
    });

    it("preserves core verification capabilities even if legacy delegatedPermissions lacked verification actions", () => {
      const legacyDelegated = ["supply:view_assigned", "supply:create", "supply:upload_media"];
      expect(hasPermission(UserRole.FIELD_VERIFIER, "verification:view_assigned", legacyDelegated)).toBe(true);
      expect(hasPermission(UserRole.FIELD_VERIFIER, "verification:start_visit", legacyDelegated)).toBe(true);
      expect(hasPermission(UserRole.FIELD_VERIFIER, "verification:submit_report", legacyDelegated)).toBe(true);
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

  describe("Role Assignment Boundaries (canAssignRole)", () => {
    it("allows Broker Owner to assign team leaders and operational agents, but not tenant admin or platform super admin", () => {
      expect(canAssignRole(UserRole.BROKER_OWNER, UserRole.TEAM_LEADER)).toBe(true);
      expect(canAssignRole(UserRole.BROKER_OWNER, UserRole.TELECALLER)).toBe(true);
      expect(canAssignRole(UserRole.BROKER_OWNER, UserRole.FIELD_VERIFIER)).toBe(true);
      expect(canAssignRole(UserRole.BROKER_OWNER, UserRole.FIELD_SALES_AGENT)).toBe(true);
      expect(canAssignRole(UserRole.BROKER_OWNER, UserRole.CRM_TENANT_ADMIN)).toBe(false);
      expect(canAssignRole(UserRole.BROKER_OWNER, UserRole.BROKER_OWNER)).toBe(false);
      expect(canAssignRole(UserRole.BROKER_OWNER, UserRole.PLATFORM_SUPER_ADMIN)).toBe(false);
    });

    it("allows CRM Tenant Admin to assign broker owners, team leaders, and operational roles, but not platform admin", () => {
      expect(canAssignRole(UserRole.CRM_TENANT_ADMIN, UserRole.BROKER_OWNER)).toBe(true);
      expect(canAssignRole(UserRole.CRM_TENANT_ADMIN, UserRole.TEAM_LEADER)).toBe(true);
      expect(canAssignRole(UserRole.CRM_TENANT_ADMIN, UserRole.TELECALLER)).toBe(true);
      expect(canAssignRole(UserRole.CRM_TENANT_ADMIN, UserRole.FIELD_VERIFIER)).toBe(true);
      expect(canAssignRole(UserRole.CRM_TENANT_ADMIN, UserRole.FIELD_SALES_AGENT)).toBe(true);
      expect(canAssignRole(UserRole.CRM_TENANT_ADMIN, UserRole.CRM_TENANT_ADMIN)).toBe(false);
      expect(canAssignRole(UserRole.CRM_TENANT_ADMIN, UserRole.PLATFORM_SUPER_ADMIN)).toBe(false);
    });

    it("allows Platform Super Admin to assign CRM Tenant Admin only", () => {
      expect(canAssignRole(UserRole.PLATFORM_SUPER_ADMIN, UserRole.CRM_TENANT_ADMIN)).toBe(true);
      expect(canAssignRole(UserRole.PLATFORM_SUPER_ADMIN, UserRole.BROKER_OWNER)).toBe(false);
      expect(canAssignRole(UserRole.PLATFORM_SUPER_ADMIN, UserRole.TEAM_LEADER)).toBe(false);
      expect(canAssignRole(UserRole.PLATFORM_SUPER_ADMIN, UserRole.PLATFORM_SUPER_ADMIN)).toBe(false);
    });

    it("allows Team Leader to assign only subordinate tiers", () => {
      expect(canAssignRole(UserRole.TEAM_LEADER, UserRole.TELECALLER)).toBe(true);
      expect(canAssignRole(UserRole.TEAM_LEADER, UserRole.FIELD_VERIFIER)).toBe(true);
      expect(canAssignRole(UserRole.TEAM_LEADER, UserRole.FIELD_SALES_AGENT)).toBe(true);

      // Cannot assign equal or superior roles
      expect(canAssignRole(UserRole.TEAM_LEADER, UserRole.TEAM_LEADER)).toBe(false);
      expect(canAssignRole(UserRole.TEAM_LEADER, UserRole.CRM_TENANT_ADMIN)).toBe(false);
      expect(canAssignRole(UserRole.TEAM_LEADER, UserRole.BROKER_OWNER)).toBe(false);
      expect(canAssignRole(UserRole.TEAM_LEADER, UserRole.PLATFORM_SUPER_ADMIN)).toBe(false);
    });

    it("denies operational roles from assigning any roles", () => {
      expect(canAssignRole(UserRole.TELECALLER, UserRole.TELECALLER)).toBe(false);
      expect(canAssignRole(UserRole.FIELD_VERIFIER, UserRole.FIELD_VERIFIER)).toBe(false);
      expect(canAssignRole(UserRole.FIELD_SALES_AGENT, UserRole.FIELD_SALES_AGENT)).toBe(false);
    });
  });

  describe("Permission Delegation Invariants (canDelegatePermission)", () => {
    it("allows delegating permissions that the granter possesses", () => {
      expect(canDelegatePermission(UserRole.BROKER_OWNER, "supply:validate")).toBe(true);
      expect(canDelegatePermission(UserRole.TEAM_LEADER, "supply:log_call")).toBe(true);
      expect(canDelegatePermission(UserRole.TEAM_LEADER, "visits:schedule")).toBe(true);
    });

    it("prohibits delegating core administrative privileges even if possessed", () => {
      expect(canDelegatePermission(UserRole.BROKER_OWNER, "admin:manage_users")).toBe(false);
      expect(canDelegatePermission(UserRole.BROKER_OWNER, "admin:manage_roles")).toBe(false);
      expect(canDelegatePermission(UserRole.BROKER_OWNER, "admin:delegate_permissions")).toBe(false);
      expect(canDelegatePermission(UserRole.BROKER_OWNER, "platform:manage_tenants")).toBe(false);
    });

    it("prohibits delegating permissions that the granter does not possess", () => {
      expect(canDelegatePermission(UserRole.TELECALLER, "supply:view_all")).toBe(false);
      expect(canDelegatePermission(UserRole.FIELD_VERIFIER, "demand:create")).toBe(false);
      expect(canDelegatePermission(UserRole.TEAM_LEADER, "platform:manage_tenants")).toBe(false);
    });

    it("allows delegation of permitted actions granted via existing delegated permissions", () => {
      // Telecaller who was delegated "supply:view_all"
      expect(
        canDelegatePermission(UserRole.TELECALLER, "supply:view_all", ["supply:view_all"])
      ).toBe(true);
    });
  });

  describe("User Administration Scope (canAdministerUser)", () => {
    const ownerContext = createContext(UserRole.BROKER_OWNER, "tenant-apex");
    const tlContext = createContext(UserRole.TEAM_LEADER, "tenant-apex");
    const adminContext = createContext(UserRole.CRM_TENANT_ADMIN, "tenant-apex");

    it("enforces strict cross-tenant barrier", () => {
      const foreignUser = {
        id: "foreign-1",
        tenantId: "tenant-horizon",
        role: UserRole.TELECALLER,
      };

      expect(canAdministerUser(ownerContext, foreignUser)).toBe(false);
      expect(canAdministerUser(tlContext, foreignUser)).toBe(false);
      expect(canAdministerUser(adminContext, foreignUser)).toBe(false);
    });

    it("enforces self-escalation barrier: users cannot administer themselves", () => {
      const selfOwner = {
        id: ownerContext.userId,
        tenantId: "tenant-apex",
        role: UserRole.BROKER_OWNER,
      };
      const selfTl = {
        id: tlContext.userId,
        tenantId: "tenant-apex",
        role: UserRole.TEAM_LEADER,
      };

      expect(canAdministerUser(ownerContext, selfOwner)).toBe(false);
      expect(canAdministerUser(tlContext, selfTl)).toBe(false);
    });

    it("allows Broker Owner to administer anyone in their tenant except another Broker Owner", () => {
      const telecaller = {
        id: "tc-1",
        tenantId: "tenant-apex",
        role: UserRole.TELECALLER,
        brokerId: ownerContext.userId,
      };
      const otherOwner = {
        id: "owner-2",
        tenantId: "tenant-apex",
        role: UserRole.BROKER_OWNER,
      };

      expect(canAdministerUser(ownerContext, telecaller)).toBe(true);
      expect(canAdministerUser(ownerContext, otherOwner)).toBe(false);
    });

    it("enforces broker team boundary: Broker 1 cannot administer users assigned to Broker 2", () => {
      const broker2Subordinate = {
        id: "tc-b2",
        tenantId: "tenant-apex",
        role: UserRole.TELECALLER,
        brokerId: "other-broker-2",
      };

      expect(canAdministerUser(ownerContext, broker2Subordinate)).toBe(false);
    });

    it("allows CRM Tenant Admin to administer all brokers and team members within the tenant", () => {
      const broker1 = {
        id: "broker-1",
        tenantId: "tenant-apex",
        role: UserRole.BROKER_OWNER,
      };
      const broker2Member = {
        id: "tc-b2",
        tenantId: "tenant-apex",
        role: UserRole.TELECALLER,
        brokerId: "broker-2",
      };

      expect(canAdministerUser(adminContext, broker1)).toBe(true);
      expect(canAdministerUser(adminContext, broker2Member)).toBe(true);
    });

    it("allows Team Leader to administer ONLY direct subordinates within authorized roles", () => {
      const subordinateTelecaller = {
        id: "sub-tc-1",
        tenantId: "tenant-apex",
        role: UserRole.TELECALLER,
        teamLeaderId: tlContext.userId,
      };
      const unassignedTelecaller = {
        id: "other-tc-2",
        tenantId: "tenant-apex",
        role: UserRole.TELECALLER,
        teamLeaderId: "other-tl-id",
      };
      const peerTeamLeader = {
        id: "peer-tl-1",
        tenantId: "tenant-apex",
        role: UserRole.TEAM_LEADER,
        teamLeaderId: tlContext.userId, // Even if assigned, TeamLeader role cannot be administered by peer TL
      };

      expect(canAdministerUser(tlContext, subordinateTelecaller)).toBe(true);
      expect(canAdministerUser(tlContext, unassignedTelecaller)).toBe(false);
      expect(canAdministerUser(tlContext, peerTeamLeader)).toBe(false);
    });
  });

  describe("Delegated Permissions Dynamic Enforcement", () => {
    it("grants access to delegated action not normally available to the base role", () => {
      // Telecaller does not normally have supply:view_all
      expect(hasPermission(UserRole.TELECALLER, "supply:view_all")).toBe(false);

      // With delegated permission, access is granted
      expect(hasPermission(UserRole.TELECALLER, "supply:view_all", ["supply:view_all"])).toBe(true);

      const contextWithDelegation: TenantContext = {
        ...createContext(UserRole.TELECALLER),
        delegatedPermissions: ["supply:view_all"],
      };

      expect(() => assertPermission(contextWithDelegation, "supply:view_all")).not.toThrow();
    });
  });
});

