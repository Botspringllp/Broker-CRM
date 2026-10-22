// Phase 1 Mock Data Fixtures for Broker CRM
// Strictly represents demo data for Indian secondary market operations (resale & rentals)

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
  scheduledDate: string; // ISO format or display string
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

// ------------------------------------------------------------------
// FIXTURE DATA
// ------------------------------------------------------------------

export const INITIAL_PROPERTIES: Property[] = [
  {
    id: "prop-101",
    flatNumber: "Tower 2, Flat 1401",
    societyName: "DLF The Camellias",
    locality: "Golf Course Road",
    city: "Gurgaon",
    preference: "Sale",
    furnishingStatus: "Semi-furnished",
    propertyType: "Apartment",
    area: 7400,
    areaType: "Super built-up",
    bedroomCount: 4,
    bathroomCount: 5,
    balconyCount: 3,
    price: 285000000,
    priceFormatted: "₹28.50 Cr",
    amenities: ["Clubhouse", "Golf View", "Private Elevator", "Swimming Pool", "Concierge"],
    constructionStatus: "Ready to Move",
    ownerName: "Harishankar Singhania",
    ownerMobile: "+91 98110 00012",
    keyHolder: {
      name: "Ramdas (Facility Concierge)",
      mobile: "+91 98110 00013",
      persona: "Maintenance Office",
      notes: "Key available at clubhouse reception with 1-hr advance notice",
    },
    validationStatus: "Validated",
    availabilityStatus: "Available",
    isActiveSupply: true,
    currentDisposition: "Property Available",
    callHistory: [
      {
        id: "call-p1",
        calledAt: "2026-10-20 11:30 AM",
        callerName: "Pooja Sharma",
        disposition: "Property Available",
        notes: "Owner confirmed mandate at 1% brokerage. Price non-negotiable. Available for visits on weekends.",
      },
    ],
    media: [
      { type: "PHOTO", url: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800", caption: "Living Room with Golf View" },
      { type: "PHOTO", url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800", caption: "Master Bedroom Suite" },
      { type: "VIDEO", url: "https://youtube.com/watch?v=demo-camellias", caption: "Verified Walkthrough (YouTube)" },
    ],
    visitCount: 3,
  },
  {
    id: "prop-102",
    flatNumber: "Block C, Flat 602",
    societyName: "Sobha City",
    locality: "Sector 108",
    city: "Gurgaon",
    preference: "Sale",
    furnishingStatus: "Unfurnished",
    propertyType: "Apartment",
    area: 2050,
    areaType: "Super built-up",
    bedroomCount: 3,
    bathroomCount: 3,
    balconyCount: 2,
    price: 24500000,
    priceFormatted: "₹2.45 Cr",
    amenities: ["Badminton Court", "Park Facing", "Covered Parking", "Gym"],
    constructionStatus: "Ready to Move",
    ownerName: "Rameshwar Kulkarni",
    ownerMobile: "+91 98220 00023",
    keyHolder: {
      name: "Security Guard Gate 2",
      mobile: "+91 98220 00024",
      persona: "Guard",
      notes: "Keys with guard post; call owner before taking keys",
    },
    validationStatus: "In Validation",
    availabilityStatus: "Available",
    isActiveSupply: false, // In Validation so not yet active supply pool
    currentDisposition: "Call Back",
    callHistory: [
      {
        id: "call-p2",
        calledAt: "2026-10-21 04:15 PM",
        callerName: "Pooja Sharma",
        disposition: "Call Back",
        notes: "Owner driving. Asked to call back on Thursday at 3 PM to confirm asking price and inspection.",
        callbackDate: "2026-10-23 03:00 PM",
      },
    ],
    media: [
      { type: "PHOTO", url: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800", caption: "Balcony and Park View" },
    ],
    visitCount: 0,
  },
  {
    id: "prop-103",
    flatNumber: "Tower 5, Flat 1204",
    societyName: "Hiranandani Castle Rock",
    locality: "Powai",
    city: "Mumbai",
    preference: "Rent",
    furnishingStatus: "Furnished",
    propertyType: "Apartment",
    area: 1050,
    areaType: "Carpet",
    bedroomCount: 2,
    bathroomCount: 2,
    balconyCount: 1,
    price: 85000,
    priceFormatted: "₹85,000 / mo",
    amenities: ["Modular Kitchen", "AC Units", "Club Access", "24/7 Security"],
    constructionStatus: "Ready to Move",
    ownerName: "Sunita Agarwal",
    ownerMobile: "+91 98330 00034",
    keyHolder: {
      name: "Neighbour (Mrs. Deshpande 1203)",
      mobile: "+91 98330 00035",
      persona: "Neighbour",
      notes: "Ring bell at 1203 for physical key",
    },
    validationStatus: "Validated",
    availabilityStatus: "Available",
    isActiveSupply: true,
    currentDisposition: "Property Available",
    callHistory: [
      {
        id: "call-p3",
        calledAt: "2026-10-19 02:00 PM",
        callerName: "Pooja Sharma",
        disposition: "Property Available",
        notes: "Family tenants preferred. Deposit 5 months rent. Ready for immediate lease.",
      },
    ],
    media: [
      { type: "PHOTO", url: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800", caption: "Furnished Living Room" },
    ],
    visitCount: 4,
  },
  {
    id: "prop-104",
    flatNumber: "Phase 5, Villa 42",
    societyName: "DLF Phase 5",
    locality: "Golf Course Road",
    city: "Gurgaon",
    preference: "Rent",
    furnishingStatus: "Semi-furnished",
    propertyType: "Villa",
    area: 3200,
    areaType: "Built-up",
    bedroomCount: 3,
    bathroomCount: 4,
    balconyCount: 2,
    price: 110000,
    priceFormatted: "₹1.10 Lakh / mo",
    amenities: ["Private Garden", "Gated Security", "Power Backup", "Car Port"],
    constructionStatus: "Ready to Move",
    ownerName: "Col. Sanjeev Vohra",
    ownerMobile: "+91 98100 00045",
    keyHolder: {
      name: "Caretaker - Bansi Lal",
      mobile: "+91 98100 00046",
      persona: "Guard",
      notes: "Lives in servant quarter, available 9 AM to 7 PM",
    },
    validationStatus: "Validated",
    availabilityStatus: "Available",
    isActiveSupply: true,
    currentDisposition: "Property Available",
    callHistory: [
      {
        id: "call-p4",
        calledAt: "2026-10-18 10:00 AM",
        callerName: "Pooja Sharma",
        disposition: "Property Available",
        notes: "Willing to execute 11-month agreement. Corporate lease preferred.",
      },
    ],
    media: [
      { type: "PHOTO", url: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800", caption: "Exterior and Lawn" },
    ],
    visitCount: 2,
  },
  {
    id: "prop-105",
    flatNumber: "Tower 3, Flat 802",
    societyName: "Prestige Lakeside Habitat",
    locality: "Whitefield",
    city: "Bangalore",
    preference: "Sale",
    furnishingStatus: "Semi-furnished",
    propertyType: "Apartment",
    area: 1850,
    areaType: "Built-up",
    bedroomCount: 3,
    bathroomCount: 3,
    balconyCount: 2,
    price: 19500000,
    priceFormatted: "₹1.95 Cr",
    amenities: ["Lake View", "Swimming Pool", "Cricket Pitch", "Supermarket Inside"],
    constructionStatus: "Ready to Move",
    ownerName: "K. Venkatesh",
    ownerMobile: "+91 98450 00056",
    keyHolder: {
      name: "Maintenance Helpdesk",
      mobile: "+91 98450 00057",
      persona: "Maintenance Office",
      notes: "Available Monday to Saturday",
    },
    validationStatus: "Validated",
    availabilityStatus: "Available",
    isActiveSupply: true,
    currentDisposition: "Property Available",
    callHistory: [
      {
        id: "call-p5",
        calledAt: "2026-10-19 03:30 PM",
        callerName: "Pooja Sharma",
        disposition: "Property Available",
        notes: "Clear title, single owner, SBI approved project. Price slightly negotiable.",
      },
    ],
    media: [
      { type: "PHOTO", url: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800", caption: "Lakefacing Balcony" },
    ],
    visitCount: 1,
  },
  {
    id: "prop-106",
    flatNumber: "Tower B, Flat 301",
    societyName: "DLF The Crest",
    locality: "Sector 54",
    city: "Gurgaon",
    preference: "Rent",
    furnishingStatus: "Furnished",
    propertyType: "Apartment",
    area: 2600,
    areaType: "Super built-up",
    bedroomCount: 3,
    bathroomCount: 3,
    balconyCount: 2,
    price: 160000,
    priceFormatted: "₹1.60 Lakh / mo",
    amenities: ["Clubhouse", "Tennis Court", "Dedicated Stilt Parking"],
    constructionStatus: "Ready to Move",
    ownerName: "Dr. Alok Nath",
    ownerMobile: "+91 98110 00067",
    keyHolder: {
      name: "Owner in Delhi",
      mobile: "+91 98110 00067",
      persona: "Owner",
      notes: "Will come for inspection once tenant is qualified",
    },
    validationStatus: "Validated",
    availabilityStatus: "Rented", // Rented status triggers 10-month revalidation rule
    isActiveSupply: false, // Rented property is inactive from available pool
    rentedAt: "2025-12-15",
    revalidationStatus: "Due", // 10 months completed!
    currentDisposition: "Property Sold/Rented",
    callHistory: [
      {
        id: "call-p6",
        calledAt: "2025-12-14 05:00 PM",
        callerName: "Pooja Sharma",
        disposition: "Property Sold or Rented",
        notes: "Tenant moved in. 11-month agreement ends Nov 2026. Scheduled 10-month revalidation trigger set.",
      },
    ],
    media: [
      { type: "PHOTO", url: "https://images.unsplash.com/photo-1560185007-c5ca9d2c014d?w=800", caption: "Furnished Living Room" },
    ],
    visitCount: 5,
  },
  {
    id: "prop-107",
    flatNumber: "Block A, Flat 504",
    societyName: "Godrej Woods",
    locality: "Sector 43",
    city: "Noida",
    preference: "Sale",
    furnishingStatus: "Unfurnished",
    propertyType: "Apartment",
    area: 1250,
    areaType: "Carpet",
    bedroomCount: 2,
    bathroomCount: 2,
    balconyCount: 1,
    price: 13500000,
    priceFormatted: "₹1.35 Cr",
    amenities: ["Forest View", "Clubhouse", "Metro 500m"],
    constructionStatus: "Under Construction",
    ownerName: "Deepak Chopra",
    ownerMobile: "+91 98120 00078",
    keyHolder: {
      name: "Builder Site Office",
      mobile: "+91 98120 00079",
      persona: "Maintenance Office",
      notes: "Sample flat visit only",
    },
    validationStatus: "Not Validated",
    availabilityStatus: "Available",
    isActiveSupply: false,
    currentDisposition: "Ringing / Not Answering",
    callHistory: [
      {
        id: "call-p7",
        calledAt: "2026-10-22 10:15 AM",
        callerName: "Pooja Sharma",
        disposition: "Ringing / Not Answering",
        notes: "No answer on call. Second attempt scheduled for tomorrow afternoon.",
      },
    ],
    media: [],
    visitCount: 0,
  },
  {
    id: "prop-108",
    flatNumber: "Sector 2, Villa 18",
    societyName: "Amanora Park Town",
    locality: "Hadapsar",
    city: "Pune",
    preference: "Sale",
    furnishingStatus: "Furnished",
    propertyType: "Villa",
    area: 2800,
    areaType: "Built-up",
    bedroomCount: 4,
    bathroomCount: 4,
    balconyCount: 2,
    price: 32000000,
    priceFormatted: "₹3.20 Cr",
    amenities: ["Private Lawn", "Gated Security", "Solar Water"],
    constructionStatus: "Ready to Move",
    ownerName: "Nitin Gadre",
    ownerMobile: "+91 98200 00089",
    keyHolder: {
      name: "Security Post 3",
      mobile: "+91 98200 00090",
      persona: "Guard",
      notes: "Entry with identity card",
    },
    validationStatus: "Mandate Declined",
    availabilityStatus: "Temporarily Unavailable",
    isActiveSupply: false,
    currentDisposition: "Owner Declines Mandate",
    callHistory: [
      {
        id: "call-p8",
        calledAt: "2026-10-17 11:45 AM",
        callerName: "Pooja Sharma",
        disposition: "Owner Declines Mandate",
        notes: "Owner selling directly to a relative. Unwilling to pay broker commission or list with agency.",
      },
    ],
    media: [],
    visitCount: 0,
  },
];

export const INITIAL_LEADS: Lead[] = [
  {
    id: "lead-201",
    name: "Amit Singhania",
    primaryPhone: "+91 98200 11223",
    email: "amit.singhania@email.com",
    status: "Active",
    unreachableCount: 0,
    originalSource: "99acres",
    sourceCreatedAt: "2026-10-18 09:40 AM",
    assignedTelecaller: "Pooja Sharma",
    advertisedPropertyRef: "DLF Camellias 4BHK (Ad ID: 99A-84920)",
    advertisedPropertyVerified: true,
    advertisedPropertyNotes: "Enquired on Camellias ad. Confirmed during call that budget is up to ₹2.6 Cr, open to Sector 108 Sobha City or Phase 5.",
    requirements: {
      minBudget: 22000000,
      maxBudget: 26000000,
      budgetFormatted: "₹2.20 Cr - ₹2.60 Cr",
      city: "Gurgaon",
      localities: ["Sector 108", "Golf Course Road", "DLF Phase 5"],
      societies: ["Sobha City", "DLF Phase 5"],
      bedroomConfigurations: ["3 BHK", "4 BHK"],
      preference: "Sale",
      propertyTypes: ["Apartment"],
      targetArea: 2100,
      isConfirmed: true,
    },
    currentDisposition: "Connected",
    callHistory: [
      {
        id: "call-l1",
        calledAt: "2026-10-18 11:00 AM",
        callerName: "Pooja Sharma",
        disposition: "Connected",
        notes: "Qualified buyer. Works in Cyber City senior management. Pre-approved loan with HDFC. Looking to close within 45 days.",
      },
      {
        id: "call-l1b",
        calledAt: "2026-10-21 02:30 PM",
        callerName: "Pooja Sharma",
        disposition: "Connected",
        notes: "Shared Sobha City 3 BHK summary. Client confirmed interest; site visit scheduled for Saturday 11:30 AM with sales agent Rahul Varma.",
      },
    ],
    topMatches: [
      {
        id: "prop-102",
        score: 100,
        societyName: "Sobha City",
        bedroomCount: 3,
        area: 2050,
        areaType: "Super built-up",
        priceFormatted: "₹2.45 Cr",
        preference: "Sale",
        locality: "Sector 108, Gurgaon",
      },
      {
        id: "prop-101",
        score: 60,
        societyName: "DLF The Camellias",
        bedroomCount: 4,
        area: 7400,
        areaType: "Super built-up",
        priceFormatted: "₹28.50 Cr", // Outside budget window
        preference: "Sale",
        locality: "Golf Course Road, Gurgaon",
      },
      {
        id: "prop-105",
        score: 40,
        societyName: "Prestige Lakeside",
        bedroomCount: 3,
        area: 1850,
        areaType: "Built-up",
        priceFormatted: "₹1.95 Cr",
        preference: "Sale",
        locality: "Whitefield, Bangalore", // Different city
      },
    ],
    siteVisitHistory: [
      {
        date: "2026-10-22",
        propertySociety: "Sobha City (Flat 602)",
        outcome: "Scheduled (Tomorrow 11:30 AM)",
        agentName: "Rahul Varma",
      },
      {
        date: "2026-10-15",
        propertySociety: "DLF The Crest",
        outcome: "Visit Done (Client felt rent was too high, wants to buy)",
        agentName: "Rahul Varma",
      },
    ],
  },
  {
    id: "lead-202",
    name: "Neha Deshmukh",
    primaryPhone: "+91 98330 22334",
    email: "neha.deshmukh@email.com",
    status: "Active",
    unreachableCount: 0,
    originalSource: "Magicbricks",
    sourceCreatedAt: "2026-10-19 01:15 PM",
    assignedTelecaller: "Pooja Sharma",
    advertisedPropertyRef: "Hiranandani Powai 2BHK (MB-7712)",
    advertisedPropertyVerified: true,
    advertisedPropertyNotes: "Verified enquiry on 2BHK Castle Rock. Husband works in L&T Powai. Requires 2 BHK furnished flat.",
    requirements: {
      minBudget: 75000,
      maxBudget: 100000,
      budgetFormatted: "₹75,000 - ₹1.00 Lakh / mo",
      city: "Mumbai",
      localities: ["Powai", "Hiranandani Gardens"],
      societies: ["Hiranandani Castle Rock"],
      bedroomConfigurations: ["2 BHK"],
      preference: "Rent",
      propertyTypes: ["Apartment"],
      targetArea: 1000,
      isConfirmed: true,
    },
    currentDisposition: "Connected",
    callHistory: [
      {
        id: "call-l2",
        calledAt: "2026-10-19 03:00 PM",
        callerName: "Pooja Sharma",
        disposition: "Connected",
        notes: "Confirmed genuine tenant. Transferring from Pune office next month. Needs immediate possession by 1st of next month.",
      },
    ],
    topMatches: [
      {
        id: "prop-103",
        score: 100,
        societyName: "Hiranandani Castle Rock",
        bedroomCount: 2,
        area: 1050,
        areaType: "Carpet",
        priceFormatted: "₹85,000 / mo",
        preference: "Rent",
        locality: "Powai, Mumbai",
      },
      {
        id: "prop-104",
        score: 40,
        societyName: "DLF Phase 5 Villa",
        bedroomCount: 3,
        area: 3200,
        areaType: "Built-up",
        priceFormatted: "₹1.10 Lakh / mo",
        preference: "Rent",
        locality: "Golf Course Road, Gurgaon", // City mismatch
      },
    ],
    siteVisitHistory: [
      {
        date: "2026-10-23",
        propertySociety: "Hiranandani Castle Rock (Flat 1204)",
        outcome: "Tentative (Awaiting Owner Confirmation)",
        agentName: "Rahul Varma",
      },
    ],
  },
  {
    id: "lead-203",
    name: "Vikramaditya Rao",
    primaryPhone: "+91 98450 33445",
    email: "vikram.rao@email.com",
    status: "Not Yet Validated",
    unreachableCount: 0,
    originalSource: "NoBroker",
    sourceCreatedAt: "2026-10-21 08:30 AM",
    assignedTelecaller: "Pooja Sharma",
    advertisedPropertyRef: "Prestige Lakeside 3BHK",
    advertisedPropertyVerified: false,
    requirements: {
      minBudget: 18000000,
      maxBudget: 21000000,
      budgetFormatted: "₹1.80 Cr - ₹2.10 Cr",
      city: "Bangalore",
      localities: ["Whitefield"],
      societies: ["Prestige Lakeside Habitat"],
      bedroomConfigurations: ["3 BHK"],
      preference: "Sale",
      propertyTypes: ["Apartment"],
      isConfirmed: false,
    },
    currentDisposition: "Call Back",
    callHistory: [
      {
        id: "call-l3",
        calledAt: "2026-10-21 11:15 AM",
        callerName: "Pooja Sharma",
        disposition: "Call Back",
        notes: "Buyer was in a meeting. Requested callback today after 5:30 PM.",
        callbackDate: "2026-10-22 05:30 PM",
      },
    ],
    topMatches: [
      {
        id: "prop-105",
        score: 100,
        societyName: "Prestige Lakeside",
        bedroomCount: 3,
        area: 1850,
        areaType: "Built-up",
        priceFormatted: "₹1.95 Cr",
        preference: "Sale",
        locality: "Whitefield, Bangalore",
      },
    ],
    siteVisitHistory: [],
  },
  {
    id: "lead-204",
    name: "Gaurav Mehta",
    primaryPhone: "+91 99100 44556",
    status: "Not Yet Validated",
    unreachableCount: 2,
    originalSource: "Website Enquiry",
    sourceCreatedAt: "2026-10-20 06:10 PM",
    assignedTelecaller: "Pooja Sharma",
    advertisedPropertyVerified: false,
    requirements: {
      minBudget: 12000000,
      maxBudget: 15000000,
      budgetFormatted: "₹1.20 Cr - ₹1.50 Cr",
      city: "Noida",
      localities: ["Sector 43", "Sector 44"],
      societies: ["Godrej Woods"],
      bedroomConfigurations: ["2 BHK"],
      preference: "Sale",
      propertyTypes: ["Apartment"],
      isConfirmed: false,
    },
    currentDisposition: "Ringing / Not Answering",
    callHistory: [
      {
        id: "call-l4a",
        calledAt: "2026-10-21 10:00 AM",
        callerName: "Pooja Sharma",
        disposition: "Ringing / Not Answering",
        notes: "First attempt: phone rang without answer.",
      },
      {
        id: "call-l4b",
        calledAt: "2026-10-22 02:00 PM",
        callerName: "Pooja Sharma",
        disposition: "Ringing / Not Answering",
        notes: "Second attempt: no response. One attempt remaining before lead can be marked Inactive.",
      },
    ],
    topMatches: [
      {
        id: "prop-107",
        score: 100,
        societyName: "Godrej Woods",
        bedroomCount: 2,
        area: 1250,
        areaType: "Carpet",
        priceFormatted: "₹1.35 Cr",
        preference: "Sale",
        locality: "Sector 43, Noida",
      },
    ],
    siteVisitHistory: [],
  },
  {
    id: "lead-205",
    name: "Priya Sundaram",
    primaryPhone: "+91 98710 55667",
    status: "Inactive",
    unreachableCount: 0,
    originalSource: "Magicbricks",
    sourceCreatedAt: "2026-10-15 11:20 AM",
    assignedTelecaller: "Pooja Sharma",
    advertisedPropertyVerified: true,
    requirements: {
      minBudget: 100000,
      maxBudget: 140000,
      budgetFormatted: "₹1.00 Lakh - ₹1.40 Lakh / mo",
      city: "Gurgaon",
      localities: ["Golf Course Road"],
      societies: ["DLF Phase 5"],
      bedroomConfigurations: ["3 BHK"],
      preference: "Rent",
      propertyTypes: ["Villa", "Apartment"],
      isConfirmed: false,
    },
    currentDisposition: "Buyer / Tenant Says Not Looking",
    callHistory: [
      {
        id: "call-l5",
        calledAt: "2026-10-16 04:00 PM",
        callerName: "Pooja Sharma",
        disposition: "Buyer / Tenant Says Not Looking",
        notes: "Client renewed existing lease with current landlord. Not looking for property anymore. Marked inactive per rule.",
      },
    ],
    topMatches: [],
    siteVisitHistory: [],
  },
];

export const INITIAL_SITE_VISITS: SiteVisit[] = [
  {
    id: "visit-301",
    buyerId: "lead-201",
    buyerName: "Amit Singhania",
    buyerPhone: "+91 98200 11223",
    assignedSalesAgent: "Rahul Varma",
    telecallerName: "Pooja Sharma",
    scheduledDate: "Tomorrow, 23 Oct 2026",
    timeSlot: "11:30 AM - 01:30 PM",
    status: "Confirmed",
    items: [
      {
        id: "item-1",
        propertyId: "prop-102",
        propertyTitle: "Sobha City (3 BHK, 2,050 sq.ft)",
        locality: "Sector 108",
        city: "Gurgaon",
        flatNumber: "Block C, Flat 602",
        ownerName: "Rameshwar Kulkarni",
        ownerMobile: "+91 98220 00023",
        keyHolder: {
          name: "Security Guard Gate 2",
          mobile: "+91 98220 00024",
          persona: "Guard",
          notes: "Guard has keys at gate post",
        },
        status: "Pending",
        enteredBy: "Pooja Sharma",
        entryChannel: "Telecaller on Behalf",
      },
      {
        id: "item-2",
        propertyId: "prop-101",
        propertyTitle: "DLF The Camellias (4 BHK, 7,400 sq.ft)",
        locality: "Golf Course Road",
        city: "Gurgaon",
        flatNumber: "Tower 2, Flat 1401",
        ownerName: "Harishankar Singhania",
        ownerMobile: "+91 98110 00012",
        keyHolder: {
          name: "Ramdas (Concierge)",
          mobile: "+91 98110 00013",
          persona: "Maintenance Office",
          notes: "Key at clubhouse reception",
        },
        status: "Pending",
        enteredBy: "Pooja Sharma",
        entryChannel: "Telecaller on Behalf",
      },
    ],
    scheduleHistory: [
      {
        changedAt: "2026-10-21 04:30 PM",
        previousTime: "Saturday 10:00 AM",
        newTime: "Saturday 11:30 AM",
        reason: "Buyer requested 90-minute delay due to school event",
        recordedBy: "Rahul Varma (Field Agent)",
      },
    ],
  },
  {
    id: "visit-302",
    buyerId: "lead-202",
    buyerName: "Neha Deshmukh",
    buyerPhone: "+91 98330 22334",
    assignedSalesAgent: "Rahul Varma",
    telecallerName: "Pooja Sharma",
    scheduledDate: "Friday, 24 Oct 2026",
    timeSlot: "03:00 PM - 04:00 PM",
    status: "Tentative - Awaiting Owner",
    items: [
      {
        id: "item-3",
        propertyId: "prop-103",
        propertyTitle: "Hiranandani Castle Rock (2 BHK, 1,050 sq.ft)",
        locality: "Powai",
        city: "Mumbai",
        flatNumber: "Tower 5, Flat 1204",
        ownerName: "Sunita Agarwal",
        ownerMobile: "+91 98330 00034",
        keyHolder: {
          name: "Mrs. Deshpande (1203)",
          mobile: "+91 98330 00035",
          persona: "Neighbour",
        },
        status: "Pending",
        enteredBy: "Pooja Sharma",
        entryChannel: "Telecaller on Behalf",
      },
    ],
    scheduleHistory: [],
  },
  {
    id: "visit-303",
    buyerId: "lead-201",
    buyerName: "Amit Singhania",
    buyerPhone: "+91 98200 11223",
    assignedSalesAgent: "Rahul Varma",
    telecallerName: "Pooja Sharma",
    scheduledDate: "15 Oct 2026",
    timeSlot: "04:30 PM - 05:30 PM",
    status: "Completed",
    telecallerConfirmedAt: "2026-10-15 06:45 PM",
    telecallerConfirmedBy: "Pooja Sharma",
    items: [
      {
        id: "item-4",
        propertyId: "prop-106",
        propertyTitle: "DLF The Crest (3 BHK, 2,600 sq.ft)",
        locality: "Sector 54",
        city: "Gurgaon",
        flatNumber: "Tower B, Flat 301",
        ownerName: "Dr. Alok Nath",
        ownerMobile: "+91 98110 00067",
        keyHolder: {
          name: "Owner in Delhi",
          mobile: "+91 98110 00067",
          persona: "Owner",
        },
        status: "Visit Done",
        reportedBy: "Rahul Varma",
        enteredBy: "Rahul Varma",
        entryChannel: "Field Agent Direct",
        reportedAt: "2026-10-15 05:40 PM",
        agentNotes: "Client liked construction quality but feels rent is non-feasible. Explicitly asked to look for purchase inventory instead.",
        hasVoiceNote: true,
        voiceNoteDuration: "0:48 min",
        buyerFeedback: "Prefers buying over renting in Gurgaon. Budget ₹2.5 Cr.",
        buyerInterest: "Low",
      },
    ],
    scheduleHistory: [],
  },
];

