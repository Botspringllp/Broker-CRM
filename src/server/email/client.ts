import nodemailer, { Transporter, TransportOptions } from "nodemailer";
import { getEmailConfig } from "./config";

let cachedTransporter: Transporter | null = null;

/**
 * Returns an initialized Nodemailer SMTP transporter.
 * Caches transporter instance across calls in Node runtime.
 */
export function getTransporter(): Transporter {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const config = getEmailConfig();

  const transportOptions: TransportOptions = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user && config.pass
      ? {
          auth: {
            user: config.user,
            pass: config.pass,
          },
        }
      : {}),
    // Connection timeouts to prevent hanging in serverless/Node environments
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  } as unknown as TransportOptions;

  cachedTransporter = nodemailer.createTransport(transportOptions);
  return cachedTransporter;
}

/**
 * Override the cached transporter (for test isolation).
 */
export function setTransporterForTesting(transporter: Transporter | null) {
  cachedTransporter = transporter;
}

/**
 * Verifies that the SMTP server is reachable and accepting connections.
 */
export async function verifySmtpConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    const transporter = getTransporter();
    await transporter.verify();
    return { connected: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to verify SMTP connection.";
    return { connected: false, error: message };
  }
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Sends an email using the configured SMTP transporter.
 * Explicitly surfaces transport errors rather than falsely claiming delivery.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const config = getEmailConfig();
  const transporter = getTransporter();

  try {
    const info = await transporter.sendMail({
      from: config.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]+>/g, ""),
      replyTo: options.replyTo,
    });

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send email via SMTP.";
    console.error(`[SMTP Error] Failed to send email to ${options.to}:`, message);
    return {
      success: false,
      error: message,
    };
  }
}

