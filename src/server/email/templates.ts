/**
 * Email Templates Module
 *
 * Implements accessible, responsive Light-Theme HTML email layouts
 * adhering to Broker CRM's design tokens:
 * - Page Background: #F7F5F0
 * - Surface / Card: #FFFFFF
 * - Main Heading: #1E2A32
 * - Muted Text: #667085
 * - Primary Action: #1F6F6B
 * - Subtle Border: #E4DFD5
 */

function wrapEmailLayout(title: string, contentHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #F7F5F0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1E2A32;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #F7F5F0;
      padding: 32px 16px;
      box-sizing: border-box;
    }
    .card {
      max-width: 560px;
      margin: 0 auto;
      background-color: #FFFFFF;
      border: 1px solid #E4DFD5;
      border-radius: 8px;
      padding: 32px 28px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .header {
      border-bottom: 1px solid #E4DFD5;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .brand-badge {
      display: inline-block;
      background-color: #1F6F6B;
      color: #FFFFFF;
      font-weight: 700;
      font-size: 13px;
      padding: 4px 10px;
      border-radius: 6px;
      letter-spacing: 0.5px;
    }
    .h1 {
      font-size: 20px;
      font-weight: 700;
      color: #1E2A32;
      margin: 16px 0 6px 0;
    }
    .p {
      font-size: 14px;
      line-height: 1.5;
      color: #4A5568;
      margin: 0 0 16px 0;
    }
    .btn-container {
      margin: 28px 0;
      text-align: center;
    }
    .btn {
      display: inline-block;
      background-color: #1F6F6B;
      color: #FFFFFF !important;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
      padding: 12px 24px;
      border-radius: 6px;
    }
    .info-box {
      background-color: #F7F5F0;
      border: 1px solid #E4DFD5;
      border-radius: 6px;
      padding: 14px;
      margin: 20px 0;
      font-size: 13px;
      color: #4A5568;
    }
    .info-row {
      margin-bottom: 6px;
    }
    .info-row:last-child {
      margin-bottom: 0;
    }
    .info-label {
      font-weight: 600;
      color: #1E2A32;
    }
    .footer {
      border-top: 1px solid #E4DFD5;
      padding-top: 16px;
      margin-top: 28px;
      font-size: 12px;
      color: #667085;
      line-height: 1.4;
    }
    .break-url {
      word-break: break-all;
      color: #3B5BA9;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <span class="brand-badge">BROKER CRM</span>
      </div>
      ${contentHtml}
      <div class="footer">
        <p style="margin: 0 0 6px 0;">This email was sent by <strong>Broker CRM</strong> for your brokerage account.</p>
        <p style="margin: 0;">If you received this email in error, please contact your brokerage administrator.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// -------------------------------------------------------------
// 1. User Invitation & Account Activation
// -------------------------------------------------------------

export interface InvitationEmailData {
  name: string;
  email: string;
  role: string;
  tenantName: string;
  activationUrl: string;
  expiresInHours?: number;
}

export function renderInvitationEmail(data: InvitationEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const hours = data.expiresInHours || 48;
  const subject = `You're invited to join ${data.tenantName} on Broker CRM`;

  const html = wrapEmailLayout(
    subject,
    `
    <h1 class="h1">Welcome, ${data.name}!</h1>
    <p class="p">
      You have been invited to join <strong>${data.tenantName}</strong> on Broker CRM with the role of <strong>${data.role}</strong>.
    </p>
    <div class="info-box">
      <div class="info-row"><span class="info-label">Organization:</span> ${data.tenantName}</div>
      <div class="info-row"><span class="info-label">Assigned Role:</span> ${data.role}</div>
      <div class="info-row"><span class="info-label">Login Email:</span> ${data.email}</div>
    </div>
    <p class="p">
      Click the button below to activate your account and set your secure password:
    </p>
    <div class="btn-container">
      <a href="${data.activationUrl}" class="btn" target="_blank">Activate Your Account</a>
    </div>
    <p class="p" style="font-size: 12px; color: #667085;">
      This invitation link will expire in <strong>${hours} hours</strong>. If the button above does not work, copy and paste this link into your browser:
      <br>
      <a href="${data.activationUrl}" class="break-url">${data.activationUrl}</a>
    </p>
    `
  );

  const text = `Welcome, ${data.name}!

You have been invited to join ${data.tenantName} on Broker CRM as a ${data.role}.

Organization: ${data.tenantName}
Assigned Role: ${data.role}
Login Email: ${data.email}

Please activate your account and set your password by visiting this link:
${data.activationUrl}

This link is valid for ${hours} hours.
`;

  return { subject, html, text };
}

// -------------------------------------------------------------
// 2. Password Reset Email
// -------------------------------------------------------------

export interface PasswordResetEmailData {
  name: string;
  resetUrl: string;
  expiresInMinutes?: number;
}

export function renderPasswordResetEmail(data: PasswordResetEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const minutes = data.expiresInMinutes || 60;
  const subject = "Reset your Broker CRM password";

  const html = wrapEmailLayout(
    subject,
    `
    <h1 class="h1">Reset Password Request</h1>
    <p class="p">
      Hello ${data.name},
    </p>
    <p class="p">
      We received a request to reset the password for your Broker CRM account. Click the button below to choose a new password:
    </p>
    <div class="btn-container">
      <a href="${data.resetUrl}" class="btn" target="_blank">Reset Password</a>
    </div>
    <div class="info-box" style="border-left: 3px solid #B7791F;">
      <span class="info-label">Security Notice:</span>
      This link will expire in <strong>${minutes} minutes</strong>. If you did not request this password reset, please ignore this email. Your current password remains secure.
    </div>
    <p class="p" style="font-size: 12px; color: #667085;">
      If the button above does not work, copy and paste this URL into your browser:
      <br>
      <a href="${data.resetUrl}" class="break-url">${data.resetUrl}</a>
    </p>
    `
  );

  const text = `Reset Password Request

Hello ${data.name},

We received a request to reset the password for your Broker CRM account.

To choose a new password, open this link:
${data.resetUrl}

This link is valid for ${minutes} minutes. If you did not request this reset, you can safely ignore this email.
`;

  return { subject, html, text };
}

// -------------------------------------------------------------
// 3. Role Change & Account Status Notifications
// -------------------------------------------------------------

export interface RoleChangeEmailData {
  name: string;
  tenantName: string;
  oldRole: string;
  newRole: string;
  loginUrl: string;
}

export function renderRoleChangeEmail(data: RoleChangeEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Your role at ${data.tenantName} has been updated`;

  const html = wrapEmailLayout(
    subject,
    `
    <h1 class="h1">Role Update Notice</h1>
    <p class="p">
      Hello ${data.name},
    </p>
    <p class="p">
      An administrator at <strong>${data.tenantName}</strong> has updated your role in Broker CRM.
    </p>
    <div class="info-box">
      <div class="info-row"><span class="info-label">Previous Role:</span> ${data.oldRole}</div>
      <div class="info-row"><span class="info-label">New Role:</span> <strong>${data.newRole}</strong></div>
      <div class="info-row"><span class="info-label">Brokerage:</span> ${data.tenantName}</div>
    </div>
    <p class="p">
      Your active permissions and dashboard navigation have been updated to reflect your new role.
    </p>
    <div class="btn-container">
      <a href="${data.loginUrl}" class="btn" target="_blank">Open Broker CRM</a>
    </div>
    `
  );

  const text = `Role Update Notice

Hello ${data.name},

Your role at ${data.tenantName} has been updated from ${data.oldRole} to ${data.newRole}.

Sign in to view your updated dashboard:
${data.loginUrl}
`;

  return { subject, html, text };
}

export interface AccountStatusEmailData {
  name: string;
  tenantName: string;
  isActive: boolean;
  loginUrl: string;
}

export function renderAccountStatusEmail(data: AccountStatusEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const statusStr = data.isActive ? "Activated" : "Deactivated";
  const subject = `Your account at ${data.tenantName} has been ${statusStr.toLowerCase()}`;

  const html = wrapEmailLayout(
    subject,
    `
    <h1 class="h1">Account ${statusStr}</h1>
    <p class="p">
      Hello ${data.name},
    </p>
    <p class="p">
      Your Broker CRM account at <strong>${data.tenantName}</strong> has been <strong>${statusStr.toLowerCase()}</strong> by an administrator.
    </p>
    ${
      data.isActive
        ? `
      <p class="p">You can now sign in to access your brokerage workspace:</p>
      <div class="btn-container">
        <a href="${data.loginUrl}" class="btn" target="_blank">Sign In Now</a>
      </div>
      `
        : `
      <div class="info-box" style="border-left: 3px solid #B3261E;">
        <span class="info-label">Notice:</span> While deactivated, you will not be able to log in or access brokerage data. Please contact your administrator if you believe this is in error.
      </div>
      `
    }
    `
  );

  const text = `Account ${statusStr}

Hello ${data.name},

Your Broker CRM account at ${data.tenantName} has been ${statusStr.toLowerCase()}.
${data.isActive ? `You can sign in at: ${data.loginUrl}` : "Access to brokerage operations is currently suspended."}
`;

  return { subject, html, text };
}

