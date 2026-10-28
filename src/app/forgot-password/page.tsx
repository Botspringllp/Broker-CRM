"use client";

import React, { useState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "../login/actions";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await requestPasswordResetAction(email);
      if (res.success) {
        setSubmitted(true);
      } else {
        setErrorMessage(res.error || "Failed to process request.");
      }
    } catch {
      setErrorMessage("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center p-4 bg-crm-bg text-crm-text selection:bg-teal-100">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-lg bg-crm-primary mx-auto flex items-center justify-center text-white font-bold text-lg shadow-xs">
            BC
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-crm-text">
            Broker CRM
          </h1>
          <p className="text-xs text-crm-muted">
            Indian Secondary Resale & Rental Brokerage Operations
          </p>
        </div>

        {/* Card */}
        <div className="p-6 md:p-8 rounded-lg bg-crm-surface border border-crm-border shadow-xs space-y-5">
          <div className="border-b border-crm-border pb-3">
            <h2 className="text-base font-semibold text-crm-text">Reset your password</h2>
            <p className="text-xs text-crm-muted mt-0.5">
              Enter your account email to receive a password reset link.
            </p>
          </div>

          {errorMessage && (
            <div className="p-3 rounded-md bg-crm-error-light border border-red-200 text-crm-error text-xs flex items-center gap-2">
              <span className="font-bold">⚠️</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {submitted ? (
            <div className="space-y-4">
              <div className="p-4 rounded-md bg-teal-50 border border-teal-200 text-teal-900 text-xs space-y-2">
                <div className="font-bold flex items-center gap-1.5 text-teal-800">
                  <span>✓</span> Check your inbox
                </div>
                <p className="text-teal-700 leading-relaxed">
                  If an active account exists for <strong>{email}</strong>, a password reset link has been dispatched.
                </p>
                <p className="text-[11px] text-teal-600">
                  In local development, check Mailpit web inbox at{" "}
                  <a
                    href="http://localhost:8025"
                    target="_blank"
                    rel="noreferrer"
                    className="underline font-semibold text-teal-800"
                  >
                    localhost:8025
                  </a>.
                </p>
              </div>

              <div className="pt-2">
                <Link
                  href="/login"
                  className="block w-full py-2.5 text-xs font-bold rounded text-center bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs transition-colors"
                >
                  Return to Sign In
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-crm-text mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@brokerage.com"
                  className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs transition-colors disabled:opacity-50"
              >
                {loading ? "Sending link..." : "Send Reset Link"}
              </button>
            </form>
          )}
        </div>

        {/* Back Link */}
        <div className="text-center text-[11px] text-crm-muted">
          <Link href="/login" className="text-crm-link hover:underline">
            ← Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}

