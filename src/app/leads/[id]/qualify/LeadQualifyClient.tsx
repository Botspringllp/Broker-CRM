"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Toast } from "@/components/ui/Toast";
import { Lead } from "@/types/crm";
import {
  logLeadCallAction,
  updateLeadStatusAction,
  markLeadDoNotContactAction,
} from "../../actions";
import { formatIndianCurrency } from "@/server/dal/mappers";

interface LeadQualifyClientProps {
  lead: Lead;
  currentUserRole?: string;
  currentUserName?: string;
  canActivate?: boolean;
}

type LeadDispositionValue =
  | "CONNECTED"
  | "CALL_BACK"
  | "RINGING_OR_NOT_ANSWERING"
  | "BUYER_SAYS_NOT_LOOKING";

const DISPOSITION_OPTIONS: {
  value: LeadDispositionValue;
  label: string;
  description: string;
  badgeColor: string;
}[] = [
  {
    value: "CONNECTED",
    label: "Connected & Qualified",
    description: "Spoke with prospect. Verified requirements, timeline, and purchase/rent intention.",
    badgeColor: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  {
    value: "CALL_BACK",
    label: "Call Back Requested",
    description: "Buyer requested a follow-up call at a specified future date and time.",
    badgeColor: "bg-blue-50 text-blue-800 border-blue-200",
  },
  {
    value: "RINGING_OR_NOT_ANSWERING",
    label: "Ringing / Not Answering",
    description: "No answer, busy line, or unreachable. Increments attempt counter (max 3).",
    badgeColor: "bg-orange-50 text-orange-800 border-orange-200",
  },
  {
    value: "BUYER_SAYS_NOT_LOOKING",
    label: "Buyer Not Looking / Dropped",
    description: "Prospect is no longer in the market or dropped requirement. Moves lead to Inactive.",
    badgeColor: "bg-rose-50 text-rose-800 border-rose-200",
  },
];

export function LeadQualifyClient({
  lead: initialLead,
  canActivate = false,
}: LeadQualifyClientProps) {
  const [lead, setLead] = useState<Lead>(initialLead);

  // Form State
  const [disposition, setDisposition] = useState<LeadDispositionValue>("CONNECTED");
  const [callbackDate, setCallbackDate] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmRequirements, setConfirmRequirements] = useState(false);

  // Advertised Enquiry Verification State
  const initialEnquiryId = lead.enquiries?.[0]?.id || "";
  const [selectedEnquiryId, setSelectedEnquiryId] = useState(initialEnquiryId);
  const [isEnquiryVerified, setIsEnquiryVerified] = useState(
    lead.enquiries?.[0]?.isVerifiedByCaller ?? lead.advertisedPropertyVerified ?? false
  );
  const [enquiryVerificationNotes, setEnquiryVerificationNotes] = useState(
    lead.enquiries?.[0]?.callerVerificationNotes ?? lead.advertisedPropertyNotes ?? ""
  );

  // DNC Modal State
  const [isDncModalOpen, setIsDncModalOpen] = useState(false);
  const [dncReason, setDncReason] = useState("");
  const [isDncSubmitting, setIsDncSubmitting] = useState(false);

  // Status & Feedback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Calculate One Later Follow-up Status (PRD §5.5)
  const notLookingCall = lead.callHistory.find((c) =>
    c.disposition.toUpperCase().includes("NOT LOOKING")
  );

  let isFollowUpExhausted = false;
  let canMakeFollowUp = false;

  if (lead.status === "Inactive") {
    if (notLookingCall) {
      const notLookingDate = new Date(notLookingCall.calledAt).getTime();
      const followUpCallsCount = lead.callHistory.filter((c) => {
        const d = new Date(c.calledAt).getTime();
        return !isNaN(d) && !isNaN(notLookingDate) ? d > notLookingDate : false;
      }).length;

      if (followUpCallsCount >= 1) {
        isFollowUpExhausted = true;
      } else {
        canMakeFollowUp = true;
      }
    } else {
      isFollowUpExhausted = true;
    }
  }

  const isCallingBlocked = lead.isDoNotContact || isFollowUpExhausted;

  const hasUnsavedChanges = Boolean(notes.trim() || callbackDate || confirmRequirements);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleCopyPhone = () => {
    navigator.clipboard.writeText(lead.primaryPhone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  const handleMarkDnc = async () => {
    if (isDncSubmitting || lead.isDoNotContact) return;
    setIsDncSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await markLeadDoNotContactAction(lead.id, dncReason.trim() || undefined);
      if (!res.success) {
        setErrorMessage(res.error);
        return;
      }

      setLead(res.lead);
      setIsDncModalOpen(false);
      setSuccessBanner(
        "Prospect successfully marked as Do Not Contact (DNC). All calling is now permanently disabled."
      );
      setToastMessage("Marked as Do Not Contact.");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to mark prospect as Do Not Contact.");
    } finally {
      setIsDncSubmitting(false);
    }
  };

  const handleLogCall = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessBanner(null);

    if (isCallingBlocked) {
      setErrorMessage(
        lead.isDoNotContact
          ? "Cannot call: this prospect is marked Do Not Contact (DNC)."
          : "Cannot call: the single permitted follow-up call after 'Not Looking' has already been used."
      );
      return;
    }

    if (disposition === "CALL_BACK" && !callbackDate.trim()) {
      setErrorMessage("Please select a mandatory callback date and time when disposition is 'Call Back Requested'.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await logLeadCallAction({
        leadId: lead.id,
        disposition,
        notes: notes.trim() || null,
        callbackScheduledAt: callbackDate.trim() || null,
        enquiryId: selectedEnquiryId ? selectedEnquiryId : undefined,
        isEnquiryVerified: Boolean(isEnquiryVerified),
        enquiryVerificationNotes: enquiryVerificationNotes.trim() || null,
        isRequirementsConfirmed: confirmRequirements,
      });

      if (!res.success) {
        setErrorMessage(res.error);
        setIsSubmitting(false);
        return;
      }

      let updatedLead = res.lead;

      // If user checked confirmRequirements and canActivate, and lead is not active yet (and not inactive follow-up)
      if (confirmRequirements && canActivate && updatedLead.status !== "Active" && lead.status !== "Inactive") {
        const actRes = await updateLeadStatusAction({
          leadId: lead.id,
          status: "ACTIVE",
        });
        if (actRes.success) {
          updatedLead = actRes.lead;
        }
      }

      setLead(updatedLead);
      setSuccessBanner(
        `Call outcome successfully recorded: ${updatedLead.currentDisposition}. Lead status is now ${updatedLead.status}.`
      );
      setToastMessage("Call logged successfully.");

      // Reset form fields
      setNotes("");
      setCallbackDate("");
      setConfirmRequirements(false);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to record call outcome.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickActivate = async () => {
    if (isActivating || lead.status === "Active") return;
    setIsActivating(true);
    setErrorMessage(null);

    try {
      const res = await updateLeadStatusAction({
        leadId: lead.id,
        status: "ACTIVE",
      });

      if (!res.success) {
        setErrorMessage(res.error);
        return;
      }

      setLead(res.lead);
      setToastMessage(`${res.lead.name} marked ACTIVE (Search Confirmed).`);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to activate lead.");
    } finally {
      setIsActivating(false);
    }
  };

  const isRent = lead.requirements.preference === "Rent";

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
              <span>←</span> Back to Leads
            </Link>
            <span className="text-crm-muted text-xs">/</span>
            <Link
              href={`/leads/${lead.id}`}
              className="text-xs font-semibold text-crm-link hover:underline"
            >
              {lead.name}
            </Link>
            <span className="text-crm-muted text-xs">/</span>
            <span className="text-xs font-medium text-crm-text">Qualify / Call Workspace</span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/leads/${lead.id}/edit`}
              className="text-xs font-semibold text-crm-link hover:underline flex items-center gap-1"
            >
              <span>✏️</span> Edit Requirements
            </Link>
          </div>
        </div>

        {/* Lead Call Header Card */}
        <div className="bg-crm-surface border border-crm-border rounded-lg p-5 shadow-2xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
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
                  {lead.isDoNotContact && (
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                      🛑 Do Not Contact
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 text-crm-muted border border-crm-border">
                    {lead.requirements.city}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-crm-muted mt-1">
                  <span>Source: {lead.originalSource} ({lead.sourceCreatedAt})</span>
                  <span>• Assigned: <strong>{lead.assignedTelecaller}</strong></span>
                  {lead.unreachableCount > 0 && (
                    <span>• Unreachable Attempts: <strong className={lead.unreachableCount >= 3 ? "text-rose-700" : "text-crm-text"}>{lead.unreachableCount}</strong></span>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Actions & Dial */}
            <div className="flex items-center gap-2 flex-wrap">
              {!lead.isDoNotContact && (
                <button
                  type="button"
                  onClick={() => setIsDncModalOpen(true)}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg border border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 shadow-2xs flex items-center gap-1 cursor-pointer"
                  title="Mark prospect as Do Not Contact"
                >
                  <span>🛑</span> Mark DNC
                </button>
              )}

              <div className="flex items-center gap-1 bg-stone-50 border border-crm-border px-3 py-1.5 rounded-lg text-xs">
                <span className="text-crm-muted font-medium">Mobile:</span>
                <span className="font-bold text-crm-text text-sm">
                  +91 {lead.primaryPhone}
                </span>
                <button
                  type="button"
                  onClick={handleCopyPhone}
                  className="ml-1 p-1 hover:bg-stone-200 rounded text-crm-muted hover:text-crm-text text-[11px]"
                  title="Copy Phone Number"
                >
                  {copiedPhone ? "✓ Copied" : "📋"}
                </button>
              </div>

              {isCallingBlocked ? (
                <span
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-stone-100 text-stone-400 border border-stone-200 cursor-not-allowed flex items-center gap-1.5"
                  title={lead.isDoNotContact ? "Do Not Contact" : "Follow-up exhausted"}
                >
                  <span>📞</span> Calling Blocked
                </span>
              ) : (
                <a
                  href={`tel:${lead.primaryPhone}`}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs flex items-center gap-1.5"
                >
                  <span>📞</span> Dial Number
                </a>
              )}
            </div>
          </div>
        </div>

        {/* DNC Alert Banner */}
        {lead.isDoNotContact && (
          <div className="p-3.5 rounded-lg bg-rose-100 border border-rose-300 text-rose-900 text-xs font-bold flex items-center gap-2">
            <span>🛑</span>
            <span>DO NOT CONTACT (DNC): This prospect has requested no further contact. Outgoing calling is strictly blocked.</span>
          </div>
        )}

        {/* Follow-up Permitted Banner (PRD §5.5) */}
        {!lead.isDoNotContact && canMakeFollowUp && (
          <div className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center gap-2">
            <span>ℹ️</span>
            <span>
              <strong>One Later Follow-up Permitted:</strong> Lead is currently Inactive (Not Looking). PRD §5.5 allows exactly ONE follow-up call. Logging a call will consume this follow-up without silently reactivating the lead.
            </span>
          </div>
        )}

        {/* Follow-up Exhausted Banner (PRD §5.5) */}
        {!lead.isDoNotContact && isFollowUpExhausted && (
          <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center gap-2">
            <span>⚠️</span>
            <span>
              <strong>Follow-up Limit Reached:</strong> The single permitted follow-up call after &lsquo;Not Looking&rsquo; has already been used. Outgoing calling is blocked. Re-activate the lead to resume calling.
            </span>
          </div>
        )}

        {/* Success Banner */}
        {successBanner && (
          <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>✓</span>
              <span className="font-semibold">{successBanner}</span>
            </div>
            <button
              onClick={() => setSuccessBanner(null)}
              className="text-emerald-700 hover:text-emerald-900 font-bold ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
            <span>⚠️</span>
            <span className="font-medium">{errorMessage}</span>
          </div>
        )}

        {/* Main Workspace Layout: 2 Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT COLUMN: Section A (Lead Summary) & Section C (Qualification Call Form) */}
          <div className="lg:col-span-7 space-y-6">
            {/* SECTION A: Lead Summary Card */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-5 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                  Section A: Prospect Summary & Qualification Metrics
                </h2>
                <span className="text-[11px] font-bold text-crm-primary">
                  {lead.requirements.budgetFormatted}
                </span>
              </div>

              <div className="p-5 space-y-3 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-stone-50/70 rounded-lg border border-crm-border">
                  <div>
                    <span className="text-[10px] text-crm-muted uppercase font-bold block">Budget</span>
                    <strong className="text-crm-text">
                      {formatIndianCurrency(lead.requirements.minBudget, isRent)} - {formatIndianCurrency(lead.requirements.maxBudget, isRent)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-crm-muted uppercase font-bold block">Type & BHK</span>
                    <strong className="text-crm-text">
                      {lead.requirements.bedroomConfigurations.join(", ") || "Any BHK"}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-crm-muted uppercase font-bold block">Current Status</span>
                    <div className="mt-0.5">
                      <StatusBadge status={lead.status} />
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-crm-muted uppercase font-bold block">Attempts</span>
                    <span className={`font-bold ${lead.unreachableCount >= 3 ? "text-red-700" : "text-crm-text"}`}>
                      {lead.unreachableCount} / 3 Max
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-crm-muted text-[11px] block">Localities & Preferred Areas:</span>
                  <div className="flex flex-wrap gap-1">
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
                      <span className="text-crm-muted italic text-[11px]">Any in {lead.requirements.city}</span>
                    )}
                  </div>
                </div>

                {lead.requirements.propertyTypes.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-crm-muted text-[11px] block">Property Types:</span>
                    <span className="font-medium text-crm-text">
                      {lead.requirements.propertyTypes.map((t) => t.replace(/_/g, " ")).join(", ")}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* SECTION C: Qualification Call Form */}
            <form onSubmit={handleLogCall} className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-5 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                  Section C: Log Qualification Call (PRD §5.5)
                </h2>
                <span className="text-[11px] text-crm-muted">Standard PRD Dispositions</span>
              </div>

              <div className="p-5 space-y-5 text-xs">
                {/* Disposition Selection */}
                <div>
                  <label className="block text-xs font-semibold text-crm-text mb-2">
                    Call Outcome / Disposition <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {DISPOSITION_OPTIONS.map((opt) => {
                      const isSelected = disposition === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setDisposition(opt.value)}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            isSelected
                              ? `${opt.badgeColor} ring-2 ring-crm-primary font-bold shadow-xs`
                              : "bg-crm-surface border-crm-border text-crm-text hover:bg-stone-50"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-xs">{opt.label}</span>
                            {isSelected && <span>✓</span>}
                          </div>
                          <p className="text-[10px] opacity-80 leading-snug font-normal">
                            {opt.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Conditional Callback Datetime Picker */}
                {disposition === "CALL_BACK" && (
                  <div className="p-3.5 rounded-lg bg-blue-50/70 border border-blue-200 space-y-1.5">
                    <label className="block text-xs font-bold text-blue-900">
                      Scheduled Callback Date & Time <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={callbackDate}
                      onChange={(e) => setCallbackDate(e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                      className="w-full px-3 py-2 text-xs rounded border border-blue-300 bg-white text-crm-text focus:outline-hidden focus:border-crm-primary font-medium"
                    />
                    <span className="text-[10px] text-blue-800 block">
                      Enforces PRD callback scheduling protocol. The lead will be scheduled for telecaller follow-up.
                    </span>
                  </div>
                )}

                {/* Call Notes */}
                <div>
                  <label className="block text-xs font-semibold text-crm-text mb-1">
                    Call Notes & Prospect Feedback
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Enter discussion notes: purchase timeframe, specific floor preference, financing readiness, property matches shared..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  />
                </div>

                {/* Advertised Enquiry Verification (PRD §5.1) */}
                <div className="p-3.5 rounded-lg bg-stone-50 border border-crm-border space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-crm-text flex items-center gap-1.5">
                      <span>🔎</span> Advertised Enquiry Verification (PRD §5.1)
                    </span>
                    {lead.enquiries && lead.enquiries.length > 0 && (
                      <span className="text-[10px] text-crm-muted">
                        {lead.enquiries.length} {lead.enquiries.length === 1 ? "Enquiry" : "Enquiries"} recorded
                      </span>
                    )}
                  </div>

                  {lead.enquiries && lead.enquiries.length > 1 && (
                    <div>
                      <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                        Select Inquired Ad to Verify
                      </label>
                      <select
                        value={selectedEnquiryId}
                        onChange={(e) => {
                          const eqId = e.target.value;
                          setSelectedEnquiryId(eqId);
                          const found = lead.enquiries?.find((enq) => enq.id === eqId);
                          if (found) {
                            setIsEnquiryVerified(found.isVerifiedByCaller);
                            setEnquiryVerificationNotes(found.callerVerificationNotes || "");
                          }
                        }}
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
                      >
                        {lead.enquiries.map((enq) => (
                          <option key={enq.id} value={enq.id}>
                            {enq.source} • Ref: {enq.advertisedPropertyRef || "Direct"} • {enq.enquiryDate}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {lead.enquiries && lead.enquiries.length === 1 && (
                    <div className="text-[11px] text-crm-muted bg-white p-2 rounded border border-crm-border">
                      Source: <strong className="text-crm-text">{lead.enquiries[0].source}</strong>
                      {lead.enquiries[0].advertisedPropertyRef && (
                        <span> • Ad Ref: <strong className="text-crm-text">{lead.enquiries[0].advertisedPropertyRef}</strong></span>
                      )}
                      <span> • Date: {lead.enquiries[0].enquiryDate}</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isEnquiryVerified}
                        onChange={(e) => setIsEnquiryVerified(e.target.checked)}
                        className="rounded border-crm-border text-crm-primary focus:ring-crm-primary"
                      />
                      <span className="font-semibold text-xs text-crm-text">
                        Verified by caller (prospect confirmed inquiring about this property ad)
                      </span>
                    </label>

                    <div>
                      <input
                        type="text"
                        placeholder="Caller verification notes (e.g. Buyer verified interest in 3BHK ad ref DLF-302)"
                        value={enquiryVerificationNotes}
                        onChange={(e) => setEnquiryVerificationNotes(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary"
                      />
                    </div>
                  </div>
                </div>

                {/* SECTION D: Requirements Confirmation & Activation Toggle */}
                {disposition === "CONNECTED" && canActivate && lead.status !== "Active" && (
                  <div className="p-3.5 rounded-lg bg-teal-50 border border-teal-200 space-y-2">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmRequirements}
                        onChange={(e) => setConfirmRequirements(e.target.checked)}
                        className="mt-0.5 rounded border-crm-border text-crm-primary focus:ring-crm-primary"
                      />
                      <div>
                        <span className="font-bold text-xs text-crm-primary block">
                          ✓ Confirm Requirements & Activate Prospect (PRD §5.6)
                        </span>
                        <p className="text-[11px] text-crm-text leading-snug">
                          Check this box if the prospect has validated their budget, configuration, and intent to view properties.
                          This transitions the lead to Active (Qualified) pool.
                        </p>
                      </div>
                    </label>
                  </div>
                )}

                {/* Submit Action */}
                <div className="pt-2 flex items-center justify-between border-t border-crm-border">
                  <Link
                    href={`/leads/${lead.id}`}
                    className="px-3 py-1.5 text-xs text-crm-muted hover:text-crm-text"
                  >
                    Cancel
                  </Link>

                  <button
                    type="submit"
                    disabled={isSubmitting || isCallingBlocked}
                    className="px-6 py-2.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Saving Call Outcome...
                      </>
                    ) : isCallingBlocked ? (
                      <>Calling Blocked</>
                    ) : (
                      <>✓ Log Call & Save Outcome</>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* RIGHT COLUMN: Section B (Persistent Call History) & Activation Action */}
          <div className="lg:col-span-5 space-y-6">
            {/* Quick Activate Card */}
            {canActivate && lead.status !== "Active" && (
              <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-crm-text uppercase tracking-wider">
                    Lead Activation
                  </span>
                  <StatusBadge status={lead.status} />
                </div>
                <p className="text-xs text-crm-muted">
                  Prospect is currently <strong>{lead.status}</strong>. When requirements are fully verified, promote to the Active pool.
                </p>
                <button
                  type="button"
                  onClick={handleQuickActivate}
                  disabled={isActivating}
                  className="w-full py-2 text-xs font-bold rounded bg-crm-success text-white hover:bg-emerald-700 shadow-2xs transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isActivating ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Activating Lead...
                    </>
                  ) : (
                    <>✓ Direct Activate Lead (Confirm Search)</>
                  )}
                </button>
              </div>
            )}

            {/* SECTION B: Persistent Call History Timeline */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-5 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                    Section B: Persistent Call History
                  </h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-stone-200 text-crm-text">
                    {lead.callHistory.length} Calls
                  </span>
                </div>
                <span className="text-[10px] text-crm-muted">Audit Log</span>
              </div>

              <div className="p-4 space-y-3 max-h-[550px] overflow-y-auto">
                {lead.callHistory.length === 0 ? (
                  <div className="p-6 text-center text-crm-muted space-y-1 bg-stone-50/50 rounded-lg border border-dashed border-crm-border text-xs">
                    <p className="font-semibold text-crm-text">No calls logged yet</p>
                    <p className="text-[11px]">
                      Use the form on the left to record the first qualification call.
                    </p>
                  </div>
                ) : (
                  lead.callHistory.map((call) => (
                    <div
                      key={call.id}
                      className="p-3 rounded-lg border border-crm-border bg-stone-50/40 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <StatusBadge status={call.disposition} />
                        <span className="text-[10px] text-crm-muted">{call.calledAt}</span>
                      </div>

                      {call.notes && (
                        <p className="text-crm-text bg-white p-2 rounded border border-crm-border text-[11px] leading-relaxed">
                          {call.notes}
                        </p>
                      )}

                      {call.callbackDate && (
                        <div className="p-1.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[10px] font-semibold flex items-center gap-1">
                          <span>⏰ Callback:</span>
                          <span>{call.callbackDate}</span>
                        </div>
                      )}

                      <div className="text-[10px] text-crm-muted">
                        Caller: <strong className="text-crm-text">{call.callerName}</strong>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* DNC Confirmation Modal */}
      {isDncModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-crm-surface border border-crm-border p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-crm-border pb-2.5">
              <h3 className="font-bold text-sm text-crm-text flex items-center gap-2">
                <span>🛑</span> Mark Prospect as Do Not Contact (DNC)
              </h3>
              <button
                type="button"
                onClick={() => setIsDncModalOpen(false)}
                className="text-crm-muted hover:text-crm-text text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-crm-text leading-relaxed">
              Marking <strong>{lead.name}</strong> as Do Not Contact will immediately transition the lead to <strong>Inactive</strong> and permanently block all further calling. This action is permanently recorded in the audit change log.
            </p>

            <div className="space-y-1">
              <label className="block text-[11px] font-semibold text-crm-muted">
                Reason / Prospect Feedback (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Explicitly requested removal, not interested..."
                value={dncReason}
                onChange={(e) => setDncReason(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-crm-border">
              <button
                type="button"
                onClick={() => setIsDncModalOpen(false)}
                disabled={isDncSubmitting}
                className="px-3 py-1.5 text-xs rounded border border-crm-border bg-stone-50 text-crm-text hover:bg-stone-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleMarkDnc}
                disabled={isDncSubmitting}
                className="px-4 py-1.5 text-xs font-bold rounded bg-rose-700 text-white hover:bg-rose-800 shadow-2xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                {isDncSubmitting ? "Marking DNC..." : "Confirm Do Not Contact"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </AppShell>
  );
}

