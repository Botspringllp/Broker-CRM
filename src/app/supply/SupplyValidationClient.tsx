"use client";

import React, { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { Property, CallLogItem } from "@/types/crm";
import { useSession } from "@/lib/auth-client";

interface SupplyValidationClientProps {
  initialProperties: Property[];
}

export function SupplyValidationClient({ initialProperties }: SupplyValidationClientProps) {
  const { data: session } = useSession();
  const [properties, setProperties] = useState<Property[]>(initialProperties);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [validationFilter, setValidationFilter] = useState("All");
  const [availabilityFilter, setAvailabilityFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [preferenceFilter, setPreferenceFilter] = useState("All");
  const [bhkFilter, setBhkFilter] = useState("All");

  // Call Logging Modal state
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callDisposition, setCallDisposition] = useState("Property Available");
  const [callNotes, setCallNotes] = useState("");
  const [callbackTime, setCallbackTime] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filtered Properties
  const filteredProperties = useMemo(() => {
    return properties.filter((prop) => {
      // Search
      const searchMatch =
        prop.societyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        prop.locality.toLowerCase().includes(searchTerm.toLowerCase()) ||
        prop.ownerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        prop.city.toLowerCase().includes(searchTerm.toLowerCase());

      if (!searchMatch) return false;

      // Validation Filter
      if (validationFilter !== "All" && prop.validationStatus !== validationFilter) {
        return false;
      }

      // Availability Filter
      if (availabilityFilter !== "All" && prop.availabilityStatus !== availabilityFilter) {
        return false;
      }

      // Type Filter
      if (typeFilter !== "All" && prop.propertyType !== typeFilter) {
        return false;
      }

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
  }, [properties, searchTerm, validationFilter, availabilityFilter, typeFilter, preferenceFilter, bhkFilter]);

  const handleOpenCallModal = (prop: Property) => {
    setSelectedProperty(prop);
    setCallDisposition(prop.currentDisposition || "Property Available");
    setCallNotes("");
    setCallbackTime("");
    setIsCallModalOpen(true);
  };

  const handleSaveCallOutcome = () => {
    if (!selectedProperty) return;

    const callerName = session?.user?.name
      ? `${session.user.name} (${(session.user as { role?: string }).role?.replace("_", " ") || "Caller"})`
      : "Caller (Staff)";

    const newLogItem: CallLogItem = {
      id: `call-${Date.now()}`,
      calledAt: "Just now",
      callerName,
      disposition: callDisposition,
      notes: callNotes || "Call logged via caller interface.",
      callbackDate: callbackTime || undefined,
    };

    // Determine validation status changes based on disposition
    let newValidationStatus = selectedProperty.validationStatus;
    let newAvailabilityStatus = selectedProperty.availabilityStatus;
    let newIsActiveSupply = selectedProperty.isActiveSupply;

    if (callDisposition === "Property Available") {
      newValidationStatus = "Validated";
      newAvailabilityStatus = "Available";
      newIsActiveSupply = true;
    } else if (callDisposition === "Owner Declines Mandate") {
      newValidationStatus = "Mandate Declined";
      newIsActiveSupply = false;
    } else if (callDisposition === "Property Sold or Rented") {
      newAvailabilityStatus = "Sold";
      newIsActiveSupply = false;
    } else if (callDisposition === "Temporarily Unavailable") {
      newAvailabilityStatus = "Temporarily Unavailable";
      newIsActiveSupply = false;
    }

    const updatedProp: Property = {
      ...selectedProperty,
      validationStatus: newValidationStatus,
      availabilityStatus: newAvailabilityStatus,
      isActiveSupply: newIsActiveSupply,
      currentDisposition: callDisposition,
      callHistory: [newLogItem, ...selectedProperty.callHistory],
    };

    setProperties((prev) =>
      prev.map((p) => (p.id === updatedProp.id ? updatedProp : p))
    );
    setSelectedProperty(updatedProp);
    setIsCallModalOpen(false);

    setToastMessage(
      `Call outcome recorded for ${selectedProperty.societyName}: ${callDisposition}`
    );
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-crm-border">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-crm-text">
                Supply Validation Queue
              </h2>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-stone-100 text-crm-muted border border-crm-border">
                {filteredProperties.length} Properties
              </span>
            </div>
            <p className="text-xs text-crm-muted mt-1">
              Verify property details, establish owner mandate willingness, and manage calling dispositions (PRD §4).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setToastMessage("Bulk upload via CSV is ready for template ingestion.")}
              className="px-3 py-1.5 text-xs font-medium rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 shadow-2xs"
            >
              📥 Upload CSV / Excel
            </button>
            <button
              onClick={() => setToastMessage("Manual property addition flow is ready.")}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
            >
              + Post Property
            </button>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="p-4 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
            {/* Search Input */}
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Search Society, Locality, Owner
              </label>
              <input
                type="text"
                placeholder="e.g. DLF, Sobha, Golf Course..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            {/* Validation Status Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Validation Status
              </label>
              <select
                value={validationFilter}
                onChange={(e) => setValidationFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">All Validation Statuses</option>
                <option value="Not Validated">Not Validated</option>
                <option value="In Validation">In Validation</option>
                <option value="Validated">Validated</option>
                <option value="Mandate Declined">Mandate Declined</option>
              </select>
            </div>

            {/* Availability Status Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Availability
              </label>
              <select
                value={availabilityFilter}
                onChange={(e) => setAvailabilityFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">All Availabilities</option>
                <option value="Available">Available</option>
                <option value="Temporarily Unavailable">Temp. Unavailable</option>
                <option value="Sold">Sold</option>
                <option value="Rented">Rented</option>
              </select>
            </div>

            {/* Preference (Sale / Rent) */}
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

            {/* Property Type Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Property Type
              </label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">All Types</option>
                <option value="Apartment">Apartment</option>
                <option value="Independent House">House</option>
                <option value="Villa">Villa</option>
                <option value="Builder Floor">Builder Floor</option>
              </select>
            </div>

            {/* BHK Filter */}
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

        {/* Main Content Layout: Table + Side Drawer (when selected) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Properties Table */}
          <div
            className={`rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden transition-all ${
              selectedProperty ? "lg:col-span-7" : "lg:col-span-12"
            }`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 border-b border-crm-border text-crm-muted uppercase tracking-wider font-semibold text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Property & Society</th>
                    <th className="px-3 py-3">Type & Area</th>
                    <th className="px-3 py-3">Price / Rent</th>
                    <th className="px-3 py-3">Owner Contact</th>
                    <th className="px-3 py-3">Validation Status</th>
                    <th className="px-3 py-3">Calling Disposition</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-crm-border">
                  {properties.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-crm-muted">
                        <div className="max-w-sm mx-auto space-y-1">
                          <p className="font-semibold text-crm-text text-sm">No properties added yet</p>
                          <p className="text-xs text-crm-muted">
                            Use &quot;+ Post Property&quot; or &quot;Upload CSV / Excel&quot; to add resale and rental inventory.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : filteredProperties.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-crm-muted">
                        No properties found matching current filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredProperties.map((prop) => {
                      const isSelected = selectedProperty?.id === prop.id;
                      return (
                        <tr
                          key={prop.id}
                          onClick={() => setSelectedProperty(prop)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? "bg-teal-50/60 font-medium" : "hover:bg-stone-50/70"
                          }`}
                        >
                          {/* Property & Society */}
                          <td className="px-4 py-3">
                            <div className="font-bold text-crm-text">
                              {prop.societyName}
                            </div>
                            <div className="text-[11px] text-crm-muted">
                              {prop.locality}, {prop.city}
                            </div>
                          </td>

                          {/* Specs */}
                          <td className="px-3 py-3 text-crm-muted">
                            <div>{prop.bedroomCount} BHK {prop.propertyType}</div>
                            <div className="text-[11px]">
                              {prop.area.toLocaleString()} sq.ft ({prop.areaType})
                            </div>
                          </td>

                          {/* Price */}
                          <td className="px-3 py-3 font-semibold text-crm-text">
                            <div>{prop.priceFormatted}</div>
                            <StatusBadge status={prop.preference} />
                          </td>

                          {/* Owner Contact */}
                          <td className="px-3 py-3">
                            <div className="text-crm-text font-medium">{prop.ownerName}</div>
                            <div className="text-[11px] text-crm-muted">{prop.ownerMobile}</div>
                          </td>

                          {/* Validation & Availability */}
                          <td className="px-3 py-3 space-y-1">
                            <div><StatusBadge status={prop.validationStatus} /></div>
                            <div><StatusBadge status={prop.availabilityStatus} /></div>
                          </td>

                          {/* Calling Disposition */}
                          <td className="px-3 py-3">
                            <StatusBadge status={prop.currentDisposition} />
                          </td>

                          {/* Action */}
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenCallModal(prop);
                              }}
                              className="px-2.5 py-1 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                            >
                              Log Call
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

          {/* Selected Property Detail Slide-Over / Inspector */}
          {selectedProperty && (
            <div className="lg:col-span-5 rounded-lg bg-crm-surface border border-crm-border shadow-xs overflow-hidden sticky top-4 space-y-4">
              {/* Header */}
              <div className="px-5 py-4 border-b border-crm-border bg-stone-50/60 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-crm-text">
                      {selectedProperty.societyName}
                    </h3>
                    <StatusBadge status={selectedProperty.preference} />
                  </div>
                  <p className="text-xs text-crm-muted mt-0.5">
                    {selectedProperty.flatNumber} • {selectedProperty.locality}, {selectedProperty.city}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedProperty(null)}
                  className="text-crm-muted hover:text-crm-text p-1 text-sm"
                  aria-label="Close Inspector"
                >
                  ✕
                </button>
              </div>

              <div className="p-5 space-y-5 text-xs max-h-[75vh] overflow-y-auto">
                {/* Status Summary Banner */}
                <div className="p-3 rounded-md bg-stone-50 border border-crm-border flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-crm-muted block">Validation Status</span>
                    <StatusBadge status={selectedProperty.validationStatus} />
                  </div>
                  <div>
                    <span className="text-[11px] text-crm-muted block">Availability</span>
                    <StatusBadge status={selectedProperty.availabilityStatus} />
                  </div>
                  <div>
                    <span className="text-[11px] text-crm-muted block">Active Supply Pool</span>
                    <span className={`font-bold text-xs ${selectedProperty.isActiveSupply ? "text-emerald-700" : "text-amber-700"}`}>
                      {selectedProperty.isActiveSupply ? "✓ Active Pool" : "✗ Outside Pool"}
                    </span>
                  </div>
                </div>

                {/* Primary Specs & Price */}
                <div>
                  <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px] mb-2 border-b border-crm-border pb-1">
                    Property Specifications
                  </h4>
                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div>
                      <span className="text-crm-muted block text-[11px]">Price / Asking Rent</span>
                      <strong className="text-crm-text text-sm">{selectedProperty.priceFormatted}</strong>
                    </div>
                    <div>
                      <span className="text-crm-muted block text-[11px]">Area & Unit</span>
                      <strong className="text-crm-text">{selectedProperty.area} sq.ft ({selectedProperty.areaType})</strong>
                    </div>
                    <div>
                      <span className="text-crm-muted block text-[11px]">Configuration</span>
                      <span className="text-crm-text font-medium">
                        {selectedProperty.bedroomCount} Beds, {selectedProperty.bathroomCount} Baths, {selectedProperty.balconyCount} Balconies
                      </span>
                    </div>
                    <div>
                      <span className="text-crm-muted block text-[11px]">Furnishing</span>
                      <span className="text-crm-text font-medium">{selectedProperty.furnishingStatus}</span>
                    </div>
                    <div>
                      <span className="text-crm-muted block text-[11px]">Construction Status</span>
                      <span className="text-crm-text font-medium">{selectedProperty.constructionStatus}</span>
                    </div>
                  </div>
                </div>

                {/* Owner & Key Holder Contacts */}
                <div>
                  <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px] mb-2 border-b border-crm-border pb-1">
                    Contact & Key Details
                  </h4>
                  <div className="p-3 rounded border border-crm-border bg-stone-50/50 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-crm-muted">Owner (Private)</span>
                        <div className="font-bold text-crm-text">{selectedProperty.ownerName}</div>
                        <div className="text-crm-muted">{selectedProperty.ownerMobile}</div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-red-50 text-red-700 border border-red-200">
                        Masked to Buyers
                      </span>
                    </div>

                    <div className="pt-2 border-t border-crm-border text-[11px]">
                      <span className="text-crm-muted block font-semibold">Key Custodian ({selectedProperty.keyHolder.persona}):</span>
                      <div className="text-crm-text font-medium">{selectedProperty.keyHolder.name} ({selectedProperty.keyHolder.mobile})</div>
                      {selectedProperty.keyHolder.notes && (
                        <div className="text-crm-muted italic text-[10px] mt-0.5">{selectedProperty.keyHolder.notes}</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenCallModal(selectedProperty)}
                    className="flex-1 py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs text-center"
                  >
                    📞 Log Owner Call Outcome
                  </button>
                </div>

                {/* Call History Timeline */}
                <div>
                  <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px] mb-2 border-b border-crm-border pb-1">
                    Owner Call History ({selectedProperty.callHistory.length})
                  </h4>
                  <div className="space-y-2.5">
                    {selectedProperty.callHistory.map((call) => (
                      <div
                        key={call.id}
                        className="p-2.5 rounded border border-crm-border bg-stone-50/30 space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <StatusBadge status={call.disposition} />
                          <span className="text-[10px] text-crm-muted">{call.calledAt}</span>
                        </div>
                        <p className="text-crm-text text-[11px]">{call.notes}</p>
                        {call.callbackDate && (
                          <div className="text-amber-800 text-[10px] font-medium">
                            ⏰ Callback Scheduled: {call.callbackDate}
                          </div>
                        )}
                        <div className="text-[10px] text-crm-muted">Caller: {call.callerName}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Media Section */}
                <div>
                  <h4 className="font-bold text-crm-text uppercase tracking-wider text-[11px] mb-2 border-b border-crm-border pb-1">
                    Property Media ({selectedProperty.media.length})
                  </h4>
                  {selectedProperty.media.length === 0 ? (
                    <div className="text-crm-muted italic text-center py-3 bg-stone-50 rounded border border-crm-border">
                      No photos or videos uploaded yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedProperty.media.map((m, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2 rounded border border-crm-border bg-stone-50/50 text-[11px]"
                        >
                          <div className="flex items-center gap-2">
                            <span>{m.type === "PHOTO" ? "🖼️" : "🎥"}</span>
                            <span className="font-medium text-crm-text">{m.caption}</span>
                          </div>
                          <a
                            href={m.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-crm-link hover:underline text-[10px]"
                          >
                            View Link ↗
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Log Call Outcome */}
      <Modal
        isOpen={isCallModalOpen}
        onClose={() => setIsCallModalOpen(false)}
        title={`Log Call Outcome: ${selectedProperty?.societyName || ""}`}
        subtitle={`Owner: ${selectedProperty?.ownerName || ""} (${selectedProperty?.ownerMobile || ""})`}
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
              Save Call Outcome
            </button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Calling Disposition (Required)
            </label>
            <select
              value={callDisposition}
              onChange={(e) => setCallDisposition(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            >
              <option value="Property Available">Property Available (Owner Confirms Willingness)</option>
              <option value="Property Sold or Rented">Property Sold or Rented (Move Inactive)</option>
              <option value="Owner Declines Mandate">Owner Declines Mandate (Reject Mandate)</option>
              <option value="Temporarily Unavailable">Temporarily Unavailable (Paused)</option>
              <option value="Call Back">Call Back (Requires scheduled datetime)</option>
              <option value="Ringing / Not Answering">Ringing / Not Answering</option>
            </select>
          </div>

          {callDisposition === "Call Back" && (
            <div>
              <label className="block font-semibold text-crm-text mb-1">
                Callback Date & Time (Required)
              </label>
              <input
                type="text"
                placeholder="e.g. 2026-10-23 03:00 PM"
                value={callbackTime}
                onChange={(e) => setCallbackTime(e.target.value)}
                className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              />
            </div>
          )}

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Caller Notes & Observations
            </label>
            <textarea
              rows={3}
              placeholder="Record owner conversation details, negotiation terms, inspection availability..."
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            />
          </div>

          <div className="p-3 rounded bg-amber-50/60 border border-amber-200 text-amber-900 text-[11px]">
            <strong>PRD Rule (§4.8):</strong> Selecting <em>&quot;Property Available&quot;</em> confirms both owner willingness and property details, moving this property into the Active Supply Pool.
          </div>
        </div>
      </Modal>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </AppShell>
  );
}

