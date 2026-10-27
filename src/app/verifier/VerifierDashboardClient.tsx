"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { PropertyVerificationView, VerificationStats } from "@/types/crm";

interface VerifierDashboardClientProps {
  initialVerifications: PropertyVerificationView[];
  stats: VerificationStats;
  userName: string;
  userRole: string;
}

export function VerifierDashboardClient({
  initialVerifications,
  stats,
  userName,
  userRole,
}: VerifierDashboardClientProps) {
  const [verifications] = useState<PropertyVerificationView[]>(initialVerifications);
  const [filter, setFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredVerifications = useMemo(() => {
    return verifications.filter((v) => {
      // Filter tab
      if (filter === "ASSIGNED" && v.status !== "ASSIGNED") return false;
      if (filter === "IN_PROGRESS" && v.status !== "IN_PROGRESS") return false;
      if (filter === "SUBMITTED" && v.status !== "SUBMITTED") return false;
      if (filter === "COMPLETED" && v.status !== "APPROVED") return false;
      if (
        filter === "ATTENTION" &&
        v.status !== "UNABLE_TO_VERIFY" &&
        v.status !== "REJECTED"
      ) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesSociety = v.societyName.toLowerCase().includes(query);
        const matchesLocality = v.locality.toLowerCase().includes(query);
        const matchesFlat = v.flatNumber.toLowerCase().includes(query);
        return matchesSociety || matchesLocality || matchesFlat;
      }

      return true;
    });
  }, [verifications, filter, searchQuery]);

  const getStatusBadge = (status: PropertyVerificationView["status"]) => {
    switch (status) {
      case "ASSIGNED":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            Pending Start
          </span>
        );
      case "IN_PROGRESS":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200">
            Visit In Progress
          </span>
        );
      case "SUBMITTED":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-800 border border-purple-200">
            Submitted for Review
          </span>
        );
      case "APPROVED":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            Field Verified
          </span>
        );
      case "UNABLE_TO_VERIFY":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 text-stone-700 border border-stone-300">
            Unable to Verify
          </span>
        );
      case "REJECTED":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200">
            Re-verification Needed
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <AppShell activePage="Overview" userName={userName} userRole={userRole} isAuthenticated={true}>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Mobile Header / Welcome banner */}
        <div className="bg-white rounded-lg border border-crm-border p-4 sm:p-6 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <span className="text-[11px] uppercase tracking-wider font-bold text-crm-muted">
                Field Operations
              </span>
              <h1 className="text-xl sm:text-2xl font-bold text-crm-text mt-0.5">
                My Verification Tasks
              </h1>
              <p className="text-xs sm:text-sm text-crm-muted mt-1">
                Conduct on-site inspections, verify property specifications, and capture photo evidence.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200">
                Active Verifier: {userName}
              </span>
            </div>
          </div>
        </div>

        {/* Correctly Scoped Stat Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <button
            onClick={() => setFilter("ASSIGNED")}
            className={`p-3 rounded-lg border text-left transition-all ${
              filter === "ASSIGNED"
                ? "bg-amber-50 border-amber-300 ring-2 ring-amber-400/30"
                : "bg-white border-crm-border hover:bg-stone-50"
            }`}
          >
            <span className="text-[11px] text-crm-muted font-medium block">Pending Start</span>
            <span className="text-xl font-bold text-amber-700 mt-1 block">{stats.assigned}</span>
          </button>

          <button
            onClick={() => setFilter("IN_PROGRESS")}
            className={`p-3 rounded-lg border text-left transition-all ${
              filter === "IN_PROGRESS"
                ? "bg-blue-50 border-blue-300 ring-2 ring-blue-400/30"
                : "bg-white border-crm-border hover:bg-stone-50"
            }`}
          >
            <span className="text-[11px] text-crm-muted font-medium block">In Progress</span>
            <span className="text-xl font-bold text-blue-700 mt-1 block">{stats.inProgress}</span>
          </button>

          <button
            onClick={() => setFilter("SUBMITTED")}
            className={`p-3 rounded-lg border text-left transition-all ${
              filter === "SUBMITTED"
                ? "bg-purple-50 border-purple-300 ring-2 ring-purple-400/30"
                : "bg-white border-crm-border hover:bg-stone-50"
            }`}
          >
            <span className="text-[11px] text-crm-muted font-medium block">In Review</span>
            <span className="text-xl font-bold text-purple-700 mt-1 block">{stats.submitted}</span>
          </button>

          <button
            onClick={() => setFilter("COMPLETED")}
            className={`p-3 rounded-lg border text-left transition-all ${
              filter === "COMPLETED"
                ? "bg-emerald-50 border-emerald-300 ring-2 ring-emerald-400/30"
                : "bg-white border-crm-border hover:bg-stone-50"
            }`}
          >
            <span className="text-[11px] text-crm-muted font-medium block">Verified</span>
            <span className="text-xl font-bold text-emerald-700 mt-1 block">{stats.approved}</span>
          </button>

          <button
            onClick={() => setFilter("ATTENTION")}
            className={`p-3 rounded-lg border text-left transition-all ${
              filter === "ATTENTION"
                ? "bg-stone-100 border-stone-300 ring-2 ring-stone-400/30"
                : "bg-white border-crm-border hover:bg-stone-50"
            }`}
          >
            <span className="text-[11px] text-crm-muted font-medium block">Unable to Verify</span>
            <span className="text-xl font-bold text-stone-700 mt-1 block">{stats.unableToVerify}</span>
          </button>

          <button
            onClick={() => setFilter("ATTENTION")}
            className={`p-3 rounded-lg border text-left transition-all ${
              filter === "ATTENTION"
                ? "bg-rose-50 border-rose-300 ring-2 ring-rose-400/30"
                : "bg-white border-crm-border hover:bg-stone-50"
            }`}
          >
            <span className="text-[11px] text-crm-muted font-medium block">Re-verify</span>
            <span className="text-xl font-bold text-rose-700 mt-1 block">{stats.rejected}</span>
          </button>
        </div>

        {/* Filter Bar & Search */}
        <div className="bg-white rounded-lg border border-crm-border p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {[
              { id: "ALL", label: `All (${verifications.length})` },
              { id: "ASSIGNED", label: `Pending (${stats.assigned})` },
              { id: "IN_PROGRESS", label: `In Progress (${stats.inProgress})` },
              { id: "SUBMITTED", label: `In Review (${stats.submitted})` },
              { id: "COMPLETED", label: `Completed (${stats.approved})` },
              { id: "ATTENTION", label: `Issues (${stats.unableToVerify + stats.rejected})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-all ${
                  filter === tab.id
                    ? "bg-crm-primary text-white shadow-2xs"
                    : "bg-stone-100 text-crm-text hover:bg-stone-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[200px]">
            <input
              type="text"
              placeholder="Search society or locality..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs px-3 py-1.5 rounded-md border border-crm-border bg-stone-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-crm-primary"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-crm-muted text-xs hover:text-crm-text"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Task Cards List */}
        {filteredVerifications.length === 0 ? (
          <div className="bg-white rounded-lg border border-crm-border p-12 text-center shadow-2xs">
            <div className="w-12 h-12 rounded-full bg-stone-100 text-stone-400 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-crm-text">No verification tasks found</h3>
            <p className="text-xs text-crm-muted mt-1 max-w-sm mx-auto">
              {searchQuery
                ? "No tasks match your search criteria. Try a different keyword."
                : "You currently have no tasks in this queue. When assignments are made by your Team Leader, they will appear here."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredVerifications.map((v) => (
              <div
                key={v.id}
                className="bg-white rounded-lg border border-crm-border p-4 shadow-2xs hover:border-crm-primary/40 transition-all flex flex-col justify-between"
              >
                <div className="space-y-3">
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold text-crm-muted uppercase tracking-wider block">
                        {v.propertyType} • {v.preference}
                      </span>
                      <h3 className="font-bold text-crm-text text-sm mt-0.5 leading-snug">
                        {v.societyName}
                      </h3>
                      <div className="text-xs text-crm-muted">
                        Unit: <span className="font-semibold text-crm-text">{v.flatNumber}</span>
                      </div>
                    </div>
                    {getStatusBadge(v.status)}
                  </div>

                  {/* Locality & Specs */}
                  <div className="bg-stone-50 rounded p-2.5 text-xs space-y-1.5 border border-stone-100">
                    <div className="flex items-center justify-between text-crm-muted">
                      <span>Locality:</span>
                      <strong className="text-crm-text">{v.locality}, {v.city}</strong>
                    </div>
                    <div className="flex items-center justify-between text-crm-muted">
                      <span>Listed Configuration:</span>
                      <strong className="text-crm-text">{v.bedroomCount} BHK • {v.bathroomCount} Bath</strong>
                    </div>
                    <div className="flex items-center justify-between text-crm-muted">
                      <span>Listed Price:</span>
                      <strong className="text-crm-primary font-bold">{v.priceFormatted}</strong>
                    </div>
                  </div>

                  {/* Key Contact Preview */}
                  <div className="text-xs text-crm-muted flex items-center justify-between pt-1">
                    <span>Key Holder:</span>
                    <span className="font-medium text-crm-text">
                      {v.keyHolderName ? `${v.keyHolderName} (${v.keyHolderPersona || "Cust."})` : v.ownerName}
                    </span>
                  </div>

                  {/* Rejection / Redo Notice */}
                  {v.status === "REJECTED" && v.reviewNotes && (
                    <div className="p-2 rounded bg-rose-50 border border-rose-200 text-xs text-rose-800">
                      <strong>Re-verification requested:</strong> {v.reviewNotes}
                    </div>
                  )}

                  {/* Unable to verify reason */}
                  {v.status === "UNABLE_TO_VERIFY" && v.unableToVerifyReason && (
                    <div className="p-2 rounded bg-stone-100 border border-stone-200 text-xs text-stone-700">
                      <strong>Reason:</strong> {v.unableToVerifyReason.replace(/_/g, " ")}
                    </div>
                  )}
                </div>

                {/* Footer Action */}
                <div className="pt-4 mt-3 border-t border-crm-border/60 flex items-center justify-between">
                  <span className="text-[11px] text-crm-muted">
                    Photos: <strong>{v.media.length}</strong>
                  </span>
                  <Link
                    href={`/verifier/tasks/${v.id}`}
                    className="px-3.5 py-1.5 rounded-md text-xs font-bold bg-crm-primary text-white hover:bg-crm-primary-hover transition-colors shadow-2xs inline-flex items-center gap-1.5"
                  >
                    <span>{v.status === "ASSIGNED" ? "Start Task" : "Open Task"}</span>
                    <span>→</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

