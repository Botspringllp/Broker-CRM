"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { PropertyVerificationView } from "@/types/crm";
import {
  PropertyCondition,
  UnableToVerifyReason,
  VerificationOccupancyState,
} from "@prisma/client";
import {
  startVerificationVisitAction,
  submitVerificationReportAction,
  recordUnableToVerifyAction,
  uploadVerificationPhotoAction,
} from "../../actions";

interface VerificationTaskClientProps {
  initialVerification: PropertyVerificationView;
  userName: string;
  userRole: string;
}

export function VerificationTaskClient({
  initialVerification,
  userName,
  userRole,
}: VerificationTaskClientProps) {
  const [verification, setVerification] = useState<PropertyVerificationView>(initialVerification);

  // Inspection form states initialized from verification or defaults
  const [physicalMatch, setPhysicalMatch] = useState<boolean>(
    verification.physicalMatch ?? true
  );
  const [occupancyState, setOccupancyState] = useState<string>(
    verification.occupancyState ?? "VACANT"
  );
  const [actualBedrooms, setActualBedrooms] = useState<number>(
    verification.actualBedrooms ?? verification.bedroomCount
  );
  const [actualBathrooms, setActualBathrooms] = useState<number>(
    verification.actualBathrooms ?? verification.bathroomCount
  );
  const [propertyCondition, setPropertyCondition] = useState<string>(
    verification.propertyCondition ?? "GOOD"
  );
  const [keyHolderConfirmed, setKeyHolderConfirmed] = useState<boolean>(
    verification.keyHolderConfirmed ?? true
  );
  const [amenitiesConfirmed, setAmenitiesConfirmed] = useState<string[]>(
    verification.amenitiesConfirmed || []
  );
  const [discrepancies, setDiscrepancies] = useState<string>(
    verification.discrepancies || ""
  );
  const [verifierRemarks, setVerifierRemarks] = useState<string>(
    verification.verifierRemarks || ""
  );

  // Photo upload states
  const [photoCategory, setPhotoCategory] = useState<string>("Living Room");
  const [photoCaption, setPhotoCaption] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  // Action states
  const [isStartingVisit, setIsStartingVisit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Unable to verify modal state
  const [unableModalOpen, setUnableModalOpen] = useState(false);
  const [unableReason, setUnableReason] = useState<string>("DOOR_LOCKED");
  const [unableNotes, setUnableNotes] = useState<string>("");
  const [isMarkingUnable, setIsMarkingUnable] = useState(false);

  const isEditable = verification.status === "IN_PROGRESS";
  const isPendingStart = verification.status === "ASSIGNED";

  // Standard amenities list
  const standardAmenities = [
    "Lift / Elevator",
    "Power Backup",
    "Covered Car Parking",
    "24x7 Security",
    "Clubhouse / Gym",
    "Swimming Pool",
    "Piped Gas",
    "Children's Play Area",
  ];

  const handleToggleAmenity = (item: string) => {
    if (!isEditable) return;
    setAmenitiesConfirmed((prev) =>
      prev.includes(item) ? prev.filter((a) => a !== item) : [...prev, item]
    );
  };

  // 1. Start Visit Handler
  const handleStartVisit = async () => {
    setIsStartingVisit(true);
    setStatusMessage(null);
    try {
      const res = await startVerificationVisitAction(verification.id);
      if (res.success) {
        setVerification(res.verification);
        setStatusMessage({
          type: "success",
          text: "Inspection visit started! Complete the checklist and upload required photos below.",
        });
      }
    } catch (err: unknown) {
      setStatusMessage({
        type: "error",
        text: (err as Error)?.message || "Failed to start inspection visit.",
      });
    } finally {
      setIsStartingVisit(false);
    }
  };

  // 2. Photo Upload Handler
  const handlePhotoUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setStatusMessage({ type: "error", text: "Please select an image file to upload." });
      return;
    }

    setIsUploadingPhoto(true);
    setStatusMessage(null);

    try {
      const formData = new FormData();
      formData.append("propertyId", verification.propertyId);
      formData.append("verificationId", verification.id);
      formData.append("photo", selectedFile);
      const combinedCaption = photoCaption.trim()
        ? `[${photoCategory}] ${photoCaption.trim()}`
        : `[${photoCategory}]`;
      formData.append("caption", combinedCaption);

      const res = await uploadVerificationPhotoAction(formData);
      if (res.success) {
        setVerification((prev) => ({
          ...prev,
          media: [
            ...prev.media,
            {
              id: res.media.id,
              type: "PHOTO",
              url: res.media.url,
              caption: res.media.caption || combinedCaption,
            },
          ],
        }));
        setSelectedFile(null);
        setPhotoCaption("");
        setStatusMessage({ type: "success", text: "Inspection photo uploaded successfully." });
      }
    } catch (err: unknown) {
      setStatusMessage({
        type: "error",
        text: (err as Error)?.message || "Failed to upload inspection photo.",
      });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  // 3. Submit Report Handler
  const handleSubmitReport = async () => {
    if (verification.media.length === 0) {
      setStatusMessage({
        type: "error",
        text: "At least one inspection photo is required before submitting the report.",
      });
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await submitVerificationReportAction({
        verificationId: verification.id,
        physicalMatch,
        occupancyState: occupancyState as VerificationOccupancyState,
        actualBedrooms: Number(actualBedrooms),
        actualBathrooms: Number(actualBathrooms),
        propertyCondition: propertyCondition as PropertyCondition,
        amenitiesConfirmed,
        keyHolderConfirmed,
        discrepancies: discrepancies.trim() || undefined,
        verifierRemarks: verifierRemarks.trim() || undefined,
      });

      if (res.success) {
        setVerification(res.verification);
        setStatusMessage({
          type: "success",
          text: "Verification report submitted successfully! It is now pending Team Leader review.",
        });
      }
    } catch (err: unknown) {
      setStatusMessage({
        type: "error",
        text: (err as Error)?.message || "Failed to submit verification report.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // 4. Record Unable to Verify Handler
  const handleRecordUnableToVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unableNotes.trim()) {
      setStatusMessage({
        type: "error",
        text: "Please provide explanatory notes for why the property could not be verified.",
      });
      return;
    }

    setIsMarkingUnable(true);
    setStatusMessage(null);

    try {
      const res = await recordUnableToVerifyAction({
        verificationId: verification.id,
        reason: unableReason as UnableToVerifyReason,
        notes: unableNotes.trim(),
      });

      if (res.success) {
        setVerification(res.verification);
        setUnableModalOpen(false);
        setStatusMessage({
          type: "success",
          text: "Property marked as Unable to Verify. Task has been closed for supervisory review.",
        });
      }
    } catch (err: unknown) {
      setStatusMessage({
        type: "error",
        text: (err as Error)?.message || "Failed to record unable to verify status.",
      });
    } finally {
      setIsMarkingUnable(false);
    }
  };

  const mapQueryUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${verification.societyName}, ${verification.locality}, ${verification.city}`
  )}`;

  return (
    <AppShell
      activePage="My Assigned Verifications"
      userName={userName}
      userRole={userRole}
      isAuthenticated={true}
    >
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between text-xs">
          <Link
            href="/verifier"
            className="text-crm-primary font-semibold hover:underline inline-flex items-center gap-1"
          >
            ← Back to All Tasks
          </Link>
          <span className="text-crm-muted">Task ID: {verification.id.slice(0, 8)}</span>
        </div>

        {/* Status Alerts */}
        {statusMessage && (
          <div
            className={`p-4 rounded-lg border text-xs font-medium flex items-center justify-between ${
              statusMessage.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-rose-50 border-rose-200 text-rose-800"
            }`}
          >
            <span>{statusMessage.text}</span>
            <button
              onClick={() => setStatusMessage(null)}
              className="font-bold ml-3 text-sm hover:opacity-70"
            >
              ✕
            </button>
          </div>
        )}

        {/* Property Header Card */}
        <div className="bg-white rounded-lg border border-crm-border p-4 sm:p-6 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <span className="text-[10px] uppercase font-bold text-crm-muted tracking-wider block">
                {verification.propertyType} • {verification.preference}
              </span>
              <h1 className="text-xl sm:text-2xl font-bold text-crm-text mt-0.5">
                {verification.societyName}
              </h1>
              <div className="text-xs sm:text-sm text-crm-muted mt-0.5">
                Unit / Flat: <strong className="text-crm-text">{verification.flatNumber}</strong> | Locality:{" "}
                <strong className="text-crm-text">{verification.locality}, {verification.city}</strong>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold px-2.5 py-1 rounded bg-teal-50 text-teal-800 border border-teal-200">
                {verification.priceFormatted}
              </span>
              <span
                className={`text-xs font-bold px-2.5 py-1 rounded border ${
                  verification.status === "APPROVED"
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : verification.status === "IN_PROGRESS"
                    ? "bg-blue-50 text-blue-800 border-blue-200"
                    : verification.status === "SUBMITTED"
                    ? "bg-purple-50 text-purple-800 border-purple-200"
                    : verification.status === "UNABLE_TO_VERIFY"
                    ? "bg-stone-100 text-stone-700 border-stone-300"
                    : verification.status === "REJECTED"
                    ? "bg-rose-50 text-rose-800 border-rose-200"
                    : "bg-amber-50 text-amber-800 border-amber-200"
                }`}
              >
                Status: {verification.status.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          {/* Contact & Map Quick Actions Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-crm-border/60">
            {/* Key-holder / Owner quick dial */}
            <div className="bg-stone-50 rounded-lg p-3 border border-crm-border/80 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-crm-muted block">
                  {verification.keyHolderName ? `Key Custodian (${verification.keyHolderPersona || "Other"})` : "Owner Contact"}
                </span>
                <span className="text-xs font-bold text-crm-text">
                  {verification.keyHolderName || verification.ownerName}
                </span>
                <span className="text-[11px] text-crm-muted ml-2">
                  {verification.keyHolderMobile || verification.ownerMobile}
                </span>
              </div>
              {(verification.keyHolderMobile || verification.ownerMobile) && (
                <a
                  href={`tel:${verification.keyHolderMobile || verification.ownerMobile}`}
                  className="px-3 py-1.5 rounded-md text-xs font-bold bg-white border border-crm-border text-crm-primary hover:bg-stone-100 shadow-2xs inline-flex items-center gap-1"
                >
                  📞 Call
                </a>
              )}
            </div>

            {/* Google Map Directions */}
            <div className="bg-stone-50 rounded-lg p-3 border border-crm-border/80 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-crm-muted block">
                  Location & Directions
                </span>
                <span className="text-xs text-crm-text font-medium truncate block max-w-[200px]">
                  {verification.societyName}, {verification.locality}
                </span>
              </div>
              <a
                href={mapQueryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-md text-xs font-bold bg-white border border-crm-border text-crm-primary hover:bg-stone-100 shadow-2xs inline-flex items-center gap-1"
              >
                📍 Open Map
              </a>
            </div>
          </div>

          {/* Action Bar for Pending Start */}
          {isPendingStart && (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h4 className="text-xs font-bold text-amber-900">Task Assigned & Ready to Start</h4>
                <p className="text-[11px] text-amber-700 mt-0.5">
                  Tap &quot;Start Visit&quot; once you reach the physical location to begin the inspection checklist.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUnableModalOpen(true)}
                  className="px-3 py-2 rounded-md text-xs font-bold bg-white border border-amber-300 text-stone-700 hover:bg-stone-100"
                >
                  Unable to Verify
                </button>
                <button
                  type="button"
                  disabled={isStartingVisit}
                  onClick={handleStartVisit}
                  className="px-4 py-2 rounded-md text-xs font-bold bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50"
                >
                  {isStartingVisit ? "Starting..." : "▶ Start Visit"}
                </button>
              </div>
            </div>
          )}

          {/* In-Progress Banner */}
          {isEditable && (
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="text-xs text-blue-900">
                <span className="font-bold">Inspection Visit In Progress.</span> Started at:{" "}
                <strong className="text-blue-950">
                  {verification.startedAt ? new Date(verification.startedAt).toLocaleTimeString() : "Just now"}
                </strong>
              </div>
              <button
                type="button"
                onClick={() => setUnableModalOpen(true)}
                className="text-xs text-blue-800 hover:underline font-semibold"
              >
                Mark Unable to Verify Instead
              </button>
            </div>
          )}

          {/* Reviewer Feedback Notice if Rejected */}
          {verification.status === "REJECTED" && verification.reviewNotes && (
            <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900 space-y-1">
              <strong className="block text-sm font-bold text-rose-800">
                ⚠️ Re-verification Requested by Team Leader:
              </strong>
              <p>{verification.reviewNotes}</p>
            </div>
          )}

          {/* Submission Notice */}
          {verification.status === "SUBMITTED" && (
            <div className="p-4 rounded-lg bg-purple-50 border border-purple-200 text-xs text-purple-900 space-y-1">
              <strong className="block text-sm font-bold text-purple-800">
                ✓ Report Submitted for Supervisory Review
              </strong>
              <p>
                Submitted at:{" "}
                <strong>
                  {verification.submittedAt ? new Date(verification.submittedAt).toLocaleString() : "-"}
                </strong>
                . Report fields are locked while under review.
              </p>
            </div>
          )}

          {/* Approved Notice */}
          {verification.status === "APPROVED" && (
            <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
              <strong className="block text-sm font-bold text-emerald-800">
                ✓ Approved & Field Verified
              </strong>
              <p>
                Reviewed and approved by{" "}
                <strong>{verification.reviewedByUserName || "Team Leader"}</strong> on{" "}
                <strong>
                  {verification.reviewedAt ? new Date(verification.reviewedAt).toLocaleString() : "-"}
                </strong>
                . The property now carries the official Field Verified status in the Active Supply Pool.
              </p>
            </div>
          )}
        </div>

        {/* Inspection Checklist Form */}
        <div className="bg-white rounded-lg border border-crm-border p-4 sm:p-6 shadow-2xs space-y-6">
          <div className="border-b border-crm-border pb-3">
            <h2 className="text-base font-bold text-crm-text">Physical Inspection Checklist</h2>
            <p className="text-xs text-crm-muted mt-0.5">
              Verify all physical parameters on-site. Observed values remain distinct from listed specs.
            </p>
          </div>

          <div className="space-y-5 text-xs">
            {/* 1. Address & Unit Physical Existence */}
            <div className="p-3.5 rounded-lg bg-stone-50 border border-crm-border/70 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-crm-text block">1. Physical Existence & Unit Match</span>
                  <span className="text-crm-muted text-[11px]">
                    Does flat #{verification.flatNumber} physically exist at {verification.societyName}?
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="physicalMatch"
                      disabled={!isEditable}
                      checked={physicalMatch === true}
                      onChange={() => setPhysicalMatch(true)}
                      className="text-crm-primary"
                    />
                    <span className="font-bold text-emerald-800">Yes, Verified</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="physicalMatch"
                      disabled={!isEditable}
                      checked={physicalMatch === false}
                      onChange={() => setPhysicalMatch(false)}
                      className="text-crm-primary"
                    />
                    <span className="font-bold text-rose-800">No, Mismatch</span>
                  </label>
                </div>
              </div>
            </div>

            {/* 2. Occupancy State */}
            <div className="p-3.5 rounded-lg bg-stone-50 border border-crm-border/70 space-y-2">
              <span className="font-bold text-crm-text block">2. Current Occupancy Status</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                {[
                  { id: "VACANT", label: "Vacant (Ready to move)" },
                  { id: "SELF_OCCUPIED", label: "Self Occupied (Owner)" },
                  { id: "TENANT_OCCUPIED", label: "Tenant Occupied" },
                  { id: "OTHER", label: "Other" },
                ].map((item) => (
                  <label
                    key={item.id}
                    className={`p-2.5 rounded-md border text-center cursor-pointer transition-all ${
                      occupancyState === item.id
                        ? "bg-teal-50 border-teal-300 font-bold text-teal-900"
                        : "bg-white border-crm-border text-crm-muted hover:bg-stone-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="occupancy"
                      disabled={!isEditable}
                      value={item.id}
                      checked={occupancyState === item.id}
                      onChange={(e) => setOccupancyState(e.target.value)}
                      className="sr-only"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 3. Actual Room Configuration vs Listed */}
            <div className="p-3.5 rounded-lg bg-stone-50 border border-crm-border/70 space-y-3">
              <span className="font-bold text-crm-text block">3. Observed Room Counts vs Listed</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-white p-3 rounded border border-crm-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-crm-muted">Bedrooms:</span>
                    <span className="text-[11px] text-crm-muted">
                      Listed: <strong>{verification.bedroomCount} BHK</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] font-bold text-crm-text whitespace-nowrap">
                      Observed BHK:
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      disabled={!isEditable}
                      value={actualBedrooms}
                      onChange={(e) => setActualBedrooms(parseInt(e.target.value, 10) || 0)}
                      className="w-full px-2.5 py-1 text-xs rounded border border-crm-border bg-stone-50 focus:bg-white"
                    />
                  </div>
                  {actualBedrooms !== verification.bedroomCount && (
                    <span className="text-[11px] text-amber-700 font-semibold block">
                      ⚠️ Discrepancy detected with listed count ({verification.bedroomCount} BHK).
                    </span>
                  )}
                </div>

                <div className="bg-white p-3 rounded border border-crm-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-crm-muted">Bathrooms:</span>
                    <span className="text-[11px] text-crm-muted">
                      Listed: <strong>{verification.bathroomCount} Baths</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] font-bold text-crm-text whitespace-nowrap">
                      Observed Baths:
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      disabled={!isEditable}
                      value={actualBathrooms}
                      onChange={(e) => setActualBathrooms(parseInt(e.target.value, 10) || 0)}
                      className="w-full px-2.5 py-1 text-xs rounded border border-crm-border bg-stone-50 focus:bg-white"
                    />
                  </div>
                  {actualBathrooms !== verification.bathroomCount && (
                    <span className="text-[11px] text-amber-700 font-semibold block">
                      ⚠️ Discrepancy detected with listed count ({verification.bathroomCount} Baths).
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 4. Property Overall Condition */}
            <div className="p-3.5 rounded-lg bg-stone-50 border border-crm-border/70 space-y-2">
              <span className="font-bold text-crm-text block">4. Physical Condition Rating</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                {[
                  { id: "EXCELLENT", label: "Excellent (Like new)" },
                  { id: "GOOD", label: "Good (Well maintained)" },
                  { id: "AVERAGE", label: "Average (Minor wear)" },
                  { id: "POOR", label: "Poor (Needs renovation)" },
                ].map((item) => (
                  <label
                    key={item.id}
                    className={`p-2.5 rounded-md border text-center cursor-pointer transition-all ${
                      propertyCondition === item.id
                        ? "bg-teal-50 border-teal-300 font-bold text-teal-900"
                        : "bg-white border-crm-border text-crm-muted hover:bg-stone-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="condition"
                      disabled={!isEditable}
                      value={item.id}
                      checked={propertyCondition === item.id}
                      onChange={(e) => setPropertyCondition(e.target.value)}
                      className="sr-only"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 5. Key Holder Access Confirmation */}
            <div className="p-3.5 rounded-lg bg-stone-50 border border-crm-border/70 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-crm-text block">5. Key-Holder Availability</span>
                  <span className="text-crm-muted text-[11px]">
                    Were keys easily accessible for future buyer showing tours?
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="keyHolderConfirmed"
                      disabled={!isEditable}
                      checked={keyHolderConfirmed === true}
                      onChange={() => setKeyHolderConfirmed(true)}
                      className="text-crm-primary"
                    />
                    <span className="font-bold text-emerald-800">Yes, Confirmed</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="keyHolderConfirmed"
                      disabled={!isEditable}
                      checked={keyHolderConfirmed === false}
                      onChange={() => setKeyHolderConfirmed(false)}
                      className="text-crm-primary"
                    />
                    <span className="font-bold text-rose-800">No, Issues Faced</span>
                  </label>
                </div>
              </div>
            </div>

            {/* 6. Verified Amenities */}
            <div className="p-3.5 rounded-lg bg-stone-50 border border-crm-border/70 space-y-2">
              <span className="font-bold text-crm-text block">6. Confirmed Amenities On-Site</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                {standardAmenities.map((amenity) => {
                  const isChecked = amenitiesConfirmed.includes(amenity);
                  return (
                    <label
                      key={amenity}
                      onClick={() => handleToggleAmenity(amenity)}
                      className={`p-2 rounded border text-xs cursor-pointer flex items-center gap-2 transition-all ${
                        isChecked
                          ? "bg-teal-50 border-teal-300 font-bold text-teal-900"
                          : "bg-white border-crm-border text-crm-muted hover:bg-stone-50"
                      } ${!isEditable ? "opacity-80 cursor-default" : ""}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!isEditable}
                        checked={isChecked}
                        onChange={() => {}}
                        className="text-crm-primary rounded"
                      />
                      <span>{amenity}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 7. Discrepancies and Observations */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-bold text-crm-text block">
                  Observed Discrepancies
                </label>
                <textarea
                  rows={3}
                  disabled={!isEditable}
                  value={discrepancies}
                  onChange={(e) => setDiscrepancies(e.target.value)}
                  placeholder="Note any differences between listing and on-site reality (e.g. Balcony enclosed, parking open instead of covered)..."
                  className="w-full text-xs p-2.5 rounded-md border border-crm-border bg-stone-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-crm-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-crm-text block">
                  Verifier Remarks / General Notes
                </label>
                <textarea
                  rows={3}
                  disabled={!isEditable}
                  value={verifierRemarks}
                  onChange={(e) => setVerifierRemarks(e.target.value)}
                  placeholder="General notes on building vibe, security attitude, elevator functioning, neighbourhood..."
                  className="w-full text-xs p-2.5 rounded-md border border-crm-border bg-stone-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-crm-primary"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Photos & Evidence Section */}
        <div className="bg-white rounded-lg border border-crm-border p-4 sm:p-6 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-crm-border pb-3">
            <div>
              <h2 className="text-base font-bold text-crm-text">
                Inspection Photos & Evidence ({verification.media.length})
              </h2>
              <p className="text-xs text-crm-muted mt-0.5">
                Photos are stored securely in CRM storage and linked to this verification audit.
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-stone-100 text-stone-700 border border-stone-200">
              Required: ≥ 1 Photo
            </span>
          </div>

          {/* Photo Uploader (active when IN_PROGRESS) */}
          {isEditable && (
            <form onSubmit={handlePhotoUpload} className="p-4 rounded-lg bg-stone-50 border border-crm-border space-y-3">
              <h3 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                Upload New Inspection Photo
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] text-crm-muted font-bold block mb-1">
                    Photo Category
                  </label>
                  <select
                    value={photoCategory}
                    onChange={(e) => setPhotoCategory(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 rounded border border-crm-border bg-white"
                  >
                    <option value="Building Exterior">Building Exterior / Entrance</option>
                    <option value="Living Room">Living Room</option>
                    <option value="Master Bedroom">Master Bedroom</option>
                    <option value="Kitchen">Kitchen</option>
                    <option value="Bathroom">Bathroom</option>
                    <option value="Balcony / View">Balcony / View</option>
                    <option value="Electric Meter / Utility">Electric Meter / Utility</option>
                    <option value="Other">Other Evidence</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-crm-muted font-bold block mb-1">
                    Caption (Optional)
                  </label>
                  <input
                    type="text"
                    value={photoCaption}
                    onChange={(e) => setPhotoCaption(e.target.value)}
                    placeholder="e.g. Spacious hall facing east..."
                    className="w-full text-xs px-2.5 py-1.5 rounded border border-crm-border bg-white"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-crm-muted font-bold block mb-1">
                    Select / Camera Capture
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    className="w-full text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-crm-primary file:text-white hover:file:bg-crm-primary-hover"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={!selectedFile || isUploadingPhoto}
                  className="px-4 py-2 rounded-md text-xs font-bold bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {isUploadingPhoto ? "Uploading..." : "📷 Upload Photo"}
                </button>
              </div>
            </form>
          )}

          {/* Photo Gallery Grid */}
          {verification.media.length === 0 ? (
            <div className="p-8 rounded border border-dashed border-crm-border text-center text-crm-muted text-xs">
              No inspection photos uploaded yet. Use the upload box above to capture on-site photos.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {verification.media.map((m, idx) => (
                <div
                  key={m.id || idx}
                  className="group relative rounded-lg border border-crm-border overflow-hidden bg-stone-100"
                >
                  <img
                    src={m.url}
                    alt={m.caption || "Inspection Photo"}
                    className="w-full h-32 object-cover"
                  />
                  <div className="p-2 bg-white text-[11px] border-t border-crm-border/60">
                    <p className="font-semibold text-crm-text truncate">
                      {m.caption || "Inspection Photo"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action Submission Footer */}
        {isEditable && (
          <div className="bg-white rounded-lg border border-crm-border p-4 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-crm-text block">Ready to Submit?</span>
              <span className="text-[11px] text-crm-muted">
                Ensure all checklist points and at least one photo have been uploaded. Once submitted, editing is locked.
              </span>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => setUnableModalOpen(true)}
                className="px-4 py-2 text-xs font-bold rounded-md border border-crm-border text-crm-muted hover:text-crm-text bg-white"
              >
                Unable to Verify
              </button>
              <button
                type="button"
                disabled={isSubmitting || verification.media.length === 0}
                onClick={handleSubmitReport}
                className="px-6 py-2 text-xs font-bold rounded-md bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50"
              >
                {isSubmitting ? "Submitting Report..." : "✓ Submit Inspection Report"}
              </button>
            </div>
          </div>
        )}

        {/* Modal: Unable to Verify */}
        {unableModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4">
            <div className="bg-white rounded-lg border border-crm-border shadow-xl max-w-md w-full p-5 space-y-4">
              <div>
                <h3 className="text-base font-bold text-crm-text">Mark Unable to Verify</h3>
                <p className="text-xs text-crm-muted mt-1">
                  If you cannot enter or verify this property, record the reason and notes. This report will be escalated to your Team Leader.
                </p>
              </div>

              <form onSubmit={handleRecordUnableToVerify} className="space-y-3 text-xs">
                <div>
                  <label className="font-bold text-crm-text block mb-1">Standard Failure Reason</label>
                  <select
                    value={unableReason}
                    onChange={(e) => setUnableReason(e.target.value)}
                    className="w-full p-2 rounded border border-crm-border bg-stone-50 focus:bg-white"
                  >
                    <option value="DOOR_LOCKED">Door locked / No one at premises</option>
                    <option value="OWNER_KEYHOLDER_UNRESPONSIVE">Owner or Key-holder unreachable</option>
                    <option value="TENANT_REFUSED_ENTRY">Current tenant refused entry</option>
                    <option value="SECURITY_DENIED_ACCESS">Society security denied entry</option>
                    <option value="WRONG_ADDRESS_OR_LOCATION">Incorrect address or flat does not exist</option>
                    <option value="OTHER">Other circumstance</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-crm-text block mb-1">Detailed Explanation</label>
                  <textarea
                    rows={3}
                    required
                    value={unableNotes}
                    onChange={(e) => setUnableNotes(e.target.value)}
                    placeholder="Describe what occurred, who you spoke with, timestamps, etc..."
                    className="w-full p-2.5 rounded border border-crm-border bg-stone-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-crm-primary"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-crm-border">
                  <button
                    type="button"
                    onClick={() => setUnableModalOpen(false)}
                    className="px-3 py-1.5 rounded text-xs font-semibold border border-crm-border hover:bg-stone-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isMarkingUnable}
                    className="px-4 py-1.5 rounded text-xs font-bold bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50"
                  >
                    {isMarkingUnable ? "Submitting..." : "Confirm & Escalate"}
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
