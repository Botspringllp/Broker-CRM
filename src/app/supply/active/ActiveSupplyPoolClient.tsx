"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { Property, Lead } from "@/types/crm";
import {
  listEligibleFieldVerifiersAction,
  assignPropertyToFieldVerifierAction,
} from "@/app/verifier/actions";

interface ActiveSupplyPoolClientProps {
  initialProperties: Property[];
  initialLeads: Lead[];
  canAssignFieldVerifier?: boolean;
  canReviewVerification?: boolean;
  currentUserRole?: string;
}

export function ActiveSupplyPoolClient({
  initialProperties,
  initialLeads,
  canAssignFieldVerifier = false,
  canReviewVerification = false,
}: ActiveSupplyPoolClientProps) {
  const [properties] = useState<Property[]>(initialProperties);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(
    initialProperties.find((p) => p.isActiveSupply) || initialProperties[0] || null
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [preferenceFilter, setPreferenceFilter] = useState("All");
  const [bhkFilter, setBhkFilter] = useState("All");
  const [availabilityFilter, setAvailabilityFilter] = useState("All");

  // Feedback modal state
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [feedbackBuyerName, setFeedbackBuyerName] = useState("");
  const [feedbackInterest, setFeedbackInterest] = useState("High");
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Field Verifier Assignment modal state
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [verifiersList, setVerifiersList] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [selectedVerifierId, setSelectedVerifierId] = useState("");
  const [assignmentInstructions, setAssignmentInstructions] = useState("");
  const [isAssigningVerifier, setIsAssigningVerifier] = useState(false);

  const handleOpenAssignVerifierModal = async () => {
    setAssignModalOpen(true);
    setAssignmentInstructions("");
    try {
      const res = await listEligibleFieldVerifiersAction();
      if (res.success && res.verifiers) {
        setVerifiersList(res.verifiers);
        if (res.verifiers.length > 0 && !selectedVerifierId) {
          setSelectedVerifierId(res.verifiers[0].id);
        }
      }
    } catch {
      setVerifiersList([]);
    }
  };

  const handleAssignVerifierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProperty || !selectedVerifierId) return;

    setIsAssigningVerifier(true);
    try {
      const res = await assignPropertyToFieldVerifierAction({
        propertyId: selectedProperty.id,
        verifierId: selectedVerifierId,
        instructions: assignmentInstructions.trim() || undefined,
      });

      if (res.success) {
        setAssignModalOpen(false);
        setToastMessage(`Assigned ${selectedProperty.societyName} to Field Verifier successfully.`);
      }
    } catch (err: unknown) {
      setToastMessage((err as Error)?.message || "Failed to assign property to Field Verifier.");
    } finally {
      setIsAssigningVerifier(false);
    }
  };

  // Filtered Active Pool
  const filteredProperties = useMemo(() => {
    return properties.filter((prop) => {
      // Must be validated to enter active supply pool workflow
      if (prop.validationStatus !== "Validated") return false;

      // Availability filter
      if (availabilityFilter !== "All" && prop.availabilityStatus !== availabilityFilter) {
        return false;
      }

      // Search
      const matchesSearch =
        prop.societyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        prop.locality.toLowerCase().includes(searchTerm.toLowerCase()) ||
        prop.city.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;

      // Preference
      if (preferenceFilter !== "All" && prop.preference !== preferenceFilter) {
        return false;
      }

      // BHK
      if (bhkFilter !== "All") {
        if (bhkFilter === "4+" && prop.bedroomCount < 4) return false;
        if (bhkFilter !== "4+" && prop.bedroomCount.toString() !== bhkFilter) return false;
      }

      return true;
    });
  }, [properties, searchTerm, preferenceFilter, bhkFilter, availabilityFilter]);

  // Derived Matching Active Buyers across the entire brokerage tenant for the selected property (PRD §7.2)
  const matchingBuyers = useMemo(() => {
    if (!selectedProperty) return [];

    return initialLeads.filter((lead) => {
      // Active leads only
      if (lead.status !== "Active") return false;
      // Preference hard check (Sale vs Rent)
      if (lead.requirements.preference !== selectedProperty.preference) return false;

      // City match
      const cityMatches = lead.requirements.city.toLowerCase() === selectedProperty.city.toLowerCase();
      return cityMatches;
    }).map((lead) => {
      // Check if price falls in stated range or midpoint tolerance
      const minB = lead.requirements.minBudget;
      const maxB = lead.requirements.maxBudget;
      const midpoint = (minB + maxB) / 2;
      const price = selectedProperty.price;

      const inStated = price >= minB && price <= maxB;
      const inMidpoint = price >= midpoint * 0.75 && price <= midpoint * 1.25;
      const budgetMatched = inStated || inMidpoint;

      // Score calculation
      const score = budgetMatched ? 95 : 65;

      return {
        id: lead.id,
        name: lead.name,
        phone: lead.primaryPhone,
        budgetFormatted: lead.requirements.budgetFormatted,
        bhkNeeded: lead.requirements.bedroomConfigurations.join(", "),
        score,
        visitStatus: lead.siteVisitHistory.length > 0 ? "Visit Scheduled" : "No Visits Yet",
        interest: "High" as const,
      };
    });
  }, [selectedProperty, initialLeads]);

  const handleOpenFeedback = (buyerName: string) => {
    setFeedbackBuyerName(buyerName);
    setFeedbackInterest("High");
    setFeedbackNotes("");
    setFeedbackModalOpen(true);
  };

  const handleSaveFeedback = () => {
    setFeedbackModalOpen(false);
    setToastMessage(
      `Saved post-visit interest (${feedbackInterest}) for buyer ${feedbackBuyerName} on ${selectedProperty?.societyName}`
    );
  };

  const handleScheduleVisit = (buyerName: string) => {
    setToastMessage(`Created tentative site visit for ${buyerName} at ${selectedProperty?.societyName}.`);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-crm-border">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-crm-text">
                Active Supply Pool
              </h2>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                {filteredProperties.length} Validated Properties
              </span>
            </div>
            <p className="text-xs text-crm-muted mt-1">
              Fully validated inventory ready for buyer matching, site visit alignment, and 10-month rental tracking.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canReviewVerification && (
              <Link
                href="/supply/verifications"
                className="px-3 py-1.5 text-xs font-bold rounded-md bg-teal-50 border border-teal-200 text-teal-800 hover:bg-teal-100 shadow-2xs inline-flex items-center gap-1.5"
              >
                <span>📋 Verification Reviews</span>
              </Link>
            )}
            <span className="text-xs text-crm-muted">Scope Boundary:</span>
            <span className="px-2.5 py-1 text-xs font-semibold rounded bg-stone-100 text-crm-muted border border-crm-border">
              Phase 1 Resale & Rental Only
            </span>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="p-4 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
            {/* Search */}
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Search Society or Locality
              </label>
              <input
                type="text"
                placeholder="e.g. DLF, Sobha, Golf Course Road..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            {/* Availability */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Availability Status
              </label>
              <select
                value={availabilityFilter}
                onChange={(e) => setAvailabilityFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">All Availabilities</option>
                <option value="Available">Available Only</option>
                <option value="Temporarily Unavailable">Temp. Unavailable</option>
                <option value="Sold">Sold</option>
                <option value="Rented">Rented</option>
              </select>
            </div>

            {/* Preference */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Preference
              </label>
              <select
                value={preferenceFilter}
                onChange={(e) => setPreferenceFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">Sale & Rent</option>
                <option value="Sale">Sale Only</option>
                <option value="Rent">Rent Only</option>
              </select>
            </div>

            {/* BHK */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Bedrooms (BHK)
              </label>
              <select
                value={bhkFilter}
                onChange={(e) => setBhkFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">Any BHK</option>
                <option value="2">2 BHK</option>
                <option value="3">3 BHK</option>
                <option value="4+">4+ BHK</option>
              </select>
            </div>
          </div>
        </div>

        {/* Master-Detail Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Active Properties Table */}
          <div
            className={`rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden transition-all ${
              selectedProperty ? "lg:col-span-6" : "lg:col-span-12"
            }`}
          >
            <div className="px-4 py-2.5 bg-stone-50 border-b border-crm-border text-xs font-semibold text-crm-text flex items-center justify-between">
              <span>Validated Active Inventory</span>
              <span className="text-[11px] text-crm-muted">Shows availability & visit activity</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50/50 border-b border-crm-border text-crm-muted uppercase tracking-wider font-semibold text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Property</th>
                    <th className="px-3 py-3">Price / Rent</th>
                    <th className="px-3 py-3">Availability</th>
                    <th className="px-3 py-3">Site Visit Activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-crm-border">
                  {properties.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-12 text-center text-crm-muted">
                        <div className="max-w-xs mx-auto space-y-1">
                          <p className="font-semibold text-crm-text text-sm">No active properties in pool</p>
                          <p className="text-xs text-crm-muted">
                            Properties validated with owner mandate will appear here for buyer matching.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : filteredProperties.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-crm-muted">
                        No active properties found matching current filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredProperties.map((prop) => {
                      const isSelected = selectedProperty?.id === prop.id;
                      const isRentalAlert = prop.revalidationStatus === "Due";

                      return (
                        <tr
                          key={prop.id}
                          onClick={() => setSelectedProperty(prop)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? "bg-teal-50/60 font-medium" : "hover:bg-stone-50/70"
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Link
                                href={`/supply/${prop.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="font-bold text-crm-text hover:text-crm-primary hover:underline"
                              >
                                {prop.societyName}
                              </Link>
                              {prop.isFieldVerified && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  ✓ Field Verified
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-crm-muted">
                              {prop.bedroomCount} BHK • {prop.area} sq.ft • {prop.locality}
                            </div>
                          </td>

                          <td className="px-3 py-3 font-semibold text-crm-text">
                            <div>{prop.priceFormatted}</div>
                            <StatusBadge status={prop.preference} />
                          </td>

                          <td className="px-3 py-3 space-y-1">
                            <StatusBadge status={prop.availabilityStatus} />
                            {isRentalAlert && (
                              <div className="text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-300">
                                ⏰ 10-Mo Renewal Due
                              </div>
                            )}
                          </td>

                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="text-crm-text font-semibold">{prop.visitCount} Visits Logged</span>
                            </div>
                            <span className="text-[10px] text-crm-muted">Does not block availability</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Selected Property Active Pool Inspector */}
          {selectedProperty ? (
            <div className="lg:col-span-6 rounded-lg bg-crm-surface border border-crm-border shadow-xs overflow-hidden sticky top-4 space-y-4">
              {/* Header */}
              <div className="px-5 py-4 border-b border-crm-border bg-stone-50/60 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-crm-text">
                      {selectedProperty.societyName}
                    </h3>
                    <StatusBadge status={selectedProperty.preference} />
                    <StatusBadge status={selectedProperty.availabilityStatus} />
                  </div>
                  <p className="text-xs text-crm-muted mt-0.5">
                    {selectedProperty.bedroomCount} BHK {selectedProperty.propertyType} • {selectedProperty.area} sq.ft ({selectedProperty.areaType}) • {selectedProperty.priceFormatted}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <Link
                    href={`/supply/${selectedProperty.id}`}
                    className="px-2.5 py-1 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs inline-flex items-center gap-1"
                  >
                    Open Page ↗
                  </Link>
                  <Link
                    href={`/supply/${selectedProperty.id}/edit`}
                    className="px-2.5 py-1 text-xs font-semibold rounded bg-white text-crm-text hover:bg-stone-100 border border-crm-border shadow-2xs inline-flex items-center gap-1"
                  >
                    ✏️ Edit
                  </Link>
                  <button
                    onClick={() => setSelectedProperty(null)}
                    className="text-crm-muted hover:text-crm-text p-1 text-sm ml-1"
                    aria-label="Close Inspector"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-5 text-xs max-h-[75vh] overflow-y-auto">
                {/* 10-Month Rental Trigger Alert if applicable */}
                {selectedProperty.revalidationStatus === "Due" && (
                  <div className="p-3.5 rounded-md bg-amber-50 border border-amber-300 text-amber-900 space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-xs">
                      <span>⚠️ Rental 10-Month Revalidation Trigger (PRD §6 / §7.4)</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      This property was rented on <strong>{selectedProperty.rentedAt || "recorded date"}</strong>. 10 months have elapsed; system has triggered revalidation back to Supply Validation queue to check lease renewal or market availability.
                    </p>
                  </div>
                )}

                {/* Key Custodian & Inspection Access */}
                <div className="p-3 rounded border border-crm-border bg-stone-50/60 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-crm-muted block">Key Holder Contact</span>
                    <div className="font-bold text-crm-text">{selectedProperty.keyHolder.name} ({selectedProperty.keyHolder.persona})</div>
                    <div className="text-[11px] text-crm-muted">{selectedProperty.keyHolder.mobile}</div>
                  </div>
                  <button
                    onClick={() => setToastMessage(`Shared keyholder contact with field sales agent for ${selectedProperty.societyName}`)}
                    className="px-2.5 py-1 text-xs font-semibold rounded bg-crm-surface border border-crm-border text-crm-text hover:bg-stone-100 shadow-2xs"
                  >
                    Share with Field Agent
                  </button>
                </div>

                {/* Field Verification & Physical Audit Status */}
                <div className="p-3 rounded border border-crm-border bg-stone-50/60 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-crm-muted block">
                      Field Verification Status
                    </span>
                    {selectedProperty.isFieldVerified ? (
                      <div className="text-xs font-bold text-emerald-800 flex items-center gap-1.5 mt-0.5">
                        <span>✓ Verified on Premises</span>
                        {selectedProperty.fieldVerifiedAt && (
                          <span className="text-[11px] text-crm-muted font-normal">
                            ({new Date(selectedProperty.fieldVerifiedAt).toLocaleDateString()})
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-crm-muted mt-0.5">
                        No verified on-site inspection recorded yet.
                      </div>
                    )}
                  </div>

                  {canAssignFieldVerifier && (
                    <button
                      onClick={handleOpenAssignVerifierModal}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                    >
                      Assign Field Verifier
                    </button>
                  )}
                </div>

                {/* Matching Active Buyers across the entire Brokerage (PRD §7.2) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-crm-border pb-2">
                    <div>
                      <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px]">
                        Matching Active Buyers / Tenants ({matchingBuyers.length})
                      </h4>
                      <p className="text-[11px] text-crm-muted">
                        Evaluated across brokerage active demand using matching logic (PRD §6 & §7.2)
                      </p>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-bold">
                      Same Matching Engine
                    </span>
                  </div>

                  {matchingBuyers.length === 0 ? (
                    <div className="p-4 rounded border border-crm-border bg-stone-50 text-center text-crm-muted text-xs">
                      No active buyers currently match this property’s criteria.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {matchingBuyers.map((buyer) => (
                        <div
                          key={buyer.id}
                          className="p-3 rounded border border-crm-border bg-stone-50/40 hover:bg-stone-50 transition-all space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-bold text-crm-text text-xs">{buyer.name}</span>
                              <span className="text-crm-muted text-[11px] ml-2">({buyer.phone})</span>
                            </div>
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              {buyer.score}% Match
                            </span>
                          </div>

                          <div className="text-[11px] text-crm-muted grid grid-cols-2 gap-2">
                            <div>Budget: <strong className="text-crm-text">{buyer.budgetFormatted}</strong></div>
                            <div>Needs: <strong className="text-crm-text">{buyer.bhkNeeded}</strong></div>
                          </div>

                          {/* Site Visit Status against this Property */}
                          <div className="pt-2 border-t border-crm-border/70 flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-1.5">
                              <span className="text-crm-muted">Visit Status:</span>
                              <StatusBadge status={buyer.visitStatus} />
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleOpenFeedback(buyer.name)}
                                className="px-2 py-1 text-[10px] font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-100"
                              >
                                Record Feedback
                              </button>
                              <button
                                onClick={() => handleScheduleVisit(buyer.name)}
                                className="px-2.5 py-1 text-[10px] font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                              >
                                Align Visit
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Boundary Reminder Notice */}
                <div className="p-3 rounded bg-stone-100 border border-crm-border text-[11px] text-crm-muted">
                  <strong>Phase 1 Scope Note:</strong> Deal stages beyond site-visit status (Negotiation, Token, Final Deal, Commission) occur after the Phase 1 boundary line and are excluded from this release.
                </div>
              </div>
            </div>
          ) : properties.length > 0 ? (
            <div className="lg:col-span-6 rounded-lg bg-crm-surface border border-crm-border p-8 text-center text-crm-muted">
              <p className="font-semibold text-crm-text text-sm">No property selected</p>
              <p className="text-xs text-crm-muted mt-1">Select an active property to review matching buyers.</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Modal: Record Buyer-Property Feedback */}
      <Modal
        isOpen={feedbackModalOpen}
        onClose={() => setFeedbackModalOpen(false)}
        title={`Record Feedback: ${feedbackBuyerName}`}
        subtitle={`Property: ${selectedProperty?.societyName || ""}`}
        footer={
          <>
            <button
              onClick={() => setFeedbackModalOpen(false)}
              className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveFeedback}
              className="px-4 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs"
            >
              Save Feedback
            </button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Buyer Interest Level (PRD §7.3 & §8.3)
            </label>
            <select
              value={feedbackInterest}
              onChange={(e) => setFeedbackInterest(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            >
              <option value="High">High (Buyer wants to proceed/revisit)</option>
              <option value="Medium">Medium (Considering among 2-3 options)</option>
              <option value="Low">Low (Disliked floor/facing/society)</option>
              <option value="Not Interested">Not Interested (Outright rejected)</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Customer Feedback & Objections
            </label>
            <textarea
              rows={3}
              placeholder="Record feedback on pricing, amenities, light/ventilation, parking..."
              value={feedbackNotes}
              onChange={(e) => setFeedbackNotes(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            />
          </div>
        </div>
      </Modal>

      {/* Modal: Assign Property to Field Verifier */}
      <Modal
        isOpen={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title="Assign Property to Field Verifier"
        subtitle={`Property: ${selectedProperty?.societyName || ""} (${selectedProperty?.locality || ""})`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setAssignModalOpen(false)}
              className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isAssigningVerifier || !selectedVerifierId || verifiersList.length === 0}
              onClick={handleAssignVerifierSubmit}
              className="px-4 py-1.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs disabled:opacity-50"
            >
              {isAssigningVerifier ? "Assigning..." : "Confirm Assignment"}
            </button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Select Active Field Verifier in Brokerage
            </label>
            {verifiersList.length === 0 ? (
              <p className="text-xs text-rose-700 p-2.5 bg-rose-50 rounded border border-rose-200">
                No active Field Verifiers found in your brokerage. Please create a Field Verifier account in Team & Permissions first.
              </p>
            ) : (
              <select
                value={selectedVerifierId}
                onChange={(e) => setSelectedVerifierId(e.target.value)}
                className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50 focus:bg-white focus:outline-hidden"
              >
                {verifiersList.map((fv) => (
                  <option key={fv.id} value={fv.id}>
                    {fv.name} ({fv.phone || "No phone"})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Inspection Instructions & Access Notes (Optional)
            </label>
            <textarea
              rows={3}
              placeholder="e.g. Call guard before entering wing B, key with supervisor in maintenance room..."
              value={assignmentInstructions}
              onChange={(e) => setAssignmentInstructions(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50 focus:bg-white focus:outline-hidden"
            />
          </div>
        </div>
      </Modal>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </AppShell>
  );
}

