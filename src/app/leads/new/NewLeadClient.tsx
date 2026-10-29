"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { Toast } from "@/components/ui/Toast";
import { createLeadAction } from "../actions";
import { formatIndianCurrency } from "@/server/dal/mappers";

interface EligibleTelecaller {
  id: string;
  name: string;
  email: string;
  phone: string;
}

interface NewLeadClientProps {
  userRole: string;
  userName: string;
  canAssignTelecaller: boolean;
  eligibleTelecallers: EligibleTelecaller[];
}

const STEPS = [
  { id: 1, name: "Basic Info", desc: "Prospect contact & origin" },
  { id: 2, name: "Requirements", desc: "Type, BHK & budget range" },
  { id: 3, name: "Location", desc: "City, locality & societies" },
  { id: 4, name: "Specifications", desc: "Area size & special notes" },
  { id: 5, name: "Review & Submit", desc: "Verification & registration" },
];

const PROPERTY_TYPES: { label: string; value: "APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT" }[] = [
  { label: "Apartment / High-rise", value: "APARTMENT" },
  { label: "Independent House", value: "INDEPENDENT_HOUSE" },
  { label: "Villa / Bungalow", value: "VILLA" },
  { label: "Builder Floor", value: "BUILDER_FLOOR" },
  { label: "Residential Plot", value: "PLOT" },
];

const BHK_OPTIONS = ["1 BHK", "2 BHK", "3 BHK", "4 BHK", "5+ BHK"];

const SOURCES = [
  "99acres",
  "MagicBricks",
  "Housing.com",
  "Direct Inquiry",
  "Referral",
  "Walk-in",
  "Website Form",
  "Social Media",
  "Other",
];

const SALE_BUDGET_PRESETS = [
  { label: "₹30 L", min: 2500000, max: 3500000 },
  { label: "₹50 L", min: 4000000, max: 6000000 },
  { label: "₹1.0 Cr", min: 8000000, max: 12000000 },
  { label: "₹1.5 Cr", min: 12000000, max: 18000000 },
  { label: "₹2.5 Cr", min: 20000000, max: 30000000 },
  { label: "₹5.0 Cr+", min: 45000000, max: 60000000 },
];

const RENT_BUDGET_PRESETS = [
  { label: "₹15k - ₹25k", min: 15000, max: 25000 },
  { label: "₹25k - ₹40k", min: 25000, max: 40000 },
  { label: "₹40k - ₹60k", min: 40000, max: 60000 },
  { label: "₹60k - ₹1.0L", min: 60000, max: 100000 },
  { label: "₹1.0L - ₹1.5L", min: 100000, max: 150000 },
  { label: "₹1.5L+", min: 150000, max: 250000 },
];

export function NewLeadClient({
  canAssignTelecaller,
  eligibleTelecallers,
}: NewLeadClientProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [highestStepReached, setHighestStepReached] = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Step 1: Basic Information
  const [name, setName] = useState("");
  const [primaryPhone, setPrimaryPhone] = useState("");
  const [alternatePhone, setAlternatePhone] = useState("");
  const [email, setEmail] = useState("");
  const [originalSource, setOriginalSource] = useState("Direct Inquiry");
  const [assignedTelecallerId, setAssignedTelecallerId] = useState("");

  // Step 2: Property Requirements
  const [preference, setPreference] = useState<"SALE" | "RENT">("SALE");
  const [selectedTypes, setSelectedTypes] = useState<
    ("APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT")[]
  >(["APARTMENT"]);
  const [selectedBhks, setSelectedBhks] = useState<string[]>(["2 BHK", "3 BHK"]);
  const [minBudget, setMinBudget] = useState("5000000"); // 50 L
  const [maxBudget, setMaxBudget] = useState("15000000"); // 1.5 Cr

  // Step 3: Location Preferences
  const [city, setCity] = useState("Gurugram");
  const [localitiesInput, setLocalitiesInput] = useState("Golf Course Road, DLF Phase 5");
  const [societiesInput, setSocietiesInput] = useState("");

  // Step 4: Additional Requirements
  const [targetArea, setTargetArea] = useState("");
  const [areaType, setAreaType] = useState<"CARPET" | "BUILT_UP" | "SUPER_BUILT_UP">("SUPER_BUILT_UP");
  const [notes, setNotes] = useState("");

  // Handlers for selection
  const togglePropertyType = (type: "APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT") => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const toggleBhk = (bhk: string) => {
    setSelectedBhks((prev) =>
      prev.includes(bhk) ? prev.filter((b) => b !== bhk) : [...prev, bhk]
    );
  };

  const applyBudgetPreset = (min: number, max: number) => {
    setMinBudget(min.toString());
    setMaxBudget(max.toString());
  };

  // Validation
  const validateStep = (step: number): boolean => {
    setStepError(null);

    if (step === 1) {
      if (!name.trim()) {
        setStepError("Prospect name is mandatory.");
        return false;
      }
      const digits = primaryPhone.replace(/\D/g, "");
      if (digits.length < 10) {
        setStepError("A valid 10-digit primary mobile number is required.");
        return false;
      }
      if (alternatePhone.trim()) {
        const altDigits = alternatePhone.replace(/\D/g, "");
        if (altDigits.length < 10) {
          setStepError("Alternate phone number must have at least 10 digits if provided.");
          return false;
        }
      }
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setStepError("Please enter a valid email address.");
        return false;
      }
      if (!originalSource.trim()) {
        setStepError("Inquiry source is required.");
        return false;
      }
      return true;
    }

    if (step === 2) {
      const minB = parseFloat(minBudget);
      const maxB = parseFloat(maxBudget);
      if (isNaN(minB) || minB < 0) {
        setStepError("Please provide a valid non-negative minimum budget.");
        return false;
      }
      if (isNaN(maxB) || maxB < 0) {
        setStepError("Please provide a valid non-negative maximum budget.");
        return false;
      }
      if (maxB < minB) {
        setStepError("Maximum budget cannot be less than minimum budget.");
        return false;
      }
      if (selectedTypes.length === 0) {
        setStepError("Please select at least one property type.");
        return false;
      }
      if (selectedBhks.length === 0 && !selectedTypes.includes("PLOT")) {
        setStepError("Please select at least one bedroom configuration.");
        return false;
      }
      return true;
    }

    if (step === 3) {
      if (!city.trim()) {
        setStepError("Target city is required.");
        return false;
      }
      return true;
    }

    if (step === 4) {
      if (targetArea.trim()) {
        const areaNum = parseFloat(targetArea);
        if (isNaN(areaNum) || areaNum <= 0) {
          setStepError("Target area must be a positive number if provided.");
          return false;
        }
      }
      return true;
    }

    return true;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      if (nextStep > highestStepReached) {
        setHighestStepReached(nextStep);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleBack = () => {
    setStepError(null);
    setCurrentStep((prev) => Math.max(1, prev - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleStepClick = (stepId: number) => {
    if (stepId <= highestStepReached) {
      setStepError(null);
      setCurrentStep(stepId);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleSubmit = async () => {
    if (!validateStep(1) || !validateStep(2) || !validateStep(3) || !validateStep(4)) {
      return;
    }

    setIsSubmitting(true);
    setStepError(null);

    try {
      const minB = parseFloat(minBudget);
      const maxB = parseFloat(maxBudget);

      const res = await createLeadAction({
        name: name.trim(),
        primaryPhone: primaryPhone.trim(),
        alternatePhone: alternatePhone.trim() || undefined,
        email: email.trim() || undefined,
        originalSource: originalSource.trim(),
        preference,
        city: city.trim(),
        minBudget: minB,
        maxBudget: maxB,
        bedroomConfigurations: selectedBhks,
        propertyTypes: selectedTypes,
        assignedTelecallerId: assignedTelecallerId || undefined,
      });

      if (!res.success) {
        setStepError(res.error);
        setIsSubmitting(false);
        return;
      }

      setToastMessage(`Prospect "${res.lead.name}" successfully registered!`);
      setTimeout(() => {
        router.push(`/leads/${res.lead.id}`);
      }, 1000);
    } catch (err: unknown) {
      setStepError(err instanceof Error ? err.message : "Failed to register lead.");
      setIsSubmitting(false);
    }
  };

  const parsedMinB = parseFloat(minBudget) || 0;
  const parsedMaxB = parseFloat(maxBudget) || 0;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-6 pb-12">
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
            <span className="text-xs font-medium text-crm-text">Add Prospect</span>
          </div>
          <span className="text-xs text-crm-muted">
            Step {currentStep} of {STEPS.length}
          </span>
        </div>

        {/* Header Title */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-crm-text">
            Register New Prospect
          </h1>
          <p className="text-xs text-crm-muted mt-1">
            Capture prospective buyer and tenant requirements with strict validation and phone deduplication (PRD §5).
          </p>
        </div>

        {/* Step Progress Tracker */}
        <div className="bg-crm-surface border border-crm-border rounded-lg p-3 shadow-2xs">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {STEPS.map((s) => {
              const isCurrent = s.id === currentStep;
              const isCompleted = s.id < currentStep;
              const isAccessible = s.id <= highestStepReached;

              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleStepClick(s.id)}
                  disabled={!isAccessible}
                  className={`text-left p-2 rounded transition-all text-xs border ${
                    isCurrent
                      ? "bg-teal-50/80 border-crm-primary text-crm-text font-bold shadow-2xs"
                      : isCompleted
                      ? "bg-stone-50 border-crm-border text-crm-primary hover:bg-stone-100 cursor-pointer"
                      : "bg-transparent border-transparent text-crm-muted cursor-not-allowed opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        isCurrent
                          ? "bg-crm-primary text-white"
                          : isCompleted
                          ? "bg-emerald-600 text-white"
                          : "bg-stone-200 text-crm-muted"
                      }`}
                    >
                      {isCompleted ? "✓" : s.id}
                    </span>
                    <span className="font-semibold truncate">{s.name}</span>
                  </div>
                  <p className="text-[10px] text-crm-muted truncate hidden sm:block">
                    {s.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step Error Alert */}
        {stepError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
            <span>⚠️</span>
            <span className="font-medium">{stepError}</span>
          </div>
        )}

        {/* Wizard Form Cards */}
        <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs p-6 space-y-6">
          {/* STEP 1: Basic Information */}
          {currentStep === 1 && (
            <div className="space-y-5">
              <div className="border-b border-crm-border pb-3">
                <h2 className="text-base font-bold text-crm-text">
                  Step 1: Prospect Basic Information
                </h2>
                <p className="text-xs text-crm-muted mt-0.5">
                  Record buyer or tenant contact coordinates and marketing inquiry attribution.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Name */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-crm-text mb-1">
                    Prospect Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Vikramaditya Sharma"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  />
                </div>

                {/* Primary Phone */}
                <div>
                  <label className="block text-xs font-semibold text-crm-text mb-1">
                    Primary Mobile (10 digits) <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-crm-muted font-medium">
                      +91
                    </span>
                    <input
                      type="tel"
                      required
                      maxLength={10}
                      placeholder="9810123456"
                      value={primaryPhone}
                      onChange={(e) => setPrimaryPhone(e.target.value.replace(/\D/g, ""))}
                      className="w-full pl-10 pr-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                    />
                  </div>
                  <span className="text-[10px] text-crm-muted mt-0.5 block">
                    Must start with 6, 7, 8, or 9. Tenant deduplication key.
                  </span>
                </div>

                {/* Alternate Phone */}
                <div>
                  <label className="block text-xs font-semibold text-crm-text mb-1">
                    Alternate Contact (Optional)
                  </label>
                  <input
                    type="tel"
                    placeholder="e.g. 9810999888"
                    value={alternatePhone}
                    onChange={(e) => setAlternatePhone(e.target.value.replace(/\D/g, ""))}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  />
                </div>

                {/* Email Address */}
                <div>
                  <label className="block text-xs font-semibold text-crm-text mb-1">
                    Email Address (Optional)
                  </label>
                  <input
                    type="email"
                    placeholder="e.g. vikram@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  />
                </div>

                {/* Original Source */}
                <div>
                  <label className="block text-xs font-semibold text-crm-text mb-1">
                    Origin / Lead Source <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={originalSource}
                    onChange={(e) => setOriginalSource(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  >
                    {SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Telecaller Assignment (Broker Owner / Team Leader) */}
                {canAssignTelecaller && eligibleTelecallers.length > 0 && (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-crm-text mb-1">
                      Assign Telecaller
                    </label>
                    <select
                      value={assignedTelecallerId}
                      onChange={(e) => setAssignedTelecallerId(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                    >
                      <option value="">Leave Unassigned (or Queue Default)</option>
                      {eligibleTelecallers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.email})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: Property Requirements */}
          {currentStep === 2 && (
            <div className="space-y-5">
              <div className="border-b border-crm-border pb-3">
                <h2 className="text-base font-bold text-crm-text">
                  Step 2: Property Requirements & Budget Range
                </h2>
                <p className="text-xs text-crm-muted mt-0.5">
                  Define transactional preference (Sale/Rent), acceptable property types, configurations, and financial boundaries.
                </p>
              </div>

              {/* Transaction Preference (Hard Gate) */}
              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Transaction Preference <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3 max-w-md">
                  <button
                    type="button"
                    onClick={() => setPreference("SALE")}
                    className={`py-2.5 px-4 rounded-lg border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                      preference === "SALE"
                        ? "bg-crm-primary text-white border-crm-primary shadow-xs"
                        : "bg-crm-surface text-crm-text border-crm-border hover:bg-stone-50"
                    }`}
                  >
                    <span>🏠</span> Buy (Outright Sale)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreference("RENT")}
                    className={`py-2.5 px-4 rounded-lg border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                      preference === "RENT"
                        ? "bg-crm-primary text-white border-crm-primary shadow-xs"
                        : "bg-crm-surface text-crm-text border-crm-border hover:bg-stone-50"
                    }`}
                  >
                    <span>🔑</span> Rent (Lease)
                  </button>
                </div>
              </div>

              {/* Acceptable Property Types */}
              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Acceptable Property Types <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {PROPERTY_TYPES.map((pt) => {
                    const isSelected = selectedTypes.includes(pt.value);
                    return (
                      <button
                        key={pt.value}
                        type="button"
                        onClick={() => togglePropertyType(pt.value)}
                        className={`p-2.5 rounded-lg border text-xs font-medium text-left transition-all ${
                          isSelected
                            ? "bg-teal-50 border-crm-primary text-crm-primary font-bold shadow-2xs"
                            : "bg-crm-surface border-crm-border text-crm-text hover:bg-stone-50"
                        }`}
                      >
                        <span className="mr-1.5">{isSelected ? "✓" : "+"}</span>
                        {pt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bedroom Configurations */}
              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Bedroom Configurations (BHK) <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {BHK_OPTIONS.map((bhk) => {
                    const isSelected = selectedBhks.includes(bhk);
                    return (
                      <button
                        key={bhk}
                        type="button"
                        onClick={() => toggleBhk(bhk)}
                        className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                          isSelected
                            ? "bg-crm-primary text-white border-crm-primary shadow-2xs"
                            : "bg-crm-surface border-crm-border text-crm-muted hover:border-crm-primary hover:text-crm-text"
                        }`}
                      >
                        {isSelected && <span className="mr-1">✓</span>}
                        {bhk}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Budget Inputs & Currency Preview */}
              <div className="p-4 rounded-lg bg-stone-50 border border-crm-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-crm-text">
                    Budget Range (INR)
                  </span>
                  <span className="text-xs font-bold text-crm-primary">
                    {formatIndianCurrency(parsedMinB, preference === "RENT")} – {formatIndianCurrency(parsedMaxB, preference === "RENT")}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                      Minimum Budget (₹)
                    </label>
                    <input
                      type="number"
                      step={preference === "RENT" ? "1000" : "50000"}
                      placeholder="e.g. 5000000"
                      value={minBudget}
                      onChange={(e) => setMinBudget(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary font-medium"
                    />
                    <span className="text-[10px] text-crm-muted mt-0.5 block">
                      Preview: {formatIndianCurrency(parsedMinB, preference === "RENT")}
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                      Maximum Budget (₹)
                    </label>
                    <input
                      type="number"
                      step={preference === "RENT" ? "1000" : "50000"}
                      placeholder="e.g. 15000000"
                      value={maxBudget}
                      onChange={(e) => setMaxBudget(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary font-medium"
                    />
                    <span className="text-[10px] text-crm-muted mt-0.5 block">
                      Preview: {formatIndianCurrency(parsedMaxB, preference === "RENT")}
                    </span>
                  </div>
                </div>

                {/* Quick Presets */}
                <div>
                  <span className="text-[10px] uppercase font-bold text-crm-muted block mb-1">
                    Quick Budget Presets
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {(preference === "SALE" ? SALE_BUDGET_PRESETS : RENT_BUDGET_PRESETS).map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => applyBudgetPreset(p.min, p.max)}
                        className="px-2 py-1 text-[11px] rounded bg-white border border-crm-border text-crm-text hover:border-crm-primary font-medium shadow-2xs"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Location Preferences */}
          {currentStep === 3 && (
            <div className="space-y-5">
              <div className="border-b border-crm-border pb-3">
                <h2 className="text-base font-bold text-crm-text">
                  Step 3: Location & Society Preferences
                </h2>
                <p className="text-xs text-crm-muted mt-0.5">
                  Specify target city, primary localities, and specific preferred societies or gated complexes.
                </p>
              </div>

              <div className="space-y-4">
                {/* Target City */}
                <div>
                  <label className="block text-xs font-semibold text-crm-text mb-1">
                    Target City <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Gurugram, Delhi, Noida, Bengaluru"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary font-medium"
                  />
                </div>

                {/* Preferred Localities */}
                <div>
                  <label className="block text-xs font-semibold text-crm-text mb-1">
                    Preferred Localities / Sectors
                  </label>
                  <textarea
                    rows={2}
                    placeholder="e.g. Golf Course Road, DLF Phase 5, Sector 54, Sohna Road"
                    value={localitiesInput}
                    onChange={(e) => setLocalitiesInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  />
                  <span className="text-[10px] text-crm-muted mt-0.5 block">
                    Separate multiple localities with commas.
                  </span>
                </div>

                {/* Preferred Societies */}
                <div>
                  <label className="block text-xs font-semibold text-crm-text mb-1">
                    Specific Preferred Societies / Projects (Optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="e.g. DLF The Aralias, Ireo Grand Arch, Tata Primanti"
                    value={societiesInput}
                    onChange={(e) => setSocietiesInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  />
                  <span className="text-[10px] text-crm-muted mt-0.5 block">
                    Buyer-specific society preferences used in matching.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Specifications & Notes */}
          {currentStep === 4 && (
            <div className="space-y-5">
              <div className="border-b border-crm-border pb-3">
                <h2 className="text-base font-bold text-crm-text">
                  Step 4: Area Specifications & Additional Notes
                </h2>
                <p className="text-xs text-crm-muted mt-0.5">
                  Record carpet or built-up area expectations and special prospect preferences.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Target Area */}
                <div>
                  <label className="block text-xs font-semibold text-crm-text mb-1">
                    Target Area (sq.ft / sq.yd)
                  </label>
                  <input
                    type="number"
                    step="10"
                    placeholder="e.g. 1850"
                    value={targetArea}
                    onChange={(e) => setTargetArea(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  />
                </div>

                {/* Area Unit Type */}
                <div>
                  <label className="block text-xs font-semibold text-crm-text mb-1">
                    Area Unit Type
                  </label>
                  <select
                    value={areaType}
                    onChange={(e) => setAreaType(e.target.value as "CARPET" | "BUILT_UP" | "SUPER_BUILT_UP")}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  >
                    <option value="SUPER_BUILT_UP">Super Built-up Area</option>
                    <option value="BUILT_UP">Built-up Area</option>
                    <option value="CARPET">Carpet Area</option>
                  </select>
                </div>

                {/* Special Notes */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-crm-text mb-1">
                    Prospect Requirements & Special Preferences (Notes)
                  </label>
                  <textarea
                    rows={4}
                    placeholder="e.g. Buyer prefers park facing, higher floor (above 10th), 2 car parkings essential. Possession needed within 45 days."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: Review & Submit */}
          {currentStep === 5 && (
            <div className="space-y-5">
              <div className="border-b border-crm-border pb-3">
                <h2 className="text-base font-bold text-crm-text">
                  Step 5: Review & Confirm Registration
                </h2>
                <p className="text-xs text-crm-muted mt-0.5">
                  Verify prospect information before persisting to the Demand Pool.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {/* Contact Card */}
                <div className="p-4 rounded-lg bg-stone-50 border border-crm-border space-y-2">
                  <div className="flex items-center justify-between border-b border-crm-border pb-1.5">
                    <span className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                      Prospect Contact
                    </span>
                    <button
                      type="button"
                      onClick={() => handleStepClick(1)}
                      className="text-crm-link hover:underline text-[11px] font-semibold"
                    >
                      Edit ✏️
                    </button>
                  </div>
                  <div>
                    <span className="text-crm-muted block text-[10px]">Name</span>
                    <span className="font-bold text-crm-text">{name}</span>
                  </div>
                  <div>
                    <span className="text-crm-muted block text-[10px]">Mobile</span>
                    <span className="font-semibold text-crm-text">+91 {primaryPhone}</span>
                  </div>
                  {alternatePhone && (
                    <div>
                      <span className="text-crm-muted block text-[10px]">Alt Contact</span>
                      <span className="text-crm-text">{alternatePhone}</span>
                    </div>
                  )}
                  {email && (
                    <div>
                      <span className="text-crm-muted block text-[10px]">Email</span>
                      <span className="text-crm-text">{email}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-crm-muted block text-[10px]">Origin / Source</span>
                    <span className="font-medium text-crm-text">{originalSource}</span>
                  </div>
                </div>

                {/* Requirements Card */}
                <div className="p-4 rounded-lg bg-stone-50 border border-crm-border space-y-2">
                  <div className="flex items-center justify-between border-b border-crm-border pb-1.5">
                    <span className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                      Property Requirements
                    </span>
                    <button
                      type="button"
                      onClick={() => handleStepClick(2)}
                      className="text-crm-link hover:underline text-[11px] font-semibold"
                    >
                      Edit ✏️
                    </button>
                  </div>
                  <div>
                    <span className="text-crm-muted block text-[10px]">Preference</span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-teal-100 text-teal-900 border border-teal-200">
                      {preference === "SALE" ? "Buy (Sale)" : "Rent"}
                    </span>
                  </div>
                  <div>
                    <span className="text-crm-muted block text-[10px]">Budget Range</span>
                    <span className="font-bold text-crm-primary text-sm">
                      {formatIndianCurrency(parsedMinB, preference === "RENT")} – {formatIndianCurrency(parsedMaxB, preference === "RENT")}
                    </span>
                  </div>
                  <div>
                    <span className="text-crm-muted block text-[10px]">Configurations</span>
                    <span className="font-medium text-crm-text">{selectedBhks.join(", ")}</span>
                  </div>
                  <div>
                    <span className="text-crm-muted block text-[10px]">Property Types</span>
                    <span className="font-medium text-crm-text">
                      {selectedTypes
                        .map((t) => PROPERTY_TYPES.find((pt) => pt.value === t)?.label || t)
                        .join(", ")}
                    </span>
                  </div>
                </div>

                {/* Location & Specs Card */}
                <div className="sm:col-span-2 p-4 rounded-lg bg-stone-50 border border-crm-border space-y-2">
                  <div className="flex items-center justify-between border-b border-crm-border pb-1.5">
                    <span className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                      Location & Details
                    </span>
                    <button
                      type="button"
                      onClick={() => handleStepClick(3)}
                      className="text-crm-link hover:underline text-[11px] font-semibold"
                    >
                      Edit ✏️
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <span className="text-crm-muted block text-[10px]">Target City</span>
                      <span className="font-bold text-crm-text">{city}</span>
                    </div>
                    <div>
                      <span className="text-crm-muted block text-[10px]">Target Area</span>
                      <span className="font-medium text-crm-text">
                        {targetArea ? `${targetArea} sq.ft (${areaType.replace(/_/g, " ")})` : "Not specified"}
                      </span>
                    </div>
                    <div>
                      <span className="text-crm-muted block text-[10px]">Initial Status</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                        Not Yet Validated (Pending Telecaller Call)
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-crm-muted block text-[10px]">Localities</span>
                    <span className="font-medium text-crm-text">{localitiesInput || "None specified"}</span>
                  </div>
                  {notes && (
                    <div>
                      <span className="text-crm-muted block text-[10px]">Special Instructions</span>
                      <p className="text-crm-text italic mt-0.5 bg-white p-2 rounded border border-crm-border">
                        &quot;{notes}&quot;
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Action Footer Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-crm-border">
            <div>
              {currentStep > 1 && (
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 transition-all cursor-pointer"
                >
                  ← Back
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Link
                href="/leads"
                className="px-3 py-2 text-xs font-medium text-crm-muted hover:text-crm-text"
              >
                Cancel
              </Link>

              {currentStep < 5 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="px-5 py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs transition-all cursor-pointer"
                >
                  Continue →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="px-6 py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Registering Prospect...
                    </>
                  ) : (
                    <>✓ Register & Persist Prospect</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </AppShell>
  );
}

