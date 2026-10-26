"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);

    try {
      const result = await signIn.email({
        email,
        password,
      });

      if (result.error) {
        setErrorMessage(result.error.message || "Invalid email or password.");
      } else {
        const session = await authClient.getSession();
        const role = (session?.data?.user as { role?: string })?.role;

        if (role === "PLATFORM_SUPER_ADMIN" || email.toLowerCase().trim() === "superadmin@crm.in") {
          router.push("/platform");
        } else {
          router.push("/");
        }
        router.refresh();
      }
    } catch {
      setErrorMessage("An unexpected error occurred during sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center p-4 bg-crm-bg text-crm-text selection:bg-teal-100">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-lg bg-crm-primary mx-auto flex items-center justify-center text-white font-bold text-lg shadow-sm">
            BC
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-crm-text">
            Broker CRM
          </h1>
          <p className="text-xs text-crm-muted">
            Indian Secondary Resale & Rental Brokerage Operations
          </p>
        </div>

        {/* Login Card */}
        <div className="p-6 md:p-8 rounded-lg bg-crm-surface border border-crm-border shadow-sm space-y-5">
          <div className="border-b border-crm-border pb-3">
            <h2 className="text-base font-semibold text-crm-text">Sign in to your account</h2>
            <p className="text-xs text-crm-muted mt-0.5">
              Enter your email and password to access your brokerage account.
            </p>
          </div>

          {errorMessage && (
            <div className="p-3 rounded-md bg-crm-error-light border border-red-200 text-crm-error text-xs flex items-center gap-2">
              <span className="font-bold">⚠️</span>
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 text-xs">
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

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold text-crm-text">Password</label>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 text-xs rounded border border-crm-border bg-stone-50/50 focus:bg-white focus:outline-hidden focus:border-crm-primary"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 text-xs font-bold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-xs transition-colors disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>

        {/* Footer info */}
        <div className="text-center text-[11px] text-crm-muted space-y-1">
          <div>
            Broker CRM • Multi-Tenant Architecture
          </div>
          <Link href="/" className="text-crm-link hover:underline">
            ← Return to Overview
          </Link>
        </div>
      </div>
    </div>
  );
}
