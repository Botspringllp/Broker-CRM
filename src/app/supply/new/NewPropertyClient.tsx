"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { Toast } from "@/components/ui/Toast";
import {
  createPropertyAction,
  checkDuplicatePropertyAction,
  uploadPropertyPhotosAction,
  attachPropertyVideoAction,
} from "../actions";
import { formatIndianCurrency } from "@/server/dal/mappers";

interface NewPropertyClientProps {
  userRole: string;
  userName: string;
}

interface PhotoItem {
  file: File;
  previewUrl: string;
  caption: string;
}

const STEPS = [
  { id: 1, name: "Owner Contact", desc: "Owner & contact details" },
  { id: 2, name: "Basic Details", desc: "Type, BHK, and layout" },
  { id: 3, name: "Location Details", desc: "Society, unit, and locality" },
  { id: 4, name: "Property Profile", desc: "Area, furnishing, condition" },
  { id: 5, name: "Photos & Video", desc: "Upload images & walkthrough" },
  { id: 6, name: "Amenities", desc: "Society & unit facilities" },
  { id: 7, name: "Pricing & Review", desc: "Price, summary & publish" },
];

const PREDEFINED_AMENITIES = [
  "Lift / Elevator",
  "24x7 Power Backup",
  "24x7 Security & CCTV",
  "Reserved Car Parking",
  "Club House",
  "Swimming Pool",
  "Gymnasium",
  "Landscaped Park / Garden",
  "Visitor Parking",
  "Children's Play Area",
  "Piped Gas Connection",
  "Water Storage / Borewell",
  "Rainwater Harvesting",
  "Intercom Facility",
  "Fire Fighting Systems",
  "Waste Disposal",
];

export function NewPropertyClient({ userRole, userName }: NewPropertyClientProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [highestStepReached, setHighestStepReached] = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingExit, setIsSavingExit] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Step 1: Owner Contact Details (First Screen)
  const [ownerName, setOwnerName] = useState("");
  const [ownerMobile, setOwnerMobile] = useState("");
  const [ownerAlternatePhone, setOwnerAlternatePhone] = useState("");
  const [city, setCity] = useState("Gurugram");
  const [localityName, setLocalityName] = useState("");

  // Step 2: Basic Details
  const [preference, setPreference] = useState<"SALE" | "RENT">("SALE");
  const [propertyType, setPropertyType] = useState<
    "APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT" | "COMMERCIAL" | "OTHER"
  >("APARTMENT");
  const [bedroomCount, setBedroomCount] = useState<number>(3);
  const [bathroomCount, setBathroomCount] = useState<number>(3);
  const [balconyCount, setBalconyCount] = useState<number>(1);

  // Step 3: Location Details
  const [societyName, setSocietyName] = useState("");
  const [flatNumber, setFlatNumber] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);

  // Step 4: Property Profile
  const [area, setArea] = useState("");
  const [areaType, setAreaType] = useState<"SUPER_BUILT_UP" | "BUILT_UP" | "CARPET">("SUPER_BUILT_UP");
  const [furnishingStatus, setFurnishingStatus] = useState<
    "UNFURNISHED" | "SEMI_FURNISHED" | "FURNISHED"
  >("SEMI_FURNISHED");
  const [constructionStatus, setConstructionStatus] = useState<
    "READY_TO_MOVE" | "UNDER_CONSTRUCTION"
  >("READY_TO_MOVE");

  // Step 5: Photos & Videos
  const [selectedPhotos, setSelectedPhotos] = useState<PhotoItem[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [videoCaption, setVideoCaption] = useState("");

  // Step 6: Amenities
  const [amenities, setAmenities] = useState<string[]>([
    "Lift / Elevator",
    "24x7 Power Backup",
    "24x7 Security & CCTV",
  ]);
  const [customAmenityInput, setCustomAmenityInput] = useState("");

  // Step 7: Pricing & Key-holder
  const [price, setPrice] = useState("");
  const [hasKeyHolder, setHasKeyHolder] = useState(false);
  const [khName, setKhName] = useState("");
  const [khMobile, setKhMobile] = useState("");
  const [khPersona, setKhPersona] = useState<
    "GUARD" | "MAINTENANCE_OFFICE" | "NEIGHBOUR" | "OWNER" | "OTHER"
  >("GUARD");
  const [khNotes, setKhNotes] = useState("");

  // Real-time duplicate check on Step 3
  const handleCheckDuplicate = async () => {
    if (!societyName.trim() || !flatNumber.trim()) return;
    setIsCheckingDuplicate(true);
    try {
      const res = await checkDuplicatePropertyAction({
        societyName: societyName.trim(),
        flatNumber: flatNumber.trim(),
      });
      if (res.isDuplicate && res.duplicate) {
        setDuplicateWarning(
          `Notice: An existing property with Society '${res.duplicate.societyName}' and Flat '${res.duplicate.flatNumber}' was found in your brokerage.`
        );
      } else {
        setDuplicateWarning(null);
      }
    } catch {
      // Ignore background check error
    } finally {
      setIsCheckingDuplicate(false);
    }
  };

  const normalizePhone = (mobile: string): string => {
    const clean = mobile.replace(/\D/g, "");
    if (clean.length === 12 && clean.startsWith("91")) return clean.slice(2);
    if (clean.length === 11 && clean.startsWith("0")) return clean.slice(1);
    return clean;
  };

  // Step Validation before proceeding
  const validateStep = (step: number): boolean => {
    setStepError(null);

    // Step 1: Owner Contact Details
    if (step === 1) {
      if (!ownerName.trim()) {
        setStepError("Owner full name is required.");
        return false;
      }
      const normMobile = normalizePhone(ownerMobile);
      if (!/^[6-9]\d{9}$/.test(normMobile)) {
        setStepError("Owner mobile must be a valid 10-digit Indian mobile number.");
        return false;
      }
      if (ownerAlternatePhone.trim()) {
        const normAlt = normalizePhone(ownerAlternatePhone);
        if (!/^[6-9]\d{9}$/.test(normAlt)) {
          setStepError("Alternate phone must be a valid 10-digit Indian mobile number.");
          return false;
        }
      }
      return true;
    }

    // Step 2: Basic Details
    if (step === 2) {
      if (bedroomCount < 0) {
        setStepError("Bedroom count must be non-negative.");
        return false;
      }
      if (bathroomCount < 0) {
        setStepError("Bathroom count must be non-negative.");
        return false;
      }
      return true;
    }

    // Step 3: Location Details
    if (step === 3) {
      if (!city.trim()) {
        setStepError("City is required.");
        return false;
      }
      if (!localityName.trim()) {
        setStepError("Locality / Sector is required.");
        return false;
      }
      if (!societyName.trim()) {
        setStepError("Society or Project name is required.");
        return false;
      }
      if (!flatNumber.trim()) {
        setStepError("Flat or Unit number is required.");
        return false;
      }
      return true;
    }

    // Step 4: Property Profile
    if (step === 4) {
      const parsedArea = parseFloat(area);
      if (isNaN(parsedArea) || parsedArea <= 0) {
        setStepError("Please enter a valid property area in square feet.");
        return false;
      }
      return true;
    }

    // Step 5: Photos & Walkthrough
    if (step === 5) {
      if (youtubeUrl.trim()) {
        try {
          const parsed = new URL(youtubeUrl.trim());
          const host = parsed.hostname.toLowerCase();
          if (!host.includes("youtube.com") && !host.includes("youtu.be")) {
            setStepError("Video walkthrough must be a valid YouTube URL (youtube.com or youtu.be).");
            return false;
          }
        } catch {
          setStepError("Please enter a valid URL for the walkthrough video.");
          return false;
        }
      }
      return true;
    }

    // Step 6: Amenities
    if (step === 6) {
      return true;
    }

    // Step 7: Pricing & Final Review
    if (step === 7) {
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice) || parsedPrice <= 0) {
        setStepError(
          preference === "SALE"
            ? "Please enter a valid sale price in INR."
            : "Please enter a valid monthly rent in INR."
        );
        return false;
      }

      if (hasKeyHolder && khMobile.trim()) {
        const khNormalized = normalizePhone(khMobile);
        if (!/^[6-9]\d{9}$/.test(khNormalized)) {
          setStepError("Key-holder mobile must be a valid 10-digit Indian mobile number.");
          return false;
        }
      }
      return true;
    }

    return true;
  };

  // Step 1 Action A: Save & Exit (Saves unvalidated incomplete intake and exits)
  const handleSaveAndExit = async () => {
    if (!validateStep(1)) return;

    setIsSavingExit(true);
    setStepError(null);

    try {
      const normMobile = normalizePhone(ownerMobile);
      const res = await createPropertyAction({
        ownerName: ownerName.trim(),
        ownerMobile: normMobile,
        city: city.trim() || undefined,
        localityName: localityName.trim() || undefined,
        validationStatus: "NOT_VALIDATED",
        entryChannel: "MANUAL",
      });

      if (!res.success) {
        setStepError(res.error || "Failed to save property intake.");
        setIsSavingExit(false);
        return;
      }

      setToastMessage("Property intake saved successfully. Assigned to validation queue.");
      setTimeout(() => {
        router.push("/supply");
        router.refresh();
      }, 700);
    } catch (err: unknown) {
      setStepError(err instanceof Error ? err.message : "Failed to save property intake.");
      setIsSavingExit(false);
    }
  };

  // Step 1 Action B: Continue to Post (Preserves details and advances without creating DB duplicate)
  const handleContinueToPost = () => {
    if (!validateStep(1)) return;
    setCurrentStep(2);
    if (highestStepReached < 2) {
      setHighestStepReached(2);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleNext = () => {
    if (!validateStep(currentStep)) return;
    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    if (nextStep > highestStepReached) {
      setHighestStepReached(nextStep);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleBack = () => {
    setStepError(null);
    setCurrentStep((prev) => Math.max(1, prev - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const jumpToStep = (step: number) => {
    if (step <= highestStepReached || step <= currentStep) {
      setStepError(null);
      setCurrentStep(step);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Photo handlers
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    if (selectedPhotos.length + files.length > 10) {
      setStepError("Maximum 10 photos can be attached per property.");
      return;
    }

    const newItems: PhotoItem[] = files.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      caption: "",
    }));

    setSelectedPhotos((prev) => [...prev, ...newItems]);
    setStepError(null);
  };

  const handleRemovePhoto = (index: number) => {
    setSelectedPhotos((prev) => {
      const copy = [...prev];
      URL.revokeObjectURL(copy[index].previewUrl);
      copy.splice(index, 1);
      return copy;
    });
  };

  const handleAddCustomAmenity = () => {
    const trimmed = customAmenityInput.trim();
    if (trimmed && !amenities.includes(trimmed)) {
      setAmenities([...amenities, trimmed]);
      setCustomAmenityInput("");
    }
  };

  // Final Submission on Step 7
  const handleSubmit = async () => {
    if (!validateStep(7)) return;

    setIsSubmitting(true);
    setStepError(null);

    try {
      const normalizedOwner = normalizePhone(ownerMobile);

      let keyHolderPayload = null;
      if (hasKeyHolder && khName.trim()) {
        const normalizedKh = normalizePhone(khMobile);
        keyHolderPayload = {
          name: khName.trim(),
          mobile: normalizedKh || normalizedOwner,
          persona: khPersona,
          notes: khNotes.trim() || undefined,
        };
      }

      // 1. Create fully populated property
      const res = await createPropertyAction({
        ownerName: ownerName.trim(),
        ownerMobile: normalizedOwner,
        city: city.trim(),
        localityName: localityName.trim(),
        societyName: societyName.trim(),
        flatNumber: flatNumber.trim(),
        preference,
        propertyType,
        furnishingStatus,
        constructionStatus,
        bedroomCount,
        bathroomCount,
        balconyCount,
        area: parseFloat(area),
        areaType,
        price: parseFloat(price),
        amenities,
        keyHolder: keyHolderPayload,
        confirmDuplicate,
        entryChannel: "MANUAL",
      });

      if (!res.success) {
        if (res.isDuplicate) {
          setDuplicateWarning(res.error);
          setCurrentStep(3); // Jump to Location Details
        } else {
          setStepError(res.error);
        }
        setIsSubmitting(false);
        return;
      }

      const newPropertyId = res.property.id;

      // 2. Upload photos if selected
      if (selectedPhotos.length > 0) {
        const formData = new FormData();
        formData.append("propertyId", newPropertyId);
        selectedPhotos.forEach((item) => {
          formData.append("files", item.file);
        });
        await uploadPropertyPhotosAction(formData).catch(() => null);
      }

      // 3. Attach YouTube video if provided
      if (youtubeUrl.trim()) {
        await attachPropertyVideoAction({
          propertyId: newPropertyId,
          youtubeUrl: youtubeUrl.trim(),
          caption: videoCaption.trim() || "Walkthrough Tour",
        }).catch(() => null);
      }

      setToastMessage(`Property posted successfully: ${res.property.societyName || "Unit"} (${res.property.flatNumber || "—"})`);

      // Navigate to dedicated property details page
      setTimeout(() => {
        router.push(`/supply/${newPropertyId}`);
      }, 500);
    } catch (err: unknown) {
      setStepError(err instanceof Error ? err.message : "Failed to create property.");
      setIsSubmitting(false);
    }
  };

  const numericPrice = parseFloat(price);
  const formattedPricePreview = !isNaN(numericPrice) && numericPrice > 0
    ? formatIndianCurrency(numericPrice, preference === "RENT")
    : null;

  return (
    <AppShell userRole={userRole} userName={userName}>
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        {/* Top Breadcrumb & Navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-crm-border">
          <div>
            <div className="flex items-center gap-2 text-xs text-crm-muted mb-1">
              <Link href="/supply" className="hover:text-crm-primary hover:underline">
                Supply Validation
              </Link>
              <span>/</span>
              <span className="text-crm-text font-medium">Post New Property</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-crm-text">
              Post Property Wizard
            </h1>
            <p className="text-xs text-crm-muted mt-0.5">
              Structured multi-step secondary market listing for Indian residential brokerage (PRD §4).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/supply"
              className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text bg-crm-surface hover:bg-stone-50"
            >
              Cancel & Exit
            </Link>
          </div>
        </div>

        {/* Wizard Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Progress Stepper */}
          <div className="lg:col-span-4 bg-crm-surface rounded-lg border border-crm-border p-5 shadow-2xs">
            <div className="flex items-center justify-between pb-3 border-b border-crm-border mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-crm-muted">
                Progress
              </span>
              <span className="text-xs font-semibold text-crm-primary">
                Step {currentStep} of {STEPS.length}
              </span>
            </div>

            <nav aria-label="Wizard Steps" className="space-y-2">
              {STEPS.map((step) => {
                const isCurrent = step.id === currentStep;
                const isCompleted = step.id < currentStep;
                const isClickable = step.id <= highestStepReached;

                return (
                  <div key={step.id} className="relative">
                    <button
                      type="button"
                      disabled={!isClickable || isSubmitting || isSavingExit}
                      onClick={() => jumpToStep(step.id)}
                      className={`w-full flex items-start gap-3 p-2.5 rounded-md text-left transition-colors ${
                        isCurrent
                          ? "bg-teal-50/80 border border-teal-200"
                          : isClickable
                          ? "hover:bg-stone-50 cursor-pointer"
                          : "opacity-60 cursor-not-allowed"
                      }`}
                    >
                      {/* Step Circle */}
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                          isCompleted
                            ? "bg-emerald-600 text-white"
                            : isCurrent
                            ? "bg-crm-primary text-white ring-3 ring-teal-100"
                            : "bg-stone-100 text-crm-muted border border-crm-border"
                        }`}
                      >
                        {isCompleted ? "✓" : step.id}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-xs font-semibold leading-tight ${
                            isCurrent
                              ? "text-crm-primary font-bold"
                              : isCompleted
                              ? "text-crm-text"
                              : "text-crm-muted"
                          }`}
                        >
                          {step.name}
                        </div>
                        <div className="text-[11px] text-crm-muted mt-0.5 truncate">
                          {isCompleted ? "Completed" : isCurrent ? "Current step" : step.desc}
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
            </nav>

            <div className="mt-6 pt-4 border-t border-crm-border text-[11px] text-crm-muted space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-crm-text">
                <span>🛡️ Safety Notice</span>
              </div>
              <p>
                Newly created properties enter as <strong>NOT_VALIDATED</strong> and are never published to Active Supply Pool until owner willingness and details are verified (PRD §4.3).
              </p>
            </div>
          </div>

          {/* Right Column: Step Form Surface */}
          <div className="lg:col-span-8 bg-crm-surface rounded-lg border border-crm-border p-6 shadow-2xs space-y-6">
            {/* Step Header */}
            <div className="border-b border-crm-border pb-4">
              <span className="text-[11px] font-bold text-crm-primary uppercase tracking-wider block mb-1">
                Step {currentStep}: {STEPS[currentStep - 1]?.name}
              </span>
              <h2 className="text-lg font-bold text-crm-text">
                {currentStep === 1 && "Owner Contact Details"}
                {currentStep === 2 && "Basic Property Information"}
                {currentStep === 3 && "Location & Society Identification"}
                {currentStep === 4 && "Property Profile & Specifications"}
                {currentStep === 5 && "Photos & Video Walkthrough"}
                {currentStep === 6 && "Society & Unit Amenities"}
                {currentStep === 7 && "Pricing & Final Review"}
              </h2>
              <p className="text-xs text-crm-muted mt-1">
                {currentStep === 1 && "Collect owner contact details first. You can save an incomplete intake record immediately or continue posting full property details."}
                {currentStep === 2 && "Listing mode, property typology, bedrooms, and layout."}
                {currentStep === 3 && "Identify society, unit number, locality, and city."}
                {currentStep === 4 && "Area dimensions, furnishing condition, and possession status."}
                {currentStep === 5 && "Upload interior/exterior images and optional YouTube walkthrough."}
                {currentStep === 6 && "Select society and unit amenities."}
                {currentStep === 7 && "Set expected asking price / rent and review all details before posting."}
              </p>
            </div>

            {/* Error Banner */}
            {stepError && (
              <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between">
                <span>{stepError}</span>
                <button
                  type="button"
                  onClick={() => setStepError(null)}
                  className="font-bold hover:text-red-900 ml-2"
                >
                  ✕
                </button>
              </div>
            )}

            {/* STEP 1: Owner Contact Details (First Screen) */}
            {currentStep === 1 && (
              <div className="space-y-5 text-xs">
                <div className="p-4 rounded-lg bg-teal-50/60 border border-teal-200 text-teal-900 space-y-1">
                  <div className="font-bold text-sm flex items-center gap-1.5">
                    <span>👤 Quick Owner Intake</span>
                  </div>
                  <p className="text-[11px] text-teal-800">
                    If you only have the owner&apos;s contact details, fill Name and Mobile below and click <strong>Save & Exit</strong>. A pending intake record will be created in your Supply Validation queue for telecallers to follow up.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Owner Name */}
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Owner Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Rahul Sharma"
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                      autoFocus
                    />
                  </div>

                  {/* Owner Mobile */}
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Owner Mobile (10-Digit Indian Mobile) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      placeholder="e.g. 98123 45678"
                      value={ownerMobile}
                      onChange={(e) => setOwnerMobile(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>

                  {/* Alternate Mobile */}
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Alternate Mobile Number <span className="text-crm-muted font-normal">(Optional)</span>
                    </label>
                    <input
                      type="tel"
                      placeholder="e.g. 98111 22334"
                      value={ownerAlternatePhone}
                      onChange={(e) => setOwnerAlternatePhone(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>

                  {/* City */}
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      City <span className="text-crm-muted font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Gurugram"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>

                  {/* Locality */}
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-crm-text mb-1">
                      Locality / Sector <span className="text-crm-muted font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Sector 54, Golf Course Road"
                      value={localityName}
                      onChange={(e) => setLocalityName(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* Step 1 Two Distinct Action Buttons */}
                <div className="pt-6 border-t border-crm-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={isSavingExit || isSubmitting}
                    onClick={handleSaveAndExit}
                    className="px-4 py-2.5 text-xs font-semibold rounded border border-crm-border text-crm-text bg-white hover:bg-stone-50 shadow-2xs cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <span>💾</span>
                    <span>{isSavingExit ? "Saving Intake..." : "Save & Exit (Intake Only)"}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSavingExit || isSubmitting}
                    onClick={handleContinueToPost}
                    className="px-5 py-2.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>Continue to Post Property</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: Basic Property Details */}
            {currentStep === 2 && (
              <div className="space-y-5 text-xs">
                {/* Transaction Type */}
                <div>
                  <label className="block font-semibold text-crm-text mb-2">
                    Transaction Type (Listing Mode) <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3 max-w-md">
                    <button
                      type="button"
                      onClick={() => setPreference("SALE")}
                      className={`py-3 px-4 rounded-md border text-center transition-all ${
                        preference === "SALE"
                          ? "bg-teal-50 border-teal-600 text-teal-900 font-bold ring-1 ring-teal-600"
                          : "bg-crm-surface border-crm-border text-crm-text hover:bg-stone-50"
                      }`}
                    >
                      <div className="text-sm font-bold">🏠 Resale (Buy)</div>
                      <div className="text-[11px] opacity-80 mt-0.5">Capital resale transaction</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreference("RENT")}
                      className={`py-3 px-4 rounded-md border text-center transition-all ${
                        preference === "RENT"
                          ? "bg-teal-50 border-teal-600 text-teal-900 font-bold ring-1 ring-teal-600"
                          : "bg-crm-surface border-crm-border text-crm-text hover:bg-stone-50"
                      }`}
                    >
                      <div className="text-sm font-bold">🔑 Rental</div>
                      <div className="text-[11px] opacity-80 mt-0.5">Monthly lease agreement</div>
                    </button>
                  </div>
                </div>

                {/* Property Typology */}
                <div>
                  <label className="block font-semibold text-crm-text mb-2">
                    Property Typology <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: "APARTMENT", label: "Apartment / Flat" },
                      { id: "BUILDER_FLOOR", label: "Builder Floor" },
                      { id: "INDEPENDENT_HOUSE", label: "Independent House" },
                      { id: "VILLA", label: "Villa / Bungalow" },
                      { id: "PLOT", label: "Residential Plot" },
                      { id: "COMMERCIAL", label: "Commercial Unit" },
                      { id: "OTHER", label: "Other Typology" },
                    ].map((type) => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() =>
                          setPropertyType(
                            type.id as
                              | "APARTMENT"
                              | "INDEPENDENT_HOUSE"
                              | "VILLA"
                              | "BUILDER_FLOOR"
                              | "PLOT"
                              | "COMMERCIAL"
                              | "OTHER"
                          )
                        }
                        className={`py-2 px-3 rounded border text-center transition-all ${
                          propertyType === type.id
                            ? "bg-teal-50 border-teal-600 text-teal-900 font-semibold"
                            : "bg-crm-surface border-crm-border text-crm-muted hover:bg-stone-50"
                        }`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bedrooms (BHK) */}
                <div>
                  <label className="block font-semibold text-crm-text mb-2">
                    Bedrooms (BHK) <span className="text-red-500">*</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5, 6].map((bhk) => (
                      <button
                        key={bhk}
                        type="button"
                        onClick={() => setBedroomCount(bhk)}
                        className={`h-9 w-12 rounded border font-bold transition-all ${
                          bedroomCount === bhk
                            ? "bg-teal-600 border-teal-700 text-white shadow-2xs"
                            : "bg-crm-surface border-crm-border text-crm-text hover:bg-stone-50"
                        }`}
                      >
                        {bhk} BHK
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bathrooms and Balconies */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-crm-text mb-2">
                      Bathroom Count
                    </label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((bath) => (
                        <button
                          key={bath}
                          type="button"
                          onClick={() => setBathroomCount(bath)}
                          className={`h-8 w-10 rounded border font-semibold transition-all ${
                            bathroomCount === bath
                              ? "bg-teal-600 border-teal-700 text-white"
                              : "bg-crm-surface border-crm-border text-crm-muted hover:bg-stone-50"
                          }`}
                        >
                          {bath}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-crm-text mb-2">
                      Balconies
                    </label>
                    <div className="flex gap-2">
                      {[0, 1, 2, 3, 4].map((balc) => (
                        <button
                          key={balc}
                          type="button"
                          onClick={() => setBalconyCount(balc)}
                          className={`h-8 w-10 rounded border font-semibold transition-all ${
                            balconyCount === balc
                              ? "bg-teal-600 border-teal-700 text-white"
                              : "bg-crm-surface border-crm-border text-crm-muted hover:bg-stone-50"
                          }`}
                        >
                          {balc}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Location Details */}
            {currentStep === 3 && (
              <div className="space-y-4 text-xs">
                {duplicateWarning && (
                  <div className="p-3 rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-2">
                    <span className="text-base">⚠️</span>
                    <div className="space-y-1">
                      <div className="font-bold">Duplicate Inventory Warning</div>
                      <p>{duplicateWarning}</p>
                      <label className="flex items-center gap-1.5 pt-1 font-semibold text-amber-950 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={confirmDuplicate}
                          onChange={(e) => setConfirmDuplicate(e.target.checked)}
                          className="accent-amber-600"
                        />
                        <span>Confirm and proceed anyway (e.g. dual mandate or re-listing)</span>
                      </label>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Society / Project Name */}
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Society / Project Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. DLF The Aralias"
                      value={societyName}
                      onChange={(e) => setSocietyName(e.target.value)}
                      onBlur={handleCheckDuplicate}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                    {isCheckingDuplicate && (
                      <span className="text-[10px] text-crm-muted mt-0.5 block">Checking duplicates...</span>
                    )}
                  </div>

                  {/* Flat / Unit Number */}
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Flat / Unit Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Tower B - 1204"
                      value={flatNumber}
                      onChange={(e) => setFlatNumber(e.target.value)}
                      onBlur={handleCheckDuplicate}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>

                  {/* Locality / Sector */}
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Locality / Sector <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Sector 54, Golf Course Road"
                      value={localityName}
                      onChange={(e) => setLocalityName(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>

                  {/* City */}
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      City <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Gurugram"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: Property Profile & Specifications */}
            {currentStep === 4 && (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Area */}
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Property Area (sq.ft) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 2450"
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>

                  {/* Area Type */}
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Area Unit Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={areaType}
                      onChange={(e) =>
                        setAreaType(e.target.value as "SUPER_BUILT_UP" | "BUILT_UP" | "CARPET")
                      }
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    >
                      <option value="SUPER_BUILT_UP">Super Built-up Area</option>
                      <option value="BUILT_UP">Built-up Area</option>
                      <option value="CARPET">Carpet Area</option>
                    </select>
                  </div>
                </div>

                {/* Furnishing Status */}
                <div>
                  <label className="block font-semibold text-crm-text mb-2">
                    Furnishing Status <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: "UNFURNISHED", label: "Unfurnished" },
                      { id: "SEMI_FURNISHED", label: "Semi-Furnished" },
                      { id: "FURNISHED", label: "Fully Furnished" },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() =>
                          setFurnishingStatus(
                            f.id as "UNFURNISHED" | "SEMI_FURNISHED" | "FURNISHED"
                          )
                        }
                        className={`py-2 px-3 rounded border text-center transition-all ${
                          furnishingStatus === f.id
                            ? "bg-teal-50 border-teal-600 text-teal-900 font-semibold"
                            : "bg-crm-surface border-crm-border text-crm-muted hover:bg-stone-50"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Construction Status */}
                <div>
                  <label className="block font-semibold text-crm-text mb-2">
                    Construction / Possession Status <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3 max-w-md">
                    <button
                      type="button"
                      onClick={() => setConstructionStatus("READY_TO_MOVE")}
                      className={`py-2 px-3 rounded border text-center transition-all ${
                        constructionStatus === "READY_TO_MOVE"
                          ? "bg-teal-50 border-teal-600 text-teal-900 font-semibold"
                          : "bg-crm-surface border-crm-border text-crm-muted hover:bg-stone-50"
                      }`}
                    >
                      🏢 Ready to Move
                    </button>
                    <button
                      type="button"
                      onClick={() => setConstructionStatus("UNDER_CONSTRUCTION")}
                      className={`py-2 px-3 rounded border text-center transition-all ${
                        constructionStatus === "UNDER_CONSTRUCTION"
                          ? "bg-teal-50 border-teal-600 text-teal-900 font-semibold"
                          : "bg-crm-surface border-crm-border text-crm-muted hover:bg-stone-50"
                      }`}
                    >
                      🏗️ Under Construction
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5: Photos & Walkthrough */}
            {currentStep === 5 && (
              <div className="space-y-5 text-xs">
                {/* Photo Upload Dropzone */}
                <div>
                  <label className="block font-semibold text-crm-text mb-1">
                    Property Photos (Max 10 images)
                  </label>
                  <p className="text-[11px] text-crm-muted mb-2">
                    Accepts JPEG, PNG, or WEBP up to 10MB per file. Authenticated tenant serving prevents unauthorized external hotlinking.
                  </p>

                  <div className="p-5 border-2 border-dashed border-crm-border rounded-lg bg-stone-50/50 text-center hover:bg-stone-50 transition-colors">
                    <input
                      type="file"
                      id="property-photo-input"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                    <label
                      htmlFor="property-photo-input"
                      className="cursor-pointer inline-flex flex-col items-center gap-1.5"
                    >
                      <span className="text-2xl">📸</span>
                      <span className="font-semibold text-crm-primary hover:underline">
                        Click to select photos
                      </span>
                      <span className="text-[11px] text-crm-muted">
                        Living room, master bedroom, kitchen, balcony, society facade
                      </span>
                    </label>
                  </div>

                  {/* Photo Thumbnails */}
                  {selectedPhotos.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                      {selectedPhotos.map((photo, index) => (
                        <div
                          key={index}
                          className="relative rounded border border-crm-border bg-crm-surface overflow-hidden p-2 space-y-1.5"
                        >
                          <div className="relative h-24 w-full bg-stone-100 rounded overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo.previewUrl}
                              alt={photo.file.name}
                              className="w-full h-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => handleRemovePhoto(index)}
                              className="absolute top-1 right-1 bg-red-600 text-white rounded-full h-5 w-5 flex items-center justify-center text-[10px] font-bold shadow-xs hover:bg-red-700"
                              title="Remove photo"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="text-[10px] text-crm-muted truncate">
                            {photo.file.name} ({(photo.file.size / 1024).toFixed(0)} KB)
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* YouTube Walkthrough Link */}
                <div className="pt-3 border-t border-crm-border">
                  <label className="block font-semibold text-crm-text mb-1">
                    YouTube Walkthrough Video URL
                  </label>
                  <p className="text-[11px] text-crm-muted mb-2">
                    Paste public or unlisted YouTube video URL (e.g. https://www.youtube.com/watch?v=... or https://youtu.be/...)
                  </p>
                  <input
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden mb-2"
                  />
                  <input
                    type="text"
                    placeholder="Caption (e.g. 3BHK Walkthrough Tour)"
                    value={videoCaption}
                    onChange={(e) => setVideoCaption(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                  />
                </div>
              </div>
            )}

            {/* STEP 6: Amenities */}
            {currentStep === 6 && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-crm-text mb-2">
                    Society & Unit Amenities Checklist
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {PREDEFINED_AMENITIES.map((item) => {
                      const isChecked = amenities.includes(item);
                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() => {
                            if (isChecked) {
                              setAmenities(amenities.filter((a) => a !== item));
                            } else {
                              setAmenities([...amenities, item]);
                            }
                          }}
                          className={`p-2.5 rounded border text-left flex items-center transition-all ${
                            isChecked
                              ? "bg-teal-50 border-teal-600 text-teal-900 font-semibold"
                              : "bg-crm-surface border-crm-border text-crm-muted hover:bg-stone-50"
                          }`}
                        >
                          <span className="mr-1.5">{isChecked ? "✓" : "+"}</span>
                          {item}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom Amenity Adder */}
                <div className="pt-3 border-t border-crm-border">
                  <label className="block font-semibold text-crm-text mb-1">
                    Add Custom Amenity
                  </label>
                  <div className="flex gap-2 max-w-md">
                    <input
                      type="text"
                      placeholder="e.g. Private Terrace, Electric Car Charger"
                      value={customAmenityInput}
                      onChange={(e) => setCustomAmenityInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddCustomAmenity();
                        }
                      }}
                      className="flex-1 px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomAmenity}
                      className="px-3 py-1.5 rounded bg-stone-100 text-crm-text border border-crm-border font-semibold hover:bg-stone-200"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 7: Pricing & Final Review */}
            {currentStep === 7 && (
              <div className="space-y-6 text-xs">
                {/* Price / Rent Input */}
                <div className="p-4 rounded-lg bg-stone-50/60 border border-crm-border space-y-3">
                  <label className="block font-bold text-sm text-crm-text">
                    {preference === "SALE" ? "Expected Resale Price (INR)" : "Monthly Rent (INR)"}{" "}
                    <span className="text-red-500">*</span>
                  </label>
                  <div className="relative max-w-sm">
                    <input
                      type="number"
                      placeholder={preference === "SALE" ? "e.g. 15000000" : "e.g. 45000"}
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="w-full pl-7 pr-3 py-2 rounded border border-crm-border bg-white focus:outline-hidden font-semibold text-sm"
                    />
                    <span className="absolute left-2.5 top-2 text-crm-muted font-bold">₹</span>
                  </div>
                  {formattedPricePreview && (
                    <div className="text-xs font-bold text-teal-800">
                      Formatted: {formattedPricePreview}
                    </div>
                  )}
                </div>

                {/* Optional Key-Holder Section */}
                <div className="pt-2 border-t border-crm-border space-y-3">
                  <label className="flex items-center gap-2 font-semibold text-crm-text cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasKeyHolder}
                      onChange={(e) => setHasKeyHolder(e.target.checked)}
                      className="accent-crm-primary"
                    />
                    <span>Keys available with local Key-Holder (Guard, Maintenance, Neighbour)</span>
                  </label>

                  {hasKeyHolder && (
                    <div className="p-4 rounded-md border border-crm-border bg-stone-50/50 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block font-medium text-crm-muted mb-1">
                            Key-Holder Persona
                          </label>
                          <select
                            value={khPersona}
                            onChange={(e) =>
                              setKhPersona(
                                e.target.value as "GUARD" | "MAINTENANCE_OFFICE" | "NEIGHBOUR" | "OWNER" | "OTHER"
                              )
                            }
                            className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-white"
                          >
                            <option value="GUARD">Security Guard</option>
                            <option value="MAINTENANCE_OFFICE">Maintenance Office</option>
                            <option value="NEIGHBOUR">Neighbour</option>
                            <option value="OWNER">Owner (Self)</option>
                            <option value="OTHER">Other Contact</option>
                          </select>
                        </div>

                        <div>
                          <label className="block font-medium text-crm-muted mb-1">
                            Key-Holder Name
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Ram Singh"
                            value={khName}
                            onChange={(e) => setKhName(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-white"
                          />
                        </div>

                        <div>
                          <label className="block font-medium text-crm-muted mb-1">
                            Key-Holder Mobile
                          </label>
                          <input
                            type="tel"
                            placeholder="e.g. 98123 45678"
                            value={khMobile}
                            onChange={(e) => setKhMobile(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-white"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block font-medium text-crm-muted mb-1">
                          Key Pickup Notes / Location
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Gate 2 Guard Room, register entry required"
                          value={khNotes}
                          onChange={(e) => setKhNotes(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-white"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Review Summary Cards */}
                <div className="space-y-3 pt-2 border-t border-crm-border">
                  <h3 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                    Full Property Listing Summary
                  </h3>

                  {/* 1. Owner Contact */}
                  <div className="p-3.5 rounded border border-crm-border bg-stone-50/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-crm-text text-[11px]">
                        1. Owner Contact Details
                      </span>
                      <button
                        type="button"
                        onClick={() => jumpToStep(1)}
                        className="text-crm-primary font-semibold hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-crm-text">
                      <div>
                        <span className="text-crm-muted block text-[10px]">Owner Name:</span>
                        <strong>{ownerName}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Owner Mobile:</span>
                        <strong>{ownerMobile}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Alternate Phone:</span>
                        <span>{ownerAlternatePhone || "—"}</span>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">City / Locality:</span>
                        <span>{city} {localityName ? `(${localityName})` : ""}</span>
                      </div>
                    </div>
                  </div>

                  {/* 2. Basic Details */}
                  <div className="p-3.5 rounded border border-crm-border bg-stone-50/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-crm-text text-[11px]">
                        2. Basic Details
                      </span>
                      <button
                        type="button"
                        onClick={() => jumpToStep(2)}
                        className="text-crm-primary font-semibold hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-crm-text">
                      <div>
                        <span className="text-crm-muted block text-[10px]">Mode:</span>
                        <strong>{preference === "SALE" ? "Resale (Sale)" : "Rental"}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Typology:</span>
                        <strong>{propertyType}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Layout:</span>
                        <strong>{bedroomCount} BHK • {bathroomCount} Baths</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Balconies:</span>
                        <strong>{balconyCount}</strong>
                      </div>
                    </div>
                  </div>

                  {/* 3. Location Details */}
                  <div className="p-3.5 rounded border border-crm-border bg-stone-50/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-crm-text text-[11px]">
                        3. Location Details
                      </span>
                      <button
                        type="button"
                        onClick={() => jumpToStep(3)}
                        className="text-crm-primary font-semibold hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-crm-text">
                      <div>
                        <span className="text-crm-muted block text-[10px]">Society:</span>
                        <strong>{societyName}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Flat / Unit:</span>
                        <strong>{flatNumber}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Locality:</span>
                        <strong>{localityName}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">City:</span>
                        <strong>{city}</strong>
                      </div>
                    </div>
                  </div>

                  {/* 4. Specifications */}
                  <div className="p-3.5 rounded border border-crm-border bg-stone-50/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-crm-text text-[11px]">
                        4. Property Profile
                      </span>
                      <button
                        type="button"
                        onClick={() => jumpToStep(4)}
                        className="text-crm-primary font-semibold hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-crm-text">
                      <div>
                        <span className="text-crm-muted block text-[10px]">Area:</span>
                        <strong>{area} sq.ft ({areaType})</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Furnishing:</span>
                        <strong>{furnishingStatus}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Possession:</span>
                        <strong>{constructionStatus}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Amenities:</span>
                        <strong>{amenities.length} selected</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Stepper Navigation Footer Buttons */}
            {currentStep > 1 && (
              <div className="flex items-center justify-between pt-5 border-t border-crm-border">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleBack}
                  className="px-4 py-2 text-xs font-semibold rounded border border-crm-border text-crm-muted hover:text-crm-text hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ← Back
                </button>

                {currentStep < 7 ? (
                  <button
                    type="button"
                    onClick={handleNext}
                    className="px-5 py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs cursor-pointer"
                  >
                    Continue to Step {currentStep + 1} →
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleSubmit}
                    className="px-6 py-2.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    {isSubmitting ? "Creating Property & Attaching Media..." : "Confirm & Post Property"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </AppShell>
  );
}
