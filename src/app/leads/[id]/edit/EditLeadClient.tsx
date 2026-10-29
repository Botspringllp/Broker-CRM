"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { Toast } from "@/components/ui/Toast";
import { Lead } from "@/types/crm";
import { editLeadAction } from "../../actions";
import { formatIndianCurrency } from "@/server/dal/mappers";

interface EligibleTelecaller {
  id: string;
  name: string;
  email: string;
  phone: string;
}

interface EditLeadClientProps {
  lead: Lead;
  canAssignTelecaller: boolean;
  eligibleTelecallers: EligibleTelecaller[];
  userRole: string;
}

const PROPERTY_TYPES: {
  label: string;
  value: "APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT";
}[] = [
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

export function EditLeadClient({
  lead,
  canAssignTelecaller,
  eligibleTelecallers,
}: EditLeadClientProps) {
  const router = useRouter();

  // Contact Info
  const [name, setName] = useState(lead.name);
  const [primaryPhone, setPrimaryPhone] = useState(lead.primaryPhone);
  const [alternatePhone, setAlternatePhone] = useState(lead.alternatePhone || "");
  const [email, setEmail] = useState(lead.email || "");
  const [originalSource, setOriginalSource] = useState(lead.originalSource);
  const [assignedTelecallerId, setAssignedTelecallerId] = useState(
    eligibleTelecallers.find((t) => t.name === lead.assignedTelecaller)?.id || ""
  );

  // Requirements
  const [preference, setPreference] = useState<"SALE" | "RENT">(
    lead.requirements.preference === "Rent" ? "RENT" : "SALE"
  );
  const [minBudget, setMinBudget] = useState(lead.requirements.minBudget.toString());
  const [maxBudget, setMaxBudget] = useState(lead.requirements.maxBudget.toString());
  const [selectedBhks, setSelectedBhks] = useState<string[]>(
    lead.requirements.bedroomConfigurations.length > 0
      ? lead.requirements.bedroomConfigurations
      : ["2 BHK", "3 BHK"]
  );
  const [selectedTypes, setSelectedTypes] = useState<
    ("APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT")[]
  >(
    (lead.requirements.propertyTypes as (
      | "APARTMENT"
      | "INDEPENDENT_HOUSE"
      | "VILLA"
      | "BUILDER_FLOOR"
      | "PLOT"
    )[]) || ["APARTMENT"]
  );

  // Location & Specs
  const [city, setCity] = useState(lead.requirements.city);
  const [localities, setLocalities] = useState(lead.requirements.localities.join(", "));
  const [societies, setSocieties] = useState(lead.requirements.societies.join(", "));
  const [targetArea, setTargetArea] = useState(
    lead.requirements.targetArea ? lead.requirements.targetArea.toString() : ""
  );
  const [areaType, setAreaType] = useState<"CARPET" | "BUILT_UP" | "SUPER_BUILT_UP">(
    "SUPER_BUILT_UP"
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const togglePropertyType = (
    type: "APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT"
  ) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const toggleBhk = (bhk: string) => {
    setSelectedBhks((prev) =>
      prev.includes(bhk) ? prev.filter((b) => b !== bhk) : [...prev, bhk]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim()) {
      setErrorMessage("Prospect name is required.");
      return;
    }

    const cleanedPhone = primaryPhone.replace(/\D/g, "");
    if (cleanedPhone.length < 10) {
      setErrorMessage("A valid 10-digit primary mobile number is required.");
      return;
    }

    const minB = parseFloat(minBudget);
    const maxB = parseFloat(maxBudget);
    if (isNaN(minB) || minB < 0 || isNaN(maxB) || maxB < 0) {
      setErrorMessage("Please enter valid non-negative minimum and maximum budget amounts.");
      return;
    }
    if (maxB < minB) {
      setErrorMessage("Maximum budget cannot be less than minimum budget.");
      return;
    }

    if (!city.trim()) {
      setErrorMessage("Target city is required.");
      return;
    }

    if (selectedTypes.length === 0) {
      setErrorMessage("Please select at least one property type.");
      return;
    }

    setIsSubmitting(true);

    try {
      const societiesArr = societies
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await editLeadAction({
        id: lead.id,
        name: name.trim(),
        primaryPhone: cleanedPhone,
        alternatePhone: alternatePhone.trim() || null,
        email: email.trim() || null,
        originalSource: originalSource.trim(),
        minBudget: minB,
        maxBudget: maxB,
        city: city.trim(),
        preference,
        bedroomConfigurations: selectedBhks,
        propertyTypes: selectedTypes,
        societies: societiesArr,
        targetArea: targetArea.trim() ? parseFloat(targetArea) : null,
        areaType,
        assignedTelecallerId: canAssignTelecaller ? assignedTelecallerId || null : undefined,
      });

      if (!res.success) {
        setErrorMessage(res.error);
        setIsSubmitting(false);
        return;
      }

      setToastMessage(`Prospect "${res.lead.name}" updated successfully.`);
      setTimeout(() => {
        router.push(`/leads/${lead.id}`);
      }, 700);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to update lead.");
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
              href={`/leads/${lead.id}`}
              className="text-xs font-semibold text-crm-link hover:underline flex items-center gap-1"
            >
              <span>←</span> Back to Prospect Details
            </Link>
            <span className="text-crm-muted text-xs">/</span>
            <span className="text-xs font-medium text-crm-text">Edit {lead.name}</span>
          </div>

          <span className="text-xs text-crm-muted">
            Status: <strong className="text-crm-text">{lead.status}</strong>
          </span>
        </div>

        {/* Title */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-crm-text">
            Edit Prospect: {lead.name}
          </h1>
          <p className="text-xs text-crm-muted mt-1">
            Update buyer or tenant requirements, contact credentials, and operational allocations.
          </p>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
            <span>⚠️</span>
            <span className="font-medium">{errorMessage}</span>
          </div>
        )}

        {/* Edit Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Card 1: Contact Coordinates */}
          <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs p-5 space-y-4">
            <div className="border-b border-crm-border pb-2.5">
              <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                1. Contact & Identity Coordinates
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1">
                  Prospect Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1">
                  Primary Mobile Number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-crm-muted font-medium">
                    +91
                  </span>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    value={primaryPhone}
                    onChange={(e) => setPrimaryPhone(e.target.value.replace(/\D/g, ""))}
                    className="w-full pl-10 pr-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1">
                  Alternate Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="Optional alternate contact"
                  value={alternatePhone}
                  onChange={(e) => setAlternatePhone(e.target.value.replace(/\D/g, ""))}
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  placeholder="prospect@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

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

              {canAssignTelecaller && eligibleTelecallers.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-crm-text mb-1">
                    Assigned Telecaller
                  </label>
                  <select
                    value={assignedTelecallerId}
                    onChange={(e) => setAssignedTelecallerId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  >
                    <option value="">Leave Unassigned</option>
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

          {/* Card 2: Requirements & Budget */}
          <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs p-5 space-y-4">
            <div className="border-b border-crm-border pb-2.5">
              <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                2. Requirements & Financial Scope
              </h2>
            </div>

            {/* Preference */}
            <div>
              <label className="block text-xs font-semibold text-crm-text mb-1.5">
                Transaction Preference <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3 max-w-sm">
                <button
                  type="button"
                  onClick={() => setPreference("SALE")}
                  className={`py-2 px-3 rounded-lg border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    preference === "SALE"
                      ? "bg-crm-primary text-white border-crm-primary shadow-xs"
                      : "bg-crm-surface text-crm-text border-crm-border hover:bg-stone-50"
                  }`}
                >
                  <span>🏠</span> Buy (Sale)
                </button>
                <button
                  type="button"
                  onClick={() => setPreference("RENT")}
                  className={`py-2 px-3 rounded-lg border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    preference === "RENT"
                      ? "bg-crm-primary text-white border-crm-primary shadow-xs"
                      : "bg-crm-surface text-crm-text border-crm-border hover:bg-stone-50"
                  }`}
                >
                  <span>🔑</span> Rent (Lease)
                </button>
              </div>
            </div>

            {/* Budget */}
            <div className="p-4 rounded-lg bg-stone-50 border border-crm-border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-crm-text">
                  Target Budget Scope
                </span>
                <span className="text-xs font-bold text-crm-primary">
                  {formatIndianCurrency(parsedMinB, preference === "RENT")} – {formatIndianCurrency(parsedMaxB, preference === "RENT")}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                    Minimum Budget (₹) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step={preference === "RENT" ? "1000" : "50000"}
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
                    Maximum Budget (₹) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step={preference === "RENT" ? "1000" : "50000"}
                    value={maxBudget}
                    onChange={(e) => setMaxBudget(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary font-medium"
                  />
                  <span className="text-[10px] text-crm-muted mt-0.5 block">
                    Preview: {formatIndianCurrency(parsedMaxB, preference === "RENT")}
                  </span>
                </div>
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
                      className={`px-3 py-1 rounded-full border text-xs font-semibold transition-all ${
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

            {/* Property Types */}
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
                      className={`p-2 rounded-lg border text-xs font-medium text-left transition-all ${
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
          </div>

          {/* Card 3: Location Preferences */}
          <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs p-5 space-y-4">
            <div className="border-b border-crm-border pb-2.5">
              <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
                3. Geographic & Physical Criteria
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1">
                  Target City <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1">
                  Target Area & Measurement Unit
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    placeholder="e.g. 1850"
                    value={targetArea}
                    onChange={(e) => setTargetArea(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  />
                  <select
                    value={areaType}
                    onChange={(e) => setAreaType(e.target.value as "CARPET" | "BUILT_UP" | "SUPER_BUILT_UP")}
                    className="w-full px-2 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                  >
                    <option value="SUPER_BUILT_UP">Super Built-up</option>
                    <option value="BUILT_UP">Built-up</option>
                    <option value="CARPET">Carpet Area</option>
                  </select>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-crm-text mb-1">
                  Preferred Localities (comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Golf Course Road, DLF Phase 5, Sector 54"
                  value={localities}
                  onChange={(e) => setLocalities(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-crm-text mb-1">
                  Preferred Societies / Complexes (comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. DLF The Aralias, Ireo Grand Arch, Tata Primanti"
                  value={societies}
                  onChange={(e) => setSocieties(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-between pt-2">
            <Link
              href={`/leads/${lead.id}`}
              className="px-4 py-2 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 transition-all"
            >
              Cancel
            </Link>

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving Changes...
                </>
              ) : (
                <>✓ Save Changes</>
              )}
            </button>
          </div>
        </form>
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </AppShell>
  );
}

