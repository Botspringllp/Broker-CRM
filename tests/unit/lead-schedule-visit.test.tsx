/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { Lead, SiteVisit } from "@/types/crm";

vi.mock("next/navigation", () => ({
  usePathname: () => "/leads/lead-1",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
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

vi.mock("@/app/visits/actions", () => ({
  createSiteVisitAction: vi.fn(),
  recordVisitItemOutcomeAction: vi.fn(),
  confirmSiteVisitAction: vi.fn(),
  confirmSiteVisitOwnerAvailabilityAction: vi.fn(),
}));

import { LeadDetailsClient } from "@/app/leads/[id]/LeadDetailsClient";
import {
  ScheduleVisitModal,
  AvailablePropertyItem,
  SalesAgentItem,
  AvailableLeadItem,
} from "@/components/visits/ScheduleVisitModal";
import { createSiteVisitAction } from "@/app/visits/actions";

describe("DV-12 Phase 3: Direct Scheduling from Lead Detail Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseLead: Lead = {
    id: "lead-dv12-1",
    name: "Vikram Malhotra",
    primaryPhone: "9810099999",
    alternatePhone: "9810088888",
    email: "vikram@example.com",
    status: "Active",
    currentDisposition: "CONNECTED",
    unreachableCount: 0,
    isDoNotContact: false,
    originalSource: "99acres",
    sourceCreatedAt: "05/11/2026",
    assignedTelecaller: "Pooja Sharma",
    assignedTelecallerId: "tc-pooja-1",
    advertisedPropertyVerified: true,
    topMatches: [],
    siteVisitHistory: [],
    requirements: {
      minBudget: 15000000,
      maxBudget: 25000000,
      budgetFormatted: "₹1.50 Cr - ₹2.50 Cr",
      city: "Gurugram",
      localities: ["DLF Phase 5"],
      societies: ["The Camellias"],
      bedroomConfigurations: ["3 BHK"],
      preference: "Sale",
      propertyTypes: ["Apartment / High-rise"],
      isConfirmed: true,
      confirmedAt: "06 Nov 2026, 11:00 AM",
    },
    callHistory: [],
  };

  const mockTopMatches: any[] = [
    {
      property: {
        id: "prop-camellias-101",
        societyName: "The Camellias",
        flatNumber: "1001",
        bedroomCount: 3,
        area: 2800,
        areaType: "Super built-up",
        price: 22000000,
        priceFormatted: "₹2.20 Cr",
        preference: "Sale",
        locality: "DLF Phase 5",
        city: "Gurugram",
        currentDisposition: "Mandate",
        ownerName: "Deepak Gupta",
        ownerMobile: "9811122233",
        ownerWillingnessConfirmed: true,
        keyHolder: { persona: "Other", name: "Ramesh", mobile: "9811144455" },
        amenities: ["Clubhouse", "Gym", "Pool"],
        callHistory: [],
      },
      score: 95,
      isEligible: true,
      criteriaMatchedCount: 5,
      criteriaEvaluatedCount: 5,
      breakdown: {
        preference: { evaluated: true, matched: true, details: "Sale matches Sale", label: "Transaction Type", expected: "Sale", actual: "Sale" },
        budget: { evaluated: true, matched: true, details: "Within budget", label: "Budget", expected: "₹1.50 Cr - ₹2.50 Cr", actual: "₹2.20 Cr" },
        locality: { evaluated: true, matched: true, details: "DLF Phase 5", label: "Locality", expected: "DLF Phase 5", actual: "DLF Phase 5" },
        bedroomCount: { evaluated: true, matched: true, details: "3 BHK matches", label: "BHK", expected: "3 BHK", actual: "3 BHK" },
        propertyType: { evaluated: true, matched: true, details: "Apartment", label: "Property Type", expected: "Apartment", actual: "Apartment" },
      },
      unspecifiedCriteria: [],
    },
  ];

  const mockAvailableProperties: AvailablePropertyItem[] = [
    {
      id: "prop-camellias-101",
      societyName: "The Camellias",
      flatNumber: "1001",
      bedroomCount: 3,
      localityName: "DLF Phase 5",
    },
    {
      id: "prop-magnolias-202",
      societyName: "The Magnolias",
      flatNumber: "202",
      bedroomCount: 4,
      localityName: "Golf Course Road",
    },
  ];

  const mockSalesAgents: SalesAgentItem[] = [
    { id: "agent-1", name: "Rahul Sales", email: "rahul@apexrealty.in" },
    { id: "agent-2", name: "Anil Agent", email: "anil@apexrealty.in" },
  ];

  const mockAvailableLeads: AvailableLeadItem[] = [
    { id: "lead-dv12-1", name: "Vikram Malhotra", primaryPhone: "9810099999" },
    { id: "lead-2", name: "Rohit Verma", primaryPhone: "9820011111" },
  ];

  // =========================================================================
  // 1. LEAD DETAIL PAGE ACTIONS & GATING
  // =========================================================================

  it("1. Renders Schedule Visit action on top matching property cards when canScheduleVisits is true", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        topMatches={mockTopMatches}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        canViewMatches={true}
        canScheduleVisits={true}
        availableProperties={mockAvailableProperties}
        salesAgents={mockSalesAgents}
        userRole="TELECALLER"
      />
    );

    expect(html).toContain("Schedule Visit");
    expect(html).toContain("Share Details →");
    expect(html).toContain("The Camellias");
  });

  it("2. Hides Schedule Visit action on matching cards when canScheduleVisits is false", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        topMatches={mockTopMatches}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        canViewMatches={true}
        canScheduleVisits={false}
        availableProperties={mockAvailableProperties}
        salesAgents={mockSalesAgents}
        userRole="FIELD_VERIFIER"
      />
    );

    expect(html).not.toContain("Schedule Visit");
    expect(html).toContain("Share Details →");
  });

  it("3. Renders + Schedule Visit button in Site Visit History card header when canScheduleVisits is true", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        topMatches={mockTopMatches}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        canViewMatches={true}
        canScheduleVisits={true}
        availableProperties={mockAvailableProperties}
        salesAgents={mockSalesAgents}
        userRole="TELECALLER"
      />
    );

    expect(html).toContain("+ Schedule Visit");
    expect(html).toContain("Site Visit History");
    expect(html).toContain("All Visits →");
  });

  it("4. Hides + Schedule Visit button in Site Visit History header when canScheduleVisits is false", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        topMatches={mockTopMatches}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        canViewMatches={true}
        canScheduleVisits={false}
        availableProperties={mockAvailableProperties}
        salesAgents={mockSalesAgents}
        userRole="FIELD_VERIFIER"
      />
    );

    expect(html).not.toContain("+ Schedule Visit");
    expect(html).toContain("Site Visit History");
  });

  // =========================================================================
  // 2. SHARED MODAL: LEAD IDENTIFICATION & INITIAL SELECTION
  // =========================================================================

  it("5. ScheduleVisitModal displays pre-selected prospect buyer info when opened from Lead Detail", () => {
    const html = renderToString(
      <ScheduleVisitModal
        isOpen={true}
        onClose={vi.fn()}
        leadId="lead-dv12-1"
        leadName="Vikram Malhotra"
        leadPhone="9810099999"
        initialPropertyIds={["prop-camellias-101"]}
        availableProperties={mockAvailableProperties}
        salesAgents={mockSalesAgents}
      />
    );

    expect(html).toContain("Vikram Malhotra");
    expect(html).toContain("9810099999");
    expect(html).toContain("Current Lead");
    expect(html).toMatch(/The Camellias.*1001/);
    expect(html).toMatch(/Stop #.*1/);
  });

  it("6. ScheduleVisitModal displays prospect selection dropdown when leadId is omitted (/visits page)", () => {
    const html = renderToString(
      <ScheduleVisitModal
        isOpen={true}
        onClose={vi.fn()}
        availableLeads={mockAvailableLeads}
        availableProperties={mockAvailableProperties}
        salesAgents={mockSalesAgents}
      />
    );

    expect(html).toContain("Select Prospect Lead");
    expect(html).toContain("-- Choose Prospect --");
    expect(html).toMatch(/Vikram Malhotra.*9810099999/);
    expect(html).toMatch(/Rohit Verma.*9820011111/);
    expect(html).not.toContain("Current Lead");
  });

  // =========================================================================
  // 3. MULTI-PROPERTY SELECTION & ITINERARY ORDERING
  // =========================================================================

  it("7. ScheduleVisitModal renders all active supply pool properties and highlights multi-property stops", () => {
    const html = renderToString(
      <ScheduleVisitModal
        isOpen={true}
        onClose={vi.fn()}
        leadId="lead-dv12-1"
        leadName="Vikram Malhotra"
        leadPhone="9810099999"
        initialPropertyIds={["prop-camellias-101", "prop-magnolias-202"]}
        availableProperties={mockAvailableProperties}
        salesAgents={mockSalesAgents}
      />
    );

    expect(html).toMatch(/Selected.*2/);
    expect(html).toMatch(/Stop #.*1/);
    expect(html).toMatch(/Stop #.*2/);
    expect(html).toMatch(/The Camellias.*1001/);
    expect(html).toMatch(/The Magnolias.*202/);
  });

  it("8. ScheduleVisitModal supports initially empty property selection from Site Visit History header", () => {
    const html = renderToString(
      <ScheduleVisitModal
        isOpen={true}
        onClose={vi.fn()}
        leadId="lead-dv12-1"
        leadName="Vikram Malhotra"
        leadPhone="9810099999"
        initialPropertyIds={[]}
        availableProperties={mockAvailableProperties}
        salesAgents={mockSalesAgents}
      />
    );

    expect(html).toMatch(/Selected.*0/);
    expect(html).not.toContain("Stop #1");
    expect(html).toMatch(/The Camellias.*1001/);
    expect(html).toMatch(/The Magnolias.*202/);
  });

  // =========================================================================
  // 4. ACTION SUBMISSION & WORKFLOW
  // =========================================================================

  it("9. Submits site visit creation through createSiteVisitAction and reports success", async () => {
    const mockVisit: SiteVisit = {
      id: "visit-new-1",
      buyerId: "lead-dv12-1",
      buyerName: "Vikram Malhotra",
      buyerPhone: "9810099999",
      assignedSalesAgent: "Rahul Sales",
      assignedSalesAgentId: "agent-1",
      telecallerName: "Pooja Sharma",
      scheduledDate: "15 Nov 2026",
      timeSlot: "11:00 AM",
      status: "Tentative - Awaiting Owner",
      items: [
        {
          id: "item-1",
          propertyId: "prop-camellias-101",
          propertyTitle: "The Camellias (1001)",
          locality: "DLF Phase 5",
          city: "Gurugram",
          flatNumber: "1001",
          ownerName: "Owner",
          ownerMobile: "9811122233",
          keyHolder: { persona: "Other", name: "Ramesh", mobile: "9811144455" },
          status: "Pending",
          enteredBy: "telecaller-1",
          entryChannel: "Field Agent Direct",
        },
      ],
      scheduleHistory: [],
    };

    vi.mocked(createSiteVisitAction).mockResolvedValueOnce({
      success: true,
      visit: mockVisit,
    });

    const res = await createSiteVisitAction({
      leadId: "lead-dv12-1",
      assignedSalesAgentId: "agent-1",
      scheduledDate: "2026-11-15T11:00:00.000Z",
      propertyIds: ["prop-camellias-101"],
      notes: "Client preferred morning showing",
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.visit.id).toBe("visit-new-1");
      expect(res.visit.status).toBe("Tentative - Awaiting Owner");
      expect(res.visit.items.length).toBe(1);
    }
  });

  it("10. createSiteVisitAction returns error message when scheduling fails", async () => {
    vi.mocked(createSiteVisitAction).mockResolvedValueOnce({
      success: false,
      error: "Selected lead not found in your brokerage.",
    });

    const res = await createSiteVisitAction({
      leadId: "lead-invalid",
      assignedSalesAgentId: "agent-1",
      scheduledDate: "2026-11-15T11:00:00.000Z",
      propertyIds: ["prop-camellias-101"],
    });

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBe("Selected lead not found in your brokerage.");
    }
  });
});
