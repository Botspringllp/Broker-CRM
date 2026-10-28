/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole } from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";

// Mock Prisma DB module
vi.mock("@/server/db", () => {
  const mockPrisma: any = {
    tenant: {
      findUnique: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    account: {
      create: vi.fn(),
      upsert: vi.fn(),
    },
    verification: {
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    userAuditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

import { prisma } from "@/server/db";
import {
  getEmailConfig,
  verifySmtpConnection,
  sendEmail,
  setTransporterForTesting,
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderRoleChangeEmail,
  renderAccountStatusEmail,
} from "@/server/email";
import {
  createTenantUser,
  resendTenantUserInvitation,
  verifyInvitationToken,
  activateUserAccount,
} from "@/server/dal/users";
import {
  requestPasswordResetAction,
  verifyPasswordResetTokenAction,
  resetPasswordAction,
} from "@/app/login/actions";

describe("Email Integration & Workflow Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(prisma));
  });

  const tenantA = "tenant-alpha";
  const brokerContext: TenantContext = {
    userId: "user-broker-1",
    tenantId: tenantA,
    role: UserRole.BROKER_OWNER,
    user: {
      id: "user-broker-1",
      email: "broker@alpha.crm",
      name: "Broker Owner",
      role: UserRole.BROKER_OWNER,
      tenantId: tenantA,
      isActive: true,
    },
    session: {
      id: "sess-broker",
      token: "tok-broker",
      expiresAt: new Date(Date.now() + 60000),
    },
  };

  // ============================================================
  // 1. SMTP Client & Transport Handling
  // ============================================================
  describe("1. SMTP Client & Transport Handling", () => {
    it("parses email configuration from environment variables with safe defaults", () => {
      const config = getEmailConfig();
      expect(config.host).toBeDefined();
      expect(typeof config.port).toBe("number");
      expect(config.from).toContain("Broker CRM");
      expect(config.appBaseUrl).toMatch(/^https?:\/\//);
    });

    it("verifies SMTP connection successfully when server is reachable", async () => {
      const mockTransporter: any = {
        verify: vi.fn().mockResolvedValue(true),
      };
      setTransporterForTesting(mockTransporter);

      const result = await verifySmtpConnection();
      expect(result.connected).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("surfaces connection errors when SMTP server is unreachable", async () => {
      const mockTransporter: any = {
        verify: vi.fn().mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:1025")),
      };
      setTransporterForTesting(mockTransporter);

      const result = await verifySmtpConnection();
      expect(result.connected).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
    });

    it("sends email and returns messageId on delivery success", async () => {
      const mockTransporter: any = {
        sendMail: vi.fn().mockResolvedValue({ messageId: "<msg-12345@broker-crm>" }),
      };
      setTransporterForTesting(mockTransporter);

      const res = await sendEmail({
        to: "client@example.com",
        subject: "Test Subject",
        html: "<p>Hello World</p>",
      });

      expect(res.success).toBe(true);
      expect(res.messageId).toBe("<msg-12345@broker-crm>");
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "client@example.com",
          subject: "Test Subject",
        })
      );
    });

    it("handles SMTP delivery failure without falsely reporting success", async () => {
      const mockTransporter: any = {
        sendMail: vi.fn().mockRejectedValue(new Error("550 Mailbox unavailable")),
      };
      setTransporterForTesting(mockTransporter);

      const res = await sendEmail({
        to: "invalid@example.com",
        subject: "Test Subject",
        html: "<p>Hello World</p>",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("550 Mailbox unavailable");
      expect(res.messageId).toBeUndefined();
    });
  });

  // ============================================================
  // 2. Email Template Rendering
  // ============================================================
  describe("2. Email Template Rendering", () => {
    it("renders user invitation email with light-theme styling and activation link", () => {
      const tpl = renderInvitationEmail({
        name: "Rahul Telecaller",
        email: "rahul@alpha.crm",
        role: "TELECALLER",
        tenantName: "Apex Realty",
        activationUrl: "http://localhost:3000/activate?token=test-invite-token",
        expiresInHours: 48,
      });

      expect(tpl.subject).toContain("You're invited to join Apex Realty");
      expect(tpl.html).toContain("Welcome, Rahul Telecaller!");
      expect(tpl.html).toContain("Apex Realty");
      expect(tpl.html).toContain("TELECALLER");
      expect(tpl.html).toContain("http://localhost:3000/activate?token=test-invite-token");
      expect(tpl.html).toContain("#1F6F6B"); // Design Token primary teal
      expect(tpl.text).toContain("48 hours");
    });

    it("renders password reset email with secure token link and expiration warning", () => {
      const tpl = renderPasswordResetEmail({
        name: "Pooja TeamLeader",
        resetUrl: "http://localhost:3000/reset-password?token=test-reset-token",
        expiresInMinutes: 60,
      });

      expect(tpl.subject).toContain("Reset your Broker CRM password");
      expect(tpl.html).toContain("Pooja TeamLeader");
      expect(tpl.html).toContain("http://localhost:3000/reset-password?token=test-reset-token");
      expect(tpl.html).toContain("60 minutes");
      expect(tpl.html).toContain("Security Notice");
      expect(tpl.text).toContain("safely ignore this email");
    });

    it("renders role change notification with previous and new roles", () => {
      const tpl = renderRoleChangeEmail({
        name: "Amit Verifier",
        tenantName: "Apex Realty",
        oldRole: "TELECALLER",
        newRole: "FIELD_VERIFIER",
        loginUrl: "http://localhost:3000/login",
      });

      expect(tpl.subject).toContain("Your role at Apex Realty has been updated");
      expect(tpl.html).toContain("Previous Role:");
      expect(tpl.html).toContain("TELECALLER");
      expect(tpl.html).toContain("FIELD_VERIFIER");
      expect(tpl.text).toContain("TELECALLER to FIELD_VERIFIER");
    });

    it("renders account status notification (activation and deactivation)", () => {
      const activeTpl = renderAccountStatusEmail({
        name: "Suresh Agent",
        tenantName: "Apex Realty",
        isActive: true,
        loginUrl: "http://localhost:3000/login",
      });
      expect(activeTpl.subject).toContain("activated");
      expect(activeTpl.html).toContain("Account Activated");

      const inactiveTpl = renderAccountStatusEmail({
        name: "Suresh Agent",
        tenantName: "Apex Realty",
        isActive: false,
        loginUrl: "http://localhost:3000/login",
      });
      expect(inactiveTpl.subject).toContain("deactivated");
      expect(inactiveTpl.html).toContain("deactivated");
    });
  });

  // ============================================================
  // 3. User Invitation & Account Activation DAL Workflows
  // ============================================================
  describe("3. User Invitation & Account Activation DAL", () => {
    it("creates user, creates single-use invitation token, and dispatches invitation email", async () => {
      const mockTransporter: any = {
        sendMail: vi.fn().mockResolvedValue({ messageId: "<inv-123@broker-crm>" }),
      };
      setTransporterForTesting(mockTransporter);

      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: tenantA,
        name: "Alpha Realty",
        maxSeats: 10,
      } as any);

      vi.mocked(prisma.user.count).mockResolvedValue(2);

      vi.mocked(prisma.user.create).mockResolvedValue({
        id: "user-new-1",
        tenantId: tenantA,
        name: "Karan Agent",
        email: "karan@alpha.crm",
        phone: "9876543210",
        role: UserRole.FIELD_SALES_AGENT,
        isActive: true,
        brokerId: brokerContext.userId,
        teamLeaderId: null,
        delegatedPermissions: [],
      } as any);

      vi.mocked(prisma.verification.create).mockResolvedValue({
        id: "verif-1",
        identifier: "invitation:mock-token-hex",
        value: "user-new-1",
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
      } as any);

      const newUser = await createTenantUser(brokerContext, {
        name: "Karan Agent",
        email: "karan@alpha.crm",
        role: UserRole.FIELD_SALES_AGENT,
      });

      expect(newUser.id).toBe("user-new-1");
      expect(prisma.verification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            identifier: expect.stringMatching(/^invitation:[a-f0-9]{64}$/),
            value: "user-new-1",
          }),
        })
      );
    });

    it("resends invitation: invalidates old tokens, creates new token, and logs audit event", async () => {
      const mockTransporter: any = {
        sendMail: vi.fn().mockResolvedValue({ messageId: "<resend-123@broker-crm>" }),
      };
      setTransporterForTesting(mockTransporter);

      vi.mocked(prisma.user.findFirst).mockResolvedValue({
        id: "user-existing-1",
        tenantId: tenantA,
        name: "Existing Agent",
        email: "existing@alpha.crm",
        role: UserRole.TELECALLER,
        brokerId: brokerContext.userId,
        isActive: true,
      } as any);

      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: tenantA,
        name: "Alpha Realty",
      } as any);

      vi.mocked(prisma.verification.deleteMany).mockResolvedValue({ count: 1 } as any);
      vi.mocked(prisma.verification.create).mockResolvedValue({
        id: "verif-new",
        identifier: "invitation:new-token",
        value: "user-existing-1",
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
      } as any);

      const res = await resendTenantUserInvitation(brokerContext, "user-existing-1");
      expect(res.success).toBe(true);
      expect(res.email).toBe("existing@alpha.crm");
      expect(prisma.verification.deleteMany).toHaveBeenCalled();
      expect(prisma.userAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "INVITATION_RESENT",
            targetUserId: "user-existing-1",
          }),
        })
      );
    });

    it("verifies valid invitation token and rejects expired or unknown tokens", async () => {
      // 1. Unknown token
      vi.mocked(prisma.verification.findFirst).mockResolvedValueOnce(null);
      await expect(verifyInvitationToken("unknown-token")).rejects.toThrow("Invitation link is invalid");

      // 2. Expired token
      vi.mocked(prisma.verification.findFirst).mockResolvedValueOnce({
        id: "verif-expired",
        identifier: "invitation:expired-token",
        value: "user-1",
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      } as any);
      await expect(verifyInvitationToken("expired-token")).rejects.toThrow("expired");

      // 3. Valid active token
      vi.mocked(prisma.verification.findFirst).mockResolvedValueOnce({
        id: "verif-valid",
        identifier: "invitation:valid-token",
        value: "user-1",
        expiresAt: new Date(Date.now() + 3600000),
      } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "user-1",
        name: "Valid User",
        email: "valid@alpha.crm",
        role: UserRole.TELECALLER,
        isActive: true,
        tenantId: tenantA,
        tenant: { id: tenantA, name: "Alpha Realty" },
      } as any);

      const verified = await verifyInvitationToken("valid-token");
      expect(verified.user.name).toBe("Valid User");
      expect(verified.user.tenant.name).toBe("Alpha Realty");
    });

    it("activates account: sets password, consumes token, and verifies email", async () => {
      vi.mocked(prisma.verification.findFirst).mockResolvedValueOnce({
        id: "verif-act",
        identifier: "invitation:act-token",
        value: "user-1",
        expiresAt: new Date(Date.now() + 3600000),
      } as any);

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "user-1",
        name: "User To Activate",
        email: "activate@alpha.crm",
        role: UserRole.TELECALLER,
        isActive: true,
        tenantId: tenantA,
        tenant: { id: tenantA, name: "Alpha Realty" },
      } as any);

      vi.mocked(prisma.account.upsert).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.user.update).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.verification.delete).mockResolvedValueOnce({} as any);

      const result = await activateUserAccount("act-token", "NewSecurePassword123!");
      expect(result.success).toBe(true);
      expect(prisma.account.upsert).toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "user-1" },
          data: expect.objectContaining({ emailVerified: true }),
        })
      );
      expect(prisma.verification.delete).toHaveBeenCalledWith({
        where: { id: "verif-act" },
      });
    });

    it("rejects activation with passwords shorter than 8 characters", async () => {
      await expect(activateUserAccount("some-token", "short")).rejects.toThrow(
        "Password must be at least 8 characters long"
      );
    });
  });

  // ============================================================
  // 4. Password Reset Workflows & Actions
  // ============================================================
  describe("4. Password Reset Workflows & Actions", () => {
    it("requestPasswordResetAction: sends reset email with token and protects against email enumeration", async () => {
      const mockTransporter: any = {
        sendMail: vi.fn().mockResolvedValue({ messageId: "<reset-msg-1@broker-crm>" }),
      };
      setTransporterForTesting(mockTransporter);

      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: "user-reset-1",
        name: "Reset Target",
        email: "target@alpha.crm",
      } as any);

      vi.mocked(prisma.verification.deleteMany).mockResolvedValueOnce({ count: 0 } as any);
      vi.mocked(prisma.verification.create).mockResolvedValueOnce({
        id: "verif-reset-1",
        identifier: "reset-password:mock-hex",
        value: "user-reset-1",
        expiresAt: new Date(Date.now() + 3600000),
      } as any);

      const res = await requestPasswordResetAction("target@alpha.crm");
      expect(res.success).toBe(true);
      expect(res.message).toContain("password reset link");
      expect(prisma.verification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            identifier: expect.stringMatching(/^reset-password:[a-f0-9]{48}$/),
            value: "user-reset-1",
          }),
        })
      );

      // Non-existent email still returns success to mitigate timing / enumeration attacks
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
      const nonExistent = await requestPasswordResetAction("unknown@nowhere.com");
      expect(nonExistent.success).toBe(true);
      expect(nonExistent.message).toContain("password reset link");
    });

    it("verifyPasswordResetTokenAction: validates active tokens and flags expired ones", async () => {
      // Missing
      const missing = await verifyPasswordResetTokenAction("");
      expect(missing.success).toBe(false);

      // Unknown
      vi.mocked(prisma.verification.findFirst).mockResolvedValueOnce(null);
      const unknown = await verifyPasswordResetTokenAction("bad-token");
      expect(unknown.success).toBe(false);
      expect(unknown.error).toContain("invalid or does not exist");

      // Expired
      vi.mocked(prisma.verification.findFirst).mockResolvedValueOnce({
        id: "exp-v",
        identifier: "reset-password:old",
        value: "u1",
        expiresAt: new Date(Date.now() - 5000),
      } as any);
      const expired = await verifyPasswordResetTokenAction("old");
      expect(expired.success).toBe(false);
      expect(expired.error).toContain("expired");

      // Valid
      vi.mocked(prisma.verification.findFirst).mockResolvedValueOnce({
        id: "valid-v",
        identifier: "reset-password:valid",
        value: "u1",
        expiresAt: new Date(Date.now() + 50000),
      } as any);
      const valid = await verifyPasswordResetTokenAction("valid");
      expect(valid.success).toBe(true);
    });

    it("resetPasswordAction: updates password, consumes token, and audits event", async () => {
      vi.mocked(prisma.verification.findFirst).mockResolvedValueOnce({
        id: "token-to-consume",
        identifier: "reset-password:valid-token-123",
        value: "user-pwd-reset",
        expiresAt: new Date(Date.now() + 60000),
      } as any);

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "user-pwd-reset",
        email: "pwd@alpha.crm",
        tenantId: tenantA,
      } as any);

      vi.mocked(prisma.account.upsert).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.verification.delete).mockResolvedValueOnce({} as any);

      const res = await resetPasswordAction({
        token: "valid-token-123",
        newPassword: "BrandNewSecurePassword123!",
      });

      expect(res.success).toBe(true);
      expect(prisma.account.upsert).toHaveBeenCalled();
      expect(prisma.verification.delete).toHaveBeenCalledWith({
        where: { id: "token-to-consume" },
      });
      expect(prisma.userAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "PASSWORD_RESET",
            targetUserId: "user-pwd-reset",
          }),
        })
      );
    });
  });
});
