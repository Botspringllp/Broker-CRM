"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { verifyInvitationTokenAction, activateUserAccountAction } from "../users/actions";

interface InvitedUserInfo {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantName: string;
}

function ActivateAccountForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [verifying, setVerifying] = useState(true);
  const [userInfo, setUserInfo] = useState<InvitedUserInfo | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function verify() {
      if (!token) {
        setTokenError("Missing invitation token. Please check the link in your invitation email.");
        setVerifying(false);
        return;
      }

      try {
        const res = await verifyInvitationTokenAction(token);
        if (isMounted) {
          if (res.success && res.user) {
            setUserInfo(res.user);
          } else {
            setTokenError(res.error || "Invitation link is invalid or has expired.");
          }
          setVerifying(false);
        }
      } catch {
        if (isMounted) {
          setTokenError("Failed to verify invitation. Please try again or contact your administrator.");
          setVerifying(false);
        }
      }
    }

    verify();

    return () => {
      isMounted = false;
    };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (password.length < 8) {
      setFormError("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setFormError("Passwords do not match. Please verify and try again.");
      return;
    }

    setLoading(true);

    try {
      const res = await activateUserAccountAction({ token, password });
      if (res.success) {
        setSuccess(true);
      } else {
        setFormError(res.error || "Failed to activate account.");
      }
    } catch {
      setFormError("An unexpected error occurred during account activation.");
    } finally {
      setLoading(false);
    }
  };

  if (verifying) {
    return (
      <div className="p-8 text-center text-xs text-crm-muted bg-crm-surface border border-crm-border rounded-lg shadow-xs">
        Verifying your invitation details...
      </div>
    );
  }

  if (tokenError) {
    return (
      <div className="p-6 md:p-8 rounded-lg bg-crm-surface border border-crm-border shadow-xs space-y-4">
        <div className="p-3.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <span className="font-bold">⚠️</span>
          <span>{tokenError}</span>
        </div>
        <p className="text-xs text-crm-muted leading-relaxed">
          Invitation links expire after 48 hours for security reasons. If your link has expired, please request your brokerage administrator to resend your invitation from Team Management.
        </p>
        <div className="pt-2">
          <Link
            href="/login"
            className="block w-full py-2.5 text-xs font-bold rounded text-center bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs transition-colors"
          >
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 rounded-lg bg-crm-surface border border-crm-border shadow-xs space-y-5">
      <div className="border-b border-crm-border pb-3">
        <h2 className="text-base font-semibold text-crm-text">Activate your account</h2>
        <p className="text-xs text-crm-muted mt-0.5">
          Welcome to Broker CRM! Set your secure password to complete activation.
        </p>
      </div>

      {userInfo && (
        <div className="p-3.5 rounded-md bg-stone-50 border border-crm-border text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-crm-text">{userInfo.name}</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-teal-50 text-teal-800 border border-teal-200">
              {userInfo.role.replace(/_/g, " ")}
            </span>
          </div>
          <div className="text-crm-muted">{userInfo.email}</div>
          <div className="text-[11px] text-crm-text pt-1 font-medium">
            Brokerage: <strong>{userInfo.tenantName}</strong>
          </div>
        </div>
      )}

      {formError && (
        <div className="p-3 rounded-md bg-crm-error-light border border-red-200 text-crm-error text-xs flex items-center gap-2">
          <span className="font-bold">⚠️</span>
          <span>{formError}</span>
        </div>
      )}

      {success ? (
        <div className="space-y-4">
          <div className="p-4 rounded-md bg-teal-50 border border-teal-200 text-teal-900 text-xs space-y-2">
            <div className="font-bold flex items-center gap-1.5 text-teal-800">
              <span>✓</span> Account Activated!
            </div>
            <p className="text-teal-700 leading-relaxed">
              Your password has been saved and your account is now ready for use.
            </p>
          </div>

          <div className="pt-2">
            <Link
              href="/login"
              className="block w-full py-2.5 text-xs font-bold rounded text-center bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs transition-colors"
            >
              Sign In to Broker CRM
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Create Password *
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
            />
            <span className="text-[10px] text-crm-muted mt-0.5 block">Minimum 8 characters</span>
          </div>

          <div>
            <label className="block font-semibold text-crm-text mb-1">
              Confirm Password *
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
            disabled={loading}
            className="w-full py-2.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs transition-colors disabled:opacity-50"
          >
            {loading ? "Activating account..." : "Activate & Set Password"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function ActivatePage() {
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

        <Suspense fallback={<div className="p-8 text-center text-xs text-crm-muted">Loading activation details...</div>}>
          <ActivateAccountForm />
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

