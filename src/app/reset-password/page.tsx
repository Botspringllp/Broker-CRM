"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { resetPasswordAction } from "../login/actions";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!token) {
      setErrorMessage("Password reset token is missing. Please click the link in your email again.");
      return;
    }

    if (newPassword.length < 8) {
      setErrorMessage("New password must be at least 8 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage("Passwords do not match. Please verify and try again.");
      return;
    }

    setLoading(true);

    try {
      const res = await resetPasswordAction({ token, newPassword });
      if (res.success) {
        setSuccess(true);
      } else {
        setErrorMessage(res.error || "Failed to reset password.");
      }
    } catch {
      setErrorMessage("An unexpected error occurred while resetting your password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 md:p-8 rounded-lg bg-crm-surface border border-crm-border shadow-xs space-y-5">
      <div className="border-b border-crm-border pb-3">
        <h2 className="text-base font-semibold text-crm-text">Create new password</h2>
        <p className="text-xs text-crm-muted mt-0.5">
          Enter a secure password for your Broker CRM account (min 8 characters).
        </p>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-md bg-crm-error-light border border-red-200 text-crm-error text-xs flex items-center gap-2">
          <span className="font-bold">⚠️</span>
          <span>{errorMessage}</span>
        </div>
      )}

      {!token && (
        <div className="p-3.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs">
          Missing reset token. Please ensure you clicked the full URL provided in the password reset email.
        </div>
      )}

      {success ? (
        <div className="space-y-4">
          <div className="p-4 rounded-md bg-teal-50 border border-teal-200 text-teal-900 text-xs space-y-2">
            <div className="font-bold flex items-center gap-1.5 text-teal-800">
              <span>✓</span> Password reset complete
            </div>
            <p className="text-teal-700 leading-relaxed">
              Your password has been securely updated. You can now log in with your new credentials.
            </p>
          </div>

          <div className="pt-2">
            <Link
              href="/login"
              className="block w-full py-2.5 text-xs font-bold rounded text-center bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs transition-colors"
            >
              Sign In with New Password
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              New Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
            />
          </div>

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Confirm New Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !token}
            className="w-full py-2.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs transition-colors disabled:opacity-50"
          >
            {loading ? "Updating password..." : "Update Password"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
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

        <Suspense fallback={<div className="p-8 text-center text-xs text-crm-muted">Loading reset form...</div>}>
          <ResetPasswordForm />
        </Suspense>

        {/* Back Link */}
        <div className="text-center text-[11px] text-crm-muted">
          <Link href="/login" className="text-crm-link hover:underline">
            ← Return to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}

