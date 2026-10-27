"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { Property } from "@/types/crm";
import {
  createPropertyAction,
  logPropertyCallAction,
  assignPropertyAction,
  assignPropertyRoundRobinAction,
  downloadImportTemplateAction,
  previewBulkPropertyUploadAction,
  confirmBulkPropertyUploadAction,
} from "./actions";
import type { BulkImportPreview, BulkImportResult } from "@/server/dal/bulk-import";

function downloadBase64File(base64: string, filename: string, mimeType: string) {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface EligibleTelecallerItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  isActive: boolean;
}

interface SupplyValidationClientProps {
  initialProperties: Property[];
  currentUserRole?: string;
  canAssignTelecaller?: boolean;
  initialTelecallers?: EligibleTelecallerItem[];
}

export function SupplyValidationClient({
  initialProperties,
  currentUserRole,
  canAssignTelecaller = false,
  initialTelecallers = [],
}: SupplyValidationClientProps) {
  const router = useRouter();
  const [properties, setProperties] = useState<Property[]>(initialProperties);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [validationFilter, setValidationFilter] = useState("All");
  const [availabilityFilter, setAvailabilityFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [preferenceFilter, setPreferenceFilter] = useState("All");
  const [bhkFilter, setBhkFilter] = useState("All");
  const [assignmentFilter, setAssignmentFilter] = useState("All");

  // Assignment Modal & Execution State
  const [telecallers] = useState<EligibleTelecallerItem[]>(initialTelecallers);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [propertyToAssign, setPropertyToAssign] = useState<Property | null>(null);
  const [selectedTelecallerId, setSelectedTelecallerId] = useState<string>("");
  const [assignmentNotes, setAssignmentNotes] = useState<string>("");
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignModalError, setAssignModalError] = useState<string | null>(null);
  const [isRoundRobinRunning, setIsRoundRobinRunning] = useState(false);

  // Bulk Upload Modal & State
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkStep, setBulkStep] = useState<"SELECT" | "PREVIEW" | "IMPORTING" | "SUMMARY">("SELECT");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkPreview, setBulkPreview] = useState<BulkImportPreview | null>(null);
  const [overrideDuplicates, setOverrideDuplicates] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkImportResult | null>(null);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);

  // Call Logging Modal state
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callDisposition, setCallDisposition] = useState("PROPERTY_AVAILABLE");
  const [callNotes, setCallNotes] = useState("");
  const [callbackTime, setCallbackTime] = useState("");
  const [confirmOwnerWillingness, setConfirmOwnerWillingness] = useState(false);
  const [isCallSubmitting, setIsCallSubmitting] = useState(false);
  const [callModalError, setCallModalError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Manual Property Entry Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    message: string;
    existing: {
      societyName: string;
      flatNumber: string;
      bedroomCount: number;
      propertyType: string;
    };
  } | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  // Form Field States
  const [formSociety, setFormSociety] = useState("");
  const [formFlatNumber, setFormFlatNumber] = useState("");
  const [formLocality, setFormLocality] = useState("");
  const [formCity, setFormCity] = useState("Gurgaon");
  const [formPreference, setFormPreference] = useState<"SALE" | "RENT">("SALE");
  const [formPropertyType, setFormPropertyType] = useState<
    "APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT"
  >("APARTMENT");
  const [formFurnishing, setFormFurnishing] = useState<
    "UNFURNISHED" | "SEMI_FURNISHED" | "FURNISHED"
  >("SEMI_FURNISHED");
  const [formConstruction, setFormConstruction] = useState<
    "READY_TO_MOVE" | "UNDER_CONSTRUCTION"
  >("READY_TO_MOVE");
  const [formBedrooms, setFormBedrooms] = useState("3");
  const [formBathrooms, setFormBathrooms] = useState("3");
  const [formBalconies, setFormBalconies] = useState("1");
  const [formArea, setFormArea] = useState("");
  const [formAreaType, setFormAreaType] = useState<
    "CARPET" | "BUILT_UP" | "SUPER_BUILT_UP"
  >("SUPER_BUILT_UP");
  const [formPrice, setFormPrice] = useState("");
  const [formAmenities, setFormAmenities] = useState("Lift, Power Backup, Security");
  const [formOwnerName, setFormOwnerName] = useState("");
  const [formOwnerMobile, setFormOwnerMobile] = useState("");

  // Optional KeyHolder states
  const [hasKeyHolder, setHasKeyHolder] = useState(false);
  const [formKhName, setFormKhName] = useState("");
  const [formKhMobile, setFormKhMobile] = useState("");
  const [formKhPersona, setFormKhPersona] = useState<
    "GUARD" | "MAINTENANCE_OFFICE" | "NEIGHBOUR" | "OWNER" | "OTHER"
  >("GUARD");
  const [formKhNotes, setFormKhNotes] = useState("");

  const resetCreateForm = () => {
    setFormSociety("");
    setFormFlatNumber("");
    setFormLocality("");
    setFormCity("Gurgaon");
    setFormPreference("SALE");
    setFormPropertyType("APARTMENT");
    setFormFurnishing("SEMI_FURNISHED");
    setFormConstruction("READY_TO_MOVE");
    setFormBedrooms("3");
    setFormBathrooms("3");
    setFormBalconies("1");
    setFormArea("");
    setFormAreaType("SUPER_BUILT_UP");
    setFormPrice("");
    setFormAmenities("Lift, Power Backup, Security");
    setFormOwnerName("");
    setFormOwnerMobile("");
    setHasKeyHolder(false);
    setFormKhName("");
    setFormKhMobile("");
    setFormKhPersona("GUARD");
    setFormKhNotes("");
    setFormError(null);
    setDuplicateWarning(null);
    setConfirmDuplicate(false);
  };

  const handleCreateProperty = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setFormError(null);

    // Client-side validations
    if (!formSociety.trim()) {
      setFormError("Society name is required.");
      return;
    }
    if (!formFlatNumber.trim()) {
      setFormError("Flat number is required.");
      return;
    }
    if (!formLocality.trim()) {
      setFormError("Locality is required.");
      return;
    }
    if (!formCity.trim()) {
      setFormError("City is required.");
      return;
    }
    if (!formOwnerName.trim()) {
      setFormError("Owner name is required.");
      return;
    }
    const cleanOwnerMobile = formOwnerMobile.replace(/\D/g, "");
    const normalizedMobile =
      cleanOwnerMobile.length === 12 && cleanOwnerMobile.startsWith("91")
        ? cleanOwnerMobile.slice(2)
        : cleanOwnerMobile.length === 11 && cleanOwnerMobile.startsWith("0")
        ? cleanOwnerMobile.slice(1)
        : cleanOwnerMobile;

    if (!/^[6-9]\d{9}$/.test(normalizedMobile)) {
      setFormError("Owner mobile must be a valid 10-digit Indian mobile number.");
      return;
    }

    const areaNum = parseFloat(formArea);
    if (isNaN(areaNum) || areaNum <= 0) {
      setFormError("Please enter a valid property area in sq ft.");
      return;
    }

    const priceNum = parseFloat(formPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      setFormError("Please enter a valid price in INR.");
      return;
    }

    const bhkNum = parseInt(formBedrooms, 10);
    const bathNum = parseInt(formBathrooms, 10);
    const balconyNum = parseInt(formBalconies, 10) || 0;

    // Key holder validation if provided
    let keyHolderPayload: {
      name: string;
      mobile: string;
      persona: "GUARD" | "MAINTENANCE_OFFICE" | "NEIGHBOUR" | "OWNER" | "OTHER";
      notes?: string;
    } | null = null;

    if (hasKeyHolder && formKhName.trim()) {
      let khMobileNormalized = "";
      if (formKhMobile.trim()) {
        const cleanKh = formKhMobile.replace(/\D/g, "");
        khMobileNormalized =
          cleanKh.length === 12 && cleanKh.startsWith("91")
            ? cleanKh.slice(2)
            : cleanKh.length === 11 && cleanKh.startsWith("0")
            ? cleanKh.slice(1)
            : cleanKh;
        if (!/^[6-9]\d{9}$/.test(khMobileNormalized)) {
          setFormError("Key-holder mobile must be a valid 10-digit Indian mobile number.");
          return;
        }
      }
      keyHolderPayload = {
        name: formKhName.trim(),
        mobile: khMobileNormalized || normalizedMobile,
        persona: formKhPersona,
        notes: formKhNotes.trim() || undefined,
      };
    }

    setIsSubmitting(true);
    try {
      const parsedAmenities = formAmenities
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      const res = await createPropertyAction({
        societyName: formSociety.trim(),
        flatNumber: formFlatNumber.trim(),
        localityName: formLocality.trim(),
        city: formCity.trim(),
        preference: formPreference,
        propertyType: formPropertyType,
        furnishingStatus: formFurnishing,
        constructionStatus: formConstruction,
        bedroomCount: bhkNum,
        bathroomCount: bathNum,
        balconyCount: balconyNum,
        area: areaNum,
        areaType: formAreaType,
        price: priceNum,
        ownerName: formOwnerName.trim(),
        ownerMobile: normalizedMobile,
        amenities: parsedAmenities,
        keyHolder: keyHolderPayload,
        confirmDuplicate: confirmDuplicate,
      });

      if (!res.success) {
        if (res.isDuplicate && res.duplicateProperty) {
          setDuplicateWarning({
            message: res.error,
            existing: res.duplicateProperty,
          });
        } else {
          setFormError(res.error);
        }
        return;
      }

      // Success
      setProperties((prev) => [res.property, ...prev]);
      setIsCreateModalOpen(false);
      resetCreateForm();
      setToastMessage(
        `Property posted successfully: ${res.property.societyName} Flat ${res.property.flatNumber}`
      );
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to create property.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered Properties
  const filteredProperties = useMemo(() => {
    return properties.filter((prop) => {
      // Search
      const searchMatch =
        prop.societyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        prop.locality.toLowerCase().includes(searchTerm.toLowerCase()) ||
        prop.ownerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        prop.city.toLowerCase().includes(searchTerm.toLowerCase());

      if (!searchMatch) return false;

      // Validation Filter
      if (validationFilter !== "All" && prop.validationStatus !== validationFilter) {
        return false;
      }

      // Availability Filter
      if (availabilityFilter !== "All" && prop.availabilityStatus !== availabilityFilter) {
        return false;
      }

      // Type Filter
      if (typeFilter !== "All" && prop.propertyType !== typeFilter) {
        return false;
      }

      // Preference
      if (preferenceFilter !== "All" && prop.preference !== preferenceFilter) {
        return false;
      }

      // BHK
      if (bhkFilter !== "All") {
        if (bhkFilter === "4+" && prop.bedroomCount < 4) return false;
        if (bhkFilter !== "4+" && prop.bedroomCount.toString() !== bhkFilter) return false;
      }

      // Assignment Filter
      if (assignmentFilter === "Assigned" && !prop.currentAssignment) return false;
      if (assignmentFilter === "Unassigned" && prop.currentAssignment) return false;

      return true;
    });
  }, [
    properties,
    searchTerm,
    validationFilter,
    availabilityFilter,
    typeFilter,
    preferenceFilter,
    bhkFilter,
    assignmentFilter,
  ]);

  // Assignment Handlers
  const handleOpenAssignModal = (prop: Property) => {
    setPropertyToAssign(prop);
    const existingAssignee = prop.currentAssignment?.assignedUserId;
    if (existingAssignee && telecallers.some((t) => t.id === existingAssignee)) {
      setSelectedTelecallerId(existingAssignee);
    } else {
      setSelectedTelecallerId(telecallers[0]?.id || "");
    }
    setAssignmentNotes(prop.currentAssignment?.notes || "");
    setAssignModalError(null);
    setIsAssignModalOpen(true);
  };

  const handleManualAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyToAssign) return;
    if (!selectedTelecallerId) {
      setAssignModalError("Please select an eligible telecaller.");
      return;
    }

    setIsAssigning(true);
    setAssignModalError(null);

    const res = await assignPropertyAction({
      propertyId: propertyToAssign.id,
      telecallerId: selectedTelecallerId,
      notes: assignmentNotes.trim() || undefined,
    });

    setIsAssigning(false);

    if (!res.success) {
      setAssignModalError(res.error || "Failed to assign property.");
      return;
    }

    setProperties((prev) =>
      prev.map((p) => (p.id === res.property.id ? res.property : p))
    );
    if (selectedProperty?.id === res.property.id) {
      setSelectedProperty(res.property);
    }
    setIsAssignModalOpen(false);
    setPropertyToAssign(null);
    setToastMessage(
      `Property assigned to ${res.property.currentAssignment?.assignedUserName || "telecaller"} successfully.`
    );
  };

  const handleRoundRobinAssign = async (targetProp?: Property) => {
    const prop = targetProp || propertyToAssign;
    if (!prop) return;

    setIsRoundRobinRunning(true);
    setAssignModalError(null);

    const res = await assignPropertyRoundRobinAction({
      propertyId: prop.id,
      notes: assignmentNotes.trim() || undefined,
    });

    setIsRoundRobinRunning(false);

    if (!res.success) {
      setAssignModalError(res.error || "Failed to execute round-robin assignment.");
      if (!isAssignModalOpen) {
        setToastMessage(`Auto-assignment failed: ${res.error}`);
      }
      return;
    }

    setProperties((prev) =>
      prev.map((p) => (p.id === res.property.id ? res.property : p))
    );
    if (selectedProperty?.id === res.property.id) {
      setSelectedProperty(res.property);
    }
    if (isAssignModalOpen) {
      setIsAssignModalOpen(false);
      setPropertyToAssign(null);
    }
    setToastMessage(
      `Auto-assigned to ${res.property.currentAssignment?.assignedUserName || "telecaller"} via round-robin.`
    );
  };

  // Bulk Upload Handlers
  const handleOpenBulkModal = () => {
    setBulkStep("SELECT");
    setSelectedFile(null);
    setIsAnalyzing(false);
    setBulkError(null);
    setBulkPreview(null);
    setOverrideDuplicates(false);
    setBulkResult(null);
    setIsBulkModalOpen(true);
  };

  const handleDownloadTemplate = async (format: "csv" | "xlsx") => {
    setIsDownloadingTemplate(true);
    setBulkError(null);
    try {
      const res = await downloadImportTemplateAction(format);
      if (!res.success || !res.base64) {
        setBulkError(res.error || "Failed to download template.");
        return;
      }
      downloadBase64File(res.base64, res.filename, res.mimeType);
      setToastMessage(`Template downloaded (${format.toUpperCase()}).`);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed to download template.");
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setBulkError(null);
    }
  };

  const handleAnalyzeFile = async () => {
    if (!selectedFile) {
      setBulkError("Please choose a CSV or Excel file to analyze.");
      return;
    }

    setIsAnalyzing(true);
    setBulkError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const res = await previewBulkPropertyUploadAction(formData);

      if (!res.success || !res.preview) {
        setBulkError(res.error || "Failed to analyze file.");
        return;
      }

      if (res.preview.hasHeadersError) {
        setBulkError(res.preview.headersErrorMessage || "Missing required headers.");
        return;
      }

      setBulkPreview(res.preview);
      setBulkStep("PREVIEW");
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed to parse file.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!bulkPreview) return;

    setBulkStep("IMPORTING");
    setBulkError(null);

    try {
      const res = await confirmBulkPropertyUploadAction({
        rows: bulkPreview.rows,
        overrideDuplicates,
      });

      if (!res.success || !res.result) {
        setBulkError(res.error || "Failed to import properties.");
        setBulkStep("PREVIEW");
        return;
      }

      setBulkResult(res.result);
      setBulkStep("SUMMARY");
      setToastMessage(`Bulk import complete: ${res.result.importedCount} properties imported.`);
      router.refresh();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Import failed.");
      setBulkStep("PREVIEW");
    }
  };

  const handleOpenCallModal = (prop: Property) => {
    setSelectedProperty(prop);
    setCallDisposition("PROPERTY_AVAILABLE");
    setCallNotes("");
    setCallbackTime("");
    setConfirmOwnerWillingness(false);
    setCallModalError(null);
    setIsCallModalOpen(true);
  };

  const handleSaveCallOutcome = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedProperty) return;

    setCallModalError(null);

    if (callDisposition === "CALL_BACK" && !callbackTime.trim()) {
      setCallModalError("A callback date and time is required when disposition is Call Back.");
      return;
    }

    setIsCallSubmitting(true);
    try {
      const res = await logPropertyCallAction({
        propertyId: selectedProperty.id,
        disposition: callDisposition,
        notes: callNotes.trim() || null,
        callbackScheduledAt: callbackTime.trim() || null,
        confirmOwnerWillingness: confirmOwnerWillingness,
      });

      if (!res.success) {
        setCallModalError(res.error);
        return;
      }

      // Update local state with fresh property from DB
      setProperties((prev) =>
        prev.map((p) => (p.id === res.property.id ? res.property : p))
      );
      setSelectedProperty(res.property);
      setIsCallModalOpen(false);

      setToastMessage(
        `Call outcome recorded for ${res.property.societyName}: ${res.property.currentDisposition}`
      );
    } catch (err: unknown) {
      setCallModalError(err instanceof Error ? err.message : "Failed to record call outcome.");
    } finally {
      setIsCallSubmitting(false);
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
                Supply Validation Queue
              </h2>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-stone-100 text-crm-muted border border-crm-border">
                {filteredProperties.length} Properties
              </span>
            </div>
            <p className="text-xs text-crm-muted mt-1">
              Verify property details, establish owner mandate willingness, and manage calling dispositions (PRD §4).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenBulkModal}
              className="px-3 py-1.5 text-xs font-medium rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 shadow-2xs cursor-pointer"
            >
              📥 Upload CSV / Excel
            </button>
            <button
              onClick={() => {
                resetCreateForm();
                setIsCreateModalOpen(true);
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs cursor-pointer"
            >
              + Post Property
            </button>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="p-4 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
            {/* Search Input */}
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Search Society, Locality, Owner
              </label>
              <input
                type="text"
                placeholder="e.g. DLF, Sobha, Golf Course..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            {/* Validation Status Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Validation Status
              </label>
              <select
                value={validationFilter}
                onChange={(e) => setValidationFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">All Validation Statuses</option>
                <option value="Not Validated">Not Validated</option>
                <option value="In Validation">In Validation</option>
                <option value="Validated">Validated</option>
                <option value="Mandate Declined">Mandate Declined</option>
              </select>
            </div>

            {/* Availability Status Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Availability
              </label>
              <select
                value={availabilityFilter}
                onChange={(e) => setAvailabilityFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">All Availabilities</option>
                <option value="Available">Available</option>
                <option value="Temporarily Unavailable">Temp. Unavailable</option>
                <option value="Sold">Sold</option>
                <option value="Rented">Rented</option>
              </select>
            </div>

            {/* Preference (Sale / Rent) */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Preference
              </label>
              <select
                value={preferenceFilter}
                onChange={(e) => setPreferenceFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">Sale & Rent</option>
                <option value="Sale">Sale Only</option>
                <option value="Rent">Rent Only</option>
              </select>
            </div>

            {/* Property Type Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Property Type
              </label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">All Types</option>
                <option value="Apartment">Apartment</option>
                <option value="Independent House">House</option>
                <option value="Villa">Villa</option>
                <option value="Builder Floor">Builder Floor</option>
              </select>
            </div>

            {/* BHK Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Bedrooms (BHK)
              </label>
              <select
                value={bhkFilter}
                onChange={(e) => setBhkFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">Any BHK</option>
                <option value="2">2 BHK</option>
                <option value="3">3 BHK</option>
                <option value="4+">4+ BHK</option>
              </select>
            </div>

            {/* Assignment Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Assignment
              </label>
              <select
                value={assignmentFilter}
                onChange={(e) => setAssignmentFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">All Assignments</option>
                <option value="Assigned">Assigned Only</option>
                <option value="Unassigned">Unassigned Only</option>
              </select>
            </div>
          </div>
        </div>

        {/* Main Content Layout: Table + Side Drawer (when selected) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Properties Table */}
          <div
            className={`rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden transition-all ${
              selectedProperty ? "lg:col-span-7" : "lg:col-span-12"
            }`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 border-b border-crm-border text-crm-muted uppercase tracking-wider font-semibold text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Property & Society</th>
                    <th className="px-3 py-3">Type & Area</th>
                    <th className="px-3 py-3">Price / Rent</th>
                    <th className="px-3 py-3">Owner Contact</th>
                    <th className="px-3 py-3">Validation Status</th>
                    <th className="px-3 py-3">Assigned Telecaller</th>
                    <th className="px-3 py-3">Calling Disposition</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-crm-border">
                  {properties.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-crm-muted">
                        <div className="max-w-sm mx-auto space-y-1">
                          {currentUserRole === "TELECALLER" ? (
                            <>
                              <p className="font-semibold text-crm-text text-sm">No Assigned Properties in Queue</p>
                              <p className="text-xs text-crm-muted">
                                You do not currently have any properties assigned for validation calling. When a manager assigns properties to you, they will appear here in your calling queue.
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="font-semibold text-crm-text text-sm">No properties added yet</p>
                              <p className="text-xs text-crm-muted">
                                Use &quot;+ Post Property&quot; or &quot;Upload CSV / Excel&quot; to add resale and rental inventory.
                              </p>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : filteredProperties.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-crm-muted">
                        No properties found matching current filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredProperties.map((prop) => {
                      const isSelected = selectedProperty?.id === prop.id;
                      return (
                        <tr
                          key={prop.id}
                          onClick={() => setSelectedProperty(prop)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? "bg-teal-50/60 font-medium" : "hover:bg-stone-50/70"
                          }`}
                        >
                          {/* Property & Society */}
                          <td className="px-4 py-3">
                            <div className="font-bold text-crm-text">
                              {prop.societyName}
                            </div>
                            <div className="text-[11px] text-crm-muted">
                              {prop.locality}, {prop.city}
                            </div>
                          </td>

                          {/* Specs */}
                          <td className="px-3 py-3 text-crm-muted">
                            <div>{prop.bedroomCount} BHK {prop.propertyType}</div>
                            <div className="text-[11px]">
                              {prop.area.toLocaleString()} sq.ft ({prop.areaType})
                            </div>
                          </td>

                          {/* Price */}
                          <td className="px-3 py-3 font-semibold text-crm-text">
                            <div>{prop.priceFormatted}</div>
                            <StatusBadge status={prop.preference} />
                          </td>

                          {/* Owner Contact */}
                          <td className="px-3 py-3">
                            <div className="text-crm-text font-medium">{prop.ownerName}</div>
                            <div className="text-[11px] text-crm-muted">{prop.ownerMobile}</div>
                          </td>

                          {/* Validation & Availability */}
                          <td className="px-3 py-3 space-y-1">
                            <div><StatusBadge status={prop.validationStatus} /></div>
                            <div><StatusBadge status={prop.availabilityStatus} /></div>
                          </td>

                          {/* Assigned Telecaller */}
                          <td className="px-3 py-3">
                            {prop.currentAssignment ? (
                              <div>
                                <div className="font-medium text-crm-text flex items-center gap-1">
                                  <span>👤 {prop.currentAssignment.assignedUserName}</span>
                                </div>
                                <div className="text-[10px] text-crm-muted flex items-center gap-1 mt-0.5">
                                  <span className="px-1.5 py-0.2 bg-teal-50 text-teal-800 rounded border border-teal-200">
                                    {prop.currentAssignment.assignmentMethod}
                                  </span>
                                  <span className="truncate max-w-[90px]">{prop.currentAssignment.assignedAt}</span>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                                  ⚠️ Unassigned
                                </span>
                                {canAssignTelecaller && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRoundRobinAssign(prop);
                                    }}
                                    disabled={isRoundRobinRunning}
                                    className="block text-[10px] text-crm-primary hover:underline font-semibold mt-1"
                                    title="Auto-assign to telecaller via round robin"
                                  >
                                    ⚡ Auto-Assign
                                  </button>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Calling Disposition */}
                          <td className="px-3 py-3">
                            <StatusBadge status={prop.currentDisposition} />
                          </td>

                          {/* Action */}
                          <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                            {canAssignTelecaller && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenAssignModal(prop);
                                }}
                                className="px-2 py-1 text-xs font-semibold rounded bg-stone-100 text-stone-700 hover:bg-stone-200 border border-stone-300 shadow-2xs"
                              >
                                {prop.currentAssignment ? "Reassign" : "Assign"}
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenCallModal(prop);
                              }}
                              className="px-2.5 py-1 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                            >
                              Log Call
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Selected Property Detail Slide-Over / Inspector */}
          {selectedProperty && (
            <div className="lg:col-span-5 rounded-lg bg-crm-surface border border-crm-border shadow-xs overflow-hidden sticky top-4 space-y-4">
              {/* Header */}
              <div className="px-5 py-4 border-b border-crm-border bg-stone-50/60 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-crm-text">
                      {selectedProperty.societyName}
                    </h3>
                    <StatusBadge status={selectedProperty.preference} />
                  </div>
                  <p className="text-xs text-crm-muted mt-0.5">
                    {selectedProperty.flatNumber} • {selectedProperty.locality}, {selectedProperty.city}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedProperty(null)}
                  className="text-crm-muted hover:text-crm-text p-1 text-sm"
                  aria-label="Close Inspector"
                >
                  ✕
                </button>
              </div>

              <div className="p-5 space-y-5 text-xs max-h-[75vh] overflow-y-auto">
                {/* Status Summary Banner */}
                <div className="p-3 rounded-md bg-stone-50 border border-crm-border flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-crm-muted block">Validation Status</span>
                    <StatusBadge status={selectedProperty.validationStatus} />
                  </div>
                  <div>
                    <span className="text-[11px] text-crm-muted block">Availability</span>
                    <StatusBadge status={selectedProperty.availabilityStatus} />
                  </div>
                  <div>
                    <span className="text-[11px] text-crm-muted block">Active Supply Pool</span>
                    <span className={`font-bold text-xs ${selectedProperty.isActiveSupply ? "text-emerald-700" : "text-amber-700"}`}>
                      {selectedProperty.isActiveSupply ? "✓ Active Pool" : "✗ Outside Pool"}
                    </span>
                  </div>
                </div>

                {/* Primary Specs & Price */}
                <div>
                  <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px] mb-2 border-b border-crm-border pb-1">
                    Property Specifications
                  </h4>
                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div>
                      <span className="text-crm-muted block text-[11px]">Price / Asking Rent</span>
                      <strong className="text-crm-text text-sm">{selectedProperty.priceFormatted}</strong>
                    </div>
                    <div>
                      <span className="text-crm-muted block text-[11px]">Area & Unit</span>
                      <strong className="text-crm-text">{selectedProperty.area} sq.ft ({selectedProperty.areaType})</strong>
                    </div>
                    <div>
                      <span className="text-crm-muted block text-[11px]">Configuration</span>
                      <span className="text-crm-text font-medium">
                        {selectedProperty.bedroomCount} Beds, {selectedProperty.bathroomCount} Baths, {selectedProperty.balconyCount} Balconies
                      </span>
                    </div>
                    <div>
                      <span className="text-crm-muted block text-[11px]">Furnishing</span>
                      <span className="text-crm-text font-medium">{selectedProperty.furnishingStatus}</span>
                    </div>
                    <div>
                      <span className="text-crm-muted block text-[11px]">Construction Status</span>
                      <span className="text-crm-text font-medium">{selectedProperty.constructionStatus}</span>
                    </div>
                  </div>
                </div>

                {/* Assignment & Telecaller Status Card */}
                <div className="p-3.5 rounded-lg border border-crm-border bg-stone-50/60 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-crm-text text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <span>👤 Telecaller Assignment</span>
                    </h4>
                    {selectedProperty.currentAssignment ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                        Active Assignment
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                        Unassigned
                      </span>
                    )}
                  </div>

                  {selectedProperty.currentAssignment ? (
                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-crm-border/60">
                      <div>
                        <span className="text-crm-muted block text-[10px]">Assigned Telecaller</span>
                        <strong className="text-crm-text text-xs">{selectedProperty.currentAssignment.assignedUserName}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted block text-[10px]">Method & Time</span>
                        <span className="text-crm-text font-medium">
                          {selectedProperty.currentAssignment.assignmentMethod} • {selectedProperty.currentAssignment.assignedAt}
                        </span>
                      </div>
                      {selectedProperty.currentAssignment.assignedByUserName && (
                        <div className="col-span-2 text-[10px] text-crm-muted">
                          Assigned by: <strong className="text-crm-text">{selectedProperty.currentAssignment.assignedByUserName}</strong>
                          {selectedProperty.currentAssignment.notes && (
                            <span className="italic block mt-0.5">Note: &quot;{selectedProperty.currentAssignment.notes}&quot;</span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-crm-muted italic">
                      This property is not yet assigned to any telecaller. Telecallers cannot log calls on unassigned properties.
                    </p>
                  )}

                  {canAssignTelecaller && (
                    <div className="flex gap-2 pt-1.5 border-t border-crm-border/40">
                      <button
                        onClick={() => handleOpenAssignModal(selectedProperty)}
                        className="flex-1 py-1.5 px-2.5 text-xs font-semibold rounded bg-white text-crm-text hover:bg-stone-100 border border-crm-border shadow-2xs text-center"
                      >
                        {selectedProperty.currentAssignment ? "🔄 Reassign Telecaller" : "👤 Assign Telecaller"}
                      </button>
                      <button
                        onClick={() => handleRoundRobinAssign(selectedProperty)}
                        disabled={isRoundRobinRunning}
                        className="py-1.5 px-3 text-xs font-semibold rounded bg-teal-50 text-teal-800 hover:bg-teal-100 border border-teal-200 shadow-2xs"
                        title="Distribute via Fair Round Robin"
                      >
                        {isRoundRobinRunning ? "Assigning..." : "⚡ Auto-Assign"}
                      </button>
                    </div>
                  )}
                </div>

                {/* Owner & Key Holder Contacts */}
                <div>
                  <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px] mb-2 border-b border-crm-border pb-1">
                    Contact & Key Details
                  </h4>
                  <div className="p-3 rounded border border-crm-border bg-stone-50/50 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-crm-muted">Owner (Private)</span>
                        <div className="font-bold text-crm-text">{selectedProperty.ownerName}</div>
                        <div className="text-crm-muted">{selectedProperty.ownerMobile}</div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-red-50 text-red-700 border border-red-200">
                        Masked to Buyers
                      </span>
                    </div>

                    <div className="pt-2 border-t border-crm-border text-[11px]">
                      <span className="text-crm-muted block font-semibold">Key Custodian ({selectedProperty.keyHolder.persona}):</span>
                      <div className="text-crm-text font-medium">{selectedProperty.keyHolder.name} ({selectedProperty.keyHolder.mobile})</div>
                      {selectedProperty.keyHolder.notes && (
                        <div className="text-crm-muted italic text-[10px] mt-0.5">{selectedProperty.keyHolder.notes}</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenCallModal(selectedProperty)}
                    className="flex-1 py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs text-center"
                  >
                    📞 Log Owner Call Outcome
                  </button>
                </div>

                {/* Call History Timeline */}
                <div>
                  <div className="flex items-center justify-between mb-2 border-b border-crm-border pb-1">
                    <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                      Owner Call History ({selectedProperty.callHistory.length})
                    </h4>
                    <span className="text-[10px] text-crm-muted">Newest First</span>
                  </div>
                  {selectedProperty.callHistory.length === 0 ? (
                    <div className="text-crm-muted italic text-center py-3.5 bg-stone-50 rounded border border-crm-border text-xs">
                      No calls logged yet. Click &quot;Log Owner Call Outcome&quot; above to record owner conversation.
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-72 overflow-y-auto pr-0.5">
                      {selectedProperty.callHistory.map((call) => (
                        <div
                          key={call.id}
                          className="p-2.5 rounded border border-crm-border bg-stone-50/40 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <StatusBadge status={call.disposition} />
                            <span className="text-[10px] text-crm-muted shrink-0">{call.calledAt}</span>
                          </div>
                          <p className="text-crm-text text-[11px] leading-relaxed">
                            {call.notes || <span className="italic text-crm-muted">No notes recorded.</span>}
                          </p>
                          {call.callbackDate && (
                            <div className="text-amber-800 text-[10px] font-medium flex items-center gap-1 bg-amber-50/60 px-2 py-0.5 rounded border border-amber-200/60">
                              <span>⏰ Callback Scheduled:</span>
                              <strong>{call.callbackDate}</strong>
                            </div>
                          )}
                          <div className="text-[10px] text-crm-muted pt-0.5 border-t border-crm-border/40">
                            Logged by: <strong className="text-crm-text">{call.callerName}</strong>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Assignment Audit History */}
                {selectedProperty.assignmentHistory && selectedProperty.assignmentHistory.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2 border-b border-crm-border pb-1">
                      <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                        Assignment History ({selectedProperty.assignmentHistory.length})
                      </h4>
                      <span className="text-[10px] text-crm-muted">Audit Trail</span>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-0.5">
                      {selectedProperty.assignmentHistory.map((assign) => (
                        <div
                          key={assign.id}
                          className="p-2.5 rounded border border-crm-border bg-stone-50/40 text-[11px] space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-crm-text">👤 {assign.assignedUserName}</span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                assign.status === "Active"
                                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                  : "bg-stone-100 text-stone-600 border border-stone-200"
                              }`}
                            >
                              {assign.status}
                            </span>
                          </div>
                          <div className="text-[10px] text-crm-muted flex items-center justify-between">
                            <span>Method: <strong>{assign.assignmentMethod}</strong></span>
                            <span>{assign.assignedAt}</span>
                          </div>
                          {assign.unassignedAt && (
                            <div className="text-[10px] text-stone-500 italic">
                              Reassigned at: {assign.unassignedAt}
                            </div>
                          )}
                          {assign.assignedByUserName && (
                            <div className="text-[10px] text-crm-muted">
                              Assigned by: <strong className="text-crm-text">{assign.assignedByUserName}</strong>
                            </div>
                          )}
                          {assign.notes && (
                            <div className="text-[10px] text-crm-muted italic bg-white p-1 rounded border border-stone-200 mt-1">
                              &quot;{assign.notes}&quot;
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Media Section */}
                <div>
                  <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px] mb-2 border-b border-crm-border pb-1">
                    Property Media ({selectedProperty.media.length})
                  </h4>
                  {selectedProperty.media.length === 0 ? (
                    <div className="text-crm-muted italic text-center py-3 bg-stone-50 rounded border border-crm-border">
                      No photos or videos uploaded yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedProperty.media.map((m, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2 rounded border border-crm-border bg-stone-50/50 text-[11px]"
                        >
                          <div className="flex items-center gap-2">
                            <span>{m.type === "PHOTO" ? "🖼️" : "🎥"}</span>
                            <span className="font-medium text-crm-text">{m.caption}</span>
                          </div>
                          <a
                            href={m.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-crm-link hover:underline text-[10px]"
                          >
                            View Link ↗
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Log Call Outcome */}
      <Modal
        isOpen={isCallModalOpen}
        onClose={() => {
          if (!isCallSubmitting) {
            setIsCallModalOpen(false);
            setCallModalError(null);
          }
        }}
        title={`Log Call Outcome: ${selectedProperty?.societyName || ""}`}
        subtitle={`Flat: ${selectedProperty?.flatNumber || ""} • Owner: ${selectedProperty?.ownerName || ""} (${selectedProperty?.ownerMobile || ""})`}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setIsCallModalOpen(false);
                setCallModalError(null);
              }}
              disabled={isCallSubmitting}
              className="px-3.5 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveCallOutcome}
              disabled={isCallSubmitting}
              className="px-4 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs disabled:opacity-50 flex items-center gap-1.5"
            >
              {isCallSubmitting ? (
                <>
                  <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Call Outcome</span>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          {callModalError && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 font-medium">
              ⚠️ {callModalError}
            </div>
          )}

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Calling Disposition (Required) *
            </label>
            <select
              value={callDisposition}
              onChange={(e) => {
                setCallDisposition(e.target.value);
                setCallModalError(null);
              }}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            >
              <option value="PROPERTY_AVAILABLE">Property Available</option>
              <option value="CALL_BACK">Call Back (Requires scheduled datetime)</option>
              <option value="RINGING_OR_NOT_ANSWERING">Ringing / Not Answering</option>
              <option value="TEMPORARILY_UNAVAILABLE">Temporarily Unavailable (Paused)</option>
              <option value="OWNER_DECLINES_MANDATE">Owner Declines Mandate (Reject Mandate)</option>
              <option value="PROPERTY_SOLD_OR_RENTED">Property Sold or Rented (Move Inactive)</option>
            </select>
          </div>

          {callDisposition === "PROPERTY_AVAILABLE" && (
            <div className="p-3 rounded-md bg-stone-50/80 border border-crm-border space-y-1.5">
              <label className="flex items-start gap-2 cursor-pointer font-semibold text-crm-text">
                <input
                  type="checkbox"
                  checked={confirmOwnerWillingness}
                  onChange={(e) => setConfirmOwnerWillingness(e.target.checked)}
                  className="mt-0.5 rounded border-crm-border text-crm-primary focus:ring-crm-primary"
                />
                <div>
                  <span className="text-xs">Confirm Owner Willingness & Mandate</span>
                  <p className="text-[11px] font-normal text-crm-muted mt-0.5">
                    Check if the owner explicitly confirmed willingness to work with our brokerage and authorized marketing. If unchecked, the property remains In Validation and outside the Active Supply Pool.
                  </p>
                </div>
              </label>
            </div>
          )}

          {callDisposition === "CALL_BACK" && (
            <div>
              <label className="block font-semibold text-crm-text mb-1">
                Callback Date & Time (Required) *
              </label>
              <input
                type="datetime-local"
                required
                value={callbackTime}
                onChange={(e) => {
                  setCallbackTime(e.target.value);
                  if (callModalError) setCallModalError(null);
                }}
                className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>
          )}

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Caller Notes & Conversation Log
            </label>
            <textarea
              rows={3}
              placeholder="Record owner conversation details, negotiation terms, inspection availability, key location..."
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
            />
          </div>

          <div className="p-2.5 rounded bg-stone-50 border border-crm-border text-crm-muted text-[11px] leading-relaxed">
            ℹ️ <strong>PRD Validation Invariant:</strong> Recording this call creates an append-only audit entry. Active Supply Pool eligibility strictly requires both confirmed owner willingness and validated availability.
          </div>
        </div>
      </Modal>

      {/* Manual Property Entry Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => {
          if (!isSubmitting) {
            setIsCreateModalOpen(false);
            resetCreateForm();
          }
        }}
        title="Post New Property"
        subtitle="Manually register an inventory unit for owner calling and verification workflow (PRD §4)."
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setIsCreateModalOpen(false);
                resetCreateForm();
              }}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleCreateProperty()}
              disabled={isSubmitting}
              className="px-4 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full" />
                  <span>Submitting...</span>
                </>
              ) : (
                <span>Submit Property</span>
              )}
            </button>
          </>
        }
      >
        <form onSubmit={handleCreateProperty} className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 font-medium">
              ⚠️ {formError}
            </div>
          )}

          {duplicateWarning && (
            <div className="p-3.5 rounded-md bg-amber-50 border border-amber-300 text-amber-900 space-y-2">
              <div className="font-semibold flex items-center gap-1.5">
                <span>⚠️ Potential Duplicate Inventory Detected</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                A property matching <strong>{duplicateWarning.existing.societyName} (Flat {duplicateWarning.existing.flatNumber})</strong> already exists in your brokerage database ({duplicateWarning.existing.bedroomCount} BHK {duplicateWarning.existing.propertyType}).
              </p>
              <label className="flex items-start gap-2 pt-1 font-semibold text-amber-950 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmDuplicate}
                  onChange={(e) => setConfirmDuplicate(e.target.checked)}
                  className="mt-0.5 rounded border-amber-400 text-crm-primary focus:ring-crm-primary"
                />
                <span className="text-[11px]">
                  I confirm this is a distinct unit or separate re-listing and wish to proceed.
                </span>
              </label>
            </div>
          )}

          {/* Section 1: Property Location & Unit */}
          <div className="space-y-2.5">
            <h4 className="text-[11px] font-bold text-crm-text uppercase tracking-wider border-b border-crm-border pb-1">
              1. Location & Identification
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Society / Project Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. DLF Phase 5, Sobha City"
                  value={formSociety}
                  onChange={(e) => {
                    setFormSociety(e.target.value);
                    if (duplicateWarning) setDuplicateWarning(null);
                  }}
                  className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Flat / Unit Number *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Tower B - 1204"
                  value={formFlatNumber}
                  onChange={(e) => {
                    setFormFlatNumber(e.target.value);
                    if (duplicateWarning) setDuplicateWarning(null);
                  }}
                  className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Locality / Sector *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sector 54, Golf Course Road"
                  value={formLocality}
                  onChange={(e) => setFormLocality(e.target.value)}
                  className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  City *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Gurgaon, Noida, Delhi"
                  value={formCity}
                  onChange={(e) => setFormCity(e.target.value)}
                  className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Property Type & Specs */}
          <div className="space-y-2.5 pt-1">
            <h4 className="text-[11px] font-bold text-crm-text uppercase tracking-wider border-b border-crm-border pb-1">
              2. Configuration & Specifications
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Transaction Preference *
                </label>
                <select
                  value={formPreference}
                  onChange={(e) => setFormPreference(e.target.value as "SALE" | "RENT")}
                  className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  <option value="SALE">Sale (Resale)</option>
                  <option value="RENT">Rent (Lease)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Property Type *
                </label>
                <select
                  value={formPropertyType}
                  onChange={(e) =>
                    setFormPropertyType(
                      e.target.value as "APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT"
                    )
                  }
                  className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  <option value="APARTMENT">Apartment</option>
                  <option value="BUILDER_FLOOR">Builder Floor</option>
                  <option value="VILLA">Villa</option>
                  <option value="INDEPENDENT_HOUSE">Independent House</option>
                  <option value="PLOT">Plot</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Furnishing Status *
                </label>
                <select
                  value={formFurnishing}
                  onChange={(e) =>
                    setFormFurnishing(
                      e.target.value as "UNFURNISHED" | "SEMI_FURNISHED" | "FURNISHED"
                    )
                  }
                  className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  <option value="SEMI_FURNISHED">Semi-furnished</option>
                  <option value="FURNISHED">Furnished</option>
                  <option value="UNFURNISHED">Unfurnished</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Bedrooms (BHK) *
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={formBedrooms}
                  onChange={(e) => setFormBedrooms(e.target.value)}
                  className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Bathrooms *
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={formBathrooms}
                  onChange={(e) => setFormBathrooms(e.target.value)}
                  className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Balconies
                </label>
                <input
                  type="number"
                  min="0"
                  value={formBalconies}
                  onChange={(e) => setFormBalconies(e.target.value)}
                  className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Area (sq ft) *
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  placeholder="e.g. 1850"
                  value={formArea}
                  onChange={(e) => setFormArea(e.target.value)}
                  className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Area Type *
                </label>
                <select
                  value={formAreaType}
                  onChange={(e) =>
                    setFormAreaType(
                      e.target.value as "CARPET" | "BUILT_UP" | "SUPER_BUILT_UP"
                    )
                  }
                  className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  <option value="SUPER_BUILT_UP">Super Built-up</option>
                  <option value="BUILT_UP">Built-up</option>
                  <option value="CARPET">Carpet Area</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Construction Status *
                </label>
                <select
                  value={formConstruction}
                  onChange={(e) =>
                    setFormConstruction(
                      e.target.value as "READY_TO_MOVE" | "UNDER_CONSTRUCTION"
                    )
                  }
                  className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                >
                  <option value="READY_TO_MOVE">Ready to Move</option>
                  <option value="UNDER_CONSTRUCTION">Under Construction</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  {formPreference === "SALE" ? "Asking Price (INR) *" : "Monthly Rent (INR) *"}
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  placeholder={formPreference === "SALE" ? "e.g. 24500000 (2.45 Cr)" : "e.g. 65000"}
                  value={formPrice}
                  onChange={(e) => setFormPrice(e.target.value)}
                  className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Amenities / Features
                </label>
                <input
                  type="text"
                  placeholder="Lift, Security, Power Backup, Gym"
                  value={formAmenities}
                  onChange={(e) => setFormAmenities(e.target.value)}
                  className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Owner Details */}
          <div className="space-y-2.5 pt-1">
            <h4 className="text-[11px] font-bold text-crm-text uppercase tracking-wider border-b border-crm-border pb-1">
              3. Owner Contact Information
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Owner Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rajesh Khurana"
                  value={formOwnerName}
                  onChange={(e) => setFormOwnerName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Owner Mobile Number *
                </label>
                <input
                  type="tel"
                  required
                  placeholder="10-digit Indian mobile (e.g. 9811234567)"
                  value={formOwnerMobile}
                  onChange={(e) => setFormOwnerMobile(e.target.value)}
                  className="w-full px-3 py-1.5 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>
            </div>
          </div>

          {/* Section 4: Key-Holder Details (Optional) */}
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between border-b border-crm-border pb-1">
              <h4 className="text-[11px] font-bold text-crm-text uppercase tracking-wider">
                4. Key-Holder Details (Optional)
              </h4>
              <label className="flex items-center gap-1.5 font-medium text-crm-muted cursor-pointer text-[11px]">
                <input
                  type="checkbox"
                  checked={hasKeyHolder}
                  onChange={(e) => setHasKeyHolder(e.target.checked)}
                  className="rounded border-crm-border text-crm-primary focus:ring-crm-primary"
                />
                <span>Specify physical key custodian</span>
              </label>
            </div>

            {hasKeyHolder && (
              <div className="p-3 rounded-md bg-stone-50/60 border border-crm-border space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Key-Holder Name *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Bahadur Singh"
                      value={formKhName}
                      onChange={(e) => setFormKhName(e.target.value)}
                      className="w-full px-3 py-1.5 rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Key-Holder Mobile
                    </label>
                    <input
                      type="tel"
                      placeholder="10-digit mobile"
                      value={formKhMobile}
                      onChange={(e) => setFormKhMobile(e.target.value)}
                      className="w-full px-3 py-1.5 rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-crm-text mb-1">
                      Custodian Persona *
                    </label>
                    <select
                      value={formKhPersona}
                      onChange={(e) =>
                        setFormKhPersona(
                          e.target.value as "GUARD" | "MAINTENANCE_OFFICE" | "NEIGHBOUR" | "OWNER" | "OTHER"
                        )
                      }
                      className="w-full px-2.5 py-1.5 rounded border border-crm-border bg-white focus:outline-hidden"
                    >
                      <option value="GUARD">Society Guard</option>
                      <option value="MAINTENANCE_OFFICE">Maintenance Office</option>
                      <option value="NEIGHBOUR">Neighbour</option>
                      <option value="OWNER">Owner</option>
                      <option value="OTHER">Other Representative</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-crm-text mb-1">
                    Key Location & Access Notes
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Keys at Tower B reception desk from 9 AM to 6 PM"
                    value={formKhNotes}
                    onChange={(e) => setFormKhNotes(e.target.value)}
                    className="w-full px-3 py-1.5 rounded border border-crm-border bg-white focus:outline-hidden"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="p-2.5 rounded bg-stone-50 border border-crm-border text-crm-muted text-[11px] leading-relaxed">
            ℹ️ <strong>Supply Validation Rule:</strong> Newly created properties enter the calling queue as <em>Not Validated</em>. They will only qualify for the Active Supply Pool after owner willingness is confirmed and availability is validated.
          </div>
        </form>
      </Modal>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </AppShell>
  );
}

