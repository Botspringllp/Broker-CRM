"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { PendingCallbackItem } from "@/types/crm";
import { getPendingCallbacksAction } from "@/app/leads/actions";

interface PendingCallbacksCompactProps {
  onSelectLeadId?: (leadId: string) => void;
  defaultOpen?: boolean;
}

type TimeframeTab = "today" | "overdue" | "upcoming" | "all";

export function PendingCallbacksCompact({
  onSelectLeadId,
  defaultOpen = false,
}: PendingCallbacksCompactProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<TimeframeTab>("today");
  const [callbacks, setCallbacks] = useState<PendingCallbackItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (timeframe: TimeframeTab) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getPendingCallbacksAction(timeframe);
      if (res.success) {
        setCallbacks(res.callbacks);
      } else {
        setError(res.error || "Failed to load callbacks.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load callbacks.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleTabChange = (tab: TimeframeTab) => {
    setActiveTab(tab);
    loadData(tab);
  };

  const handleToggleOpen = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      loadData(activeTab);
    }
  };

  useEffect(() => {
    if (!defaultOpen) return;
    let cancelled = false;
    getPendingCallbacksAction(activeTab)
      .then((res) => {
        if (!cancelled) {
          if (res.success) {
            setCallbacks(res.callbacks);
            setError(null);
          } else {
            setError(res.error || "Failed to load callbacks.");
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load callbacks.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [defaultOpen, activeTab]);

  return (
    <div className="rounded-lg bg-crm-surface border border-crm-border shadow-2xs overflow-hidden">
      {/* Header bar / Toggle */}
      <div
        onClick={handleToggleOpen}
        className="px-4 py-2.5 bg-stone-50 border-b border-crm-border flex items-center justify-between cursor-pointer hover:bg-stone-100/70 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-amber-700 font-bold text-sm">⏰</span>
          <span className="text-xs font-bold text-crm-text uppercase tracking-wider">
            Pending Callbacks Queue
          </span>
          <span className="text-[11px] text-crm-muted">
            (Follow-ups &amp; Scheduled Re-calls)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-crm-muted font-medium">
            {isOpen ? "▲ Collapse" : "▼ View Queue"}
          </span>
        </div>
      </div>

      {isOpen && (
        <div className="p-4 space-y-3">
          {/* Timeframe Tabs */}
          <div className="flex items-center gap-1.5 border-b border-crm-border pb-2.5 text-xs">
            <button
              type="button"
              onClick={() => handleTabChange("today")}
              className={`px-3 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                activeTab === "today"
                  ? "bg-amber-100 text-amber-900 border border-amber-300"
                  : "bg-stone-50 text-crm-muted hover:text-crm-text border border-crm-border"
              }`}
            >
              Due Today
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("overdue")}
              className={`px-3 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                activeTab === "overdue"
                  ? "bg-rose-100 text-rose-900 border border-rose-300"
                  : "bg-stone-50 text-crm-muted hover:text-crm-text border border-crm-border"
              }`}
            >
              Overdue
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("upcoming")}
              className={`px-3 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                activeTab === "upcoming"
                  ? "bg-blue-100 text-blue-900 border border-blue-300"
                  : "bg-stone-50 text-crm-muted hover:text-crm-text border border-crm-border"
              }`}
            >
              Upcoming
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("all")}
              className={`px-3 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                activeTab === "all"
                  ? "bg-stone-200 text-stone-900 border border-stone-400"
                  : "bg-stone-50 text-crm-muted hover:text-crm-text border border-crm-border"
              }`}
            >
              All Timeframes
            </button>

            <button
              type="button"
              onClick={() => loadData(activeTab)}
              disabled={isLoading}
              className="ml-auto text-xs text-crm-muted hover:text-crm-text px-2 py-0.5 rounded border border-crm-border bg-stone-50"
              title="Refresh Queue"
            >
              ↻ Refresh
            </button>
          </div>

          {/* Callback list container */}
          {isLoading ? (
            <div className="py-8 text-center text-xs text-crm-muted flex items-center justify-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-crm-primary border-t-transparent rounded-full animate-spin" />
              Loading pending callbacks...
            </div>
          ) : error ? (
            <div className="p-3 rounded bg-rose-50 border border-rose-200 text-rose-800 text-xs">
              {error}
            </div>
          ) : callbacks.length === 0 ? (
            <div className="py-6 text-center text-crm-muted text-xs bg-stone-50/50 rounded border border-dashed border-crm-border">
              No pending callbacks in &ldquo;{activeTab}&rdquo; timeframe.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {callbacks.map((cb) => (
                <div
                  key={cb.callLogId}
                  className={`p-3 rounded-lg border text-xs space-y-2 transition-all ${
                    cb.isOverdue
                      ? "bg-rose-50/40 border-rose-200"
                      : cb.isDueToday
                      ? "bg-amber-50/40 border-amber-200"
                      : "bg-crm-surface border-crm-border"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/leads/${cb.leadId}/qualify`}
                        onClick={() => onSelectLeadId?.(cb.leadId)}
                        className="font-bold text-crm-text hover:text-crm-primary hover:underline text-xs block"
                      >
                        {cb.leadName}
                      </Link>
                      <span className="text-[11px] text-crm-muted">
                        +91 {cb.primaryPhone}
                      </span>
                    </div>

                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        cb.isOverdue
                          ? "bg-rose-100 text-rose-800 border border-rose-300"
                          : cb.isDueToday
                          ? "bg-amber-100 text-amber-800 border border-amber-300"
                          : "bg-blue-100 text-blue-800 border border-blue-300"
                      }`}
                    >
                      {cb.isOverdue ? "Overdue" : cb.isDueToday ? "Due Today" : "Upcoming"}
                    </span>
                  </div>

                  <div className="text-[11px] space-y-0.5">
                    <div className="flex items-center gap-1 text-crm-text font-medium">
                      <span>⏰</span>
                      <span>{cb.callbackFormatted}</span>
                    </div>
                    <div className="text-crm-muted">
                      {cb.city} • {cb.budgetFormatted}
                    </div>
                    {cb.notes && (
                      <p className="text-[10px] italic text-crm-muted truncate bg-stone-100/70 p-1 rounded">
                        &ldquo;{cb.notes}&rdquo;
                      </p>
                    )}
                  </div>

                  <div className="pt-1 flex items-center justify-between border-t border-crm-border/60">
                    <span className="text-[10px] text-crm-muted">
                      Caller: {cb.assignedTelecallerName}
                    </span>
                    <Link
                      href={`/leads/${cb.leadId}/qualify`}
                      onClick={() => onSelectLeadId?.(cb.leadId)}
                      className="px-2.5 py-1 text-[11px] font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs"
                    >
                      📞 Call Now
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
