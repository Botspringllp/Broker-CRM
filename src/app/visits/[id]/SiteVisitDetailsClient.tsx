"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Toast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { SiteVisit, SiteVisitItem } from "@/types/crm";
import { SiteVisitItemOutcome, VisitPartyPersona } from "@prisma/client";
import {
  rescheduleSiteVisitAction,
  reassignSiteVisitAgentAction,
  cancelSiteVisitAction,
  confirmSiteVisitAction,
  recordVisitItemOutcomeAction,
} from "../actions";

interface SalesAgentOption {
  id: string;
  name: string;
  email: string;
}

interface SiteVisitDetailsClientProps {
  initialVisit: SiteVisit;
  currentUserRole: string;
  currentUserId: string;
  salesAgents: SalesAgentOption[];
  canReschedule: boolean;
  canAssignAgent: boolean;
  canRecordOutcome: boolean;
  canConfirm: boolean;
  canCancel: boolean;
}

export function SiteVisitDetailsClient({
  initialVisit,
  salesAgents,
  canReschedule,
  canAssignAgent,
  canRecordOutcome,
  canConfirm,
  canCancel,
}: SiteVisitDetailsClientProps) {
  const [visit, setVisit] = useState<SiteVisit>(initialVisit);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Reschedule modal
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [newDateTime, setNewDateTime] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [isRescheduling, setIsRescheduling] = useState(false);

  // Reassign agent modal
  const [isReassignOpen, setIsReassignOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState(
    visit.assignedSalesAgentId || (salesAgents[0]?.id ?? "")
  );
  const [reassignReason, setReassignReason] = useState("");
  const [isReassigning, setIsReassigning] = useState(false);

  // Cancel visit modal
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelledPersona, setCancelledPersona] = useState<VisitPartyPersona>(VisitPartyPersona.BUYER);
  const [isCancelling, setIsCancelling] = useState(false);

  // Record item outcome modal
  const [selectedItemForOutcome, setSelectedItemForOutcome] = useState<SiteVisitItem | null>(null);
  const [outcomeStatus, setOutcomeStatus] = useState<SiteVisitItemOutcome>(SiteVisitItemOutcome.VISIT_DONE);
  const [agentNotes, setAgentNotes] = useState("");
  const [buyerFeedback, setBuyerFeedback] = useState("");
  const [isSubmittingOutcome, setIsSubmittingOutcome] = useState(false);

  // Confirm visit state
  const [isConfirming, setIsConfirming] = useState(false);

  // Handle Reschedule
  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDateTime) {
      setToastMessage("Please select a valid new scheduled date and time.");
      return;
    }
    if (!rescheduleReason.trim()) {
      setToastMessage("Please provide a reason for rescheduling.");
      return;
    }

    setIsRescheduling(true);
    try {
      const res = await rescheduleSiteVisitAction({
        visitId: visit.id,
        newScheduledDate: new Date(newDateTime).toISOString(),
        reason: rescheduleReason.trim(),
      });

      if (res.success && res.visit) {
        setVisit(res.visit);
        setIsRescheduleOpen(false);
        setNewDateTime("");
        setRescheduleReason("");
        setToastMessage("Site visit rescheduled successfully.");
      } else {
        setToastMessage(res.error || "Failed to reschedule site visit.");
      }
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Error rescheduling visit.");
    } finally {
      setIsRescheduling(false);
    }
  };

  // Handle Reassign Agent
  const handleReassignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentId) {
      setToastMessage("Please select a sales agent.");
      return;
    }

    setIsReassigning(true);
    try {
      const res = await reassignSiteVisitAgentAction({
        visitId: visit.id,
        newSalesAgentId: selectedAgentId,
        reason: reassignReason.trim() || undefined,
      });

      if (res.success && res.visit) {
        setVisit(res.visit);
        setIsReassignOpen(false);
        setReassignReason("");
        setToastMessage("Field Sales Agent reassigned successfully.");
      } else {
        setToastMessage(res.error || "Failed to reassign agent.");
      }
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Error reassigning agent.");
    } finally {
      setIsReassigning(false);
    }
  };

  // Handle Cancel Visit
  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelReason.trim()) {
      setToastMessage("Please provide a cancellation reason.");
      return;
    }

    setIsCancelling(true);
    try {
      const res = await cancelSiteVisitAction({
        visitId: visit.id,
        reason: cancelReason.trim(),
        cancelledByPersona: cancelledPersona,
      });

      if (res.success && res.visit) {
        setVisit(res.visit);
        setIsCancelOpen(false);
        setCancelReason("");
        setToastMessage("Site visit marked as cancelled.");
      } else {
        setToastMessage(res.error || "Failed to cancel site visit.");
      }
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Error cancelling visit.");
    } finally {
      setIsCancelling(false);
    }
  };

  // Handle Confirm & Complete Visit
  const handleConfirmVisit = async () => {
    setIsConfirming(true);
    try {
      const res = await confirmSiteVisitAction({
        visitId: visit.id,
        notes: "Visit confirmed and completed by coordinator.",
      });

      if (res.success && res.visit) {
        setVisit(res.visit);
        setToastMessage("Site visit finalized and marked as Completed.");
      } else {
        setToastMessage(res.error || "Failed to finalize site visit.");
      }
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Error completing visit.");
    } finally {
      setIsConfirming(false);
    }
  };

  // Open Record Outcome Modal
  const handleOpenOutcomeModal = (item: SiteVisitItem) => {
    setSelectedItemForOutcome(item);
    setOutcomeStatus(
      item.status === "Visit Not Done"
        ? SiteVisitItemOutcome.VISIT_NOT_DONE
        : SiteVisitItemOutcome.VISIT_DONE
    );
    setAgentNotes(item.agentNotes || "");
    setBuyerFeedback(item.buyerFeedback || "");
  };

  // Submit Item Outcome
  const handleOutcomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemForOutcome) return;

    setIsSubmittingOutcome(true);
    try {
      const res = await recordVisitItemOutcomeAction({
        itemId: selectedItemForOutcome.id,
        data: {
          status: outcomeStatus,
          agentTextNotes: agentNotes.trim() || undefined,
          buyerFeedback: buyerFeedback.trim() || undefined,
        },
      });

      if (res.success && res.visit) {
        setVisit(res.visit);
        setSelectedItemForOutcome(null);
        setToastMessage("Property visit outcome recorded successfully.");
      } else {
        setToastMessage(res.error || "Failed to record outcome.");
      }
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Error recording outcome.");
    } finally {
      setIsSubmittingOutcome(false);
    }
  };

  const isCompleted = visit.status === "Completed";
  const isCancelled = visit.status === "Cancelled";

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto space-y-6 pb-12">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between border-b border-crm-border pb-4">
          <div className="flex items-center gap-2">
            <Link
              href="/visits"
              className="text-xs font-semibold text-crm-link hover:underline flex items-center gap-1"
            >
              <span>←</span> All Site Visits
            </Link>
            <span className="text-crm-muted text-xs">/</span>
            <span className="text-xs font-medium text-crm-text">
              Visit Details ({visit.id.slice(0, 8)})
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/matching/${visit.buyerId}`}
              className="text-xs font-semibold text-crm-link hover:underline flex items-center gap-1"
            >
              <span>🎯</span> Buyer Matches
            </Link>
          </div>
        </div>

        {/* Title Header Card */}
        <div className="bg-crm-surface border border-crm-border rounded-lg p-5 shadow-2xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-teal-50 border border-teal-200 text-crm-primary flex items-center justify-center font-bold text-lg shadow-2xs">
                📅
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold tracking-tight text-crm-text">
                    Site Visit: {visit.buyerName}
                  </h1>
                  <StatusBadge status={visit.status} />
                </div>
                <p className="text-xs text-crm-muted mt-1">
                  Scheduled for <strong className="text-crm-text">{visit.scheduledDate}</strong> at{" "}
                  <strong className="text-crm-text">{visit.timeSlot}</strong> • {visit.items.length}{" "}
                  {visit.items.length === 1 ? "Property" : "Properties"} in tour itinerary
                </p>
              </div>
            </div>

            {/* Action Buttons Toolbar */}
            <div className="flex items-center gap-2 flex-wrap">
              {canReschedule && !isCompleted && (
                <button
                  type="button"
                  onClick={() => setIsRescheduleOpen(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 shadow-2xs cursor-pointer"
                >
                  ⏰ Reschedule
                </button>
              )}

              {canAssignAgent && !isCompleted && !isCancelled && (
                <button
                  type="button"
                  onClick={() => setIsReassignOpen(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 shadow-2xs cursor-pointer"
                >
                  👤 Reassign Agent
                </button>
              )}

              {canConfirm && !isCompleted && !isCancelled && (
                <button
                  type="button"
                  onClick={handleConfirmVisit}
                  disabled={isConfirming}
                  className="px-3.5 py-1.5 text-xs font-bold rounded bg-crm-success text-white hover:bg-emerald-700 shadow-2xs cursor-pointer disabled:opacity-50"
                >
                  {isConfirming ? "Completing..." : "✓ Complete Visit"}
                </button>
              )}

              {canCancel && !isCancelled && !isCompleted && (
                <button
                  type="button"
                  onClick={() => setIsCancelOpen(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 shadow-2xs cursor-pointer"
                >
                  ✕ Cancel Visit
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* LEFT 2 COLUMNS: Itinerary & Participant Overview */}
          <div className="lg:col-span-2 space-y-6">
            {/* Card: Tour Itinerary */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-5 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                  Tour Itinerary ({visit.items.length} Properties)
                </h2>
                <span className="text-[10px] text-crm-muted">Sequential tour order</span>
              </div>

              <div className="p-5 space-y-4">
                {visit.items.length === 0 ? (
                  <p className="text-xs text-crm-muted italic text-center py-4">
                    No properties in this visit tour.
                  </p>
                ) : (
                  visit.items.map((item, idx) => (
                    <div
                      key={item.id}
                      className="p-4 rounded-lg border border-crm-border bg-stone-50/40 space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-crm-border/60 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-crm-primary text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <div>
                            <Link
                              href={`/supply/${item.propertyId}`}
                              className="font-bold text-crm-text text-sm hover:text-crm-primary hover:underline inline-flex items-center gap-1"
                            >
                              <span>{item.propertyTitle}</span>
                              <span className="text-[10px] text-crm-link">↗</span>
                            </Link>
                            <p className="text-[11px] text-crm-muted">
                              {item.locality}, {item.city} • Unit: {item.flatNumber || "Assigned"}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <StatusBadge status={item.status} />
                          {canRecordOutcome && !isCancelled && (
                            <button
                              type="button"
                              onClick={() => handleOpenOutcomeModal(item)}
                              className="px-2.5 py-1 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 shadow-2xs cursor-pointer"
                            >
                              Record Outcome 📝
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Outcome Details */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-[10px] text-crm-muted uppercase font-bold block">
                            Audit Reporting
                          </span>
                          <span className="text-crm-text text-[11px]">
                            Reported By: <strong>{item.reportedBy || "Awaiting reporting"}</strong>
                          </span>
                          <span className="text-crm-muted text-[10px] block">
                            Channel: {item.entryChannel} {item.reportedAt ? `• ${item.reportedAt}` : ""}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] text-crm-muted uppercase font-bold block">
                            Buyer Feedback
                          </span>
                          <p className="text-[11px] text-crm-text bg-white p-2 rounded border border-crm-border min-h-[36px]">
                            {item.buyerFeedback || "No feedback entered yet."}
                          </p>
                        </div>
                      </div>

                      {item.agentNotes && (
                        <div className="text-xs pt-1">
                          <span className="text-[10px] text-crm-muted uppercase font-bold block">
                            Agent Field Notes
                          </span>
                          <p className="text-[11px] text-crm-text bg-white p-2 rounded border border-crm-border">
                            {item.agentNotes}
                          </p>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Schedule History Timeline */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-5 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                  Immutable Schedule Audit History (PRD §8.2)
                </h2>
                <span className="text-[10px] text-crm-muted">
                  {visit.scheduleHistory.length} Record(s)
                </span>
              </div>

              <div className="p-5 text-xs">
                {visit.scheduleHistory.length === 0 ? (
                  <p className="text-crm-muted italic text-center py-3">
                    No schedule changes recorded. Visit is on original scheduled date.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {visit.scheduleHistory.map((hist, i) => (
                      <div
                        key={i}
                        className="p-3 rounded border border-crm-border bg-stone-50/50 space-y-1 text-xs"
                      >
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="font-bold text-crm-text text-[11px]">
                            {hist.changeType || "RESCHEDULED"}
                          </span>
                          <span className="text-[10px] text-crm-muted">{hist.changedAt}</span>
                        </div>
                        <div className="text-[11px] text-crm-muted">
                          Previous: <strong className="text-crm-text">{hist.previousTime}</strong> → New:{" "}
                          <strong className="text-crm-text">{hist.newTime}</strong>
                        </div>
                        <p className="text-crm-text text-[11px] bg-white p-1.5 rounded border border-crm-border">
                          Reason: {hist.reason}
                        </p>
                        <span className="text-[10px] text-crm-muted block">
                          Recorded by: {hist.recordedBy}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Key Stakeholders & Contact Info */}
          <div className="space-y-6">
            {/* Prospect / Buyer Card */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-5 py-3 bg-stone-50 border-b border-crm-border">
                <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                  Buyer / Tenant Information
                </h2>
              </div>

              <div className="p-5 space-y-3 text-xs">
                <div>
                  <span className="text-[10px] text-crm-muted uppercase font-bold block">
                    Prospect Name
                  </span>
                  <Link
                    href={`/leads/${visit.buyerId}`}
                    className="font-bold text-crm-text text-sm hover:text-crm-primary hover:underline"
                  >
                    {visit.buyerName} ↗
                  </Link>
                </div>

                <div>
                  <span className="text-[10px] text-crm-muted uppercase font-bold block">
                    Phone Number
                  </span>
                  <a
                    href={`tel:${visit.buyerPhone}`}
                    className="text-crm-primary font-bold hover:underline"
                  >
                    +91 {visit.buyerPhone}
                  </a>
                </div>

                <div className="pt-2 border-t border-crm-border">
                  <Link
                    href={`/matching/${visit.buyerId}`}
                    className="w-full py-2 text-xs font-bold rounded bg-teal-50 border border-teal-200 text-teal-800 hover:bg-teal-100 shadow-2xs text-center flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <span>🎯</span> Open Matching Workspace
                  </Link>
                </div>
              </div>
            </div>

            {/* Assigned Field Sales Agent Card */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-5 py-3 bg-stone-50 border-b border-crm-border">
                <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                  Assigned Field Sales Agent
                </h2>
              </div>

              <div className="p-5 space-y-3 text-xs">
                <div>
                  <span className="text-[10px] text-crm-muted uppercase font-bold block">
                    Sales Agent
                  </span>
                  <strong className="text-crm-text text-sm">{visit.assignedSalesAgent}</strong>
                </div>

                {visit.telecallerConfirmedBy && (
                  <div className="pt-2 border-t border-crm-border">
                    <span className="text-[10px] text-crm-muted uppercase font-bold block">
                      Confirmed Coordinator
                    </span>
                    <span className="text-crm-text font-medium">
                      {visit.telecallerConfirmedBy} ({visit.telecallerConfirmedAt})
                    </span>
                  </div>
                )}

                {canAssignAgent && !isCompleted && !isCancelled && (
                  <div className="pt-2 border-t border-crm-border">
                    <button
                      type="button"
                      onClick={() => setIsReassignOpen(true)}
                      className="w-full py-2 text-xs font-semibold rounded border border-crm-border bg-stone-50 text-crm-text hover:bg-stone-100 shadow-2xs cursor-pointer text-center"
                    >
                      Change Assigned Agent
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Visit Cancellation Notice if cancelled */}
            {isCancelled && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-5 text-xs text-red-800 space-y-1 shadow-2xs">
                <span className="font-bold text-sm block">⚠️ Visit Cancelled</span>
                <p>
                  <strong>Reason:</strong> {visit.cancellationReason || "No reason recorded."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL 1: Reschedule Visit */}
      <Modal
        isOpen={isRescheduleOpen}
        onClose={() => setIsRescheduleOpen(false)}
        title="Reschedule Site Visit"
        subtitle={`Prospect: ${visit.buyerName} • Current: ${visit.scheduledDate} (${visit.timeSlot})`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setIsRescheduleOpen(false)}
              className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRescheduleSubmit}
              disabled={isRescheduling}
              className="px-4 py-1.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50"
            >
              {isRescheduling ? "Saving..." : "Confirm New Date"}
            </button>
          </>
        }
      >
        <form onSubmit={handleRescheduleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              New Date & Time *
            </label>
            <input
              type="datetime-local"
              required
              value={newDateTime}
              onChange={(e) => setNewDateTime(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
            />
          </div>

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Reason for Rescheduling *
            </label>
            <textarea
              required
              rows={3}
              placeholder="e.g. Buyer requested later slot due to office meeting..."
              value={rescheduleReason}
              onChange={(e) => setRescheduleReason(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
            />
          </div>
        </form>
      </Modal>

      {/* MODAL 2: Reassign Field Sales Agent */}
      <Modal
        isOpen={isReassignOpen}
        onClose={() => setIsReassignOpen(false)}
        title="Reassign Field Sales Agent"
        subtitle={`Current Agent: ${visit.assignedSalesAgent}`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setIsReassignOpen(false)}
              className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReassignSubmit}
              disabled={isReassigning}
              className="px-4 py-1.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50"
            >
              {isReassigning ? "Saving..." : "Reassign Agent"}
            </button>
          </>
        }
      >
        <form onSubmit={handleReassignSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Select Field Sales Agent *
            </label>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            >
              {salesAgents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name} ({ag.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Reassignment Notes (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Original agent unavailable due to leave"
              value={reassignReason}
              onChange={(e) => setReassignReason(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            />
          </div>
        </form>
      </Modal>

      {/* MODAL 3: Cancel Site Visit */}
      <Modal
        isOpen={isCancelOpen}
        onClose={() => setIsCancelOpen(false)}
        title="Cancel Site Visit"
        subtitle={`Prospect: ${visit.buyerName}`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setIsCancelOpen(false)}
              className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={handleCancelSubmit}
              disabled={isCancelling}
              className="px-4 py-1.5 text-xs font-bold rounded bg-red-600 text-white hover:bg-red-700 shadow-2xs disabled:opacity-50"
            >
              {isCancelling ? "Cancelling..." : "Confirm Cancellation"}
            </button>
          </>
        }
      >
        <form onSubmit={handleCancelSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Cancellation Initiated By *
            </label>
            <select
              value={cancelledPersona}
              onChange={(e) => setCancelledPersona(e.target.value as VisitPartyPersona)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            >
              <option value={VisitPartyPersona.BUYER}>Buyer / Tenant</option>
              <option value={VisitPartyPersona.OWNER}>Property Owner</option>
              <option value={VisitPartyPersona.BROKER}>Brokerage Agent</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Cancellation Reason *
            </label>
            <textarea
              required
              rows={3}
              placeholder="e.g. Prospect cancelled due to emergency travel..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            />
          </div>
        </form>
      </Modal>

      {/* MODAL 4: Record Property Outcome */}
      <Modal
        isOpen={!!selectedItemForOutcome}
        onClose={() => setSelectedItemForOutcome(null)}
        title={`Record Outcome: ${selectedItemForOutcome?.propertyTitle || ""}`}
        subtitle={`Prospect: ${visit.buyerName}`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setSelectedItemForOutcome(null)}
              className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleOutcomeSubmit}
              disabled={isSubmittingOutcome}
              className="px-4 py-1.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50"
            >
              {isSubmittingOutcome ? "Saving..." : "Save Outcome"}
            </button>
          </>
        }
      >
        <form onSubmit={handleOutcomeSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Visit Outcome *
            </label>
            <select
              value={outcomeStatus}
              onChange={(e) => setOutcomeStatus(e.target.value as SiteVisitItemOutcome)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            >
              <option value={SiteVisitItemOutcome.VISIT_DONE}>Visit Done (Conducted)</option>
              <option value={SiteVisitItemOutcome.VISIT_NOT_DONE}>Visit Not Done (Skipped / Inaccessible)</option>
              <option value={SiteVisitItemOutcome.PENDING}>Pending</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Buyer Feedback & Reaction
            </label>
            <textarea
              rows={3}
              placeholder="e.g. Buyer loved the spacious balcony but concerned about maintenance fee..."
              value={buyerFeedback}
              onChange={(e) => setBuyerFeedback(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Agent Field Observations / Notes
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Unit was vacant, keys returned to society guard after visit."
              value={agentNotes}
              onChange={(e) => setAgentNotes(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            />
          </div>
        </form>
      </Modal>

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </AppShell>
  );
}

