import { Property, Lead, SiteVisit, PropertyVerificationView } from "@/types/crm";
import {
  Property as PrismaProperty,
  KeyHolder as PrismaKeyHolder,
  PropertyMedia as PrismaPropertyMedia,
  Lead as PrismaLead,
  LeadRequirement as PrismaLeadRequirement,
  Enquiry as PrismaEnquiry,
  CallLog as PrismaCallLog,
  SiteVisit as PrismaSiteVisit,
  SiteVisitItem as PrismaSiteVisitItem,
  SiteVisitScheduleHistory as PrismaSiteVisitScheduleHistory,
  Locality as PrismaLocality,
  LeadRequirementLocality as PrismaLeadRequirementLocality,
  User as PrismaUser,
  Assignment as PrismaAssignment,
} from "@prisma/client";

export function formatIndianCurrency(amount: number, isRent = false): string {
  if (amount >= 10000000) {
    return `₹${(amount / 10000000).toFixed(2)} Cr`;
  }
  if (amount >= 100000) {
    return `₹${(amount / 100000).toFixed(2)} L`;
  }
  return `₹${amount.toLocaleString("en-IN")}${isRent ? " / mo" : ""}`;
}

type FullPrismaProperty = PrismaProperty & {
  keyHolders?: PrismaKeyHolder[];
  media?: PrismaPropertyMedia[];
  callLogs?: (PrismaCallLog & { caller?: PrismaUser | null; callerUser?: PrismaUser | null })[];
  siteVisitItems?: PrismaSiteVisitItem[];
  assignments?: (PrismaAssignment & {
    assignedUser?: PrismaUser | null;
    assignedByUser?: PrismaUser | null;
  })[];
};

export function mapPrismaPropertyToView(p: FullPrismaProperty): Property {
  const priceNum = Number(p.price);
  const areaNum = Number(p.area);

  const keyHolderData = p.keyHolders && p.keyHolders.length > 0 ? p.keyHolders[0] : null;

  return {
    id: p.id,
    flatNumber: p.flatNumber,
    societyName: p.societyName,
    locality: p.localityName,
    city: p.city,
    preference: p.preference === "SALE" ? "Sale" : "Rent",
    furnishingStatus:
      p.furnishingStatus === "FURNISHED"
        ? "Furnished"
        : p.furnishingStatus === "SEMI_FURNISHED"
        ? "Semi-furnished"
        : "Unfurnished",
    propertyType:
      p.propertyType === "INDEPENDENT_HOUSE"
        ? "Independent House"
        : p.propertyType === "BUILDER_FLOOR"
        ? "Builder Floor"
        : p.propertyType === "APARTMENT"
        ? "Apartment"
        : p.propertyType === "VILLA"
        ? "Villa"
        : "Plot",
    area: areaNum,
    areaType:
      p.areaType === "BUILT_UP"
        ? "Built-up"
        : p.areaType === "SUPER_BUILT_UP"
        ? "Super built-up"
        : "Carpet",
    bedroomCount: p.bedroomCount,
    bathroomCount: p.bathroomCount,
    balconyCount: p.balconyCount,
    price: priceNum,
    priceFormatted: formatIndianCurrency(priceNum, p.preference === "RENT"),
    amenities: p.amenities,
    constructionStatus:
      p.constructionStatus === "READY_TO_MOVE" ? "Ready to Move" : "Under Construction",
    ownerName: p.ownerName,
    ownerMobile: p.ownerMobile,
    ownerWillingnessConfirmed: p.ownerWillingnessConfirmed ?? false,
    keyHolder: keyHolderData
      ? {
          name: keyHolderData.name,
          mobile: keyHolderData.mobile,
          persona:
            keyHolderData.persona === "GUARD"
              ? "Guard"
              : keyHolderData.persona === "MAINTENANCE_OFFICE"
              ? "Maintenance Office"
              : keyHolderData.persona === "NEIGHBOUR"
              ? "Neighbour"
              : keyHolderData.persona === "OWNER"
              ? "Owner"
              : "Other",
          notes: keyHolderData.notes || undefined,
        }
      : {
          name: "Not assigned",
          mobile: "-",
          persona: "Other",
        },
    validationStatus:
      p.validationStatus === "VALIDATED"
        ? "Validated"
        : p.validationStatus === "IN_VALIDATION"
        ? "In Validation"
        : p.validationStatus === "MANDATE_DECLINED"
        ? "Mandate Declined"
        : "Not Validated",
    availabilityStatus:
      p.availabilityStatus === "AVAILABLE"
        ? "Available"
        : p.availabilityStatus === "SOLD"
        ? "Sold"
        : p.availabilityStatus === "RENTED"
        ? "Rented"
        : "Temporarily Unavailable",
    isActiveSupply: p.isActiveSupply,
    currentDisposition: p.callLogs?.[0]?.propertyDisposition
      ? p.callLogs[0].propertyDisposition.replace(/_/g, " ")
      : "Not Called",
    callHistory:
      p.callLogs?.map((c) => {
        const calledDate = new Date(c.calledAt);
        const formattedCalledAt = !isNaN(calledDate.getTime())
          ? calledDate.toLocaleString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            })
          : "Recently";

        let formattedCallback: string | undefined;
        if (c.callbackScheduledAt) {
          const cbDate = new Date(c.callbackScheduledAt);
          if (!isNaN(cbDate.getTime())) {
            formattedCallback = cbDate.toLocaleString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            });
          }
        }

        return {
          id: c.id,
          calledAt: formattedCalledAt,
          callerName: c.caller?.name || c.callerUser?.name || "Caller",
          disposition: c.propertyDisposition ? c.propertyDisposition.replace(/_/g, " ") : "Called",
          notes: c.notes || "",
          callbackDate: formattedCallback,
        };
      }) || [],
    media:
      p.media?.map((m) => ({
        id: m.id,
        type: m.mediaType,
        url: m.url,
        caption: m.caption || "",
        displayOrder: m.displayOrder,
        createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : undefined,
      })) || [],
    rentedAt: p.rentedAt ? new Date(p.rentedAt).toISOString() : undefined,
    revalidationStatus:
      p.revalidationStatus === "DUE"
        ? "Due"
        : p.revalidationStatus === "IN_PROGRESS"
        ? "In Progress"
        : "None",
    visitCount: p.siteVisitItems?.length || 0,
    currentAssignment: (() => {
      const active = p.assignments?.find(
        (a) => a.status === "ACTIVE" && a.targetType === "PROPERTY"
      );
      if (!active) return null;
      const assignedDate = new Date(active.assignedAt);
      const formattedAssignedAt = !isNaN(assignedDate.getTime())
        ? assignedDate.toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
        : "Recently";

      return {
        id: active.id,
        assignedUserId: active.assignedUserId,
        assignedUserName: active.assignedUser?.name || "Telecaller",
        assignedByUserId: active.assignedByUserId,
        assignedByUserName: active.assignedByUser?.name || null,
        assignmentMethod:
          active.assignmentMethod === "ROUND_ROBIN"
            ? ("Round Robin" as const)
            : ("Manual" as const),
        status: "Active" as const,
        assignedAt: formattedAssignedAt,
        notes: active.notes || null,
      };
    })(),
    assignmentHistory:
      p.assignments?.map((a) => {
        const assignedDate = new Date(a.assignedAt);
        const formattedAssignedAt = !isNaN(assignedDate.getTime())
          ? assignedDate.toLocaleString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            })
          : "Recently";

        let formattedUnassignedAt: string | null = null;
        if (a.unassignedAt) {
          const uDate = new Date(a.unassignedAt);
          if (!isNaN(uDate.getTime())) {
            formattedUnassignedAt = uDate.toLocaleString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            });
          }
        }

        return {
          id: a.id,
          assignedUserId: a.assignedUserId,
          assignedUserName: a.assignedUser?.name || "Telecaller",
          assignedByUserId: a.assignedByUserId,
          assignedByUserName: a.assignedByUser?.name || null,
          assignmentMethod:
            a.assignmentMethod === "ROUND_ROBIN"
              ? ("Round Robin" as const)
              : ("Manual" as const),
          status:
            a.status === "ACTIVE"
              ? ("Active" as const)
              : a.status === "REASSIGNED"
              ? ("Reassigned" as const)
              : a.status === "COMPLETED"
              ? ("Completed" as const)
              : ("Cancelled" as const),
          assignedAt: formattedAssignedAt,
          unassignedAt: formattedUnassignedAt,
          notes: a.notes || null,
        };
      }) || [],
    isFieldVerified: p.isFieldVerified ?? false,
    fieldVerifiedAt: p.fieldVerifiedAt ? p.fieldVerifiedAt.toISOString() : null,
  };
}

type FullPrismaLead = PrismaLead & {
  requirement?:
    | (PrismaLeadRequirement & {
        localities?: (PrismaLeadRequirementLocality & { locality?: PrismaLocality | null })[];
      })
    | null;
  enquiries?: PrismaEnquiry[];
  callLogs?: (PrismaCallLog & { caller?: { id: string; name: string; role: string } | null })[];
  assignedTelecaller?: { id: string; name: string; email?: string } | null;
};

export function mapPrismaLeadToView(l: FullPrismaLead): Lead {
  const minB = Number(l.requirement?.minBudget || 0);
  const maxB = Number(l.requirement?.maxBudget || 0);

  return {
    id: l.id,
    name: l.name,
    primaryPhone: l.primaryPhone,
    alternatePhone: l.alternatePhone || undefined,
    email: l.email || undefined,
    status:
      l.status === "ACTIVE"
        ? "Active"
        : l.status === "INACTIVE"
        ? "Inactive"
        : "Not Yet Validated",
    unreachableCount: l.unreachableAttemptsCount,
    originalSource: l.originalSource,
    sourceCreatedAt: new Date(l.sourceCreatedAt).toLocaleDateString("en-IN"),
    assignedTelecaller: l.assignedTelecaller?.name || "Unassigned",
    advertisedPropertyRef: l.enquiries?.[0]?.advertisedPropertyRef || undefined,
    advertisedPropertyVerified: false,
    advertisedPropertyNotes: undefined,
    requirements: {
      minBudget: minB,
      maxBudget: maxB,
      budgetFormatted: `${formatIndianCurrency(minB)} - ${formatIndianCurrency(maxB)}`,
      city: l.requirement?.city || "Not Specified",
      localities:
        l.requirement?.localities
          ?.map((loc) => loc.locality?.name || "")
          .filter(Boolean) || [],
      societies: [],
      bedroomConfigurations: l.requirement?.bedroomConfigurations?.length
        ? l.requirement.bedroomConfigurations
        : l.requirement?.minBedrooms
        ? [`${l.requirement.minBedrooms} BHK`]
        : [],
      preference: l.requirement?.preference === "RENT" ? "Rent" : "Sale",
      propertyTypes: l.requirement?.propertyTypes || [],
      targetArea: l.requirement?.targetArea ? Number(l.requirement.targetArea) : undefined,
      isConfirmed: l.status === "ACTIVE",
    },
    currentDisposition: l.callLogs?.[0]?.leadDisposition?.replace(/_/g, " ") || "Not Called",
    callHistory:
      l.callLogs?.map((c) => ({
        id: c.id,
        calledAt: new Date(c.calledAt).toLocaleDateString("en-IN"),
        callerName: c.caller?.name || "Telecaller",
        disposition: c.leadDisposition ? c.leadDisposition.replace(/_/g, " ") : "Called",
        notes: c.notes || "",
        callbackDate: c.callbackScheduledAt
          ? new Date(c.callbackScheduledAt).toLocaleDateString("en-IN")
          : undefined,
      })) || [],
    topMatches: [],
    siteVisitHistory: [],
  };
}

type FullPrismaSiteVisit = PrismaSiteVisit & {
  lead: { id: string; name: string; primaryPhone: string };
  assignedSalesAgent: { id: string; name: string; email: string };
  telecallerConfirmedByUser?: { id: string; name: string; role?: string } | null;
  items: (PrismaSiteVisitItem & {
    property: {
      id: string;
      societyName: string;
      localityName: string;
      city: string;
      bedroomCount: number;
      flatNumber: string;
      ownerName: string;
      ownerMobile: string;
    };
    reportedByUser?: { id: string; name: string; role?: string } | null;
    enteredByUser?: { id: string; name: string; role?: string } | null;
  })[];
  scheduleHistories?: (PrismaSiteVisitScheduleHistory & {
    recordedByUser?: { id: string; name: string } | null;
  })[];
};

export function mapPrismaSiteVisitToView(v: FullPrismaSiteVisit): SiteVisit {
  return {
    id: v.id,
    buyerId: v.lead.id,
    buyerName: v.lead.name,
    buyerPhone: v.lead.primaryPhone,
    assignedSalesAgent: v.assignedSalesAgent?.name || "Unassigned",
    assignedSalesAgentId: v.assignedSalesAgentId,
    notes: v.notes || undefined,
    telecallerName: "Telecaller",
    scheduledDate: new Date(v.scheduledDate).toLocaleDateString("en-IN", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    timeSlot: new Date(v.scheduledDate).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    status:
      v.status === "CONFIRMED"
        ? "Confirmed"
        : v.status === "COMPLETED"
        ? "Completed"
        : v.status === "CANCELLED"
        ? "Cancelled"
        : v.status === "RESCHEDULED"
        ? "Rescheduled"
        : "Tentative - Awaiting Owner",
    telecallerConfirmedAt: v.telecallerConfirmedAt
      ? new Date(v.telecallerConfirmedAt).toLocaleDateString("en-IN")
      : undefined,
    telecallerConfirmedBy: v.telecallerConfirmedByUser?.name || undefined,
    cancellationReason: v.cancellationReason || undefined,
    items: v.items.map((item) => ({
      id: item.id,
      propertyId: item.property.id,
      propertyTitle: `${item.property.bedroomCount} BHK ${item.property.societyName}`,
      locality: item.property.localityName,
      city: item.property.city,
      flatNumber: item.property.flatNumber,
      ownerName: item.property.ownerName,
      ownerMobile: item.property.ownerMobile,
      keyHolder: { name: "Keyholder", mobile: "-", persona: "Other" },
      status:
        item.status === "VISIT_DONE"
          ? "Visit Done"
          : item.status === "VISIT_NOT_DONE"
          ? "Visit Not Done"
          : "Pending",
      reportedBy: item.reportedByUser?.name || undefined,
      enteredBy: item.enteredByUser?.name || "Agent",
      entryChannel:
        item.entryChannel === "FIELD_AGENT_DIRECT"
          ? "Field Agent Direct"
          : "Telecaller on Behalf",
      reportedAt: item.reportedOutcomeAt
        ? new Date(item.reportedOutcomeAt).toLocaleDateString("en-IN")
        : undefined,
      agentNotes: item.agentTextNotes || undefined,
      hasVoiceNote: !!item.voiceNoteUrl,
      voiceNoteDuration: item.voiceNoteDurationSeconds
        ? `${Math.floor(item.voiceNoteDurationSeconds / 60)}:${
            item.voiceNoteDurationSeconds % 60
          } min`
        : undefined,
      buyerFeedback: item.buyerFeedback || undefined,
      buyerInterest:
        item.buyerInterestLevel === "HIGH"
          ? "High"
          : item.buyerInterestLevel === "MEDIUM"
          ? "Medium"
          : item.buyerInterestLevel === "LOW"
          ? "Low"
          : undefined,
    })),
    scheduleHistory:
      v.scheduleHistories?.map((h) => ({
        changedAt: new Date(h.createdAt).toLocaleDateString("en-IN"),
        changeType: h.changeType,
        previousTime: new Date(h.previousScheduledAt).toLocaleDateString("en-IN"),
        newTime: h.newScheduledAt
          ? new Date(h.newScheduledAt).toLocaleDateString("en-IN")
          : "-",
        reason: h.reason,
        recordedBy: h.recordedByUser?.name || "User",
      })) || [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapPrismaVerificationToView(v: any): PropertyVerificationView {
  const p = v.property;
  const keyHolderData = p?.keyHolders && p.keyHolders.length > 0 ? p.keyHolders[0] : null;
  const priceNum = p ? Number(p.price) : 0;

  return {
    id: v.id,
    propertyId: v.propertyId,
    societyName: p?.societyName || "Unknown Society",
    flatNumber: p?.flatNumber || "-",
    locality: p?.localityName || "-",
    city: p?.city || "-",
    preference: p?.preference === "SALE" ? "Sale" : "Rent",
    propertyType:
      p?.propertyType === "INDEPENDENT_HOUSE"
        ? "Independent House"
        : p?.propertyType === "BUILDER_FLOOR"
        ? "Builder Floor"
        : p?.propertyType === "APARTMENT"
        ? "Apartment"
        : p?.propertyType === "VILLA"
        ? "Villa"
        : "Plot",
    bedroomCount: p?.bedroomCount ?? 0,
    bathroomCount: p?.bathroomCount ?? 0,
    priceFormatted: formatIndianCurrency(priceNum, p?.preference === "RENT"),
    ownerName: p?.ownerName || "-",
    ownerMobile: p?.ownerMobile || "-",
    keyHolderName: keyHolderData?.name,
    keyHolderMobile: keyHolderData?.mobile,
    keyHolderPersona: keyHolderData?.persona,
    verifierId: v.verifierId,
    verifierName: v.verifier?.name || "Field Verifier",
    verifierPhone: v.verifier?.phone,
    assignedByUserName: v.assignedByUser?.name || null,
    status: v.status,
    startedAt: v.startedAt ? new Date(v.startedAt).toISOString() : null,
    submittedAt: v.submittedAt ? new Date(v.submittedAt).toISOString() : null,
    reviewedAt: v.reviewedAt ? new Date(v.reviewedAt).toISOString() : null,
    reviewedByUserName: v.reviewedByUser?.name || null,
    reviewNotes: v.reviewNotes || null,
    physicalMatch: v.physicalMatch,
    occupancyState: v.occupancyState,
    actualBedrooms: v.actualBedrooms,
    actualBathrooms: v.actualBathrooms,
    propertyCondition: v.propertyCondition,
    amenitiesConfirmed: v.amenitiesConfirmed || [],
    keyHolderConfirmed: v.keyHolderConfirmed,
    discrepancies: v.discrepancies,
    verifierRemarks: v.verifierRemarks,
    unableToVerifyReason: v.unableToVerifyReason,
    unableToVerifyNotes: v.unableToVerifyNotes,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    media: (v.media || []).map((m: any) => ({
      id: m.id,
      type: m.mediaType,
      url: m.url,
      caption: m.caption || "",
      displayOrder: m.displayOrder,
      uploadedByName: m.uploadedBy?.name,
      createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : undefined,
    })),
    createdAt: v.createdAt ? new Date(v.createdAt).toISOString() : new Date().toISOString(),
  };
}

