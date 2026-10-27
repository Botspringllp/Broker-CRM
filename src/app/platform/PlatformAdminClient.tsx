"use client";

import React, { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { provisionTenantAction, toggleTenantStatusAction } from "./actions";

export interface TenantViewItem {
  id: string;
  name: string;
  slug: string;
  contactEmail: string | null;
  contactPhone: string | null;
  maxSeats: number;
  isActive: boolean;
  createdAt: string | Date;
  _count: {
    users: number;
    properties: number;
    leads: number;
  };
}

interface PlatformAdminClientProps {
  initialTenants: TenantViewItem[];
}

export function PlatformAdminClient({ initialTenants }: PlatformAdminClientProps) {
  const [tenants, setTenants] = useState<TenantViewItem[]>(initialTenants);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Modal states
  const [isProvisionOpen, setIsProvisionOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "warning" | "info" } | null>(null);

  // Status toggle confirmation modal
  const [statusTarget, setStatusTarget] = useState<TenantViewItem | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    contactEmail: "",
    contactPhone: "",
    maxSeats: 15,
    adminName: "",
    adminEmail: "",
    adminPhone: "",
    adminPassword: "",
  });

  const showToast = (text: string, type: "success" | "warning" | "info" = "success") => {
    setToastMessage({ text, type });
  };

  // Filtered tenants
  const filteredTenants = useMemo(() => {
    return tenants.filter((t) => {
      if (statusFilter === "ACTIVE" && !t.isActive) return false;
      if (statusFilter === "INACTIVE" && t.isActive) return false;

      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        const matchesName = t.name.toLowerCase().includes(query);
        const matchesSlug = t.slug.toLowerCase().includes(query);
        const matchesEmail = t.contactEmail?.toLowerCase().includes(query) ?? false;
        if (!matchesName && !matchesSlug && !matchesEmail) return false;
      }

      return true;
    });
  }, [tenants, statusFilter, searchTerm]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    const total = tenants.length;
    const active = tenants.filter((t) => t.isActive).length;
    const totalSeats = tenants.reduce((acc, t) => acc + (t.maxSeats || 0), 0);
    const totalUsers = tenants.reduce((acc, t) => acc + (t._count?.users || 0), 0);
    return { total, active, totalSeats, totalUsers };
  }, [tenants]);

  // Auto-generate slug from name and default admin name
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    const autoSlug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    setFormData((prev) => ({
      ...prev,
      name,
      slug: prev.slug === "" || prev.slug === autoSlug.slice(0, -1) ? autoSlug : prev.slug,
      adminName: prev.adminName === "" || prev.adminName === prev.name ? name : prev.adminName,
    }));
  };

  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = formData.name.trim();
    const cleanSlug = formData.slug.toLowerCase().trim();
    const cleanAdminEmail = formData.adminEmail.toLowerCase().trim();
    const cleanAdminName = formData.adminName.trim() || cleanName;

    if (!cleanName || !cleanSlug || !cleanAdminEmail || !formData.adminPassword) {
      showToast("Please fill in all mandatory fields.", "warning");
      return;
    }

    if (formData.adminPassword.length < 8) {
      showToast("Admin password must be at least 8 characters.", "warning");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await provisionTenantAction({
        name: cleanName,
        slug: cleanSlug,
        contactEmail: cleanAdminEmail,
        contactPhone: formData.adminPhone?.trim() || undefined,
        maxSeats: Number(formData.maxSeats) || 15,
        adminName: cleanAdminName,
        adminEmail: cleanAdminEmail,
        adminPhone: formData.adminPhone?.trim() || undefined,
        adminPassword: formData.adminPassword,
      });

      if (res.success && res.data) {
        showToast(`Tenant '${res.data.tenant.name}' provisioned successfully!`);
        setTenants((prev) => [
          {
            id: res.data!.tenant.id,
            name: res.data!.tenant.name,
            slug: res.data!.tenant.slug,
            contactEmail: res.data!.tenant.contactEmail,
            contactPhone: res.data!.tenant.contactPhone,
            maxSeats: res.data!.tenant.maxSeats,
            isActive: res.data!.tenant.isActive,
            createdAt: new Date().toISOString(),
            _count: { users: 1, properties: 0, leads: 0 },
          },
          ...prev,
        ]);
        setIsProvisionOpen(false);
        setFormData({
          name: "",
          slug: "",
          contactEmail: "",
          contactPhone: "",
          maxSeats: 15,
          adminName: "",
          adminEmail: "",
          adminPhone: "",
          adminPassword: "",
        });
      } else {
        showToast(res.error || "Failed to provision tenant.", "warning");
      }
    } catch {
      showToast("An unexpected error occurred during provisioning.", "warning");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!statusTarget) return;
    setIsSubmitting(true);
    const newStatus = !statusTarget.isActive;

    try {
      const res = await toggleTenantStatusAction(statusTarget.id, newStatus);
      if (res.success) {
        showToast(`Tenant '${statusTarget.name}' has been ${newStatus ? "activated" : "deactivated"}.`);
        setTenants((prev) =>
          prev.map((t) => (t.id === statusTarget.id ? { ...t, isActive: newStatus } : t))
        );
        setStatusTarget(null);
      } else {
        showToast(res.error || "Failed to update tenant status.", "warning");
      }
    } catch {
      showToast("Failed to toggle tenant status.", "warning");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell activePage="platform">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-[#1E2A32]">Platform Administration</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#1F6F6B]/10 text-[#1F6F6B] border border-[#1F6F6B]/30">
                Super Admin Console
              </span>
            </div>
            <p className="text-sm text-[#667085] mt-1">
              Onboard and provision brokerage tenants, allocate user seats, and manage platform tenancy status.
            </p>
          </div>
          <button
            onClick={() => setIsProvisionOpen(true)}
            className="px-4 py-2 bg-[#1F6F6B] hover:bg-[#165451] text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Provision New Tenant
          </button>
        </div>

        {/* Platform Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg p-5 border border-[#E4DFD5] shadow-xs">
            <span className="text-xs font-medium text-[#667085] uppercase tracking-wider">Total Tenants</span>
            <div className="text-2xl font-bold text-[#1E2A32] mt-1">{metrics.total}</div>
            <div className="text-xs text-[#2E7D4F] mt-1">Provisioned brokerages</div>
          </div>
          <div className="bg-white rounded-lg p-5 border border-[#E4DFD5] shadow-xs">
            <span className="text-xs font-medium text-[#667085] uppercase tracking-wider">Active Tenants</span>
            <div className="text-2xl font-bold text-[#1F6F6B] mt-1">{metrics.active}</div>
            <div className="text-xs text-[#667085] mt-1">Operational organizations</div>
          </div>
          <div className="bg-white rounded-lg p-5 border border-[#E4DFD5] shadow-xs">
            <span className="text-xs font-medium text-[#667085] uppercase tracking-wider">Total Seats Allocated</span>
            <div className="text-2xl font-bold text-[#1E2A32] mt-1">{metrics.totalSeats}</div>
            <div className="text-xs text-[#3B5BA9] mt-1">{metrics.totalUsers} active user accounts</div>
          </div>
        </div>

        {/* Filters & Search */}
        <div className="bg-white p-4 rounded-lg border border-[#E4DFD5] flex flex-col sm:flex-row gap-3 justify-between items-center shadow-xs">
          <div className="w-full sm:w-80">
            <input
              type="text"
              placeholder="Search by tenant name, slug, or contact..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-1.5 border border-[#E4DFD5] rounded-md text-sm text-[#1E2A32] placeholder-[#667085] focus:outline-none focus:border-[#1F6F6B]"
            />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs text-[#667085] font-medium">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 border border-[#E4DFD5] rounded-md text-sm text-[#1E2A32] focus:outline-none focus:border-[#1F6F6B] bg-white"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Inactive Only</option>
            </select>
          </div>
        </div>

        {/* Tenants Table */}
        <div className="bg-white rounded-lg border border-[#E4DFD5] shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[#1E2A32]">
              <thead className="bg-[#F7F5F0] border-b border-[#E4DFD5] text-xs font-semibold text-[#667085] uppercase">
                <tr>
                  <th className="py-3 px-4">Organization / Tenant</th>
                  <th className="py-3 px-4">Identifier (Slug)</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Seat Allocation</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4DFD5]">
                {filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-[#667085]">
                      <div className="max-w-sm mx-auto space-y-3">
                        <svg className="w-10 h-10 mx-auto text-[#667085]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        <p className="font-medium text-[#1E2A32]">No brokerage tenants found</p>
                        <p className="text-xs text-[#667085]">
                          {tenants.length === 0
                            ? "Get started by provisioning the first brokerage organization on this platform."
                            : "No tenants match your search filter criteria."}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredTenants.map((tenant) => (
                    <tr key={tenant.id} className="hover:bg-[#F7F5F0]/50 transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-[#1E2A32]">
                        {tenant.name}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-[#667085]">
                        {tenant.slug}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            tenant.isActive
                              ? "bg-[#2E7D4F]/10 text-[#2E7D4F] border border-[#2E7D4F]/30"
                              : "bg-[#B3261E]/10 text-[#B3261E] border border-[#B3261E]/30"
                          }`}
                        >
                          {tenant.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-medium">{tenant._count.users}</span>
                        <span className="text-[#667085] text-xs"> / {tenant.maxSeats} seats</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="text-xs text-[#1E2A32]">{tenant.contactEmail || "—"}</div>
                        <div className="text-xs text-[#667085]">{tenant.contactPhone || ""}</div>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-[#667085]">
                        {new Date(tenant.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => setStatusTarget(tenant)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-md border transition-colors ${
                            tenant.isActive
                              ? "text-[#B3261E] border-[#B3261E]/30 hover:bg-[#B3261E]/10"
                              : "text-[#2E7D4F] border-[#2E7D4F]/30 hover:bg-[#2E7D4F]/10"
                          }`}
                        >
                          {tenant.isActive ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Provision Tenant Modal */}
        <Modal
          isOpen={isProvisionOpen}
          onClose={() => setIsProvisionOpen(false)}
          title="Provision New Tenant Account"
        >
          <form onSubmit={handleProvisionSubmit} className="space-y-4">
            <div className="bg-[#F7F5F0] p-3 rounded-md border border-[#E4DFD5] text-xs text-[#667085]">
              Creates an isolated brokerage tenant organization and provisions its initial CRM Tenant Admin login account.
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#1E2A32] mb-1">
                  Brokerage / Tenant Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Vikrant Singh or Apex Realty"
                  value={formData.name}
                  onChange={handleNameChange}
                  className="w-full px-3 py-1.5 border border-[#E4DFD5] rounded-md text-sm text-[#1E2A32] focus:outline-none focus:border-[#1F6F6B]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1E2A32] mb-1">
                    Tenant Identifier (Slug) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. vikrant"
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase() })}
                    className="w-full px-3 py-1.5 border border-[#E4DFD5] rounded-md text-sm font-mono text-[#1E2A32] focus:outline-none focus:border-[#1F6F6B]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1E2A32] mb-1">
                    Max User Seats *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={500}
                    value={formData.maxSeats}
                    onChange={(e) => setFormData({ ...formData, maxSeats: Number(e.target.value) })}
                    className="w-full px-3 py-1.5 border border-[#E4DFD5] rounded-md text-sm text-[#1E2A32] focus:outline-none focus:border-[#1F6F6B]"
                  />
                </div>
              </div>

              <div className="border-t border-[#E4DFD5] pt-3">
                <div className="text-xs font-bold text-[#1E2A32] uppercase tracking-wider mb-2 flex items-center justify-between">
                  <span>Tenant Admin Credentials</span>
                  <span className="text-[10px] text-[#667085] font-normal lowercase">(Login details for tenant)</span>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#1E2A32] mb-1">
                        Admin Full Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Vikrant Singh"
                        value={formData.adminName}
                        onChange={(e) => setFormData({ ...formData, adminName: e.target.value })}
                        className="w-full px-3 py-1.5 border border-[#E4DFD5] rounded-md text-sm text-[#1E2A32] focus:outline-none focus:border-[#1F6F6B]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#1E2A32] mb-1">
                        Admin Work Email (Login) *
                      </label>
                      <input
                        type="email"
                        required
                        placeholder="e.g. vikrant@crm.in"
                        value={formData.adminEmail}
                        onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
                        className="w-full px-3 py-1.5 border border-[#E4DFD5] rounded-md text-sm text-[#1E2A32] focus:outline-none focus:border-[#1F6F6B]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#1E2A32] mb-1">
                        Contact Phone (Optional)
                      </label>
                      <input
                        type="tel"
                        placeholder="+91 98765 43210"
                        value={formData.adminPhone}
                        onChange={(e) => setFormData({ ...formData, adminPhone: e.target.value })}
                        className="w-full px-3 py-1.5 border border-[#E4DFD5] rounded-md text-sm text-[#1E2A32] focus:outline-none focus:border-[#1F6F6B]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#1E2A32] mb-1">
                        Initial Login Password *
                      </label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        placeholder="Min 8 characters"
                        value={formData.adminPassword}
                        onChange={(e) => setFormData({ ...formData, adminPassword: e.target.value })}
                        className="w-full px-3 py-1.5 border border-[#E4DFD5] rounded-md text-sm text-[#1E2A32] focus:outline-none focus:border-[#1F6F6B]"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-[#E4DFD5]">
              <button
                type="button"
                onClick={() => setIsProvisionOpen(false)}
                className="px-4 py-2 border border-[#E4DFD5] text-sm font-semibold rounded-md text-[#1E2A32] hover:bg-[#F7F5F0]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 bg-[#1F6F6B] hover:bg-[#165451] text-white text-sm font-semibold rounded-md shadow-sm transition-colors disabled:opacity-50"
              >
                {isSubmitting ? "Provisioning..." : "Provision Tenant Account"}
              </button>
            </div>
          </form>
        </Modal>

        {/* Status Toggle Confirmation Modal */}
        <Modal
          isOpen={!!statusTarget}
          onClose={() => setStatusTarget(null)}
          title={statusTarget?.isActive ? "Deactivate Tenant" : "Activate Tenant"}
        >
          <div className="space-y-4">
            <p className="text-sm text-[#1E2A32]">
              Are you sure you want to {statusTarget?.isActive ? "deactivate" : "activate"} tenant{" "}
              <strong>{statusTarget?.name}</strong>?
            </p>
            {statusTarget?.isActive && (
              <div className="p-3 bg-[#B3261E]/10 border border-[#B3261E]/20 rounded-md text-xs text-[#B3261E]">
                <strong>Warning:</strong> Deactivating this tenant immediately blocks all associated users from performing CRM operations on the server. Tenant records are preserved.
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStatusTarget(null)}
                className="px-4 py-2 border border-[#E4DFD5] text-sm font-semibold rounded-md text-[#1E2A32] hover:bg-[#F7F5F0]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleToggleStatus}
                disabled={isSubmitting}
                className={`px-4 py-2 text-white text-sm font-semibold rounded-md shadow-sm transition-colors disabled:opacity-50 ${
                  statusTarget?.isActive ? "bg-[#B3261E] hover:bg-[#8F1E17]" : "bg-[#2E7D4F] hover:bg-[#23633E]"
                }`}
              >
                {isSubmitting ? "Updating..." : statusTarget?.isActive ? "Confirm Deactivation" : "Confirm Activation"}
              </button>
            </div>
          </div>
        </Modal>

        {/* Toast */}
        {toastMessage && (
          <Toast
            message={toastMessage.text}
            type={toastMessage.type}
            onClose={() => setToastMessage(null)}
          />
        )}
      </div>
    </AppShell>
  );
}
