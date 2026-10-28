"use server";

import { prisma } from "@/server/db";
import { randomBytes } from "crypto";
import { hashPassword } from "better-auth/crypto";
import { sendPasswordReset } from "@/server/email";

export async function requestPasswordResetAction(email: string) {
  try {
    const cleanEmail = email?.toLowerCase().trim();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      return {
        success: true,
        message: "If an account exists with this email, a password reset link has been sent.",
      };
    }

    const user = await prisma.user.findFirst({
      where: {
        email: cleanEmail,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (user) {
      // Invalidate any existing password reset tokens for this user
      await prisma.verification.deleteMany({
        where: {
          value: user.id,
          identifier: { startsWith: "reset-password:" },
        },
      });

      const token = randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.verification.create({
        data: {
          identifier: `reset-password:${token}`,
          value: user.id,
          expiresAt,
        },
      });

      await sendPasswordReset({
        email: user.email,
        name: user.name,
        token,
        expiresInMinutes: 60,
      });
    }

    return {
      success: true,
      message: "If an account exists with this email, a password reset link has been sent.",
    };
  } catch (err: unknown) {
    console.error("[Password Reset Request Error]", err);
    return {
      success: false,
      error: "An unexpected error occurred while requesting password reset.",
    };
  }
}

export async function verifyPasswordResetTokenAction(token: string) {
  try {
    if (!token || typeof token !== "string" || !token.trim()) {
      return { success: false, error: "Invalid password reset token." };
    }

    const verification = await prisma.verification.findFirst({
      where: {
        identifier: `reset-password:${token.trim()}`,
      },
    });

    if (!verification) {
      return { success: false, error: "Password reset link is invalid or does not exist." };
    }

    if (verification.expiresAt < new Date()) {
      return { success: false, error: "Password reset link has expired. Please request a new one." };
    }

    return { success: true };
  } catch (err: unknown) {
    console.error("[Verify Reset Token Error]", err);
    return { success: false, error: "Failed to verify password reset link." };
  }
}

export async function resetPasswordAction(input: {
  token: string;
  newPassword: string;
}) {
  try {
    if (!input.newPassword || input.newPassword.length < 8) {
      return { success: false, error: "Password must be at least 8 characters long." };
    }

    if (!input.token || !input.token.trim()) {
      return { success: false, error: "Invalid or missing reset token." };
    }

    const verification = await prisma.verification.findFirst({
      where: {
        identifier: `reset-password:${input.token.trim()}`,
      },
    });

    if (!verification) {
      return { success: false, error: "Password reset token is invalid or does not exist." };
    }

    if (verification.expiresAt < new Date()) {
      return { success: false, error: "Password reset link has expired. Please request a new one." };
    }

    const user = await prisma.user.findUnique({
      where: { id: verification.value },
      select: { id: true, email: true, tenantId: true },
    });

    if (!user) {
      return { success: false, error: "Associated user account was not found." };
    }

    const hashedPassword = await hashPassword(input.newPassword);

    await prisma.$transaction(async (tx) => {
      // 1. Update or create credential account
      await tx.account.upsert({
        where: {
          providerId_accountId: {
            providerId: "credential",
            accountId: user.id,
          },
        },
        update: {
          password: hashedPassword,
          updatedAt: new Date(),
        },
        create: {
          userId: user.id,
          providerId: "credential",
          accountId: user.id,
          password: hashedPassword,
        },
      });

      // 2. Consume (delete) the reset token
      await tx.verification.delete({
        where: { id: verification.id },
      });

      // 3. Log audit event
      await tx.userAuditLog.create({
        data: {
          tenantId: user.tenantId,
          targetUserId: user.id,
          actorUserId: user.id,
          action: "PASSWORD_RESET",
          details: {
            email: user.email,
          },
        },
      });
    });

    return { success: true };
  } catch (err: unknown) {
    console.error("[Reset Password Error]", err);
    return { success: false, error: "An unexpected error occurred while resetting password." };
  }
}

