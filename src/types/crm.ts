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
  type: "PHOTO" | "VIDEO";
  url: string;
  caption: string;
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

