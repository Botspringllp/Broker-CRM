"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Toast } from "@/components/ui/Toast";
import { Lead } from "@/types/crm";
import { updateLeadStatusAction } from "../actions";

interface LeadDetailsClientProps {
  lead: Lead;
  canEdit: boolean;
  canLogCall: boolean;
  canActivate: boolean;
  userRole: string;
}

export function LeadDetailsClient({
  lead: initialLead,
  canEdit,
  canLogCall,
  canActivate,
}: LeadDetailsClientProps) {
  const [lead, setLead] = useState<Lead>(initialLead);
  const [isActivating, setIsActivating] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleActivate = async () => {
    if (isActivating) return;
    setIsActivating(true);

    try {
      const res = await updateLeadStatusAction({
        leadId: lead.id,
        status: "ACTIVE",
      });

      if (!res.success) {
        setToastMessage(`Failed to activate lead: ${res.error}`);
        return;
      }

      setLead(res.lead);
      setToastMessage(`Lead ${res.lead.name} marked ACTIVE (Requirements Confirmed).`);
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Failed to activate lead.");
    } finally {
      setIsActivating(false);
    }
  };

  const hasScheduledCallback = lead.callHistory.some((c) => !!c.callbackDate);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto space-y-6 pb-12">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between border-b border-crm-border pb-4">
          <div className="flex items-center gap-2">
            <Link
              href="/leads"
              className="text-xs font-semibold text-crm-link hover:underline flex items-center gap-1"
            >
              <span>←</span> Back to Leads Queue
            </Link>
            <span className="text-crm-muted text-xs">/</span>
            <span className="text-xs font-medium text-crm-text">{lead.name}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-crm-muted">
              Source: <strong className="text-crm-text">{lead.originalSource}</strong> ({lead.sourceCreatedAt})
            </span>
          </div>
        </div>

        {/* Hero Header */}
        <div className="bg-crm-surface border border-crm-border rounded-lg p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-teal-50 border border-teal-200 text-crm-primary flex items-center justify-center font-bold text-lg shadow-2xs">
              {lead.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight text-crm-text">
                  {lead.name}
                </h1>
                <StatusBadge status={lead.status} />
                <StatusBadge status={lead.requirements.preference} />
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 text-crm-muted border border-crm-border">
                  {lead.requirements.city}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-crm-muted mt-1 flex-wrap">
                <span>
                  Primary: <strong className="text-crm-text">+91 {lead.primaryPhone}</strong>
                </span>
                {lead.email && (
                  <span>
                    • Email: <span className="text-crm-text">{lead.email}</span>
                  </span>
                )}
                <span>
                  • Assigned Telecaller: <strong className="text-crm-text">{lead.assignedTelecaller}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {canEdit && (
              <Link
                href={`/leads/${lead.id}/edit`}
                className="px-3.5 py-1.5 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 transition-all flex items-center gap-1 shadow-2xs"
              >
                <span>✏️</span> Edit Lead
              </Link>
            )}

            {canLogCall && (
              <Link
                href={`/leads/${lead.id}/qualify`}
                className="px-4 py-1.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover transition-all flex items-center gap-1.5 shadow-2xs"
              >
                <span>📞</span> Qualify / Log Call
              </Link>
            )}

            {canActivate && lead.status !== "Active" && (
              <button
                type="button"
                onClick={handleActivate}
                disabled={isActivating}
                className="px-4 py-1.5 text-xs font-bold rounded bg-crm-success text-white hover:bg-emerald-700 transition-all shadow-2xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isActivating ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Activating...
                  </>
                ) : (
                  <>✓ Mark Active (Confirm)</>
                )}
              </button>
            )}
          </div>
        </div>

        {/* 2-Column Responsive Information Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT 2 COLUMNS: Core Specifications & Call History */}
          <div className="lg:col-span-2 space-y-6">
            {/* Card: Property Search Requirements */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-5 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                  Property Search Requirements & Budget
                </h2>
                <span className="text-[11px] font-semibold text-crm-primary">
                  {lead.requirements.budgetFormatted}
                </span>
              </div>

              <div className="p-5 space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <span className="text-crm-muted block text-[11px]">Budget Range (INR)</span>
                    <strong className="text-sm text-crm-text">
                      {lead.requirements.budgetFormatted}
                    </strong>
                  </div>

                  <div>
                    <span className="text-crm-muted block text-[11px]">Transaction Type</span>
                    <div className="mt-0.5">
                      <StatusBadge status={lead.requirements.preference} />
                    </div>
                  </div>

                  <div>
                    <span className="text-crm-muted block text-[11px]">Target City</span>
                    <strong className="text-crm-text">{lead.requirements.city}</strong>
                  </div>

                  <div>
                    <span className="text-crm-muted block text-[11px]">Bedroom Configurations</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {lead.requirements.bedroomConfigurations.length > 0 ? (
                        lead.requirements.bedroomConfigurations.map((bhk, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded bg-stone-100 text-crm-text font-semibold text-[11px] border border-crm-border"
                          >
                            {bhk}
                          </span>
                        ))
                      ) : (
                        <span className="text-crm-muted italic">Any BHK</span>
                      )}
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <span className="text-crm-muted block text-[11px]">Acceptable Property Types</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {lead.requirements.propertyTypes.length > 0 ? (
                        lead.requirements.propertyTypes.map((pt, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded bg-teal-50 text-crm-primary font-medium text-[11px] border border-teal-200"
                          >
                            {pt.replace(/_/g, " ")}
                          </span>
                        ))
                      ) : (
                        <span className="text-crm-muted italic">Any Residential Property</span>
                      )}
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <span className="text-crm-muted block text-[11px]">Target Localities</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {lead.requirements.localities.length > 0 ? (
                        lead.requirements.localities.map((loc, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded bg-stone-100 text-crm-text font-medium text-[11px] border border-crm-border"
                          >
                            {loc}
                          </span>
                        ))
                      ) : (
                        <span className="text-crm-muted italic">No specific localities restricted</span>
                      )}
                    </div>
                  </div>

                  {lead.requirements.targetArea && (
                    <div>
                      <span className="text-crm-muted block text-[11px]">Target Area</span>
                      <strong className="text-crm-text">{lead.requirements.targetArea} sq.ft</strong>
                    </div>
                  )}

                  <div>
                    <span className="text-crm-muted block text-[11px]">Requirement Confirmed</span>
                    <span
                      className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold ${
                        lead.requirements.isConfirmed
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {lead.requirements.isConfirmed ? "Confirmed by Telecaller" : "Pending Confirmation"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card: Persistent Call History Timeline */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-5 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                    Calling History & Qualification Log
                  </h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-stone-200 text-crm-text">
                    {lead.callHistory.length} Calls
                  </span>
                </div>
                {canLogCall && (
                  <Link
                    href={`/leads/${lead.id}/qualify`}
                    className="text-xs font-bold text-crm-primary hover:underline flex items-center gap-1"
                  >
                    <span>+</span> Log New Call
                  </Link>
                )}
              </div>

              <div className="p-5">
                {lead.callHistory.length === 0 ? (
                  <div className="p-8 text-center text-crm-muted space-y-2 border border-dashed border-crm-border rounded-lg bg-stone-50/50">
                    <p className="font-semibold text-crm-text text-sm">No Calls Logged Yet</p>
                    <p className="text-xs">
                      This prospect has not been called yet. Open the Qualification Workspace to initiate outreach.
                    </p>
                    {canLogCall && (
                      <Link
                        href={`/leads/${lead.id}/qualify`}
                        className="inline-block mt-2 px-4 py-1.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                      >
                        📞 Initiate Qualification Call
                      </Link>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {lead.callHistory.map((call) => (
                      <div
                        key={call.id}
                        className="p-3.5 rounded-lg border border-crm-border bg-stone-50/40 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={call.disposition} />
                            <span className="text-crm-muted text-[11px]">
                              Logged by <strong className="text-crm-text">{call.callerName}</strong>
                            </span>
                          </div>
                          <span className="text-[11px] text-crm-muted font-medium">
                            {call.calledAt}
                          </span>
                        </div>

                        {call.notes && (
                          <p className="text-crm-text bg-white p-2.5 rounded border border-crm-border leading-relaxed text-[11px]">
                            {call.notes}
                          </p>
                        )}

                        {call.callbackDate && (
                          <div className="p-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-semibold flex items-center gap-1.5">
                            <span>⏰ Scheduled Callback:</span>
                            <span>{call.callbackDate}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Contact Details, Disposition Overview & Matches */}
          <div className="space-y-6">
            {/* Card: Prospect Profile */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-5 py-3 bg-stone-50 border-b border-crm-border">
                <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                  Contact & Attribution
                </h2>
              </div>

              <div className="p-5 space-y-3 text-xs">
                <div>
                  <span className="text-crm-muted block text-[10px] uppercase font-bold">Prospect Name</span>
                  <strong className="text-crm-text text-sm">{lead.name}</strong>
                </div>

                <div>
                  <span className="text-crm-muted block text-[10px] uppercase font-bold">Primary Phone</span>
                  <a
                    href={`tel:${lead.primaryPhone}`}
                    className="text-crm-primary font-bold hover:underline"
                  >
                    +91 {lead.primaryPhone}
                  </a>
                </div>

                {lead.alternatePhone && (
                  <div>
                    <span className="text-crm-muted block text-[10px] uppercase font-bold">Alternate Phone</span>
                    <span className="text-crm-text">{lead.alternatePhone}</span>
                  </div>
                )}

                {lead.email && (
                  <div>
                    <span className="text-crm-muted block text-[10px] uppercase font-bold">Email Address</span>
                    <a
                      href={`mailto:${lead.email}`}
                      className="text-crm-link hover:underline truncate block"
                    >
                      {lead.email}
                    </a>
                  </div>
                )}

                <div className="pt-2 border-t border-crm-border">
                  <span className="text-crm-muted block text-[10px] uppercase font-bold">Assigned Telecaller</span>
                  <span className="font-semibold text-crm-text">{lead.assignedTelecaller}</span>
                </div>

                <div>
                  <span className="text-crm-muted block text-[10px] uppercase font-bold">Inquiry Source</span>
                  <span className="font-medium text-crm-text">{lead.originalSource}</span>
                  <span className="text-[10px] text-crm-muted block">
                    Created on {lead.sourceCreatedAt}
                  </span>
                </div>
              </div>
            </div>

            {/* Card: Outreach & Disposition Status */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-5 py-3 bg-stone-50 border-b border-crm-border">
                <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                  Qualification Metrics (PRD §5)
                </h2>
              </div>

              <div className="p-5 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-crm-muted">Current Disposition:</span>
                  <StatusBadge status={lead.currentDisposition} />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-crm-muted">Unsuccessful Attempts:</span>
                  <span className={`font-bold ${lead.unreachableCount >= 3 ? "text-red-700" : "text-crm-text"}`}>
                    {lead.unreachableCount} / 3 Max
                  </span>
                </div>

                {lead.unreachableCount >= 3 && (
                  <div className="p-2.5 rounded bg-red-50 border border-red-200 text-red-800 text-[11px] font-medium">
                    ⚠️ Maximum unreachable attempts (3) reached. Lead automatically moved to Inactive pool.
                  </div>
                )}

                {hasScheduledCallback && (
                  <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-medium flex items-center gap-1.5">
                    <span>⏰ Callback pending in calling queue.</span>
                  </div>
                )}

                <div className="pt-2 border-t border-crm-border">
                  <Link
                    href={`/leads/${lead.id}/qualify`}
                    className="w-full py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs text-center flex items-center justify-center gap-1.5"
                  >
                    <span>📞</span> Open Qualification Workspace
                  </Link>
                </div>
              </div>
            </div>

            {/* Advertised Enquiry Reference (PRD §5.1) */}
            {lead.advertisedPropertyRef && (
              <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs p-5 space-y-2 text-xs">
                <span className="text-xs font-bold text-crm-text uppercase tracking-wider block">
                  Original Portal Ad Inquiry
                </span>
                <p className="text-crm-muted text-[11px]">
                  Reference: <strong className="text-crm-text">{lead.advertisedPropertyRef}</strong>
                </p>
                <div className="p-2 rounded bg-stone-50 border border-crm-border text-[11px] text-crm-muted">
                  Verify whether prospect called about this specific unit or a general requirement.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </AppShell>
  );
}

