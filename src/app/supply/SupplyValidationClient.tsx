"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { Property, PropertyMedia } from "@/types/crm";
import {
  createPropertyAction,
  assignPropertyAction,
  assignPropertyRoundRobinAction,
  downloadImportTemplateAction,
  previewBulkPropertyUploadAction,
  confirmBulkPropertyUploadAction,
  uploadPropertyPhotosAction,
  attachPropertyVideoAction,
  deletePropertyMediaAction,
} from "./actions";
import {
  listEligibleFieldVerifiersAction,
  assignPropertyToFieldVerifierAction,
} from "@/app/verifier/actions";
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
  canAssignFieldVerifier?: boolean;
  canUploadMedia?: boolean;
  initialTelecallers?: EligibleTelecallerItem[];
}

export function SupplyValidationClient({
  initialProperties,
  currentUserRole,
  canAssignTelecaller = false,
  canAssignFieldVerifier = false,
  canUploadMedia = false,
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

  // Field Verifier Assignment Modal State
  const [isFieldVerifierModalOpen, setIsFieldVerifierModalOpen] = useState(false);
  const [propertyForFieldVerifier, setPropertyForFieldVerifier] = useState<Property | null>(null);
  const [fieldVerifiersList, setFieldVerifiersList] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [selectedFieldVerifierId, setSelectedFieldVerifierId] = useState("");
  const [fieldVerifierInstructions, setFieldVerifierInstructions] = useState("");
  const [isAssigningFieldVerifier, setIsAssigningFieldVerifier] = useState(false);
  const [fieldVerifierModalError, setFieldVerifierModalError] = useState<string | null>(null);

  const handleOpenFieldVerifierModal = async (prop: Property) => {
    setPropertyForFieldVerifier(prop);
    setFieldVerifierInstructions("");
    setFieldVerifierModalError(null);
    setIsFieldVerifierModalOpen(true);
    try {
      const res = await listEligibleFieldVerifiersAction();
      if (res.success && res.verifiers) {
        setFieldVerifiersList(res.verifiers);
        if (res.verifiers.length > 0) {
          setSelectedFieldVerifierId(res.verifiers[0].id);
        }
      }
    } catch {
      setFieldVerifiersList([]);
    }
  };

  const handleAssignFieldVerifierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyForFieldVerifier || !selectedFieldVerifierId) return;

    setIsAssigningFieldVerifier(true);
    setFieldVerifierModalError(null);
    try {
      const res = await assignPropertyToFieldVerifierAction({
        propertyId: propertyForFieldVerifier.id,
        verifierId: selectedFieldVerifierId,
        instructions: fieldVerifierInstructions.trim() || undefined,
      });

      if (res.success) {
        setIsFieldVerifierModalOpen(false);
        setToastMessage(`Assigned ${propertyForFieldVerifier.societyName} to Field Verifier successfully.`);
        router.refresh();
      }
    } catch (err: unknown) {
      setFieldVerifierModalError((err as Error)?.message || "Failed to assign property to Field Verifier.");
    } finally {
      setIsAssigningFieldVerifier(false);
    }
  };

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

  // Media Upload & Gallery State
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [mediaTargetProperty, setMediaTargetProperty] = useState<Property | null>(null);
  const [mediaTab, setMediaTab] = useState<"PHOTOS" | "VIDEO">("PHOTOS");
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [photoCaption, setPhotoCaption] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoCaption, setVideoCaption] = useState("");
  const [videoParsedInfo, setVideoParsedInfo] = useState<{
    videoId: string;
    canonicalUrl: string;
    embedUrl: string;
    thumbnailUrl: string;
  } | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [mediaModalError, setMediaModalError] = useState<string | null>(null);
  const [activeViewerMedia, setActiveViewerMedia] = useState<PropertyMedia | null>(null);
  const [mediaToDelete, setMediaToDelete] = useState<PropertyMedia | null>(null);
  const [isDeletingMedia, setIsDeletingMedia] = useState(false);
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
      if (currentUserRole === "TELECALLER") {
        setIsCreateModalOpen(false);
        resetCreateForm();
        setToastMessage(
          `Property posted successfully: ${res.property.societyName} Flat ${res.property.flatNumber}. It will appear in your calling queue once assigned by a manager.`
        );
      } else {
        setProperties((prev) => [res.property, ...prev]);
        setIsCreateModalOpen(false);
        resetCreateForm();
        setToastMessage(
          `Property posted successfully: ${res.property.societyName} Flat ${res.property.flatNumber}`
        );
      }
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

  // Media Handlers
  const handleOpenMediaModal = (prop: Property) => {
    setMediaTargetProperty(prop);
    setMediaTab("PHOTOS");
    setSelectedPhotos([]);
    setPhotoPreviews([]);
    setPhotoCaption("");
    setVideoUrl("");
    setVideoCaption("");
    setVideoParsedInfo(null);
    setMediaModalError(null);
    setIsMediaModalOpen(true);
  };

  const handlePhotoFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setMediaModalError(null);

    const newFiles = Array.from(files);
    const combined = [...selectedPhotos, ...newFiles];

    if (combined.length > 10) {
      setMediaModalError("Maximum 10 photos can be uploaded per batch.");
      return;
    }

    // Validate size and basic type
    for (const f of newFiles) {
      if (f.size > 5 * 1024 * 1024) {
        setMediaModalError(`"${f.name}" exceeds the 5 MB limit (${(f.size / (1024 * 1024)).toFixed(1)} MB).`);
        return;
      }
      if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
        setMediaModalError(`"${f.name}" has an unsupported format. Only JPEG, PNG, and WebP are allowed.`);
        return;
      }
    }

    setSelectedPhotos(combined);
    const newPreviews = newFiles.map((f) => URL.createObjectURL(f));
    setPhotoPreviews((prev) => [...prev, ...newPreviews]);
  };

  const handleRemoveSelectedPhoto = (index: number) => {
    const updatedFiles = selectedPhotos.filter((_, i) => i !== index);
    const updatedPreviews = photoPreviews.filter((_, i) => i !== index);
    setSelectedPhotos(updatedFiles);
    setPhotoPreviews(updatedPreviews);
  };

  const handleUploadPhotosSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mediaTargetProperty) return;
    if (selectedPhotos.length === 0) {
      setMediaModalError("Please select at least one photo to upload.");
      return;
    }

    setIsUploadingMedia(true);
    setMediaModalError(null);

    try {
      const formData = new FormData();
      formData.append("propertyId", mediaTargetProperty.id);
      if (photoCaption.trim()) {
        formData.append("caption", photoCaption.trim());
      }
      selectedPhotos.forEach((f) => formData.append("files", f));

      const res = await uploadPropertyPhotosAction(formData);

      if (!res.success) {
        setMediaModalError(res.error || "Failed to upload photos.");
        setIsUploadingMedia(false);
        return;
      }

      if (res.property) {
        setProperties((prev) =>
          prev.map((p) => (p.id === res.property!.id ? res.property! : p))
        );
        if (selectedProperty?.id === res.property.id) {
          setSelectedProperty(res.property);
        }
      }

      setIsMediaModalOpen(false);
      setToastMessage(`Successfully uploaded ${res.uploadedCount} photo(s).`);
    } catch (err) {
      setMediaModalError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleVideoUrlChange = (url: string) => {
    setVideoUrl(url);
    setMediaModalError(null);

    if (!url.trim()) {
      setVideoParsedInfo(null);
      return;
    }

    try {
      const parsed = new URL(url.trim());
      const host = parsed.hostname.toLowerCase();
      let videoId: string | null = null;

      if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
        if (parsed.pathname === "/watch") {
          videoId = parsed.searchParams.get("v");
        } else if (parsed.pathname.startsWith("/shorts/") || parsed.pathname.startsWith("/embed/")) {
          videoId = parsed.pathname.split("/").filter(Boolean)[1] || null;
        }
      } else if (host === "youtu.be") {
        videoId = parsed.pathname.split("/").filter(Boolean)[0] || null;
      }

      if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        setVideoParsedInfo({
          videoId,
          canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        });
      } else {
        setVideoParsedInfo(null);
      }
    } catch {
      setVideoParsedInfo(null);
    }
  };

  const handleAttachVideoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mediaTargetProperty) return;
    if (!videoUrl.trim()) {
      setMediaModalError("Please enter a YouTube video URL.");
      return;
    }

    setIsUploadingMedia(true);
    setMediaModalError(null);

    try {
      const res = await attachPropertyVideoAction({
        propertyId: mediaTargetProperty.id,
        youtubeUrl: videoUrl.trim(),
        caption: videoCaption.trim() || undefined,
      });

      if (!res.success) {
        setMediaModalError(res.error || "Failed to attach YouTube video.");
        setIsUploadingMedia(false);
        return;
      }

      if (res.property) {
        setProperties((prev) =>
          prev.map((p) => (p.id === res.property!.id ? res.property! : p))
        );
        if (selectedProperty?.id === res.property.id) {
          setSelectedProperty(res.property);
        }
      }

      setIsMediaModalOpen(false);
      setToastMessage("YouTube walkthrough video attached successfully.");
    } catch (err) {
      setMediaModalError(err instanceof Error ? err.message : "Failed to attach video.");
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleConfirmDeleteMedia = async () => {
    if (!selectedProperty || !mediaToDelete || !mediaToDelete.id) return;

    setIsDeletingMedia(true);
    try {
      const res = await deletePropertyMediaAction({
        propertyId: selectedProperty.id,
        mediaId: mediaToDelete.id,
      });

      if (!res.success) {
        setToastMessage(`Delete failed: ${res.error}`);
        setIsDeletingMedia(false);
        return;
      }

      if (res.property) {
        setProperties((prev) =>
          prev.map((p) => (p.id === res.property!.id ? res.property! : p))
        );
        setSelectedProperty(res.property);
      }

      setMediaToDelete(null);
      setToastMessage("Media item deleted successfully.");
    } catch (err) {
      setToastMessage(`Delete failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsDeletingMedia(false);
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
                {currentUserRole === "TELECALLER"
                  ? "My Assigned Calling Queue"
                  : "Supply Validation Queue"}
              </h2>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-stone-100 text-crm-muted border border-crm-border">
                {filteredProperties.length} Properties
              </span>
              {currentUserRole === "TELECALLER" && (
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  Assigned to You
                </span>
              )}
            </div>
            <p className="text-xs text-crm-muted mt-1">
              {currentUserRole === "TELECALLER"
                ? "Properties actively assigned to you for owner verification and call disposition logging (PRD §4.3)."
                : "Verify property details, establish owner mandate willingness, and manage calling dispositions (PRD §4)."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canAssignTelecaller && (
              <button
                onClick={handleOpenBulkModal}
                className="px-3 py-1.5 text-xs font-medium rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 shadow-2xs cursor-pointer"
              >
                📥 Upload CSV / Excel
              </button>
            )}
            <Link
              href="/supply/new"
              className="px-3 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs cursor-pointer inline-flex items-center gap-1"
            >
              + Post Property
            </Link>
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
            {currentUserRole !== "TELECALLER" ? (
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
            ) : (
              <div>
                <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                  Assigned Scope
                </label>
                <div className="w-full px-2.5 py-1.5 text-xs rounded border border-emerald-200 bg-emerald-50/60 text-emerald-800 font-semibold flex items-center gap-1">
                  <span>✓ My Calling Queue</span>
                </div>
              </div>
            )}
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
                              <Link
                                href={`/supply/${prop.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="hover:text-crm-primary hover:underline"
                              >
                                {prop.societyName}
                              </Link>
                            </div>
                            <div className="text-[11px] text-crm-muted">
                              Unit #{prop.flatNumber} • {prop.locality}, {prop.city}
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
                                  <span>👤 {currentUserRole === "TELECALLER" ? "Assigned to You" : prop.currentAssignment.assignedUserName}</span>
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
                            <Link
                              href={`/supply/${prop.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="px-2 py-1 text-xs font-semibold rounded bg-white text-crm-text hover:bg-stone-100 border border-crm-border shadow-2xs inline-block"
                              title="View full property details page"
                            >
                              View ↗
                            </Link>
                            <Link
                              href={`/supply/${prop.id}/edit`}
                              onClick={(e) => e.stopPropagation()}
                              className="px-2 py-1 text-xs font-semibold rounded bg-stone-100 text-crm-text hover:bg-stone-200 border border-stone-300 shadow-2xs inline-block"
                              title="Edit property details"
                            >
                              ✏️ Edit
                            </Link>
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
                            <Link
                              href={`/supply/${prop.id}/call`}
                              onClick={(e) => e.stopPropagation()}
                              className="px-2.5 py-1 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs inline-block"
                            >
                              Log Call
                            </Link>
                            {canAssignFieldVerifier && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenFieldVerifierModal(prop);
                                }}
                                className={`px-2 py-1 text-xs font-semibold rounded border shadow-2xs ${
                                  prop.isFieldVerified
                                    ? "bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                                    : "bg-white text-crm-text hover:bg-stone-100 border-crm-border"
                                }`}
                                title={
                                  prop.isFieldVerified
                                    ? "Field Verified — click to reassign"
                                    : "Assign to Field Verifier for on-site inspection"
                                }
                              >
                                {prop.isFieldVerified ? "✓ Verified" : "🚶‍♂️ Field"}
                              </button>
                            )}
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
                <div className="flex items-center gap-1.5">
                  <Link
                    href={`/supply/${selectedProperty.id}`}
                    className="px-2.5 py-1 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs inline-flex items-center gap-1"
                  >
                    Open Page ↗
                  </Link>
                  <Link
                    href={`/supply/${selectedProperty.id}/edit`}
                    className="px-2.5 py-1 text-xs font-semibold rounded bg-white text-crm-text hover:bg-stone-100 border border-crm-border shadow-2xs inline-flex items-center gap-1"
                  >
                    ✏️ Edit
                  </Link>
                  <button
                    onClick={() => setSelectedProperty(null)}
                    className="text-crm-muted hover:text-crm-text p-1 text-sm ml-1"
                    aria-label="Close Inspector"
                  >
                    ✕
                  </button>
                </div>
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
                        {currentUserRole === "TELECALLER" ? "Assigned to You" : "Active Assignment"}
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
                        <strong className="text-crm-text text-xs">
                          {currentUserRole === "TELECALLER"
                            ? "You (Active Assignee)"
                            : selectedProperty.currentAssignment.assignedUserName}
                        </strong>
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

                  {canAssignFieldVerifier && (
                    <div className="pt-2 border-t border-crm-border/40 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold text-crm-muted">
                          Field Physical Verification
                        </span>
                        {selectedProperty.isFieldVerified && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            ✓ Verified
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenFieldVerifierModal(selectedProperty)}
                        className={`w-full py-1.5 px-2.5 text-xs font-semibold rounded border shadow-2xs flex items-center justify-center gap-1.5 ${
                          selectedProperty.isFieldVerified
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                            : "bg-white text-crm-text hover:bg-stone-50 border-crm-border"
                        }`}
                      >
                        <span>🚶‍♂️</span>
                        <span>
                          {selectedProperty.isFieldVerified
                            ? "🔄 Reassign Field Verifier"
                            : "📋 Assign Field Verifier"}
                        </span>
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
                  <Link
                    href={`/supply/${selectedProperty.id}/call`}
                    className="flex-1 py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs text-center inline-block"
                  >
                    📞 Open Call Workspace
                  </Link>
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
                {(canUploadMedia || selectedProperty.media.length > 0) && (
                <div>
                  <div className="flex items-center justify-between mb-2 border-b border-crm-border pb-1">
                    <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                      Property Media ({selectedProperty.media.length})
                    </h4>
                    {canUploadMedia && (
                      <button
                        type="button"
                        onClick={() => handleOpenMediaModal(selectedProperty)}
                        className="px-2 py-0.5 text-[10px] font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs transition-colors flex items-center gap-1"
                      >
                        + Upload Media
                      </button>
                    )}
                  </div>

                  {selectedProperty.media.length === 0 ? (
                    <div className="text-crm-muted italic text-center py-4 bg-stone-50 rounded border border-crm-border text-xs">
                      <div>No photos or videos uploaded yet.</div>
                      {canUploadMedia && (
                        <div className="mt-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenMediaModal(selectedProperty)}
                            className="text-crm-primary font-semibold hover:underline text-[11px]"
                          >
                            Upload photos or attach YouTube video →
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {selectedProperty.media.map((m, i) => {
                        const isVideo = m.type === "VIDEO";
                        let ytThumb = "";
                        if (isVideo) {
                          const match = m.url.match(/(?:watch\?v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
                          if (match) {
                            ytThumb = `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`;
                          }
                        }

                        return (
                          <div
                            key={m.id || i}
                            className="group relative rounded-md border border-crm-border overflow-hidden bg-white hover:border-crm-primary transition-all flex flex-col justify-between shadow-2xs"
                          >
                            <div
                              onClick={() => setActiveViewerMedia(m)}
                              className="cursor-pointer relative aspect-video bg-stone-100 overflow-hidden flex items-center justify-center"
                            >
                              {isVideo ? (
                                <>
                                  {ytThumb ? (
                                    <img
                                      src={ytThumb}
                                      alt={m.caption || "YouTube Video"}
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                    />
                                  ) : (
                                    <div className="text-2xl">🎥</div>
                                  )}
                                  <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
                                    <div className="w-7 h-7 rounded-full bg-red-600 text-white flex items-center justify-center shadow-md text-xs pl-0.5">
                                      ▶
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <img
                                  src={m.url}
                                  alt={m.caption || "Property Photo"}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                />
                              )}

                              <div className="absolute top-1 left-1">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase shadow-2xs ${
                                    isVideo ? "bg-red-600 text-white" : "bg-stone-900/80 text-white"
                                  }`}
                                >
                                  {isVideo ? "Video" : "Photo"}
                                </span>
                              </div>
                            </div>

                            <div className="p-1.5 flex items-center justify-between text-[10px]">
                              <span
                                className="font-medium text-crm-text truncate max-w-[95px]"
                                title={m.caption || (isVideo ? "YouTube Video" : "Property Photo")}
                              >
                                {m.caption || (isVideo ? "YouTube Video" : "Property Photo")}
                              </span>
                              {canUploadMedia && m.id && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMediaToDelete(m);
                                  }}
                                  className="text-crm-muted hover:text-red-600 p-0.5 rounded transition-colors text-xs leading-none font-bold"
                                  title="Delete media"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

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

      {/* Property Assignment Modal */}
      <Modal
        isOpen={isAssignModalOpen}
        onClose={() => {
          setIsAssignModalOpen(false);
          setPropertyToAssign(null);
          setAssignModalError(null);
        }}
        title="Assign Property to Telecaller"
        subtitle="Assign this property to an eligible telecaller for owner verification calling."
      >
        <form onSubmit={handleManualAssign} className="space-y-4">
          {propertyToAssign && (
            <div className="p-3 rounded-lg bg-stone-50 border border-crm-border text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-crm-text">
                  {propertyToAssign.flatNumber}, {propertyToAssign.societyName}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-stone-200 text-stone-800">
                  {propertyToAssign.preference}
                </span>
              </div>
              <div className="text-crm-muted">
                {propertyToAssign.bedroomCount} BHK • {propertyToAssign.locality}, {propertyToAssign.city}
              </div>
              <div className="pt-1 text-[11px] flex items-center gap-1.5">
                <span className="text-crm-muted">Current Assignment:</span>
                {propertyToAssign.currentAssignment ? (
                  <span className="font-semibold text-crm-primary">
                    {propertyToAssign.currentAssignment.assignedUserName} ({propertyToAssign.currentAssignment.status})
                  </span>
                ) : (
                  <span className="font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                    Unassigned
                  </span>
                )}
              </div>
            </div>
          )}

          {assignModalError && (
            <div className="p-2.5 text-xs rounded bg-red-50 border border-red-200 text-red-700 font-medium">
              {assignModalError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-crm-text mb-1">
              Select Eligible Telecaller *
            </label>
            {telecallers.length === 0 ? (
              <div className="p-3 text-xs rounded bg-amber-50 border border-amber-200 text-amber-800">
                No active telecallers found in your tenant. Please add or activate a telecaller in Team Management.
              </div>
            ) : (
              <select
                value={selectedTelecallerId}
                onChange={(e) => setSelectedTelecallerId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary"
              >
                {telecallers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.email})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-crm-text mb-1">
              Assignment Notes (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Priority calling required; owner available after 4 PM"
              value={assignmentNotes}
              onChange={(e) => setAssignmentNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary"
            />
          </div>

          <div className="pt-2 flex items-center justify-between border-t border-crm-border">
            <button
              type="button"
              onClick={() => handleRoundRobinAssign()}
              disabled={isRoundRobinRunning || isAssigning || telecallers.length === 0}
              className="px-3 py-1.5 text-xs font-medium rounded border border-crm-border text-crm-primary hover:bg-stone-50 transition-colors disabled:opacity-50"
            >
              {isRoundRobinRunning ? "Assigning..." : "⚡ Auto Round-Robin"}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsAssignModalOpen(false);
                  setPropertyToAssign(null);
                  setAssignModalError(null);
                }}
                className="px-3 py-1.5 text-xs font-medium rounded border border-crm-border text-crm-muted hover:text-crm-text hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isAssigning || isRoundRobinRunning || telecallers.length === 0}
                className="px-3.5 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs transition-colors disabled:opacity-50"
              >
                {isAssigning ? "Assigning..." : "Assign Property"}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Field Verifier Assignment Modal */}
      <Modal
        isOpen={isFieldVerifierModalOpen}
        onClose={() => {
          setIsFieldVerifierModalOpen(false);
          setPropertyForFieldVerifier(null);
          setFieldVerifierModalError(null);
        }}
        title="Assign Property to Field Verifier"
        subtitle="Assign this property to an eligible field verifier for on-site physical inspection and photo capture."
      >
        <form onSubmit={handleAssignFieldVerifierSubmit} className="space-y-4">
          {propertyForFieldVerifier && (
            <div className="p-3 rounded-lg bg-stone-50 border border-crm-border text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-crm-text">
                  {propertyForFieldVerifier.flatNumber}, {propertyForFieldVerifier.societyName}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-stone-200 text-stone-800">
                  {propertyForFieldVerifier.preference}
                </span>
              </div>
              <div className="text-crm-muted">
                {propertyForFieldVerifier.bedroomCount} BHK • {propertyForFieldVerifier.locality}, {propertyForFieldVerifier.city}
              </div>
              <div className="pt-1 text-[11px] flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-crm-muted">Validation Status:</span>
                  <span className={`font-semibold ${
                    propertyForFieldVerifier.validationStatus === "Validated"
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }`}>
                    {propertyForFieldVerifier.validationStatus}
                  </span>
                </div>
                {propertyForFieldVerifier.isFieldVerified && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                    ✓ Already Verified
                  </span>
                )}
              </div>
            </div>
          )}

          {fieldVerifierModalError && (
            <div className="p-2.5 text-xs rounded bg-red-50 border border-red-200 text-red-700 font-medium">
              {fieldVerifierModalError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-crm-text mb-1">
              Select Field Verifier *
            </label>
            {fieldVerifiersList.length === 0 ? (
              <div className="p-3 text-xs rounded bg-amber-50 border border-amber-200 text-amber-800">
                No active Field Verifiers found in your brokerage. Add or activate a Field Verifier in Team Management.
              </div>
            ) : (
              <select
                value={selectedFieldVerifierId}
                onChange={(e) => setSelectedFieldVerifierId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary"
              >
                {fieldVerifiersList.map((fv) => (
                  <option key={fv.id} value={fv.id}>
                    {fv.name} ({fv.phone || "No phone"})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-crm-text mb-1">
              Special Inspection Instructions (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Verify balcony seepage, count covered parking slots, check key with guard"
              value={fieldVerifierInstructions}
              onChange={(e) => setFieldVerifierInstructions(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-crm-border">
            <button
              type="button"
              onClick={() => {
                setIsFieldVerifierModalOpen(false);
                setPropertyForFieldVerifier(null);
                setFieldVerifierModalError(null);
              }}
              className="px-3 py-1.5 text-xs font-medium rounded border border-crm-border text-crm-muted hover:text-crm-text hover:bg-stone-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isAssigningFieldVerifier || fieldVerifiersList.length === 0}
              className="px-3.5 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs transition-colors disabled:opacity-50"
            >
              {isAssigningFieldVerifier ? "Assigning..." : "Assign Field Verifier"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Bulk Property Upload Modal */}
      <Modal
        isOpen={isBulkModalOpen}
        onClose={() => {
          if (bulkStep !== "IMPORTING") {
            setIsBulkModalOpen(false);
            setBulkStep("SELECT");
            setSelectedFile(null);
            setBulkPreview(null);
            setBulkResult(null);
            setBulkError(null);
          }
        }}
        title="Bulk Property Upload (CSV / Excel)"
        subtitle="Import multiple residential properties into the Supply Validation calling queue at once."
      >
        <div className="space-y-4 text-xs">
          {bulkError && (
            <div className="p-3 text-xs rounded bg-red-50 border border-red-200 text-red-700 font-medium whitespace-pre-line">
              {bulkError}
            </div>
          )}

          {/* Step 1: SELECT */}
          {bulkStep === "SELECT" && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-stone-50 border border-crm-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-crm-text">Download Official PRD Template</div>
                  <div className="text-[11px] text-crm-muted">
                    Pre-formatted with all 20 required and optional columns and sample data.
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isDownloadingTemplate}
                    onClick={() => handleDownloadTemplate("csv")}
                    className="px-2.5 py-1.5 rounded border border-crm-border bg-white text-crm-text hover:border-crm-primary font-medium shadow-2xs disabled:opacity-50"
                  >
                    CSV Template
                  </button>
                  <button
                    type="button"
                    disabled={isDownloadingTemplate}
                    onClick={() => handleDownloadTemplate("xlsx")}
                    className="px-2.5 py-1.5 rounded bg-crm-primary text-white hover:bg-crm-primary-hover font-medium shadow-2xs disabled:opacity-50"
                  >
                    Excel (.xlsx) Template
                  </button>
                </div>
              </div>

              <div className="border-2 border-dashed border-crm-border hover:border-crm-primary rounded-lg p-6 text-center space-y-2 bg-white transition-colors">
                <svg className="w-8 h-8 text-crm-muted mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <div className="font-semibold text-crm-text">
                  Choose a CSV or Excel file to upload
                </div>
                <div className="text-[11px] text-crm-muted">
                  Supports .csv, .xlsx, and .xls (Max 5 MB, up to 500 rows per batch)
                </div>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  onChange={handleFileChange}
                  className="block mx-auto text-xs text-crm-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-crm-primary file:text-white hover:file:bg-crm-primary-hover cursor-pointer"
                />
                {selectedFile && (
                  <div className="pt-2 text-xs font-semibold text-crm-primary">
                    Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </div>
                )}
              </div>

              <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11px] leading-relaxed">
                ℹ️ <strong>Active Supply Pool Protection:</strong> Imported properties are automatically created with status <em>Not Validated</em> and unassigned. They will NOT appear in the Active Supply Pool or lead matching until owner willingness is confirmed by a telecaller.
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-crm-border">
                <button
                  type="button"
                  onClick={() => setIsBulkModalOpen(false)}
                  className="px-3 py-1.5 rounded border border-crm-border text-crm-muted hover:text-crm-text"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selectedFile || isAnalyzing}
                  onClick={handleAnalyzeFile}
                  className="px-4 py-1.5 rounded bg-crm-primary text-white font-semibold hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50"
                >
                  {isAnalyzing ? "Analyzing File..." : "Analyze & Preview Rows →"}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: PREVIEW */}
          {bulkStep === "PREVIEW" && bulkPreview && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2.5 rounded border border-crm-border bg-stone-50 text-center">
                  <div className="text-[10px] uppercase font-bold text-crm-muted">Total Rows</div>
                  <div className="text-base font-bold text-crm-text mt-0.5">{bulkPreview.totalRows}</div>
                </div>
                <div className="p-2.5 rounded border border-emerald-200 bg-emerald-50 text-center">
                  <div className="text-[10px] uppercase font-bold text-emerald-800">Valid</div>
                  <div className="text-base font-bold text-emerald-700 mt-0.5">{bulkPreview.validCount}</div>
                </div>
                <div className="p-2.5 rounded border border-red-200 bg-red-50 text-center">
                  <div className="text-[10px] uppercase font-bold text-red-800">Errors</div>
                  <div className="text-base font-bold text-red-700 mt-0.5">{bulkPreview.errorCount}</div>
                </div>
                <div className="p-2.5 rounded border border-amber-200 bg-amber-50 text-center">
                  <div className="text-[10px] uppercase font-bold text-amber-800">Duplicates</div>
                  <div className="text-base font-bold text-amber-700 mt-0.5">{bulkPreview.duplicateCount}</div>
                </div>
              </div>

              {bulkPreview.duplicateCount > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
                  <div className="font-semibold text-amber-900 text-xs">
                    ⚠️ Potential Duplicate Properties Detected ({bulkPreview.duplicateCount})
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    Some rows match properties that already exist in this brokerage or appear multiple times in this file. By default, duplicate rows will be skipped during import.
                  </p>
                  <label className="flex items-center gap-2 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overrideDuplicates}
                      onChange={(e) => setOverrideDuplicates(e.target.checked)}
                      className="rounded border-amber-400 text-crm-primary focus:ring-crm-primary"
                    />
                    <span className="text-xs font-semibold text-amber-900">
                      Import duplicate rows anyway (Override warnings)
                    </span>
                  </label>
                </div>
              )}

              <div className="border border-crm-border rounded-lg overflow-hidden">
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-stone-50 border-b border-crm-border sticky top-0">
                      <tr>
                        <th className="py-2 px-2.5 font-bold text-crm-muted">Row</th>
                        <th className="py-2 px-2.5 font-bold text-crm-muted">Society & Flat</th>
                        <th className="py-2 px-2.5 font-bold text-crm-muted">BHK / Type</th>
                        <th className="py-2 px-2.5 font-bold text-crm-muted">Price</th>
                        <th className="py-2 px-2.5 font-bold text-crm-muted">Owner</th>
                        <th className="py-2 px-2.5 font-bold text-crm-muted">Status / Validation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-crm-border bg-white">
                      {bulkPreview.rows.map((row) => (
                        <tr
                          key={row.rowNumber}
                          className={
                            !row.isValid
                              ? "bg-red-50/50"
                              : row.isDuplicate
                              ? "bg-amber-50/40"
                              : "hover:bg-stone-50"
                          }
                        >
                          <td className="py-2 px-2.5 font-mono text-crm-muted">{row.rowNumber}</td>
                          <td className="py-2 px-2.5">
                            <span className="font-semibold text-crm-text">
                              {row.flatNumber || "—"}, {row.societyName || "—"}
                            </span>
                            <div className="text-[10px] text-crm-muted">
                              {row.localityName}, {row.city}
                            </div>
                          </td>
                          <td className="py-2 px-2.5">
                            {row.bedroomCount} BHK {row.propertyType}
                            <div className="text-[10px] text-crm-muted">{row.preference}</div>
                          </td>
                          <td className="py-2 px-2.5 font-mono">
                            ₹{row.price ? row.price.toLocaleString("en-IN") : "0"}
                          </td>
                          <td className="py-2 px-2.5">
                            <div>{row.ownerName || "—"}</div>
                            <div className="font-mono text-[10px] text-crm-muted">{row.ownerMobile}</div>
                          </td>
                          <td className="py-2 px-2.5">
                            {!row.isValid ? (
                              <div className="text-red-700 font-semibold">
                                ✕ Invalid
                                <div className="text-[10px] text-red-600 font-normal">
                                  {row.errors.slice(0, 2).join("; ")}
                                </div>
                              </div>
                            ) : row.isDuplicate ? (
                              <div className="text-amber-700 font-semibold">
                                ⚠️ Duplicate
                                <div className="text-[10px] text-amber-600 font-normal">
                                  {row.duplicateWarning}
                                </div>
                              </div>
                            ) : (
                              <span className="text-emerald-700 font-semibold">✓ Ready to Import</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between border-t border-crm-border">
                <button
                  type="button"
                  onClick={() => setBulkStep("SELECT")}
                  className="px-3 py-1.5 rounded border border-crm-border text-crm-muted hover:text-crm-text"
                >
                  ← Choose Different File
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsBulkModalOpen(false)}
                    className="px-3 py-1.5 rounded border border-crm-border text-crm-muted hover:text-crm-text"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      bulkPreview.validCount === 0 ||
                      (!overrideDuplicates && bulkPreview.validCount === bulkPreview.duplicateCount)
                    }
                    onClick={handleConfirmImport}
                    className="px-4 py-1.5 rounded bg-crm-primary text-white font-semibold hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50"
                  >
                    Confirm & Import Valid Properties
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: IMPORTING */}
          {bulkStep === "IMPORTING" && (
            <div className="py-12 text-center space-y-3">
              <div className="w-8 h-8 border-3 border-crm-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <div className="font-semibold text-crm-text text-sm">
                Importing properties into database transaction...
              </div>
              <div className="text-crm-muted text-xs">
                Saving verified records, initializing key-holders, and placing properties in calling queue.
              </div>
            </div>
          )}

          {/* Step 4: SUMMARY */}
          {bulkStep === "SUMMARY" && bulkResult && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-center space-y-1">
                <div className="text-emerald-700 text-xl font-bold">Import Completed</div>
                <div className="text-xs text-emerald-800">{bulkResult.message}</div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2 rounded border border-crm-border bg-stone-50">
                  <div className="text-[10px] text-crm-muted uppercase font-bold">Total</div>
                  <div className="text-sm font-bold text-crm-text mt-0.5">{bulkResult.totalProcessed}</div>
                </div>
                <div className="p-2 rounded border border-emerald-200 bg-emerald-50">
                  <div className="text-[10px] text-emerald-800 uppercase font-bold">Imported</div>
                  <div className="text-sm font-bold text-emerald-700 mt-0.5">{bulkResult.importedCount}</div>
                </div>
                <div className="p-2 rounded border border-amber-200 bg-amber-50">
                  <div className="text-[10px] text-amber-800 uppercase font-bold">Skipped</div>
                  <div className="text-sm font-bold text-amber-700 mt-0.5">{bulkResult.skippedCount}</div>
                </div>
                <div className="p-2 rounded border border-red-200 bg-red-50">
                  <div className="text-[10px] text-red-800 uppercase font-bold">Failed</div>
                  <div className="text-sm font-bold text-red-700 mt-0.5">{bulkResult.failedCount}</div>
                </div>
              </div>

              {bulkResult.failures.length > 0 && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 space-y-1.5">
                  <div className="font-semibold text-red-800 text-xs">Unimported / Skipped Rows:</div>
                  <ul className="text-[11px] text-red-700 list-disc list-inside space-y-0.5 max-h-32 overflow-y-auto">
                    {bulkResult.failures.map((f) => (
                      <li key={f.rowNumber}>
                        Row {f.rowNumber}: {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="pt-2 flex justify-end border-t border-crm-border">
                <button
                  type="button"
                  onClick={() => {
                    setIsBulkModalOpen(false);
                    setBulkStep("SELECT");
                    setSelectedFile(null);
                    setBulkPreview(null);
                    setBulkResult(null);
                  }}
                  className="px-4 py-1.5 rounded bg-crm-primary text-white font-semibold hover:bg-crm-primary-hover shadow-2xs"
                >
                  Done & View Validation Queue
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Upload Property Media Modal */}
      <Modal
        isOpen={isMediaModalOpen}
        onClose={() => {
          if (!isUploadingMedia) {
            setIsMediaModalOpen(false);
            setMediaTargetProperty(null);
            setSelectedPhotos([]);
            setPhotoPreviews([]);
            setPhotoCaption("");
            setVideoUrl("");
            setVideoCaption("");
            setVideoParsedInfo(null);
            setMediaModalError(null);
          }
        }}
        title="Upload Property Media"
        subtitle={
          mediaTargetProperty
            ? `${mediaTargetProperty.flatNumber}, ${mediaTargetProperty.societyName} (${mediaTargetProperty.locality}, ${mediaTargetProperty.city})`
            : "Upload verified property photos or attach YouTube walkthrough video."
        }
      >
        <div className="space-y-4 text-xs">
          {mediaModalError && (
            <div className="p-2.5 rounded bg-red-50 border border-red-200 text-red-700 font-medium">
              {mediaModalError}
            </div>
          )}

          {/* Tab selector */}
          <div className="flex border-b border-crm-border">
            <button
              type="button"
              onClick={() => {
                setMediaTab("PHOTOS");
                setMediaModalError(null);
              }}
              className={`pb-2 px-4 font-semibold text-xs border-b-2 transition-colors ${
                mediaTab === "PHOTOS"
                  ? "border-crm-primary text-crm-primary"
                  : "border-transparent text-crm-muted hover:text-crm-text"
              }`}
            >
              🖼️ Upload Photos
            </button>
            <button
              type="button"
              onClick={() => {
                setMediaTab("VIDEO");
                setMediaModalError(null);
              }}
              className={`pb-2 px-4 font-semibold text-xs border-b-2 transition-colors ${
                mediaTab === "VIDEO"
                  ? "border-crm-primary text-crm-primary"
                  : "border-transparent text-crm-muted hover:text-crm-text"
              }`}
            >
              🎥 Attach YouTube Walkthrough
            </button>
          </div>

          {/* Tab 1: PHOTOS */}
          {mediaTab === "PHOTOS" && (
            <form onSubmit={handleUploadPhotosSubmit} className="space-y-4">
              <div className="border-2 border-dashed border-crm-border hover:border-crm-primary rounded-lg p-5 text-center space-y-2 bg-stone-50/50 transition-colors">
                <svg className="w-8 h-8 text-crm-muted mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <div className="font-semibold text-crm-text">
                  Choose property photos to upload
                </div>
                <div className="text-[11px] text-crm-muted">
                  Supports JPEG, PNG, and WebP (Max 5 MB per file, up to 10 photos per batch)
                </div>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => handlePhotoFilesSelected(e.target.files)}
                  className="block mx-auto text-xs text-crm-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-crm-primary file:text-white hover:file:bg-crm-primary-hover cursor-pointer"
                />
              </div>

              {selectedPhotos.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-crm-muted font-medium">
                    <span>Selected Photos ({selectedPhotos.length}/10)</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPhotos([]);
                        setPhotoPreviews([]);
                      }}
                      className="text-red-600 hover:underline text-[11px]"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2 max-h-44 overflow-y-auto p-1 border border-crm-border rounded bg-stone-50">
                    {photoPreviews.map((src, idx) => (
                      <div key={idx} className="relative aspect-square rounded border border-crm-border overflow-hidden bg-white group">
                        <img src={src} alt="Preview" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => handleRemoveSelectedPhoto(idx)}
                          className="absolute top-1 right-1 bg-black/70 hover:bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] transition-colors"
                        >
                          ✕
                        </button>
                        <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] text-white px-1 py-0.5 truncate">
                          {selectedPhotos[idx]?.name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1">
                  Photo Caption / Description (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Master Bedroom, Modular Kitchen, Society Clubhouse"
                  value={photoCaption}
                  onChange={(e) => setPhotoCaption(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div className="p-2.5 rounded bg-stone-50 border border-crm-border text-crm-muted text-[11px] leading-relaxed">
                🔒 <strong>Tenant Storage Rule:</strong> Photos are stored securely in tenant-isolated storage and accessible only by authenticated brokerage users.
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-crm-border">
                <button
                  type="button"
                  onClick={() => setIsMediaModalOpen(false)}
                  className="px-3 py-1.5 rounded border border-crm-border text-crm-muted hover:text-crm-text"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={selectedPhotos.length === 0 || isUploadingMedia}
                  className="px-4 py-1.5 rounded bg-crm-primary text-white font-semibold hover:bg-crm-primary-hover shadow-2xs transition-colors disabled:opacity-50"
                >
                  {isUploadingMedia ? "Uploading Photos..." : `Upload ${selectedPhotos.length} Photo(s)`}
                </button>
              </div>
            </form>
          )}

          {/* Tab 2: VIDEO */}
          {mediaTab === "VIDEO" && (
            <form onSubmit={handleAttachVideoSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1">
                  YouTube Walkthrough Video URL *
                </label>
                <input
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
                  value={videoUrl}
                  onChange={(e) => handleVideoUrlChange(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary"
                />
                <div className="text-[11px] text-crm-muted mt-1">
                  Accepts public or unlisted YouTube video links (desktop, mobile, or YouTube Shorts).
                </div>
              </div>

              {videoParsedInfo && (
                <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/50 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-emerald-800">
                    <span>✓ Valid YouTube Video Identified</span>
                    <span className="font-mono text-[10px] text-crm-muted">ID: {videoParsedInfo.videoId}</span>
                  </div>
                  <div className="aspect-video max-w-xs mx-auto rounded overflow-hidden border border-crm-border shadow-xs">
                    <iframe
                      src={videoParsedInfo.embedUrl}
                      title="YouTube Preview"
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1">
                  Video Caption / Description (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Full 3 BHK Walkthrough Video Tour"
                  value={videoCaption}
                  onChange={(e) => setVideoCaption(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <div className="p-2.5 rounded bg-stone-50 border border-crm-border text-crm-muted text-[11px] leading-relaxed">
                ℹ️ <strong>PRD Storage Strategy (Decision Q11):</strong> Video files are hosted on YouTube to avoid heavy transcoding overhead. The CRM stores and embeds the validated walkthrough URL.
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-crm-border">
                <button
                  type="button"
                  onClick={() => setIsMediaModalOpen(false)}
                  className="px-3 py-1.5 rounded border border-crm-border text-crm-muted hover:text-crm-text"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!videoParsedInfo || isUploadingMedia}
                  className="px-4 py-1.5 rounded bg-crm-primary text-white font-semibold hover:bg-crm-primary-hover shadow-2xs transition-colors disabled:opacity-50"
                >
                  {isUploadingMedia ? "Attaching Video..." : "Attach YouTube Video"}
                </button>
              </div>
            </form>
          )}
        </div>
      </Modal>

      {/* Lightbox / Media Viewer Modal */}
      {activeViewerMedia && (
        <Modal
          isOpen={!!activeViewerMedia}
          onClose={() => setActiveViewerMedia(null)}
          title={activeViewerMedia.caption || (activeViewerMedia.type === "VIDEO" ? "Walkthrough Video" : "Property Photo")}
          subtitle={activeViewerMedia.type === "VIDEO" ? "YouTube Walkthrough Video" : "Verified Property Photo"}
        >
          <div className="space-y-3">
            {activeViewerMedia.type === "VIDEO" ? (
              <div className="aspect-video w-full rounded overflow-hidden border border-crm-border shadow-xs bg-black">
                {(() => {
                  const match = activeViewerMedia.url.match(/(?:watch\?v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
                  const embedUrl = match ? `https://www.youtube.com/embed/${match[1]}?autoplay=1` : activeViewerMedia.url;
                  return (
                    <iframe
                      src={embedUrl}
                      title={activeViewerMedia.caption || "YouTube Video"}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  );
                })()}
              </div>
            ) : (
              <div className="max-h-[65vh] flex items-center justify-center bg-stone-900 rounded overflow-hidden">
                <img
                  src={activeViewerMedia.url}
                  alt={activeViewerMedia.caption || "Property Photo"}
                  className="max-h-[65vh] w-auto object-contain"
                />
              </div>
            )}

            <div className="flex items-center justify-between text-xs pt-2 border-t border-crm-border">
              <div className="text-crm-muted">
                {activeViewerMedia.caption && <span className="font-medium text-crm-text mr-2">{activeViewerMedia.caption}</span>}
                {activeViewerMedia.createdAt && (
                  <span>Added {new Date(activeViewerMedia.createdAt).toLocaleDateString("en-IN")}</span>
                )}
              </div>
              {activeViewerMedia.type === "VIDEO" && (
                <a
                  href={activeViewerMedia.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-crm-primary font-semibold hover:underline flex items-center gap-1"
                >
                  Open on YouTube ↗
                </a>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Media Confirmation Modal */}
      {mediaToDelete && (
        <Modal
          isOpen={!!mediaToDelete}
          onClose={() => {
            if (!isDeletingMedia) setMediaToDelete(null);
          }}
          title="Delete Property Media"
          subtitle="Are you sure you want to permanently delete this media item?"
        >
          <div className="space-y-4 text-xs">
            <p className="text-crm-text">
              This action will remove the {mediaToDelete.type === "VIDEO" ? "YouTube video link" : "photo"}
              {mediaToDelete.caption ? ` ("${mediaToDelete.caption}")` : ""} from this property and delete its storage object. This cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-crm-border">
              <button
                type="button"
                disabled={isDeletingMedia}
                onClick={() => setMediaToDelete(null)}
                className="px-3 py-1.5 rounded border border-crm-border text-crm-muted hover:text-crm-text"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingMedia}
                onClick={handleConfirmDeleteMedia}
                className="px-3.5 py-1.5 rounded bg-red-600 text-white font-semibold hover:bg-red-700 shadow-2xs disabled:opacity-50"
              >
                {isDeletingMedia ? "Deleting..." : "Delete Media Item"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </AppShell>
  );
}

