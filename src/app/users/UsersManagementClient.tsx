"use client";

import React, { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { UserRole } from "@prisma/client";
import { AppAction, ROLE_PERMISSIONS, canAssignRole, canDelegatePermission } from "@/server/permissions";
import {
  createUserAction,
  updateUserRoleAction,
  updateUserStatusAction,
  assignTeamLeaderAction,
  assignBrokerAction,
  updateDelegatedPermissionsAction,
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

export interface UserAuditItem {
  id: string;
  action: string;
  createdAt: string | Date;
  details?: Record<string, unknown> | null;
  actorUser: { id: string; name: string; role: UserRole };
  targetUser: { id: string; name: string; role: UserRole };
}

interface UsersManagementClientProps {
  initialUsers: UserViewItem[];
  teamLeaders: { id: string; name: string; email: string; brokerId?: string | null }[];
  brokers?: { id: string; name: string; email: string }[];
  auditLogs?: UserAuditItem[];
  currentUserRole?: UserRole;
  currentUserId?: string;
}

const DELEGABLE_PERMISSIONS: { action: AppAction; label: string; domain: string }[] = [
  { action: "supply:validate", label: "Approve Property Validation", domain: "Supply" },
  { action: "supply:mark_sold_rented", label: "Mark Property Sold/Rented", domain: "Supply" },
  { action: "demand:activate", label: "Activate / Confirm Demand", domain: "Demand" },
  { action: "demand:inactivate", label: "Deactivate Lead", domain: "Demand" },
  { action: "matching:query_active_pool", label: "Access Active Supply Pool", domain: "Matching" },
  { action: "visits:schedule", label: "Schedule Site Visits", domain: "Site Visits" },
  { action: "visits:confirm_final", label: "Confirm Final Visit Outcome", domain: "Site Visits" },
  { action: "assignment:assign_telecaller", label: "Assign Telecaller to Supply/Leads", domain: "Assignments" },
  { action: "assignment:assign_sales_agent", label: "Assign Sales Agent to Visits", domain: "Assignments" },
];

export function UsersManagementClient({
  initialUsers,
  teamLeaders,
  brokers = [],
  auditLogs = [],
  currentUserRole = UserRole.BROKER_OWNER,
  currentUserId = "",
}: UsersManagementClientProps) {
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
  const [targetRoleToAssign, setTargetRoleToAssign] = useState<UserRole>(UserRole.TELECALLER);
  const [selectedLeaderId, setSelectedLeaderId] = useState<string>("");
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);

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

  const handleOpenCreateModal = () => {
    setNewName("");
    setNewEmail("");
    setNewPhone("");
    setNewPassword("BrokerTemp1234!");
    setNewRole(assignableRoles[0] || UserRole.TELECALLER);
    setNewBrokerId("");
    setNewTeamLeaderId("");
    setIsCreateModalOpen(true);
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
      delegatedPermissions: res.user.delegatedPermissions,
      createdAt: new Date(),
      broker: assignedBroker || null,
      teamLeader: assignedLeader ? { ...assignedLeader, role: UserRole.TEAM_LEADER } : null,
    };

    setUsers((prev) => [created, ...prev]);
    setSelectedUser(created);
    setIsCreateModalOpen(false);
    setToastMessage(`User ${created.name} successfully created with role ${created.role}.`);
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

  const handleTogglePermission = async (action: AppAction) => {
    if (!selectedUser) return;

    const current = selectedUser.delegatedPermissions || [];
    const updated = current.includes(action)
      ? current.filter((p) => p !== action)
      : [...current, action];

    const res = await updateDelegatedPermissionsAction(selectedUser.id, updated as AppAction[]);
    if (!res.success) {
      setToastMessage(`Error: ${res.error}`);
      return;
    }

    setUsers((prev) =>
      prev.map((u) => (u.id === selectedUser.id ? { ...u, delegatedPermissions: updated } : u))
    );
    setSelectedUser({ ...selectedUser, delegatedPermissions: updated });
    setToastMessage(`Delegated permissions updated for ${selectedUser.name}.`);
  };

  // Static permissions of selected user's role
  const staticRolePermissions = useMemo(() => {
    if (!selectedUser) return [];
    const set = ROLE_PERMISSIONS[selectedUser.role];
    return set ? Array.from(set) : [];
  }, [selectedUser]);

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
              <button
                onClick={handleOpenCreateModal}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs flex items-center gap-1.5"
              >
                <span>+</span> Add / Invite User
              </button>
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
                          onClick={() => setSelectedUser(user)}
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
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              {!isSelf && (
                                <>
                                  <button
                                    onClick={() => handleOpenRoleModal(user)}
                                    title="Change User Role"
                                    className="p-1 rounded text-crm-muted hover:text-crm-text hover:bg-stone-200/50"
                                  >
                                    ⚙️
                                  </button>
                                  <button
                                    onClick={() => handleOpenTeamModal(user)}
                                    title="Assign Team Hierarchy"
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
                      <div className="flex items-center gap-1.5">
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

                {/* Static Role Permissions */}
                <div>
                  <div className="flex items-center justify-between border-b border-crm-border pb-1.5 mb-2">
                    <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                      Core Role Permissions ({staticRolePermissions.length})
                    </h4>
                    <span className="text-[10px] text-crm-muted">Fixed by PRD Matrix</span>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {staticRolePermissions.map((action) => (
                      <span
                        key={action}
                        className="px-2 py-0.5 rounded bg-stone-100 text-crm-text text-[10px] font-mono border border-crm-border"
                      >
                        {action}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Delegated Permissions Workspace */}
                <div>
                  <div className="flex items-center justify-between border-b border-crm-border pb-1.5 mb-2">
                    <div>
                      <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                        Delegated Action Overrides
                      </h4>
                      <p className="text-[10px] text-crm-muted">
                        Granter can only delegate permissions they possess.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {DELEGABLE_PERMISSIONS.map((item) => {
                      const isGranted = (selectedUser.delegatedPermissions || []).includes(item.action);
                      const isActorPermitted = canDelegatePermission(actorRole, item.action);
                      const isAlreadyCore = staticRolePermissions.includes(item.action);

                      return (
                        <div
                          key={item.action}
                          className="flex items-center justify-between p-2 rounded border border-crm-border bg-stone-50/40 text-[11px]"
                        >
                          <div>
                            <span className="font-bold text-crm-text block">{item.label}</span>
                            <span className="text-[10px] font-mono text-crm-muted">{item.action}</span>
                          </div>

                          {isAlreadyCore ? (
                            <span className="text-[10px] font-semibold text-crm-muted italic">
                              Included in Role
                            </span>
                          ) : selectedUser.id === actorId ? (
                            <span className="text-[10px] text-crm-muted">Self-lock</span>
                          ) : (
                            <button
                              disabled={!isActorPermitted || loadingAction}
                              onClick={() => handleTogglePermission(item.action)}
                              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                                isGranted
                                  ? "bg-teal-600 text-white hover:bg-teal-700"
                                  : "border border-crm-border bg-white text-crm-text hover:bg-stone-50"
                              } ${!isActorPermitted ? "opacity-40 cursor-not-allowed" : ""}`}
                            >
                              {isGranted ? "Granted ✓" : "Grant Override"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Audit Log Section */}
        {auditLogs.length > 0 && (
          <div className="rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
            <div className="px-4 py-2.5 bg-stone-50 border-b border-crm-border text-xs font-semibold text-crm-text">
              User Administration Audit Trail (Last 50 Events)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50/50 border-b border-crm-border text-crm-muted uppercase tracking-wider font-semibold text-[10px]">
                  <tr>
                    <th className="px-4 py-2.5">Timestamp</th>
                    <th className="px-3 py-2.5">Action</th>
                    <th className="px-3 py-2.5">Actor</th>
                    <th className="px-3 py-2.5">Target User</th>
                    <th className="px-4 py-2.5">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-crm-border font-mono text-[11px]">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-stone-50/60">
                      <td className="px-4 py-2 text-crm-muted">
                        {new Date(log.createdAt).toLocaleString("en-IN", {
                          dateStyle: "short",
                          timeStyle: "medium",
                        })}
                      </td>
                      <td className="px-3 py-2 font-bold text-crm-text">{log.action}</td>
                      <td className="px-3 py-2 text-crm-text">
                        {log.actorUser?.name || "System"} ({log.actorUser?.role || "SYSTEM"})
                      </td>
                      <td className="px-3 py-2 text-crm-text">
                        {log.targetUser?.name || "—"} ({log.targetUser?.role || "—"})
                      </td>
                      <td className="px-4 py-2 text-[10px] text-crm-muted truncate max-w-xs">
                        {log.details ? JSON.stringify(log.details) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
              <input
                type="password"
                required
                minLength={8}
                placeholder="Minimum 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            <div>
              <label className="block font-semibold text-crm-text mb-1">Assigned Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
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
