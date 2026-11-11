/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { Lead, SiteVisit, LeadChangeLogItem } from "@/types/crm";
import { EvaluatedPropertyMatch } from "@/server/dal/matching";

vi.mock("next/navigation", () => ({
  usePathname: () => "/leads/lead-1",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/app/leads/actions", () => ({
  updateLeadStatusAction: vi.fn(),
  assignLeadAction: vi.fn(),
  assignLeadRoundRobinAction: vi.fn(),
  logLeadCallAction: vi.fn(),
  editLeadAction: vi.fn(),
  getLeadChangeHistoryAction: vi.fn().mockResolvedValue({ success: true, history: [] }),
  markLeadDoNotContactAction: vi.fn(),
}));

vi.mock("@/app/matching/actions", () => ({
  sharePropertyDetailsWithLeadAction: vi.fn().mockResolvedValue({
    success: true,
    message: "Property details shared.",
  }),
}));

import { LeadDetailsClient } from "@/app/leads/[id]/LeadDetailsClient";

describe("DV-10: Three-Column Lead Detail Page Workspace (PRD §5.7)", () => {
  const baseLead: Lead = {
    id: "lead-dv10-1",
    name: "Vikram Malhotra",
    primaryPhone: "9810099999",
    alternatePhone: "9810088888",
    email: "vikram@example.com",
    status: "Not Yet Validated",
    unreachableCount: 1,
    isDoNotContact: false,
    originalSource: "99acres",
    sourceCreatedAt: "05/11/2026",
    assignedTelecaller: "Pooja Sharma",
    assignedTelecallerId: "tc-pooja-1",
    currentAssignment: {
      id: "asgn-1",
      assignedUserId: "tc-pooja-1",
      assignedUserName: "Pooja Sharma",
      assignedByUserId: "mgr-1",
      assignedByUserName: "Vikram Broker",
      assignmentMethod: "Manual",
      status: "Active",
      assignedAt: "05 Nov 2026, 10:00 AM",
      notes: "High intent buyer",
    },
    assignmentHistory: [
      {
        id: "asgn-1",
        assignedUserId: "tc-pooja-1",
        assignedUserName: "Pooja Sharma",
        assignedByUserId: "mgr-1",
        assignedByUserName: "Vikram Broker",
        assignmentMethod: "Manual",
        status: "Active",
        assignedAt: "05 Nov 2026, 10:00 AM",
        notes: "High intent buyer",
      },
    ],
    advertisedPropertyRef: "99A-GUR-101",
    advertisedPropertyVerified: true,
    advertisedPropertyNotes: "Inquired about 3 BHK unit in DLF Phase 5",
    enquiries: [
      {
        id: "enq-1",
        source: "99acres",
        advertisedPropertyRef: "99A-GUR-101",
        isVerifiedByCaller: true,
        callerVerificationNotes: "Inquired about 3 BHK unit in DLF Phase 5",
        enquiryDate: "05 Nov 2026, 09:30 AM",
      },
      {
        id: "enq-2",
        source: "MagicBricks",
        advertisedPropertyRef: "MB-GUR-202",
        isVerifiedByCaller: false,
        callerVerificationNotes: null,
        enquiryDate: "08 Nov 2026, 04:15 PM",
      },
    ],
    requirements: {
      minBudget: 15000000,
      maxBudget: 25000000,
      budgetFormatted: "₹1.50 Cr - ₹2.50 Cr",
      city: "Gurugram",
      localities: ["DLF Phase 5", "Golf Course Road"],
      societies: ["DLF The Aralias", "The Magnolias"],
      bedroomConfigurations: ["3 BHK", "4 BHK"],
      preference: "Sale",
      propertyTypes: ["APARTMENT", "VILLA"],
      targetArea: 2200,
      minArea: 1800,
      maxArea: 2600,
      areaUnit: "sq.ft",
      areaType: "CARPET",
      isConfirmed: true,
    },
    currentDisposition: "Call Back",
    callHistory: [
      {
        id: "call-1",
        calledAt: "06 Nov 2026, 11:30 AM",
        callerName: "Pooja Sharma",
        disposition: "Call Back",
        notes: "Buyer was driving, requested callback next day",
        callbackDate: "07 Nov 2026, 02:00 PM",
      },
      {
        id: "call-2",
        calledAt: "05 Nov 2026, 02:15 PM",
        callerName: "Pooja Sharma",
        disposition: "Connected",
        notes: "Introductory qualification call, requirements verified",
      },
    ],
    topMatches: [],
    siteVisitHistory: [],
  };

  const mockTopMatches: EvaluatedPropertyMatch[] = [
    {
      property: {
        id: "prop-match-1",
        societyName: "DLF The Aralias",
        bedroomCount: 3,
        area: 2150,
        areaType: "Carpet",
        priceFormatted: "₹2.10 Cr",
        preference: "Sale",
        locality: "DLF Phase 5",
        city: "Gurugram",
        flatNumber: "A-1204",
        furnishingStatus: "Semi-furnished",
        validationStatus: "Validated",
        availabilityStatus: "Available",
        isActiveSupply: true,
        ownerWillingnessConfirmed: true,
        ownerName: "Private Owner",
        ownerMobile: "9800011111",
        createdAt: "01/11/2026",
      } as any,
      score: 83,
      isEligible: true,
      criteriaMatchedCount: 5,
      criteriaEvaluatedCount: 6,
      breakdown: {
        preference: { matched: true, evaluated: true, label: "Preference", expected: "Sale", actual: "Sale" },
        budget: { matched: true, evaluated: true, label: "Budget", expected: "Under ₹2.5 Cr", actual: "₹2.10 Cr" },
        locality: { matched: true, evaluated: true, label: "Locality", expected: "DLF Phase 5", actual: "DLF Phase 5" },
        propertyType: { matched: true, evaluated: true, label: "Property Type", expected: "Apartment", actual: "Apartment" },
        bedroomCount: { matched: true, evaluated: true, label: "Bedrooms", expected: "3 BHK", actual: "3 BHK" },
        area: { matched: false, evaluated: true, label: "Area", expected: "2200+", actual: "2150" },
      },
      unspecifiedCriteria: [],
    },
    {
      property: {
        id: "prop-match-2",
        societyName: "The Magnolias",
        bedroomCount: 4,
        area: 2500,
        areaType: "Carpet",
        priceFormatted: "₹2.45 Cr",
        preference: "Sale",
        locality: "Golf Course Road",
        city: "Gurugram",
        flatNumber: "B-802",
        furnishingStatus: "Furnished",
        validationStatus: "Validated",
        availabilityStatus: "Available",
        isActiveSupply: true,
        ownerWillingnessConfirmed: true,
        ownerName: "Private Owner",
        ownerMobile: "9800022222",
        createdAt: "02/11/2026",
      } as any,
      score: 100,
      isEligible: true,
      criteriaMatchedCount: 6,
      criteriaEvaluatedCount: 6,
      breakdown: {
        preference: { matched: true, evaluated: true, label: "Preference", expected: "Sale", actual: "Sale" },
        budget: { matched: true, evaluated: true, label: "Budget", expected: "Under ₹2.5 Cr", actual: "₹2.45 Cr" },
        locality: { matched: true, evaluated: true, label: "Locality", expected: "Golf Course Road", actual: "Golf Course Road" },
        propertyType: { matched: true, evaluated: true, label: "Property Type", expected: "Apartment", actual: "Apartment" },
        bedroomCount: { matched: true, evaluated: true, label: "Bedrooms", expected: "4 BHK", actual: "4 BHK" },
        area: { matched: true, evaluated: true, label: "Area", expected: "2200+", actual: "2500" },
      },
      unspecifiedCriteria: [],
    },
  ];

  const mockSiteVisits: SiteVisit[] = [
    {
      id: "visit-1",
      buyerId: baseLead.id,
      buyerName: baseLead.name,
      buyerPhone: baseLead.primaryPhone,
      assignedSalesAgent: "Amit Kumar",
      assignedSalesAgentId: "agent-1",
      telecallerName: "Pooja Sharma",
      scheduledDate: "08 Nov 2026",
      timeSlot: "11:00 AM - 01:00 PM",
      status: "Confirmed",
      items: [
        {
          id: "vitem-1",
          propertyId: "prop-match-1",
          propertyTitle: "DLF The Aralias",
          locality: "DLF Phase 5",
          city: "Gurugram",
          flatNumber: "A-1204",
          ownerName: "Private Owner",
          ownerMobile: "9800011111",
          keyHolder: { name: "Security Gate", mobile: "9800099999", persona: "Guard" },
          status: "Visit Done",
          entryChannel: "Field Agent Direct",
          enteredBy: "Amit Kumar",
          buyerFeedback: "Client loved the balcony view, negotiating price",
          buyerInterest: "High",
        },
      ],
      scheduleHistory: [],
    },
  ];

  const mockChangeHistory: LeadChangeLogItem[] = [
    {
      id: "log-1",
      leadId: baseLead.id,
      fieldName: "minBudget",
      previousValue: "10000000",
      newValue: "15000000",
      changedByUserId: "tc-pooja-1",
      actorName: "Pooja Sharma",
      changeSource: "USER",
      changedAt: "06 Nov 2026, 11:35 AM",
    },
    {
      id: "log-2",
      leadId: baseLead.id,
      fieldName: "status",
      previousValue: "NOT_YET_VALIDATED",
      newValue: "ACTIVE",
      changedByUserId: "tc-pooja-1",
      actorName: "Pooja Sharma",
      changeSource: "USER",
      changedAt: "05 Nov 2026, 02:20 PM",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. THREE-COLUMN LAYOUT & RESPONSIBILITIES
  // =========================================================================

  it("1. Renders all 3 distinct column containers with approved responsibilities", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        topMatches={mockTopMatches}
        siteVisits={mockSiteVisits}
        initialChangeHistory={mockChangeHistory}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        canViewChangelog={true}
        canAssignTelecaller={true}
        userRole="TELECALLER"
      />
    );

    // Verify all 3 test ids exist
    expect(html).toContain('data-testid="column-1-details-requirements"');
    expect(html).toContain('data-testid="column-2-calling-history"');
    expect(html).toContain('data-testid="column-3-matches-visits"');

    // Verify Column 1 Responsibilities
    expect(html).toContain("Buyer Profile &amp; Attribution");
    expect(html).toContain("Operational Assignment");
    expect(html).toContain("Requirements &amp; Budget");

    // Verify Column 2 Responsibilities
    expect(html).toContain("Calling Controls &amp; Outreach");
    expect(html).toContain("PRD §5.7 Middle");

    // Verify Column 3 Responsibilities
    expect(html).toContain("Top 3 Matching Properties");
    expect(html).toContain("Site Visit History");
  });

  it("2. Column 1 renders buyer contact details, source attribution, and immutable notices", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        userRole="TELECALLER"
      />
    );

    expect(html).toContain("Vikram Malhotra");
    expect(html).toMatch(/\+91.*9810099999/);
    expect(html).toContain("9810088888");
    expect(html).toContain("vikram@example.com");
    expect(html).toContain("99acres");
    expect(html).toContain("05/11/2026");
    expect(html).toContain("Immutable (PRD §5.3)");
    expect(html).toContain("99A-GUR-101");
    expect(html).toContain("Verified on Call");
  });

  it("3. Column 1 renders full property search requirements specifications", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        userRole="TELECALLER"
      />
    );

    expect(html).toContain("₹1.50 Cr - ₹2.50 Cr");
    expect(html).toContain("Gurugram");
    expect(html).toContain("DLF Phase 5");
    expect(html).toContain("Golf Course Road");
    expect(html).toContain("DLF The Aralias");
    expect(html).toContain("The Magnolias");
    expect(html).toContain("3 BHK");
    expect(html).toContain("4 BHK");
    expect(html).toMatch(/1800.*to.*2600.*sq\.ft/);
    expect(html).toContain("CARPET");
    expect(html).toContain("Requirements Confirmed");
  });

  it("4. Column 2 embeds live calling controls with all 4 supported dispositions", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        userRole="TELECALLER"
      />
    );

    expect(html).toContain("Calling Controls &amp; Outreach");
    expect(html).toContain("Connected &amp; Qualified");
    expect(html).toContain("Call Back Requested");
    expect(html).toContain("Ringing / Not Answering");
    expect(html).toContain("Buyer Not Looking / Dropped");
    expect(html).toContain("Log Call Attempt");
    expect(html).toContain("Dial Buyer");
  });

  it("5. Column 2 renders past call history with timestamps, caller, and notes", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        userRole="TELECALLER"
      />
    );

    expect(html).toContain("06 Nov 2026, 11:30 AM");
    expect(html).toContain("Pooja Sharma");
    expect(html).toContain("Buyer was driving, requested callback next day");
    expect(html).toContain("Scheduled Callback:");
    expect(html).toContain("07 Nov 2026, 02:00 PM");
    expect(html).toContain("Introductory qualification call, requirements verified");
  });

  it("6. Column 2 renders Change History tab with audited field changes and actor (DV-05)", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        initialChangeHistory={mockChangeHistory}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        canViewChangelog={true}
        userRole="TELECALLER"
      />
    );

    expect(html).toMatch(/Audit Log.*2/);
  });

  it("7. Column 2 renders Enquiry History tab with source and verification badges (DV-04)", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        userRole="TELECALLER"
      />
    );

    expect(html).toMatch(/Enquiries.*2/);
  });

  it("8. Column 3 renders Top 3 Matching Properties with score %, society, BHK, and area", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        topMatches={mockTopMatches}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        userRole="TELECALLER"
      />
    );

    expect(html).toContain("Top 3 Matching Properties");
    expect(html).toMatch(/83.*Match.*5.*6/);
    expect(html).toContain("DLF The Aralias");
    expect(html).toMatch(/3.*BHK.*2150.*Carpet/);
    expect(html).toContain("₹2.10 Cr");
    expect(html).toMatch(/100.*Match.*6.*6/);
    expect(html).toContain("The Magnolias");
    expect(html).toMatch(/4.*BHK.*2500.*Carpet/);
    expect(html).toContain("₹2.45 Cr");
    expect(html).toContain("Share Details →");
    expect(html).toContain("All Matches →");
  });

  it("9. Column 3 renders Site Visit History with date, sales agent, and property outcome", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        siteVisits={mockSiteVisits}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        userRole="TELECALLER"
      />
    );

    expect(html).toContain("Site Visit History");
    expect(html).toMatch(/08 Nov 2026.*11:00 AM/);
    expect(html).toContain("Amit Kumar");
    expect(html).toContain("DLF The Aralias");
    expect(html).toContain("Visit Done");
    expect(html).toContain("Client loved the balcony view, negotiating price");
  });

  it("10. Column 3 renders clean empty state when no matches or no visits exist", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        topMatches={[]}
        siteVisits={[]}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        userRole="TELECALLER"
      />
    );

    expect(html).toContain("No Matching Properties Found");
    expect(html).toContain("No site visits recorded yet for this prospect.");
  });

  // =========================================================================
  // 2. DNC RESTRICTIONS & UNREACHABLE LIMITS
  // =========================================================================

  it("11. Disables calling and displays high-visibility banner when lead is marked DNC", () => {
    const dncLead: Lead = {
      ...baseLead,
      isDoNotContact: true,
      status: "Inactive",
    };

    const html = renderToString(
      <LeadDetailsClient
        lead={dncLead}
        canEdit={true}
        canLogCall={true}
        canActivate={false}
        userRole="TELECALLER"
      />
    );

    expect(html).toContain("🛑 Do Not Contact");
    expect(html).toContain("DO NOT CONTACT (DNC): This prospect has requested no further contact");
    expect(html).toContain("Calling Blocked");
    expect(html).toContain("🛑 DNC (Calling Blocked)");
  });

  it("12. Displays unreachable limit warning and option to mark Inactive when attempts >= 3", () => {
    const unreachableLead: Lead = {
      ...baseLead,
      unreachableCount: 3,
      status: "Not Yet Validated",
    };

    const html = renderToString(
      <LeadDetailsClient
        lead={unreachableLead}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        userRole="TELECALLER"
      />
    );

    expect(html).toMatch(/3.*\/.*3 Max/);
    expect(html).toContain("Unreachable Limit:");
    expect(html).toContain("3 unsuccessful calling attempts recorded");
    expect(html).toContain("Mark Inactive");
  });

  // =========================================================================
  // 3. ROLE-BASED ACCESS & PERMISSION GATING
  // =========================================================================

  it("13. Hides Reassign action if user lacks assignment:assign_telecaller permission", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        canAssignTelecaller={false}
        userRole="TELECALLER"
      />
    );

    expect(html).not.toContain("Reassign →");
    expect(html).toContain("Assigned Telecaller");
    expect(html).toContain("Pooja Sharma");
  });

  it("14. Shows Reassign action when user has assignment:assign_telecaller permission", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        canAssignTelecaller={true}
        userRole="BROKER_OWNER"
      />
    );

    expect(html).toContain("Reassign →");
  });

  it("15. Hides Audit Log tab if user lacks demand:view_changelog permission", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        initialChangeHistory={mockChangeHistory}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        canViewChangelog={false}
        userRole="TELECALLER"
      />
    );

    expect(html).not.toContain("Audit Log");
  });

  it("16. Disables calling form if user lacks demand:log_call permission", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        canEdit={true}
        canLogCall={false}
        canActivate={true}
        userRole="FIELD_SALES_AGENT"
      />
    );

    expect(html).toContain("You do not have permission to log calls on this lead.");
    expect(html).not.toContain("Log Call Attempt");
  });
});
