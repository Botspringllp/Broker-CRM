"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Toast } from "@/components/ui/Toast";
import { Property } from "@/types/crm";
import { logPropertyCallAction } from "@/app/supply/actions";

interface CallWorkspaceClientProps {
  property: Property;
  currentUserRole?: string;
  currentUserName?: string;
}

type CallingDispositionValue =
  | "PROPERTY_AVAILABLE"
  | "CALL_BACK"
  | "TEMPORARILY_UNAVAILABLE"
  | "OWNER_DECLINES_MANDATE"
  | "PROPERTY_SOLD_OR_RENTED"
  | "RINGING_OR_NOT_ANSWERING";

const DISPOSITION_OPTIONS: {
  value: CallingDispositionValue;
  label: string;
  description: string;
  badgeColor: string;
}[] = [
  {
    value: "PROPERTY_AVAILABLE",
    label: "Property Available",
    description: "Owner confirms unit is active and on the secondary market.",
    badgeColor: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  {
    value: "CALL_BACK",
    label: "Call Back Requested",
    description: "Owner is busy, driving, or requested a scheduled callback.",
    badgeColor: "bg-blue-50 text-blue-800 border-blue-200",
  },
  {
    value: "TEMPORARILY_UNAVAILABLE",
    label: "Temporarily Unavailable",
    description: "Renovation, tenant vacating delay, or owner traveling.",
    badgeColor: "bg-amber-50 text-amber-800 border-amber-200",
  },
  {
    value: "OWNER_DECLINES_MANDATE",
    label: "Owner Declines Mandate",
    description: "Refuses broker representation or not interested in listing.",
    badgeColor: "bg-rose-50 text-rose-800 border-rose-200",
  },
  {
    value: "PROPERTY_SOLD_OR_RENTED",
    label: "Sold / Rented Externally",
    description: "Deal closed through another source or owner personal network.",
    badgeColor: "bg-stone-100 text-stone-800 border-stone-300",
  },
  {
    value: "RINGING_OR_NOT_ANSWERING",
    label: "Ringing / Not Answering",
    description: "No answer after multiple rings, busy, or switched off.",
    badgeColor: "bg-orange-50 text-orange-800 border-orange-200",
  },
];

export function CallWorkspaceClient({
  property: initialProperty,
  currentUserRole,
  currentUserName,
}: CallWorkspaceClientProps) {
  const router = useRouter();

  // Local property state (refreshed when call is logged)
  const [property, setProperty] = useState<Property>(initialProperty);

  // Form State
  const [disposition, setDisposition] = useState<CallingDispositionValue>("PROPERTY_AVAILABLE");
  const [callbackDate, setCallbackDate] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmOwnerWillingness, setConfirmOwnerWillingness] = useState(false);

  // Submission & Feedback State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Unsaved changes tracking
  const hasUnsavedChanges = Boolean(notes.trim() || callbackDate || confirmOwnerWillingness);

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
    if (!property.ownerMobile) return;
    navigator.clipboard.writeText(property.ownerMobile);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessBanner(null);

    // Field-level validation
    if (disposition === "CALL_BACK") {
      if (!callbackDate) {
        setErrorMessage("A scheduled callback date and time is mandatory when disposition is 'Call Back Requested'.");
        return;
      }
      const cbTime = new Date(callbackDate).getTime();
      if (isNaN(cbTime)) {
        setErrorMessage("Please provide a valid callback date and time.");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const res = await logPropertyCallAction({
        propertyId: property.id,
        disposition,
        notes: notes.trim() || undefined,
        callbackScheduledAt: callbackDate ? new Date(callbackDate).toISOString() : undefined,
        confirmOwnerWillingness: disposition === "PROPERTY_AVAILABLE" ? confirmOwnerWillingness : false,
      });

      if (!res.success) {
        setErrorMessage(res.error || "Failed to log call outcome.");
        setIsSubmitting(false);
        return;
      }

      if (res.property) {
        setProperty(res.property);
      }

      // Success notification & form reset
      const outcomeText =
        disposition === "PROPERTY_AVAILABLE" && confirmOwnerWillingness
          ? "Owner willingness confirmed! Property marked as Validated and Active Supply eligible."
          : `Call outcome '${disposition.replace(/_/g, " ")}' recorded successfully.`;

      setSuccessBanner(outcomeText);
      setToastMessage("Call outcome recorded and persisted.");
      setNotes("");
      setCallbackDate("");
      setConfirmOwnerWillingness(false);
      router.refresh();
    } catch (err: unknown) {
      setErrorMessage((err as Error)?.message || "An unexpected error occurred while logging call.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell
      activePage="supply"
      userRole={currentUserRole}
      userName={currentUserName}
    >
      <div className="max-w-7xl mx-auto space-y-6 pb-12">
        {/* Top Breadcrumb Navigation */}
        <nav className="flex items-center gap-2 text-xs text-crm-muted">
          <Link href="/supply" className="hover:text-crm-primary transition-colors">
            Supply Validation
          </Link>
          <span>/</span>
          <Link href={`/supply/${property.id}`} className="hover:text-crm-primary transition-colors">
            {property.societyName} ({property.flatNumber})
          </Link>
          <span>/</span>
          <span className="font-semibold text-crm-text">Dedicated Call Workspace</span>
        </nav>

        {/* Top Header Card */}
        <div className="p-6 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="px-2.5 py-1 text-xs font-bold rounded-md bg-stone-100 text-crm-text border border-crm-border">
                  Unit #{property.flatNumber}
                </span>
                <h1 className="text-xl font-bold text-crm-text">
                  {property.societyName}
                </h1>
                <StatusBadge status={property.preference} />
                <StatusBadge status={property.validationStatus} />
                <StatusBadge status={property.availabilityStatus} />
                {property.isActiveSupply ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                    ✓ In Active Supply Pool
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                    ⚠️ Outside Active Pool
                  </span>
                )}
                {property.isFieldVerified && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-bold bg-teal-50 text-teal-800 border border-teal-200">
                    ✓ Field Verified
                  </span>
                )}
              </div>
              <p className="text-xs text-crm-muted mt-1">
                {property.locality}, {property.city} • Dedicated telecaller workspace for mandate validation and availability re-verification.
              </p>
            </div>

            {/* Quick Navigation Buttons */}
            <div className="flex items-center gap-2">
              <Link
                href={`/supply/${property.id}`}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-md bg-stone-100 hover:bg-stone-200 text-crm-text border border-crm-border transition-colors shadow-2xs"
              >
                ← Back to Details
              </Link>
              <Link
                href="/supply"
                className="px-3.5 py-1.5 text-xs font-semibold rounded-md bg-white hover:bg-stone-50 text-crm-text border border-crm-border transition-colors shadow-2xs"
              >
                Supply Queue
              </Link>
            </div>
          </div>
        </div>

        {/* Global Notifications */}
        {errorMessage && (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold">Error:</span>
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-red-700 hover:text-red-900 font-bold px-2"
            >
              ✕
            </button>
          </div>
        )}

        {successBanner && (
          <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="font-bold">✓ Success:</span>
              <span>{successBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              className="text-emerald-800 hover:text-emerald-950 font-bold px-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Main 2-Column Responsive Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT COLUMN: Property Summary, Owner Contact, Persistent Call History (5 Cols) */}
          <div className="lg:col-span-5 space-y-6">
            {/* Section A: Property Summary Card */}
            <div className="p-5 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-4">
              <div className="flex items-center justify-between border-b border-crm-border pb-2">
                <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider flex items-center gap-1.5">
                  <span>🏢</span>
                  <span>Property Summary</span>
                </h2>
                <span className="text-[11px] font-mono text-crm-muted">ID: {property.id.slice(0, 8)}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-crm-muted block text-[11px]">Price / Asking Rent</span>
                  <strong className="text-sm font-bold text-crm-primary block">
                    {property.priceFormatted}
                  </strong>
                </div>

                <div>
                  <span className="text-crm-muted block text-[11px]">Typology & Config</span>
                  <span className="font-semibold text-crm-text block">
                    {property.bedroomCount} BHK {property.propertyType}
                  </span>
                </div>

                <div>
                  <span className="text-crm-muted block text-[11px]">Area & Unit</span>
                  <span className="font-medium text-crm-text block">
                    {property.area.toLocaleString()} sq.ft ({property.areaType})
                  </span>
                </div>

                <div>
                  <span className="text-crm-muted block text-[11px]">Furnishing</span>
                  <span className="font-medium text-crm-text block">
                    {property.furnishingStatus}
                  </span>
                </div>

                <div>
                  <span className="text-crm-muted block text-[11px]">Baths & Balconies</span>
                  <span className="font-medium text-crm-text block">
                    {property.bathroomCount} Baths • {property.balconyCount} Balconies
                  </span>
                </div>

                <div>
                  <span className="text-crm-muted block text-[11px]">Construction</span>
                  <span className="font-medium text-crm-text block">
                    {property.constructionStatus}
                  </span>
                </div>

                <div className="col-span-2 pt-2 border-t border-crm-border/60">
                  <span className="text-crm-muted block text-[11px]">Location</span>
                  <span className="font-medium text-crm-text block">
                    Unit #{property.flatNumber}, {property.societyName}, {property.locality}, {property.city}
                  </span>
                </div>
              </div>
            </div>

            {/* Section B: Owner & Key Custodian Contact Card */}
            <div className="p-5 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-4">
              <div className="flex items-center justify-between border-b border-crm-border pb-2">
                <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider flex items-center gap-1.5">
                  <span>👤</span>
                  <span>Owner & Custodian Contact</span>
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-stone-100 text-crm-muted border border-crm-border">
                  Private CRM View
                </span>
              </div>

              {/* Owner Direct Dialing Box */}
              <div className="p-4 rounded-md bg-stone-50 border border-crm-border space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-crm-muted block">Property Owner</span>
                    <strong className="text-base text-crm-text block">{property.ownerName}</strong>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm font-mono font-semibold text-crm-primary">
                        {property.ownerMobile}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyPhone}
                        className="text-[11px] text-crm-muted hover:text-crm-text underline"
                        title="Copy phone number"
                      >
                        {copiedPhone ? "✓ Copied" : "Copy"}
                      </button>
                    </div>
                  </div>

                  {/* Click to Call link (opens device phone dialer / tel: link) */}
                  <a
                    href={`tel:${property.ownerMobile}`}
                    className="px-3 py-1.5 text-xs font-bold rounded-md bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs inline-flex items-center gap-1.5"
                    title="Open device dialer for owner phone"
                  >
                    <span>📞</span>
                    <span>Call Owner</span>
                  </a>
                </div>

                <div className="pt-2 border-t border-crm-border/60 flex items-center justify-between text-xs">
                  <span className="text-crm-muted">Owner Mandate Willingness:</span>
                  <span
                    className={`font-bold ${
                      property.ownerWillingnessConfirmed ? "text-emerald-700" : "text-amber-700"
                    }`}
                  >
                    {property.ownerWillingnessConfirmed ? "✓ Confirmed" : "Pending Confirmation"}
                  </span>
                </div>

                <p className="text-[10px] text-crm-muted italic leading-relaxed">
                  Note: Telephony relies on standard device protocols (tel: handler). Owner number is strictly masked from buyers and unauthenticated matching views.
                </p>
              </div>

              {/* Key Custodian */}
              {property.keyHolder && property.keyHolder.name && property.keyHolder.name !== "Not assigned" && (
                <div className="p-3.5 rounded-md bg-stone-50/60 border border-crm-border space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-crm-muted">
                      Key Custodian ({property.keyHolder.persona})
                    </span>
                    {property.keyHolder.mobile && property.keyHolder.mobile !== "-" && (
                      <a
                        href={`tel:${property.keyHolder.mobile}`}
                        className="text-[11px] text-crm-primary hover:underline font-semibold"
                      >
                        Call Custodian 📞
                      </a>
                    )}
                  </div>
                  <div className="font-semibold text-crm-text">{property.keyHolder.name}</div>
                  <div className="text-crm-muted font-mono">{property.keyHolder.mobile}</div>
                  {property.keyHolder.notes && (
                    <p className="text-[11px] text-crm-muted italic pt-1 border-t border-crm-border/40">
                      &quot;{property.keyHolder.notes}&quot;
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Section C: Persistent Call History Timeline */}
            <div className="p-5 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b border-crm-border pb-2">
                <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider flex items-center gap-1.5">
                  <span>📜</span>
                  <span>Call History Timeline ({property.callHistory.length})</span>
                </h2>
                <span className="text-[10px] text-crm-muted">Chronological</span>
              </div>

              {property.callHistory.length === 0 ? (
                <div className="py-6 text-center text-crm-muted text-xs italic bg-stone-50 rounded border border-dashed border-crm-border">
                  No prior call records found for this property. Submit the outcome form on the right to log your first call.
                </div>
              ) : (
                <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                  {property.callHistory.map((call) => (
                    <div
                      key={call.id}
                      className="p-3 rounded-md border border-crm-border bg-stone-50/60 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-crm-text flex items-center gap-1">
                          <span>👤</span>
                          <span>{call.callerName}</span>
                        </span>
                        <span className="text-[11px] text-crm-muted">{call.calledAt}</span>
                      </div>

                      <div>
                        <StatusBadge status={call.disposition} />
                      </div>

                      {call.notes && (
                        <p className="text-crm-text text-xs bg-white p-2.5 rounded border border-crm-border leading-relaxed">
                          {call.notes}
                        </p>
                      )}

                      {call.callbackDate && (
                        <div className="p-2 rounded bg-amber-50 border border-amber-200 text-amber-900 font-semibold text-[11px] flex items-center gap-1.5">
                          <span>⏰</span>
                          <span>Callback Scheduled: {call.callbackDate}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Log Call Outcome Form (Section D & E) (7 Cols) */}
          <div className="lg:col-span-7 space-y-6">
            <div className="p-6 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-5">
              <div className="border-b border-crm-border pb-3">
                <h2 className="text-base font-bold text-crm-text flex items-center gap-2">
                  <span>📝</span>
                  <span>Record Owner Call Outcome</span>
                </h2>
                <p className="text-xs text-crm-muted mt-0.5">
                  Select the exact conversation outcome. Properties require owner willingness confirmation and availability verification before entering the Active Supply Pool.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* 1. Disposition Selector Grid */}
                <div className="space-y-2.5">
                  <label className="block text-xs font-bold text-crm-text uppercase tracking-wider">
                    Select Call Disposition *
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {DISPOSITION_OPTIONS.map((item) => {
                      const isSelected = disposition === item.value;
                      return (
                        <label
                          key={item.value}
                          className={`p-3 rounded-lg border text-xs cursor-pointer select-none transition-all flex flex-col justify-between ${
                            isSelected
                              ? "bg-teal-50/70 border-crm-primary ring-1 ring-crm-primary/30 shadow-2xs"
                              : "bg-white border-crm-border hover:bg-stone-50"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="callDisposition"
                              value={item.value}
                              checked={isSelected}
                              onChange={() => setDisposition(item.value)}
                              className="text-crm-primary focus:ring-crm-primary"
                            />
                            <strong className="text-crm-text font-bold">{item.label}</strong>
                          </div>
                          <p className="text-[11px] text-crm-muted mt-1.5 pl-5 leading-normal">
                            {item.description}
                          </p>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Mandatory Scheduled Callback if CALL_BACK */}
                {disposition === "CALL_BACK" && (
                  <div className="p-4 rounded-lg bg-blue-50/80 border border-blue-200 space-y-2">
                    <label className="block text-xs font-bold text-blue-900 flex items-center gap-1.5">
                      <span>⏰</span>
                      <span>Scheduled Callback Date & Time *</span>
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={callbackDate}
                      onChange={(e) => setCallbackDate(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-md border border-blue-300 bg-white focus:outline-hidden focus:border-crm-primary font-medium"
                    />
                    <p className="text-[11px] text-blue-800 leading-normal">
                      Specifying a scheduled callback date ensures this property appears in the telecaller callback alert queue on the designated day.
                    </p>
                  </div>
                )}

                {/* 3. Section E: Owner Willingness & Active Supply Rule */}
                {disposition === "PROPERTY_AVAILABLE" && (
                  <div className="p-4 rounded-lg bg-teal-50/70 border border-teal-200 space-y-2">
                    <div className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        id="confirmWillingness"
                        checked={confirmOwnerWillingness}
                        onChange={(e) => setConfirmOwnerWillingness(e.target.checked)}
                        className="mt-0.5 rounded border-teal-400 text-crm-primary focus:ring-crm-primary"
                      />
                      <label
                        htmlFor="confirmWillingness"
                        className="text-xs font-bold text-teal-950 cursor-pointer"
                      >
                        Owner Confirms Broker Mandate Willingness (Active Supply Qualification)
                      </label>
                    </div>

                    <p className="text-[11px] text-teal-800 pl-6 leading-relaxed">
                      <strong>PRD Compliance Rule:</strong> A property cannot enter the <em>Active Supply Pool</em> simply because the owner answered. Checking this box confirms that the owner explicitly agreed to allow your brokerage to market the property and bring prospective buyers for physical site visits.
                    </p>

                    <div className="pl-6 text-[11px] text-crm-muted">
                      {confirmOwnerWillingness ? (
                        <span className="font-semibold text-emerald-700">
                          ✓ Result: Validation Status will change to <strong>Validated</strong> and property will become eligible for buyer matching in the Active Supply Pool.
                        </span>
                      ) : (
                        <span className="font-semibold text-amber-700">
                          ⚠️ Result: Property remains <strong>In Validation</strong> until explicit mandate willingness is established.
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* 4. Dispositions notes / remarks */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-crm-text uppercase tracking-wider">
                    Call Conversation Notes & Key Insights
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Document owner expectations, negotiation room, preferred visiting times, key location, or tenant conditions..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary leading-relaxed"
                  />
                  <p className="text-[11px] text-crm-muted">
                    Notes will be appended to the permanent audit trail for this property and accessible to Team Leaders and Broker Owners.
                  </p>
                </div>

                {/* Form Footer / Submit Buttons */}
                <div className="pt-4 border-t border-crm-border flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (hasUnsavedChanges) {
                        if (!confirm("Discard unsaved call outcome notes?")) return;
                      }
                      setNotes("");
                      setCallbackDate("");
                      setConfirmOwnerWillingness(false);
                      setErrorMessage(null);
                    }}
                    disabled={isSubmitting}
                    className="px-4 py-2 text-xs font-semibold rounded-md bg-stone-100 hover:bg-stone-200 text-crm-text border border-crm-border transition-colors shadow-2xs"
                  >
                    Reset Form
                  </button>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-6 py-2 text-xs font-bold rounded-md bg-crm-primary text-white hover:bg-crm-primary-hover disabled:opacity-50 transition-colors shadow-2xs flex items-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Persisting Call Outcome...</span>
                      </>
                    ) : (
                      <span>Save Call Outcome 💾</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* Global Toast */}
        {toastMessage && (
          <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
        )}
      </div>
    </AppShell>
  );
}
