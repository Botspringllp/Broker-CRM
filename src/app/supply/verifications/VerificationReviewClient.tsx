"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { PropertyVerificationView } from "@/types/crm";
import { reviewVerificationReportAction } from "@/app/verifier/actions";

interface VerificationReviewClientProps {
  initialVerifications: PropertyVerificationView[];
  userName: string;
  userRole: string;
  currentUserId: string;
}

export function VerificationReviewClient({
  initialVerifications,
  userName,
  userRole,
  currentUserId,
}: VerificationReviewClientProps) {
  const [verifications, setVerifications] = useState<PropertyVerificationView[]>(initialVerifications);
  const [selectedVerification, setSelectedVerification] = useState<PropertyVerificationView | null>(
    initialVerifications.find((v) => v.status === "SUBMITTED") || initialVerifications[0] || null
  );
  const [activeTab, setActiveTab] = useState<string>("SUBMITTED");
  const [rejectionNotes, setRejectionNotes] = useState("");
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const filteredVerifications = useMemo(() => {
    return verifications.filter((v) => {
      if (activeTab === "ALL") return true;
      return v.status === activeTab;
    });
  }, [verifications, activeTab]);

  const stats = useMemo(() => {
    return {
      submitted: verifications.filter((v) => v.status === "SUBMITTED").length,
      approved: verifications.filter((v) => v.status === "APPROVED").length,
      unableToVerify: verifications.filter((v) => v.status === "UNABLE_TO_VERIFY").length,
      rejected: verifications.filter((v) => v.status === "REJECTED").length,
    };
  }, [verifications]);

  // Handle Approve
  const handleApprove = async () => {
    if (!selectedVerification) return;
    if (selectedVerification.verifierId === currentUserId) {
      setToastMessage({
        type: "error",
        text: "You cannot review or approve your own verification report.",
      });
      return;
    }

    setIsProcessing(true);
    setToastMessage(null);

    try {
      const res = await reviewVerificationReportAction({
        verificationId: selectedVerification.id,
        decision: "APPROVE",
        reviewNotes: "Approved by Team Leader.",
      });

      if (res.success) {
        setVerifications((prev) =>
          prev.map((v) => (v.id === res.verification.id ? res.verification : v))
        );
        setSelectedVerification(res.verification);
        setToastMessage({
          type: "success",
          text: `Verification approved! ${selectedVerification.societyName} is now marked as Field Verified.`,
        });
      }
    } catch (err: unknown) {
      setToastMessage({
        type: "error",
        text: (err as Error)?.message || "Failed to approve verification report.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Reject
  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVerification) return;
    if (!rejectionNotes.trim()) {
      setToastMessage({
        type: "error",
        text: "Please provide explanatory feedback for what needs re-verification.",
      });
      return;
    }

    setIsProcessing(true);
    setToastMessage(null);

    try {
      const res = await reviewVerificationReportAction({
        verificationId: selectedVerification.id,
        decision: "REJECT",
        reviewNotes: rejectionNotes.trim(),
      });

      if (res.success) {
        setVerifications((prev) =>
          prev.map((v) => (v.id === res.verification.id ? res.verification : v))
        );
        setSelectedVerification(res.verification);
        setRejectModalOpen(false);
        setRejectionNotes("");
        setToastMessage({
          type: "success",
          text: `Verification report returned for re-verification with instructions.`,
        });
      }
    } catch (err: unknown) {
      setToastMessage({
        type: "error",
        text: (err as Error)?.message || "Failed to reject verification report.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <AppShell activePage="Active Supply Pool" userName={userName} userRole={userRole} isAuthenticated={true}>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-crm-muted mb-1">
              <Link href="/supply/active" className="text-crm-primary hover:underline font-semibold">
                ← Active Supply Pool
              </Link>
              <span>/</span>
              <span>Field Verification Review Queue</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-crm-text">
              Field Verification Supervisory Review
            </h1>
            <p className="text-xs text-crm-muted mt-0.5">
              Review on-site inspector observations, checklist results, and photo evidence before granting the Field Verified badge.
            </p>
          </div>
        </div>

        {/* Toast */}
        {toastMessage && (
          <div
            className={`p-3 rounded-lg border text-xs font-semibold flex items-center justify-between ${
              toastMessage.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-rose-50 border-rose-200 text-rose-800"
            }`}
          >
            <span>{toastMessage.text}</span>
            <button onClick={() => setToastMessage(null)} className="ml-2 font-bold text-sm">
              ✕
            </button>
          </div>
        )}

        {/* Tab Filter Bar */}
        <div className="flex items-center gap-2 border-b border-crm-border pb-2 overflow-x-auto">
          {[
            { id: "SUBMITTED", label: `Pending Review (${stats.submitted})` },
            { id: "APPROVED", label: `Approved (${stats.approved})` },
            { id: "UNABLE_TO_VERIFY", label: `Unable to Verify (${stats.unableToVerify})` },
            { id: "REJECTED", label: `Re-verification (${stats.rejected})` },
            { id: "ALL", label: `All Reports (${verifications.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? "bg-crm-primary text-white shadow-2xs"
                  : "bg-white text-crm-text border border-crm-border hover:bg-stone-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Two Column Layout: List and Inspector */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* List Column */}
          <div className="lg:col-span-5 space-y-3">
            {filteredVerifications.length === 0 ? (
              <div className="bg-white rounded-lg border border-crm-border p-8 text-center text-crm-muted text-xs shadow-2xs">
                No verification reports found in this queue.
              </div>
            ) : (
              filteredVerifications.map((v) => {
                const isSelected = selectedVerification?.id === v.id;
                return (
                  <div
                    key={v.id}
                    onClick={() => setSelectedVerification(v)}
                    className={`bg-white rounded-lg border p-3.5 cursor-pointer transition-all shadow-2xs ${
                      isSelected
                        ? "border-crm-primary ring-2 ring-crm-primary/20 bg-teal-50/20"
                        : "border-crm-border hover:border-crm-primary/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold text-crm-muted uppercase tracking-wider block">
                          {v.propertyType} • {v.preference}
                        </span>
                        <h3 className="font-bold text-crm-text text-sm mt-0.5">{v.societyName}</h3>
                        <div className="text-xs text-crm-muted">
                          Unit: <strong className="text-crm-text">{v.flatNumber}</strong> | {v.locality}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                          v.status === "APPROVED"
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                            : v.status === "SUBMITTED"
                            ? "bg-purple-50 text-purple-800 border-purple-200"
                            : v.status === "UNABLE_TO_VERIFY"
                            ? "bg-stone-100 text-stone-700 border-stone-300"
                            : "bg-rose-50 text-rose-800 border-rose-200"
                        }`}
                      >
                        {v.status.replace(/_/g, " ")}
                      </span>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-crm-border/60 flex items-center justify-between text-[11px] text-crm-muted">
                      <span>
                        Verifier: <strong className="text-crm-text">{v.verifierName}</strong>
                      </span>
                      <span>
                        Photos: <strong>{v.media.length}</strong>
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Inspector Detail Column */}
          <div className="lg:col-span-7">
            {selectedVerification ? (
              <div className="bg-white rounded-lg border border-crm-border p-5 shadow-2xs space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-crm-border pb-4">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-crm-muted tracking-wider block">
                      Verification Audit #{selectedVerification.id.slice(0, 8)}
                    </span>
                    <h2 className="text-lg font-bold text-crm-text mt-0.5">
                      {selectedVerification.societyName} (Unit {selectedVerification.flatNumber})
                    </h2>
                    <p className="text-xs text-crm-muted mt-0.5">
                      {selectedVerification.locality}, {selectedVerification.city} • {selectedVerification.preference}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedVerification.status === "SUBMITTED" && (
                      <>
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => setRejectModalOpen(true)}
                          className="px-3 py-1.5 rounded-md text-xs font-bold border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        >
                          Reject / Redo
                        </button>
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={handleApprove}
                          className="px-4 py-1.5 rounded-md text-xs font-bold bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50"
                        >
                          {isProcessing ? "Approving..." : "✓ Approve Verification"}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Audit Meta & Verifier */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-stone-50 p-3 rounded-lg border border-crm-border/70 text-xs">
                  <div>
                    <span className="text-[10px] text-crm-muted block">Field Verifier</span>
                    <strong className="text-crm-text">{selectedVerification.verifierName}</strong>
                    <div className="text-[11px] text-crm-muted">{selectedVerification.verifierPhone || "-"}</div>
                  </div>
                  <div>
                    <span className="text-[10px] text-crm-muted block">Started At</span>
                    <strong className="text-crm-text">
                      {selectedVerification.startedAt
                        ? new Date(selectedVerification.startedAt).toLocaleTimeString()
                        : "-"}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-crm-muted block">Submitted At</span>
                    <strong className="text-crm-text">
                      {selectedVerification.submittedAt
                        ? new Date(selectedVerification.submittedAt).toLocaleTimeString()
                        : "-"}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-crm-muted block">Current Status</span>
                    <strong className="text-crm-primary font-bold">
                      {selectedVerification.status.replace(/_/g, " ")}
                    </strong>
                  </div>
                </div>

                {/* Discrepancy & Actual Observations Comparison Table */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-crm-text">
                    Specification Comparison (Listed vs Observed)
                  </h3>
                  <div className="border border-crm-border rounded-lg overflow-hidden text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-stone-50 border-b border-crm-border text-crm-muted font-bold text-[11px]">
                        <tr>
                          <th className="p-2.5">Parameter</th>
                          <th className="p-2.5">Original Listed Value</th>
                          <th className="p-2.5">Verifier Observed Value</th>
                          <th className="p-2.5">Match Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-crm-border">
                        <tr>
                          <td className="p-2.5 font-medium text-crm-text">Physical Existence</td>
                          <td className="p-2.5 text-crm-muted">{selectedVerification.flatNumber}</td>
                          <td className="p-2.5 font-semibold text-crm-text">
                            {selectedVerification.physicalMatch ? "Verified on premises" : "Mismatch"}
                          </td>
                          <td className="p-2.5">
                            {selectedVerification.physicalMatch ? (
                              <span className="text-emerald-700 font-bold">✓ Match</span>
                            ) : (
                              <span className="text-rose-700 font-bold">⚠️ Flagged</span>
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-medium text-crm-text">Bedrooms (BHK)</td>
                          <td className="p-2.5 text-crm-muted">{selectedVerification.bedroomCount} BHK</td>
                          <td className="p-2.5 font-semibold text-crm-text">
                            {selectedVerification.actualBedrooms ?? "-"} BHK
                          </td>
                          <td className="p-2.5">
                            {selectedVerification.actualBedrooms === selectedVerification.bedroomCount ? (
                              <span className="text-emerald-700 font-bold">✓ Match</span>
                            ) : (
                              <span className="text-amber-700 font-bold">⚠️ Discrepancy</span>
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-medium text-crm-text">Bathrooms</td>
                          <td className="p-2.5 text-crm-muted">{selectedVerification.bathroomCount} Baths</td>
                          <td className="p-2.5 font-semibold text-crm-text">
                            {selectedVerification.actualBathrooms ?? "-"} Baths
                          </td>
                          <td className="p-2.5">
                            {selectedVerification.actualBathrooms === selectedVerification.bathroomCount ? (
                              <span className="text-emerald-700 font-bold">✓ Match</span>
                            ) : (
                              <span className="text-amber-700 font-bold">⚠️ Discrepancy</span>
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-medium text-crm-text">Occupancy State</td>
                          <td className="p-2.5 text-crm-muted">Listed as Available</td>
                          <td className="p-2.5 font-semibold text-crm-text">
                            {selectedVerification.occupancyState?.replace(/_/g, " ") || "-"}
                          </td>
                          <td className="p-2.5">
                            <span className="text-crm-muted">Observation</span>
                          </td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-medium text-crm-text">Condition Rating</td>
                          <td className="p-2.5 text-crm-muted">-</td>
                          <td className="p-2.5 font-semibold text-crm-text">
                            {selectedVerification.propertyCondition || "-"}
                          </td>
                          <td className="p-2.5">
                            <span className="text-crm-muted">Observation</span>
                          </td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-medium text-crm-text">Key Holder Access</td>
                          <td className="p-2.5 text-crm-muted">{selectedVerification.keyHolderName || "Owner"}</td>
                          <td className="p-2.5 font-semibold text-crm-text">
                            {selectedVerification.keyHolderConfirmed ? "Confirmed Available" : "Issue Faced"}
                          </td>
                          <td className="p-2.5">
                            {selectedVerification.keyHolderConfirmed ? (
                              <span className="text-emerald-700 font-bold">✓ Ready</span>
                            ) : (
                              <span className="text-rose-700 font-bold">⚠️ Inaccessible</span>
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Discrepancies & Remarks */}
                {(selectedVerification.discrepancies || selectedVerification.verifierRemarks) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {selectedVerification.discrepancies && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                        <strong className="text-amber-900 block font-bold mb-1">
                          Verifier Logged Discrepancies:
                        </strong>
                        <p className="text-amber-800">{selectedVerification.discrepancies}</p>
                      </div>
                    )}
                    {selectedVerification.verifierRemarks && (
                      <div className="p-3 rounded-lg bg-stone-50 border border-crm-border">
                        <strong className="text-crm-text block font-bold mb-1">
                          Verifier Remarks:
                        </strong>
                        <p className="text-crm-muted">{selectedVerification.verifierRemarks}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Unable to Verify Details */}
                {selectedVerification.status === "UNABLE_TO_VERIFY" && (
                  <div className="p-3 rounded-lg bg-stone-100 border border-stone-300 text-xs text-stone-800 space-y-1">
                    <strong className="block font-bold">Unable to Verify Escalation:</strong>
                    <div>
                      Reason:{" "}
                      <span className="font-semibold">
                        {selectedVerification.unableToVerifyReason?.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div>Notes: {selectedVerification.unableToVerifyNotes}</div>
                  </div>
                )}

                {/* Photo Evidence Gallery */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-crm-text">
                    Uploaded Photo Evidence ({selectedVerification.media.length})
                  </h3>
                  {selectedVerification.media.length === 0 ? (
                    <div className="p-4 rounded border border-dashed border-crm-border text-center text-xs text-crm-muted">
                      No photos uploaded.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {selectedVerification.media.map((m, idx) => (
                        <div
                          key={m.id || idx}
                          className="rounded-lg border border-crm-border overflow-hidden bg-stone-50 shadow-2xs"
                        >
                          <img
                            src={m.url}
                            alt={m.caption || "Inspection Evidence"}
                            className="w-full h-28 object-cover"
                          />
                          <div className="p-2 bg-white text-[11px] border-t border-crm-border/60">
                            <span className="font-semibold text-crm-text block truncate">
                              {m.caption || "Inspection Photo"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg border border-crm-border p-12 text-center text-crm-muted text-sm shadow-2xs">
                Select a verification audit from the left list to review details.
              </div>
            )}
          </div>
        </div>

        {/* Modal: Reject / Request Redo */}
        {rejectModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4">
            <div className="bg-white rounded-lg border border-crm-border shadow-xl max-w-md w-full p-5 space-y-4">
              <div>
                <h3 className="text-base font-bold text-crm-text">Request Re-verification</h3>
                <p className="text-xs text-crm-muted mt-1">
                  Specify what was insufficient or needs to be re-inspected by the Field Verifier.
                </p>
              </div>

              <form onSubmit={handleReject} className="space-y-3 text-xs">
                <div>
                  <label className="font-bold text-crm-text block mb-1">
                    Supervisory Feedback Notes (Mandatory)
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={rejectionNotes}
                    onChange={(e) => setRejectionNotes(e.target.value)}
                    placeholder="e.g. Please capture a clear photo of the electrical meter board and verify if the balcony is enclosed..."
                    className="w-full p-2.5 rounded border border-crm-border bg-stone-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-crm-primary"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-crm-border">
                  <button
                    type="button"
                    onClick={() => setRejectModalOpen(false)}
                    className="px-3 py-1.5 rounded text-xs font-semibold border border-crm-border hover:bg-stone-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isProcessing}
                    className="px-4 py-1.5 rounded text-xs font-bold bg-rose-700 text-white hover:bg-rose-800 shadow-2xs disabled:opacity-50"
                  >
                    {isProcessing ? "Rejecting..." : "Send Back for Redo"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
