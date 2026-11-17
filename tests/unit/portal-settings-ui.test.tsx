/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { PortalProvider, UserRole } from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/portals",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/server/tenant-context", () => ({
  requireTenantContext: vi.fn(),
}));

vi.mock("@/server/dal/portal-config", () => ({
  listTenantPortalConfigs: vi.fn(),
  getTenantPortalConfig: vi.fn(),
  setPortalIntegrationStatus: vi.fn(),
  generatePortalWebhookToken: vi.fn(),
  rotatePortalWebhookToken: vi.fn(),
  getTenantPortalHealthMetrics: vi.fn(),
  validatePortalProvider: (p: any) => p as PortalProvider,
  assertAuthorizedPortalAdmin: vi.fn((ctx: TenantContext) => {
    if (ctx.role !== UserRole.BROKER_OWNER && ctx.role !== UserRole.CRM_TENANT_ADMIN) {
      throw new Error(`Access denied: role '${ctx.role}' is not authorized.`);
    }
  }),
}));

import { requireTenantContext } from "@/server/tenant-context";
import * as portalConfigDAL from "@/server/dal/portal-config";
import {
  getPortalConfigurationsAction,
  togglePortalIntegrationStatusAction,
  generatePortalWebhookTokenAction,
  rotatePortalWebhookTokenAction,
} from "@/app/settings/portals/actions";
import {
  PortalSettingsClient,
  SerializedPortalConfig,
  SerializedHealthMetrics,
} from "@/app/settings/portals/PortalSettingsClient";

describe("Broker Portal Settings UI & Server Actions (Stage 3C)", () => {
  const mockTenantId = "tenant-alpha-uuid";

  const brokerOwnerContext: TenantContext = {
    userId: "user-broker-1",
    tenantId: mockTenantId,
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-broker-1",
      email: "broker@alpha.internal",
      name: "Broker Alpha",
      role: UserRole.BROKER_OWNER,
      tenantId: mockTenantId,
      isActive: true,
    },
    session: {
      id: "session-1",
      token: "mock-token",
      expiresAt: new Date(Date.now() + 3600000),
    },
  };

  const telecallerContext: TenantContext = {
    userId: "user-caller-1",
    tenantId: mockTenantId,
    role: UserRole.TELECALLER,
    user: {
      id: "user-caller-1",
      email: "caller@alpha.internal",
      name: "Telecaller Alpha",
      role: UserRole.TELECALLER,
      tenantId: mockTenantId,
      isActive: true,
    },
    session: {
      id: "session-2",
      token: "mock-token-caller",
      expiresAt: new Date(Date.now() + 3600000),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Server Actions Authorization & Scoping
  // =========================================================================
  describe("Server Actions: Authorization & Security", () => {
    it("1. Rejects unauthenticated requests with clean error message", async () => {
      vi.mocked(requireTenantContext).mockRejectedValueOnce(new Error("Authentication required."));

      const res = await getPortalConfigurationsAction();
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/authentication required/i);
    });

    it("2. Rejects unauthorized roles (TELECALLER) from retrieving configs", async () => {
      vi.mocked(requireTenantContext).mockResolvedValueOnce(telecallerContext);
      vi.mocked(portalConfigDAL.listTenantPortalConfigs).mockImplementationOnce(() => {
        throw new Error("Access denied: role 'TELECALLER' is not authorized.");
      });

      const res = await getPortalConfigurationsAction();
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/access denied/i);
    });

    it("3. Allows authorized admin (BROKER_OWNER) to list configs and health metrics", async () => {
      vi.mocked(requireTenantContext).mockResolvedValueOnce(brokerOwnerContext);
      vi.mocked(portalConfigDAL.listTenantPortalConfigs).mockResolvedValueOnce([
        {
          id: "cfg-1",
          tenantId: mockTenantId,
          provider: PortalProvider.NINETY_NINE_ACRES,
          isEnabled: true,
          tokenCreatedAt: new Date(),
          tokenRotatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      vi.mocked(portalConfigDAL.getTenantPortalHealthMetrics).mockResolvedValueOnce({
        [PortalProvider.NINETY_NINE_ACRES]: {
          provider: PortalProvider.NINETY_NINE_ACRES,
          lastReceivedAt: new Date(),
          lastProcessedAt: new Date(),
          processedCount: 15,
          failedCount: 1,
        },
        [PortalProvider.MAGICBRICKS]: {
          provider: PortalProvider.MAGICBRICKS,
          lastReceivedAt: null,
          lastProcessedAt: null,
          processedCount: 0,
          failedCount: 0,
        },
        [PortalProvider.NOBROKER]: {
          provider: PortalProvider.NOBROKER,
          lastReceivedAt: null,
          lastProcessedAt: null,
          processedCount: 0,
          failedCount: 0,
        },
      });

      const res = await getPortalConfigurationsAction();
      expect(res.success).toBe(true);
      expect(res.data?.configs).toHaveLength(1);
      expect(res.data?.healthMetrics[PortalProvider.NINETY_NINE_ACRES].processedCount).toBe(15);
      // Ensure no token hash is present
      expect((res.data?.configs[0] as any).webhookTokenHash).toBeUndefined();
    });

    it("4. Rejects unauthorized roles from toggling integration status", async () => {
      vi.mocked(requireTenantContext).mockResolvedValueOnce(telecallerContext);
      vi.mocked(portalConfigDAL.setPortalIntegrationStatus).mockImplementationOnce(() => {
        throw new Error("Access denied: role 'TELECALLER' is not authorized.");
      });

      const res = await togglePortalIntegrationStatusAction(PortalProvider.NINETY_NINE_ACRES, false);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/access denied/i);
    });

    it("5. Allows authorized admin to toggle integration status and revalidates path", async () => {
      vi.mocked(requireTenantContext).mockResolvedValueOnce(brokerOwnerContext);
      vi.mocked(portalConfigDAL.setPortalIntegrationStatus).mockResolvedValueOnce({
        id: "cfg-1",
        tenantId: mockTenantId,
        provider: PortalProvider.NINETY_NINE_ACRES,
        isEnabled: false,
        tokenCreatedAt: new Date(),
        tokenRotatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await togglePortalIntegrationStatusAction(PortalProvider.NINETY_NINE_ACRES, false);
      expect(res.success).toBe(true);
      expect(res.data?.isEnabled).toBe(false);
      expect(portalConfigDAL.setPortalIntegrationStatus).toHaveBeenCalledWith(
        brokerOwnerContext,
        PortalProvider.NINETY_NINE_ACRES,
        false
      );
    });

    it("6. Generates token and discloses rawToken only once in action result", async () => {
      vi.mocked(requireTenantContext).mockResolvedValueOnce(brokerOwnerContext);
      vi.mocked(portalConfigDAL.generatePortalWebhookToken).mockResolvedValueOnce({
        config: {
          id: "cfg-2",
          tenantId: mockTenantId,
          provider: PortalProvider.MAGICBRICKS,
          isEnabled: true,
          tokenCreatedAt: new Date(),
          tokenRotatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        rawToken: "secret_raw_token_value_disclosed_once_0123456789",
      });

      const res = await generatePortalWebhookTokenAction(PortalProvider.MAGICBRICKS, true);
      expect(res.success).toBe(true);
      expect(res.data?.rawToken).toBe("secret_raw_token_value_disclosed_once_0123456789");
      expect(res.data?.config.provider).toBe(PortalProvider.MAGICBRICKS);
      // Ensure no token hash leaked
      expect((res.data?.config as any).webhookTokenHash).toBeUndefined();
    });

    it("7. Rotates token and discloses new rawToken once", async () => {
      vi.mocked(requireTenantContext).mockResolvedValueOnce(brokerOwnerContext);
      vi.mocked(portalConfigDAL.rotatePortalWebhookToken).mockResolvedValueOnce({
        config: {
          id: "cfg-1",
          tenantId: mockTenantId,
          provider: PortalProvider.NINETY_NINE_ACRES,
          isEnabled: true,
          tokenCreatedAt: new Date(),
          tokenRotatedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        rawToken: "fresh_rotated_raw_token_value_0123456789",
      });

      const res = await rotatePortalWebhookTokenAction(PortalProvider.NINETY_NINE_ACRES);
      expect(res.success).toBe(true);
      expect(res.data?.rawToken).toBe("fresh_rotated_raw_token_value_0123456789");
      expect(portalConfigDAL.rotatePortalWebhookToken).toHaveBeenCalledWith(
        brokerOwnerContext,
        PortalProvider.NINETY_NINE_ACRES
      );
    });
  });

  // =========================================================================
  // 2. UI Rendering & Client Component Specifications
  // =========================================================================
  describe("UI Component: PortalSettingsClient", () => {
    const sampleConfig: SerializedPortalConfig = {
      id: "cfg-1",
      tenantId: mockTenantId,
      provider: PortalProvider.NINETY_NINE_ACRES,
      isEnabled: true,
      tokenCreatedAt: "2026-11-15T10:00:00.000Z",
      tokenRotatedAt: null,
      createdAt: "2026-11-15T10:00:00.000Z",
      updatedAt: "2026-11-15T10:00:00.000Z",
    };

    const sampleHealth: Record<string, SerializedHealthMetrics> = {
      [PortalProvider.NINETY_NINE_ACRES]: {
        provider: PortalProvider.NINETY_NINE_ACRES,
        lastReceivedAt: "2026-11-16T12:00:00.000Z",
        lastProcessedAt: "2026-11-16T12:00:05.000Z",
        processedCount: 42,
        failedCount: 2,
      },
    };

    it("8. Renders all three provider cards (99acres, Magicbricks, NoBroker)", () => {
      const html = renderToString(
        <PortalSettingsClient
          initialConfigs={[sampleConfig]}
          initialHealth={sampleHealth}
          baseUrl="https://crm.brokerage.internal"
          currentUserRole={UserRole.BROKER_OWNER}
        />
      );

      expect(html).toContain("99acres");
      expect(html).toContain("Magicbricks");
      expect(html).toContain("NoBroker");
    });

    it("9. Clearly displays distinct configuration statuses (Configured & Enabled vs Not Configured)", () => {
      const html = renderToString(
        <PortalSettingsClient
          initialConfigs={[sampleConfig]}
          initialHealth={sampleHealth}
          baseUrl="https://crm.brokerage.internal"
          currentUserRole={UserRole.BROKER_OWNER}
        />
      );

      // 99acres is configured and enabled
      expect(html).toContain("Configured &amp; Enabled");
      expect(html).toContain("Rotate Token");
      expect(html).toContain("Disable Integration");

      // Magicbricks and NoBroker are not configured
      expect(html).toContain("Not Configured");
      expect(html).toContain("Generate Webhook Token");
    });

    it("10. Clearly displays unverified adapter status on all cards", () => {
      const html = renderToString(
        <PortalSettingsClient
          initialConfigs={[sampleConfig]}
          initialHealth={sampleHealth}
          baseUrl="https://crm.brokerage.internal"
          currentUserRole={UserRole.BROKER_OWNER}
        />
      );

      // Shows unverified badge on all three cards
      const matches = html.match(/Adapter: Draft \/ Unverified/g);
      expect(matches?.length).toBe(3);

      // Shows documentation notice
      expect(html).toContain("Official partner API documentation pending");
    });

    it("11. Webhook URL presentation displays endpoint cleanly without token query parameter", () => {
      const html = renderToString(
        <PortalSettingsClient
          initialConfigs={[sampleConfig]}
          initialHealth={sampleHealth}
          baseUrl="https://crm.brokerage.internal"
          currentUserRole={UserRole.BROKER_OWNER}
        />
      );

      expect(html).toContain("https://crm.brokerage.internal/api/webhooks/portals/99acres");
      expect(html).toContain("https://crm.brokerage.internal/api/webhooks/portals/magicbricks");
      expect(html).toContain("https://crm.brokerage.internal/api/webhooks/portals/nobroker");

      // Critical check: Never append ?token= or secret in the URL
      expect(html).not.toContain("?token=");
      expect(html).not.toContain("&amp;token=");
    });

    it("12. Health metrics display safe aggregate counts and omit customer PII", () => {
      const html = renderToString(
        <PortalSettingsClient
          initialConfigs={[sampleConfig]}
          initialHealth={sampleHealth}
          baseUrl="https://crm.brokerage.internal"
          currentUserRole={UserRole.BROKER_OWNER}
        />
      );

      // Safe processed lead count for 99acres
      expect(html).toContain("42");
      expect(html).toContain("Processed Leads");
      expect(html).toContain("Failed Ingestions");

      // Honest empty state for unconfigured provider
      expect(html).toContain("No webhook activity recorded for this provider yet.");

      // No customer PII leaked
      expect(html).not.toMatch(/\+91[0-9]{10}/);
      expect(html).not.toMatch(/@example\.com/);
    });

    it("13. Token security metadata indicates SHA-256 storage without exposing hash", () => {
      const html = renderToString(
        <PortalSettingsClient
          initialConfigs={[sampleConfig]}
          initialHealth={sampleHealth}
          baseUrl="https://crm.brokerage.internal"
          currentUserRole={UserRole.BROKER_OWNER}
        />
      );

      expect(html).toContain("Active (SHA-256 Hashed)");
      expect(html).not.toMatch(/[a-f0-9]{64}/); // No 64-char hex hash in HTML
    });

    it("14. Light-theme styling adherence (no dark mode styling)", () => {
      const html = renderToString(
        <PortalSettingsClient
          initialConfigs={[sampleConfig]}
          initialHealth={sampleHealth}
          baseUrl="https://crm.brokerage.internal"
          currentUserRole={UserRole.BROKER_OWNER}
        />
      );

      // Light background and clean borders
      expect(html).toContain("bg-[#F7F5F0]");
      expect(html).toContain("border-[#E4DFD5]");
      expect(html).toContain("bg-white");

      // No dark mode classes
      expect(html).not.toContain("dark:bg-");
      expect(html).not.toContain("dark:text-");
    });
  });
});
