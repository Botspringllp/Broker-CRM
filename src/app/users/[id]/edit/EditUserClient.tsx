"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { Toast } from "@/components/ui/Toast";
import { StatusBadge } from "@/components/ui/Badge";
import { UserRole } from "@prisma/client";
import { AppAction } from "@/server/permissions";
import { updateTenantUserAction, resendInvitationAction } from "@/app/users/actions";

interface EditUserView {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
  teamLeaderId: string | null;
  brokerId?: string | null;
  delegatedPermissions: string[];
}

interface TeamLeaderOption {
  id: string;
  name: string;
  email: string;
  brokerId?: string | null;
}

interface BrokerOption {
  id: string;
  name: string;
  email: string;
}

interface EditUserClientProps {
  user: EditUserView;
  assignableRoles: UserRole[];
  teamLeaders: TeamLeaderOption[];
  brokers: BrokerOption[];
  currentUserRole: string;
  currentUserId: string;
  isSelf: boolean;
}

export function EditUserClient({
  user: initialUser,
  assignableRoles,
  teamLeaders,
  brokers,
  isSelf,
}: EditUserClientProps) {
  const router = useRouter();
  const [user, setUser] = useState<EditUserView>(initialUser);

  // Form State
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone || "");
  const [role, setRole] = useState<UserRole>(user.role);
  const [isActive, setIsActive] = useState<boolean>(user.isActive);
  const [teamLeaderId, setTeamLeaderId] = useState<string>(user.teamLeaderId || "");
  const [brokerId, setBrokerId] = useState<string>(user.brokerId || "");
  const [delegatedPermissions] = useState<AppAction[]>(
    (user.delegatedPermissions as AppAction[]) || []
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setToastMessage("Name cannot be empty.");
      return;
    }

    setIsSaving(true);
    try {
      const res = await updateTenantUserAction(user.id, {
        name: name.trim(),
        phone: phone.trim() || undefined,
        role: !isSelf ? role : undefined,
        isActive: !isSelf ? isActive : undefined,
        teamLeaderId: !isSelf && (role === UserRole.TELECALLER || role === UserRole.FIELD_VERIFIER || role === UserRole.FIELD_SALES_AGENT)
          ? teamLeaderId || null
          : undefined,
        brokerId: !isSelf && role === UserRole.TEAM_LEADER ? brokerId || null : undefined,
        delegatedPermissions: !isSelf ? delegatedPermissions : undefined,
      });

      if (res.success && res.user) {
        setUser((prev) => ({
          ...prev,
          name: res.user.name,
          phone: res.user.phone,
          role: res.user.role,
          isActive: res.user.isActive,
          teamLeaderId: res.user.teamLeaderId,
          brokerId: res.user.brokerId,
          delegatedPermissions: res.user.delegatedPermissions,
        }));
        setToastMessage("User profile updated successfully!");
        setTimeout(() => {
          router.push("/users");
        }, 1000);
      } else {
        setToastMessage(res.error || "Failed to update user.");
      }
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Error updating user.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleResendInvite = async () => {
    setIsResending(true);
    try {
      const res = await resendInvitationAction(user.id);
      if (res.success) {
        setToastMessage(`Invitation resent successfully to ${res.email}.`);
      } else {
        setToastMessage(res.error || "Failed to resend invitation.");
      }
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Error resending invitation.");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-6 pb-12">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between border-b border-crm-border pb-4">
          <div className="flex items-center gap-2">
            <Link
              href="/users"
              className="text-xs font-semibold text-crm-link hover:underline flex items-center gap-1"
            >
              <span>←</span> Team & Permissions
            </Link>
            <span className="text-crm-muted text-xs">/</span>
            <span className="text-xs font-medium text-crm-text">Edit User ({user.name})</span>
          </div>

          <button
            type="button"
            onClick={handleResendInvite}
            disabled={isResending}
            className="px-3 py-1.5 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 shadow-2xs disabled:opacity-50"
          >
            {isResending ? "Resending..." : "✉️ Resend Invitation Email"}
          </button>
        </div>

        {/* Title Header Card */}
        <div className="bg-crm-surface border border-crm-border rounded-lg p-5 shadow-2xs">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 text-crm-primary flex items-center justify-center font-bold text-lg shadow-2xs">
                👤
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold tracking-tight text-crm-text">
                    {user.name}
                  </h1>
                  <StatusBadge status={user.role} />
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                      user.isActive
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-red-50 text-red-800 border-red-200"
                    }`}
                  >
                    {user.isActive ? "Active Account" : "Deactivated"}
                  </span>
                </div>
                <p className="text-xs text-crm-muted mt-0.5">
                  Email: <strong className="text-crm-text">{user.email}</strong> • Role:{" "}
                  {user.role.replace(/_/g, " ")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Edit Form Card */}
        <form onSubmit={handleSave} className="bg-crm-surface border border-crm-border rounded-lg p-6 shadow-2xs space-y-5 text-xs">
          <h2 className="text-sm font-bold text-crm-text border-b border-crm-border pb-2">
            Account Specifications & Permissions
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-crm-text mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            <div>
              <label className="block font-semibold text-crm-text mb-1">Email Address</label>
              <input
                type="email"
                disabled
                value={user.email}
                className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-100 text-crm-muted cursor-not-allowed"
              />
              <span className="text-[10px] text-crm-muted mt-0.5 block">
                Email serves as canonical authentication identity and cannot be edited directly.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-crm-text mb-1">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            <div>
              <label className="block font-semibold text-crm-text mb-1">Assigned Role</label>
              <select
                disabled={isSelf}
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden disabled:bg-stone-100 disabled:cursor-not-allowed"
              >
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              {isSelf && (
                <span className="text-[10px] text-crm-muted mt-0.5 block">
                  Self-escalation restriction: You cannot change your own role.
                </span>
              )}
            </div>
          </div>

          {/* Account Active Status Toggle */}
          {!isSelf && (
            <div className="p-3.5 rounded-lg border border-crm-border bg-stone-50/60 flex items-center justify-between">
              <div>
                <strong className="text-crm-text block">Account Active Status</strong>
                <p className="text-[11px] text-crm-muted">
                  Deactivating this user immediately invalidates their active login sessions.
                </p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer font-semibold text-crm-text">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-crm-border text-crm-primary focus:ring-crm-primary"
                />
                <span>{isActive ? "Active" : "Deactivated"}</span>
              </label>
            </div>
          )}

          {/* Hierarchy Reporting */}
          {!isSelf && (
            <div className="space-y-4 pt-2 border-t border-crm-border">
              <h3 className="font-bold text-crm-text text-xs uppercase tracking-wider">
                Reporting Hierarchy
              </h3>

              {role === UserRole.TEAM_LEADER ? (
                <div>
                  <label className="block font-semibold text-crm-text mb-1">
                    Assign Reporting Broker Owner
                  </label>
                  <select
                    value={brokerId}
                    onChange={(e) => setBrokerId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                  >
                    <option value="">No Direct Broker Assignment</option>
                    {brokers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.email})
                      </option>
                    ))}
                  </select>
                </div>
              ) : role === UserRole.TELECALLER ||
                role === UserRole.FIELD_VERIFIER ||
                role === UserRole.FIELD_SALES_AGENT ? (
                <div>
                  <label className="block font-semibold text-crm-text mb-1">
                    Assign Reporting Team Leader
                  </label>
                  <select
                    value={teamLeaderId}
                    onChange={(e) => setTeamLeaderId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                  >
                    <option value="">No Direct Team Leader</option>
                    {teamLeaders.map((tl) => (
                      <option key={tl.id} value={tl.id}>
                        {tl.name} ({tl.email})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-crm-muted text-[11px] italic">
                  Role {role.replace(/_/g, " ")} has no subordinate supervisor assignment.
                </p>
              )}
            </div>
          )}

          {/* Form Actions */}
          <div className="pt-4 border-t border-crm-border flex justify-between">
            <Link
              href="/users"
              className="px-4 py-2 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSaving ? "Saving Changes..." : "✓ Save Changes"}
            </button>
          </div>
        </form>
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </AppShell>
  );
}
