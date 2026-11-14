"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Toast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { Lead, SiteVisit, LeadChangeLogItem } from "@/types/crm";
import { EvaluatedPropertyMatch } from "@/server/dal/matching";
import {
  ScheduleVisitModal,
  AvailablePropertyItem,
  SalesAgentItem,
} from "@/components/visits/ScheduleVisitModal";
import {
  updateLeadStatusAction,
  assignLeadAction,
  assignLeadRoundRobinAction,
  logLeadCallAction,
  editLeadAction,
  getLeadChangeHistoryAction,
  markLeadDoNotContactAction,
} from "../actions";
import {
  sharePropertyDetailsWithLeadAction,
  getMatchingPropertiesForLeadAction,
} from "@/app/matching/actions";
import { formatIndianCurrency } from "@/server/dal/mappers";

interface EligibleTelecaller {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface LeadDetailsClientProps {
  lead: Lead;
  topMatches?: EvaluatedPropertyMatch[];
  siteVisits?: SiteVisit[];
  initialChangeHistory?: LeadChangeLogItem[];
  canEdit: boolean;
  canLogCall: boolean;
  canActivate: boolean;
  canViewChangelog?: boolean;
  canAssignTelecaller?: boolean;
  canViewMatches?: boolean;
  canScheduleVisits?: boolean;
  availableProperties?: AvailablePropertyItem[];
  salesAgents?: SalesAgentItem[];
  eligibleTelecallers?: EligibleTelecaller[];
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

type LeadDispositionValue =
  | "CONNECTED"
  | "CALL_BACK"
  | "RINGING_OR_NOT_ANSWERING"
  | "BUYER_SAYS_NOT_LOOKING";

const DISPOSITION_OPTIONS: {
  value: LeadDispositionValue;
  label: string;
  description: string;
}[] = [
  {
    value: "CONNECTED",
    label: "Connected & Qualified",
    description: "Spoke with prospect. Verified intent and criteria.",
  },
  {
    value: "CALL_BACK",
    label: "Call Back Requested",
    description: "Prospect requested a callback at a specific date & time.",
  },
  {
    value: "RINGING_OR_NOT_ANSWERING",
    label: "Ringing / Not Answering",
    description: "No response. Increments unreachable counter (max 3).",
  },
  {
    value: "BUYER_SAYS_NOT_LOOKING",
    label: "Buyer Not Looking / Dropped",
    description: "Prospect is no longer active in the market.",
  },
];

export function LeadDetailsClient({
  lead: initialLead,
  topMatches: initialTopMatches = [],
  siteVisits: initialSiteVisits = [],
  initialChangeHistory = [],
  canEdit,
  canLogCall,
  canActivate,
  canViewChangelog = false,
  canAssignTelecaller = false,
  canViewMatches = true,
  canScheduleVisits = false,
  availableProperties = [],
  salesAgents = [],
  eligibleTelecallers = [],
}: LeadDetailsClientProps) {
  const router = useRouter();

  // Main Lead & Related States
  const [lead, setLead] = useState<Lead>(initialLead);
  const [topMatches, setTopMatches] = useState<EvaluatedPropertyMatch[]>(initialTopMatches);
  const [isRefreshingMatches, setIsRefreshingMatches] = useState(false);
  const [siteVisits, setSiteVisits] = useState<SiteVisit[]>(initialSiteVisits);
  const [changeHistory, setChangeHistory] = useState<LeadChangeLogItem[]>(initialChangeHistory);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  // Column 3: Site Visit Scheduling Modal State
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleInitialPropertyIds, setScheduleInitialPropertyIds] = useState<string[]>([]);

  const handleOpenScheduleModal = (propertyIds: string[] = []) => {
    setScheduleInitialPropertyIds(propertyIds);
    setIsScheduleModalOpen(true);
  };

  const handleScheduleSuccess = (createdVisit: SiteVisit) => {
    setSiteVisits((prev) => [createdVisit, ...prev]);
    setToastMessage(`Site visit itinerary scheduled for ${createdVisit.buyerName}.`);
    router.refresh();
  };

  // Column 2: Activity Tabs State
  const [activityTab, setActivityTab] = useState<"calls" | "changelog" | "enquiries">("calls");
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);

  // Column 2: Calling Form State
  const [disposition, setDisposition] = useState<LeadDispositionValue>("CONNECTED");
  const [callbackDate, setCallbackDate] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [confirmRequirementsOnCall, setConfirmRequirementsOnCall] = useState(false);
  const [isEnquiryVerifiedOnCall, setIsEnquiryVerifiedOnCall] = useState(
    initialLead.enquiries?.[0]?.isVerifiedByCaller ?? initialLead.advertisedPropertyVerified ?? false
  );
  const [enquiryVerificationNotesOnCall, setEnquiryVerificationNotesOnCall] = useState(
    initialLead.enquiries?.[0]?.callerVerificationNotes ?? initialLead.advertisedPropertyNotes ?? ""
  );
  const [isSubmittingCall, setIsSubmittingCall] = useState(false);
  const [callFormError, setCallFormError] = useState<string | null>(null);

  // Column 3: Property Sharing State
  const [sharingPropertyId, setSharingPropertyId] = useState<string | null>(null);

  // Column 1: Assignment Modal State
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedTelecallerId, setSelectedTelecallerId] = useState(
    eligibleTelecallers.find((t) => t.name === initialLead.assignedTelecaller)?.id ||
      eligibleTelecallers[0]?.id ||
      ""
  );
  const [assignmentNotes, setAssignmentNotes] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignModalError, setAssignModalError] = useState<string | null>(null);

  // Column 1: DNC Modal State
  const [isDncModalOpen, setIsDncModalOpen] = useState(false);
  const [dncReason, setDncReason] = useState("");
  const [isSubmittingDnc, setIsSubmittingDnc] = useState(false);

  // Column 1: Requirement Quick-Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editName, setEditName] = useState(lead.name);
  const [editAlternatePhone, setEditAlternatePhone] = useState(lead.alternatePhone || "");
  const [editEmail, setEditEmail] = useState(lead.email || "");
  const [editPreference, setEditPreference] = useState<"SALE" | "RENT">(
    lead.requirements.preference === "Rent" ? "RENT" : "SALE"
  );
  const [editMinBudget, setEditMinBudget] = useState(lead.requirements.minBudget.toString());
  const [editMaxBudget, setEditMaxBudget] = useState(lead.requirements.maxBudget.toString());
  const [editCity, setEditCity] = useState(lead.requirements.city);
  const [editLocalities, setEditLocalities] = useState(lead.requirements.localities.join(", "));
  const [editSocieties, setEditSocieties] = useState(lead.requirements.societies.join(", "));
  const [editBhks, setEditBhks] = useState<string[]>(lead.requirements.bedroomConfigurations || []);
  const [editPropertyTypes, setEditPropertyTypes] = useState<
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
  const [editMinArea, setEditMinArea] = useState(
    lead.requirements.minArea != null ? lead.requirements.minArea.toString() : ""
  );
  const [editMaxArea, setEditMaxArea] = useState(
    lead.requirements.maxArea != null ? lead.requirements.maxArea.toString() : ""
  );
  const [editTargetArea, setEditTargetArea] = useState(
    lead.requirements.targetArea != null ? lead.requirements.targetArea.toString() : ""
  );
  const [editAreaUnit, setEditAreaUnit] = useState(lead.requirements.areaUnit || "sq.ft");
  const [editAreaType, setEditAreaType] = useState<
    "CARPET" | "BUILT_UP" | "SUPER_BUILT_UP" | ""
  >(
    (lead.requirements.areaType as
      | "CARPET"
      | "BUILT_UP"
      | "SUPER_BUILT_UP"
      | null) || ""
  );
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Handlers
  const handleCopyPhone = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(lead.primaryPhone);
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
    }
  };

  const handleActivate = async () => {
    if (isActivating) return;
    setIsActivating(true);
    try {
      const res = await updateLeadStatusAction({
        leadId: lead.id,
        status: "ACTIVE",
      });
      if (!res.success) {
        setToastMessage(`Failed to activate lead: ${res.error}`);
        return;
      }
      setLead(res.lead);
      setToastMessage(`Lead ${res.lead.name} marked ACTIVE.`);
      // Refresh change history
      if (canViewChangelog) {
        const histRes = await getLeadChangeHistoryAction(lead.id);
        if (histRes.success) setChangeHistory(histRes.history);
      }
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Failed to activate lead.");
    } finally {
      setIsActivating(false);
    }
  };

  const handleInactivate = async () => {
    try {
      const res = await updateLeadStatusAction({
        leadId: lead.id,
        status: "INACTIVE",
      });
      if (!res.success) {
        setToastMessage(`Failed to inactivate lead: ${res.error}`);
        return;
      }
      setLead(res.lead);
      setToastMessage(`Lead ${res.lead.name} marked INACTIVE.`);
      if (canViewChangelog) {
        const histRes = await getLeadChangeHistoryAction(lead.id);
        if (histRes.success) setChangeHistory(histRes.history);
      }
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Failed to inactivate lead.");
    }
  };

  const handleLogCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingCall) return;

    if (disposition === "CALL_BACK" && !callbackDate) {
      setCallFormError("Callback date & time is mandatory when disposition is 'Call Back'.");
      return;
    }

    setIsSubmittingCall(true);
    setCallFormError(null);

    try {
      const res = await logLeadCallAction({
        leadId: lead.id,
        disposition,
        notes: callNotes.trim() || undefined,
        callbackScheduledAt: disposition === "CALL_BACK" ? callbackDate : undefined,
        enquiryId: lead.enquiries?.[0]?.id || undefined,
        isEnquiryVerified: isEnquiryVerifiedOnCall,
        enquiryVerificationNotes: enquiryVerificationNotesOnCall.trim() || undefined,
        isRequirementsConfirmed: disposition === "CONNECTED" ? confirmRequirementsOnCall : undefined,
      });

      if (!res.success) {
        setCallFormError(res.error || "Failed to log call.");
        return;
      }

      setLead(res.lead);
      setCallNotes("");
      setCallbackDate("");
      setConfirmRequirementsOnCall(false);
      setToastMessage("Call logged successfully.");

      // Refresh change history
      if (canViewChangelog) {
        const histRes = await getLeadChangeHistoryAction(lead.id);
        if (histRes.success) setChangeHistory(histRes.history);
      }
    } catch (err: unknown) {
      setCallFormError(err instanceof Error ? err.message : "Failed to log call.");
    } finally {
      setIsSubmittingCall(false);
    }
  };

  const handleRefreshHistory = async () => {
    if (isRefreshingHistory) return;
    setIsRefreshingHistory(true);
    try {
      const res = await getLeadChangeHistoryAction(lead.id);
      if (res.success) {
        setChangeHistory(res.history);
        setToastMessage("Change history refreshed.");
      } else {
        setToastMessage(res.error || "Failed to refresh change history.");
      }
    } catch {
      setToastMessage("Failed to refresh change history.");
    } finally {
      setIsRefreshingHistory(false);
    }
  };

  const handleShareProperty = async (propertyId: string) => {
    setSharingPropertyId(propertyId);
    try {
      const res = await sharePropertyDetailsWithLeadAction(lead.id, propertyId);
      if (res.success) {
        setToastMessage(res.message);
      } else {
        setToastMessage(res.error || "Failed to share property details.");
      }
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Failed to share property.");
    } finally {
      setSharingPropertyId(null);
    }
  };

  const handleMarkDnc = async () => {
    setIsSubmittingDnc(true);
    try {
      const res = await markLeadDoNotContactAction(lead.id, dncReason.trim() || undefined);
      if (!res.success) {
        setToastMessage(res.error || "Failed to set Do Not Contact.");
        return;
      }
      setLead(res.lead);
      setIsDncModalOpen(false);
      setToastMessage("Prospect marked as Do Not Contact (DNC). All calling is now disabled.");
      if (canViewChangelog) {
        const histRes = await getLeadChangeHistoryAction(lead.id);
        if (histRes.success) setChangeHistory(histRes.history);
      }
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Failed to set DNC.");
    } finally {
      setIsSubmittingDnc(false);
    }
  };

  const handleAssignManual = async () => {
    if (!selectedTelecallerId) return;
    setIsAssigning(true);
    setAssignModalError(null);
    try {
      const res = await assignLeadAction({
        leadId: lead.id,
        telecallerId: selectedTelecallerId,
        notes: assignmentNotes.trim() || undefined,
      });
      if (!res.success) {
        setAssignModalError(res.error || "Failed to assign lead.");
        return;
      }
      setLead(res.lead);
      setToastMessage(`Lead assigned to ${res.lead.assignedTelecaller}.`);
      setAssignModalOpen(false);
      if (canViewChangelog) {
        const histRes = await getLeadChangeHistoryAction(lead.id);
        if (histRes.success) setChangeHistory(histRes.history);
      }
    } catch (err: unknown) {
      setAssignModalError(err instanceof Error ? err.message : "Failed to assign lead.");
    } finally {
      setIsAssigning(false);
    }
  };

  const handleAssignRoundRobin = async () => {
    setIsAssigning(true);
    setAssignModalError(null);
    try {
      const res = await assignLeadRoundRobinAction({
        leadId: lead.id,
        notes: assignmentNotes.trim() || undefined,
      });
      if (!res.success) {
        setAssignModalError(res.error || "Failed to round-robin assign lead.");
        return;
      }
      setLead(res.lead);
      setToastMessage(`Auto-assigned to ${res.lead.assignedTelecaller} via round-robin.`);
      setAssignModalOpen(false);
      if (canViewChangelog) {
        const histRes = await getLeadChangeHistoryAction(lead.id);
        if (histRes.success) setChangeHistory(histRes.history);
      }
    } catch (err: unknown) {
      setAssignModalError(err instanceof Error ? err.message : "Failed to round-robin assign lead.");
    } finally {
      setIsAssigning(false);
    }
  };

  const handleSaveRequirements = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingEdit(true);
    setEditError(null);

    const parsedMinB = parseFloat(editMinBudget);
    const parsedMaxB = parseFloat(editMaxBudget);

    if (isNaN(parsedMinB) || parsedMinB <= 0 || isNaN(parsedMaxB) || parsedMaxB <= 0) {
      setEditError("Minimum and maximum budget must be positive numbers.");
      setIsSavingEdit(false);
      return;
    }

    if (parsedMinB > parsedMaxB) {
      setEditError("Minimum budget cannot be greater than maximum budget.");
      setIsSavingEdit(false);
      return;
    }

    const localityList = editLocalities
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);

    const societyList = editSocieties
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await editLeadAction({
        id: lead.id,
        name: editName.trim(),
        primaryPhone: lead.primaryPhone,
        originalSource: lead.originalSource,
        alternatePhone: editAlternatePhone.trim() || null,
        email: editEmail.trim() || null,
        preference: editPreference,
        minBudget: parsedMinB,
        maxBudget: parsedMaxB,
        city: editCity.trim(),
        localities: localityList,
        societies: societyList,
        bedroomConfigurations: editBhks,
        propertyTypes: editPropertyTypes,
        minArea: editMinArea ? parseFloat(editMinArea) : null,
        maxArea: editMaxArea ? parseFloat(editMaxArea) : null,
        targetArea: editTargetArea ? parseFloat(editTargetArea) : null,
        areaUnit: editAreaUnit || "sq.ft",
        areaType: (editAreaType as "CARPET" | "BUILT_UP" | "SUPER_BUILT_UP") || null,
      });

      if (!res.success) {
        setEditError(res.error || "Failed to update requirements.");
        return;
      }

      setLead(res.lead);
      setIsEditModalOpen(false);
      setToastMessage("Requirements updated successfully.");

      // Refresh top 3 matching properties dynamically (DV-11)
      if (canViewMatches) {
        setIsRefreshingMatches(true);
        try {
          const matchRes = await getMatchingPropertiesForLeadAction(lead.id);
          if (matchRes.success && matchRes.data) {
            setTopMatches(matchRes.data.matches.slice(0, 3));
          }
        } catch {
          // Keep existing matches if refresh fails
        } finally {
          setIsRefreshingMatches(false);
        }
      }

      // Refresh change history
      if (canViewChangelog) {
        const histRes = await getLeadChangeHistoryAction(lead.id);
        if (histRes.success) setChangeHistory(histRes.history);
      }
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Failed to update requirements.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const hasScheduledCallback = lead.callHistory.some((c) => !!c.callbackDate);

  return (
    <AppShell>
      <div className="max-w-[1400px] mx-auto space-y-5 pb-12">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between border-b border-crm-border pb-3.5">
          <div className="flex items-center gap-2">
            <Link
              href="/leads"
              className="text-xs font-semibold text-crm-link hover:underline flex items-center gap-1"
            >
              <span>←</span> Leads Queue
            </Link>
            <span className="text-crm-muted text-xs">/</span>
            <span className="text-xs font-semibold text-crm-text">{lead.name}</span>
            <span className="text-crm-muted text-xs">({lead.requirements.city})</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-crm-muted">
              Source: <strong className="text-crm-text">{lead.originalSource}</strong> ({lead.sourceCreatedAt})
            </span>
          </div>
        </div>

        {/* Hero Header */}
        <div className="bg-crm-surface border border-crm-border rounded-lg p-4 sm:p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-teal-50 border border-teal-200 text-crm-primary flex items-center justify-center font-bold text-lg shadow-2xs shrink-0">
              {lead.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight text-crm-text">
                  {lead.name}
                </h1>
                <StatusBadge status={lead.status} />
                <StatusBadge status={lead.requirements.preference} />
                {lead.isDoNotContact && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                    🛑 Do Not Contact
                  </span>
                )}
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 text-crm-muted border border-crm-border">
                  {lead.requirements.city}
                </span>
                {lead.requirements.isConfirmed && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                    ✓ Requirements Confirmed
                  </span>
                )}
                {hasScheduledCallback && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                    ⏰ Pending Callback
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-crm-muted mt-1 flex-wrap">
                <span className="flex items-center gap-1">
                  Primary:{" "}
                  <a
                    href={`tel:${lead.primaryPhone}`}
                    className="font-bold text-crm-text hover:text-crm-primary underline"
                  >
                    +91 {lead.primaryPhone}
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyPhone}
                    className="ml-1 text-[11px] text-crm-muted hover:text-crm-text px-1 py-0.5 rounded bg-stone-100 border border-crm-border cursor-pointer"
                    title="Copy phone"
                  >
                    {copiedPhone ? "✓ Copied" : "Copy"}
                  </button>
                </span>
                {lead.email && (
                  <span>
                    • Email: <span className="text-crm-text">{lead.email}</span>
                  </span>
                )}
                <span>
                  • Assigned: <strong className="text-crm-text">{lead.assignedTelecaller}</strong>
                </span>
                <span>
                  • Last Disposition: <strong className="text-crm-text">{lead.currentDisposition}</strong>
                </span>
                {lead.unreachableCount > 0 && (
                  <span>
                    • Unreachable:{" "}
                    <strong className={lead.unreachableCount >= 3 ? "text-rose-700 font-bold" : "text-crm-text"}>
                      {lead.unreachableCount} / 3 Max
                    </strong>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/matching/${lead.id}`}
              className="px-3.5 py-1.5 text-xs font-bold rounded border border-crm-primary bg-crm-primary/10 text-crm-primary hover:bg-crm-primary hover:text-white transition-all flex items-center gap-1.5 shadow-2xs"
            >
              <span>🎯</span> Match Workspace
            </Link>

            {canLogCall && (
              lead.isDoNotContact ? (
                <span
                  className="px-3.5 py-1.5 text-xs font-semibold rounded bg-stone-100 text-stone-400 border border-stone-200 cursor-not-allowed"
                  title="Calling blocked: Prospect marked Do Not Contact"
                >
                  🛑 DNC (Calling Blocked)
                </span>
              ) : (
                <Link
                  href={`/leads/${lead.id}/qualify`}
                  className="px-3.5 py-1.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover transition-all flex items-center gap-1.5 shadow-2xs"
                >
                  <span>📞</span> Qualify / Log Call
                </Link>
              )
            )}

            {canActivate && lead.status !== "Active" && (
              <button
                type="button"
                onClick={handleActivate}
                disabled={isActivating || lead.isDoNotContact}
                className="px-4 py-1.5 text-xs font-bold rounded bg-crm-success text-white hover:bg-emerald-700 transition-all shadow-2xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isActivating ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Activating...
                  </>
                ) : (
                  <>✓ Mark Active (Confirm)</>
                )}
              </button>
            )}

            {!lead.isDoNotContact && canLogCall && (
              <button
                type="button"
                onClick={() => setIsDncModalOpen(true)}
                className="px-3 py-1.5 text-xs font-medium rounded border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-all cursor-pointer"
              >
                Set DNC
              </button>
            )}
          </div>
        </div>

        {/* Top Alerts */}
        {lead.isDoNotContact && (
          <div className="p-3.5 rounded-lg bg-rose-100 border border-rose-300 text-rose-900 text-xs font-bold flex items-center justify-between gap-2 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="text-lg">🛑</span>
              <span>
                DO NOT CONTACT (DNC): This prospect has requested no further contact. All calling is strictly disabled.
              </span>
            </div>
            <span className="text-[11px] font-normal text-rose-800">Status: Inactive</span>
          </div>
        )}

        {!lead.isDoNotContact && lead.unreachableCount >= 3 && lead.status !== "Inactive" && (
          <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center justify-between gap-2 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <span>
                <strong>Unreachable Limit:</strong> 3 unsuccessful calling attempts recorded. Per PRD §5.5, caller may mark lead Inactive.
              </span>
            </div>
            <button
              type="button"
              onClick={handleInactivate}
              className="px-3 py-1 text-xs font-bold rounded bg-amber-700 hover:bg-amber-800 text-white shadow-2xs cursor-pointer shrink-0"
            >
              Mark Inactive
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* THREE-COLUMN WORKSPACE (PRD §5.7)                                         */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* ===================================================================== */}
          {/* COLUMN 1: Buyer Details + Requirements (Width: 4/12 on desktop)       */}
          {/* ===================================================================== */}
          <div className="lg:col-span-4 space-y-5" data-testid="column-1-details-requirements">
            {/* Card 1: Contact & Profile */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-4 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <h3 className="text-xs font-bold text-crm-text uppercase tracking-wider flex items-center gap-1.5">
                  <span>👤</span> Buyer Profile & Attribution
                </h3>
                <span className="text-[10px] text-crm-muted">PRD §5.3</span>
              </div>

              <div className="p-4 space-y-3 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-crm-muted block">Prospect Name</span>
                  <strong className="text-crm-text text-sm">{lead.name}</strong>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-crm-muted block">Primary Mobile</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <a
                      href={`tel:${lead.primaryPhone}`}
                      className="text-crm-primary font-bold text-sm hover:underline"
                    >
                      +91 {lead.primaryPhone}
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyPhone}
                      className="text-[10px] font-semibold text-crm-muted hover:text-crm-text px-1.5 py-0.5 rounded border border-crm-border bg-stone-50 cursor-pointer"
                    >
                      {copiedPhone ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <span className="text-[10px] text-crm-muted block mt-0.5">🔒 Immutable (PRD §5.3)</span>
                </div>

                {lead.alternatePhone && (
                  <div>
                    <span className="text-[10px] uppercase font-bold text-crm-muted block">Alternate Phone</span>
                    <span className="text-crm-text">{lead.alternatePhone}</span>
                  </div>
                )}

                {lead.email && (
                  <div>
                    <span className="text-[10px] uppercase font-bold text-crm-muted block">Email Address</span>
                    <a href={`mailto:${lead.email}`} className="text-crm-link hover:underline">
                      {lead.email}
                    </a>
                  </div>
                )}

                <div className="pt-2 border-t border-crm-border">
                  <span className="text-[10px] uppercase font-bold text-crm-muted block">Original Source</span>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="font-semibold text-crm-text">{lead.originalSource}</span>
                    <span className="text-[10px] text-crm-muted">{lead.sourceCreatedAt}</span>
                  </div>
                </div>

                {lead.advertisedPropertyRef && (
                  <div className="p-2.5 rounded bg-stone-50 border border-crm-border space-y-1">
                    <span className="text-[10px] uppercase font-bold text-crm-muted block">
                      Advertised Inquiry Reference (PRD §5.1)
                    </span>
                    <span className="font-bold text-crm-text">{lead.advertisedPropertyRef}</span>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          lead.advertisedPropertyVerified
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {lead.advertisedPropertyVerified ? "✓ Verified on Call" : "Pending Verification"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Card 2: Assignment & Telecaller Scoping */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-4 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <h3 className="text-xs font-bold text-crm-text uppercase tracking-wider flex items-center gap-1.5">
                  <span>💼</span> Operational Assignment
                </h3>
                {canAssignTelecaller && (
                  <button
                    type="button"
                    onClick={() => setAssignModalOpen(true)}
                    className="text-xs font-bold text-crm-primary hover:underline cursor-pointer"
                  >
                    Reassign →
                  </button>
                )}
              </div>

              <div className="p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-crm-muted block">Assigned Telecaller</span>
                    <strong className="text-crm-text text-sm">{lead.assignedTelecaller}</strong>
                  </div>
                  {lead.currentAssignment?.assignmentMethod && (
                    <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-stone-100 text-crm-muted border border-crm-border">
                      {lead.currentAssignment.assignmentMethod}
                    </span>
                  )}
                </div>

                {lead.assignmentHistory && lead.assignmentHistory.length > 0 && (
                  <details className="pt-2 border-t border-crm-border text-xs group">
                    <summary className="font-semibold text-crm-link hover:underline cursor-pointer list-none flex items-center justify-between text-[11px]">
                      <span>Assignment Audit History ({lead.assignmentHistory.length})</span>
                      <span className="text-crm-muted text-[10px] group-open:rotate-180 transition-transform">▼</span>
                    </summary>
                    <div className="mt-2 space-y-2 max-h-48 overflow-y-auto pr-1">
                      {lead.assignmentHistory.map((asgn) => (
                        <div
                          key={asgn.id}
                          className="p-2 rounded bg-stone-50 border border-crm-border text-[11px] space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-crm-text">{asgn.assignedUserName}</span>
                            <span className="text-crm-muted">{asgn.assignedAt}</span>
                          </div>
                          <p className="text-crm-muted text-[10px]">
                            By {asgn.assignedByUserName || "System"} • {asgn.assignmentMethod} ({asgn.status})
                          </p>
                          {asgn.notes && <p className="text-crm-text text-[10px] italic">&ldquo;{asgn.notes}&rdquo;</p>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>

            {/* Card 3: Requirements & Specifications */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-4 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <h3 className="text-xs font-bold text-crm-text uppercase tracking-wider flex items-center gap-1.5">
                  <span>📋</span> Requirements & Budget
                </h3>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(true)}
                    className="text-xs font-bold text-crm-primary hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <span>✏️</span> Edit
                  </button>
                )}
              </div>

              <div className="p-4 space-y-3.5 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-crm-muted block">Budget Range (INR)</span>
                  <strong className="text-sm font-bold text-crm-primary">
                    {lead.requirements.budgetFormatted}
                  </strong>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-crm-border">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-crm-muted block">Transaction</span>
                    <div className="mt-0.5">
                      <StatusBadge status={lead.requirements.preference} />
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-crm-muted block">Target City</span>
                    <strong className="text-crm-text mt-0.5 block">{lead.requirements.city}</strong>
                  </div>
                </div>

                <div className="pt-2 border-t border-crm-border">
                  <span className="text-[10px] uppercase font-bold text-crm-muted block">Bedroom Configurations</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {lead.requirements.bedroomConfigurations.length > 0 ? (
                      lead.requirements.bedroomConfigurations.map((bhk, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-stone-100 text-crm-text font-semibold text-[11px] border border-crm-border"
                        >
                          {bhk}
                        </span>
                      ))
                    ) : (
                      <span className="text-crm-muted italic text-[11px]">Any BHK</span>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-crm-border">
                  <span className="text-[10px] uppercase font-bold text-crm-muted block">Property Types</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {lead.requirements.propertyTypes.length > 0 ? (
                      lead.requirements.propertyTypes.map((pt, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-teal-50 text-crm-primary font-medium text-[11px] border border-teal-200"
                        >
                          {pt.replace(/_/g, " ")}
                        </span>
                      ))
                    ) : (
                      <span className="text-crm-muted italic text-[11px]">Any Residential</span>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-crm-border">
                  <span className="text-[10px] uppercase font-bold text-crm-muted block">Verified Localities</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {lead.requirements.localities.length > 0 ? (
                      lead.requirements.localities.map((loc, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-stone-100 text-crm-text font-medium text-[11px] border border-crm-border"
                        >
                          {loc}
                        </span>
                      ))
                    ) : (
                      <span className="text-crm-muted italic text-[11px]">No specific localities restricted</span>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-crm-border">
                  <span className="text-[10px] uppercase font-bold text-crm-muted block">Preferred Societies</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {lead.requirements.societies && lead.requirements.societies.length > 0 ? (
                      lead.requirements.societies.map((soc, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-stone-100 text-crm-text font-medium text-[11px] border border-crm-border"
                        >
                          {soc}
                        </span>
                      ))
                    ) : (
                      <span className="text-crm-muted italic text-[11px]">No societies specified</span>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-crm-border">
                  <span className="text-[10px] uppercase font-bold text-crm-muted block">Area Specifications</span>
                  <div className="mt-1 text-xs">
                    {lead.requirements.minArea != null || lead.requirements.maxArea != null ? (
                      <span className="font-semibold text-crm-text">
                        {lead.requirements.minArea != null ? lead.requirements.minArea : "–"} to{" "}
                        {lead.requirements.maxArea != null ? lead.requirements.maxArea : "–"}{" "}
                        {lead.requirements.areaUnit || "sq.ft"}
                      </span>
                    ) : lead.requirements.targetArea ? (
                      <span className="font-semibold text-crm-text">
                        Target: {lead.requirements.targetArea} {lead.requirements.areaUnit || "sq.ft"}
                      </span>
                    ) : (
                      <span className="text-crm-muted italic">Not specified</span>
                    )}

                    {lead.requirements.areaType && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-stone-100 text-crm-muted text-[10px] font-medium border border-crm-border">
                        {lead.requirements.areaType.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ===================================================================== */}
          {/* COLUMN 2: Calling Controls + Calling History (Width: 4/12 on desktop) */}
          {/* ===================================================================== */}
          <div className="lg:col-span-4 space-y-5" data-testid="column-2-calling-history">
            {/* Card 1: Embedded Calling Controls (PRD §5.7 Middle Column) */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-4 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <h3 className="text-xs font-bold text-crm-text uppercase tracking-wider flex items-center gap-1.5">
                  <span>📞</span> Calling Controls & Outreach
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-teal-50 text-teal-800 border border-teal-200">
                  PRD §5.7 Middle
                </span>
              </div>

              <div className="p-4 space-y-3.5 text-xs">
                {lead.isDoNotContact ? (
                  <div className="p-4 rounded bg-rose-50 border border-rose-200 text-rose-800 text-center space-y-1">
                    <p className="font-bold">🛑 Calling Blocked</p>
                    <p className="text-[11px]">
                      This prospect is marked Do Not Contact. Outbound calling is strictly disabled.
                    </p>
                  </div>
                ) : !canLogCall ? (
                  <div className="p-4 rounded bg-stone-50 border border-crm-border text-center text-crm-muted text-xs">
                    You do not have permission to log calls on this lead.
                  </div>
                ) : (
                  <form onSubmit={handleLogCall} className="space-y-3">
                    {callFormError && (
                      <div className="p-2.5 rounded bg-rose-50 border border-rose-200 text-rose-800 text-[11px]">
                        {callFormError}
                      </div>
                    )}

                    {/* Disposition Selection */}
                    <div>
                      <label className="block text-[11px] font-bold text-crm-text mb-1 uppercase tracking-wider">
                        Call Outcome / Disposition *
                      </label>
                      <select
                        value={disposition}
                        onChange={(e) => setDisposition(e.target.value as LeadDispositionValue)}
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary"
                      >
                        {DISPOSITION_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-crm-muted mt-1">
                        {DISPOSITION_OPTIONS.find((d) => d.value === disposition)?.description}
                      </p>
                    </div>

                    {/* Conditional Callback Date Picker */}
                    {disposition === "CALL_BACK" && (
                      <div className="p-2.5 rounded bg-amber-50/60 border border-amber-200 space-y-1">
                        <label className="block text-[11px] font-bold text-amber-900">
                          Scheduled Callback Date & Time *
                        </label>
                        <input
                          type="datetime-local"
                          value={callbackDate}
                          onChange={(e) => setCallbackDate(e.target.value)}
                          required
                          className="w-full px-2.5 py-1.5 text-xs rounded border border-amber-300 bg-white focus:outline-hidden focus:border-amber-600"
                        />
                        <p className="text-[10px] text-amber-800">
                          Adds prospect to your pending callback queue.
                        </p>
                      </div>
                    )}

                    {/* Advertised Property Verification Checkbox on CONNECTED */}
                    {disposition === "CONNECTED" && lead.advertisedPropertyRef && (
                      <div className="p-2.5 rounded bg-stone-50 border border-crm-border space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isEnquiryVerifiedOnCall}
                            onChange={(e) => setIsEnquiryVerifiedOnCall(e.target.checked)}
                            className="rounded border-crm-border text-crm-primary focus:ring-0"
                          />
                          <span className="text-[11px] font-semibold text-crm-text">
                            Verify Advertised Ad ({lead.advertisedPropertyRef})
                          </span>
                        </label>
                        {isEnquiryVerifiedOnCall && (
                          <input
                            type="text"
                            placeholder="Verification notes (e.g. buyer called about 3 BHK unit)..."
                            value={enquiryVerificationNotesOnCall}
                            onChange={(e) => setEnquiryVerificationNotesOnCall(e.target.value)}
                            className="w-full px-2 py-1 text-xs rounded border border-crm-border bg-white"
                          />
                        )}
                      </div>
                    )}

                    {/* Requirements Confirmation on CONNECTED Call */}
                    {disposition === "CONNECTED" && (
                      <div className="p-2.5 rounded bg-emerald-50/50 border border-emerald-200">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={confirmRequirementsOnCall}
                            onChange={(e) => setConfirmRequirementsOnCall(e.target.checked)}
                            className="rounded border-crm-border text-crm-primary focus:ring-0"
                          />
                          <span className="text-[11px] font-semibold text-emerald-950">
                            Confirm buyer requirements verified on this call
                          </span>
                        </label>
                      </div>
                    )}

                    {/* Call Notes */}
                    <div>
                      <label className="block text-[11px] font-bold text-crm-text mb-1 uppercase tracking-wider">
                        Call Notes & Discussion
                      </label>
                      <textarea
                        rows={2}
                        value={callNotes}
                        onChange={(e) => setCallNotes(e.target.value)}
                        placeholder="Key conversation points, timeline, feedback..."
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white focus:outline-hidden focus:border-crm-primary"
                      />
                    </div>

                    {/* Submit Actions */}
                    <div className="pt-1 flex items-center justify-between gap-2">
                      <a
                        href={`tel:${lead.primaryPhone}`}
                        className="px-3 py-1.5 text-xs font-semibold rounded border border-crm-border bg-stone-50 hover:bg-stone-100 text-crm-text flex items-center gap-1"
                      >
                        <span>📞</span> Dial Buyer
                      </a>
                      <button
                        type="submit"
                        disabled={isSubmittingCall}
                        className="px-4 py-1.5 text-xs font-bold rounded bg-crm-primary hover:bg-crm-primary-hover text-white shadow-2xs cursor-pointer disabled:opacity-50"
                      >
                        {isSubmittingCall ? "Saving..." : "Log Call Attempt"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>

            {/* Card 2: Tabbed Activity Feed (Call History + Change History + Enquiry History) */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-3 py-2 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setActivityTab("calls")}
                    className={`px-2.5 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                      activityTab === "calls"
                        ? "bg-white text-crm-primary border border-crm-border shadow-2xs"
                        : "text-crm-muted hover:text-crm-text"
                    }`}
                  >
                    Calls ({lead.callHistory.length})
                  </button>

                  {canViewChangelog && (
                    <button
                      type="button"
                      onClick={() => setActivityTab("changelog")}
                      className={`px-2.5 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                        activityTab === "changelog"
                          ? "bg-white text-crm-primary border border-crm-border shadow-2xs"
                          : "text-crm-muted hover:text-crm-text"
                      }`}
                    >
                      Audit Log ({changeHistory.length})
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setActivityTab("enquiries")}
                    className={`px-2.5 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                      activityTab === "enquiries"
                        ? "bg-white text-crm-primary border border-crm-border shadow-2xs"
                        : "text-crm-muted hover:text-crm-text"
                    }`}
                  >
                    Enquiries ({lead.enquiries?.length || 0})
                  </button>
                </div>

                {activityTab === "changelog" && canViewChangelog && (
                  <button
                    type="button"
                    onClick={handleRefreshHistory}
                    disabled={isRefreshingHistory}
                    className="text-[11px] text-crm-muted hover:text-crm-text px-2 py-0.5 rounded border border-crm-border bg-white cursor-pointer"
                    title="Refresh Changelog"
                  >
                    ↻
                  </button>
                )}
              </div>

              <div className="p-4">
                {/* Tab 1: Call History */}
                {activityTab === "calls" && (
                  <div className="space-y-2.5">
                    {lead.callHistory.length === 0 ? (
                      <div className="p-6 text-center text-crm-muted text-xs border border-dashed border-crm-border rounded bg-stone-50/50">
                        No calls logged yet. Use calling controls above to record interaction.
                      </div>
                    ) : (
                      <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                        {lead.callHistory.map((call) => (
                          <div
                            key={call.id}
                            className="p-3 rounded-lg border border-crm-border bg-stone-50/40 text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <StatusBadge status={call.disposition} />
                              <span className="text-[11px] text-crm-muted">{call.calledAt}</span>
                            </div>
                            <p className="text-[11px] text-crm-muted">
                              Caller: <strong className="text-crm-text">{call.callerName}</strong>
                            </p>
                            {call.notes && (
                              <p className="p-2 rounded bg-white border border-crm-border text-crm-text text-[11px] leading-relaxed">
                                {call.notes}
                              </p>
                            )}
                            {call.callbackDate && (
                              <div className="p-1.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[10px] font-semibold flex items-center gap-1">
                                <span>⏰ Scheduled Callback:</span>
                                <span>{call.callbackDate}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Tab 2: Change History (DV-05) */}
                {activityTab === "changelog" && canViewChangelog && (
                  <div className="space-y-2.5">
                    {changeHistory.length === 0 ? (
                      <div className="p-6 text-center text-crm-muted text-xs border border-dashed border-crm-border rounded bg-stone-50/50">
                        No changelog records recorded yet.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                        {changeHistory.map((log) => (
                          <div
                            key={log.id}
                            className="p-2.5 rounded border border-crm-border bg-stone-50/50 text-[11px] space-y-1"
                          >
                            <div className="flex items-center justify-between text-crm-muted">
                              <span className="font-bold text-crm-text uppercase tracking-wider text-[10px]">
                                {log.fieldName}
                              </span>
                              <span className="text-[10px]">{log.changedAt}</span>
                            </div>
                            <div className="flex items-center gap-1.5 font-mono text-[10px] bg-white p-1 rounded border border-crm-border break-all">
                              <span className="text-rose-700 line-through truncate max-w-[120px]">
                                {log.previousValue || "none"}
                              </span>
                              <span className="text-crm-muted">→</span>
                              <span className="text-emerald-700 font-bold truncate max-w-[120px]">
                                {log.newValue || "none"}
                              </span>
                            </div>
                            <p className="text-[10px] text-crm-muted">
                              By <strong className="text-crm-text">{log.actorName}</strong> ({log.changeSource})
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Tab 3: Enquiry History (DV-04) */}
                {activityTab === "enquiries" && (
                  <div className="space-y-2.5">
                    {!lead.enquiries || lead.enquiries.length === 0 ? (
                      <div className="p-6 text-center text-crm-muted text-xs border border-dashed border-crm-border rounded bg-stone-50/50">
                        No additional portal inquiries recorded.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                        {lead.enquiries.map((enq) => (
                          <div
                            key={enq.id}
                            className="p-2.5 rounded border border-crm-border bg-stone-50/50 text-[11px] space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-crm-text">{enq.source}</span>
                              <span className="text-crm-muted text-[10px]">{enq.enquiryDate}</span>
                            </div>
                            {enq.advertisedPropertyRef && (
                              <p className="text-[10px] text-crm-muted">
                                Ad Ref: <strong className="text-crm-text">{enq.advertisedPropertyRef}</strong>
                              </p>
                            )}
                            <div className="flex items-center gap-1.5 pt-0.5">
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                  enq.isVerifiedByCaller
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {enq.isVerifiedByCaller ? "✓ Verified" : "Pending Verification"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ===================================================================== */}
          {/* COLUMN 3: Matching Properties + Site Visits (Width: 4/12 on desktop)  */}
          {/* ===================================================================== */}
          <div className="lg:col-span-4 space-y-5" data-testid="column-3-matches-visits">
            {/* Card 1: Top 3 Matching Properties (PRD §5.7 Right Column) */}
            {canViewMatches && (
              <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
                <div className="px-4 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-crm-text uppercase tracking-wider flex items-center gap-1.5">
                      <span>🎯</span> Top 3 Matching Properties
                      {isRefreshingMatches && (
                        <span className="text-[10px] lowercase text-crm-primary font-normal">
                          (updating matches...)
                        </span>
                      )}
                    </h3>
                    <span className="text-[10px] text-crm-muted">PRD §5.7 Active Supply</span>
                  </div>
                  <Link
                    href={`/matching/${lead.id}`}
                    className="text-xs font-bold text-crm-primary hover:underline"
                  >
                    All Matches →
                  </Link>
                </div>

                <div className="p-4 space-y-3 text-xs">
                  {topMatches.length === 0 ? (
                    <div className="p-6 text-center text-crm-muted text-xs border border-dashed border-crm-border rounded bg-stone-50/50 space-y-1">
                      <p className="font-semibold text-crm-text">No Matching Properties Found</p>
                      <p className="text-[11px]">
                        No active validated properties match the preference ({lead.requirements.preference}) and criteria.
                      </p>
                      <Link
                        href={`/matching/${lead.id}`}
                        className="inline-block mt-2 px-3 py-1 text-xs font-bold rounded bg-crm-primary text-white"
                      >
                        Inspect Criteria Workspace
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {topMatches.map((m) => (
                        <div
                          key={m.property.id}
                          className="p-3 rounded-lg border border-crm-border bg-stone-50/40 space-y-2 hover:bg-stone-50 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-1 flex-wrap">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-900 border border-teal-200">
                              {m.score}% Match ({m.criteriaMatchedCount}/{m.criteriaEvaluatedCount})
                            </span>
                            <StatusBadge status={m.property.preference} />
                          </div>

                          <div>
                            <Link
                              href={`/supply/${m.property.id}`}
                              className="font-bold text-crm-text text-sm hover:text-crm-primary hover:underline block"
                            >
                              {m.property.societyName}
                            </Link>
                            <div className="text-[11px] text-crm-muted mt-0.5">
                              {m.property.bedroomCount} BHK • {m.property.area} {m.property.areaType} •{" "}
                              {m.property.locality}, {m.property.city}
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-1 border-t border-crm-border">
                            <span className="font-bold text-crm-primary text-xs">
                              {m.property.priceFormatted}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {canScheduleVisits && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenScheduleModal([m.property.id])}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 shadow-2xs cursor-pointer transition-colors"
                                >
                                  Schedule Visit
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleShareProperty(m.property.id)}
                                disabled={sharingPropertyId === m.property.id}
                                className="px-2.5 py-1 text-[11px] font-bold rounded bg-white hover:bg-stone-100 text-crm-primary border border-crm-border shadow-2xs cursor-pointer disabled:opacity-50"
                              >
                                {sharingPropertyId === m.property.id ? "Sharing..." : "Share Details →"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Card 2: Site Visit History (PRD §5.7 Right Column) */}
            <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
              <div className="px-4 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-crm-text uppercase tracking-wider flex items-center gap-1.5">
                    <span>🚗</span> Site Visit History
                  </h3>
                  <span className="text-[10px] text-crm-muted">PRD §5.7 Past Itineraries</span>
                </div>
                <div className="flex items-center gap-3">
                  {canScheduleVisits && (
                    <button
                      type="button"
                      onClick={() => handleOpenScheduleModal([])}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs cursor-pointer transition-colors"
                    >
                      + Schedule Visit
                    </button>
                  )}
                  <Link href="/visits" className="text-xs font-bold text-crm-primary hover:underline">
                    All Visits →
                  </Link>
                </div>
              </div>

              <div className="p-4 space-y-3 text-xs">
                {siteVisits.length === 0 ? (
                  <div className="p-6 text-center text-crm-muted text-xs border border-dashed border-crm-border rounded bg-stone-50/50">
                    No site visits recorded yet for this prospect.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {siteVisits.map((visit) => (
                      <div
                        key={visit.id}
                        className="p-3 rounded-lg border border-crm-border bg-stone-50/40 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-1 flex-wrap">
                          <span className="font-bold text-crm-text">
                            📅 {visit.scheduledDate} ({visit.timeSlot})
                          </span>
                          <StatusBadge status={visit.status} />
                        </div>

                        <p className="text-[11px] text-crm-muted">
                          Agent: <strong className="text-crm-text">{visit.assignedSalesAgent}</strong>
                        </p>

                        {visit.items && visit.items.length > 0 && (
                          <div className="space-y-1.5 pt-1 border-t border-crm-border">
                            {visit.items.map((it) => (
                              <div
                                key={it.id}
                                className="p-2 rounded bg-white border border-crm-border text-[11px] space-y-1"
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <span className="font-semibold text-crm-text">{it.propertyTitle}</span>
                                    <span className="text-crm-muted text-[10px] block">{it.locality}</span>
                                  </div>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                      it.status === "Visit Done"
                                        ? "bg-emerald-100 text-emerald-800"
                                        : it.status === "Visit Not Done"
                                        ? "bg-rose-100 text-rose-800"
                                        : "bg-stone-100 text-crm-muted"
                                    }`}
                                  >
                                    {it.status}
                                  </span>
                                </div>
                                {it.buyerFeedback && (
                                  <p className="text-[10px] text-crm-muted italic border-t border-stone-100 pt-1">
                                    &ldquo;{it.buyerFeedback}&rdquo;
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {visit.notes && (
                          <p className="text-[11px] text-crm-muted italic bg-white p-2 rounded border border-crm-border">
                            &ldquo;{visit.notes}&rdquo;
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* REQUIREMENT QUICK-EDIT MODAL (COLUMN 1 REUSE)                             */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Edit Requirements & Buyer Information"
      >
        <form onSubmit={handleSaveRequirements} className="space-y-4 text-xs">
          {editError && (
            <div className="p-2.5 rounded bg-rose-50 border border-rose-200 text-rose-800">
              {editError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Buyer Name *
              </label>
              <input
                type="text"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Primary Phone (Immutable)
              </label>
              <input
                type="text"
                disabled
                value={`+91 ${lead.primaryPhone}`}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-100 text-crm-muted cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Alternate Phone (Optional)
              </label>
              <input
                type="text"
                value={editAlternatePhone}
                onChange={(e) => setEditAlternatePhone(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Email Address (Optional)
              </label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Transaction Preference *
              </label>
              <select
                value={editPreference}
                onChange={(e) => setEditPreference(e.target.value as "SALE" | "RENT")}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              >
                <option value="SALE">Sale (Buy)</option>
                <option value="RENT">Rent (Lease)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Target City *
              </label>
              <input
                type="text"
                required
                value={editCity}
                onChange={(e) => setEditCity(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Min Budget (INR) *
              </label>
              <input
                type="number"
                required
                min={0}
                value={editMinBudget}
                onChange={(e) => setEditMinBudget(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              />
              <span className="text-[10px] text-crm-muted">
                {parseFloat(editMinBudget) > 0 ? formatIndianCurrency(parseFloat(editMinBudget)) : "₹0"}
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Max Budget (INR) *
              </label>
              <input
                type="number"
                required
                min={0}
                value={editMaxBudget}
                onChange={(e) => setEditMaxBudget(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              />
              <span className="text-[10px] text-crm-muted">
                {parseFloat(editMaxBudget) > 0 ? formatIndianCurrency(parseFloat(editMaxBudget)) : "₹0"}
              </span>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Verified Localities (Comma-separated)
              </label>
              <input
                type="text"
                placeholder="e.g. DLF Phase 5, Golf Course Road"
                value={editLocalities}
                onChange={(e) => setEditLocalities(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              />
              <span className="text-[10px] text-crm-muted">
                Verified against tenant locality records upon save.
              </span>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Preferred Societies (Comma-separated)
              </label>
              <input
                type="text"
                placeholder="e.g. DLF The Aralias, The Magnolias"
                value={editSocieties}
                onChange={(e) => setEditSocieties(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Bedroom Configurations (BHK)
              </label>
              <div className="flex flex-wrap gap-2 pt-1">
                {BHK_OPTIONS.map((bhk) => (
                  <label key={bhk} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editBhks.includes(bhk)}
                      onChange={(e) => {
                        if (e.target.checked) setEditBhks([...editBhks, bhk]);
                        else setEditBhks(editBhks.filter((b) => b !== bhk));
                      }}
                      className="rounded border-crm-border text-crm-primary"
                    />
                    <span className="text-xs">{bhk}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Acceptable Property Types
              </label>
              <div className="flex flex-wrap gap-2 pt-1">
                {PROPERTY_TYPES.map((pt) => (
                  <label key={pt.value} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editPropertyTypes.includes(pt.value)}
                      onChange={(e) => {
                        if (e.target.checked) setEditPropertyTypes([...editPropertyTypes, pt.value]);
                        else setEditPropertyTypes(editPropertyTypes.filter((p) => p !== pt.value));
                      }}
                      className="rounded border-crm-border text-crm-primary"
                    />
                    <span className="text-xs">{pt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Min Area
              </label>
              <input
                type="number"
                value={editMinArea}
                onChange={(e) => setEditMinArea(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Max Area
              </label>
              <input
                type="number"
                value={editMaxArea}
                onChange={(e) => setEditMaxArea(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Target Area (Optional)
              </label>
              <input
                type="number"
                value={editTargetArea}
                onChange={(e) => setEditTargetArea(e.target.value)}
                placeholder="e.g. 1500"
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Area Unit
              </label>
              <select
                value={editAreaUnit}
                onChange={(e) => setEditAreaUnit(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              >
                <option value="sq.ft">sq.ft</option>
                <option value="sq.yd">sq.yd</option>
                <option value="sq.m">sq.m</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-crm-text mb-1">
                Area Type
              </label>
              <select
                value={editAreaType}
                onChange={(e) =>
                  setEditAreaType(
                    e.target.value as "CARPET" | "BUILT_UP" | "SUPER_BUILT_UP" | ""
                  )
                }
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-white"
              >
                <option value="">None / Unspecified</option>
                <option value="CARPET">Carpet Area</option>
                <option value="BUILT_UP">Built-up Area</option>
                <option value="SUPER_BUILT_UP">Super Built-up Area</option>
              </select>
            </div>
          </div>

          <div className="pt-3 border-t border-crm-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsEditModalOpen(false)}
              className="px-3 py-1.5 text-xs font-semibold rounded border border-crm-border text-crm-muted hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSavingEdit}
              className="px-4 py-1.5 text-xs font-bold rounded bg-crm-primary hover:bg-crm-primary-hover text-white shadow-2xs disabled:opacity-50"
            >
              {isSavingEdit ? "Saving..." : "Save Requirements"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* TELECALLER REASSIGNMENT MODAL (COLUMN 1 REUSE)                            */}
      {/* ========================================================================= */}
      <Modal
        isOpen={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title={
          lead.assignedTelecaller && lead.assignedTelecaller !== "Unassigned"
            ? "Reassign Telecaller"
            : "Assign Telecaller"
        }
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 rounded bg-stone-50 border border-crm-border space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-crm-text text-sm">{lead.name}</span>
              <span className="text-crm-muted font-medium">+91 {lead.primaryPhone}</span>
            </div>
            <p className="text-[11px] text-crm-muted">
              Current Assignee: <strong className="text-crm-text">{lead.assignedTelecaller}</strong>
            </p>
          </div>

          {assignModalError && (
            <div className="p-2.5 rounded bg-rose-50 border border-rose-200 text-rose-800 text-xs">
              {assignModalError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-crm-text mb-1">
              Select Eligible Telecaller
            </label>
            <select
              value={selectedTelecallerId}
              onChange={(e) => setSelectedTelecallerId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-white"
            >
              {eligibleTelecallers.length === 0 ? (
                <option value="">No active telecallers found</option>
              ) : (
                eligibleTelecallers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.email})
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-crm-text mb-1">
              Assignment Notes (Optional)
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Assigned for high intent follow-up..."
              value={assignmentNotes}
              onChange={(e) => setAssignmentNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-white"
            />
          </div>

          <div className="pt-2 border-t border-crm-border flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleAssignRoundRobin}
              disabled={isAssigning}
              className="px-3 py-2 text-xs font-bold rounded bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 cursor-pointer disabled:opacity-50"
            >
              🎲 Auto-Assign (Round Robin)
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAssignModalOpen(false)}
                className="px-3 py-2 text-xs font-medium rounded border border-crm-border text-crm-muted hover:bg-stone-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAssignManual}
                disabled={isAssigning || !selectedTelecallerId}
                className="px-4 py-2 text-xs font-bold rounded bg-crm-primary hover:bg-crm-primary-hover text-white shadow-2xs cursor-pointer disabled:opacity-50"
              >
                {isAssigning ? "Assigning..." : "Assign Telecaller"}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* DNC MODAL                                                                 */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isDncModalOpen}
        onClose={() => setIsDncModalOpen(false)}
        title="Mark Prospect as Do Not Contact (DNC)"
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 rounded bg-rose-50 border border-rose-200 text-rose-900 space-y-1">
            <p className="font-bold">⚠️ Warning: Irreversible Calling Restriction</p>
            <p className="text-[11px] leading-relaxed">
              Marking this prospect as Do Not Contact will immediately disable all calling features, cancel any scheduled callbacks, and move the lead to Inactive.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-crm-text mb-1">
              Reason for DNC (Optional)
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Requested removal from call lists..."
              value={dncReason}
              onChange={(e) => setDncReason(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-white"
            />
          </div>

          <div className="pt-2 border-t border-crm-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsDncModalOpen(false)}
              className="px-3 py-2 text-xs font-medium rounded border border-crm-border text-crm-muted hover:bg-stone-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleMarkDnc}
              disabled={isSubmittingDnc}
              className="px-4 py-2 text-xs font-bold rounded bg-rose-700 hover:bg-rose-800 text-white shadow-2xs cursor-pointer disabled:opacity-50"
            >
              {isSubmittingDnc ? "Setting DNC..." : "Confirm Do Not Contact"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* SCHEDULE VISIT MODAL (PRD §5.7 & §8)                                      */}
      {/* ========================================================================= */}
      {canScheduleVisits && (
        <ScheduleVisitModal
          isOpen={isScheduleModalOpen}
          onClose={() => setIsScheduleModalOpen(false)}
          leadId={lead.id}
          leadName={lead.name}
          leadPhone={lead.primaryPhone}
          initialPropertyIds={scheduleInitialPropertyIds}
          availableProperties={availableProperties}
          salesAgents={salesAgents}
          onSuccess={handleScheduleSuccess}
        />
      )}

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </AppShell>
  );
}
