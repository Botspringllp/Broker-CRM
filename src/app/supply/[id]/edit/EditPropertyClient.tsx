"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { Toast } from "@/components/ui/Toast";
import { Property } from "@/types/crm";
import { editPropertyAction, checkDuplicatePropertyAction } from "@/app/supply/actions";

const STANDARD_AMENITIES = [
  "Gym",
  "Swimming Pool",
  "Clubhouse",
  "24x7 Security",
  "Power Backup",
  "Covered Parking",
  "Visitor Parking",
  "Children Play Area",
  "Lift",
  "Gated Community",
  "Intercom",
  "Gas Pipeline",
  "Park / Garden",
  "CCTV Surveillance",
  "Fire Fighting System",
  "Rainwater Harvesting",
];

function formatIndianCurrency(amount: number, isRent = false): string {
  if (!amount || isNaN(amount)) return isRent ? "₹0 / mo" : "₹0";
  if (amount >= 10000000) {
    return `₹${(amount / 10000000).toFixed(2)} Cr`;
  }
  if (amount >= 100000) {
    return `₹${(amount / 100000).toFixed(2)} L`;
  }
  return `₹${amount.toLocaleString("en-IN")}${isRent ? " / mo" : ""}`;
}

interface EditPropertyClientProps {
  property: Property;
  currentUserRole?: string;
}

export function EditPropertyClient({ property }: EditPropertyClientProps) {
  const router = useRouter();

  // Form State initialized from current property
  const [preference, setPreference] = useState<"SALE" | "RENT">(
    property.preference === "Rent" ? "RENT" : "SALE"
  );
  const [propertyType, setPropertyType] = useState<
    "APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT"
  >(
    property.propertyType === "Independent House"
      ? "INDEPENDENT_HOUSE"
      : property.propertyType === "Villa"
      ? "VILLA"
      : property.propertyType === "Builder Floor"
      ? "BUILDER_FLOOR"
      : property.propertyType === "Plot"
      ? "PLOT"
      : "APARTMENT"
  );
  const [bedroomCount, setBedroomCount] = useState<number>(property.bedroomCount || 2);
  const [bathroomCount, setBathroomCount] = useState<number>(property.bathroomCount || 2);
  const [balconyCount, setBalconyCount] = useState<number>(property.balconyCount || 1);

  const [societyName, setSocietyName] = useState<string>(property.societyName || "");
  const [flatNumber, setFlatNumber] = useState<string>(property.flatNumber || "");
  const [localityName, setLocalityName] = useState<string>(property.locality || "");
  const [city, setCity] = useState<string>(property.city || "Gurugram");

  const [area, setArea] = useState<number | string>(property.area || "");
  const [areaType, setAreaType] = useState<"CARPET" | "BUILT_UP" | "SUPER_BUILT_UP">(
    property.areaType === "Super built-up"
      ? "SUPER_BUILT_UP"
      : property.areaType === "Built-up"
      ? "BUILT_UP"
      : "CARPET"
  );
  const [furnishingStatus, setFurnishingStatus] = useState<"UNFURNISHED" | "SEMI_FURNISHED" | "FURNISHED">(
    property.furnishingStatus === "Furnished"
      ? "FURNISHED"
      : property.furnishingStatus === "Semi-furnished"
      ? "SEMI_FURNISHED"
      : "UNFURNISHED"
  );
  const [constructionStatus, setConstructionStatus] = useState<"READY_TO_MOVE" | "UNDER_CONSTRUCTION">(
    property.constructionStatus === "Under Construction"
      ? "UNDER_CONSTRUCTION"
      : "READY_TO_MOVE"
  );

  const [price, setPrice] = useState<number | string>(property.price || "");
  const [ownerName, setOwnerName] = useState<string>(property.ownerName || "");
  const [ownerMobile, setOwnerMobile] = useState<string>(property.ownerMobile || "");

  // Keyholder
  const [hasKeyHolder, setHasKeyHolder] = useState<boolean>(
    Boolean(property.keyHolder && property.keyHolder.name && property.keyHolder.name !== "Not assigned")
  );
  const [keyHolderPersona, setKeyHolderPersona] = useState<
    "GUARD" | "MAINTENANCE_OFFICE" | "NEIGHBOUR" | "OWNER" | "OTHER"
  >(
    property.keyHolder?.persona === "Guard"
      ? "GUARD"
      : property.keyHolder?.persona === "Maintenance Office"
      ? "MAINTENANCE_OFFICE"
      : property.keyHolder?.persona === "Neighbour"
      ? "NEIGHBOUR"
      : property.keyHolder?.persona === "Owner"
      ? "OWNER"
      : "OTHER"
  );
  const [keyHolderName, setKeyHolderName] = useState<string>(
    property.keyHolder && property.keyHolder.name !== "Not assigned" ? property.keyHolder.name : ""
  );
  const [keyHolderMobile, setKeyHolderMobile] = useState<string>(
    property.keyHolder && property.keyHolder.mobile !== "-" ? property.keyHolder.mobile : ""
  );
  const [keyHolderNotes, setKeyHolderNotes] = useState<string>(property.keyHolder?.notes || "");

  // Amenities
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>(property.amenities || []);
  const [customAmenity, setCustomAmenity] = useState<string>("");

  // Duplicate check & Confirmation
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState<boolean>(false);

  // Status & Feedback
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Live duplicate checking when Society or Flat is changed
  useEffect(() => {
    const trimmedSociety = societyName.trim();
    const trimmedFlat = flatNumber.trim();

    // If matches initial, no need to alert duplicate on self
    if (
      trimmedSociety.toLowerCase() === property.societyName.trim().toLowerCase() &&
      trimmedFlat.toLowerCase() === property.flatNumber.trim().toLowerCase()
    ) {
      const timer = setTimeout(() => {
        setDuplicateWarning(null);
      }, 0);
      return () => clearTimeout(timer);
    }

    if (trimmedSociety.length >= 3 && trimmedFlat.length >= 1) {
      const timer = setTimeout(async () => {
        const res = await checkDuplicatePropertyAction({
          societyName: trimmedSociety,
          flatNumber: trimmedFlat,
        });
        if (res.isDuplicate && res.duplicate && res.duplicate.id !== property.id) {
          setDuplicateWarning(
            `Another property already exists with Society "${res.duplicate.societyName}" and Flat "${res.duplicate.flatNumber}". If you proceed, check the confirmation box below.`
          );
        } else {
          setDuplicateWarning(null);
        }
      }, 500);

      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        setDuplicateWarning(null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [societyName, flatNumber, property.id, property.societyName, property.flatNumber]);

  const toggleAmenity = (name: string) => {
    setSelectedAmenities((prev) =>
      prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name]
    );
  };

  const handleAddCustomAmenity = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customAmenity.trim();
    if (trimmed && !selectedAmenities.includes(trimmed)) {
      setSelectedAmenities((prev) => [...prev, trimmed]);
      setCustomAmenity("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validation
    if (!societyName.trim()) {
      setErrorMessage("Society name is required.");
      return;
    }
    if (!flatNumber.trim()) {
      setErrorMessage("Flat / Unit number is required.");
      return;
    }
    if (!localityName.trim()) {
      setErrorMessage("Locality is required.");
      return;
    }
    if (!city.trim()) {
      setErrorMessage("City is required.");
      return;
    }
    const numArea = Number(area);
    if (!numArea || numArea <= 0) {
      setErrorMessage("Please enter a valid positive area in square feet.");
      return;
    }
    const numPrice = Number(price);
    if (!numPrice || numPrice <= 0) {
      setErrorMessage("Please enter a valid positive price / rent in INR.");
      return;
    }
    if (!ownerName.trim()) {
      setErrorMessage("Owner name is required.");
      return;
    }
    const cleanMobile = ownerMobile.replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      setErrorMessage("Owner mobile must be a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.");
      return;
    }

    if (hasKeyHolder && keyHolderMobile.trim()) {
      const cleanKhMobile = keyHolderMobile.replace(/\D/g, "").slice(-10);
      if (!/^[6-9]\d{9}$/.test(cleanKhMobile)) {
        setErrorMessage("Key custodian mobile must be a valid 10-digit Indian mobile number.");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const res = await editPropertyAction({
        propertyId: property.id,
        societyName: societyName.trim(),
        flatNumber: flatNumber.trim(),
        localityName: localityName.trim(),
        city: city.trim(),
        preference,
        propertyType,
        bedroomCount,
        bathroomCount,
        balconyCount,
        area: numArea,
        areaType,
        furnishingStatus,
        constructionStatus,
        price: numPrice,
        ownerName: ownerName.trim(),
        ownerMobile: cleanMobile,
        amenities: selectedAmenities,
        keyHolder: hasKeyHolder
          ? {
              name: keyHolderName.trim() || undefined,
              mobile: keyHolderMobile.trim() || undefined,
              persona: keyHolderPersona,
              notes: keyHolderNotes.trim() || undefined,
            }
          : null,
        confirmDuplicate,
      });

      if (!res.success) {
        if (res.isDuplicate) {
          setDuplicateWarning(res.error || "A property with this society and flat already exists.");
        } else {
          setErrorMessage(res.error || "Failed to update property.");
        }
        setIsSubmitting(false);
        return;
      }

      setToastMessage("Property details updated successfully.");
      router.push(`/supply/${property.id}`);
      router.refresh();
    } catch (err: unknown) {
      setErrorMessage((err as Error)?.message || "An unexpected error occurred.");
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell activePage="supply">
      <div className="max-w-4xl mx-auto space-y-6 pb-12">
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center gap-2 text-xs text-crm-muted">
          <Link href="/supply" className="hover:text-crm-primary transition-colors">
            Supply Validation
          </Link>
          <span>/</span>
          <Link href={`/supply/${property.id}`} className="hover:text-crm-primary transition-colors">
            {property.societyName} ({property.flatNumber})
          </Link>
          <span>/</span>
          <span className="font-semibold text-crm-text">Edit Property</span>
        </nav>

        {/* Header Banner */}
        <div className="p-6 rounded-lg bg-crm-surface border border-crm-border shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-crm-text">
              Edit Property Details
            </h1>
            <p className="text-xs text-crm-muted mt-1">
              Modify specifications, pricing, location, or contact details for Unit #{property.flatNumber} in {property.societyName}.
            </p>
          </div>
          <Link
            href={`/supply/${property.id}`}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-md bg-stone-100 hover:bg-stone-200 text-crm-text border border-crm-border transition-colors shadow-2xs text-center"
          >
            ← Cancel & Back
          </Link>
        </div>

        {/* Global Error Banner */}
        {errorMessage && (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="font-bold text-sm px-1 text-red-700 hover:text-red-900"
            >
              ✕
            </button>
          </div>
        )}

        {/* Duplicate Warning Alert */}
        {duplicateWarning && (
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs space-y-2">
            <div className="flex items-center gap-2 font-bold text-sm">
              <span>⚠️ Duplicate Property Detected</span>
            </div>
            <p>{duplicateWarning}</p>
            <label className="flex items-center gap-2 font-semibold cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={confirmDuplicate}
                onChange={(e) => setConfirmDuplicate(e.target.checked)}
                className="rounded border-amber-400 text-crm-primary focus:ring-crm-primary"
              />
              <span>I confirm this is not an unintentional duplicate. Update property anyway.</span>
            </label>
          </div>
        )}

        {/* Edit Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section 1: Basic Details */}
          <div className="p-6 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-4">
            <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider border-b border-crm-border pb-2">
              1. Basic Property Details
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Transaction Type *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPreference("SALE")}
                    className={`py-2 text-xs font-bold rounded-md border text-center transition-all ${
                      preference === "SALE"
                        ? "bg-teal-50 border-crm-primary text-crm-primary shadow-2xs"
                        : "bg-white border-crm-border text-crm-muted hover:bg-stone-50"
                    }`}
                  >
                    Resale
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreference("RENT")}
                    className={`py-2 text-xs font-bold rounded-md border text-center transition-all ${
                      preference === "RENT"
                        ? "bg-teal-50 border-crm-primary text-crm-primary shadow-2xs"
                        : "bg-white border-crm-border text-crm-muted hover:bg-stone-50"
                    }`}
                  >
                    Rental
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Property Typology *
                </label>
                <select
                  value={propertyType}
                  onChange={(e) =>
                    setPropertyType(
                      e.target.value as "APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT"
                    )
                  }
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                >
                  <option value="APARTMENT">Apartment / High-rise Flat</option>
                  <option value="BUILDER_FLOOR">Builder Floor</option>
                  <option value="INDEPENDENT_HOUSE">Independent House / Kothi</option>
                  <option value="VILLA">Villa / Gated Bungalow</option>
                  <option value="PLOT">Residential Plot / Land</option>
                </select>
              </div>
            </div>

            {/* BHK, Baths, Balconies */}
            <div className="grid grid-cols-3 gap-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Bedrooms (BHK) *
                </label>
                <select
                  value={bedroomCount}
                  onChange={(e) => setBedroomCount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} BHK
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Bathrooms *
                </label>
                <select
                  value={bathroomCount}
                  onChange={(e) => setBathroomCount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "Bath" : "Baths"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Balconies
                </label>
                <select
                  value={balconyCount}
                  onChange={(e) => setBalconyCount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "Balcony" : "Balconies"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Location Details */}
          <div className="p-6 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-4">
            <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider border-b border-crm-border pb-2">
              2. Location Details
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Society / Complex Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. DLF Phase 5, Sobha City..."
                  value={societyName}
                  onChange={(e) => setSocietyName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Flat / Unit Number *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Tower B - 1204"
                  value={flatNumber}
                  onChange={(e) => setFlatNumber(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Locality / Sub-market *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Golf Course Extension, Sector 54..."
                  value={localityName}
                  onChange={(e) => setLocalityName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  City *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Gurugram, Noida..."
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Property Profile & Dimensions */}
          <div className="p-6 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-4">
            <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider border-b border-crm-border pb-2">
              3. Dimensions & Profile
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Area (sq.ft) *
                </label>
                <input
                  type="number"
                  required
                  min={100}
                  step={1}
                  placeholder="e.g. 1850"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Measurement Unit Type *
                </label>
                <select
                  value={areaType}
                  onChange={(e) =>
                    setAreaType(e.target.value as "CARPET" | "BUILT_UP" | "SUPER_BUILT_UP")
                  }
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  <option value="SUPER_BUILT_UP">Super Built-up Area</option>
                  <option value="BUILT_UP">Built-up Area</option>
                  <option value="CARPET">Carpet Area</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Furnishing Status *
                </label>
                <select
                  value={furnishingStatus}
                  onChange={(e) =>
                    setFurnishingStatus(
                      e.target.value as "UNFURNISHED" | "SEMI_FURNISHED" | "FURNISHED"
                    )
                  }
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  <option value="UNFURNISHED">Unfurnished</option>
                  <option value="SEMI_FURNISHED">Semi-furnished</option>
                  <option value="FURNISHED">Fully Furnished</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Construction Status *
                </label>
                <select
                  value={constructionStatus}
                  onChange={(e) =>
                    setConstructionStatus(
                      e.target.value as "READY_TO_MOVE" | "UNDER_CONSTRUCTION"
                    )
                  }
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  <option value="READY_TO_MOVE">Ready to Move</option>
                  <option value="UNDER_CONSTRUCTION">Under Construction</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 4: Amenities */}
          <div className="p-6 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-4">
            <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider border-b border-crm-border pb-2">
              4. Society & Flat Amenities
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {STANDARD_AMENITIES.map((amenity) => {
                const isChecked = selectedAmenities.includes(amenity);
                return (
                  <label
                    key={amenity}
                    className={`flex items-center gap-2 p-2 rounded border text-xs cursor-pointer select-none transition-colors ${
                      isChecked
                        ? "bg-teal-50/80 border-teal-300 text-teal-900 font-semibold"
                        : "bg-white border-crm-border text-crm-muted hover:bg-stone-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleAmenity(amenity)}
                      className="rounded border-crm-border text-crm-primary focus:ring-crm-primary"
                    />
                    <span className="truncate">{amenity}</span>
                  </label>
                );
              })}
            </div>

            {/* Custom amenity tag */}
            <div className="flex gap-2 pt-2 border-t border-crm-border/60">
              <input
                type="text"
                placeholder="Add other amenity (e.g. Squash Court)..."
                value={customAmenity}
                onChange={(e) => setCustomAmenity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCustomAmenity(e);
                  }
                }}
                className="flex-1 px-3 py-1.5 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              />
              <button
                type="button"
                onClick={handleAddCustomAmenity}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-stone-100 hover:bg-stone-200 text-crm-text border border-crm-border"
              >
                + Add
              </button>
            </div>
          </div>

          {/* Section 5: Owner & Pricing */}
          <div className="p-6 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-4">
            <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider border-b border-crm-border pb-2">
              5. Owner Details & Pricing
            </h2>

            {/* Price with live Indian conversion */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-crm-text">
                  {preference === "RENT" ? "Expected Monthly Rent (INR) *" : "Total Asking Price (INR) *"}
                </label>
                {Number(price) > 0 && (
                  <span className="text-xs font-bold text-crm-primary bg-teal-50 px-2.5 py-0.5 rounded border border-teal-200">
                    Preview: {formatIndianCurrency(Number(price), preference === "RENT")}
                  </span>
                )}
              </div>
              <input
                type="number"
                required
                min={1000}
                step={1000}
                placeholder={preference === "RENT" ? "e.g. 45000" : "e.g. 15000000"}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary font-mono text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Owner Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Vikramaditya Sharma"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1.5">
                  Owner 10-Digit Mobile Number *
                </label>
                <input
                  type="tel"
                  required
                  maxLength={10}
                  placeholder="e.g. 9811234567"
                  value={ownerMobile}
                  onChange={(e) => setOwnerMobile(e.target.value.replace(/\D/g, ""))}
                  className="w-full px-3 py-2 text-xs rounded-md border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary font-mono"
                />
                <span className="text-[10px] text-crm-muted mt-1 block">
                  Encrypted & masked to prospective buyers in public matching links.
                </span>
              </div>
            </div>

            {/* Key Custodian Section */}
            <div className="pt-4 border-t border-crm-border/60 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-crm-text">
                <input
                  type="checkbox"
                  checked={hasKeyHolder}
                  onChange={(e) => setHasKeyHolder(e.target.checked)}
                  className="rounded border-crm-border text-crm-primary focus:ring-crm-primary"
                />
                <span>Specify on-site Key Custodian (Guard, Neighbour, Maintenance Office)</span>
              </label>

              {hasKeyHolder && (
                <div className="p-4 rounded-md bg-stone-50 border border-crm-border space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-crm-text mb-1">
                        Custodian Persona
                      </label>
                      <select
                        value={keyHolderPersona}
                        onChange={(e) =>
                          setKeyHolderPersona(
                            e.target.value as "GUARD" | "MAINTENANCE_OFFICE" | "NEIGHBOUR" | "OWNER" | "OTHER"
                          )
                        }
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white focus:outline-hidden"
                      >
                        <option value="GUARD">Main Gate Guard</option>
                        <option value="MAINTENANCE_OFFICE">Maintenance Office</option>
                        <option value="NEIGHBOUR">Adjacent Flat Neighbour</option>
                        <option value="OWNER">Owner Resides Nearby</option>
                        <option value="OTHER">Other / Caretaker</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-crm-text mb-1">
                        Custodian Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Ramesh Singh"
                        value={keyHolderName}
                        onChange={(e) => setKeyHolderName(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-crm-text mb-1">
                        Custodian Mobile
                      </label>
                      <input
                        type="tel"
                        maxLength={10}
                        placeholder="e.g. 9876543210"
                        value={keyHolderMobile}
                        onChange={(e) => setKeyHolderMobile(e.target.value.replace(/\D/g, ""))}
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white focus:outline-hidden font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-crm-text mb-1">
                      Access Notes / Key Location
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Available at Tower B guard desk between 9 AM and 6 PM"
                      value={keyHolderNotes}
                      onChange={(e) => setKeyHolderNotes(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white focus:outline-hidden"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Form Actions Footer */}
          <div className="p-6 rounded-lg bg-crm-surface border border-crm-border shadow-2xs flex items-center justify-between">
            <Link
              href={`/supply/${property.id}`}
              className="px-4 py-2 text-xs font-semibold rounded-md bg-stone-100 hover:bg-stone-200 text-crm-text border border-crm-border transition-colors shadow-2xs"
            >
              Cancel
            </Link>

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 text-xs font-bold rounded-md bg-crm-primary text-white hover:bg-crm-primary-hover disabled:opacity-50 transition-colors shadow-2xs flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Saving Changes...</span>
                </>
              ) : (
                <span>💾 Save Property Details</span>
              )}
            </button>
          </div>
        </form>

        {toastMessage && (
          <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
        )}
      </div>
    </AppShell>
  );
}
