/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { Lead } from "@/types/crm";

vi.mock("next/navigation", () => ({
  usePathname: () => "/leads",
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
  createLeadAction: vi.fn(),
  logLeadCallAction: vi.fn(),
  updateLeadStatusAction: vi.fn(),
  markLeadDoNotContactAction: vi.fn(),
  getPendingCallbacksAction: vi.fn().mockResolvedValue({ success: true, callbacks: [] }),
  getLeadChangeHistoryAction: vi.fn().mockResolvedValue({ success: true, changelog: [] }),
}));

import { PendingCallbacksCompact } from "@/components/leads/PendingCallbacksCompact";
import { LeadValidationClient } from "@/app/leads/LeadValidationClient";
import { LeadQualifyClient } from "@/app/leads/[id]/qualify/LeadQualifyClient";
import { LeadDetailsClient } from "@/app/leads/[id]/LeadDetailsClient";

describe("DV-07: Calling UI Integration Tests", () => {
  const baseLead: Lead = {
    id: "lead-ui-1",
    name: "Rajesh Khanna",
    primaryPhone: "9810012345",
    status: "Not Yet Validated",
    unreachableCount: 0,
    isDoNotContact: false,
    originalSource: "MagicBricks",
    sourceCreatedAt: "10/11/2026",
    assignedTelecaller: "Aarti Sharma",
    advertisedPropertyRef: "MB-GUR-402",
    advertisedPropertyVerified: false,
    advertisedPropertyNotes: "",
    requirements: {
      minBudget: 10000000,
      maxBudget: 20000000,
      budgetFormatted: "₹1.00 Cr - ₹2.00 Cr",
      city: "Gurugram",
      localities: ["Sector 54", "Golf Course Road"],
      societies: ["DLF Phase 5"],
      bedroomConfigurations: ["3 BHK"],
      preference: "Sale",
      propertyTypes: ["APARTMENT"],
      isConfirmed: false,
    },
    enquiries: [
      {
        id: "enq-1",
        source: "MagicBricks",
        advertisedPropertyRef: "MB-GUR-402",
        isVerifiedByCaller: false,
        callerVerificationNotes: null,
        enquiryDate: "10 Nov 2026, 10:00 AM",
      },
    ],
    currentDisposition: "Not Called",
    callHistory: [
      {
        id: "call-1",
        calledAt: "10 Nov 2026, 02:30 PM",
        callerName: "Aarti Sharma",
        disposition: "Connected",
        notes: "Intro call completed",
        callbackDate: "11 Nov 2026, 11:00 AM",
      },
    ],
    topMatches: [],
    siteVisitHistory: [],
  };

  // 1. PendingCallbacksCompact UI
  it("renders PendingCallbacksCompact with toggle header and queue label", () => {
    const html = renderToString(<PendingCallbacksCompact defaultOpen={true} />);

    expect(html).toContain("Pending Callbacks Queue");
    expect(html).toContain("Due Today");
    expect(html).toContain("Overdue");
    expect(html).toContain("Upcoming");
    expect(html).toContain("All Timeframes");
  });

  // 2. LeadValidationClient: DNC display and blocked calling
  it("renders DNC badge and blocks calling buttons for DNC leads on LeadValidationClient", () => {
    const dncLead: Lead = {
      ...baseLead,
      id: "lead-dnc-1",
      name: "Suresh Raina",
      isDoNotContact: true,
      status: "Inactive",
    };

    const html = renderToString(<LeadValidationClient initialLeads={[dncLead]} />);

    // DNC badge displayed in table
    expect(html).toContain("DNC");
    // Action column shows disabled DNC badge instead of Call link
    expect(html).toContain("Calling blocked: Prospect marked Do Not Contact");
    // Workspace displays DNC alert banner
    expect(html).toContain("Do Not Contact (DNC): Prospect requested no further contact");
  });

  // 3. LeadValidationClient: Unreachable attempt warning and manual inactivation
  it("renders unreachable threshold warning when attempts >= 3 on LeadValidationClient", () => {
    const unreachableLead: Lead = {
      ...baseLead,
      unreachableCount: 3,
      status: "Not Yet Validated",
    };

    const html = renderToString(<LeadValidationClient initialLeads={[unreachableLead]} />);

    // Table displays attempt count
    expect(html).toMatch(/3.*attempts/);
    // Warning banner displayed per PRD §5.5
    expect(html).toContain("Unreachable Threshold Reached");
    expect(html).toContain("caller may mark this lead Inactive");
    expect(html).toContain("Mark Lead Inactive");
  });

  // 4. LeadQualifyClient: DNC alert and disabled calling controls
  it("renders DNC alert and blocks outgoing calling on LeadQualifyClient", () => {
    const dncLead: Lead = {
      ...baseLead,
      isDoNotContact: true,
      status: "Inactive",
    };

    const html = renderToString(<LeadQualifyClient lead={dncLead} />);

    expect(html).toContain("DO NOT CONTACT (DNC)");
    expect(html).toContain("Calling Blocked");
    expect(html).toContain("disabled");
  });

  // 5. LeadQualifyClient: Permitted follow-up banner
  it("renders permitted follow-up banner when lead is Inactive post Buyer Not Looking", () => {
    const inactiveLead: Lead = {
      ...baseLead,
      status: "Inactive",
      callHistory: [
        {
          id: "call-nl",
          calledAt: "05 Nov 2026, 11:00 AM",
          callerName: "Aarti",
          disposition: "Buyer Says Not Looking",
          notes: "Dropped search",
        },
      ],
    };

    const html = renderToString(<LeadQualifyClient lead={inactiveLead} />);

    expect(html).toContain("One Later Follow-up Permitted");
    expect(html).toContain("PRD §5.5 allows exactly ONE follow-up call");
  });

  // 6. LeadQualifyClient: Follow-up exhausted warning
  it("renders follow-up limit reached warning when permitted follow-up has already been used", () => {
    const exhaustedLead: Lead = {
      ...baseLead,
      status: "Inactive",
      callHistory: [
        {
          id: "call-followup",
          calledAt: "08 Nov 2026, 04:00 PM",
          callerName: "Aarti",
          disposition: "Connected",
          notes: "Single permitted follow-up call",
        },
        {
          id: "call-nl",
          calledAt: "05 Nov 2026, 11:00 AM",
          callerName: "Aarti",
          disposition: "Buyer Says Not Looking",
          notes: "Dropped search",
        },
      ],
    };

    const html = renderToString(<LeadQualifyClient lead={exhaustedLead} />);

    expect(html).toContain("Follow-up Limit Reached");
    expect(html).toContain("Calling Blocked");
  });

  // 7. LeadQualifyClient: Advertised enquiry verification controls
  it("renders advertised enquiry verification controls in LeadQualifyClient", () => {
    const html = renderToString(<LeadQualifyClient lead={baseLead} />);

    expect(html).toContain("Advertised Enquiry Verification");
    expect(html).toContain("Verified by caller");
    expect(html).toContain("Caller verification notes");
    expect(html).toContain("MB-GUR-402");
  });

  // 8. LeadDetailsClient: DNC status, calling metrics, and call history timestamps
  it("renders DNC status, attempt count, and full datetime call history in LeadDetailsClient", () => {
    const html = renderToString(
      <LeadDetailsClient
        lead={baseLead}
        canEdit={true}
        canLogCall={true}
        canActivate={true}
        userRole="TELECALLER"
      />
    );

    expect(html).toContain("10 Nov 2026, 02:30 PM");
    expect(html).toContain("11 Nov 2026, 11:00 AM");
    expect(html).toContain("Qualify / Log Call");
  });

  it("renders DNC indicator and blocks log call button in LeadDetailsClient when lead is DNC", () => {
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
    expect(html).toContain("🛑 DNC (Calling Blocked)");
    expect(html).toContain("DO NOT CONTACT (DNC): This prospect has requested no further contact");
  });
});
