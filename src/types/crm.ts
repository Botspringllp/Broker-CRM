// Domain & View Types for Broker CRM (Phase 1)
// Clean TypeScript definitions for production UI and DAL mapping

export interface KeyHolder {
  name: string;
  mobile: string;
  persona: "Guard" | "Maintenance Office" | "Neighbour" | "Owner" | "Other";
  notes?: string;
}

export interface CallLogItem {
  id: string;
  calledAt: string;
  callerName: string;
  disposition: string;
  notes: string;
  callbackDate?: string;
}

export interface PropertyMedia {
  id?: string;
  type: "PHOTO" | "VIDEO";
  url: string;
  caption: string;
  displayOrder?: number;
  uploadedByName?: string;
  createdAt?: string;
}

export interface PropertyAssignment {
  id: string;
  assignedUserId: string;
  assignedUserName: string;
  assignedByUserId?: string | null;
  assignedByUserName?: string | null;
  assignmentMethod: "Manual" | "Round Robin";
  status: "Active" | "Reassigned" | "Completed" | "Cancelled";
  assignedAt: string;
  unassignedAt?: string | null;
  notes?: string | null;
}

export interface Property {
  id: string;
  flatNumber: string;
  societyName: string;
  locality: string;
  city: string;
  preference: "Sale" | "Rent";
  furnishingStatus: "Unfurnished" | "Semi-furnished" | "Furnished";
  propertyType: "Apartment" | "Independent House" | "Villa" | "Builder Floor" | "Plot";
  area: number;
  areaType: "Carpet" | "Built-up" | "Super built-up";
  bedroomCount: number;
  bathroomCount: number;
  balconyCount: number;
  price: number; // In INR: total sale price or monthly rent
  priceFormatted: string;
  amenities: string[];
  constructionStatus: "Ready to Move" | "Under Construction";
  ownerName: string;
  ownerMobile: string; // Masked in buyer-facing views
  ownerWillingnessConfirmed: boolean;
  keyHolder: KeyHolder;
  validationStatus: "Not Validated" | "In Validation" | "Validated" | "Mandate Declined";
  availabilityStatus: "Available" | "Temporarily Unavailable" | "Sold" | "Rented";
  isActiveSupply: boolean; // True only when Validated + Available
  currentDisposition: string;
  callHistory: CallLogItem[];
  media: PropertyMedia[];
  rentedAt?: string;
  revalidationStatus?: "None" | "Due" | "In Progress";
  visitCount: number;
  currentAssignment?: PropertyAssignment | null;
  assignmentHistory?: PropertyAssignment[];
  isFieldVerified?: boolean;
  fieldVerifiedAt?: string | null;
}

export interface PropertyVerificationView {
  id: string;
  propertyId: string;
  societyName: string;
  flatNumber: string;
  locality: string;
  city: string;
  preference: "Sale" | "Rent";
  propertyType: string;
  bedroomCount: number;
  bathroomCount: number;
  priceFormatted: string;
  ownerName: string;
  ownerMobile: string;
  keyHolderName?: string;
  keyHolderMobile?: string;
  keyHolderPersona?: string;
  verifierId: string;
  verifierName: string;
  verifierPhone?: string;
  assignedByUserName?: string | null;
  status: "ASSIGNED" | "IN_PROGRESS" | "SUBMITTED" | "APPROVED" | "REJECTED" | "UNABLE_TO_VERIFY";
  startedAt?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewedByUserName?: string | null;
  reviewNotes?: string | null;
  physicalMatch?: boolean | null;
  occupancyState?: "VACANT" | "SELF_OCCUPIED" | "TENANT_OCCUPIED" | "OTHER" | null;
  actualBedrooms?: number | null;
  actualBathrooms?: number | null;
  propertyCondition?: "EXCELLENT" | "GOOD" | "AVERAGE" | "POOR" | null;
  amenitiesConfirmed?: string[];
  keyHolderConfirmed?: boolean | null;
  discrepancies?: string | null;
  verifierRemarks?: string | null;
  unableToVerifyReason?: string | null;
  unableToVerifyNotes?: string | null;
  media: PropertyMedia[];
  createdAt: string;
}

export interface VerificationStats {
  total: number;
  assigned: number;
  inProgress: number;
  submitted: number;
  approved: number;
  unableToVerify: number;
  rejected: number;
}

export interface MatchingPropertySummary {
  id: string;
  score: number;
  societyName: string;
  bedroomCount: number;
  area: number;
  areaType: string;
  priceFormatted: string;
  preference: "Sale" | "Rent";
  locality: string;
}

export interface Lead {
  id: string;
  name: string;
  primaryPhone: string;
  alternatePhone?: string;
  email?: string;
  status: "Not Yet Validated" | "Active" | "Inactive";
  unreachableCount: number;
  originalSource: string;
  sourceCreatedAt: string;
  assignedTelecaller: string;
  advertisedPropertyRef?: string;
  advertisedPropertyVerified: boolean;
  advertisedPropertyNotes?: string;
  requirements: {
    minBudget: number;
    maxBudget: number;
    budgetFormatted: string;
    city: string;
    localities: string[];
    societies: string[];
    bedroomConfigurations: string[];
    preference: "Sale" | "Rent";
    propertyTypes: string[];
    targetArea?: number;
    isConfirmed: boolean;
  };
  currentDisposition: string;
  callHistory: CallLogItem[];
  topMatches: MatchingPropertySummary[];
  siteVisitHistory: {
    date: string;
    propertySociety: string;
    outcome: string;
    agentName: string;
  }[];
}

export interface SiteVisitItem {
  id: string;
  propertyId: string;
  propertyTitle: string;
  locality: string;
  city: string;
  flatNumber: string; // Masked for buyer preview
  ownerName: string; // Masked for buyer preview
  ownerMobile: string; // Masked for buyer preview
  keyHolder: KeyHolder;
  status: "Pending" | "Visit Done" | "Visit Not Done";
  reportedBy?: string; // Field agent name
  enteredBy: string; // Field agent or telecaller
  entryChannel: "Field Agent Direct" | "Telecaller on Behalf";
  reportedAt?: string;
  agentNotes?: string;
  hasVoiceNote?: boolean;
  voiceNoteDuration?: string;
  buyerFeedback?: string;
  buyerInterest?: "High" | "Medium" | "Low" | "Not Interested";
}

export interface SiteVisit {
  id: string;
  buyerId: string;
  buyerName: string;
  buyerPhone: string;
  assignedSalesAgent: string;
  telecallerName: string;
  scheduledDate: string;
  timeSlot: string;
  status: "Tentative - Awaiting Owner" | "Confirmed" | "Completed" | "Cancelled" | "Rescheduled";
  telecallerConfirmedAt?: string;
  telecallerConfirmedBy?: string;
  cancellationReason?: string;
  items: SiteVisitItem[];
  scheduleHistory: {
    changedAt: string;
    previousTime: string;
    newTime: string;
    reason: string;
    recordedBy: string;
  }[];
}

