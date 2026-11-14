"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { SiteVisit } from "@/types/crm";
import { createSiteVisitAction } from "@/app/visits/actions";

export interface AvailableLeadItem {
  id: string;
  name: string;
  primaryPhone: string;
}

export interface AvailablePropertyItem {
  id: string;
  societyName: string;
  flatNumber: string;
  bedroomCount: number;
  localityName: string;
}

export interface SalesAgentItem {
  id: string;
  name: string;
  email: string;
}

export interface ScheduleVisitModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId?: string;
  leadName?: string;
  leadPhone?: string;
  initialPropertyIds?: string[];
  availableLeads?: AvailableLeadItem[];
  availableProperties: AvailablePropertyItem[];
  salesAgents: SalesAgentItem[];
  onSuccess?: (createdVisit: SiteVisit) => void;
}

function getTomorrowDateString(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split("T")[0];
}

function ScheduleVisitModalContent({
  isOpen,
  onClose,
  leadId,
  leadName,
  leadPhone,
  initialPropertyIds = [],
  availableLeads = [],
  availableProperties = [],
  salesAgents = [],
  onSuccess,
}: ScheduleVisitModalProps) {
  const [selectedLeadId, setSelectedLeadId] = useState(leadId || availableLeads[0]?.id || "");
  const [selectedAgentId, setSelectedAgentId] = useState(salesAgents[0]?.id || "");
  const [scheduledDate, setScheduledDate] = useState(getTomorrowDateString);
  const [scheduledTime, setScheduledTime] = useState("11:00");
  const [selectedProperties, setSelectedProperties] = useState<string[]>(
    initialPropertyIds.length > 0 ? [...initialPropertyIds] : []
  );
  const [notes, setNotes] = useState("");
  const [isScheduling, setIsScheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePropertyToggle = (propertyId: string) => {
    if (selectedProperties.includes(propertyId)) {
      setSelectedProperties(selectedProperties.filter((id) => id !== propertyId));
    } else {
      setSelectedProperties([...selectedProperties, propertyId]);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isScheduling) return;
    setError(null);

    const targetLeadId = selectedLeadId || leadId;
    if (!targetLeadId) {
      setError("Please select a prospect lead.");
      return;
    }

    if (!selectedAgentId) {
      setError("Please select an assigned sales agent.");
      return;
    }

    if (!scheduledDate) {
      setError("Please select a visit date.");
      return;
    }

    if (selectedProperties.length === 0) {
      setError("Please select at least one property from Active Supply Pool.");
      return;
    }

    setIsScheduling(true);
    try {
      const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime || "11:00"}:00`);
      const res = await createSiteVisitAction({
        leadId: targetLeadId,
        assignedSalesAgentId: selectedAgentId,
        scheduledDate: scheduledDateTime.toISOString(),
        propertyIds: selectedProperties,
        notes: notes.trim() || undefined,
      });

      if (!res.success) {
        setError(res.error);
        return;
      }

      onSuccess?.(res.visit);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to schedule site visit.");
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Schedule Site Visit Itinerary"
      subtitle="Coordinate buyer with assigned field sales agent for active properties (PRD §8)"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-crm-border text-crm-muted hover:text-crm-text transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={isScheduling}
            className="px-4 py-1.5 text-xs font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs disabled:opacity-50 transition-colors"
          >
            {isScheduling ? "Scheduling..." : "Create Itinerary"}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-xs max-h-[70vh] overflow-y-auto pr-1">
        {error && (
          <div className="p-2.5 rounded bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
            {error}
          </div>
        )}

        {/* Lead Selection / Display */}
        {leadId ? (
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Prospect Buyer / Lead
            </label>
            <div className="p-2.5 rounded border border-crm-border bg-stone-50 text-xs flex items-center justify-between">
              <div>
                <span className="font-bold text-crm-text">{leadName || "Selected Prospect"}</span>
                {leadPhone && (
                  <span className="text-crm-muted font-mono text-[11px] ml-2">
                    ({leadPhone})
                  </span>
                )}
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">
                Current Lead
              </span>
            </div>
          </div>
        ) : (
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Select Prospect Lead <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedLeadId}
              onChange={(e) => setSelectedLeadId(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            >
              <option value="">-- Choose Prospect --</option>
              {availableLeads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.name} ({lead.primaryPhone})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Sales Agent Assignment */}
        <div>
          <label className="block font-semibold text-crm-text mb-1">
            Assigned Field Sales Agent <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
          >
            <option value="">-- Choose Field Agent --</option>
            {salesAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.email})
              </option>
            ))}
          </select>
        </div>

        {/* Scheduled Date & Time */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Scheduled Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            />
          </div>
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Time Window / Slot
            </label>
            <input
              type="time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
            />
          </div>
        </div>

        {/* Property Selection / Itinerary Construction */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="font-semibold text-crm-text">
              Select Properties to Visit (Active Supply Pool) <span className="text-red-500">*</span>
            </label>
            <span className="text-[11px] font-semibold text-crm-primary">
              Selected ({selectedProperties.length})
            </span>
          </div>
          <p className="text-[11px] text-crm-muted mb-2">
            Only verified properties with Available status can be included in itineraries (PRD §8.1).
          </p>
          {availableProperties.length === 0 ? (
            <div className="p-3 rounded border border-amber-200 bg-amber-50 text-amber-900 text-xs">
              No active properties available in supply pool. Verify and activate properties first.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto p-2 border border-crm-border rounded bg-stone-50/30">
              {availableProperties.map((prop) => {
                const isChecked = selectedProperties.includes(prop.id);
                const orderIndex = selectedProperties.indexOf(prop.id);
                return (
                  <label
                    key={prop.id}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                      isChecked
                        ? "bg-teal-50 border border-teal-300"
                        : "hover:bg-stone-100/70 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handlePropertyToggle(prop.id)}
                        className="accent-crm-primary"
                      />
                      <div className="text-xs">
                        <span className="font-semibold text-crm-text">
                          {prop.societyName} ({prop.flatNumber})
                        </span>
                        <span className="text-crm-muted ml-1.5 text-[11px]">
                          • {prop.bedroomCount} BHK • {prop.localityName}
                        </span>
                      </div>
                    </div>
                    {isChecked && (
                      <span className="text-[10px] font-bold text-teal-800 bg-teal-100 px-1.5 py-0.5 rounded">
                        Stop #{orderIndex + 1}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Visit Instructions / Special Notes */}
        <div>
          <label className="block font-semibold text-crm-text mb-1">
            Visit Instructions / Special Notes
          </label>
          <textarea
            rows={2}
            placeholder="e.g. Buyer is interested in 3 BHK garden facing, meeting at club house gate..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
          />
        </div>
      </div>
    </Modal>
  );
}

export function ScheduleVisitModal(props: ScheduleVisitModalProps) {
  if (!props.isOpen) return null;
  return <ScheduleVisitModalContent {...props} />;
}
