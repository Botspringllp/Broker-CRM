"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { Property, PropertyMedia } from "@/types/crm";
import {
  logPropertyCallAction,
  assignPropertyAction,
  assignPropertyRoundRobinAction,
  uploadPropertyPhotosAction,
  attachPropertyVideoAction,
  deletePropertyMediaAction,
} from "../actions";
import {
  listEligibleFieldVerifiersAction,
  assignPropertyToFieldVerifierAction,
} from "@/app/verifier/actions";

export interface EligibleTelecallerItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  isActive: boolean;
}

interface PropertyDetailsClientProps {
  property: Property;
  currentUserRole?: string;
  canEdit?: boolean;
  canLogCall?: boolean;
  canAssignTelecaller?: boolean;
  canAssignFieldVerifier?: boolean;
  canUploadMedia?: boolean;
  initialTelecallers?: EligibleTelecallerItem[];
}

export function PropertyDetailsClient({
  property: initialProperty,
  currentUserRole,
  canEdit = false,
  canLogCall = false,
  canAssignTelecaller = false,
  canAssignFieldVerifier = false,
  canUploadMedia = false,
  initialTelecallers = [],
}: PropertyDetailsClientProps) {
  const router = useRouter();
  const [property, setProperty] = useState<Property>(initialProperty);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Call Logging Modal State
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callDisposition, setCallDisposition] = useState("PROPERTY_AVAILABLE");
  const [callbackDate, setCallbackDate] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [isLoggingCall, setIsLoggingCall] = useState(false);
  const [callModalError, setCallModalError] = useState<string | null>(null);

  // Telecaller Assignment Modal State
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [selectedTelecallerId, setSelectedTelecallerId] = useState(
    initialTelecallers[0]?.id || ""
  );
  const [assignmentNotes, setAssignmentNotes] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignModalError, setAssignModalError] = useState<string | null>(null);
  const [isRoundRobinRunning, setIsRoundRobinRunning] = useState(false);

  // Field Verifier Assignment Modal State
  const [isFieldVerifierModalOpen, setIsFieldVerifierModalOpen] = useState(false);
  const [fieldVerifiersList, setFieldVerifiersList] = useState<
    { id: string; name: string; phone: string }[]
  >([]);
  const [selectedFieldVerifierId, setSelectedFieldVerifierId] = useState("");
  const [fieldVerifierInstructions, setFieldVerifierInstructions] = useState("");
  const [isAssigningFieldVerifier, setIsAssigningFieldVerifier] = useState(false);
  const [fieldVerifierModalError, setFieldVerifierModalError] = useState<string | null>(null);

  // Media Management State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [photoCaption, setPhotoCaption] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [videoCaption, setVideoCaption] = useState("");
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lightboxMedia, setLightboxMedia] = useState<PropertyMedia | null>(null);

  // Handlers for Call Logging
  const handleOpenCallModal = () => {
    setCallDisposition("PROPERTY_AVAILABLE");
    setCallbackDate("");
    setCallNotes("");
    setCallModalError(null);
    setIsCallModalOpen(true);
  };

  const handleCallSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingCall(true);
    setCallModalError(null);

    const res = await logPropertyCallAction({
      propertyId: property.id,
      disposition: callDisposition,
      notes: callNotes.trim() || undefined,
      callbackScheduledAt: callbackDate ? new Date(callbackDate).toISOString() : undefined,
    });

    setIsLoggingCall(false);

    if (res.success && res.property) {
      setProperty(res.property);
      setIsCallModalOpen(false);
      setToastMessage("Call outcome recorded successfully.");
      router.refresh();
    } else {
      setCallModalError(res.error || "Failed to log call outcome.");
    }
  };

  // Handlers for Telecaller Assignment
  const handleOpenAssignModal = () => {
    setSelectedTelecallerId(initialTelecallers[0]?.id || "");
    setAssignmentNotes("");
    setAssignModalError(null);
    setIsAssignModalOpen(true);
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTelecallerId) {
      setAssignModalError("Please select a telecaller.");
      return;
    }

    setIsAssigning(true);
    setAssignModalError(null);

    const res = await assignPropertyAction({
      propertyId: property.id,
      telecallerId: selectedTelecallerId,
      notes: assignmentNotes.trim() || undefined,
    });

    setIsAssigning(false);

    if (res.success && res.property) {
      setProperty(res.property);
      setIsAssignModalOpen(false);
      setToastMessage("Telecaller assigned successfully.");
      router.refresh();
    } else {
      setAssignModalError(res.error || "Failed to assign telecaller.");
    }
  };

  const handleRoundRobinAssign = async () => {
    setIsRoundRobinRunning(true);
    const res = await assignPropertyRoundRobinAction({
      propertyId: property.id,
    });
    setIsRoundRobinRunning(false);

    if (res.success && res.property) {
      setProperty(res.property);
      setToastMessage("Property auto-assigned to telecaller via Round Robin.");
      router.refresh();
    } else {
      setToastMessage(res.error || "Auto-assignment failed.");
    }
  };

  // Handlers for Field Verifier Assignment
  const handleOpenFieldVerifierModal = async () => {
    setIsFieldVerifierModalOpen(true);
    setFieldVerifierInstructions("");
    setFieldVerifierModalError(null);
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

  const handleFieldVerifierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFieldVerifierId) {
      setFieldVerifierModalError("Please select a field verifier.");
      return;
    }

    setIsAssigningFieldVerifier(true);
    setFieldVerifierModalError(null);

    try {
      const res = await assignPropertyToFieldVerifierAction({
        propertyId: property.id,
        verifierId: selectedFieldVerifierId,
        instructions: fieldVerifierInstructions.trim() || undefined,
      });

      if (res.success) {
        setIsFieldVerifierModalOpen(false);
        setToastMessage("Assigned property to Field Verifier successfully.");
        router.refresh();
      }
    } catch (err: unknown) {
      setFieldVerifierModalError((err as Error)?.message || "Failed to assign Field Verifier.");
    } finally {
      setIsAssigningFieldVerifier(false);
    }
  };

  // Handlers for Media
  const handleMediaUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUploadingMedia(true);
    setUploadError(null);

    try {
      if (selectedFiles.length > 0) {
        const formData = new FormData();
        formData.append("propertyId", property.id);
        formData.append("caption", photoCaption.trim());
        selectedFiles.forEach((file) => {
          formData.append("photos", file);
        });

        const res = await uploadPropertyPhotosAction(formData);
        if (!res.success) {
          setUploadError(res.error || "Failed to upload photos.");
          setIsUploadingMedia(false);
          return;
        }
        if (res.property) {
          setProperty(res.property);
        }
      }

      if (youtubeUrl.trim()) {
        const res = await attachPropertyVideoAction({
          propertyId: property.id,
          youtubeUrl: youtubeUrl.trim(),
          caption: videoCaption.trim() || undefined,
        });
        if (!res.success) {
          setUploadError(res.error || "Failed to attach video.");
          setIsUploadingMedia(false);
          return;
        }
        if (res.property) {
          setProperty(res.property);
        }
      }

      setIsUploadModalOpen(false);
      setSelectedFiles([]);
      setPhotoCaption("");
      setYoutubeUrl("");
      setVideoCaption("");
      setToastMessage("Media updated successfully.");
      router.refresh();
    } catch (err: unknown) {
      setUploadError((err as Error)?.message || "Failed to process media.");
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleDeleteMedia = async (mediaId: string) => {
    if (!confirm("Are you sure you want to remove this media item?")) return;
    const res = await deletePropertyMediaAction({
      propertyId: property.id,
      mediaId,
    });
    if (res.success && res.property) {
      setProperty(res.property);
      setToastMessage("Media item removed.");
      router.refresh();
    } else {
      setToastMessage(res.error || "Failed to remove media item.");
    }
  };

  // Helper to extract YouTube video ID
  const getYouTubeEmbedUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      let videoId = "";
      if (parsed.hostname.includes("youtube.com")) {
        videoId = parsed.searchParams.get("v") || "";
      } else if (parsed.hostname.includes("youtu.be")) {
        videoId = parsed.pathname.slice(1);
      }
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    } catch {
      return null;
    }
  };

  const photos = property.media?.filter((m) => m.type === "PHOTO") || [];
  const videos = property.media?.filter((m) => m.type === "VIDEO") || [];

  return (
    <AppShell activePage="supply">
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center gap-2 text-xs text-crm-muted">
          <Link href="/supply" className="hover:text-crm-primary transition-colors">
            Supply Validation
          </Link>
          <span>/</span>
          <span className="font-semibold text-crm-text">
            {property.societyName} ({property.flatNumber})
          </span>
        </nav>

        {/* Top Header Card */}
        <div className="p-6 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-bold text-crm-text">
                  {property.societyName}
                </h1>
                <span className="px-2.5 py-1 text-xs font-bold rounded-md bg-stone-100 text-crm-text border border-crm-border">
                  Unit #{property.flatNumber}
                </span>
                <StatusBadge status={property.preference} />
                <StatusBadge status={property.validationStatus} />
                <StatusBadge status={property.availabilityStatus} />
                {property.isActiveSupply ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                    ✓ Active Supply Pool
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
                    ⚠️ Outside Active Pool
                  </span>
                )}
                {property.isFieldVerified && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-bold bg-teal-50 text-teal-800 border border-teal-200">
                    ✓ Field Verified
                  </span>
                )}
              </div>
              <p className="text-sm text-crm-muted">
                {property.locality}, {property.city} • Added to Phase 1 Resale & Rental Inventory
              </p>
            </div>

            {/* Quick Action Toolbar */}
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href="/supply"
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-crm-surface border border-crm-border text-crm-text hover:bg-stone-50 transition-colors shadow-2xs"
              >
                ← Back
              </Link>

              {canEdit && (
                <Link
                  href={`/supply/${property.id}/edit`}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-stone-100 hover:bg-stone-200 text-crm-text border border-crm-border transition-colors shadow-2xs inline-flex items-center gap-1.5"
                >
                  <span>✏️</span>
                  <span>Edit Property</span>
                </Link>
              )}

              {canLogCall && (
                <button
                  type="button"
                  onClick={handleOpenCallModal}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-md bg-crm-primary text-white hover:bg-crm-primary-hover transition-colors shadow-2xs inline-flex items-center gap-1.5"
                >
                  <span>📞</span>
                  <span>Log Call Outcome</span>
                </button>
              )}

              {canAssignTelecaller && (
                <button
                  type="button"
                  onClick={handleOpenAssignModal}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-white border border-crm-border text-crm-text hover:bg-stone-50 transition-colors shadow-2xs inline-flex items-center gap-1.5"
                >
                  <span>👤</span>
                  <span>{property.currentAssignment ? "Reassign Telecaller" : "Assign Telecaller"}</span>
                </button>
              )}

              {canAssignFieldVerifier && (
                <button
                  type="button"
                  onClick={handleOpenFieldVerifierModal}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md border shadow-2xs inline-flex items-center gap-1.5 ${
                    property.isFieldVerified
                      ? "bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                      : "bg-white text-crm-text hover:bg-stone-50 border-crm-border"
                  }`}
                >
                  <span>🚶‍♂️</span>
                  <span>{property.isFieldVerified ? "Reassign Field Verifier" : "Assign Field Verifier"}</span>
                </button>
              )}

              {canUploadMedia && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFiles([]);
                    setPhotoCaption("");
                    setYoutubeUrl("");
                    setVideoCaption("");
                    setUploadError(null);
                    setIsUploadModalOpen(true);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-white border border-crm-border text-crm-text hover:bg-stone-50 transition-colors shadow-2xs inline-flex items-center gap-1.5"
                >
                  <span>📸</span>
                  <span>Add Photos/Video</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Main Grid: Specifications & Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column (2 Cols): Financials, Specs, Amenities, Media */}
          <div className="lg:col-span-2 space-y-6">
            {/* Financials & Specifications Card */}
            <div className="p-5 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-4">
              <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider border-b border-crm-border pb-2">
                Property Profile & Pricing
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="text-crm-muted block text-[11px]">Price / Asking Rent</span>
                  <strong className="text-crm-text text-base font-bold text-crm-primary">
                    {property.priceFormatted}
                  </strong>
                </div>
                <div>
                  <span className="text-crm-muted block text-[11px]">Transaction Type</span>
                  <span className="text-crm-text font-semibold">{property.preference}</span>
                </div>
                <div>
                  <span className="text-crm-muted block text-[11px]">Property Typology</span>
                  <span className="text-crm-text font-semibold">{property.propertyType}</span>
                </div>
                <div>
                  <span className="text-crm-muted block text-[11px]">Configuration</span>
                  <span className="text-crm-text font-semibold">
                    {property.bedroomCount} BHK • {property.bathroomCount} Baths • {property.balconyCount} Balconies
                  </span>
                </div>
                <div>
                  <span className="text-crm-muted block text-[11px]">Super / Carpet Area</span>
                  <span className="text-crm-text font-semibold">
                    {property.area.toLocaleString()} sq.ft ({property.areaType})
                  </span>
                </div>
                <div>
                  <span className="text-crm-muted block text-[11px]">Furnishing Status</span>
                  <span className="text-crm-text font-semibold">{property.furnishingStatus}</span>
                </div>
                <div>
                  <span className="text-crm-muted block text-[11px]">Construction Status</span>
                  <span className="text-crm-text font-semibold">{property.constructionStatus}</span>
                </div>
                <div>
                  <span className="text-crm-muted block text-[11px]">Site Visit Activity</span>
                  <span className="text-crm-text font-semibold">{property.visitCount} Site Visits Logged</span>
                </div>
                <div>
                  <span className="text-crm-muted block text-[11px]">Latest Calling Outcome</span>
                  <div className="mt-0.5">
                    <StatusBadge status={property.currentDisposition} />
                  </div>
                </div>
              </div>
            </div>

            {/* Location Details Card */}
            <div className="p-5 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-4">
              <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider border-b border-crm-border pb-2">
                Location Details
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-crm-muted block text-[11px]">Society / Complex</span>
                  <strong className="text-crm-text">{property.societyName}</strong>
                </div>
                <div>
                  <span className="text-crm-muted block text-[11px]">Flat / Unit Number</span>
                  <strong className="text-crm-text">{property.flatNumber}</strong>
                </div>
                <div>
                  <span className="text-crm-muted block text-[11px]">Locality / Sub-market</span>
                  <span className="text-crm-text font-semibold">{property.locality}</span>
                </div>
                <div>
                  <span className="text-crm-muted block text-[11px]">City</span>
                  <span className="text-crm-text font-semibold">{property.city}</span>
                </div>
              </div>
            </div>

            {/* Amenities Card */}
            <div className="p-5 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-3">
              <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider border-b border-crm-border pb-2">
                Society & Flat Amenities ({property.amenities.length})
              </h2>
              {property.amenities.length === 0 ? (
                <p className="text-xs text-crm-muted italic">No amenities specified.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {property.amenities.map((amenity, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 text-xs font-medium rounded-md bg-stone-100 text-crm-text border border-crm-border"
                    >
                      ✓ {amenity}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Photos & Video Gallery Card */}
            <div className="p-5 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-4">
              <div className="flex items-center justify-between border-b border-crm-border pb-2">
                <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider">
                  Photos & Media Gallery ({photos.length} Photos, {videos.length} Videos)
                </h2>
                {canUploadMedia && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFiles([]);
                      setPhotoCaption("");
                      setYoutubeUrl("");
                      setVideoCaption("");
                      setUploadError(null);
                      setIsUploadModalOpen(true);
                    }}
                    className="text-xs font-semibold text-crm-primary hover:underline"
                  >
                    + Add Media
                  </button>
                )}
              </div>

              {photos.length === 0 && videos.length === 0 ? (
                <div className="p-6 text-center rounded-md bg-stone-50 border border-dashed border-crm-border">
                  <p className="text-xs font-medium text-crm-text">No photos or videos attached yet</p>
                  <p className="text-[11px] text-crm-muted mt-0.5">
                    Upload watermark-free photos or attach YouTube walkthrough links.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Photo Grid */}
                  {photos.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {photos.map((photo) => {
                        const imgSrc = photo.id
                          ? `/api/media/${photo.id}`
                          : photo.url;
                        return (
                          <div
                            key={photo.id || photo.url}
                            className="group relative rounded-md overflow-hidden border border-crm-border bg-stone-100 aspect-video"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={imgSrc}
                              alt={photo.caption || "Property photo"}
                              className="w-full h-full object-cover cursor-pointer group-hover:scale-105 transition-transform duration-200"
                              onClick={() => setLightboxMedia(photo)}
                            />
                            {photo.caption && (
                              <div className="absolute inset-x-0 bottom-0 bg-stone-900/70 text-white text-[10px] px-2 py-1 truncate">
                                {photo.caption}
                              </div>
                            )}
                            {canUploadMedia && photo.id && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteMedia(photo.id!);
                                }}
                                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/90 text-red-600 hover:bg-white text-xs flex items-center justify-center shadow-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Delete photo"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Videos */}
                  {videos.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-xs font-bold text-crm-text">Video Walkthroughs</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {videos.map((vid) => {
                          const embedUrl = getYouTubeEmbedUrl(vid.url);
                          return (
                            <div
                              key={vid.id || vid.url}
                              className="rounded-md border border-crm-border overflow-hidden bg-white"
                            >
                              {embedUrl ? (
                                <iframe
                                  src={embedUrl}
                                  title={vid.caption || "Property Walkthrough"}
                                  className="w-full aspect-video border-b border-crm-border"
                                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                  allowFullScreen
                                />
                              ) : (
                                <div className="p-4 text-xs">
                                  <a
                                    href={vid.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-crm-primary underline font-medium block truncate"
                                  >
                                    ▶ Open Video Link: {vid.url}
                                  </a>
                                </div>
                              )}
                              <div className="p-2.5 flex items-center justify-between text-xs">
                                <span className="text-crm-muted truncate">
                                  {vid.caption || "Property Walkthrough"}
                                </span>
                                {canUploadMedia && vid.id && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteMedia(vid.id!)}
                                    className="text-[11px] text-red-600 hover:underline"
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Column (1 Col): Contacts, Telecaller, Field Verifier, Call History */}
          <div className="space-y-6">
            {/* Owner & Custodian Contacts Card */}
            <div className="p-5 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-4">
              <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider border-b border-crm-border pb-2">
                Contacts & Access
              </h2>

              {/* Owner Info (Strictly server protected) */}
              <div className="p-3.5 rounded-md border border-crm-border bg-stone-50/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-crm-muted">
                    Property Owner (Confidential)
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-red-50 text-red-700 border border-red-200">
                    Masked to Buyers
                  </span>
                </div>
                <div>
                  <div className="text-sm font-bold text-crm-text">{property.ownerName}</div>
                  <div className="text-xs text-crm-muted font-mono">{property.ownerMobile}</div>
                </div>
                <div className="pt-2 border-t border-crm-border/60 flex items-center justify-between text-xs">
                  <span className="text-crm-muted">Mandate Willingness:</span>
                  <span
                    className={`font-semibold ${
                      property.ownerWillingnessConfirmed ? "text-emerald-700" : "text-amber-700"
                    }`}
                  >
                    {property.ownerWillingnessConfirmed ? "✓ Confirmed" : "Pending Confirmation"}
                  </span>
                </div>
              </div>

              {/* Key Custodian */}
              <div className="p-3.5 rounded-md border border-crm-border bg-stone-50/50 space-y-1.5 text-xs">
                <span className="text-[10px] uppercase font-bold text-crm-muted block">
                  Key Custodian ({property.keyHolder.persona})
                </span>
                <div className="font-bold text-crm-text">{property.keyHolder.name}</div>
                <div className="text-crm-muted font-mono">{property.keyHolder.mobile}</div>
                {property.keyHolder.notes && (
                  <p className="text-[11px] text-crm-muted italic pt-1 border-t border-crm-border/60">
                    &quot;{property.keyHolder.notes}&quot;
                  </p>
                )}
              </div>
            </div>

            {/* Telecaller Assignment Card */}
            <div className="p-5 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b border-crm-border pb-2">
                <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider">
                  👤 Telecaller Assignment
                </h2>
                {property.currentAssignment ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                    Active
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                    Unassigned
                  </span>
                )}
              </div>

              {property.currentAssignment ? (
                <div className="space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-crm-muted block text-[11px]">Assigned Agent</span>
                      <strong className="text-crm-text">
                        {currentUserRole === "TELECALLER"
                          ? "Assigned to You"
                          : property.currentAssignment.assignedUserName}
                      </strong>
                    </div>
                    <div>
                      <span className="text-crm-muted block text-[11px]">Method</span>
                      <span className="text-crm-text font-medium">
                        {property.currentAssignment.assignmentMethod}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-crm-muted">
                    Assigned on: <span className="text-crm-text">{property.currentAssignment.assignedAt}</span>
                  </div>
                  {property.currentAssignment.assignedByUserName && (
                    <div className="text-[11px] text-crm-muted">
                      Assigned by: <span className="text-crm-text">{property.currentAssignment.assignedByUserName}</span>
                    </div>
                  )}
                  {property.currentAssignment.notes && (
                    <p className="text-[11px] text-crm-muted italic bg-stone-50 p-2 rounded border border-crm-border">
                      Note: &quot;{property.currentAssignment.notes}&quot;
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-crm-muted italic">
                  Not currently assigned to a telecaller.
                </p>
              )}

              {canAssignTelecaller && (
                <div className="pt-2 border-t border-crm-border flex gap-2">
                  <button
                    type="button"
                    onClick={handleOpenAssignModal}
                    className="flex-1 py-1.5 px-3 text-xs font-semibold rounded bg-stone-100 hover:bg-stone-200 text-crm-text border border-crm-border transition-colors shadow-2xs"
                  >
                    {property.currentAssignment ? "Reassign" : "Assign"}
                  </button>
                  <button
                    type="button"
                    onClick={handleRoundRobinAssign}
                    disabled={isRoundRobinRunning}
                    className="py-1.5 px-3 text-xs font-semibold rounded bg-teal-50 text-teal-800 hover:bg-teal-100 border border-teal-200 transition-colors shadow-2xs"
                  >
                    {isRoundRobinRunning ? "Assigning..." : "⚡ Auto-Assign"}
                  </button>
                </div>
              )}
            </div>

            {/* Field Verification Card */}
            <div className="p-5 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b border-crm-border pb-2">
                <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider">
                  🚶‍♂️ Physical Verification
                </h2>
                {property.isFieldVerified ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                    Verified
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-100 text-crm-muted border border-crm-border">
                    Pending
                  </span>
                )}
              </div>

              <div className="text-xs space-y-1">
                <p className="text-crm-muted">
                  {property.isFieldVerified
                    ? "Property premises and physical condition verified by Field Verifier."
                    : "On-site visit and physical checklist verification have not been completed."}
                </p>
                {property.fieldVerifiedAt && (
                  <p className="text-[11px] text-crm-muted">
                    Verified on: {new Date(property.fieldVerifiedAt).toLocaleDateString()}
                  </p>
                )}
              </div>

              {canAssignFieldVerifier && (
                <div className="pt-2 border-t border-crm-border">
                  <button
                    type="button"
                    onClick={handleOpenFieldVerifierModal}
                    className="w-full py-1.5 px-3 text-xs font-semibold rounded bg-white hover:bg-stone-50 text-crm-text border border-crm-border transition-colors shadow-2xs"
                  >
                    {property.isFieldVerified ? "Reassign Field Verifier" : "Assign to Field Verifier"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Full-width Call History & Assignment History Tabs/Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Call History Card */}
          <div className="p-5 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b border-crm-border pb-2">
              <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider">
                Call History Timeline ({property.callHistory.length})
              </h2>
              {canLogCall && (
                <button
                  type="button"
                  onClick={handleOpenCallModal}
                  className="text-xs font-semibold text-crm-primary hover:underline"
                >
                  + Log Call
                </button>
              )}
            </div>

            {property.callHistory.length === 0 ? (
              <p className="text-xs text-crm-muted italic py-4 text-center">
                No calls recorded yet for this property.
              </p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {property.callHistory.map((call) => (
                  <div
                    key={call.id}
                    className="p-3 rounded-md border border-crm-border bg-stone-50/60 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-crm-text">{call.callerName}</span>
                      <span className="text-[11px] text-crm-muted">{call.calledAt}</span>
                    </div>
                    <div>
                      <StatusBadge status={call.disposition} />
                    </div>
                    {call.notes && (
                      <p className="text-crm-text text-[11px] bg-white p-2 rounded border border-crm-border">
                        {call.notes}
                      </p>
                    )}
                    {call.callbackDate && (
                      <p className="text-[10px] text-amber-800 font-semibold">
                        ⏰ Callback Scheduled: {call.callbackDate}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Assignment History Card */}
          <div className="p-5 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b border-crm-border pb-2">
              <h2 className="text-sm font-bold text-crm-text uppercase tracking-wider">
                Assignment History ({property.assignmentHistory?.length || 0})
              </h2>
            </div>

            {!property.assignmentHistory || property.assignmentHistory.length === 0 ? (
              <p className="text-xs text-crm-muted italic py-4 text-center">
                No assignment records logged yet.
              </p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {property.assignmentHistory.map((asgn) => (
                  <div
                    key={asgn.id}
                    className="p-3 rounded-md border border-crm-border bg-stone-50/60 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-crm-text">{asgn.assignedUserName}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          asgn.status === "Active"
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                            : "bg-stone-100 text-crm-muted border border-crm-border"
                        }`}
                      >
                        {asgn.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-crm-muted flex items-center justify-between">
                      <span>Method: {asgn.assignmentMethod}</span>
                      <span>Assigned: {asgn.assignedAt}</span>
                    </div>
                    {asgn.assignedByUserName && (
                      <div className="text-[10px] text-crm-muted">
                        Assigned by: {asgn.assignedByUserName}
                      </div>
                    )}
                    {asgn.notes && (
                      <p className="text-[10px] text-crm-muted italic pt-1">
                        &quot;{asgn.notes}&quot;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Lightbox Modal for Full Photos */}
        {lightboxMedia && (
          <Modal
            isOpen={true}
            onClose={() => setLightboxMedia(null)}
            title={lightboxMedia.caption || "Property Photo"}
          >
            <div className="space-y-4">
              <div className="w-full max-h-[70vh] flex items-center justify-center bg-stone-900 rounded-md overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    lightboxMedia.id
                      ? `/api/media/${lightboxMedia.id}`
                      : lightboxMedia.url
                  }
                  alt={lightboxMedia.caption || "Property full photo"}
                  className="max-h-[70vh] max-w-full object-contain"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setLightboxMedia(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-md bg-stone-100 hover:bg-stone-200 text-crm-text border border-crm-border shadow-2xs"
                >
                  Close
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Modal: Log Call Outcome */}
        <Modal
          isOpen={isCallModalOpen}
          onClose={() => !isLoggingCall && setIsCallModalOpen(false)}
          title="Log Owner Call Outcome"
        >
          <form onSubmit={handleCallSubmit} className="space-y-4 text-xs">
            {callModalError && (
              <div className="p-3 bg-red-50 text-red-700 rounded border border-red-200">
                {callModalError}
              </div>
            )}

            <div>
              <label className="block font-semibold text-crm-text mb-1">Calling Disposition *</label>
              <select
                value={callDisposition}
                onChange={(e) => setCallDisposition(e.target.value)}
                className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="PROPERTY_AVAILABLE">Property Available (Owner Willing)</option>
                <option value="CALL_BACK_REQUESTED">Call Back Requested</option>
                <option value="PRICE_REVISED">Price / Rent Revised</option>
                <option value="DETAILS_UPDATED">Details / Specs Updated</option>
                <option value="MANDATE_DECLINED">Mandate Declined / Not Interested</option>
                <option value="PROPERTY_SOLD_EXTERNALLY">Property Sold Externally</option>
                <option value="PROPERTY_RENTED_EXTERNALLY">Property Rented Externally</option>
                <option value="NUMBER_UNREACHABLE">Number Unreachable / Switched Off</option>
                <option value="CALL_NOT_ANSWERED">Call Not Answered / Busy</option>
              </select>
            </div>

            {callDisposition === "CALL_BACK_REQUESTED" && (
              <div>
                <label className="block font-semibold text-crm-text mb-1">Callback Date & Time *</label>
                <input
                  type="datetime-local"
                  required
                  value={callbackDate}
                  onChange={(e) => setCallbackDate(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                />
              </div>
            )}

            <div>
              <label className="block font-semibold text-crm-text mb-1">Call Notes & Key Takeaways</label>
              <textarea
                rows={3}
                placeholder="Mention owner mood, expected negotiations, or tenant preferences..."
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-crm-border">
              <button
                type="button"
                onClick={() => setIsCallModalOpen(false)}
                disabled={isLoggingCall}
                className="px-3.5 py-1.5 rounded border border-crm-border bg-stone-100 hover:bg-stone-200 text-crm-text"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoggingCall}
                className="px-4 py-1.5 rounded bg-crm-primary text-white hover:bg-crm-primary-hover font-semibold shadow-2xs"
              >
                {isLoggingCall ? "Recording..." : "Save Outcome"}
              </button>
            </div>
          </form>
        </Modal>

        {/* Modal: Assign Telecaller */}
        <Modal
          isOpen={isAssignModalOpen}
          onClose={() => !isAssigning && setIsAssignModalOpen(false)}
          title="Assign Property to Telecaller"
        >
          <form onSubmit={handleAssignSubmit} className="space-y-4 text-xs">
            {assignModalError && (
              <div className="p-3 bg-red-50 text-red-700 rounded border border-red-200">
                {assignModalError}
              </div>
            )}

            <div>
              <label className="block font-semibold text-crm-text mb-1">Select Telecaller *</label>
              <select
                value={selectedTelecallerId}
                onChange={(e) => setSelectedTelecallerId(e.target.value)}
                className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                {initialTelecallers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.email})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-crm-text mb-1">Assignment Instructions</label>
              <textarea
                rows={2}
                placeholder="Specific instructions for telecaller..."
                value={assignmentNotes}
                onChange={(e) => setAssignmentNotes(e.target.value)}
                className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-crm-border">
              <button
                type="button"
                onClick={() => setIsAssignModalOpen(false)}
                disabled={isAssigning}
                className="px-3.5 py-1.5 rounded border border-crm-border bg-stone-100 hover:bg-stone-200 text-crm-text"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isAssigning}
                className="px-4 py-1.5 rounded bg-crm-primary text-white hover:bg-crm-primary-hover font-semibold shadow-2xs"
              >
                {isAssigning ? "Assigning..." : "Confirm Assignment"}
              </button>
            </div>
          </form>
        </Modal>

        {/* Modal: Assign Field Verifier */}
        <Modal
          isOpen={isFieldVerifierModalOpen}
          onClose={() => !isAssigningFieldVerifier && setIsFieldVerifierModalOpen(false)}
          title="Assign Property to Field Verifier"
        >
          <form onSubmit={handleFieldVerifierSubmit} className="space-y-4 text-xs">
            {fieldVerifierModalError && (
              <div className="p-3 bg-red-50 text-red-700 rounded border border-red-200">
                {fieldVerifierModalError}
              </div>
            )}

            <div>
              <label className="block font-semibold text-crm-text mb-1">Select Field Verifier *</label>
              <select
                value={selectedFieldVerifierId}
                onChange={(e) => setSelectedFieldVerifierId(e.target.value)}
                className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                {fieldVerifiersList.map((fv) => (
                  <option key={fv.id} value={fv.id}>
                    {fv.name} ({fv.phone})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-crm-text mb-1">Verification Instructions</label>
              <textarea
                rows={2}
                placeholder="e.g. Check plumbing, verify lift status, obtain society NOC copy..."
                value={fieldVerifierInstructions}
                onChange={(e) => setFieldVerifierInstructions(e.target.value)}
                className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-crm-border">
              <button
                type="button"
                onClick={() => setIsFieldVerifierModalOpen(false)}
                disabled={isAssigningFieldVerifier}
                className="px-3.5 py-1.5 rounded border border-crm-border bg-stone-100 hover:bg-stone-200 text-crm-text"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isAssigningFieldVerifier}
                className="px-4 py-1.5 rounded bg-crm-primary text-white hover:bg-crm-primary-hover font-semibold shadow-2xs"
              >
                {isAssigningFieldVerifier ? "Assigning..." : "Assign Field Verifier"}
              </button>
            </div>
          </form>
        </Modal>

        {/* Modal: Upload Photos & Attach Video */}
        <Modal
          isOpen={isUploadModalOpen}
          onClose={() => !isUploadingMedia && setIsUploadModalOpen(false)}
          title="Add Photos & Videos"
        >
          <form onSubmit={handleMediaUploadSubmit} className="space-y-4 text-xs">
            {uploadError && (
              <div className="p-3 bg-red-50 text-red-700 rounded border border-red-200">
                {uploadError}
              </div>
            )}

            <div className="space-y-2">
              <label className="block font-semibold text-crm-text">Upload Photos</label>
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  if (e.target.files) {
                    setSelectedFiles(Array.from(e.target.files));
                  }
                }}
                className="w-full text-xs text-crm-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-stone-100 file:text-crm-text hover:file:bg-stone-200 cursor-pointer"
              />
              <p className="text-[11px] text-crm-muted">
                Accepts JPEG, PNG, WebP up to 10MB each.
              </p>
            </div>

            {selectedFiles.length > 0 && (
              <div>
                <label className="block font-semibold text-crm-text mb-1">Photo Caption (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Master Bedroom & Balcony View"
                  value={photoCaption}
                  onChange={(e) => setPhotoCaption(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                />
              </div>
            )}

            <div className="pt-2 border-t border-crm-border space-y-2">
              <label className="block font-semibold text-crm-text">Attach YouTube Walkthrough URL</label>
              <input
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              />
            </div>

            {youtubeUrl.trim() && (
              <div>
                <label className="block font-semibold text-crm-text mb-1">Video Caption (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Full Apartment Walkthrough Video"
                  value={videoCaption}
                  onChange={(e) => setVideoCaption(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-crm-border">
              <button
                type="button"
                onClick={() => setIsUploadModalOpen(false)}
                disabled={isUploadingMedia}
                className="px-3.5 py-1.5 rounded border border-crm-border bg-stone-100 hover:bg-stone-200 text-crm-text"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isUploadingMedia || (selectedFiles.length === 0 && !youtubeUrl.trim())}
                className="px-4 py-1.5 rounded bg-crm-primary text-white hover:bg-crm-primary-hover font-semibold shadow-2xs"
              >
                {isUploadingMedia ? "Uploading..." : "Save Media"}
              </button>
            </div>
          </form>
        </Modal>

        {/* Global Toast */}
        {toastMessage && (
          <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
        )}
      </div>
    </AppShell>
  );
}
