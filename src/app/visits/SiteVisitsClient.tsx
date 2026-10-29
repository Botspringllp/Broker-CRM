"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { SiteVisit, SiteVisitItem } from "@/types/crm";
import { SiteVisitItemOutcome, VisitOutcomeEntryChannel } from "@prisma/client";
import {
  createSiteVisitAction,
  recordVisitItemOutcomeAction,
  confirmSiteVisitAction,
} from "./actions";

interface AvailableLead {
  id: string;
  name: string;
  primaryPhone: string;
}

interface AvailableProperty {
  id: string;
  societyName: string;
  flatNumber: string;
  bedroomCount: number;
  localityName: string;
}

interface SalesAgent {
  id: string;
  name: string;
  email: string;
}

interface SiteVisitsClientProps {
  initialVisits: SiteVisit[];
  availableLeads?: AvailableLead[];
  availableProperties?: AvailableProperty[];
  salesAgents?: SalesAgent[];
}

export function SiteVisitsClient({
  initialVisits,
  availableLeads = [],
  availableProperties = [],
  salesAgents = [],
}: SiteVisitsClientProps) {
  const [visits, setVisits] = useState<SiteVisit[]>(initialVisits);
  const [selectedVisit, setSelectedVisit] = useState<SiteVisit | null>(initialVisits[0] || null);
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");

  // Buyer Preview Mode toggle (Masking address and owner contacts per PRD §8.2)
  const [isBuyerPreviewMode, setIsBuyerPreviewMode] = useState(false);

  // Property Outcome Logging Modal state
  const [activeItem, setActiveItem] = useState<SiteVisitItem | null>(null);
  const [itemOutcome, setItemOutcome] = useState<"Visit Done" | "Visit Not Done">("Visit Done");
  const [itemNotes, setItemNotes] = useState("");
  const [voiceNoteRecorded, setVoiceNoteRecorded] = useState(false);
  const [entryMode, setEntryMode] = useState<"Field Agent Direct" | "Telecaller on Behalf">("Field Agent Direct");
  const [isOutcomeSaving, setIsOutcomeSaving] = useState(false);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);

  // Telecaller Final Confirmation state
  const [isConfirming, setIsConfirming] = useState(false);

  // Schedule Visit Modal state
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleLeadId, setScheduleLeadId] = useState("");
  const [scheduleAgentId, setScheduleAgentId] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("11:00");
  const [scheduleSelectedProperties, setScheduleSelectedProperties] = useState<string[]>([]);
  const [scheduleNotes, setScheduleNotes] = useState("");

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filtered visits
  const filteredVisits = visits.filter((v) => {
    const matchesSearch =
      v.buyerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.assignedSalesAgent.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.items.some((item) => item.propertyTitle.toLowerCase().includes(searchTerm.toLowerCase()));

    if (!matchesSearch) return false;
    if (statusFilter !== "All" && v.status !== statusFilter) return false;
    return true;
  });

  const handleOpenOutcomeModal = (item: SiteVisitItem) => {
    setActiveItem(item);
    setItemOutcome(item.status === "Visit Not Done" ? "Visit Not Done" : "Visit Done");
    setItemNotes(item.agentNotes || "");
    setVoiceNoteRecorded(item.hasVoiceNote || false);
    setEntryMode(item.entryChannel || "Field Agent Direct");
    setOutcomeError(null);
  };

  const handleSaveItemOutcome = async () => {
    if (!selectedVisit || !activeItem || isOutcomeSaving) return;

    setIsOutcomeSaving(true);
    setOutcomeError(null);

    try {
      const res = await recordVisitItemOutcomeAction({
        itemId: activeItem.id,
        data: {
          status:
            itemOutcome === "Visit Done"
              ? SiteVisitItemOutcome.VISIT_DONE
              : SiteVisitItemOutcome.VISIT_NOT_DONE,
          agentTextNotes: itemNotes.trim() || undefined,
          entryChannel:
            entryMode === "Field Agent Direct"
              ? VisitOutcomeEntryChannel.FIELD_AGENT_DIRECT
              : VisitOutcomeEntryChannel.TELECALLER_ON_BEHALF,
        },
      });

      if (!res.success) {
        setOutcomeError(res.error);
        return;
      }

      setVisits((prev) => prev.map((v) => (v.id === res.visit.id ? res.visit : v)));
      setSelectedVisit(res.visit);
      setActiveItem(null);
      setToastMessage(`Recorded outcome (${itemOutcome}) for ${activeItem.propertyTitle}`);
    } catch (err: unknown) {
      setOutcomeError(err instanceof Error ? err.message : "Failed to record property outcome.");
    } finally {
      setIsOutcomeSaving(false);
    }
  };

  const handleTelecallerFinalConfirm = async () => {
    if (!selectedVisit || isConfirming) return;

    setIsConfirming(true);
    try {
      const res = await confirmSiteVisitAction({
        visitId: selectedVisit.id,
      });

      if (!res.success) {
        setToastMessage(`Failed to confirm site visit: ${res.error}`);
        return;
      }

      setVisits((prev) => prev.map((v) => (v.id === res.visit.id ? res.visit : v)));
      setSelectedVisit(res.visit);
      setToastMessage(
        "Site visit finalized & confirmed by telecaller. Outcomes synchronized with Active Supply Pool."
      );
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Failed to confirm site visit.");
    } finally {
      setIsConfirming(false);
    }
  };

  const handleOpenScheduleModal = () => {
    setScheduleLeadId(availableLeads[0]?.id || "");
    setScheduleAgentId(salesAgents[0]?.id || "");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setScheduleDate(tomorrow.toISOString().split("T")[0]);
    setScheduleTime("11:00");
    setScheduleSelectedProperties([]);
    setScheduleNotes("");
    setScheduleError(null);
    setIsScheduleModalOpen(true);
  };

  const handleCreateScheduleVisit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isScheduling) return;
    setScheduleError(null);

    if (!scheduleLeadId) {
      setScheduleError("Please select a prospect lead.");
      return;
    }
    if (!scheduleAgentId) {
      setScheduleError("Please select an assigned sales agent.");
      return;
    }
    if (!scheduleDate) {
      setScheduleError("Please select a visit date.");
      return;
    }
    if (scheduleSelectedProperties.length === 0) {
      setScheduleError("Please select at least one property from Active Supply Pool.");
      return;
    }

    setIsScheduling(true);
    try {
      const scheduledDateTime = new Date(`${scheduleDate}T${scheduleTime || "10:00"}:00`);
      const res = await createSiteVisitAction({
        leadId: scheduleLeadId,
        assignedSalesAgentId: scheduleAgentId,
        scheduledDate: scheduledDateTime.toISOString(),
        propertyIds: scheduleSelectedProperties,
        notes: scheduleNotes.trim() || undefined,
      });

      if (!res.success) {
        setScheduleError(res.error);
        return;
      }

      setVisits((prev) => [res.visit, ...prev]);
      setSelectedVisit(res.visit);
      setIsScheduleModalOpen(false);
      setToastMessage(`Site visit itinerary scheduled for ${res.visit.buyerName}.`);
    } catch (err: unknown) {
      setScheduleError(err instanceof Error ? err.message : "Failed to schedule site visit.");
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-crm-border">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-crm-text">
                Site Visits & Itineraries
              </h2>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-stone-100 text-crm-muted border border-crm-border">
                {filteredVisits.length} Schedules
              </span>
            </div>
            <p className="text-xs text-crm-muted mt-1">
              Field sales agent coordination, multi-property visit schedules, per-property outcomes, and telecaller confirmation (PRD §8).
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Buyer Preview Mode Switch */}
            <button
              onClick={() => setIsBuyerPreviewMode(!isBuyerPreviewMode)}
              className={`px-3 py-1.5 text-xs font-semibold rounded border transition-all flex items-center gap-1.5 shadow-2xs ${
                isBuyerPreviewMode
                  ? "bg-amber-600 text-white border-amber-700"
                  : "bg-crm-surface text-crm-text border-crm-border hover:bg-stone-50"
              }`}
            >
              <span>{isBuyerPreviewMode ? "👁️ Masking Active" : "👁️ Buyer Preview Mode"}</span>
            </button>

            <button
              onClick={handleOpenScheduleModal}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
            >
              + Align New Visit
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="p-4 rounded-lg bg-crm-surface border border-crm-border shadow-2xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Search Buyer, Field Agent, Property Title
              </label>
              <input
                type="text"
                placeholder="e.g. Buyer name, agent name, society name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Visit Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">All Visit Statuses</option>
                <option value="Tentative - Awaiting Owner">Tentative (Awaiting Owner)</option>
                <option value="Confirmed">Confirmed</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        </div>

        {/* Master-Detail Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Visits Table */}
          <div
            className={`rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden transition-all ${
              selectedVisit ? "lg:col-span-5" : "lg:col-span-12"
            }`}
          >
            <div className="px-4 py-2.5 bg-stone-50 border-b border-crm-border text-xs font-semibold text-crm-text flex items-center justify-between">
              <span>Scheduled Visits</span>
              <span className="text-[11px] text-crm-muted">Supports multi-property itineraries</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50/50 border-b border-crm-border text-crm-muted uppercase tracking-wider font-semibold text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Buyer & Contact</th>
                    <th className="px-3 py-3">Schedule Date & Slot</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-crm-border">
                  {visits.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-12 text-center text-crm-muted">
                        <div className="max-w-sm mx-auto space-y-1">
                          <p className="font-semibold text-crm-text text-sm">No site visits scheduled</p>
                          <p className="text-xs text-crm-muted">
                            Visits coordinated between buyers and sales agents will appear here.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : filteredVisits.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-crm-muted">
                        No site visits found matching current filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredVisits.map((v) => {
                      const isSelected = selectedVisit?.id === v.id;
                      return (
                        <tr
                          key={v.id}
                          onClick={() => setSelectedVisit(v)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? "bg-teal-50/60 font-medium" : "hover:bg-stone-50/70"
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-bold text-crm-text">{v.buyerName}</div>
                            <div className="text-[11px] text-crm-muted">
                              {v.buyerPhone} • {v.items.length} Properties
                            </div>
                            <div className="text-[10px] text-crm-muted mt-0.5">
                              Field Agent: <strong className="text-crm-text">{v.assignedSalesAgent}</strong>
                            </div>
                          </td>

                          <td className="px-3 py-3">
                            <div className="font-semibold text-crm-text">{v.scheduledDate}</div>
                            <div className="text-[11px] text-crm-muted">{v.timeSlot}</div>
                          </td>

                          <td className="px-3 py-3">
                            <StatusBadge status={v.status} />
                          </td>

                          <td className="px-3 py-3 text-right whitespace-nowrap">
                            <Link
                              href={`/visits/${v.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="px-2.5 py-1 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 shadow-2xs inline-block"
                            >
                              Details ↗
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Visit Itinerary Detail Inspector */}
          {selectedVisit ? (
            <div className="lg:col-span-7 rounded-lg bg-crm-surface border border-crm-border shadow-xs overflow-hidden sticky top-4 space-y-4">
              {/* Header */}
              <div className="px-6 py-4 border-b border-crm-border bg-stone-50/60 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-crm-text">
                      Visit Itinerary: {selectedVisit.buyerName}
                    </h3>
                    <StatusBadge status={selectedVisit.status} />
                  </div>
                  <p className="text-xs text-crm-muted mt-0.5">
                    Date: {selectedVisit.scheduledDate} ({selectedVisit.timeSlot}) • Assigned Sales Agent:{" "}
                    <strong>{selectedVisit.assignedSalesAgent}</strong>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    href={`/visits/${selectedVisit.id}`}
                    className="px-3 py-1.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs flex items-center gap-1"
                  >
                    <span>↗</span> Open Details Page
                  </Link>
                  <button
                    onClick={() => setSelectedVisit(null)}
                    className="text-crm-muted hover:text-crm-text p-1 text-sm cursor-pointer"
                    aria-label="Close Inspector"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6 text-xs max-h-[75vh] overflow-y-auto">
                {/* Privacy Warning Banner if Buyer Preview is ON */}
                {isBuyerPreviewMode && (
                  <div className="p-3.5 rounded-md bg-amber-50 border border-amber-300 text-amber-900 space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-xs">
                      <span>🔒 Buyer-Facing View Preview Active (PRD §8.2)</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Exact flat numbers and private owner contact details are strictly hidden/masked in this preview, matching what the customer sees before the visit.
                    </p>
                  </div>
                )}

                {/* Final Confirmation Banner */}
                {selectedVisit.status === "Completed" ? (
                  <div className="p-3.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between">
                    <div>
                      <div className="font-bold">✓ Visit Finalised & Confirmed by Telecaller</div>
                      <div className="text-[11px] text-emerald-800">
                        Confirmed by {selectedVisit.telecallerConfirmedBy} at {selectedVisit.telecallerConfirmedAt}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-200/60 font-bold uppercase">
                      Finalized
                    </span>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-md bg-stone-50 border border-crm-border flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-crm-text">Telecaller Review & Finalisation (PRD §8.3)</div>
                      <div className="text-[11px] text-crm-muted">
                        A visit is not final until the telecaller reviews agent updates and confirms.
                      </div>
                    </div>
                    <button
                      onClick={handleTelecallerFinalConfirm}
                      disabled={isConfirming}
                      className="px-3 py-1.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50"
                    >
                      {isConfirming ? "Confirming..." : "Confirm Outcome"}
                    </button>
                  </div>
                )}

                {/* Multi-Property Visit Itinerary Line Items */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-crm-border pb-2">
                    <div>
                      <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                        Properties in This Visit Itinerary ({selectedVisit.items.length})
                      </h4>
                      <p className="text-[11px] text-crm-muted">
                        Per-property independent outcomes & feedback (PRD §8.3)
                      </p>
                    </div>
                    <span className="text-[10px] text-crm-muted">One schedule, multiple units</span>
                  </div>

                  <div className="space-y-3.5">
                    {selectedVisit.items.map((item, idx) => (
                      <div
                        key={item.id}
                        className="p-4 rounded-lg border border-crm-border bg-stone-50/40 space-y-3 hover:bg-stone-50/70 transition-all"
                      >
                        {/* Title & Status */}
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-crm-primary/10 text-crm-primary font-bold text-xs flex items-center justify-center">
                              {idx + 1}
                            </span>
                            <div>
                              <div className="font-bold text-crm-text text-sm">
                                {item.propertyTitle}
                              </div>
                              <div className="text-crm-muted text-[11px]">
                                Locality: {item.locality}, {item.city}
                              </div>
                            </div>
                          </div>
                          <StatusBadge status={item.status} />
                        </div>

                        {/* Property Details / Masking */}
                        <div className="p-3 rounded border border-crm-border bg-crm-surface text-xs space-y-1.5">
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div>
                              <span className="text-crm-muted block">Flat / Unit:</span>
                              <strong className={isBuyerPreviewMode ? "text-amber-800 italic font-mono" : "text-crm-text"}>
                                {isBuyerPreviewMode ? "[Masked to Buyer]" : item.flatNumber}
                              </strong>
                            </div>
                            <div>
                              <span className="text-crm-muted block">Owner Contact:</span>
                              <strong className={isBuyerPreviewMode ? "text-amber-800 italic font-mono" : "text-crm-text"}>
                                {isBuyerPreviewMode ? "[Masked to Buyer]" : `${item.ownerName} (${item.ownerMobile})`}
                              </strong>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-crm-border text-[11px] flex items-center justify-between">
                            <div>
                              <span className="text-crm-muted font-medium">Key Custodian ({item.keyHolder.persona}): </span>
                              <span className="text-crm-text font-bold">{item.keyHolder.name} ({item.keyHolder.mobile})</span>
                            </div>
                          </div>
                        </div>

                        {/* Dual-Identity Audit & Notes */}
                        {item.status !== "Pending" && (
                          <div className="p-3 rounded border border-crm-border bg-emerald-50/40 text-[11px] space-y-1.5">
                            <div className="flex items-center justify-between text-crm-muted">
                              <span>
                                Conducted by: <strong className="text-crm-text">{item.reportedBy}</strong>
                              </span>
                              <span>
                                Entered via: <strong className="text-crm-text">{item.entryChannel}</strong> ({item.enteredBy})
                              </span>
                            </div>

                            {item.agentNotes && (
                              <p className="text-crm-text font-medium italic">
                                &quot;{item.agentNotes}&quot;
                              </p>
                            )}

                            {item.hasVoiceNote && (
                              <div className="flex items-center gap-2 pt-1 text-teal-800">
                                <span>🎙️ Voice Note Attached ({item.voiceNoteDuration})</span>
                                <button
                                  onClick={() => setToastMessage("Playing voice note recording...")}
                                  className="px-2 py-0.5 rounded bg-teal-100 text-teal-900 font-semibold hover:bg-teal-200"
                                >
                                  ▶ Play Audio
                                </button>
                              </div>
                            )}

                            {item.buyerInterest && (
                              <div className="text-[11px] pt-1 border-t border-emerald-200 flex items-center gap-2">
                                <span className="text-crm-muted font-semibold">Post-Visit Customer Interest:</span>
                                <span className="font-bold text-crm-text">{item.buyerInterest}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Action buttons for this property */}
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            onClick={() => handleOpenOutcomeModal(item)}
                            className="px-3 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                          >
                            {item.status === "Pending" ? "Record Property Outcome" : "Update Outcome / Notes"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Schedule History Timeline */}
                <div className="space-y-2 pt-3 border-t border-crm-border">
                  <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                    Schedule & Reschedule Log ({selectedVisit.scheduleHistory.length})
                  </h4>
                  {selectedVisit.scheduleHistory.length === 0 ? (
                    <div className="text-crm-muted italic text-[11px]">
                      No schedule modifications recorded for this visit.
                    </div>
                  ) : (
                    selectedVisit.scheduleHistory.map((sch, i) => (
                      <div key={i} className="p-2.5 rounded border border-crm-border bg-stone-50/50 text-[11px] space-y-0.5">
                        <div className="flex items-center justify-between font-bold text-crm-text">
                          <span>Rescheduled: {sch.previousTime} → {sch.newTime}</span>
                          <span className="text-crm-muted text-[10px]">{sch.changedAt}</span>
                        </div>
                        <div className="text-crm-text">Reason: {sch.reason}</div>
                        <div className="text-[10px] text-crm-muted">Recorded by: {sch.recordedBy}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : visits.length > 0 ? (
            <div className="rounded-lg bg-crm-surface border border-crm-border p-8 text-center text-crm-muted">
              <p className="font-semibold text-crm-text text-sm">No site visit selected</p>
              <p className="text-xs text-crm-muted mt-1">Select a visit from the schedule to inspect properties and log outcomes.</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Modal: Record Property-Level Visit Outcome */}
      <Modal
        isOpen={activeItem !== null}
        onClose={() => setActiveItem(null)}
        title={`Record Visit Outcome: ${activeItem?.propertyTitle || ""}`}
        subtitle="Individual property visit reporting (PRD §8.3)"
        footer={
          <>
            <button
              onClick={() => setActiveItem(null)}
              className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveItemOutcome}
              disabled={isOutcomeSaving}
              className="px-4 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs disabled:opacity-50"
            >
              {isOutcomeSaving ? "Saving..." : "Save Property Outcome"}
            </button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          {outcomeError && (
            <div className="p-2.5 rounded bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
              {outcomeError}
            </div>
          )}

          {/* Entry Channel: Direct vs Telecaller On Behalf */}
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Reporting Mode / Entry Channel (PRD §8.3)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEntryMode("Field Agent Direct")}
                className={`py-2 px-3 rounded border text-left font-medium ${
                  entryMode === "Field Agent Direct"
                    ? "border-crm-primary bg-crm-primary-light text-crm-primary"
                    : "border-crm-border bg-stone-50 text-crm-muted"
                }`}
              >
                <div>📱 Field Agent Direct</div>
                <div className="text-[10px] opacity-80">Logged directly on mobile link</div>
              </button>
              <button
                type="button"
                onClick={() => setEntryMode("Telecaller on Behalf")}
                className={`py-2 px-3 rounded border text-left font-medium ${
                  entryMode === "Telecaller on Behalf"
                    ? "border-crm-primary bg-crm-primary-light text-crm-primary"
                    : "border-crm-border bg-stone-50 text-crm-muted"
                }`}
              >
                <div>📞 Telecaller on Behalf</div>
                <div className="text-[10px] opacity-80">Agent called telecaller to report verbally</div>
              </button>
            </div>
          </div>

          {/* Outcome Choice */}
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Visit Outcome (Required)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setItemOutcome("Visit Done")}
                className={`py-2 px-3 rounded border font-bold text-center ${
                  itemOutcome === "Visit Done"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                    : "border-crm-border bg-stone-50 text-crm-muted"
                }`}
              >
                ✓ Visit Done
              </button>
              <button
                type="button"
                onClick={() => setItemOutcome("Visit Not Done")}
                className={`py-2 px-3 rounded border font-bold text-center ${
                  itemOutcome === "Visit Not Done"
                    ? "border-red-600 bg-red-50 text-red-800"
                    : "border-crm-border bg-stone-50 text-crm-muted"
                }`}
              >
                ✗ Visit Not Done
              </button>
            </div>
          </div>

          {/* Text Notes */}
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Field Agent Notes (Text)
            </label>
            <textarea
              rows={3}
              placeholder="What happened during the visit? Any specific feedback, objections, or condition issues?"
              value={itemNotes}
              onChange={(e) => setItemNotes(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            />
          </div>

          {/* Voice Note Simulation */}
          <div className="p-3 rounded border border-crm-border bg-stone-50/60 flex items-center justify-between">
            <div>
              <span className="font-semibold text-crm-text block">Voice Note Support (PRD §8.3)</span>
              <span className="text-[11px] text-crm-muted">
                {voiceNoteRecorded ? "Recorded 42-sec audio snippet" : "No voice note attached"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setVoiceNoteRecorded(!voiceNoteRecorded);
                setToastMessage(voiceNoteRecorded ? "Voice note cleared." : "Simulated audio recorded from microphone.");
              }}
              className={`px-3 py-1 text-xs font-semibold rounded border ${
                voiceNoteRecorded
                  ? "bg-red-50 text-red-700 border-red-300"
                  : "bg-crm-surface text-crm-primary border-crm-primary"
              }`}
            >
              {voiceNoteRecorded ? "🗑 Remove Audio" : "🎙️ Record Voice Note"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Schedule New Multi-Property Site Visit */}
      <Modal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        title="Schedule Site Visit Itinerary"
        subtitle="Coordinate buyer with assigned field sales agent for active properties (PRD §8)"
        footer={
          <>
            <button
              onClick={() => setIsScheduleModalOpen(false)}
              className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text"
            >
              Cancel
            </button>
            <button
              onClick={() => handleCreateScheduleVisit()}
              disabled={isScheduling}
              className="px-4 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs disabled:opacity-50"
            >
              {isScheduling ? "Scheduling..." : "Create Itinerary"}
            </button>
          </>
        }
      >
        <div className="space-y-4 text-xs max-h-[70vh] overflow-y-auto pr-1">
          {scheduleError && (
            <div className="p-2.5 rounded bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
              {scheduleError}
            </div>
          )}

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Select Prospect Lead <span className="text-red-500">*</span>
            </label>
            <select
              value={scheduleLeadId}
              onChange={(e) => setScheduleLeadId(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            >
              <option value="">-- Choose Prospect --</option>
              {availableLeads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.name} ({lead.primaryPhone})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Assigned Field Sales Agent <span className="text-red-500">*</span>
            </label>
            <select
              value={scheduleAgentId}
              onChange={(e) => setScheduleAgentId(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            >
              <option value="">-- Choose Field Agent --</option>
              {salesAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({agent.email})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-crm-text mb-1">
                Scheduled Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              />
            </div>
            <div>
              <label className="block font-semibold text-crm-text mb-1">
                Time Window / Slot
              </label>
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-crm-text mb-1.5">
              Select Properties to Visit (Active Supply Pool) <span className="text-red-500">*</span>
            </label>
            <p className="text-[11px] text-crm-muted mb-2">
              Only verified properties with Available status can be included in itineraries (PRD §8.1).
            </p>
            {availableProperties.length === 0 ? (
              <div className="p-3 rounded border border-amber-200 bg-amber-50 text-amber-900 text-xs">
                No active properties available in supply pool. Verify and activate properties first.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto p-2 border border-crm-border rounded bg-stone-50/30">
                {availableProperties.map((prop) => {
                  const isChecked = scheduleSelectedProperties.includes(prop.id);
                  return (
                    <label
                      key={prop.id}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                        isChecked
                          ? "bg-teal-50 border border-teal-300"
                          : "hover:bg-stone-100/70 border border-transparent"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          if (isChecked) {
                            setScheduleSelectedProperties(
                              scheduleSelectedProperties.filter((id) => id !== prop.id)
                            );
                          } else {
                            setScheduleSelectedProperties([
                              ...scheduleSelectedProperties,
                              prop.id,
                            ]);
                          }
                        }}
                        className="accent-crm-primary"
                      />
                      <div className="text-xs">
                        <span className="font-semibold text-crm-text">
                          {prop.societyName} ({prop.flatNumber})
                        </span>
                        <span className="text-crm-muted ml-1.5 text-[11px]">
                          • {prop.bedroomCount} BHK • {prop.localityName}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Visit Instructions / Special Notes
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Buyer is interested in 3 BHK garden facing, meeting at club house gate..."
              value={scheduleNotes}
              onChange={(e) => setScheduleNotes(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            />
          </div>
        </div>
      </Modal>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </AppShell>
  );
}

