"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui/Badge";
import { Toast } from "@/components/ui/Toast";
import { Lead } from "@/types/crm";
import { EvaluatedPropertyMatch } from "@/server/dal/matching";
import { sharePropertyDetailsWithLeadAction } from "../actions";

interface MatchingResultsClientProps {
  lead: Lead;
  matches: EvaluatedPropertyMatch[];
  totalActiveInventoryCount: number;
  currentUserRole?: string;
}

export function MatchingResultsClient({
  lead,
  matches,
  totalActiveInventoryCount,
}: MatchingResultsClientProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [minScoreFilter, setMinScoreFilter] = useState("All");
  const [bhkFilter, setBhkFilter] = useState("All");
  const [expandedCriteriaId, setExpandedCriteriaId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [sharingPropertyId, setSharingPropertyId] = useState<string | null>(null);

  // Filtered matching results
  const filteredMatches = useMemo(() => {
    return matches.filter((item) => {
      const prop = item.property;

      // Search
      const searchMatch =
        prop.societyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        prop.locality.toLowerCase().includes(searchTerm.toLowerCase()) ||
        prop.city.toLowerCase().includes(searchTerm.toLowerCase());
      if (!searchMatch) return false;

      // Score filter
      if (minScoreFilter === "100" && item.score < 100) return false;
      if (minScoreFilter === "80" && item.score < 80) return false;
      if (minScoreFilter === "60" && item.score < 60) return false;

      // BHK filter
      if (bhkFilter !== "All") {
        if (bhkFilter === "4+" && prop.bedroomCount < 4) return false;
        if (bhkFilter !== "4+" && prop.bedroomCount.toString() !== bhkFilter) return false;
      }

      return true;
    });
  }, [matches, searchTerm, minScoreFilter, bhkFilter]);

  const toggleCriteria = (propId: string) => {
    setExpandedCriteriaId((prev) => (prev === propId ? null : propId));
  };

  const handleShareProperty = async (propId: string) => {
    setSharingPropertyId(propId);
    try {
      const res = await sharePropertyDetailsWithLeadAction(lead.id, propId);
      if (res.success) {
        setToastMessage(res.message);
      } else {
        setToastMessage(`Failed to share: ${res.error}`);
      }
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Failed to share property.");
    } finally {
      setSharingPropertyId(null);
    }
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto space-y-6 pb-12">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between border-b border-crm-border pb-4">
          <div className="flex items-center gap-2">
            <Link
              href={`/leads/${lead.id}`}
              className="text-xs font-semibold text-crm-link hover:underline flex items-center gap-1"
            >
              <span>←</span> Back to {lead.name}
            </Link>
            <span className="text-crm-muted text-xs">/</span>
            <Link
              href="/leads"
              className="text-xs font-semibold text-crm-muted hover:underline"
            >
              Leads
            </Link>
            <span className="text-crm-muted text-xs">/</span>
            <span className="text-xs font-medium text-crm-text">Matching Inventory</span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/supply/active"
              className="text-xs font-semibold text-crm-link hover:underline flex items-center gap-1"
            >
              Browse Active Supply Pool ↗
            </Link>
          </div>
        </div>

        {/* Title Header */}
        <div className="bg-crm-surface border border-crm-border rounded-lg p-5 shadow-2xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-teal-50 border border-teal-200 text-crm-primary flex items-center justify-center font-bold text-lg shadow-2xs">
                🎯
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-xl font-bold tracking-tight text-crm-text">
                    Property Matching: {lead.name}
                  </h1>
                  <StatusBadge status={lead.requirements.preference} />
                  <StatusBadge status={lead.status} />
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 text-crm-muted border border-crm-border">
                    {lead.requirements.city}
                  </span>
                </div>
                <p className="text-xs text-crm-muted mt-1">
                  Deterministic PRD §6 Matching Engine evaluating verified Secondary Market active inventory.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-right">
                <span className="text-[10px] text-crm-muted uppercase font-bold block">
                  Eligible Active Matches
                </span>
                <span className="text-sm font-bold text-crm-primary">
                  {matches.length} of {totalActiveInventoryCount} Active Units
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION A: Buyer / Tenant Summary Card */}
        <div className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden">
          <div className="px-5 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between">
            <h2 className="text-xs font-bold text-crm-text uppercase tracking-wider">
              Section A: Buyer / Tenant Search Criteria
            </h2>
            <Link
              href={`/leads/${lead.id}/edit`}
              className="text-[11px] font-semibold text-crm-link hover:underline"
            >
              Edit Requirements ✏️
            </Link>
          </div>

          <div className="p-5 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-3.5 bg-stone-50/70 rounded-lg border border-crm-border">
              <div>
                <span className="text-[10px] text-crm-muted uppercase font-bold block">
                  Transaction
                </span>
                <strong className="text-crm-text text-sm">
                  {lead.requirements.preference} (Mandatory Hard Gate)
                </strong>
              </div>

              <div>
                <span className="text-[10px] text-crm-muted uppercase font-bold block">
                  Budget Scope
                </span>
                <strong className="text-crm-text text-sm">
                  {lead.requirements.budgetFormatted}
                </strong>
              </div>

              <div>
                <span className="text-[10px] text-crm-muted uppercase font-bold block">
                  Target City
                </span>
                <strong className="text-crm-text text-sm">
                  {lead.requirements.city}
                </strong>
              </div>

              <div>
                <span className="text-[10px] text-crm-muted uppercase font-bold block">
                  Configurations (BHK)
                </span>
                <span className="font-semibold text-crm-text">
                  {lead.requirements.bedroomConfigurations.join(", ") || "Any BHK"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3 pt-3 border-t border-crm-border">
              <div>
                <span className="text-crm-muted block text-[11px] mb-1">
                  Preferred Localities:
                </span>
                <div className="flex flex-wrap gap-1">
                  {lead.requirements.localities.length > 0 ? (
                    lead.requirements.localities.map((loc, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded bg-stone-100 text-crm-text font-medium text-[11px] border border-crm-border"
                      >
                        {loc}
                      </span>
                    ))
                  ) : (
                    <span className="text-crm-muted italic">Any location in {lead.requirements.city}</span>
                  )}
                </div>
              </div>

              <div>
                <span className="text-crm-muted block text-[11px] mb-1">
                  Acceptable Property Types:
                </span>
                <div className="flex flex-wrap gap-1">
                  {lead.requirements.propertyTypes.length > 0 ? (
                    lead.requirements.propertyTypes.map((pt, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded bg-teal-50 text-crm-primary font-medium text-[11px] border border-teal-200"
                      >
                        {pt.replace(/_/g, " ")}
                      </span>
                    ))
                  ) : (
                    <span className="text-crm-muted italic">Any Residential Property</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Filter Controls Bar for Results */}
        <div className="p-4 rounded-lg bg-crm-surface border border-crm-border shadow-2xs space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {/* Search Input */}
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Filter Society or Locality
              </label>
              <input
                type="text"
                placeholder="e.g. DLF, Grand Arch, Golf Course..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            {/* Min Score Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-crm-muted mb-1">
                Matching Score
              </label>
              <select
                value={minScoreFilter}
                onChange={(e) => setMinScoreFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden"
              >
                <option value="All">All Scores (Ranked)</option>
                <option value="100">100% Exact Match Only</option>
                <option value="80">80%+ Strong Matches</option>
                <option value="60">60%+ Partial Matches</option>
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
                <option value="1">1 BHK</option>
                <option value="2">2 BHK</option>
                <option value="3">3 BHK</option>
                <option value="4+">4+ BHK</option>
              </select>
            </div>
          </div>
        </div>

        {/* SECTION B & C: Matching Results Inventory */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-crm-text tracking-tight">
              Matching Active Inventory ({filteredMatches.length})
            </h2>
            <span className="text-xs text-crm-muted">
              Ranked by PRD Matching Score %
            </span>
          </div>

          {filteredMatches.length === 0 ? (
            /* SECTION D: Empty State */
            <div className="bg-crm-surface border border-crm-border rounded-lg p-10 text-center space-y-3 shadow-2xs">
              <div className="w-12 h-12 mx-auto rounded-full bg-stone-100 border border-crm-border flex items-center justify-center text-xl text-crm-muted">
                🔍
              </div>
              <h3 className="text-sm font-bold text-crm-text">
                No matching properties found
              </h3>
              <p className="text-xs text-crm-muted max-w-md mx-auto">
                No active properties currently qualify for {lead.name} based on the {lead.requirements.preference} preference and specified budget window.
                Only validated properties with confirmed owner willingness and available status enter matching results.
              </p>
              <div className="pt-2 flex items-center justify-center gap-3">
                <Link
                  href="/supply/active"
                  className="px-4 py-2 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50"
                >
                  View Active Supply Pool
                </Link>
                <Link
                  href={`/leads/${lead.id}/edit`}
                  className="px-4 py-2 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                >
                  Adjust Buyer Criteria ✏️
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredMatches.map((item) => {
                const prop = item.property;
                const isExpanded = expandedCriteriaId === prop.id;

                // Score badge styling
                const badgeColor =
                  item.score === 100
                    ? "bg-emerald-100 text-emerald-800 border-emerald-300 font-bold"
                    : item.score >= 80
                    ? "bg-teal-100 text-teal-800 border-teal-300 font-bold"
                    : item.score >= 60
                    ? "bg-amber-100 text-amber-800 border-amber-300 font-semibold"
                    : "bg-stone-100 text-stone-700 border-stone-300";

                return (
                  <div
                    key={prop.id}
                    className="bg-crm-surface border border-crm-border rounded-lg shadow-2xs overflow-hidden transition-all hover:border-crm-primary/40"
                  >
                    {/* Property Card Header */}
                    <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-crm-border bg-stone-50/30">
                      <div className="flex items-start gap-3">
                        <div className={`px-2.5 py-1 rounded-full text-xs border ${badgeColor} shadow-2xs shrink-0 mt-0.5`}>
                          {item.score}% Match
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base font-bold text-crm-text">
                              {prop.societyName}
                            </h3>
                            <span className="text-xs font-semibold text-crm-muted">
                              • {prop.locality}, {prop.city}
                            </span>
                            {prop.isFieldVerified && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                ✓ Field Verified
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-crm-muted mt-1 flex-wrap">
                            <span>{prop.bedroomCount} BHK {prop.propertyType}</span>
                            <span>•</span>
                            <span>{prop.area} sq.ft ({prop.areaType})</span>
                            <span>•</span>
                            <span>{prop.furnishingStatus}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col sm:items-end gap-1 shrink-0">
                        <strong className="text-lg font-bold text-crm-primary">
                          {prop.priceFormatted}
                        </strong>
                        <span className="text-[11px] text-crm-muted">
                          {item.criteriaMatchedCount} of {item.criteriaEvaluatedCount} criteria matched
                        </span>
                      </div>
                    </div>

                    {/* Criteria Breakdown Grid */}
                    <div className="p-5 space-y-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-crm-text text-[11px] uppercase tracking-wider">
                          Section C: Criteria Evaluation Breakdown (PRD §6)
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleCriteria(prop.id)}
                          className="text-crm-link hover:underline font-semibold text-[11px]"
                        >
                          {isExpanded ? "Hide Details ▲" : "Inspect Checklist ▼"}
                        </button>
                      </div>

                      {/* Summary Chips */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                        {/* 1. Preference */}
                        <div
                          className={`p-2 rounded border text-left ${
                            item.breakdown.preference.matched
                              ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
                              : "bg-red-50/70 border-red-200 text-red-900"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px] font-bold">
                            <span>Preference</span>
                            <span>{item.breakdown.preference.matched ? "✓" : "✗"}</span>
                          </div>
                          <p className="text-[10px] opacity-80 truncate mt-0.5">
                            {item.breakdown.preference.actual}
                          </p>
                        </div>

                        {/* 2. Budget */}
                        <div
                          className={`p-2 rounded border text-left ${
                            item.breakdown.budget.matched
                              ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
                              : "bg-stone-50 border-stone-200 text-stone-700"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px] font-bold">
                            <span>Budget</span>
                            <span>{item.breakdown.budget.matched ? "✓" : "✗"}</span>
                          </div>
                          <p className="text-[10px] opacity-80 truncate mt-0.5">
                            {item.breakdown.budget.actual}
                          </p>
                        </div>

                        {/* 3. Locality */}
                        <div
                          className={`p-2 rounded border text-left ${
                            !item.breakdown.locality.evaluated
                              ? "bg-stone-50/70 border-stone-200 text-stone-500"
                              : item.breakdown.locality.matched
                              ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
                              : "bg-stone-50 border-stone-200 text-stone-700"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px] font-bold">
                            <span>Locality</span>
                            <span>
                              {!item.breakdown.locality.evaluated ? "—" : item.breakdown.locality.matched ? "✓" : "✗"}
                            </span>
                          </div>
                          <p className="text-[10px] opacity-80 truncate mt-0.5">
                            {!item.breakdown.locality.evaluated ? "Unspecified" : item.breakdown.locality.actual}
                          </p>
                        </div>

                        {/* 4. Property Type */}
                        <div
                          className={`p-2 rounded border text-left ${
                            !item.breakdown.propertyType.evaluated
                              ? "bg-stone-50/70 border-stone-200 text-stone-500"
                              : item.breakdown.propertyType.matched
                              ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
                              : "bg-stone-50 border-stone-200 text-stone-700"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px] font-bold">
                            <span>Type</span>
                            <span>
                              {!item.breakdown.propertyType.evaluated ? "—" : item.breakdown.propertyType.matched ? "✓" : "✗"}
                            </span>
                          </div>
                          <p className="text-[10px] opacity-80 truncate mt-0.5">
                            {!item.breakdown.propertyType.evaluated ? "Unspecified" : item.breakdown.propertyType.actual}
                          </p>
                        </div>

                        {/* 5. Bedrooms */}
                        <div
                          className={`p-2 rounded border text-left ${
                            !item.breakdown.bedroomCount.evaluated
                              ? "bg-stone-50/70 border-stone-200 text-stone-500"
                              : item.breakdown.bedroomCount.matched
                              ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
                              : "bg-stone-50 border-stone-200 text-stone-700"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px] font-bold">
                            <span>Bedrooms</span>
                            <span>
                              {!item.breakdown.bedroomCount.evaluated ? "—" : item.breakdown.bedroomCount.matched ? "✓" : "✗"}
                            </span>
                          </div>
                          <p className="text-[10px] opacity-80 truncate mt-0.5">
                            {!item.breakdown.bedroomCount.evaluated ? "Unspecified" : item.breakdown.bedroomCount.actual}
                          </p>
                        </div>

                        {/* 6. Area */}
                        <div
                          className={`p-2 rounded border text-left ${
                            !item.breakdown.area.evaluated
                              ? "bg-stone-50/70 border-stone-200 text-stone-500"
                              : item.breakdown.area.matched
                              ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
                              : "bg-stone-50 border-stone-200 text-stone-700"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px] font-bold">
                            <span>Area</span>
                            <span>
                              {!item.breakdown.area.evaluated ? "—" : item.breakdown.area.matched ? "✓" : "✗"}
                            </span>
                          </div>
                          <p className="text-[10px] opacity-80 truncate mt-0.5">
                            {!item.breakdown.area.evaluated ? "Unspecified" : item.breakdown.area.actual}
                          </p>
                        </div>
                      </div>

                      {/* Expanded Detailed Checklist */}
                      {isExpanded && (
                        <div className="mt-3 p-4 rounded-lg bg-stone-50 border border-crm-border space-y-2 text-xs">
                          <h4 className="font-bold text-crm-text text-[11px] uppercase">
                            Detailed Criteria Verification Checklist:
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                            {/* Budget */}
                            <div className="p-2 rounded bg-white border border-crm-border space-y-0.5">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-crm-text">Budget Evaluation:</span>
                                <span className={item.breakdown.budget.matched ? "text-emerald-700 font-bold" : "text-amber-800"}>
                                  {item.breakdown.budget.matched ? "✓ Qualified" : "Outside Range"}
                                </span>
                              </div>
                              <p className="text-crm-muted text-[10px]">
                                {item.breakdown.budget.details}
                              </p>
                            </div>

                            {/* Locality */}
                            <div className="p-2 rounded bg-white border border-crm-border space-y-0.5">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-crm-text">Locality Proximity:</span>
                                <span className={item.breakdown.locality.matched ? "text-emerald-700 font-bold" : "text-crm-muted"}>
                                  {item.breakdown.locality.matched ? "✓ Matched" : "No Match"}
                                </span>
                              </div>
                              <p className="text-crm-muted text-[10px]">
                                {item.breakdown.locality.details}
                              </p>
                            </div>

                            {/* Property Type */}
                            <div className="p-2 rounded bg-white border border-crm-border space-y-0.5">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-crm-text">Property Type:</span>
                                <span className={item.breakdown.propertyType.matched ? "text-emerald-700 font-bold" : "text-crm-muted"}>
                                  {item.breakdown.propertyType.matched ? "✓ Matched" : "No Match"}
                                </span>
                              </div>
                              <p className="text-crm-muted text-[10px]">
                                {item.breakdown.propertyType.details}
                              </p>
                            </div>

                            {/* Area Tolerance */}
                            <div className="p-2 rounded bg-white border border-crm-border space-y-0.5">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-crm-text">Area (±15% Tolerance):</span>
                                <span className={item.breakdown.area.matched ? "text-emerald-700 font-bold" : "text-crm-muted"}>
                                  {item.breakdown.area.matched ? "✓ Qualified" : "Unspecified/No Match"}
                                </span>
                              </div>
                              <p className="text-crm-muted text-[10px]">
                                {item.breakdown.area.details}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action Bar */}
                    <div className="px-5 py-3 bg-stone-50/50 border-t border-crm-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                      <span className="text-[11px] text-crm-muted">
                        Active Pool Status: <strong className="text-crm-text">{prop.availabilityStatus}</strong>
                      </span>

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => handleShareProperty(prop.id)}
                          disabled={sharingPropertyId === prop.id}
                          className="px-3 py-1.5 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-text hover:bg-stone-50 shadow-2xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          {sharingPropertyId === prop.id ? (
                            <span>Sharing...</span>
                          ) : (
                            <>
                              <span>📤</span> Share Details with Buyer
                            </>
                          )}
                        </button>

                        <Link
                          href={`/visits?leadId=${lead.id}&propertyId=${prop.id}`}
                          className="px-3.5 py-1.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs flex items-center gap-1.5 cursor-pointer"
                        >
                          <span>📅</span> Schedule Site Visit
                        </Link>

                        <Link
                          href={`/supply/${prop.id}`}
                          className="px-3 py-1.5 text-xs font-semibold rounded border border-crm-border bg-crm-surface text-crm-link hover:underline shadow-2xs flex items-center gap-1"
                        >
                          <span>↗</span> Property Details
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </AppShell>
  );
}

