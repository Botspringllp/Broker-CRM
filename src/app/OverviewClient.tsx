"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Toast } from "@/components/ui/Toast";
import { Property, Lead, SiteVisit } from "@/types/crm";
import { useSession } from "@/lib/auth-client";

interface OverviewClientProps {
  initialProperties: Property[];
  initialLeads: Lead[];
  initialVisits: SiteVisit[];
  userName: string;
  userRole: string;
  isAuthenticated: boolean;
}

export function OverviewClient({
  initialProperties,
  initialLeads,
  initialVisits,
  userName: serverUserName,
  userRole: serverUserRole,
  isAuthenticated: serverIsAuthenticated,
}: OverviewClientProps) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const { data: session } = useSession();

  const currentUserName = session?.user?.name || serverUserName;
  const currentUserRole =
    (session?.user as { role?: string })?.role?.replace("_", " ") || serverUserRole;
  const isAuth = !!session?.user || serverIsAuthenticated;

  // Derived counts from real data
  const pendingSupply = initialProperties.filter(
    (p) => p.validationStatus === "Not Validated" || p.validationStatus === "In Validation"
  );
  const pendingSupplyCount = pendingSupply.length;

  const activeSupplyCount = initialProperties.filter(
    (p) => p.isActiveSupply && p.availabilityStatus === "Available"
  ).length;

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
  const upcomingVisitsCount = upcomingVisits.length;

  const rentalRenewalCount = initialProperties.filter(
    (p) => p.revalidationStatus === "Due"
  ).length;

  const handleSimulateCall = (name: string) => {
    setToastMessage(`Initiated simulated call to ${name}. Open full detail page to log notes.`);
  };

  return (
    <AppShell
      userName={serverUserName}
      userRole={serverUserRole}
      isAuthenticated={serverIsAuthenticated}
    >
      <div className="space-y-6">
        {/* Header / Intro */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-crm-border">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-crm-text">
              Operational CRM Overview
            </h2>
            <p className="text-xs text-crm-muted mt-1">
              Brokerage activity stream, calling queues, and active supply/demand tracking for today.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-crm-muted">Viewing as:</span>
            <span className="px-2.5 py-1 text-xs font-semibold rounded bg-crm-surface border border-crm-border text-crm-text shadow-2xs">
              {isAuth ? `${currentUserName} (${currentUserRole})` : "Guest (Not signed in)"}
            </span>
          </div>
        </div>

        {/* 6 Key Operational Metrics Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Card 1: Supply Awaiting Validation */}
          <Link
            href="/supply"
            className="p-4 rounded-lg bg-crm-surface border border-crm-border hover:border-crm-primary hover:shadow-xs transition-all group"
          >
            <div className="text-[11px] font-semibold text-crm-muted uppercase tracking-wider">
              Supply In Validation
            </div>
            <div className="text-2xl font-bold text-crm-text mt-1.5 group-hover:text-crm-primary">
              {pendingSupplyCount}
            </div>
            <div className="text-[11px] text-amber-700 font-medium mt-1 flex items-center gap-1">
              <span>● Requires calling</span>
            </div>
          </Link>

          {/* Card 2: Active & Available Properties */}
          <Link
            href="/supply/active"
            className="p-4 rounded-lg bg-crm-surface border border-crm-border hover:border-crm-primary hover:shadow-xs transition-all group"
          >
            <div className="text-[11px] font-semibold text-crm-muted uppercase tracking-wider">
              Active Supply Pool
            </div>
            <div className="text-2xl font-bold text-crm-text mt-1.5 group-hover:text-crm-primary">
              {activeSupplyCount}
            </div>
            <div className="text-[11px] text-emerald-700 font-medium mt-1 flex items-center gap-1">
              <span>● Ready for matching</span>
            </div>
          </Link>

          {/* Card 3: Leads Awaiting Validation */}
          <Link
            href="/leads"
            className="p-4 rounded-lg bg-crm-surface border border-crm-border hover:border-crm-primary hover:shadow-xs transition-all group"
          >
            <div className="text-[11px] font-semibold text-crm-muted uppercase tracking-wider">
              Demand In Validation
            </div>
            <div className="text-2xl font-bold text-crm-text mt-1.5 group-hover:text-crm-primary">
              {pendingLeadsCount}
            </div>
            <div className="text-[11px] text-amber-700 font-medium mt-1 flex items-center gap-1">
              <span>● Inquiries to qualify</span>
            </div>
          </Link>

          {/* Card 4: Active Leads */}
          <Link
            href="/leads"
            className="p-4 rounded-lg bg-crm-surface border border-crm-border hover:border-crm-primary hover:shadow-xs transition-all group"
          >
            <div className="text-[11px] font-semibold text-crm-muted uppercase tracking-wider">
              Active Buyers / Tenants
            </div>
            <div className="text-2xl font-bold text-crm-text mt-1.5 group-hover:text-crm-primary">
              {activeLeadsCount}
            </div>
            <div className="text-[11px] text-emerald-700 font-medium mt-1 flex items-center gap-1">
              <span>● Verified search</span>
            </div>
          </Link>

          {/* Card 5: Upcoming Site Visits */}
          <Link
            href="/visits"
            className="p-4 rounded-lg bg-crm-surface border border-crm-border hover:border-crm-primary hover:shadow-xs transition-all group"
          >
            <div className="text-[11px] font-semibold text-crm-muted uppercase tracking-wider">
              Upcoming Site Visits
            </div>
            <div className="text-2xl font-bold text-crm-text mt-1.5 group-hover:text-crm-primary">
              {upcomingVisitsCount}
            </div>
            <div className="text-[11px] text-blue-700 font-medium mt-1 flex items-center gap-1">
              <span>● Assigned to sales</span>
            </div>
          </Link>

          {/* Card 6: Rental 10-Month Revalidation */}
          <div className="p-4 rounded-lg bg-amber-50/50 border border-amber-200">
            <div className="text-[11px] font-semibold text-amber-900 uppercase tracking-wider">
              Rental 10-Mo Alert
            </div>
            <div className="text-2xl font-bold text-amber-900 mt-1.5">
              {rentalRenewalCount}
            </div>
            <div className="text-[11px] text-amber-800 font-medium mt-1">
              {rentalRenewalCount === 0 ? "0 properties due" : `${rentalRenewalCount} properties due`}
            </div>
          </div>
        </div>

        {/* Operational Section: Queues & Activity Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1 & 2: Urgent Calling Queues */}
          <div className="lg:col-span-2 space-y-6">
            {/* Queue 1: Supply Validation Queue */}
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
                <Link
                  href="/supply"
                  className="text-xs font-semibold text-crm-primary hover:text-crm-primary-hover hover:underline"
                >
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
                  {pendingSupply.map((prop) => (
                    <div
                      key={prop.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/50 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-crm-text">
                            {prop.societyName}
                          </span>
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
                          className="px-3 py-1.5 text-xs font-medium rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-100 shadow-2xs flex items-center gap-1"
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

            {/* Queue 2: Demand Validation Queue */}
            <div className="rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-crm-border flex items-center justify-between bg-stone-50/50">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-crm-text">
                    Demand Validation Queue (Buyer Enquiries)
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                    {pendingLeadsCount} Leads
                  </span>
                </div>
                <Link
                  href="/leads"
                  className="text-xs font-semibold text-crm-primary hover:text-crm-primary-hover hover:underline"
                >
                  View All Leads →
                </Link>
              </div>

              {pendingLeads.length === 0 ? (
                <div className="p-8 text-center text-crm-muted space-y-1">
                  <p className="font-semibold text-crm-text text-sm">No leads requiring validation</p>
                  <p className="text-xs text-crm-muted">
                    Incoming buyer and tenant enquiries awaiting qualification will appear here.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-crm-border">
                  {pendingLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/50 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-crm-text">
                            {lead.name}
                          </span>
                          <span className="text-[11px] text-crm-muted">
                            ({lead.primaryPhone})
                          </span>
                          <StatusBadge status={lead.status} />
                        </div>
                        <div className="text-xs text-crm-muted flex items-center gap-3">
                          <span>Source: <strong className="text-crm-text">{lead.originalSource}</strong></span>
                          <span>Budget: <strong className="text-crm-text">{lead.requirements.budgetFormatted}</strong></span>
                          <span>{lead.requirements.preference}</span>
                        </div>
                        <div className="text-xs text-crm-muted pt-0.5">
                          Current Disposition: <StatusBadge status={lead.currentDisposition} />
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleSimulateCall(lead.name)}
                          className="px-3 py-1.5 text-xs font-medium rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-100 shadow-2xs flex items-center gap-1"
                        >
                          <span>📞</span> Call Buyer
                        </button>
                        <Link
                          href="/leads"
                          className="px-3 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                        >
                          Validate Lead
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Column 3: Site Visits & Activity Stream */}
          <div className="space-y-6">
            {/* Confirmed Upcoming Visits Widget */}
            <div className="rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-crm-border flex items-center justify-between bg-stone-50/50">
                <h3 className="text-sm font-bold text-crm-text">Upcoming Site Visits</h3>
                <Link
                  href="/visits"
                  className="text-xs font-semibold text-crm-primary hover:underline"
                >
                  Visits →
                </Link>
              </div>

              {upcomingVisits.length === 0 ? (
                <div className="p-6 text-center text-crm-muted space-y-1">
                  <p className="font-semibold text-crm-text text-sm">No upcoming site visits</p>
                  <p className="text-xs text-crm-muted">
                    Site visits coordinated between buyers and sales agents will appear here.
                  </p>
                </div>
              ) : (
                <div className="p-4 space-y-3.5">
                  {upcomingVisits.map((v) => (
                    <div
                      key={v.id}
                      className="p-3 rounded-md border border-crm-border bg-stone-50/40 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-crm-text">{v.buyerName}</span>
                        <StatusBadge status={v.status} />
                      </div>
                      <div className="text-crm-muted flex items-center justify-between">
                        <span>{v.scheduledDate}</span>
                        <span className="font-medium text-crm-text">{v.timeSlot}</span>
                      </div>
                      <div className="text-crm-muted text-[11px] pt-1 border-t border-crm-border/60 flex items-center justify-between">
                        <span>Sales Agent: <strong className="text-crm-text">{v.assignedSalesAgent}</strong></span>
                        <span>{v.items.length} Properties</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Operational Activity Stream */}
            <div className="rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-crm-border bg-stone-50/50">
                <h3 className="text-sm font-bold text-crm-text">Operational Audit Stream</h3>
              </div>
              <div className="p-6 text-center text-crm-muted space-y-1">
                <p className="font-semibold text-crm-text text-sm">No operational activity recorded yet</p>
                <p className="text-xs text-crm-muted">
                  Logged calls, status changes, and site visit outcomes will appear in this audit feed.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </AppShell>
  );
}

