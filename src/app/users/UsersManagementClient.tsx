"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { UserRole } from "@prisma/client";
import { AppAction, ROLE_PERMISSIONS, canAssignRole } from "@/server/permissions";
import {
  createUserAction,
  updateUserRoleAction,
  updateUserStatusAction,
  assignTeamLeaderAction,
  assignBrokerAction,
  updateDelegatedPermissionsAction,
  resendInvitationAction,
} from "./actions";
import { useSession } from "@/lib/auth-client";

export interface UserViewItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
  brokerId?: string | null;
  teamLeaderId: string | null;
  delegatedPermissions: string[];
  createdAt: string | Date;
  broker?: { id: string; name: string; email: string } | null;
  teamLeader?: { id: string; name: string; email: string; role: UserRole } | null;
  subordinates?: { id: string; name: string; email: string; role: UserRole; isActive: boolean }[];
}

interface UsersManagementClientProps {
  initialUsers: UserViewItem[];
  teamLeaders: { id: string; name: string; email: string; brokerId?: string | null }[];
  brokers?: { id: string; name: string; email: string }[];
  currentUserRole?: UserRole;
  currentUserId?: string;
}

export interface OperationalPermissionItem {
  action: AppAction;
  label: string;
  description: string;
}

export interface OperationalPermissionGroup {
  category: string;
  permissions: OperationalPermissionItem[];
}

export const OPERATIONAL_PERMISSION_GROUPS: OperationalPermissionGroup[] = [
  {
    category: "Supply Validation & Properties",
    permissions: [
      { action: "supply:create", label: "Add Properties", description: "Manual entry and CSV bulk upload" },
      { action: "supply:log_call", label: "Log Call Outcomes", description: "Record owner call notes and dispositions" },
      { action: "supply:upload_media", label: "Upload Photos & Videos", description: "Upload property photos and YouTube walkthroughs" },
      { action: "supply:validate", label: "Approve Validation", description: "Confirm owner willingness and approve property" },
      { action: "supply:mark_sold_rented", label: "Mark Sold / Rented", description: "Update status when property deal closes" },
      { action: "supply:view_assigned", label: "View Assigned Supply", description: "Access properties assigned to this user" },
      { action: "supply:view_all", label: "View All Supply", description: "Access all brokerage supply records in queue" },
    ],
  },
  {
    category: "Matching & Active Supply Pool",
    permissions: [
      { action: "matching:query_active_pool", label: "Query Active Pool", description: "Search verified properties ready for matching" },
      { action: "matching:view_matches", label: "View Property Matches", description: "View automated supply-demand match cards" },
      { action: "matching:share_details", label: "Share Details with Buyers", description: "Generate sanitized property sharing links" },
    ],
  },
  {
    category: "Demand & Lead Validation",
    permissions: [
      { action: "demand:create", label: "Create Inquiries", description: "Register new buyer or tenant inquiries" },
      { action: "demand:log_call", label: "Log Buyer Calls", description: "Record buyer disposition and preferences" },
      { action: "demand:activate", label: "Activate / Validate Demand", description: "Qualify inquiry into active matching" },
      { action: "demand:inactivate", label: "Deactivate Inquiries", description: "Mark lost or unqualified leads" },
      { action: "demand:view_assigned", label: "View Assigned Leads", description: "Access inquiries assigned to user" },
      { action: "demand:view_all", label: "View All Leads", description: "Access all brokerage demand inquiries" },
    ],
  },
  {
    category: "Site Visits",
    permissions: [
      { action: "visits:schedule", label: "Schedule Site Visits", description: "Create buyer property visit slots" },
      { action: "visits:record_outcome", label: "Record Visit Outcome", description: "Log completed, client no-show, etc." },
      { action: "visits:confirm_final", label: "Confirm Final Review", description: "Telecaller review of visit report" },
      { action: "visits:record_feedback", label: "Record Visit Feedback", description: "Log buyer property feedback notes" },
      { action: "visits:view_assigned", label: "View Assigned Visits", description: "Access visits assigned to user" },
      { action: "visits:view_all", label: "View All Visits", description: "Access all scheduled brokerage visits" },
    ],
  },
  {
    category: "Field Verification",
    permissions: [
      { action: "verification:view_assigned", label: "View Assigned Verifications", description: "Access physical verification tasks assigned to user" },
      { action: "verification:start_visit", label: "Start Inspection Visits", description: "Initiate on-site property physical inspection" },
      { action: "verification:submit_report", label: "Submit Verification Reports", description: "Record 6-point checklist, discrepancies, and upload photos" },
      { action: "verification:assign", label: "Assign Field Verifiers", description: "Assign active supply properties to field verifiers" },
      { action: "verification:review_report", label: "Review & Approve Verifications", description: "Review, approve, or reject completed verification reports" },
      { action: "verification:view_all", label: "View All Verifications", description: "Access all brokerage verification tasks" },
    ],
  },
  {
    category: "Assignments",
    permissions: [
      { action: "assignment:assign_telecaller", label: "Assign Telecallers", description: "Assign properties & leads to telecallers" },
      { action: "assignment:assign_sales_agent", label: "Assign Sales Agents", description: "Assign site visits to field agents" },
    ],
  },
];

export const ALL_OPERATIONAL_ACTIONS: AppAction[] = OPERATIONAL_PERMISSION_GROUPS.flatMap(
  (g) => g.permissions.map((p) => p.action)
);

export function UsersManagementClient({
  initialUsers,
  teamLeaders,
  brokers = [],
  currentUserRole = UserRole.BROKER_OWNER,
  currentUserId = "",
}: UsersManagementClientProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const [users, setUsers] = useState<UserViewItem[]>(initialUsers);
  const [selectedUser, setSelectedUser] = useState<UserViewItem | null>(initialUsers[0] || null);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<string>("All");

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [isConfirmStatusModalOpen, setIsConfirmStatusModalOpen] = useState(false);

  // Form states
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPassword, setNewPassword] = useState("BrokerTemp1234!");
  const [newRole, setNewRole] = useState<UserRole>(UserRole.TELECALLER);
  const [newBrokerId, setNewBrokerId] = useState<string>("");
  const [newTeamLeaderId, setNewTeamLeaderId] = useState<string>("");
  const [newSelectedPermissions, setNewSelectedPermissions] = useState<AppAction[]>([]);
  const [targetRoleToAssign, setTargetRoleToAssign] = useState<UserRole>(UserRole.TELECALLER);
  const [selectedLeaderId, setSelectedLeaderId] = useState<string>("");
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);

  // Interactive permission editing for selected user
  const [isEditingPermissions, setIsEditingPermissions] = useState(false);
  const [editingPermissions, setEditingPermissions] = useState<AppAction[]>([]);
  const [resendingInvite, setResendingInvite] = useState(false);

  const handleResendInvite = async (user: UserViewItem) => {
    setResendingInvite(true);
    try {
      const res = await resendInvitationAction(user.id);
      if (res.success) {
        setToastMessage(`Invitation email dispatched to ${user.email}.`);
      } else {
        setToastMessage(`Failed to send invite: ${res.error}`);
      }
    } catch {
      setToastMessage("An unexpected error occurred while resending invitation.");
    } finally {
      setResendingInvite(false);
    }
  };

  const actorRole = (session?.user as { role?: UserRole })?.role || currentUserRole;
  const actorId = session?.user?.id || currentUserId;

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchSearch =
        u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.phone.includes(searchTerm);
      if (!matchSearch) return false;

      if (roleFilter !== "All" && u.role !== roleFilter) return false;
      if (statusFilter === "Active" && !u.isActive) return false;
      if (statusFilter === "Inactive" && u.isActive) return false;

      return true;
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  // Permitted roles this actor can create
  const assignableRoles = useMemo(() => {
    const allRoles: UserRole[] = [
      UserRole.BROKER_OWNER,
      UserRole.TEAM_LEADER,
      UserRole.TELECALLER,
      UserRole.FIELD_VERIFIER,
      UserRole.FIELD_SALES_AGENT,
    ];
    return allRoles.filter((r) => canAssignRole(actorRole, r));
  }, [actorRole]);

  // Available Team Leaders for assignment
  const availableTeamLeaders = useMemo(() => {
    if (actorRole === UserRole.BROKER_OWNER) {
      // Broker only sees team leaders belonging to them
      return teamLeaders.filter((tl) => tl.brokerId === actorId || !tl.brokerId);
    }
    return teamLeaders;
  }, [teamLeaders, actorRole, actorId]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleOpenCreateModal = () => {
    setNewName("");
    setNewEmail("");
    setNewPhone("");
    setNewPassword("BrokerTemp1234!");
    const initialRole = assignableRoles[0] || UserRole.TELECALLER;
    setNewRole(initialRole);
    setNewBrokerId("");
    setNewTeamLeaderId("");
    const defaults = Array.from(ROLE_PERMISSIONS[initialRole] || []).filter((a) =>
      ALL_OPERATIONAL_ACTIONS.includes(a as AppAction)
    ) as AppAction[];
    setNewSelectedPermissions(defaults);
    setIsCreateModalOpen(true);
  };

  const handleRoleChangeInCreate = (role: UserRole) => {
    setNewRole(role);
    const defaults = Array.from(ROLE_PERMISSIONS[role] || []).filter((a) =>
      ALL_OPERATIONAL_ACTIONS.includes(a as AppAction)
    ) as AppAction[];
    setNewSelectedPermissions(defaults);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingAction(true);

    const res = await createUserAction({
      name: newName,
      email: newEmail,
      phone: newPhone,
      password: newPassword,
      role: newRole,
      brokerId: newBrokerId || null,
      teamLeaderId: newTeamLeaderId || null,
      delegatedPermissions: newSelectedPermissions,
    });

    setLoadingAction(false);
    if (!res.success || !res.user) {
      setToastMessage(`Error: ${res.error || "Could not create user"}`);
      return;
    }

    const assignedBroker = brokers.find((b) => b.id === (newBrokerId || (res.user as { brokerId?: string }).brokerId));
    const assignedLeader = teamLeaders.find((l) => l.id === res.user!.teamLeaderId);

    const created: UserViewItem = {
      id: res.user.id,
      name: res.user.name,
      email: res.user.email,
      phone: res.user.phone,
      role: res.user.role,
      isActive: res.user.isActive,
      brokerId: (res.user as { brokerId?: string }).brokerId,
      teamLeaderId: res.user.teamLeaderId,
      delegatedPermissions: res.user.delegatedPermissions || newSelectedPermissions,
      createdAt: new Date(),
      broker: assignedBroker || null,
      teamLeader: assignedLeader ? { ...assignedLeader, role: UserRole.TEAM_LEADER } : null,
    };

    setUsers((prev) => [created, ...prev]);
    setSelectedUser(created);
    setIsEditingPermissions(false);
    setIsCreateModalOpen(false);
    setToastMessage(`User ${created.name} successfully created. Invitation email dispatched to ${created.email}.`);
  };

  const handleOpenRoleModal = (user: UserViewItem) => {
    setSelectedUser(user);
    setTargetRoleToAssign(user.role);
    setIsRoleModalOpen(true);
  };

  const handleUpdateRole = async () => {
    if (!selectedUser) return;
    setLoadingAction(true);

    const res = await updateUserRoleAction(selectedUser.id, targetRoleToAssign);
    setLoadingAction(false);

    if (!res.success) {
      setToastMessage(`Error: ${res.error}`);
      return;
    }

    setUsers((prev) =>
      prev.map((u) => (u.id === selectedUser.id ? { ...u, role: targetRoleToAssign } : u))
    );
    setSelectedUser({ ...selectedUser, role: targetRoleToAssign });
    setIsRoleModalOpen(false);
    setToastMessage(`Role updated to ${targetRoleToAssign} for ${selectedUser.name}.`);
  };

  const handleToggleStatus = async () => {
    if (!selectedUser) return;
    setLoadingAction(true);
    const newStatus = !selectedUser.isActive;

    const res = await updateUserStatusAction(selectedUser.id, newStatus);
    setLoadingAction(false);

    if (!res.success) {
      setToastMessage(`Error: ${res.error}`);
      return;
    }

    setUsers((prev) =>
      prev.map((u) => (u.id === selectedUser.id ? { ...u, isActive: newStatus } : u))
    );
    setSelectedUser({ ...selectedUser, isActive: newStatus });
    setIsConfirmStatusModalOpen(false);
    setToastMessage(`Account ${newStatus ? "activated" : "deactivated"} for ${selectedUser.name}.`);
  };

  const handleOpenTeamModal = (user: UserViewItem) => {
    setSelectedUser(user);
    setSelectedLeaderId(user.teamLeaderId || "");
    setSelectedBrokerId(user.brokerId || "");
    setIsTeamModalOpen(true);
  };

  const handleAssignHierarchy = async () => {
    if (!selectedUser) return;
    setLoadingAction(true);

    // 1. Assign Broker if CRM Tenant Admin changed it
    if (actorRole === UserRole.CRM_TENANT_ADMIN && selectedBrokerId !== (selectedUser.brokerId || "")) {
      const brokerRes = await assignBrokerAction(selectedUser.id, selectedBrokerId || null);
      if (!brokerRes.success) {
        setToastMessage(`Error assigning broker: ${brokerRes.error}`);
        setLoadingAction(false);
        return;
      }
    }

    // 2. Assign Team Leader
    const leaderIdToSet = selectedLeaderId || null;
    const tlRes = await assignTeamLeaderAction(selectedUser.id, leaderIdToSet);
    setLoadingAction(false);

    if (!tlRes.success) {
      setToastMessage(`Error: ${tlRes.error}`);
      return;
    }

    const assignedLeader = teamLeaders.find((l) => l.id === leaderIdToSet);
    const assignedBroker = brokers.find((b) => b.id === (selectedBrokerId || null));

    setUsers((prev) =>
      prev.map((u) =>
        u.id === selectedUser.id
          ? {
              ...u,
              brokerId: selectedBrokerId || null,
              broker: assignedBroker || null,
              teamLeaderId: leaderIdToSet,
              teamLeader: assignedLeader
                ? { ...assignedLeader, role: UserRole.TEAM_LEADER }
                : null,
            }
          : u
      )
    );
    setSelectedUser({
      ...selectedUser,
      brokerId: selectedBrokerId || null,
      broker: assignedBroker || null,
      teamLeaderId: leaderIdToSet,
      teamLeader: assignedLeader ? { ...assignedLeader, role: UserRole.TEAM_LEADER } : null,
    });
    setIsTeamModalOpen(false);
    setToastMessage(`Team hierarchy updated for ${selectedUser.name}.`);
  };

  // User's effective operational permissions
  const userEffectivePermissions = useMemo(() => {
    if (!selectedUser) return [];
    if (selectedUser.delegatedPermissions && selectedUser.delegatedPermissions.length > 0) {
      return (selectedUser.delegatedPermissions as AppAction[]).filter((a) => a !== ("none" as AppAction));
    }
    const roleDefaults = Array.from(ROLE_PERMISSIONS[selectedUser.role] || []).filter((a) =>
      ALL_OPERATIONAL_ACTIONS.includes(a as AppAction)
    );
    return roleDefaults as AppAction[];
  }, [selectedUser]);

  const handleStartEditPermissions = () => {
    if (!selectedUser) return;
    setEditingPermissions([...userEffectivePermissions] as AppAction[]);
    setIsEditingPermissions(true);
  };

  const handleToggleEditPermission = (action: AppAction) => {
    setEditingPermissions((prev) =>
      prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action]
    );
  };

  const handleSaveUserPermissions = async () => {
    if (!selectedUser) return;
    setLoadingAction(true);

    const permsToSave = editingPermissions.length === 0 ? ["none" as AppAction] : editingPermissions;
    const res = await updateDelegatedPermissionsAction(selectedUser.id, permsToSave);
    setLoadingAction(false);

    if (!res.success) {
      setToastMessage(`Error: ${res.error}`);
      return;
    }

    const savedPermissions = (res.user?.delegatedPermissions || permsToSave) as string[];
    setUsers((prev) =>
      prev.map((u) => (u.id === selectedUser.id ? { ...u, delegatedPermissions: savedPermissions } : u))
    );
    setSelectedUser((prev) => prev ? { ...prev, delegatedPermissions: savedPermissions } : null);
    setIsEditingPermissions(false);
    router.refresh();
    setToastMessage(`Permissions updated successfully for ${selectedUser.name}.`);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-crm-border">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-crm-text">
                Team & Access Management
              </h2>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-stone-100 text-crm-muted border border-crm-border">
                {filteredUsers.length} Users
              </span>
            </div>
            <p className="text-xs text-crm-muted mt-1">
              Multi-tier hierarchy: CRM Tenant Admin &rarr; Broker &rarr; Team Leader &rarr; Team Members
            </p>
          </div>

          <div className="flex items-center gap-2">
            {assignableRoles.length > 0 && (
              <Link
                href="/users/new"
                className="px-3 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs flex items-center gap-1.5"
              >
                <span>+</span> Add / Invite User
              </Link>
            )}
          </div>
        </div>

        {/* Filters Bar */}
        <div className="p-4 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
            {/* Search */}
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Search Name, Email, Phone
              </label>
              <input
                type="text"
                placeholder="e.g. Vikram, telecaller@apex, 9810..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            {/* Role Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Filter by Role
              </label>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">All Roles</option>
                <option value={UserRole.BROKER_OWNER}>Broker</option>
                <option value={UserRole.TEAM_LEADER}>Team Leader</option>
                <option value={UserRole.TELECALLER}>Telecaller</option>
                <option value={UserRole.FIELD_VERIFIER}>Field Verifier</option>
                <option value={UserRole.FIELD_SALES_AGENT}>Field Sales Agent</option>
                <option value={UserRole.CRM_TENANT_ADMIN}>CRM Tenant Admin</option>
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Account Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">All Statuses</option>
                <option value="Active">Active Only</option>
                <option value="Inactive">Inactive / Suspended</option>
              </select>
            </div>
          </div>
        </div>

        {/* Master-Detail Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Users Table */}
          <div
            className={`rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden transition-all ${
              selectedUser ? "lg:col-span-7" : "lg:col-span-12"
            }`}
          >
            <div className="px-4 py-2.5 bg-stone-50 border-b border-crm-border text-xs font-semibold text-crm-text flex items-center justify-between">
              <span>Authorized Team Directory</span>
              <span className="text-[11px] text-crm-muted">Click any user to inspect effective permissions</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50/50 border-b border-crm-border text-crm-muted uppercase tracking-wider font-semibold text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Team Member</th>
                    <th className="px-3 py-3">Role</th>
                    <th className="px-3 py-3">Team Hierarchy</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-crm-border">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-crm-muted">
                        <div className="max-w-sm mx-auto space-y-1">
                          <p className="font-semibold text-crm-text text-sm">No team members registered yet</p>
                          <p className="text-xs text-crm-muted">
                            Use &quot;+ Add / Invite User&quot; to assign operational and administrative roles.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-crm-muted">
                        No team members found matching current filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => {
                      const isSelected = selectedUser?.id === user.id;
                      const isSelf = user.id === actorId;

                      return (
                        <tr
                          key={user.id}
                          onClick={() => {
                            setSelectedUser(user);
                            setIsEditingPermissions(false);
                          }}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? "bg-teal-50/60 font-medium" : "hover:bg-stone-50/70"
                          }`}
                        >
                          {/* Name & Contact */}
                          <td className="px-4 py-3">
                            <div className="font-bold text-crm-text flex items-center gap-1.5">
                              <span>{user.name}</span>
                              {isSelf && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] bg-stone-200 text-stone-700">
                                  You
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-crm-muted">{user.email}</div>
                            <div className="text-[10px] text-crm-muted">{user.phone}</div>
                          </td>

                          {/* Role Pill */}
                          <td className="px-3 py-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-crm-primary-light text-crm-primary uppercase">
                              {user.role === UserRole.BROKER_OWNER ? "Broker" : user.role.replace(/_/g, " ")}
                            </span>
                            {user.delegatedPermissions.length > 0 && (
                              <div className="text-[10px] text-teal-800 font-semibold mt-1">
                                +{user.delegatedPermissions.length} Delegated
                              </div>
                            )}
                          </td>

                          {/* Hierarchy */}
                          <td className="px-3 py-3">
                            {user.role === UserRole.BROKER_OWNER ? (
                              <span className="text-[11px] font-semibold text-crm-text">Broker Team Lead</span>
                            ) : user.role === UserRole.TEAM_LEADER ? (
                              <div>
                                <span className="text-[11px] font-medium text-crm-text">
                                  Broker: {user.broker?.name || "Direct"}
                                </span>
                              </div>
                            ) : (
                              <div>
                                <div className="text-[11px] font-medium text-crm-text">
                                  TL: {user.teamLeader?.name || "None"}
                                </div>
                                <div className="text-[10px] text-crm-muted">
                                  Broker: {user.broker?.name || "Direct"}
                                </div>
                              </div>
                            )}
                          </td>

                          {/* Status */}
                          <td className="px-3 py-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                user.isActive
                                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                  : "bg-red-50 text-red-800 border border-red-200"
                              }`}
                            >
                              {user.isActive ? "Active" : "Inactive"}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <Link
                                href={`/users/${user.id}/edit`}
                                title="Edit User Profile & Role"
                                className="px-2 py-1 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 shadow-2xs inline-flex items-center gap-1"
                              >
                                <span>✏️</span> Edit
                              </Link>
                              {!isSelf && (
                                <>
                                  <button
                                    onClick={() => handleOpenRoleModal(user)}
                                    title="Quick Change Role"
                                    className="p-1 rounded text-crm-muted hover:text-crm-text hover:bg-stone-200/50"
                                  >
                                    ⚙️
                                  </button>
                                  <button
                                    onClick={() => handleOpenTeamModal(user)}
                                    title="Quick Team Assignment"
                                    className="p-1 rounded text-crm-muted hover:text-crm-text hover:bg-stone-200/50"
                                  >
                                    👥
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* User Details & Permissions Inspector Panel */}
          {selectedUser && (
            <div className="lg:col-span-5 rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
              <div className="px-4 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-crm-text">{selectedUser.name}</h3>
                  <p className="text-[11px] text-crm-muted">{selectedUser.email}</p>
                </div>
                <button
                  onClick={() => setSelectedUser(null)}
                  className="text-xs text-crm-muted hover:text-crm-text"
                >
                  ✕ Close
                </button>
              </div>

              <div className="p-5 space-y-5 text-xs max-h-[75vh] overflow-y-auto">
                {/* Role & Hierarchy Summary */}
                <div className="p-3.5 rounded-md bg-stone-50 border border-crm-border space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-crm-muted block">
                        Assigned Role
                      </span>
                      <strong className="text-crm-primary text-sm uppercase">
                        {selectedUser.role === UserRole.BROKER_OWNER ? "Broker" : selectedUser.role.replace(/_/g, " ")}
                      </strong>
                    </div>

                    {selectedUser.id !== actorId && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link
                          href={`/users/${selectedUser.id}/edit`}
                          className="px-2.5 py-1 text-xs font-semibold rounded border border-crm-primary bg-crm-primary/10 text-crm-primary hover:bg-crm-primary hover:text-white transition-colors"
                        >
                          Edit Profile ↗
                        </Link>
                        <button
                          onClick={() => handleResendInvite(selectedUser)}
                          disabled={resendingInvite || !selectedUser.isActive}
                          title="Resend account activation email"
                          className="px-2.5 py-1 text-xs font-semibold rounded border border-crm-border bg-white text-crm-text hover:bg-stone-50 disabled:opacity-50 flex items-center gap-1"
                        >
                          <span>✉️</span>
                          <span>{resendingInvite ? "Sending..." : "Resend Invite"}</span>
                        </button>
                        <button
                          onClick={() => handleOpenRoleModal(selectedUser)}
                          className="px-2.5 py-1 text-xs font-semibold rounded border border-crm-border bg-white hover:bg-stone-50"
                        >
                          Change Role
                        </button>
                        <button
                          onClick={() => setIsConfirmStatusModalOpen(true)}
                          className={`px-2.5 py-1 text-xs font-semibold rounded border ${
                            selectedUser.isActive
                              ? "border-red-200 text-red-700 bg-red-50 hover:bg-red-100"
                              : "border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                          }`}
                        >
                          {selectedUser.isActive ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-crm-border text-[11px] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-crm-muted">Broker Organization:</span>
                      <span className="font-semibold text-crm-text">
                        {selectedUser.broker?.name || (selectedUser.role === UserRole.BROKER_OWNER ? "Self (Broker Lead)" : "None")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-crm-muted">Reports to (TL):</span>
                      <span className="font-semibold text-crm-text">
                        {selectedUser.teamLeader?.name || "Direct Reporting"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Operational Permissions Section */}
                <div>
                  <div className="flex items-center justify-between border-b border-crm-border pb-2 mb-3">
                    <div>
                      <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                        Operational Permissions ({userEffectivePermissions.length} Active)
                      </h4>
                      <p className="text-[10px] text-crm-muted">
                        {isEditingPermissions
                          ? "Check or uncheck permissions to customize access for this user."
                          : "Only active, granted permissions are shown below."}
                      </p>
                    </div>

                    {selectedUser.id !== actorId && (
                      <div>
                        {isEditingPermissions ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setIsEditingPermissions(false)}
                              className="px-2 py-1 text-xs rounded border border-crm-border bg-white text-crm-muted hover:text-crm-text transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={loadingAction}
                              onClick={handleSaveUserPermissions}
                              className="px-3 py-1 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs transition-colors"
                            >
                              {loadingAction ? "Saving..." : "Save Permissions"}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={handleStartEditPermissions}
                            className="px-2.5 py-1 text-xs font-semibold rounded border border-crm-border bg-white text-crm-text hover:bg-stone-50 transition-colors shadow-2xs"
                          >
                            ✎ Edit Permissions
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {isEditingPermissions ? (
                    <div className="space-y-3 bg-stone-50/60 p-3 rounded-md border border-crm-border">
                      <div className="flex items-center justify-between pb-2 border-b border-crm-border text-[11px]">
                        <span className="font-semibold text-crm-text">
                          {editingPermissions.length} of {ALL_OPERATIONAL_ACTIONS.length} selected
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingPermissions([...ALL_OPERATIONAL_ACTIONS])}
                            className="text-crm-primary font-semibold hover:underline"
                          >
                            Select All
                          </button>
                          <span className="text-crm-muted">•</span>
                          <button
                            type="button"
                            onClick={() => setEditingPermissions([])}
                            className="text-crm-muted font-semibold hover:underline"
                          >
                            Clear All
                          </button>
                          <span className="text-crm-muted">•</span>
                          <button
                            type="button"
                            onClick={() => {
                              const defaults = Array.from(ROLE_PERMISSIONS[selectedUser.role] || []).filter((a) =>
                                ALL_OPERATIONAL_ACTIONS.includes(a as AppAction)
                              ) as AppAction[];
                              setEditingPermissions(defaults);
                            }}
                            className="text-crm-muted font-semibold hover:underline"
                          >
                            Reset Defaults
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3.5 max-h-80 overflow-y-auto pr-1">
                        {OPERATIONAL_PERMISSION_GROUPS.map((group) => (
                          <div key={group.category} className="space-y-1.5">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-crm-muted">
                              {group.category}
                            </div>
                            <div className="grid grid-cols-1 gap-1.5">
                              {group.permissions.map((item) => {
                                const isChecked = editingPermissions.includes(item.action);
                                return (
                                  <label
                                    key={item.action}
                                    className={`flex items-start gap-2 p-2 rounded border text-xs cursor-pointer transition-colors ${
                                      isChecked
                                        ? "bg-white border-crm-primary/40 text-crm-text"
                                        : "bg-stone-50 border-crm-border text-crm-muted"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => handleToggleEditPermission(item.action)}
                                      className="mt-0.5 rounded text-crm-primary focus:ring-crm-primary"
                                    />
                                    <div>
                                      <span className="font-semibold block text-[11px] text-crm-text leading-tight">
                                        {item.label}
                                      </span>
                                      <span className="text-[10px] text-crm-muted block leading-tight">
                                        {item.description}
                                      </span>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {userEffectivePermissions.length === 0 ? (
                        <div className="p-3.5 rounded-md bg-stone-50 border border-crm-border text-center text-crm-muted text-xs">
                          No operational permissions active for this user.
                        </div>
                      ) : (
                        OPERATIONAL_PERMISSION_GROUPS.map((group) => {
                          const grantedInGroup = group.permissions.filter((p) =>
                            userEffectivePermissions.includes(p.action)
                          );

                          // Do not display category if zero permissions in it are active
                          if (grantedInGroup.length === 0) {
                            return null;
                          }

                          return (
                            <div key={group.category} className="space-y-1">
                              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-crm-muted">
                                <span>{group.category}</span>
                                <span className="font-normal text-[9px] text-emerald-800 font-semibold">
                                  {grantedInGroup.length} Active
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {grantedInGroup.map((item) => (
                                  <span
                                    key={item.action}
                                    className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1"
                                    title={item.action}
                                  >
                                    <span className="text-emerald-600 font-bold">✓</span>
                                    {item.label}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal: Create User */}
        <Modal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          title="Onboard New Team Member"
          subtitle="Provision new account into the brokerage tenant"
          footer={
            <>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateUser}
                disabled={loadingAction}
                className="px-4 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs"
              >
                {loadingAction ? "Provisioning..." : "Provision Account"}
              </button>
            </>
          }
        >
          <form onSubmit={handleCreateUser} className="space-y-3.5 text-xs">
            <div>
              <label className="block font-semibold text-crm-text mb-1">Full Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Vikram Malhotra"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            <div>
              <label className="block font-semibold text-crm-text mb-1">Email Address</label>
              <input
                type="email"
                required
                placeholder="name@brokerage.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            <div>
              <label className="block font-semibold text-crm-text mb-1">Phone Number</label>
              <input
                type="tel"
                required
                placeholder="+91 98100 00000"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            <div>
              <label className="block font-semibold text-crm-text mb-1">Initial Password</label>
              <PasswordInput
                required
                minLength={8}
                placeholder="Minimum 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            <div>
              <label className="block font-semibold text-crm-text mb-1">Assigned Role</label>
              <select
                value={newRole}
                onChange={(e) => handleRoleChangeInCreate(e.target.value as UserRole)}
                className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                {assignableRoles.map((role) => (
                  <option key={role} value={role}>
                    {role === UserRole.BROKER_OWNER ? "Broker" : role.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            {/* If CRM Tenant Admin and creating Team Leader or subordinate: Select Broker */}
            {actorRole === UserRole.CRM_TENANT_ADMIN && newRole !== UserRole.BROKER_OWNER && brokers.length > 0 && (
              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Assign to Broker Team (Optional)
                </label>
                <select
                  value={newBrokerId}
                  onChange={(e) => setNewBrokerId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  <option value="">Direct Tenant Organization (No Broker)</option>
                  {brokers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.email})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Team Leader assignment */}
            {actorRole !== UserRole.TEAM_LEADER && newRole !== UserRole.BROKER_OWNER && availableTeamLeaders.length > 0 && (
              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Assign to Team Leader (Optional)
                </label>
                <select
                  value={newTeamLeaderId}
                  onChange={(e) => setNewTeamLeaderId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  <option value="">Direct Brokerage Reporting (No Team Leader)</option>
                  {availableTeamLeaders.map((tl) => (
                    <option key={tl.id} value={tl.id}>
                      {tl.name} ({tl.email})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Operational Permissions Selector */}
            <div className="border border-crm-border rounded-md p-3 bg-stone-50/50 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-xs text-crm-text block">
                    Operational Permissions ({newSelectedPermissions.length} selected)
                  </span>
                  <span className="text-[10px] text-crm-muted">
                    Customise exact operations permitted for this user
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setNewSelectedPermissions([...ALL_OPERATIONAL_ACTIONS])}
                    className="text-crm-primary font-semibold hover:underline"
                  >
                    Select All
                  </button>
                  <span className="text-crm-border">|</span>
                  <button
                    type="button"
                    onClick={() => setNewSelectedPermissions([])}
                    className="text-crm-muted font-semibold hover:underline"
                  >
                    Clear
                  </button>
                  <span className="text-crm-border">|</span>
                  <button
                    type="button"
                    onClick={() => {
                      const defaults = Array.from(ROLE_PERMISSIONS[newRole] || []).filter((a) =>
                        ALL_OPERATIONAL_ACTIONS.includes(a as AppAction)
                      ) as AppAction[];
                      setNewSelectedPermissions(defaults);
                    }}
                    className="text-crm-muted font-semibold hover:underline"
                  >
                    Reset Defaults
                  </button>
                </div>
              </div>

              <div className="space-y-3 max-h-56 overflow-y-auto pr-1 pt-1 border-t border-crm-border/60">
                {OPERATIONAL_PERMISSION_GROUPS.map((group) => (
                  <div key={group.category} className="space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-crm-muted">
                      {group.category}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {group.permissions.map((item) => {
                        const checked = newSelectedPermissions.includes(item.action);
                        return (
                          <label
                            key={item.action}
                            className={`flex items-start gap-2 p-1.5 rounded border text-[11px] cursor-pointer transition-colors ${
                              checked
                                ? "bg-white border-crm-primary/40 text-crm-text shadow-2xs"
                                : "bg-stone-50 border-crm-border text-crm-muted"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setNewSelectedPermissions((prev) => [...prev, item.action]);
                                } else {
                                  setNewSelectedPermissions((prev) => prev.filter((a) => a !== item.action));
                                }
                              }}
                              className="mt-0.5 rounded text-crm-primary focus:ring-crm-primary"
                            />
                            <div>
                              <span className="font-semibold block leading-tight text-crm-text">
                                {item.label}
                              </span>
                              <span className="text-[9px] text-crm-muted block leading-tight">
                                {item.description}
                              </span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 rounded bg-stone-50 border border-crm-border text-[11px] text-crm-muted">
              <strong>Security Notice:</strong> The account will be provisioned directly within the active tenant with secure scrypt password credentials and enforced seat quota.
            </div>
          </form>
        </Modal>

        {/* Modal: Change User Role */}
        <Modal
          isOpen={isRoleModalOpen}
          onClose={() => setIsRoleModalOpen(false)}
          title={`Change Role: ${selectedUser?.name}`}
          subtitle="Enforces role grant boundaries and self-escalation blocks"
          footer={
            <>
              <button
                onClick={() => setIsRoleModalOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateRole}
                disabled={loadingAction}
                className="px-4 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs"
              >
                {loadingAction ? "Updating..." : "Confirm Role Update"}
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-crm-text mb-1">Current Role</label>
              <div className="p-2 rounded bg-stone-100 text-crm-text font-bold uppercase">
                {selectedUser?.role === UserRole.BROKER_OWNER ? "Broker" : selectedUser?.role.replace(/_/g, " ")}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-crm-text mb-1">New Role to Assign</label>
              <select
                value={targetRoleToAssign}
                onChange={(e) => setTargetRoleToAssign(e.target.value as UserRole)}
                className="w-full px-2.5 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                {assignableRoles.map((role) => (
                  <option key={role} value={role}>
                    {role === UserRole.BROKER_OWNER ? "Broker" : role.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
              <strong>RBAC Invariant:</strong> Role transitions change effective operational permissions immediately across all tenant queues.
            </div>
          </div>
        </Modal>

        {/* Modal: Assign Hierarchy */}
        <Modal
          isOpen={isTeamModalOpen}
          onClose={() => setIsTeamModalOpen(false)}
          title={`Team Hierarchy: ${selectedUser?.name}`}
          subtitle="Assign subordinate reporting hierarchy and broker team"
          footer={
            <>
              <button
                onClick={() => setIsTeamModalOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text"
              >
                Cancel
              </button>
              <button
                onClick={handleAssignHierarchy}
                disabled={loadingAction}
                className="px-4 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs"
              >
                {loadingAction ? "Saving..." : "Save Hierarchy"}
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            {/* If Tenant Admin: Broker selection */}
            {actorRole === UserRole.CRM_TENANT_ADMIN && selectedUser?.role !== UserRole.BROKER_OWNER && (
              <div>
                <label className="block font-semibold text-crm-text mb-1">Assigned Broker Team</label>
                <select
                  value={selectedBrokerId}
                  onChange={(e) => setSelectedBrokerId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  <option value="">Direct Tenant Organization (No Broker)</option>
                  {brokers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.email})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Team Leader selection */}
            {selectedUser?.role !== UserRole.BROKER_OWNER && (
              <div>
                <label className="block font-semibold text-crm-text mb-1">Designated Team Leader</label>
                <select
                  value={selectedLeaderId}
                  onChange={(e) => setSelectedLeaderId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  <option value="">Direct Brokerage Reporting (No Team Leader)</option>
                  {availableTeamLeaders
                    .filter((tl) => tl.id !== selectedUser?.id)
                    .map((tl) => (
                      <option key={tl.id} value={tl.id}>
                        {tl.name} ({tl.email})
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>
        </Modal>

        {/* Modal: Confirm Status Deactivation */}
        <Modal
          isOpen={isConfirmStatusModalOpen}
          onClose={() => setIsConfirmStatusModalOpen(false)}
          title={selectedUser?.isActive ? "Deactivate User Account" : "Activate User Account"}
          subtitle="Immediate authorization status update"
          footer={
            <>
              <button
                onClick={() => setIsConfirmStatusModalOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text"
              >
                Cancel
              </button>
              <button
                onClick={handleToggleStatus}
                disabled={loadingAction}
                className={`px-4 py-1.5 text-xs font-semibold rounded text-white shadow-xs ${
                  selectedUser?.isActive
                    ? "bg-red-700 hover:bg-red-800"
                    : "bg-emerald-700 hover:bg-emerald-800"
                }`}
              >
                {loadingAction
                  ? "Processing..."
                  : selectedUser?.isActive
                  ? "Confirm Deactivation"
                  : "Confirm Activation"}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-xs">
            <p className="text-crm-text">
              Are you sure you want to {selectedUser?.isActive ? "deactivate" : "activate"} the account for{" "}
              <strong>{selectedUser?.name}</strong> ({selectedUser?.email})?
            </p>
            {selectedUser?.isActive && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded text-[11px]">
                <strong>Warning:</strong> Deactivated users are immediately rejected by server-side authorization checks on all operations.
              </div>
            )}
          </div>
        </Modal>

        {/* Toast */}
        {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}
      </div>
    </AppShell>
  );
}
