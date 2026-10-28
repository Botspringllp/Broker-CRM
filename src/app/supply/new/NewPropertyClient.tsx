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
  { id: 1, name: "Basic Details", desc: "Type, BHK, and layout" },
  { id: 2, name: "Location Details", desc: "Society, unit, and locality" },
  { id: 3, name: "Property Profile", desc: "Area, furnishing, condition" },
  { id: 4, name: "Photos & Video", desc: "Upload images & walkthrough" },
  { id: 5, name: "Amenities", desc: "Society & unit facilities" },
  { id: 6, name: "Owner & Pricing", desc: "Price, contacts, key-holder" },
  { id: 7, name: "Review & Submit", desc: "Final verification & publish" },
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Step 1: Basic Details
  const [preference, setPreference] = useState<"SALE" | "RENT">("SALE");
  const [propertyType, setPropertyType] = useState<
    "APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT" | "COMMERCIAL" | "OTHER"
  >("APARTMENT");
  const [bedroomCount, setBedroomCount] = useState<number>(3);
  const [bathroomCount, setBathroomCount] = useState<number>(3);
  const [balconyCount, setBalconyCount] = useState<number>(1);

  // Step 2: Location Details
  const [city, setCity] = useState("Gurugram");
  const [localityName, setLocalityName] = useState("");
  const [societyName, setSocietyName] = useState("");
  const [flatNumber, setFlatNumber] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);

  // Step 3: Property Profile
  const [area, setArea] = useState("");
  const [areaType, setAreaType] = useState<"SUPER_BUILT_UP" | "BUILT_UP" | "CARPET">("SUPER_BUILT_UP");
  const [furnishingStatus, setFurnishingStatus] = useState<
    "UNFURNISHED" | "SEMI_FURNISHED" | "FURNISHED"
  >("SEMI_FURNISHED");
  const [constructionStatus, setConstructionStatus] = useState<
    "READY_TO_MOVE" | "UNDER_CONSTRUCTION"
  >("READY_TO_MOVE");

  // Step 4: Photos & Videos
  const [selectedPhotos, setSelectedPhotos] = useState<PhotoItem[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [videoCaption, setVideoCaption] = useState("");

  // Step 5: Amenities
  const [amenities, setAmenities] = useState<string[]>([
    "Lift / Elevator",
    "24x7 Power Backup",
    "24x7 Security & CCTV",
  ]);
  const [customAmenityInput, setCustomAmenityInput] = useState("");

  // Step 6: Owner & Pricing
  const [price, setPrice] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerMobile, setOwnerMobile] = useState("");
  const [hasKeyHolder, setHasKeyHolder] = useState(false);
  const [khName, setKhName] = useState("");
  const [khMobile, setKhMobile] = useState("");
  const [khPersona, setKhPersona] = useState<
    "GUARD" | "MAINTENANCE_OFFICE" | "NEIGHBOUR" | "OWNER" | "OTHER"
  >("GUARD");
  const [khNotes, setKhNotes] = useState("");

  // Real-time duplicate check
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

  // Step Validation before proceeding
  const validateStep = (step: number): boolean => {
    setStepError(null);

    if (step === 1) {
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

    if (step === 2) {
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

    if (step === 3) {
      const parsedArea = parseFloat(area);
      if (isNaN(parsedArea) || parsedArea <= 0) {
        setStepError("Please enter a valid property area in square feet.");
        return false;
      }
      return true;
    }

    if (step === 4) {
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

    if (step === 5) {
      // Amenities are optional
      return true;
    }

    if (step === 6) {
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice) || parsedPrice <= 0) {
        setStepError(
          preference === "SALE"
            ? "Please enter a valid sale price in INR."
            : "Please enter a valid monthly rent in INR."
        );
        return false;
      }
      if (!ownerName.trim()) {
        setStepError("Owner full name is required.");
        return false;
      }
      const cleanMobile = ownerMobile.replace(/\D/g, "");
      const normalized =
        cleanMobile.length === 12 && cleanMobile.startsWith("91")
          ? cleanMobile.slice(2)
          : cleanMobile.length === 11 && cleanMobile.startsWith("0")
          ? cleanMobile.slice(1)
          : cleanMobile;

      if (!/^[6-9]\d{9}$/.test(normalized)) {
        setStepError("Owner mobile must be a valid 10-digit Indian mobile number.");
        return false;
      }

      if (hasKeyHolder && khMobile.trim()) {
        const cleanKh = khMobile.replace(/\D/g, "");
        const khNormalized =
          cleanKh.length === 12 && cleanKh.startsWith("91")
            ? cleanKh.slice(2)
            : cleanKh.length === 11 && cleanKh.startsWith("0")
            ? cleanKh.slice(1)
            : cleanKh;
        if (!/^[6-9]\d{9}$/.test(khNormalized)) {
          setStepError("Key-holder mobile must be a valid 10-digit Indian mobile number.");
          return false;
        }
      }
      return true;
    }

    return true;
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

  // Final Submission
  const handleSubmit = async () => {
    if (!validateStep(6)) {
      setCurrentStep(6);
      return;
    }

    setIsSubmitting(true);
    setStepError(null);

    try {
      const cleanOwner = ownerMobile.replace(/\D/g, "");
      const normalizedOwner =
        cleanOwner.length === 12 && cleanOwner.startsWith("91")
          ? cleanOwner.slice(2)
          : cleanOwner.length === 11 && cleanOwner.startsWith("0")
          ? cleanOwner.slice(1)
          : cleanOwner;

      let keyHolderPayload = null;
      if (hasKeyHolder && khName.trim()) {
        const cleanKh = khMobile.replace(/\D/g, "");
        const normalizedKh =
          cleanKh.length === 12 && cleanKh.startsWith("91")
            ? cleanKh.slice(2)
            : cleanKh.length === 11 && cleanKh.startsWith("0")
            ? cleanKh.slice(1)
            : cleanKh;

        keyHolderPayload = {
          name: khName.trim(),
          mobile: normalizedKh || normalizedOwner,
          persona: khPersona,
          notes: khNotes.trim() || undefined,
        };
      }

      // 1. Create property
      const res = await createPropertyAction({
        societyName: societyName.trim(),
        flatNumber: flatNumber.trim(),
        localityName: localityName.trim(),
        city: city.trim(),
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
        ownerName: ownerName.trim(),
        ownerMobile: normalizedOwner,
        amenities,
        keyHolder: keyHolderPayload,
        confirmDuplicate,
      });

      if (!res.success) {
        if (res.isDuplicate) {
          setDuplicateWarning(res.error);
          setCurrentStep(2);
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

      setToastMessage(`Property posted successfully: ${res.property.societyName} (${res.property.flatNumber})`);

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

        {/* Wizard Layout: Left Stepper (4 cols) & Right Form Card (8 cols) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Vertical Stepper Sidebar */}
          <div className="lg:col-span-4 bg-crm-surface rounded-lg border border-crm-border p-5 shadow-2xs sticky top-4">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-crm-border">
              <span className="text-xs font-bold text-crm-text uppercase tracking-wider">
                Progress
              </span>
              <span className="text-xs font-semibold text-crm-primary">
                Step {currentStep} of {STEPS.length}
              </span>
            </div>

            <nav aria-label="Progress Stepper" className="space-y-1">
              {STEPS.map((step, idx) => {
                const isCompleted = step.id < currentStep;
                const isCurrent = step.id === currentStep;
                const isClickable = step.id <= highestStepReached;

                return (
                  <div key={step.id} className="relative">
                    {/* Connecting line */}
                    {idx < STEPS.length - 1 && (
                      <span
                        className={`absolute left-3.5 top-8 -bottom-1 w-0.5 ${
                          step.id < currentStep ? "bg-emerald-500" : "bg-stone-200"
                        }`}
                        aria-hidden="true"
                      />
                    )}

                    <button
                      type="button"
                      disabled={!isClickable || isSubmitting}
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
                {currentStep === 1 && "Basic Property Information"}
                {currentStep === 2 && "Location & Society Identification"}
                {currentStep === 3 && "Property Profile & Specifications"}
                {currentStep === 4 && "Photos & Video Walkthrough"}
                {currentStep === 5 && "Society & Unit Amenities"}
                {currentStep === 6 && "Owner Contact & Pricing"}
                {currentStep === 7 && "Review Property & Submit"}
              </h2>
              <p className="text-xs text-crm-muted mt-1">
                {STEPS[currentStep - 1]?.desc}
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

            {/* Step 1: Basic Details */}
            {currentStep === 1 && (
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

                {/* Property Type */}
                <div>
                  <label className="block font-semibold text-crm-text mb-2">
                    Property Typology <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {[
                      { val: "APARTMENT", label: "Apartment / Flat" },
                      { val: "BUILDER_FLOOR", label: "Builder Floor" },
                      { val: "INDEPENDENT_HOUSE", label: "Independent House" },
                      { val: "VILLA", label: "Villa / Bungalow" },
                      { val: "PLOT", label: "Residential Plot" },
                      { val: "COMMERCIAL", label: "Commercial Unit" },
                      { val: "OTHER", label: "Other Typology" },
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() =>
                          setPropertyType(
                            item.val as
                              | "APARTMENT"
                              | "INDEPENDENT_HOUSE"
                              | "VILLA"
                              | "BUILDER_FLOOR"
                              | "PLOT"
                              | "COMMERCIAL"
                              | "OTHER"
                          )
                        }
                        className={`p-2.5 rounded border text-left text-xs transition-all ${
                          propertyType === item.val
                            ? "bg-teal-50 border-teal-600 text-teal-900 font-semibold"
                            : "bg-crm-surface border-crm-border text-crm-muted hover:bg-stone-50 hover:text-crm-text"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* BHK / Bedroom Configuration */}
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
                        className={`w-14 py-2 rounded text-xs border text-center font-semibold transition-all ${
                          bedroomCount === bhk
                            ? "bg-teal-600 text-white border-teal-600"
                            : "bg-crm-surface border-crm-border text-crm-muted hover:bg-stone-50 hover:text-crm-text"
                        }`}
                      >
                        {bhk} BHK
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bathrooms & Balconies */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Bathroom Count
                    </label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((bath) => (
                        <button
                          key={bath}
                          type="button"
                          onClick={() => setBathroomCount(bath)}
                          className={`w-10 py-1.5 rounded text-xs border text-center font-medium ${
                            bathroomCount === bath
                              ? "bg-teal-600 text-white border-teal-600"
                              : "bg-crm-surface border-crm-border text-crm-muted hover:bg-stone-50"
                          }`}
                        >
                          {bath}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Balconies
                    </label>
                    <div className="flex gap-2">
                      {[0, 1, 2, 3, 4].map((balc) => (
                        <button
                          key={balc}
                          type="button"
                          onClick={() => setBalconyCount(balc)}
                          className={`w-10 py-1.5 rounded text-xs border text-center font-medium ${
                            balconyCount === balc
                              ? "bg-teal-600 text-white border-teal-600"
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

            {/* Step 2: Location Details */}
            {currentStep === 2 && (
              <div className="space-y-4 text-xs">
                {duplicateWarning && (
                  <div className="p-3 rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-xs space-y-2">
                    <div className="font-bold flex items-center gap-1.5">
                      <span>⚠️ Potential Duplicate Listing Detected</span>
                    </div>
                    <p>{duplicateWarning}</p>
                    <label className="flex items-center gap-2 pt-1 font-semibold text-amber-950 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmDuplicate}
                        onChange={(e) => setConfirmDuplicate(e.target.checked)}
                        className="accent-amber-700"
                      />
                      I confirm this is an intentional separate entry
                    </label>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      City / Primary Market <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Gurugram, Noida, Delhi"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Locality / Sector Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. DLF Phase 5, Golf Course Road, Sector 54"
                      value={localityName}
                      onChange={(e) => setLocalityName(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Society / Condominium / Project <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. The Camellias, DLF The Aralias"
                      value={societyName}
                      onChange={(e) => setSocietyName(e.target.value)}
                      onBlur={handleCheckDuplicate}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Flat / Unit / Villa Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Tower 3 Flat 402, Villa 12"
                      value={flatNumber}
                      onChange={(e) => setFlatNumber(e.target.value)}
                      onBlur={handleCheckDuplicate}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                    {isCheckingDuplicate && (
                      <span className="text-[10px] text-crm-muted mt-1 block">
                        Checking brokerage records for duplicates...
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-3 rounded bg-stone-50 border border-crm-border text-[11px] text-crm-muted">
                  <strong>Privacy Rule (PRD §8.2):</strong> Exact unit and flat numbers are never exposed in buyer-facing links, shared brochures, or unauthenticated views. Only confirmed clients receive viewing access.
                </div>
              </div>
            )}

            {/* Step 3: Property Profile */}
            {currentStep === 3 && (
              <div className="space-y-5 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Property Area (Square Feet) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 1850"
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Area Measurement Type
                    </label>
                    <select
                      value={areaType}
                      onChange={(e) =>
                        setAreaType(
                          e.target.value as "SUPER_BUILT_UP" | "BUILT_UP" | "CARPET"
                        )
                      }
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    >
                      <option value="SUPER_BUILT_UP">Super Built-up Area</option>
                      <option value="BUILT_UP">Built-up Area</option>
                      <option value="CARPET">Carpet Area (RERA)</option>
                    </select>
                  </div>
                </div>

                {/* Furnishing Status */}
                <div>
                  <label className="block font-semibold text-crm-text mb-2">
                    Furnishing Status
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { val: "UNFURNISHED", label: "Unfurnished" },
                      { val: "SEMI_FURNISHED", label: "Semi-Furnished" },
                      { val: "FURNISHED", label: "Fully Furnished" },
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() =>
                          setFurnishingStatus(
                            item.val as "UNFURNISHED" | "SEMI_FURNISHED" | "FURNISHED"
                          )
                        }
                        className={`py-2 px-3 rounded border text-center transition-all ${
                          furnishingStatus === item.val
                            ? "bg-teal-50 border-teal-600 text-teal-900 font-semibold"
                            : "bg-crm-surface border-crm-border text-crm-muted hover:bg-stone-50"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Construction Status */}
                <div>
                  <label className="block font-semibold text-crm-text mb-2">
                    Construction & Possession Status
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
                      ✓ Ready to Move
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

            {/* Step 4: Photos & Videos */}
            {currentStep === 4 && (
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
                    placeholder="Video caption (e.g. Complete 3 BHK Walkthrough with Terrace)"
                    value={videoCaption}
                    onChange={(e) => setVideoCaption(e.target.value)}
                    className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden text-xs"
                  />
                </div>
              </div>
            )}

            {/* Step 5: Amenities */}
            {currentStep === 5 && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-crm-text mb-1">
                    Selected Amenities & Facilities ({amenities.length})
                  </label>
                  <p className="text-[11px] text-crm-muted mb-3">
                    Check all applicable features for prospective buyers and tenants.
                  </p>

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
                          className={`p-2 rounded border text-left text-xs transition-all ${
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

            {/* Step 6: Owner & Pricing */}
            {currentStep === 6 && (
              <div className="space-y-4 text-xs">
                {/* Price / Rent Input */}
                <div>
                  <label className="block font-semibold text-crm-text mb-1">
                    {preference === "SALE" ? "Expected Sale Price (INR)" : "Monthly Rent (INR)"}{" "}
                    <span className="text-red-500">*</span>
                  </label>
                  <div className="relative max-w-sm">
                    <input
                      type="number"
                      placeholder={preference === "SALE" ? "e.g. 15000000" : "e.g. 45000"}
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="w-full pl-7 pr-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden font-semibold"
                    />
                    <span className="absolute left-2.5 top-2 text-crm-muted">₹</span>
                  </div>
                  {formattedPricePreview && (
                    <div className="text-xs font-bold text-teal-800 mt-1">
                      Preview: {formattedPricePreview}
                    </div>
                  )}
                </div>

                {/* Owner Contacts */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-crm-border">
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Owner Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Rajesh Singhal"
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Owner Mobile (10-Digit Indian Mobile) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      placeholder="e.g. 98100 12345"
                      value={ownerMobile}
                      onChange={(e) => setOwnerMobile(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* Optional Key-Holder Section */}
                <div className="pt-3 border-t border-crm-border space-y-3">
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
                            placeholder="e.g. Ram Bahadur (Tower A)"
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
                            placeholder="Optional 10-digit number"
                            value={khMobile}
                            onChange={(e) => setKhMobile(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-white"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block font-medium text-crm-muted mb-1">
                          Key Access Instructions / Notes
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Collect keys from main gate security cabin between 10 AM - 5 PM"
                          value={khNotes}
                          onChange={(e) => setKhNotes(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-white"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 7: Review & Submit */}
            {currentStep === 7 && (
              <div className="space-y-4 text-xs">
                <div className="p-3 rounded-md bg-teal-50/70 border border-teal-200 text-teal-900 text-xs">
                  Please review the property specifications and contacts before publishing. You can click <strong>Edit</strong> on any section below to jump back and adjust details.
                </div>

                {duplicateWarning && (
                  <div className="p-3 rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-xs">
                    <strong>Notice:</strong> This listing matches an existing unit. Ensure you have checked the confirmation box on Step 2.
                  </div>
                )}

                {/* Section Review Cards */}
                <div className="space-y-3">
                  {/* Basic & Location */}
                  <div className="p-3.5 rounded border border-crm-border bg-stone-50/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                        1 & 2. Basic Details & Location
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
                        <span className="text-crm-muted block text-[10px]">Listing:</span>
                        <strong className="text-teal-800">{preference === "SALE" ? "Resale (Sale)" : "Rental"}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Type & Layout:</span>
                        <strong>{bedroomCount} BHK {propertyType.replace(/_/g, " ")}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Society & Unit:</span>
                        <strong>{societyName} ({flatNumber})</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">City & Locality:</span>
                        <strong>{localityName}, {city}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Profile & Specs */}
                  <div className="p-3.5 rounded border border-crm-border bg-stone-50/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                        3. Property Profile
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
                        <span className="text-crm-muted block text-[10px]">Area:</span>
                        <strong>{area} sq ft ({areaType.replace(/_/g, " ")})</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Bathrooms:</span>
                        <strong>{bathroomCount} Baths • {balconyCount} Balconies</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Furnishing:</span>
                        <strong>{furnishingStatus.replace(/_/g, " ")}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Possession:</span>
                        <strong>{constructionStatus.replace(/_/g, " ")}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Media & Amenities */}
                  <div className="p-3.5 rounded border border-crm-border bg-stone-50/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                        4 & 5. Media & Amenities
                      </span>
                      <button
                        type="button"
                        onClick={() => jumpToStep(4)}
                        className="text-crm-primary font-semibold hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="space-y-1.5 text-crm-text">
                      <div>
                        <span className="text-crm-muted mr-1.5">Attached Photos:</span>
                        <strong>{selectedPhotos.length} photos selected</strong>
                      </div>
                      {youtubeUrl.trim() && (
                        <div>
                          <span className="text-crm-muted mr-1.5">Video Tour:</span>
                          <span className="font-mono text-[11px] text-teal-800">{youtubeUrl}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-crm-muted mr-1.5">Amenities ({amenities.length}):</span>
                        <span className="text-[11px]">{amenities.join(", ") || "None"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Owner & Pricing */}
                  <div className="p-3.5 rounded border border-crm-border bg-stone-50/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                        6. Owner Details & Pricing
                      </span>
                      <button
                        type="button"
                        onClick={() => jumpToStep(6)}
                        className="text-crm-primary font-semibold hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-crm-text">
                      <div>
                        <span className="text-crm-muted block text-[10px]">Expected Price / Rent:</span>
                        <strong className="text-sm font-bold text-teal-900">
                          {formattedPricePreview || `₹${price}`}
                        </strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Owner Name:</span>
                        <strong>{ownerName}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Owner Mobile:</span>
                        <strong>{ownerMobile}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Stepper Navigation Buttons */}
            <div className="flex items-center justify-between pt-5 border-t border-crm-border">
              <button
                type="button"
                disabled={currentStep === 1 || isSubmitting}
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
                  className="px-6 py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                >
                  {isSubmitting ? "Creating Property & Attaching Media..." : "Confirm & Post Property"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </AppShell>
  );
}
