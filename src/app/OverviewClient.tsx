"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Toast } from "@/components/ui/Toast";
import { Property, Lead, SiteVisit, CallerDashboardMetrics, ManagerDemandMetrics } from "@/types/crm";
import { PendingCallbacksCompact } from "@/components/leads/PendingCallbacksCompact";
import { useSession } from "@/lib/auth-client";

interface OverviewClientProps {
  initialProperties: Property[];
  initialLeads: Lead[];
  initialVisits: SiteVisit[];
  userName: string;
  userRole: string;
  rawRole?: string;
  callerMetrics?: CallerDashboardMetrics | null;
  managerMetrics?: ManagerDemandMetrics | null;
  isAuthenticated: boolean;
}

export function OverviewClient({
  initialProperties,
  initialLeads,
  initialVisits,
  userName: serverUserName,
  userRole: serverUserRole,
  rawRole: serverRawRole,
  callerMetrics,
  managerMetrics,
  isAuthenticated: serverIsAuthenticated,
}: OverviewClientProps) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const { data: session } = useSession();

  const currentUserName = session?.user?.name || serverUserName;
  const currentRawRole =
    (session?.user as { role?: string })?.role || serverRawRole || serverUserRole.replace(/ /g, "_");
  const currentUserRole = currentRawRole.replace(/_/g, " ");
  const isTelecaller = currentRawRole === "TELECALLER";

  // Fallback derived counts from real data
  const pendingSupply = initialProperties.filter(
    (p) => p.validationStatus === "Not Validated" || p.validationStatus === "In Validation"
  );
  const pendingSupplyCount = pendingSupply.length;

  const pendingLeads = initialLeads.filter(
    (l) => l.status === "Not Yet Validated"
  );
  const pendingLeadsCount = pendingLeads.length;

  const activeLeadsCount = initialLeads.filter(
    (l) => l.status === "Active"
  ).length;

  const upcomingVisits = initialVisits.filter(
    (v) => v.status === "Confirmed" || v.status === "Tentative - Awaiting Owner"
  );

  const rentalRenewalCount = initialProperties.filter(
    (p) => p.revalidationStatus === "Due"
  ).length;

  // Leads approaching 3-attempt limit
  const nearLimitLeads = initialLeads.filter(
    (l) => l.unreachableCount === 2 && l.status !== "Inactive" && !l.isDoNotContact
  );

  const handleSimulateCall = (name: string) => {
    setToastMessage(`Initiated call to ${name}. Log disposition and notes on the detail page.`);
  };

  return (
    <AppShell
      userName={serverUserName}
      userRole={serverUserRole}
      isAuthenticated={serverIsAuthenticated}
    >
      <div className="space-y-6">
        {/* ========================================================= */}
        {/* TELECALLER DEDICATED DASHBOARD (DV-09 / PRD §5.5, §5.6)   */}
        {/* ========================================================= */}
        {isTelecaller ? (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-crm-border">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-crm-text">
                  Caller Dashboard &amp; Daily Workspace
                </h2>
                <p className="text-xs text-crm-muted mt-1">
                  Qualify buyer/tenant leads, manage scheduled callbacks, and track daily calling progress (PRD §5.5, §5.6).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-crm-muted">Active Telecaller:</span>
                <span className="px-2.5 py-1 text-xs font-semibold rounded bg-teal-50 border border-teal-200 text-teal-800 shadow-2xs">
                  {currentUserName}
                </span>
              </div>
            </div>

            {/* Urgent Callback Alerts */}
            {callerMetrics && (callerMetrics.callbacksOverdue > 0 || callerMetrics.callbacksDueToday > 0) && (
              <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">⏰</span>
                  <div>
                    <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                      Action Required: Scheduled Callbacks Due
                    </h4>
                    <p className="text-xs text-amber-800 mt-0.5">
                      You have{" "}
                      {callerMetrics.callbacksOverdue > 0 && (
                        <strong className="text-rose-700 underline font-bold">
                          {callerMetrics.callbacksOverdue} overdue callback{callerMetrics.callbacksOverdue > 1 ? "s" : ""}
                        </strong>
                      )}
                      {callerMetrics.callbacksOverdue > 0 && callerMetrics.callbacksDueToday > 0 && " and "}
                      {callerMetrics.callbacksDueToday > 0 && (
                        <strong className="text-amber-900 font-bold">
                          {callerMetrics.callbacksDueToday} callback{callerMetrics.callbacksDueToday > 1 ? "s" : ""} due today
                        </strong>
                      )}
                      . Follow up with these prospects promptly.
                    </p>
                  </div>
                </div>
                <Link
                  href="/leads?callback=HasCallback"
                  className="px-3 py-1.5 text-xs font-bold rounded bg-amber-700 text-white hover:bg-amber-800 shrink-0 text-center shadow-2xs"
                >
                  View Callback Queue →
                </Link>
              </div>
            )}

            {/* Unreachable 2-Attempt Near-Limit Alert */}
            {callerMetrics && callerMetrics.unreachableNearLimit > 0 && (
              <div className="p-3.5 rounded-lg bg-stone-50 border border-amber-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-xs text-amber-900">
                  <span className="font-bold text-amber-700">⚠️ Notice:</span>
                  <span>
                    <strong>{callerMetrics.unreachableNearLimit} prospect{callerMetrics.unreachableNearLimit > 1 ? "s" : ""}</strong> reached 2 unsuccessful call attempts. A 3rd attempt will reach the PRD §5.5 discretionary inactivation threshold.
                  </span>
                </div>
                <Link
                  href="/leads?status=Not+Yet+Validated"
                  className="text-xs font-semibold text-crm-primary hover:underline shrink-0"
                >
                  Review Prospects →
                </Link>
              </div>
            )}

            {/* 8 Required Summary Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5">
              {/* Card 1: Assigned Leads */}
              <Link
                href="/leads"
                className="p-3 rounded-lg bg-crm-surface border border-crm-border hover:border-crm-primary hover:shadow-xs transition-all group"
              >
                <div className="text-[10px] font-semibold text-crm-muted uppercase tracking-wider">
                  Assigned
                </div>
                <div className="text-xl font-bold text-crm-text mt-1 group-hover:text-crm-primary">
                  {callerMetrics?.assignedTotal ?? initialLeads.length}
                </div>
                <div className="text-[10px] text-crm-muted mt-0.5">My Total Queue</div>
              </Link>

              {/* Card 2: Not Yet Validated */}
              <Link
                href="/leads?status=Not+Yet+Validated"
                className="p-3 rounded-lg bg-crm-surface border border-amber-200 hover:border-crm-primary hover:shadow-xs transition-all group"
              >
                <div className="text-[10px] font-semibold text-amber-800 uppercase tracking-wider">
                  Pending Call
                </div>
                <div className="text-xl font-bold text-amber-700 mt-1">
                  {callerMetrics?.pendingValidation ?? pendingLeadsCount}
                </div>
                <div className="text-[10px] text-amber-800 mt-0.5">Requires Qual</div>
              </Link>

              {/* Card 3: Active Qualified */}
              <Link
                href="/leads?status=Active"
                className="p-3 rounded-lg bg-crm-surface border border-emerald-200 hover:border-crm-primary hover:shadow-xs transition-all group"
              >
                <div className="text-[10px] font-semibold text-emerald-800 uppercase tracking-wider">
                  Active Leads
                </div>
                <div className="text-xl font-bold text-emerald-700 mt-1">
                  {callerMetrics?.activeLeads ?? activeLeadsCount}
                </div>
                <div className="text-[10px] text-emerald-800 mt-0.5">Ready to Match</div>
              </Link>

              {/* Card 4: Inactive */}
              <Link
                href="/leads?status=Inactive"
                className="p-3 rounded-lg bg-crm-surface border border-crm-border hover:border-crm-primary hover:shadow-xs transition-all group"
              >
                <div className="text-[10px] font-semibold text-crm-muted uppercase tracking-wider">
                  Inactive
                </div>
                <div className="text-xl font-bold text-crm-muted mt-1">
                  {callerMetrics?.inactiveLeads ?? 0}
                </div>
                <div className="text-[10px] text-crm-muted mt-0.5">Closed / Dead</div>
              </Link>

              {/* Card 5: Calls Logged Today */}
              <div className="p-3 rounded-lg bg-crm-surface border border-crm-border">
                <div className="text-[10px] font-semibold text-crm-muted uppercase tracking-wider">
                  Calls Today
                </div>
                <div className="text-xl font-bold text-crm-text mt-1">
                  {callerMetrics?.callsLoggedToday ?? 0}
                </div>
                <div className="text-[10px] text-crm-muted mt-0.5">Attempts Logged</div>
              </div>

              {/* Card 6: Connected Today */}
              <div className="p-3 rounded-lg bg-crm-surface border border-emerald-100 bg-emerald-50/20">
                <div className="text-[10px] font-semibold text-emerald-800 uppercase tracking-wider">
                  Connected
                </div>
                <div className="text-xl font-bold text-emerald-700 mt-1">
                  {callerMetrics?.connectedToday ?? 0}
                </div>
                <div className="text-[10px] text-emerald-800 mt-0.5">Calls Spoken</div>
              </div>

              {/* Card 7: Callbacks Due Today */}
              <Link
                href="/leads?callback=HasCallback"
                className={`p-3 rounded-lg border transition-all ${
                  (callerMetrics?.callbacksDueToday ?? 0) > 0
                    ? "bg-amber-50/50 border-amber-300 ring-1 ring-amber-300"
                    : "bg-crm-surface border-crm-border hover:border-crm-primary"
                }`}
              >
                <div className="text-[10px] font-semibold text-amber-900 uppercase tracking-wider">
                  Due Today
                </div>
                <div className="text-xl font-bold text-amber-800 mt-1">
                  {callerMetrics?.callbacksDueToday ?? 0}
                </div>
                <div className="text-[10px] text-amber-800 mt-0.5">Callbacks Due</div>
              </Link>

              {/* Card 8: Overdue Callbacks */}
              <Link
                href="/leads?callback=HasCallback"
                className={`p-3 rounded-lg border transition-all ${
                  (callerMetrics?.callbacksOverdue ?? 0) > 0
                    ? "bg-rose-50 border-rose-300 ring-1 ring-rose-400"
                    : "bg-crm-surface border-crm-border hover:border-crm-primary"
                }`}
              >
                <div className="text-[10px] font-semibold text-rose-800 uppercase tracking-wider">
                  Overdue
                </div>
                <div className="text-xl font-bold text-rose-700 mt-1">
                  {callerMetrics?.callbacksOverdue ?? 0}
                </div>
                <div className="text-[10px] text-rose-800 mt-0.5">Past Scheduled</div>
              </Link>
            </div>

            {/* Embedded Callback Queue (Auto-expanded if callbacks due) */}
            <PendingCallbacksCompact
              defaultOpen={(callerMetrics?.callbacksDueToday ?? 0) > 0 || (callerMetrics?.callbacksOverdue ?? 0) > 0}
            />

            {/* Operational Priority Queues Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Column 1 & 2: Assigned Leads Requiring Validation */}
              <div className="lg:col-span-2 space-y-6">
                <div className="rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-crm-border flex items-center justify-between bg-stone-50/50">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-crm-text">
                        Assigned Leads Requiring Validation
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                        {pendingLeads.length} Leads
                      </span>
                    </div>
                    <Link
                      href="/leads?status=Not+Yet+Validated"
                      className="text-xs font-semibold text-crm-primary hover:underline"
                    >
                      View All Assigned →
                    </Link>
                  </div>

                  {pendingLeads.length === 0 ? (
                    <div className="p-8 text-center text-crm-muted space-y-1">
                      <p className="font-semibold text-crm-text text-sm">All assigned leads validated</p>
                      <p className="text-xs text-crm-muted">
                        No pending buyer or tenant leads awaiting qualification.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-crm-border">
                      {pendingLeads.slice(0, 6).map((lead) => (
                        <div
                          key={lead.id}
                          className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/50 transition-colors"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-crm-text">{lead.name}</span>
                              <span className="text-[11px] text-crm-muted">({lead.primaryPhone})</span>
                              <StatusBadge status={lead.status} />
                              {lead.unreachableCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                  {lead.unreachableCount} Unreachable
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-crm-muted flex items-center gap-3">
                              <span>Source: <strong className="text-crm-text">{lead.originalSource}</strong></span>
                              <span>Budget: <strong className="text-crm-text">{lead.requirements.budgetFormatted}</strong></span>
                              <span>{lead.requirements.preference}</span>
                              <span>City: {lead.requirements.city}</span>
                            </div>
                            <div className="text-xs text-crm-muted pt-0.5">
                              Last Call: <StatusBadge status={lead.currentDisposition} />
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleSimulateCall(lead.name)}
                              className="px-3 py-1.5 text-xs font-medium rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-100 shadow-2xs flex items-center gap-1 cursor-pointer"
                            >
                              <span>📞</span> Call Buyer
                            </button>
                            <Link
                              href={`/leads/${lead.id}`}
                              className="px-3 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                            >
                              Open Details
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Approaching 3-Attempt Threshold Section */}
                {nearLimitLeads.length > 0 && (
                  <div className="rounded-lg bg-amber-50/30 border border-amber-200 shadow-2xs overflow-hidden">
                    <div className="px-5 py-3 border-b border-amber-200 flex items-center justify-between bg-amber-50/60">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-800 font-bold">⚠️</span>
                        <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                          Prospects Near 3-Attempt Limit ({nearLimitLeads.length})
                        </h4>
                      </div>
                      <span className="text-[11px] text-amber-800">
                        2 Failed Attempts Recorded
                      </span>
                    </div>
                    <div className="divide-y divide-amber-100">
                      {nearLimitLeads.slice(0, 4).map((l) => (
                        <div key={l.id} className="p-3.5 flex items-center justify-between gap-3 text-xs">
                          <div>
                            <span className="font-bold text-crm-text">{l.name}</span>
                            <span className="text-crm-muted ml-2">({l.primaryPhone})</span>
                            <div className="text-[11px] text-crm-muted mt-0.5">
                              Source: {l.originalSource} • Budget: {l.requirements.budgetFormatted}
                            </div>
                          </div>
                          <Link
                            href={`/leads/${l.id}`}
                            className="px-2.5 py-1 text-xs font-semibold rounded border border-crm-border bg-white text-crm-primary hover:bg-stone-50"
                          >
                            Final Call Attempt →
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Column 3: Quick Navigation & Supply Calling Access */}
              <div className="space-y-6">
                {/* Supply Validation Calling Queue (Assigned to this Telecaller) */}
                <div className="rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-crm-border flex items-center justify-between bg-stone-50/50">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-crm-text">Assigned Supply Validation</h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                        {pendingSupplyCount}
                      </span>
                    </div>
                    <Link href="/supply" className="text-xs font-semibold text-crm-primary hover:underline">
                      All Supply →
                    </Link>
                  </div>
                  {pendingSupply.length === 0 ? (
                    <div className="p-6 text-center text-xs text-crm-muted">
                      No property validation tasks currently assigned to you.
                    </div>
                  ) : (
                    <div className="divide-y divide-crm-border">
                      {pendingSupply.slice(0, 4).map((prop) => (
                        <div key={prop.id} className="p-3.5 hover:bg-stone-50/50 flex items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-bold text-crm-text">{prop.societyName}</div>
                            <div className="text-[11px] text-crm-muted">
                              {prop.bedroomCount} BHK • Owner: {prop.ownerName}
                            </div>
                          </div>
                          <Link
                            href={`/supply/${prop.id}`}
                            className="px-2.5 py-1 text-xs font-semibold rounded bg-stone-100 hover:bg-stone-200 text-crm-text"
                          >
                            Call Owner
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quick Shortcuts */}
                <div className="p-4 rounded-lg bg-stone-50 border border-crm-border space-y-2">
                  <h4 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                    Quick Actions
                  </h4>
                  <div className="grid grid-cols-1 gap-2 pt-1">
                    <Link
                      href="/leads/new"
                      className="px-3 py-2 text-xs font-semibold rounded bg-white border border-crm-border hover:border-crm-primary text-crm-text flex items-center justify-between shadow-2xs"
                    >
                      <span>+ Register New Lead</span>
                      <span className="text-crm-muted">→</span>
                    </Link>
                    <Link
                      href="/leads?status=Active"
                      className="px-3 py-2 text-xs font-semibold rounded bg-white border border-crm-border hover:border-crm-primary text-crm-text flex items-center justify-between shadow-2xs"
                    >
                      <span>🔍 Browse Active Matched Leads</span>
                      <span className="text-crm-muted">→</span>
                    </Link>
                    <Link
                      href="/supply/active"
                      className="px-3 py-2 text-xs font-semibold rounded bg-white border border-crm-border hover:border-crm-primary text-crm-text flex items-center justify-between shadow-2xs"
                    >
                      <span>🏠 Active Supply Pool Inventory</span>
                      <span className="text-crm-muted">→</span>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ========================================================= */
          /* MANAGER / BROKER OWNER OVERVIEW (PRD §3, §5.6)            */
          /* ========================================================= */
          <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-crm-border">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-crm-text">
                  Brokerage Operations &amp; Demand Overview
                </h2>
                <p className="text-xs text-crm-muted mt-1">
                  Team execution metrics, unassigned lead backlog, telecaller workload, and active supply/demand tracking.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-crm-muted">Viewing as:</span>
                <span className="px-2.5 py-1 text-xs font-semibold rounded bg-crm-surface border border-crm-border text-crm-text shadow-2xs">
                  {currentUserName} ({currentUserRole})
                </span>
              </div>
            </div>

            {/* Unassigned Leads Alert (PRD §5.6 Assignment Backlog) */}
            {managerMetrics && managerMetrics.unassignedLeads > 0 && (
              <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">⚠️</span>
                  <div>
                    <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                      Assignment Backlog: Unassigned Leads Detected
                    </h4>
                    <p className="text-xs text-amber-800 mt-0.5">
                      There are <strong>{managerMetrics.unassignedLeads} unassigned lead{managerMetrics.unassignedLeads > 1 ? "s" : ""}</strong> awaiting telecaller allocation. Assign them to balance team workloads.
                    </p>
                  </div>
                </div>
                <Link
                  href="/leads?telecaller=Unassigned"
                  className="px-3.5 py-1.5 text-xs font-bold rounded bg-amber-700 text-white hover:bg-amber-800 shrink-0 text-center shadow-2xs"
                >
                  Allocate Leads Now →
                </Link>
              </div>
            )}

            {/* Manager Operational Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5">
              {/* Total Leads */}
              <Link
                href="/leads"
                className="p-3 rounded-lg bg-crm-surface border border-crm-border hover:border-crm-primary transition-all group"
              >
                <div className="text-[10px] font-semibold text-crm-muted uppercase tracking-wider">Total Leads</div>
                <div className="text-xl font-bold text-crm-text mt-1 group-hover:text-crm-primary">
                  {managerMetrics?.totalLeads ?? initialLeads.length}
                </div>
                <div className="text-[10px] text-crm-muted mt-0.5">All Demand</div>
              </Link>

              {/* In Validation */}
              <Link
                href="/leads?status=Not+Yet+Validated"
                className="p-3 rounded-lg bg-crm-surface border border-amber-200 hover:border-crm-primary transition-all group"
              >
                <div className="text-[10px] font-semibold text-amber-800 uppercase tracking-wider">In Validation</div>
                <div className="text-xl font-bold text-amber-700 mt-1">
                  {managerMetrics?.pendingValidation ?? pendingLeadsCount}
                </div>
                <div className="text-[10px] text-amber-800 mt-0.5">Pending Calling</div>
              </Link>

              {/* Active Qualified */}
              <Link
                href="/leads?status=Active"
                className="p-3 rounded-lg bg-crm-surface border border-emerald-200 hover:border-crm-primary transition-all group"
              >
                <div className="text-[10px] font-semibold text-emerald-800 uppercase tracking-wider">Active Leads</div>
                <div className="text-xl font-bold text-emerald-700 mt-1">
                  {managerMetrics?.activeLeads ?? activeLeadsCount}
                </div>
                <div className="text-[10px] text-emerald-800 mt-0.5">Qualified Buyers</div>
              </Link>

              {/* Unassigned Leads */}
              <Link
                href="/leads?telecaller=Unassigned"
                className={`p-3 rounded-lg border transition-all ${
                  (managerMetrics?.unassignedLeads ?? 0) > 0
                    ? "bg-amber-50/50 border-amber-300 ring-1 ring-amber-300"
                    : "bg-crm-surface border-crm-border hover:border-crm-primary"
                }`}
              >
                <div className="text-[10px] font-semibold text-amber-900 uppercase tracking-wider">Unassigned</div>
                <div className="text-xl font-bold text-amber-800 mt-1">
                  {managerMetrics?.unassignedLeads ?? 0}
                </div>
                <div className="text-[10px] text-amber-800 mt-0.5">Needs Allocation</div>
              </Link>

              {/* Calls Today (Brokerage) */}
              <div className="p-3 rounded-lg bg-crm-surface border border-crm-border">
                <div className="text-[10px] font-semibold text-crm-muted uppercase tracking-wider">Team Calls</div>
                <div className="text-xl font-bold text-crm-text mt-1">
                  {managerMetrics?.callsLoggedToday ?? 0}
                </div>
                <div className="text-[10px] text-crm-muted mt-0.5">Total Today</div>
              </div>

              {/* Connected Today (Brokerage) */}
              <div className="p-3 rounded-lg bg-crm-surface border border-emerald-100 bg-emerald-50/20">
                <div className="text-[10px] font-semibold text-emerald-800 uppercase tracking-wider">Connected</div>
                <div className="text-xl font-bold text-emerald-700 mt-1">
                  {managerMetrics?.connectedToday ?? 0}
                </div>
                <div className="text-[10px] text-emerald-800 mt-0.5">Conversations</div>
              </div>

              {/* Callbacks Due Today */}
              <Link
                href="/leads?callback=HasCallback"
                className="p-3 rounded-lg bg-crm-surface border border-crm-border hover:border-crm-primary transition-all"
              >
                <div className="text-[10px] font-semibold text-amber-900 uppercase tracking-wider">Due Today</div>
                <div className="text-xl font-bold text-amber-800 mt-1">
                  {managerMetrics?.callbacksDueToday ?? 0}
                </div>
                <div className="text-[10px] text-amber-800 mt-0.5">Callbacks Due</div>
              </Link>

              {/* Overdue Callbacks */}
              <Link
                href="/leads?callback=HasCallback"
                className={`p-3 rounded-lg border transition-all ${
                  (managerMetrics?.callbacksOverdue ?? 0) > 0
                    ? "bg-rose-50 border-rose-300 ring-1 ring-rose-400"
                    : "bg-crm-surface border-crm-border hover:border-crm-primary"
                }`}
              >
                <div className="text-[10px] font-semibold text-rose-800 uppercase tracking-wider">Overdue</div>
                <div className="text-xl font-bold text-rose-700 mt-1">
                  {managerMetrics?.callbacksOverdue ?? 0}
                </div>
                <div className="text-[10px] text-rose-800 mt-0.5">Past Timeframe</div>
              </Link>
            </div>

            {/* Telecaller Workload Breakdown (PRD §5.6 Team Execution) */}
            {managerMetrics && managerMetrics.telecallerWorkloads.length > 0 && (
              <div className="rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
                <div className="px-5 py-3.5 border-b border-crm-border flex items-center justify-between bg-stone-50/50">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-crm-text">Telecaller Workload &amp; Execution Distribution</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800">
                      {managerMetrics.telecallerWorkloads.length} Active Callers
                    </span>
                  </div>
                  <Link href="/leads" className="text-xs font-semibold text-crm-primary hover:underline">
                    Manage Assignments →
                  </Link>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-stone-50/50 border-b border-crm-border text-crm-muted uppercase tracking-wider font-semibold text-[10px]">
                      <tr>
                        <th className="px-4 py-2.5">Telecaller</th>
                        <th className="px-3 py-2.5">Pending Validation</th>
                        <th className="px-3 py-2.5">Active Leads</th>
                        <th className="px-3 py-2.5">Callbacks Due Today</th>
                        <th className="px-4 py-2.5 text-right">Quick Filter</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-crm-border">
                      {managerMetrics.telecallerWorkloads.map((tw) => (
                        <tr key={tw.telecallerId} className="hover:bg-stone-50/50 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="font-bold text-crm-text">{tw.telecallerName}</div>
                            <div className="text-[11px] text-crm-muted">{tw.telecallerEmail}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="font-bold text-amber-700">{tw.pendingValidationCount}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="font-bold text-emerald-700">{tw.activeLeadCount}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={tw.callbacksDueTodayCount > 0 ? "font-bold text-amber-800" : "text-crm-muted"}>
                              {tw.callbacksDueTodayCount}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <Link
                              href={`/leads?telecaller=${encodeURIComponent(tw.telecallerName)}`}
                              className="text-xs font-semibold text-crm-primary hover:underline"
                            >
                              View Leads →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Operational Queues: Supply Validation & Site Visits */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Column 1 & 2: Supply Validation Queue */}
              <div className="lg:col-span-2 space-y-6">
                <div className="rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-crm-border flex items-center justify-between bg-stone-50/50">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-crm-text">
                        Supply Validation Queue (Owner Calling)
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                        {pendingSupplyCount} Properties
                      </span>
                    </div>
                    <Link href="/supply" className="text-xs font-semibold text-crm-primary hover:underline">
                      View All Supply →
                    </Link>
                  </div>

                  {pendingSupply.length === 0 ? (
                    <div className="p-8 text-center text-crm-muted space-y-1">
                      <p className="font-semibold text-crm-text text-sm">No properties requiring validation</p>
                      <p className="text-xs text-crm-muted">
                        New supply records pending owner confirmation will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-crm-border">
                      {pendingSupply.slice(0, 5).map((prop) => (
                        <div
                          key={prop.id}
                          className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/50 transition-colors"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-crm-text">{prop.societyName}</span>
                              <span className="text-xs text-crm-muted">•</span>
                              <span className="text-xs text-crm-muted">
                                {prop.bedroomCount} BHK {prop.propertyType}
                              </span>
                              <StatusBadge status={prop.preference} />
                            </div>
                            <div className="text-xs text-crm-muted flex items-center gap-3">
                              <span>Locality: {prop.locality}, {prop.city}</span>
                              <span>Price: <strong className="text-crm-text">{prop.priceFormatted}</strong></span>
                            </div>
                            <div className="text-xs text-amber-800 flex items-center gap-1.5 pt-0.5">
                              <span className="font-medium">Owner: {prop.ownerName}</span>
                              <span>•</span>
                              <span>Disp: <StatusBadge status={prop.currentDisposition} /></span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleSimulateCall(prop.ownerName)}
                              className="px-3 py-1.5 text-xs font-medium rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-100 shadow-2xs flex items-center gap-1 cursor-pointer"
                            >
                              <span>📞</span> Call Owner
                            </button>
                            <Link
                              href="/supply"
                              className="px-3 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                            >
                              Open Details
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Column 3: Site Visits & Alerts */}
              <div className="space-y-6">
                <div className="rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-crm-border flex items-center justify-between bg-stone-50/50">
                    <h3 className="text-sm font-bold text-crm-text">Upcoming Site Visits</h3>
                    <Link href="/visits" className="text-xs font-semibold text-crm-primary hover:underline">
                      View All →
                    </Link>
                  </div>
                  {upcomingVisits.length === 0 ? (
                    <div className="p-6 text-center text-xs text-crm-muted">
                      No upcoming site visits scheduled.
                    </div>
                  ) : (
                    <div className="divide-y divide-crm-border">
                      {upcomingVisits.slice(0, 4).map((v) => (
                        <div key={v.id} className="p-3.5 hover:bg-stone-50/50 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-crm-text">{v.buyerName}</span>
                            <StatusBadge status={v.status} />
                          </div>
                          <div className="text-[11px] text-crm-muted">
                            Date: {v.scheduledDate} ({v.timeSlot}) • Agent: {v.assignedSalesAgent}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Rental 10-Mo Revalidation Alert */}
                {rentalRenewalCount > 0 && (
                  <div className="p-4 rounded-lg bg-amber-50/60 border border-amber-200">
                    <div className="text-[11px] font-semibold text-amber-900 uppercase tracking-wider">
                      Rental 10-Month Alert
                    </div>
                    <div className="text-xl font-bold text-amber-900 mt-1">{rentalRenewalCount}</div>
                    <div className="text-xs text-amber-800 mt-0.5">
                      Properties due for rental agreement revalidation.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Global Toast */}
        {toastMessage && (
          <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
        )}
      </div>
    </AppShell>
  );
}