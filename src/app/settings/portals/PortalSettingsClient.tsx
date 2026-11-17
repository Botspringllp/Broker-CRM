"use client";

import React, { useState } from "react";
import { PortalProvider, UserRole } from "@prisma/client";
import {
  togglePortalIntegrationStatusAction,
  generatePortalWebhookTokenAction,
  rotatePortalWebhookTokenAction,
} from "./actions";

export interface SerializedPortalConfig {
  id: string;
  tenantId: string;
  provider: PortalProvider;
  isEnabled: boolean;
  tokenCreatedAt: string;
  tokenRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedHealthMetrics {
  provider: PortalProvider;
  lastReceivedAt: string | null;
  lastProcessedAt: string | null;
  processedCount: number;
  failedCount: number;
}

interface ProviderMeta {
  provider: PortalProvider;
  name: string;
  slug: string;
  description: string;
  docsNote: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    provider: PortalProvider.NINETY_NINE_ACRES,
    name: "99acres",
    slug: "99acres",
    description: "Indian property portal for secondary residential resale and rental lead feeds.",
    docsNote: "Official partner API documentation pending. Real-time webhook ingestion is disabled in production pending verified partner agreement and delivery payload specifications.",
  },
  {
    provider: PortalProvider.MAGICBRICKS,
    name: "Magicbricks",
    slug: "magicbricks",
    description: "High-volume real estate marketplace across Tier 1 and Tier 2 Indian cities.",
    docsNote: "Official partner API documentation pending. Webhook adapter is in draft status. Live ingestion requires confirmed payload schemas and authorized partner feeds.",
  },
  {
    provider: PortalProvider.NOBROKER,
    name: "NoBroker",
    slug: "nobroker",
    description: "Secondary real estate marketplace and buyer query exchange.",
    docsNote: "Official partner API documentation pending. Adapter mapping is unverified. Custom Authorization headers and payload structure must be confirmed with NoBroker account manager.",
  },
];

interface PortalSettingsClientProps {
  initialConfigs: SerializedPortalConfig[];
  initialHealth: Record<string, SerializedHealthMetrics>;
  baseUrl: string;
  currentUserRole: UserRole;
}

export function PortalSettingsClient({
  initialConfigs,
  initialHealth,
  baseUrl,
  currentUserRole,
}: PortalSettingsClientProps) {
  const [configs, setConfigs] = useState<Record<string, SerializedPortalConfig>>(() => {
    const map: Record<string, SerializedPortalConfig> = {};
    for (const c of initialConfigs) {
      map[c.provider] = c;
    }
    return map;
  });

  const [health] = useState<Record<string, SerializedHealthMetrics>>(initialHealth);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // One-time token disclosure state (discarded immediately upon modal close)
  const [disclosedToken, setDisclosedToken] = useState<{
    providerName: string;
    rawToken: string;
    isRotation: boolean;
  } | null>(null);

  // Rotation confirmation modal state
  const [rotationTarget, setRotationTarget] = useState<ProviderMeta | null>(null);

  // Copy-to-clipboard state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setFeedback({ type: "error", message: "Failed to copy to clipboard." });
    }
  };

  const handleToggleStatus = async (provider: PortalProvider, newStatus: boolean) => {
    setLoadingProvider(provider);
    setFeedback(null);

    const res = await togglePortalIntegrationStatusAction(provider, newStatus);
    setLoadingProvider(null);

    if (res.success && res.data) {
      const updated = res.data;
      setConfigs((prev) => ({
        ...prev,
        [provider]: {
          id: updated.id,
          tenantId: updated.tenantId,
          provider: updated.provider,
          isEnabled: updated.isEnabled,
          tokenCreatedAt: updated.tokenCreatedAt instanceof Date ? updated.tokenCreatedAt.toISOString() : String(updated.tokenCreatedAt),
          tokenRotatedAt: updated.tokenRotatedAt ? (updated.tokenRotatedAt instanceof Date ? updated.tokenRotatedAt.toISOString() : String(updated.tokenRotatedAt)) : null,
          createdAt: updated.createdAt instanceof Date ? updated.createdAt.toISOString() : String(updated.createdAt),
          updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : String(updated.updatedAt),
        },
      }));
      setFeedback({
        type: "success",
        message: `${provider} integration ${newStatus ? "enabled" : "disabled"} successfully.`,
      });
    } else {
      setFeedback({
        type: "error",
        message: res.error || "Failed to update integration status.",
      });
    }
  };

  const handleGenerateToken = async (meta: ProviderMeta) => {
    setLoadingProvider(meta.provider);
    setFeedback(null);

    const res = await generatePortalWebhookTokenAction(meta.provider, true);
    setLoadingProvider(null);

    if (res.success && res.data) {
      const { config: updated, rawToken } = res.data;
      setConfigs((prev) => ({
        ...prev,
        [meta.provider]: {
          id: updated.id,
          tenantId: updated.tenantId,
          provider: updated.provider,
          isEnabled: updated.isEnabled,
          tokenCreatedAt: updated.tokenCreatedAt instanceof Date ? updated.tokenCreatedAt.toISOString() : String(updated.tokenCreatedAt),
          tokenRotatedAt: updated.tokenRotatedAt ? (updated.tokenRotatedAt instanceof Date ? updated.tokenRotatedAt.toISOString() : String(updated.tokenRotatedAt)) : null,
          createdAt: updated.createdAt instanceof Date ? updated.createdAt.toISOString() : String(updated.createdAt),
          updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : String(updated.updatedAt),
        },
      }));

      // Display one-time reveal modal
      setDisclosedToken({
        providerName: meta.name,
        rawToken,
        isRotation: false,
      });
    } else {
      setFeedback({
        type: "error",
        message: res.error || "Failed to generate webhook token.",
      });
    }
  };

  const handleConfirmRotation = async () => {
    if (!rotationTarget) return;
    const meta = rotationTarget;
    setRotationTarget(null);
    setLoadingProvider(meta.provider);
    setFeedback(null);

    const res = await rotatePortalWebhookTokenAction(meta.provider);
    setLoadingProvider(null);

    if (res.success && res.data) {
      const { config: updated, rawToken } = res.data;
      setConfigs((prev) => ({
        ...prev,
        [meta.provider]: {
          id: updated.id,
          tenantId: updated.tenantId,
          provider: updated.provider,
          isEnabled: updated.isEnabled,
          tokenCreatedAt: updated.tokenCreatedAt instanceof Date ? updated.tokenCreatedAt.toISOString() : String(updated.tokenCreatedAt),
          tokenRotatedAt: updated.tokenRotatedAt ? (updated.tokenRotatedAt instanceof Date ? updated.tokenRotatedAt.toISOString() : String(updated.tokenRotatedAt)) : null,
          createdAt: updated.createdAt instanceof Date ? updated.createdAt.toISOString() : String(updated.createdAt),
          updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : String(updated.updatedAt),
        },
      }));

      // Display one-time reveal modal for rotated token
      setDisclosedToken({
        providerName: meta.name,
        rawToken,
        isRotation: true,
      });
    } else {
      setFeedback({
        type: "error",
        message: res.error || "Failed to rotate webhook token.",
      });
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "None";
    try {
      const d = new Date(iso);
      return d.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="bg-[#F7F5F0] min-h-screen py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white border border-[#E4DFD5] rounded-lg p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#E6F4F1] text-[#1F6F6B] rounded-md">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-[#1E2A32]">External Property Portal Integrations</h1>
                  <p className="text-sm text-[#667085] mt-0.5">
                    Configure inbound webhook endpoints and access tokens for external secondary property lead feeds.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[#667085] bg-[#F0EEE9] px-2.5 py-1 rounded">
                Admin Role: {currentUserRole}
              </span>
            </div>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`p-4 rounded-lg border text-sm flex items-center justify-between shadow-sm ${
              feedback.type === "success"
                ? "bg-green-50 border-green-200 text-[#2E7D4F]"
                : "bg-red-50 border-red-200 text-[#B3261E]"
            }`}
          >
            <span>{feedback.message}</span>
            <button
              onClick={() => setFeedback(null)}
              className="text-xs underline ml-4 hover:opacity-80"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Provider Cards */}
        <div className="grid grid-cols-1 gap-6">
          {PROVIDERS.map((meta) => {
            const config = configs[meta.provider];
            const isConfigured = Boolean(config);
            const isEnabled = Boolean(config?.isEnabled);
            const webhookUrl = `${baseUrl}/api/webhooks/portals/${meta.slug}`;
            const metrics = health[meta.provider];
            const isLoading = loadingProvider === meta.provider;

            return (
              <div
                key={meta.provider}
                className="bg-white border border-[#E4DFD5] rounded-lg shadow-sm overflow-hidden"
              >
                {/* Card Header */}
                <div className="p-6 border-b border-[#E4DFD5] flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-bold text-[#1E2A32]">{meta.name}</h2>
                      {/* Configuration & Status Badges */}
                      {isConfigured ? (
                        isEnabled ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-[#2E7D4F] border border-green-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#2E7D4F]" />
                            Configured & Enabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-[#B7791F] border border-amber-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#B7791F]" />
                            Configured (Disabled)
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-[#667085] border border-gray-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                          Not Configured
                        </span>
                      )}

                      {/* Unverified Adapter Status Badge */}
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-[#C4641D] border border-orange-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#C4641D]" />
                        Adapter: Draft / Unverified
                      </span>
                    </div>
                    <p className="text-sm text-[#667085] mt-1">{meta.description}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3">
                    {isConfigured ? (
                      <>
                        <button
                          type="button"
                          disabled={isLoading}
                          onClick={() => handleToggleStatus(meta.provider, !isEnabled)}
                          className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                            isEnabled
                              ? "bg-white border-[#E4DFD5] text-[#B3261E] hover:bg-red-50 hover:border-red-200"
                              : "bg-white border-[#E4DFD5] text-[#2E7D4F] hover:bg-green-50 hover:border-green-200"
                          } disabled:opacity-50`}
                        >
                          {isEnabled ? "Disable Integration" : "Enable Integration"}
                        </button>
                        <button
                          type="button"
                          disabled={isLoading}
                          onClick={() => setRotationTarget(meta)}
                          className="px-3 py-1.5 text-xs font-medium rounded border border-[#E4DFD5] text-[#1E2A32] bg-white hover:bg-[#F7F5F0] transition-colors disabled:opacity-50"
                        >
                          Rotate Token
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleGenerateToken(meta)}
                        className="px-4 py-2 text-xs font-medium rounded bg-[#1F6F6B] text-white hover:bg-[#185754] transition-colors shadow-sm disabled:opacity-50"
                      >
                        {isLoading ? "Generating..." : "Generate Webhook Token"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-6 space-y-6">
                  {/* Unverified Boundary Advisory */}
                  <div className="bg-[#FFF9F2] border border-[#FDE6CF] rounded-md p-3.5 text-xs text-[#9A4C13] flex gap-2.5">
                    <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#C4641D]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <span className="font-semibold">Provider Mapping Notice: </span>
                      {meta.docsNote}
                    </div>
                  </div>

                  {/* Webhook Endpoint Presentation */}
                  <div>
                    <label className="block text-xs font-semibold text-[#1E2A32] uppercase tracking-wider mb-1.5">
                      Webhook Inbound URL
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-[#F7F5F0] border border-[#E4DFD5] rounded px-3 py-2 text-xs font-mono text-[#1E2A32] select-all overflow-x-auto">
                        {webhookUrl}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(webhookUrl, `url-${meta.provider}`)}
                        className="px-3 py-2 text-xs font-medium rounded border border-[#E4DFD5] bg-white text-[#1E2A32] hover:bg-[#F7F5F0] transition-colors flex items-center gap-1.5"
                      >
                        <svg className="w-3.5 h-3.5 text-[#667085]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        {copiedKey === `url-${meta.provider}` ? "Copied!" : "Copy URL"}
                      </button>
                    </div>
                    <p className="text-xs text-[#667085] mt-1.5">
                      Method: <span className="font-semibold text-[#1E2A32]">POST</span> only. The portal dispatcher must supply the bearer token in the <code className="bg-[#F0EEE9] px-1 py-0.5 rounded text-[11px]">Authorization: Bearer &lt;token&gt;</code> HTTP header.
                    </p>
                  </div>

                  {/* Token & Security Metadata */}
                  <div className="bg-[#FAFAF9] border border-[#E4DFD5] rounded-md p-4">
                    <h3 className="text-xs font-semibold text-[#1E2A32] uppercase tracking-wider mb-3">
                      Token & Security Status
                    </h3>
                    {isConfigured && config ? (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                        <div>
                          <span className="text-[#667085] block">Token Status:</span>
                          <span className="font-medium text-[#1E2A32] mt-0.5 block">
                            Active (SHA-256 Hashed)
                          </span>
                        </div>
                        <div>
                          <span className="text-[#667085] block">Generated On:</span>
                          <span className="font-medium text-[#1E2A32] mt-0.5 block">
                            {formatDate(config.tokenCreatedAt)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#667085] block">Last Rotated:</span>
                          <span className="font-medium text-[#1E2A32] mt-0.5 block">
                            {config.tokenRotatedAt ? formatDate(config.tokenRotatedAt) : "Never rotated"}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-[#667085]">
                        No webhook token has been generated for {meta.name} yet. Click <span className="font-semibold text-[#1E2A32]">&quot;Generate Webhook Token&quot;</span> to initialize authentication for this provider.
                      </p>
                    )}
                  </div>

                  {/* Safe Health & Observability Metrics */}
                  <div className="border border-[#E4DFD5] rounded-md p-4 bg-white">
                    <h3 className="text-xs font-semibold text-[#1E2A32] uppercase tracking-wider mb-3">
                      Safe Ingestion Health & Metrics
                    </h3>
                    {metrics && (metrics.processedCount > 0 || metrics.failedCount > 0 || metrics.lastReceivedAt) ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                        <div className="p-3 bg-[#F7F5F0] rounded border border-[#E4DFD5]">
                          <span className="text-[#667085] block">Processed Leads</span>
                          <span className="text-base font-bold text-[#2E7D4F] mt-1 block">
                            {metrics.processedCount}
                          </span>
                        </div>
                        <div className="p-3 bg-[#F7F5F0] rounded border border-[#E4DFD5]">
                          <span className="text-[#667085] block">Failed Ingestions</span>
                          <span className="text-base font-bold text-[#B3261E] mt-1 block">
                            {metrics.failedCount}
                          </span>
                        </div>
                        <div className="p-3 bg-[#F7F5F0] rounded border border-[#E4DFD5]">
                          <span className="text-[#667085] block">Last Received</span>
                          <span className="font-medium text-[#1E2A32] mt-1 block text-[11px]">
                            {metrics.lastReceivedAt ? formatDate(metrics.lastReceivedAt) : "None"}
                          </span>
                        </div>
                        <div className="p-3 bg-[#F7F5F0] rounded border border-[#E4DFD5]">
                          <span className="text-[#667085] block">Last Processed</span>
                          <span className="font-medium text-[#1E2A32] mt-1 block text-[11px]">
                            {metrics.lastProcessedAt ? formatDate(metrics.lastProcessedAt) : "None"}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-[#667085] flex items-center gap-2 py-1">
                        <span className="w-2 h-2 rounded-full bg-gray-300" />
                        No webhook activity recorded for this provider yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* One-Time Token Reveal Modal */}
      {disclosedToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px]">
          <div className="bg-white border border-[#E4DFD5] rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 text-[#2E7D4F] rounded-full">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1E2A32]">
                  {disclosedToken.isRotation ? "Token Rotated Successfully" : "Webhook Token Generated"}
                </h3>
                <p className="text-xs text-[#667085]">
                  Provider: <span className="font-semibold text-[#1E2A32]">{disclosedToken.providerName}</span>
                </p>
              </div>
            </div>

            {/* Critical Security Warning */}
            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-[#B7791F]">
              <span className="font-semibold">One-Time Disclosure Notice: </span>
              This raw token is shown <span className="underline font-bold">once</span> for your security. It is stored as a one-way SHA-256 hash in the database and <span className="font-bold">cannot be recovered</span> after this window is closed.
            </div>

            {/* Raw Token Display */}
            <div>
              <label className="block text-xs font-semibold text-[#1E2A32] uppercase tracking-wider mb-1">
                Bearer Webhook Token
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-[#F7F5F0] border border-[#E4DFD5] rounded px-3 py-2 text-xs font-mono text-[#1E2A32] select-all break-all max-h-24 overflow-y-auto">
                  {disclosedToken.rawToken}
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(disclosedToken.rawToken, "disclosed-token")}
                  className="px-3 py-2 text-xs font-medium rounded border border-[#E4DFD5] bg-white text-[#1E2A32] hover:bg-[#F7F5F0] transition-colors flex items-center gap-1.5 flex-shrink-0"
                >
                  <svg className="w-3.5 h-3.5 text-[#667085]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  {copiedKey === "disclosed-token" ? "Copied!" : "Copy Token"}
                </button>
              </div>
            </div>

            {/* Close Button — Immediately purges raw token from client state */}
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setDisclosedToken(null)}
                className="px-4 py-2 text-xs font-medium rounded bg-[#1F6F6B] text-white hover:bg-[#185754] transition-colors"
              >
                I have saved this token securely
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rotation Confirmation Modal */}
      {rotationTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px]">
          <div className="bg-white border border-[#E4DFD5] rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-50 text-[#B7791F] rounded-full">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-[#1E2A32]">Confirm Token Rotation</h3>
            </div>
            <p className="text-sm text-[#667085]">
              Are you sure you want to rotate the webhook token for <span className="font-semibold text-[#1E2A32]">{rotationTarget.name}</span>?
            </p>
            <p className="text-xs text-[#B3261E] bg-red-50 p-2.5 rounded border border-red-200">
              Warning: The current token will be immediately invalidated. Any external webhooks using the old token will be rejected with HTTP 401 Unauthorized until reconfigured.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRotationTarget(null)}
                className="px-3.5 py-2 text-xs font-medium rounded border border-[#E4DFD5] text-[#1E2A32] bg-white hover:bg-[#F7F5F0] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRotation}
                className="px-4 py-2 text-xs font-medium rounded bg-[#B3261E] text-white hover:bg-red-700 transition-colors shadow-sm"
              >
                Confirm & Rotate Token
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
