"use client";

import React, { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { Lead, CallLogItem } from "@/types/crm";
import { useSession } from "@/lib/auth-client";

interface LeadValidationClientProps {
  initialLeads: Lead[];
}

export function LeadValidationClient({ initialLeads }: LeadValidationClientProps) {
  const { data: session } = useSession();
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(initialLeads[0] || null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [preferenceFilter, setPreferenceFilter] = useState("All");
  const [bhkFilter, setBhkFilter] = useState("All");

  // Call Logging state
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callDisposition, setCallDisposition] = useState("Connected");
  const [callNotes, setCallNotes] = useState("");
  const [callbackTime, setCallbackTime] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filtered Leads
  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      // Search
      const searchMatch =
        lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.primaryPhone.includes(searchTerm) ||
        lead.requirements.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.requirements.localities.some((l) =>
          l.toLowerCase().includes(searchTerm.toLowerCase())
        );

      if (!searchMatch) return false;

      // Status
      if (statusFilter !== "All" && lead.status !== statusFilter) {
        return false;
      }

      // Preference
      if (preferenceFilter !== "All" && lead.requirements.preference !== preferenceFilter) {
        return false;
      }

      // BHK
      if (bhkFilter !== "All") {
        const matchesBhk = lead.requirements.bedroomConfigurations.some((b) =>
          b.includes(bhkFilter)
        );
        if (!matchesBhk) return false;
      }

      return true;
    });
  }, [leads, searchTerm, statusFilter, preferenceFilter, bhkFilter]);

  const handleOpenCallModal = () => {
    if (!selectedLead) return;
    setCallDisposition(selectedLead.currentDisposition || "Connected");
    setCallNotes("");
    setCallbackTime("");
    setIsCallModalOpen(true);
  };

  const handleSaveCallOutcome = () => {
    if (!selectedLead) return;

    const callerName = session?.user?.name
      ? `${session.user.name} (${(session.user as { role?: string }).role?.replace("_", " ") || "Telecaller"})`
      : "Telecaller";

    const newLogItem: CallLogItem = {
      id: `call-lead-${Date.now()}`,
      calledAt: "Just now",
      callerName,
      disposition: callDisposition,
      notes: callNotes || "Demand qualification call logged.",
      callbackDate: callbackTime || undefined,
    };

    let newStatus = selectedLead.status;
    let newUnreachable = selectedLead.unreachableCount;

    if (callDisposition === "Buyer / Tenant Says Not Looking") {
      newStatus = "Inactive";
    } else if (callDisposition === "Ringing / Not Answering") {
      newUnreachable += 1;
      if (newUnreachable >= 3) {
        newStatus = "Inactive";
      }
    } else if (callDisposition === "Connected") {
      newUnreachable = 0;
    }

    const updatedLead: Lead = {
      ...selectedLead,
      status: newStatus,
      unreachableCount: newUnreachable,
      currentDisposition: callDisposition,
      callHistory: [newLogItem, ...selectedLead.callHistory],
    };

    setLeads((prev) => prev.map((l) => (l.id === updatedLead.id ? updatedLead : l)));
    setSelectedLead(updatedLead);
    setIsCallModalOpen(false);

    setToastMessage(`Call outcome logged for ${selectedLead.name}: ${callDisposition}`);
  };

  const handleMarkLeadActive = () => {
    if (!selectedLead) return;

    const updatedLead: Lead = {
      ...selectedLead,
      status: "Active",
      requirements: {
        ...selectedLead.requirements,
        isConfirmed: true,
      },
      advertisedPropertyVerified: true,
    };

    setLeads((prev) => prev.map((l) => (l.id === updatedLead.id ? updatedLead : l)));
    setSelectedLead(updatedLead);
    setToastMessage(`${selectedLead.name} marked ACTIVE. Top matching properties available.`);
  };

  const handleShareProperty = (propName: string) => {
    setToastMessage(`Property details for ${propName} shared with ${selectedLead?.name}.`);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-crm-border">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-crm-text">
                Demand / Lead Validation
              </h2>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-stone-100 text-crm-muted border border-crm-border">
                {filteredLeads.length} Leads
              </span>
            </div>
            <p className="text-xs text-crm-muted mt-1">
              Verify buyer and tenant preferences, qualify source ad inquiries, and maintain 3-attempt calling limits (PRD §5).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setToastMessage("Lead import via CSV template is ready.")}
              className="px-3 py-1.5 text-xs font-medium rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 shadow-2xs"
            >
              📥 Ingest Portal Leads
            </button>
            <button
              onClick={() => setToastMessage("Manual lead intake form is ready.")}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
            >
              + Add Lead
            </button>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="p-4 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
            {/* Search Input */}
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Search Name, Phone, Locality
              </label>
              <input
                type="text"
                placeholder="e.g. Amit, 9810, Gurgaon, Golf Course..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Lead Status (PRD §5.6)
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">All Lead Statuses</option>
                <option value="Not Yet Validated">Not Yet Validated</option>
                <option value="Active">Active (Qualified)</option>
                <option value="Inactive">Inactive (Dead / 3 Attempts)</option>
              </select>
            </div>

            {/* Preference */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Preference (Sale / Rent)
              </label>
              <select
                value={preferenceFilter}
                onChange={(e) => setPreferenceFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">Buy & Rent</option>
                <option value="Sale">Buy (Sale Only)</option>
                <option value="Rent">Rent Only</option>
              </select>
            </div>

            {/* BHK Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                BHK Required
              </label>
              <select
                value={bhkFilter}
                onChange={(e) => setBhkFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">Any BHK</option>
                <option value="2 BHK">2 BHK</option>
                <option value="3 BHK">3 BHK</option>
                <option value="4 BHK">4 BHK</option>
              </select>
            </div>
          </div>
        </div>

        {/* Master-Detail Architecture: Compact Table on Top, 3-Column Inspector Below */}
        <div className="space-y-6">
          {/* Leads List Table */}
          <div className="rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
            <div className="px-4 py-2.5 bg-stone-50 border-b border-crm-border text-xs font-semibold text-crm-text flex items-center justify-between">
              <span>Assigned Caller Queue</span>
              <span className="text-crm-muted font-normal text-[11px]">Click any lead to load the 3-column qualification workspace below</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50/50 border-b border-crm-border text-crm-muted uppercase tracking-wider font-semibold text-[10px]">
                  <tr>
                    <th className="px-4 py-2.5">Buyer / Prospect</th>
                    <th className="px-3 py-2.5">Budget & Preference</th>
                    <th className="px-3 py-2.5">Target Localities</th>
                    <th className="px-3 py-2.5">Source & Ad Reference</th>
                    <th className="px-3 py-2.5">Lead Status</th>
                    <th className="px-3 py-2.5">Current Disposition</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-crm-border">
                  {leads.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-crm-muted">
                        <div className="max-w-sm mx-auto space-y-1">
                          <p className="font-semibold text-crm-text text-sm">No leads found</p>
                          <p className="text-xs text-crm-muted">
                            Ingest leads via CSV or use &quot;+ Add Lead&quot; to begin qualification.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : filteredLeads.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-crm-muted">
                        No leads found matching current filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredLeads.map((lead) => {
                      const isSelected = selectedLead?.id === lead.id;
                      return (
                        <tr
                          key={lead.id}
                          onClick={() => setSelectedLead(lead)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? "bg-teal-50/60 font-medium" : "hover:bg-stone-50/70"
                          }`}
                        >
                          <td className="px-4 py-2.5">
                            <div className="font-bold text-crm-text">{lead.name}</div>
                            <div className="text-[11px] text-crm-muted">{lead.primaryPhone}</div>
                          </td>

                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-crm-text">{lead.requirements.budgetFormatted}</div>
                            <StatusBadge status={lead.requirements.preference} />
                          </td>

                          <td className="px-3 py-2.5 text-crm-muted">
                            <div>{lead.requirements.city}</div>
                            <div className="text-[11px] truncate max-w-[150px]">
                              {lead.requirements.localities.join(", ")}
                            </div>
                          </td>

                          <td className="px-3 py-2.5 text-crm-muted">
                            <div className="font-medium text-crm-text">{lead.originalSource}</div>
                            <div className="text-[11px] truncate max-w-[150px]">{lead.advertisedPropertyRef || "Direct Search"}</div>
                          </td>

                          <td className="px-3 py-2.5">
                            <StatusBadge status={lead.status} />
                          </td>

                          <td className="px-3 py-2.5">
                            <StatusBadge status={lead.currentDisposition} />
                          </td>

                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedLead(lead);
                                handleOpenCallModal();
                              }}
                              className="px-2.5 py-1 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                            >
                              Call
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* PRD Three-Column Detail Page Workspace (§5.7) */}
          {selectedLead ? (
            <div className="rounded-lg bg-crm-surface border border-crm-border shadow-xs overflow-hidden">
              {/* Workspace Header */}
              <div className="px-6 py-3.5 bg-stone-50 border-b border-crm-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-crm-primary/10 text-crm-primary flex items-center justify-center font-bold text-sm">
                    {selectedLead.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-crm-text">
                        {selectedLead.name}
                      </h3>
                      <StatusBadge status={selectedLead.status} />
                      <StatusBadge status={selectedLead.requirements.preference} />
                    </div>
                    <p className="text-xs text-crm-muted">
                      Mobile: {selectedLead.primaryPhone} • Source: {selectedLead.originalSource} ({selectedLead.sourceCreatedAt})
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedLead.status === "Not Yet Validated" && (
                    <button
                      onClick={handleMarkLeadActive}
                      className="px-3 py-1.5 text-xs font-bold rounded bg-crm-success text-white hover:bg-emerald-700 shadow-2xs"
                    >
                      ✓ Activate Lead (Confirm Search)
                    </button>
                  )}
                  <button
                    onClick={handleOpenCallModal}
                    className="px-3.5 py-1.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs flex items-center gap-1.5"
                  >
                    <span>📞</span> Initiate / Record Call
                  </button>
                </div>
              </div>

              {/* Three Columns Container */}
              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-crm-border text-xs">
                {/* COLUMN 1: Buyer Details & Requirements (Left) */}
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-crm-border pb-2">
                    <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                      1. Buyer Details & Requirements
                    </h4>
                    <span className="text-[10px] text-crm-muted">PRD §5.7 Left</span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <span className="text-crm-muted text-[11px] block">Target Budget Range</span>
                      <strong className="text-crm-text text-sm">{selectedLead.requirements.budgetFormatted}</strong>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-crm-muted text-[11px] block">Target City</span>
                        <strong className="text-crm-text">{selectedLead.requirements.city}</strong>
                      </div>
                      <div>
                        <span className="text-crm-muted text-[11px] block">Transaction Preference</span>
                        <strong className="text-crm-text">{selectedLead.requirements.preference} (Mandatory Hard Gate)</strong>
                      </div>
                    </div>

                    <div>
                      <span className="text-crm-muted text-[11px] block">Preferred Localities</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selectedLead.requirements.localities.map((loc, i) => (
                          <span key={i} className="px-2 py-0.5 rounded bg-stone-100 text-crm-text font-medium text-[11px] border border-crm-border">
                            {loc}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span className="text-crm-muted text-[11px] block">Bedroom Configurations</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selectedLead.requirements.bedroomConfigurations.map((bhk, i) => (
                          <span key={i} className="px-2 py-0.5 rounded bg-stone-100 text-crm-text font-medium text-[11px] border border-crm-border">
                            {bhk}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span className="text-crm-muted text-[11px] block">Acceptable Property Types</span>
                      <span className="text-crm-text font-medium">{selectedLead.requirements.propertyTypes.join(", ")}</span>
                    </div>

                    {/* Advertised Enquiry Verification Section (PRD §5.1) */}
                    <div className="p-3 rounded border border-crm-border bg-stone-50/60 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-crm-text text-[11px]">Original Ad Enquiry Verification</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${selectedLead.advertisedPropertyVerified ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                          {selectedLead.advertisedPropertyVerified ? "Verified by Caller" : "Unverified"}
                        </span>
                      </div>
                      <div className="text-crm-muted text-[11px]">
                        <strong>Ad Reference:</strong> {selectedLead.advertisedPropertyRef || "Direct portal registration"}
                      </div>
                      {selectedLead.advertisedPropertyNotes && (
                        <p className="text-[11px] text-crm-text italic mt-1">
                          &quot;{selectedLead.advertisedPropertyNotes}&quot;
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* COLUMN 2: Calling Controls & History (Middle) */}
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-crm-border pb-2">
                    <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                      2. Calling Controls & History
                    </h4>
                    <span className="text-[10px] text-crm-muted">PRD §5.7 Middle</span>
                  </div>

                  {/* Calling Status Summary */}
                  <div className="p-3 rounded border border-crm-border bg-stone-50 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-crm-muted uppercase font-bold block">Current Disposition</span>
                      <StatusBadge status={selectedLead.currentDisposition} />
                    </div>
                    <div>
                      <span className="text-[10px] text-crm-muted uppercase font-bold block">Unsuccessful Attempts</span>
                      <span className="font-bold text-crm-text">{selectedLead.unreachableCount} / 3 Max</span>
                    </div>
                  </div>

                  {/* Quick Action Button */}
                  <button
                    onClick={handleOpenCallModal}
                    className="w-full py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs text-center flex items-center justify-center gap-2"
                  >
                    <span>📞</span> Log Qualification Call
                  </button>

                  {/* Call Attempt History Timeline */}
                  <div className="space-y-2.5">
                    <span className="font-bold text-crm-text text-[11px] block">
                      Call History Log ({selectedLead.callHistory.length})
                    </span>

                    {selectedLead.callHistory.map((call) => (
                      <div
                        key={call.id}
                        className="p-2.5 rounded border border-crm-border bg-stone-50/40 space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <StatusBadge status={call.disposition} />
                          <span className="text-[10px] text-crm-muted">{call.calledAt}</span>
                        </div>
                        <p className="text-crm-text text-[11px] leading-snug">{call.notes}</p>
                        {call.callbackDate && (
                          <div className="text-amber-800 text-[10px] font-semibold">
                            ⏰ Callback: {call.callbackDate}
                          </div>
                        )}
                        <div className="text-[10px] text-crm-muted">Caller: {call.callerName}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* COLUMN 3: Matching Properties & Visit History (Right) */}
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-crm-border pb-2">
                    <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                      3. Top Matches & Visit History
                    </h4>
                    <span className="text-[10px] text-crm-muted">PRD §5.7 Right</span>
                  </div>

                  {/* Top 3 Active Properties */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-crm-text text-[11px]">
                        Top Matching Active Inventory
                      </span>
                      <span className="text-[10px] text-crm-muted">Ranked by score %</span>
                    </div>

                    {selectedLead.topMatches.length === 0 ? (
                      <div className="p-4 rounded border border-crm-border text-center text-crm-muted">
                        No active matching inventory currently available.
                      </div>
                    ) : (
                      selectedLead.topMatches.map((match) => (
                        <div
                          key={match.id}
                          className="p-3 rounded border border-crm-border bg-stone-50/50 hover:bg-stone-50 transition-all space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-crm-text text-xs">
                              {match.societyName}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${match.score >= 80 ? "bg-emerald-100 text-emerald-800 border border-emerald-200" : "bg-amber-100 text-amber-800 border border-amber-200"}`}>
                              {match.score}% Match
                            </span>
                          </div>

                          <div className="text-crm-muted text-[11px] flex items-center justify-between">
                            <span>{match.bedroomCount} BHK • {match.area} sq.ft</span>
                            <strong className="text-crm-text">{match.priceFormatted}</strong>
                          </div>

                          <div className="text-[11px] text-crm-muted truncate">
                            {match.locality}
                          </div>

                          <div className="pt-1.5 border-t border-crm-border flex items-center justify-between">
                            <span className="text-[10px] text-crm-muted">Sale vs Rent: Exactly Matched</span>
                            <button
                              onClick={() => handleShareProperty(match.societyName)}
                              className="px-2 py-0.5 text-[10px] font-semibold rounded bg-crm-surface border border-crm-border text-crm-link hover:underline"
                            >
                              Share with Buyer ↗
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Historical Site Visits Shown to This Buyer */}
                  <div className="space-y-2 pt-2 border-t border-crm-border">
                    <span className="font-bold text-crm-text text-[11px] block">
                      Properties Shown on Site Visits ({selectedLead.siteVisitHistory.length})
                    </span>

                    {selectedLead.siteVisitHistory.length === 0 ? (
                      <div className="text-crm-muted italic text-[11px] p-2 bg-stone-50 rounded border border-crm-border text-center">
                        No prior site visits conducted for this buyer.
                      </div>
                    ) : (
                      selectedLead.siteVisitHistory.map((v, i) => (
                        <div key={i} className="p-2.5 rounded border border-crm-border bg-stone-50/30 text-[11px] space-y-0.5">
                          <div className="flex items-center justify-between font-bold text-crm-text">
                            <span>{v.propertySociety}</span>
                            <span className="text-crm-muted text-[10px]">{v.date}</span>
                          </div>
                          <div className="text-crm-muted">{v.outcome}</div>
                          <div className="text-[10px] text-crm-muted">Agent: {v.agentName}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : leads.length > 0 ? (
            <div className="rounded-lg bg-crm-surface border border-crm-border p-8 text-center text-crm-muted">
              <p className="font-semibold text-crm-text text-sm">No lead selected</p>
              <p className="text-xs text-crm-muted mt-1">Select a lead from the queue above to inspect requirements and record calls.</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Modal: Log Qualification Call */}
      <Modal
        isOpen={isCallModalOpen}
        onClose={() => setIsCallModalOpen(false)}
        title={`Log Demand Call: ${selectedLead?.name || ""}`}
        subtitle={`Phone: ${selectedLead?.primaryPhone || ""} • Source: ${selectedLead?.originalSource || ""}`}
        footer={
          <>
            <button
              onClick={() => setIsCallModalOpen(false)}
              className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveCallOutcome}
              className="px-4 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs"
            >
              Save Call Record
            </button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Calling Disposition (PRD §5.5)
            </label>
            <select
              value={callDisposition}
              onChange={(e) => setCallDisposition(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            >
              <option value="Connected">Connected (Buyer Discussed Requirements)</option>
              <option value="Call Back">Call Back (Schedule Specific Date & Time)</option>
              <option value="Ringing / Not Answering">Ringing / Not Answering (Counts as attempt)</option>
              <option value="Buyer / Tenant Says Not Looking">Buyer / Tenant Says Not Looking (Move Inactive)</option>
            </select>
          </div>

          {callDisposition === "Call Back" && (
            <div>
              <label className="block font-semibold text-crm-text mb-1">
                Scheduled Callback Date & Time
              </label>
              <input
                type="text"
                placeholder="e.g. 2026-10-23 04:30 PM"
                value={callbackTime}
                onChange={(e) => setCallbackTime(e.target.value)}
                className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              />
            </div>
          )}

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Call Notes & Confirmed Requirements
            </label>
            <textarea
              rows={3}
              placeholder="Record verified budget, preferred sectors, timeline to purchase, loan status..."
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            />
          </div>

          <div className="p-3 rounded bg-amber-50/60 border border-amber-200 text-amber-900 text-[11px]">
            <strong>PRD Status Rule:</strong> &quot;Connected&quot; is an attempt outcome, not an automatic activation. Mark lead Active using the button on the workspace header once all mandatory requirements are captured.
          </div>
        </div>
      </Modal>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </AppShell>
  );
}

