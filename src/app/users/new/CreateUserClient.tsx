"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { Toast } from "@/components/ui/Toast";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { UserRole } from "@prisma/client";
import { AppAction } from "@/server/permissions";
import { createUserAction } from "@/app/users/actions";

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

interface CreateUserClientProps {
  assignableRoles: UserRole[];
  teamLeaders: TeamLeaderOption[];
  brokers: BrokerOption[];
  currentUserRole: string;
}

export function CreateUserClient({
  assignableRoles,
  teamLeaders,
  brokers,
}: CreateUserClientProps) {
  const router = useRouter();

  // Wizard Step: 1 = Identity, 2 = Hierarchy, 3 = Security & Permissions
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Form State
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>(assignableRoles[0] || UserRole.TELECALLER);
  const [teamLeaderId, setTeamLeaderId] = useState<string>("");
  const [brokerId, setBrokerId] = useState<string>("");

  // Credentials State
  const [credentialMethod, setCredentialMethod] = useState<"INVITATION" | "PASSWORD">("INVITATION");
  const [password, setPassword] = useState("");
  const [delegatedPermissions] = useState<AppAction[]>([]);

  // Feedback State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Role changes handle automatic hierarchy pre-fills
  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    if (newRole === UserRole.TEAM_LEADER) {
      setTeamLeaderId("");
      if (brokers.length > 0 && !brokerId) {
        setBrokerId(brokers[0].id);
      }
    } else if (
      newRole === UserRole.TELECALLER ||
      newRole === UserRole.FIELD_VERIFIER ||
      newRole === UserRole.FIELD_SALES_AGENT
    ) {
      if (teamLeaders.length > 0 && !teamLeaderId) {
        setTeamLeaderId(teamLeaders[0].id);
      }
    } else {
      setTeamLeaderId("");
      setBrokerId("");
    }
  };

  // Step 1 Validation
  const validateStep1 = () => {
    if (!name.trim()) {
      setToastMessage("Please enter the user's full name.");
      return false;
    }
    if (!email.trim() || !email.includes("@")) {
      setToastMessage("Please enter a valid email address.");
      return false;
    }
    if (phone.trim() && phone.replace(/\D/g, "").length < 10) {
      setToastMessage("Phone number should be at least 10 digits.");
      return false;
    }
    return true;
  };

  // Step 2 Validation
  const validateStep2 = () => {
    // Subordinates require Team Leader assignment
    const requiresTL =
      role === UserRole.TELECALLER ||
      role === UserRole.FIELD_VERIFIER ||
      role === UserRole.FIELD_SALES_AGENT;

    if (requiresTL && teamLeaders.length > 0 && !teamLeaderId) {
      setToastMessage("Please assign a reporting Team Leader for this operational role.");
      return false;
    }
    return true;
  };

  // Final Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (credentialMethod === "PASSWORD") {
      if (!password || password.length < 8) {
        setToastMessage("Password must be at least 8 characters long.");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await createUserAction({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        role,
        teamLeaderId: teamLeaderId || null,
        brokerId: brokerId || null,
        password: credentialMethod === "PASSWORD" ? password : undefined,
        delegatedPermissions: delegatedPermissions.length > 0 ? delegatedPermissions : undefined,
      });

      if (res.success && res.user) {
        setToastMessage(`User ${res.user.name} created successfully!`);
        setTimeout(() => {
          router.push("/users");
        }, 1000);
      } else {
        setToastMessage(res.error || "Failed to create user.");
      }
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Error creating user.");
    } finally {
      setIsSubmitting(false);
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
            <span className="text-xs font-medium text-crm-text">Create New User</span>
          </div>
        </div>

        {/* Header Card */}
        <div className="bg-crm-surface border border-crm-border rounded-lg p-5 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 text-crm-primary flex items-center justify-center font-bold text-lg shadow-2xs">
              👤
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-crm-text">
                Create & Onboard Team Member
              </h1>
              <p className="text-xs text-crm-muted">
                Step-by-step role provisioning with strict tenant scoping and credential setup.
              </p>
            </div>
          </div>

          {/* Stepper Wizard Indicator */}
          <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-crm-border text-xs">
            <div
              className={`p-2.5 rounded border text-center font-semibold transition-all ${
                currentStep === 1
                  ? "bg-teal-50 border-teal-300 text-teal-800"
                  : currentStep > 1
                  ? "bg-stone-50 border-crm-border text-crm-muted"
                  : "bg-white border-crm-border text-crm-muted"
              }`}
            >
              <span className="block text-[10px] uppercase font-bold">Step 1</span>
              Identity & Role
            </div>

            <div
              className={`p-2.5 rounded border text-center font-semibold transition-all ${
                currentStep === 2
                  ? "bg-teal-50 border-teal-300 text-teal-800"
                  : currentStep > 2
                  ? "bg-stone-50 border-crm-border text-crm-muted"
                  : "bg-white border-crm-border text-crm-muted"
              }`}
            >
              <span className="block text-[10px] uppercase font-bold">Step 2</span>
              Team Hierarchy
            </div>

            <div
              className={`p-2.5 rounded border text-center font-semibold transition-all ${
                currentStep === 3
                  ? "bg-teal-50 border-teal-300 text-teal-800"
                  : "bg-white border-crm-border text-crm-muted"
              }`}
            >
              <span className="block text-[10px] uppercase font-bold">Step 3</span>
              Security & Credentials
            </div>
          </div>
        </div>

        {/* Wizard Card */}
        <div className="bg-crm-surface border border-crm-border rounded-lg p-6 shadow-2xs">
          {/* STEP 1: Identity & Role Selection */}
          {currentStep === 1 && (
            <div className="space-y-4 text-xs">
              <h2 className="text-sm font-bold text-crm-text border-b border-crm-border pb-2">
                1. Member Identity & Assigned Role
              </h2>

              <div>
                <label className="block font-semibold text-crm-text mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  placeholder="ramesh@brokerage.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
                <span className="text-[10px] text-crm-muted mt-0.5 block">
                  Used for account login and official workflow notifications.
                </span>
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">Phone Number (Optional)</label>
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">Operational Role *</label>
                <select
                  value={role}
                  onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>
                      {r.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-crm-muted mt-0.5 block">
                  Determines data visibility, workflow permissions, and operational scope.
                </span>
              </div>

              <div className="pt-4 border-t border-crm-border flex justify-between">
                <Link
                  href="/users"
                  className="px-4 py-2 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50"
                >
                  Cancel
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    if (validateStep1()) setCurrentStep(2);
                  }}
                  className="px-5 py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                >
                  Next: Hierarchy →
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Team Hierarchy & Reporting Structure */}
          {currentStep === 2 && (
            <div className="space-y-4 text-xs">
              <h2 className="text-sm font-bold text-crm-text border-b border-crm-border pb-2">
                2. Reporting Hierarchy & Superiors
              </h2>

              {role === UserRole.TEAM_LEADER ? (
                <div>
                  <label className="block font-semibold text-crm-text mb-1">
                    Assign Reporting Broker Owner (Optional)
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
                  <p className="text-[10px] text-crm-muted mt-1">
                    Team Leaders report directly to the brokerage owner.
                  </p>
                </div>
              ) : role === UserRole.TELECALLER ||
                role === UserRole.FIELD_VERIFIER ||
                role === UserRole.FIELD_SALES_AGENT ? (
                <div>
                  <label className="block font-semibold text-crm-text mb-1">
                    Assigned Team Leader
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
                  <p className="text-[10px] text-crm-muted mt-1">
                    Subordinates can be supervised and reviewed by their assigned Team Leader.
                  </p>
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-stone-50 border border-crm-border text-crm-muted">
                  <p className="font-semibold text-crm-text">No Hierarchy Required</p>
                  <p className="text-[11px] mt-0.5">
                    Role &quot;{role.replace(/_/g, " ")}&quot; functions as an independent or administrative account without subordinate reporting.
                  </p>
                </div>
              )}

              <div className="pt-4 border-t border-crm-border flex justify-between">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="px-4 py-2 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50"
                >
                  ← Back to Identity
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (validateStep2()) setCurrentStep(3);
                  }}
                  className="px-5 py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                >
                  Next: Security & Credentials →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Security & Credentials */}
          {currentStep === 3 && (
            <form onSubmit={handleSubmit} className="space-y-5 text-xs">
              <h2 className="text-sm font-bold text-crm-text border-b border-crm-border pb-2">
                3. Security, Password & Account Provisioning
              </h2>

              {/* Summary Review */}
              <div className="p-3.5 rounded-lg bg-stone-50/80 border border-crm-border grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <span className="text-[10px] text-crm-muted uppercase font-bold block">Name</span>
                  <strong className="text-crm-text">{name}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-crm-muted uppercase font-bold block">Email</span>
                  <span className="text-crm-text truncate block">{email}</span>
                </div>
                <div>
                  <span className="text-[10px] text-crm-muted uppercase font-bold block">Role</span>
                  <span className="font-bold text-crm-primary">{role.replace(/_/g, " ")}</span>
                </div>
                <div>
                  <span className="text-[10px] text-crm-muted uppercase font-bold block">Supervisor</span>
                  <span className="text-crm-text">
                    {teamLeaderId
                      ? teamLeaders.find((t) => t.id === teamLeaderId)?.name || "Assigned TL"
                      : brokerId
                      ? brokers.find((b) => b.id === brokerId)?.name || "Assigned Broker"
                      : "Direct"}
                  </span>
                </div>
              </div>

              {/* Credential Setup Options */}
              <div className="space-y-3">
                <label className="block font-semibold text-crm-text">
                  Choose Onboarding Method *
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label
                    className={`p-3.5 rounded-lg border cursor-pointer transition-all flex items-start gap-2.5 ${
                      credentialMethod === "INVITATION"
                        ? "bg-teal-50/70 border-teal-300 ring-1 ring-teal-300"
                        : "bg-white border-crm-border hover:bg-stone-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="credentialMethod"
                      value="INVITATION"
                      checked={credentialMethod === "INVITATION"}
                      onChange={() => setCredentialMethod("INVITATION")}
                      className="mt-0.5 text-crm-primary"
                    />
                    <div>
                      <strong className="text-crm-text block">Send Email Invitation Link</strong>
                      <p className="text-[11px] text-crm-muted mt-0.5">
                        User receives an activation email with a secure token to set their password.
                      </p>
                    </div>
                  </label>

                  <label
                    className={`p-3.5 rounded-lg border cursor-pointer transition-all flex items-start gap-2.5 ${
                      credentialMethod === "PASSWORD"
                        ? "bg-teal-50/70 border-teal-300 ring-1 ring-teal-300"
                        : "bg-white border-crm-border hover:bg-stone-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="credentialMethod"
                      value="PASSWORD"
                      checked={credentialMethod === "PASSWORD"}
                      onChange={() => setCredentialMethod("PASSWORD")}
                      className="mt-0.5 text-crm-primary"
                    />
                    <div>
                      <strong className="text-crm-text block">Set Initial Password Directly</strong>
                      <p className="text-[11px] text-crm-muted mt-0.5">
                        Administrator defines initial login password immediately.
                      </p>
                    </div>
                  </label>
                </div>

                {credentialMethod === "PASSWORD" && (
                  <div className="pt-2 space-y-1">
                    <label className="block font-semibold text-crm-text">
                      Initial Password *
                    </label>
                    <PasswordInput
                      required
                      minLength={8}
                      placeholder="Minimum 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                    />
                    <span className="text-[10px] text-crm-muted block">
                      User can sign in immediately using their email and this password.
                    </span>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-crm-border flex justify-between">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="px-4 py-2 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50"
                >
                  ← Back to Hierarchy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSubmitting ? "Creating User..." : "✓ Complete & Create User"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </AppShell>
  );
}
