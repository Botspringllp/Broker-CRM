"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Toast } from "@/components/ui/Toast";
import {
  INITIAL_PROPERTIES,
  INITIAL_LEADS,
  INITIAL_SITE_VISITS,
} from "@/lib/demo-data";

export default function OverviewPage() {
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Derived counts
  const pendingSupplyCount = INITIAL_PROPERTIES.filter(
    (p) => p.validationStatus === "Not Validated" || p.validationStatus === "In Validation"
  ).length;

  const activeSupplyCount = INITIAL_PROPERTIES.filter(
    (p) => p.isActiveSupply && p.availabilityStatus === "Available"
  ).length;

  const pendingLeadsCount = INITIAL_LEADS.filter(
    (p) => p.status === "Not Yet Validated"
  ).length;

  const activeLeadsCount = INITIAL_LEADS.filter(
    (p) => p.status === "Active"
  ).length;

  const upcomingVisitsCount = INITIAL_SITE_VISITS.filter(
    (v) => v.status === "Confirmed" || v.status === "Tentative - Awaiting Owner"
  ).length;

  const rentalRenewalCount = INITIAL_PROPERTIES.filter(
    (p) => p.revalidationStatus === "Due"
  ).length;

  const handleSimulateCall = (name: string) => {
    setToastMessage(`Initiated simulated call to ${name}. Open full detail page to log notes.`);
  };

  return (
    <AppShell>
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
              Pooja Sharma (Telecaller)
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
              DLF The Crest (Due)
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
                    2 Properties
                  </span>
                </div>
                <Link
                  href="/supply"
                  className="text-xs font-semibold text-crm-primary hover:text-crm-primary-hover hover:underline"
                >
                  View All Supply →
                </Link>
              </div>

              <div className="divide-y divide-crm-border">
                {INITIAL_PROPERTIES.filter(
                  (p) => p.validationStatus === "In Validation" || p.validationStatus === "Not Validated"
                ).map((prop) => (
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
            </div>

            {/* Queue 2: Demand Validation Queue */}
            <div className="rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-crm-border flex items-center justify-between bg-stone-50/50">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-crm-text">
                    Demand Validation Queue (Buyer Enquiries)
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                    2 Leads
                  </span>
                </div>
                <Link
                  href="/leads"
                  className="text-xs font-semibold text-crm-primary hover:text-crm-primary-hover hover:underline"
                >
                  View All Leads →
                </Link>
              </div>

              <div className="divide-y divide-crm-border">
                {INITIAL_LEADS.filter((l) => l.status === "Not Yet Validated").map((lead) => (
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
              <div className="p-4 space-y-3.5">
                {INITIAL_SITE_VISITS.filter((v) => v.status !== "Completed").map((v) => (
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
            </div>

            {/* Recent Operational Activity Stream */}
            <div className="rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-crm-border bg-stone-50/50">
                <h3 className="text-sm font-bold text-crm-text">Operational Audit Stream</h3>
              </div>
              <div className="p-4 space-y-3 text-xs">
                <div className="flex items-start gap-2.5 pb-2.5 border-b border-crm-border/60">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0"></span>
                  <div>
                    <p className="text-crm-text font-medium leading-snug">
                      Pooja Sharma confirmed site visit outcome for DLF The Crest.
                    </p>
                    <span className="text-[10px] text-crm-muted">Yesterday at 06:45 PM</span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 pb-2.5 border-b border-crm-border/60">
                  <span className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 shrink-0"></span>
                  <div>
                    <p className="text-crm-text font-medium leading-snug">
                      Automated 10-month rental check flagged DLF Crest for revalidation.
                    </p>
                    <span className="text-[10px] text-crm-muted">2 days ago • System Cron</span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 pb-2.5 border-b border-crm-border/60">
                  <span className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0"></span>
                  <div>
                    <p className="text-crm-text font-medium leading-snug">
                      Lead enquiry synced from 99acres for Amit Singhania (Camellias ad).
                    </p>
                    <span className="text-[10px] text-crm-muted">3 days ago • Portal Sync</span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-purple-500 mt-1.5 shrink-0"></span>
                  <div>
                    <p className="text-crm-text font-medium leading-snug">
                      Owner Harishankar Singhania confirmed willing mandate for DLF Camellias.
                    </p>
                    <span className="text-[10px] text-crm-muted">4 days ago • Call Validation</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </AppShell>
  );
}
