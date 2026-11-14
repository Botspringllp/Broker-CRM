"use client";

import React, { useState } from "react";
import { SiteVisit, SiteVisitItem } from "@/types/crm";
import { submitMobileVisitOutcomeAction } from "@/app/visits/actions";

interface MobileSiteVisitClientProps {
  rawToken: string;
  initialVisit?: SiteVisit;
  tenantName?: string;
  salesAgentName?: string;
  expiresAt?: string;
  initialError?: {
    type: "EXPIRED" | "REVOKED" | "CANCELLED" | "COMPLETED" | "NOT_FOUND";
    message: string;
  };
}

interface OutcomeItemFormState {
  status: "VISIT_DONE" | "VISIT_NOT_DONE";
  agentTextNotes: string;
  buyerFeedback: string;
  buyerInterestLevel: "HIGH" | "MEDIUM" | "LOW" | "NOT_INTERESTED" | "";
  voiceNoteUrl: string;
}

export function MobileSiteVisitClient({
  rawToken,
  initialVisit,
  tenantName = "Broker CRM",
  salesAgentName,
  expiresAt,
  initialError,
}: MobileSiteVisitClientProps) {
  const [visit, setVisit] = useState<SiteVisit | undefined>(initialVisit);
  const [submittingItemId, setSubmittingItemId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<"success" | "error">("success");

  // Form states per item
  const [outcomeFormState, setOutcomeFormState] = useState<Record<string, OutcomeItemFormState>>(() => {
    const initial: Record<string, OutcomeItemFormState> = {};
    if (initialVisit?.items) {
      for (const item of initialVisit.items) {
        initial[item.id] = {
          status: item.status === "Visit Not Done" ? "VISIT_NOT_DONE" : "VISIT_DONE",
          agentTextNotes: item.agentNotes || "",
          buyerFeedback: item.buyerFeedback || "",
          buyerInterestLevel:
            item.buyerInterest === "High"
              ? "HIGH"
              : item.buyerInterest === "Medium"
              ? "MEDIUM"
              : item.buyerInterest === "Low"
              ? "LOW"
              : item.buyerInterest === "Not Interested"
              ? "NOT_INTERESTED"
              : "",
          voiceNoteUrl: "",
        };
      }
    }
    return initial;
  });

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => setToastMessage(null), 5000);
  };

  // Error screen render
  if (initialError || !visit) {
    const err = initialError || {
      type: "NOT_FOUND",
      message: "This site visit link is invalid or has expired.",
    };

    const errorDetails = {
      EXPIRED: {
        title: "Site Visit Link Expired",
        desc: "For security and client confidentiality, itinerary links expire 24 hours after the scheduled visit window (DEC-M1-05).",
        icon: "⏳",
        badge: "Link Expired",
      },
      REVOKED: {
        title: "Access Link Revoked",
        desc: "This itinerary access link has been revoked (e.g., following visit rescheduling, sales agent reassignment, or coordinator update).",
        icon: "🔒",
        badge: "Link Revoked",
      },
      COMPLETED: {
        title: "Site Visit Finalized",
        desc: "This site visit has been reviewed and finalized by the telecaller. All access links for this visit are now closed.",
        icon: "✓",
        badge: "Visit Finalized",
      },
      CANCELLED: {
        title: "Site Visit Cancelled",
        desc: "This site visit tour was cancelled by the coordinator or property owner.",
        icon: "🚫",
        badge: "Visit Cancelled",
      },
      NOT_FOUND: {
        title: "Invalid Itinerary Link",
        desc: "The access link you opened is invalid, malformed, or does not exist.",
        icon: "⚠️",
        badge: "Invalid Token",
      },
    }[err.type] || {
      title: "Unable to Load Itinerary",
      desc: err.message,
      icon: "⚠️",
      badge: "Access Denied",
    };

    return (
      <main className="min-h-screen bg-[#F7F5F0] text-[#1E2A32] flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-white border border-[#E4DFD5] rounded-xl p-6 shadow-sm text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-[#F7F5F0] border border-[#E4DFD5] flex items-center justify-center text-2xl mb-4">
            {errorDetails.icon}
          </div>
          <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#B3261E]/10 text-[#B3261E] mb-2">
            {errorDetails.badge}
          </span>
          <h1 className="text-xl font-bold text-[#1E2A32] mb-2">{errorDetails.title}</h1>
          <p className="text-xs text-[#667085] mb-6 leading-relaxed">{errorDetails.desc}</p>
          <div className="p-3 bg-[#F7F5F0] rounded-lg border border-[#E4DFD5] text-left">
            <h4 className="text-xs font-semibold text-[#1E2A32] mb-1">What should you do?</h4>
            <p className="text-xs text-[#667085] leading-relaxed">
              Please call your brokerage calling coordinator or manager to request a freshly issued mobile link.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const isCompleted = visit.status === "Completed";
  const isCancelled = visit.status === "Cancelled";

  const handleOutcomeSubmit = async (itemId: string) => {
    const form = outcomeFormState[itemId];
    if (!form) return;

    setSubmittingItemId(itemId);
    try {
      const res = await submitMobileVisitOutcomeAction(rawToken, itemId, {
        status: form.status,
        agentTextNotes: form.agentTextNotes,
        buyerFeedback: form.buyerFeedback,
        buyerInterestLevel: (form.buyerInterestLevel || undefined) as
          | "HIGH"
          | "MEDIUM"
          | "LOW"
          | "NOT_INTERESTED"
          | undefined,
        voiceNoteUrl: form.voiceNoteUrl || undefined,
      });

      if (res.success && res.visit) {
        setVisit(res.visit);
        showToast("Outcome recorded successfully!", "success");
      } else {
        showToast(res.error || "Failed to record outcome.", "error");
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to submit outcome.", "error");
    } finally {
      setSubmittingItemId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F5F0] text-[#1E2A32] pb-12 font-sans antialiased">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-4 left-4 right-4 z-50 p-3 rounded-lg shadow-md text-xs font-semibold text-center border transition-all ${
            toastType === "success"
              ? "bg-[#2E7D4F] text-white border-[#2E7D4F]"
              : "bg-[#B3261E] text-white border-[#B3261E]"
          }`}
        >
          {toastMessage}
        </div>
      )}

      {/* Mobile App Header */}
      <header className="bg-white border-b border-[#E4DFD5] px-4 py-3 sticky top-0 z-30 shadow-xs">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#1F6F6B]">
              {tenantName}
            </div>
            <h1 className="text-base font-bold text-[#1E2A32]">Site Visit Itinerary</h1>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
              visit.status === "Confirmed"
                ? "bg-[#2E7D4F]/10 text-[#2E7D4F] border-[#2E7D4F]/20"
                : visit.status === "Completed"
                ? "bg-[#3B5BA9]/10 text-[#3B5BA9] border-[#3B5BA9]/20"
                : visit.status === "Cancelled"
                ? "bg-[#B3261E]/10 text-[#B3261E] border-[#B3261E]/20"
                : "bg-[#B7791F]/10 text-[#B7791F] border-[#B7791F]/20"
            }`}
          >
            {visit.status}
          </span>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Notice for Completed / Cancelled visits */}
        {isCompleted && (
          <div className="p-3 bg-[#3B5BA9]/10 border border-[#3B5BA9]/30 rounded-lg text-xs text-[#3B5BA9]">
            <strong>Visit Finalized:</strong> This site visit has been reviewed and finalized by the telecaller. All outcomes are locked in read-only mode.
          </div>
        )}
        {isCancelled && (
          <div className="p-3 bg-[#B3261E]/10 border border-[#B3261E]/30 rounded-lg text-xs text-[#B3261E]">
            <strong>Visit Cancelled:</strong> This visit tour was cancelled: {visit.cancellationReason || "No reason specified"}.
          </div>
        )}

        {/* Schedule & Agent Metadata Card */}
        <section className="bg-white border border-[#E4DFD5] rounded-xl p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between border-b border-[#E4DFD5] pb-2">
            <div>
              <span className="text-[11px] font-semibold text-[#667085] uppercase">Scheduled For</span>
              <div className="text-sm font-bold text-[#1E2A32]">
                📅 {visit.scheduledDate} at {visit.timeSlot}
              </div>
            </div>
            {salesAgentName && (
              <div className="text-right">
                <span className="text-[11px] font-semibold text-[#667085] uppercase">Field Agent</span>
                <div className="text-xs font-semibold text-[#1F6F6B]">👤 {salesAgentName}</div>
              </div>
            )}
          </div>
          {expiresAt && (
            <div className="text-[11px] text-[#667085] flex items-center justify-between pt-1">
              <span>Token Validity: 24h post-visit</span>
              <span className="font-mono text-[10px]">
                Expires: {new Date(expiresAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          )}
        </section>

        {/* Prospect / Buyer Information Card */}
        <section className="bg-white border border-[#E4DFD5] rounded-xl p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#667085]">
              Buyer / Client Contact
            </h2>
            <span className="text-xs text-[#1F6F6B] font-semibold">Primary Lead</span>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-[#1E2A32]">{visit.buyerName}</div>
              <div className="text-xs text-[#667085] font-mono">{visit.buyerPhone}</div>
              {visit.buyerEmail && (
                <div className="text-[11px] text-[#3B5BA9]">{visit.buyerEmail}</div>
              )}
            </div>
            <a
              href={`tel:${visit.buyerPhone}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2E7D4F] text-white text-xs font-semibold hover:bg-[#256640] transition-colors shadow-2xs"
            >
              <span>📞</span> Call Buyer
            </a>
          </div>

          {visit.buyerAlternatePhone && (
            <div className="flex items-center justify-between pt-2 border-t border-[#E4DFD5]">
              <span className="text-xs text-[#667085]">Alternate Contact:</span>
              <a
                href={`tel:${visit.buyerAlternatePhone}`}
                className="text-xs font-semibold text-[#3B5BA9] hover:underline"
              >
                📞 {visit.buyerAlternatePhone}
              </a>
            </div>
          )}

          {visit.notes && (
            <div className="p-2.5 bg-[#F7F5F0] rounded-lg border border-[#E4DFD5] text-xs text-[#1E2A32]">
              <span className="font-semibold text-[#667085] block text-[10px] uppercase">Coordinator Notes:</span>
              {visit.notes}
            </div>
          )}
        </section>

        {/* Ordered Multi-Property Itinerary */}
        <section className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#667085]">
              Property Stops ({visit.items.length})
            </h2>
            <span className="text-[11px] text-[#667085]">Follow itinerary order</span>
          </div>

          {visit.items.map((item: SiteVisitItem, idx: number) => {
            const form = outcomeFormState[item.id] || {
              status: item.status === "Visit Not Done" ? "VISIT_NOT_DONE" : "VISIT_DONE",
              agentTextNotes: item.agentNotes || "",
              buyerFeedback: item.buyerFeedback || "",
              buyerInterestLevel:
                item.buyerInterest === "High"
                  ? "HIGH"
                  : item.buyerInterest === "Medium"
                  ? "MEDIUM"
                  : item.buyerInterest === "Low"
                  ? "LOW"
                  : item.buyerInterest === "Not Interested"
                  ? "NOT_INTERESTED"
                  : "",
              voiceNoteUrl: "",
            };

            const isItemSaving = submittingItemId === item.id;

            return (
              <article
                key={item.id}
                className="bg-white border border-[#E4DFD5] rounded-xl overflow-hidden shadow-2xs"
              >
                {/* Stop Header Banner */}
                <div className="bg-[#1F6F6B]/5 border-b border-[#E4DFD5] px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[#1F6F6B] text-white text-xs font-bold flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-bold text-[#1F6F6B]">
                      Stop #{idx + 1}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      item.status === "Visit Done"
                        ? "bg-[#2E7D4F]/10 text-[#2E7D4F] border-[#2E7D4F]/20"
                        : item.status === "Visit Not Done"
                        ? "bg-[#B3261E]/10 text-[#B3261E] border-[#B3261E]/20"
                        : "bg-[#B7791F]/10 text-[#B7791F] border-[#B7791F]/20"
                    }`}
                  >
                    {item.status}
                  </span>
                </div>

                <div className="p-4 space-y-3.5">
                  {/* Property Title & Address */}
                  <div>
                    <h3 className="text-sm font-bold text-[#1E2A32]">{item.propertyTitle}</h3>
                    <div className="text-xs text-[#1F6F6B] font-semibold mt-0.5">
                      📍 Unit / Flat {item.flatNumber}, {item.locality}, {item.city}
                    </div>
                  </div>

                  {/* Specifications Grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs bg-[#F7F5F0] p-2.5 rounded-lg border border-[#E4DFD5]">
                    {item.priceFormatted && (
                      <div>
                        <span className="text-[10px] text-[#667085] block">Price</span>
                        <span className="font-bold text-[#1E2A32]">{item.priceFormatted}</span>
                      </div>
                    )}
                    {item.area && (
                      <div>
                        <span className="text-[10px] text-[#667085] block">Area</span>
                        <span className="font-semibold text-[#1E2A32]">
                          {item.area} {item.areaType || "sq.ft"}
                        </span>
                      </div>
                    )}
                    {item.propertyType && (
                      <div>
                        <span className="text-[10px] text-[#667085] block">Type</span>
                        <span className="text-[#1E2A32]">{item.propertyType}</span>
                      </div>
                    )}
                    {item.furnishingStatus && (
                      <div>
                        <span className="text-[10px] text-[#667085] block">Furnishing</span>
                        <span className="text-[#1E2A32]">{item.furnishingStatus}</span>
                      </div>
                    )}
                  </div>

                  {/* Photos Carousel / Grid */}
                  {item.photos && item.photos.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-semibold text-[#667085]">
                        Property Photos ({item.photos.length})
                      </span>
                      <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-thin">
                        {item.photos.map((photo) => (
                          <div
                            key={photo.id}
                            className="w-28 h-20 shrink-0 rounded-lg overflow-hidden border border-[#E4DFD5] bg-[#F7F5F0] relative"
                          >
                            <img
                              src={photo.url}
                              alt={photo.caption || "Property view"}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                            {photo.caption && (
                              <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] px-1 py-0.5 truncate">
                                {photo.caption}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Owner & Key-Holder Contact Section (Field Agent Authorized) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-[#E4DFD5]">
                    {/* Owner Card */}
                    <div className="p-2.5 bg-white border border-[#E4DFD5] rounded-lg space-y-1">
                      <div className="text-[10px] font-bold text-[#667085] uppercase">Property Owner</div>
                      <div className="text-xs font-bold text-[#1E2A32] truncate">{item.ownerName}</div>
                      <a
                        href={`tel:${item.ownerMobile}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#1F6F6B] hover:underline"
                      >
                        <span>📞</span> {item.ownerMobile}
                      </a>
                    </div>

                    {/* Keyholder Card */}
                    <div className="p-2.5 bg-white border border-[#E4DFD5] rounded-lg space-y-1">
                      <div className="text-[10px] font-bold text-[#667085] uppercase">
                        Key Custodian ({item.keyHolder.persona})
                      </div>
                      <div className="text-xs font-bold text-[#1E2A32] truncate">
                        {item.keyHolder.name}
                      </div>
                      {item.keyHolder.mobile && item.keyHolder.mobile !== "-" ? (
                        <a
                          href={`tel:${item.keyHolder.mobile}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#1F6F6B] hover:underline"
                        >
                          <span>🔑</span> {item.keyHolder.mobile}
                        </a>
                      ) : (
                        <span className="text-xs text-[#667085]">No phone registered</span>
                      )}
                      {item.keyHolder.notes && (
                        <div className="text-[10px] text-[#667085] italic truncate">
                          {item.keyHolder.notes}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Per-Stop Outcome Recording Form */}
                  {!isCompleted && !isCancelled ? (
                    <div className="pt-3 border-t border-[#E4DFD5] space-y-3">
                      <div className="text-xs font-bold text-[#1E2A32] flex items-center justify-between">
                        <span>Record Showing Outcome</span>
                        {item.reportedAt && (
                          <span className="text-[10px] font-normal text-[#667085]">
                            Last updated: {item.reportedAt}
                          </span>
                        )}
                      </div>

                      {/* Outcome Selection Buttons */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setOutcomeFormState((prev) => ({
                              ...prev,
                              [item.id]: { ...form, status: "VISIT_DONE" },
                            }))
                          }
                          className={`py-2 px-3 rounded-lg text-xs font-bold border flex items-center justify-center gap-1.5 transition-colors ${
                            form.status === "VISIT_DONE"
                              ? "bg-[#2E7D4F] text-white border-[#2E7D4F] shadow-xs"
                              : "bg-white text-[#2E7D4F] border-[#E4DFD5] hover:bg-[#2E7D4F]/5"
                          }`}
                        >
                          <span>✓</span> Visit Done
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setOutcomeFormState((prev) => ({
                              ...prev,
                              [item.id]: { ...form, status: "VISIT_NOT_DONE" },
                            }))
                          }
                          className={`py-2 px-3 rounded-lg text-xs font-bold border flex items-center justify-center gap-1.5 transition-colors ${
                            form.status === "VISIT_NOT_DONE"
                              ? "bg-[#B3261E] text-white border-[#B3261E] shadow-xs"
                              : "bg-white text-[#B3261E] border-[#E4DFD5] hover:bg-[#B3261E]/5"
                          }`}
                        >
                          <span>✕</span> Visit Not Done
                        </button>
                      </div>

                      {/* Buyer Interest Rating */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-[#667085] block">
                          Buyer Interest Level
                        </label>
                        <div className="grid grid-cols-4 gap-1">
                          {(["HIGH", "MEDIUM", "LOW", "NOT_INTERESTED"] as const).map((lvl) => (
                            <button
                              key={lvl}
                              type="button"
                              onClick={() =>
                                setOutcomeFormState((prev) => ({
                                  ...prev,
                                  [item.id]: { ...form, buyerInterestLevel: lvl },
                                }))
                              }
                              className={`py-1.5 px-1 rounded-md text-[10px] font-bold border text-center transition-colors ${
                                form.buyerInterestLevel === lvl
                                  ? lvl === "HIGH"
                                    ? "bg-[#2E7D4F] text-white border-[#2E7D4F]"
                                    : lvl === "MEDIUM"
                                    ? "bg-[#3B5BA9] text-white border-[#3B5BA9]"
                                    : lvl === "LOW"
                                    ? "bg-[#B7791F] text-white border-[#B7791F]"
                                    : "bg-[#B3261E] text-white border-[#B3261E]"
                                  : "bg-white text-[#667085] border-[#E4DFD5] hover:bg-[#F7F5F0]"
                              }`}
                            >
                              {lvl === "NOT_INTERESTED" ? "Not Int." : lvl}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Agent Field Notes */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-[#667085] block">
                          Field Agent Showing Notes
                        </label>
                        <textarea
                          rows={2}
                          value={form.agentTextNotes}
                          onChange={(e) =>
                            setOutcomeFormState((prev) => ({
                              ...prev,
                              [item.id]: { ...form, agentTextNotes: e.target.value },
                            }))
                          }
                          placeholder="e.g. Unit layout liked, requested floor plan, key was with guard..."
                          className="w-full text-xs p-2.5 rounded-lg border border-[#E4DFD5] bg-white text-[#1E2A32] focus:outline-hidden focus:border-[#1F6F6B] placeholder-[#667085]/60"
                        />
                      </div>

                      {/* Buyer Feedback */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-[#667085] block">
                          Customer Direct Feedback
                        </label>
                        <textarea
                          rows={2}
                          value={form.buyerFeedback}
                          onChange={(e) =>
                            setOutcomeFormState((prev) => ({
                              ...prev,
                              [item.id]: { ...form, buyerFeedback: e.target.value },
                            }))
                          }
                          placeholder="e.g. Price negotiable? Willing to make offer next week..."
                          className="w-full text-xs p-2.5 rounded-lg border border-[#E4DFD5] bg-white text-[#1E2A32] focus:outline-hidden focus:border-[#1F6F6B] placeholder-[#667085]/60"
                        />
                      </div>

                      {/* Submit Action Button */}
                      <button
                        type="button"
                        disabled={isItemSaving}
                        onClick={() => handleOutcomeSubmit(item.id)}
                        className="w-full py-2.5 rounded-lg bg-[#1F6F6B] text-white text-xs font-bold hover:bg-[#185855] disabled:opacity-50 transition-colors shadow-xs flex items-center justify-center gap-2"
                      >
                        {isItemSaving ? (
                          <>
                            <span className="animate-spin text-sm">⏳</span> Saving Outcome...
                          </>
                        ) : (
                          <>Save Outcome for Stop #{idx + 1}</>
                        )}
                      </button>
                    </div>
                  ) : (
                    // Read-only outcome presentation when completed/cancelled
                    <div className="pt-2 border-t border-[#E4DFD5] text-xs space-y-1.5 bg-[#F7F5F0] p-2.5 rounded-lg">
                      <div className="font-semibold text-[#1E2A32]">
                        Recorded Outcome: {item.status}
                      </div>
                      {item.buyerInterest && (
                        <div className="text-[#667085]">
                          Interest Level: <strong>{item.buyerInterest}</strong>
                        </div>
                      )}
                      {item.agentNotes && (
                        <div className="text-[#667085]">
                          Agent Notes: <em>{item.agentNotes}</em>
                        </div>
                      )}
                      {item.buyerFeedback && (
                        <div className="text-[#667085]">
                          Buyer Feedback: <em>{item.buyerFeedback}</em>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
