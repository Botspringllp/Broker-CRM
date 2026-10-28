import { sendEmail, SendEmailResult } from "./client";
import { getEmailConfig } from "./config";
import {
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderRoleChangeEmail,
  renderAccountStatusEmail,
  InvitationEmailData,
  PasswordResetEmailData,
  RoleChangeEmailData,
  AccountStatusEmailData,
} from "./templates";

/**
 * High-level Email Service for Broker CRM
 */

export async function sendUserInvitation(
  data: Omit<InvitationEmailData, "activationUrl"> & { token: string }
): Promise<SendEmailResult> {
  const config = getEmailConfig();
  const activationUrl = `${config.appBaseUrl}/activate?token=${encodeURIComponent(data.token)}`;

  const { subject, html, text } = renderInvitationEmail({
    ...data,
    activationUrl,
  });

  return sendEmail({
    to: data.email,
    subject,
    html,
    text,
  });
}

export async function sendPasswordReset(
  data: Omit<PasswordResetEmailData, "resetUrl"> & { email: string; token: string }
): Promise<SendEmailResult> {
  const config = getEmailConfig();
  const resetUrl = `${config.appBaseUrl}/reset-password?token=${encodeURIComponent(data.token)}`;

  const { subject, html, text } = renderPasswordResetEmail({
    name: data.name,
    resetUrl,
    expiresInMinutes: data.expiresInMinutes,
  });

  return sendEmail({
    to: data.email,
    subject,
    html,
    text,
  });
}

export async function sendRoleChangeNotification(
  data: Omit<RoleChangeEmailData, "loginUrl"> & { email: string }
): Promise<SendEmailResult> {
  const config = getEmailConfig();
  const loginUrl = `${config.appBaseUrl}/login`;

  const { subject, html, text } = renderRoleChangeEmail({
    ...data,
    loginUrl,
  });

  return sendEmail({
    to: data.email,
    subject,
    html,
    text,
  });
}

export async function sendAccountStatusNotification(
  data: Omit<AccountStatusEmailData, "loginUrl"> & { email: string }
): Promise<SendEmailResult> {
  const config = getEmailConfig();
  const loginUrl = `${config.appBaseUrl}/login`;

  const { subject, html, text } = renderAccountStatusEmail({
    ...data,
    loginUrl,
  });

  return sendEmail({
    to: data.email,
    subject,
    html,
    text,
  });
}

