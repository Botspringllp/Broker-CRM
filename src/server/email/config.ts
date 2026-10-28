/**
 * Email & SMTP Configuration Module
 * 
 * Supports local development with Mailpit (SMTP localhost:1025, Web UI localhost:8025)
 * and production SMTP providers (Amazon SES, SendGrid, Postmark, etc.) via environment variables.
 */

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  appBaseUrl: string;
}

export function getEmailConfig(): EmailConfig {
  const host = process.env.SMTP_HOST || "localhost";
  const port = parseInt(process.env.SMTP_PORT || "1025", 10);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const from = process.env.SMTP_FROM || "Broker CRM <notifications@broker-crm.internal>";
  const appBaseUrl =
    process.env.APP_BASE_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000";

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    appBaseUrl: appBaseUrl.replace(/\/+$/, ""), // strip trailing slashes
  };
}

