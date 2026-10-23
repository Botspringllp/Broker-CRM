"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: session } = useSession();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const userName = session?.user?.name || "Pooja Sharma";
  const userRole = (session?.user as { role?: string })?.role?.replace("_", " ") || "Telecaller";
  const isAuthenticated = !!session?.user;

  const navItems = [
    {
      name: "Overview",
      href: "/",
      exact: true,
      badge: "Today",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
    },
    {
      name: "Supply Validation",
      href: "/supply",
      exact: true,
      badge: "2 Due",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
    },
    {
      name: "Active Supply Pool",
      href: "/supply/active",
      exact: true,
      badge: "4 Ready",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
        </svg>
      ),
    },
    {
      name: "Lead Validation",
      href: "/leads",
      exact: false,
      badge: "2 Pending",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      name: "Site Visits",
      href: "/visits",
      exact: false,
      badge: "1 Confirmed",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
  ];

  const isActive = (item: typeof navItems[0]) => {
    if (item.exact) {
      return pathname === item.href;
    }
    return pathname.startsWith(item.href);
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-crm-bg text-crm-text">
      {/* Sidebar for Desktop */}
      <aside className="hidden md:flex flex-col w-64 border-r border-crm-border bg-crm-surface shrink-0">
        {/* Brand / Tenant Header */}
        <div className="p-4 border-b border-crm-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-crm-primary flex items-center justify-center text-white font-bold text-sm shadow-xs">
              BC
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-crm-text leading-tight">
                Broker CRM
              </h1>
              <p className="text-[11px] text-crm-muted truncate max-w-[170px]" title="Apex Realty Advisors">
                Apex Realty • Gurgaon
              </p>
            </div>
          </div>
        </div>

        {/* User Context & Role Pill */}
        <div className="px-4 py-3 bg-stone-50 border-b border-crm-border flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 truncate max-w-[140px]">
            <span className={`w-2 h-2 rounded-full shrink-0 ${isAuthenticated ? "bg-emerald-500 animate-pulse" : "bg-stone-400"}`}></span>
            <span className="font-medium text-crm-text truncate" title={userName}>{userName}</span>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-crm-primary-light text-crm-primary uppercase shrink-0">
            {userRole}
          </span>
        </div>

        {/* Nav Links */}
        <nav className="p-3 space-y-1 flex-1">
          <div className="text-[10px] uppercase font-bold text-crm-muted tracking-wider px-3 py-1.5">
            Phase 1 Operations
          </div>
          {navItems.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                  active
                    ? "bg-crm-primary text-white shadow-xs font-semibold"
                    : "text-crm-text hover:bg-stone-100"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className={active ? "text-white" : "text-crm-muted"}>
                    {item.icon}
                  </span>
                  <span>{item.name}</span>
                </div>
                {item.badge && (
                  <span
                    className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium ${
                      active
                        ? "bg-white/20 text-white"
                        : "bg-stone-100 text-crm-muted border border-crm-border"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile Header Bar */}
      <div className="md:hidden flex items-center justify-between p-3.5 bg-crm-surface border-b border-crm-border">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-crm-primary flex items-center justify-center text-white font-bold text-xs">
            BC
          </div>
          <div>
            <h1 className="text-xs font-bold text-crm-text">Broker CRM</h1>
            <p className="text-[10px] text-crm-muted">Apex Realty • Gurgaon</p>
          </div>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-1.5 rounded border border-crm-border text-crm-muted hover:text-crm-text text-sm"
          aria-label="Toggle navigation"
        >
          {mobileMenuOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-crm-surface border-b border-crm-border p-3 space-y-1">
          {navItems.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between px-3 py-2 rounded text-xs font-medium ${
                  active ? "bg-crm-primary text-white" : "text-crm-text hover:bg-stone-100"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{item.icon}</span>
                  <span>{item.name}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/10">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Operational Status Banner */}
        <header className="bg-crm-surface border-b border-crm-border px-6 py-2.5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-crm-text">Secondary Resale & Rental CRM</span>
            <span className="text-crm-muted">|</span>
            <span className="text-crm-muted text-[11px]">Tenant: Apex Realty Advisors (Gurgaon)</span>
          </div>
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <button
                onClick={handleSignOut}
                className="px-2.5 py-1 text-[11px] font-medium rounded border border-crm-border text-crm-muted hover:text-crm-text hover:bg-stone-50 transition-colors"
              >
                Sign Out
              </button>
            ) : (
              <Link
                href="/login"
                className="px-2.5 py-1 text-[11px] font-semibold rounded bg-crm-primary text-white hover:bg-crm-primary-hover shadow-2xs transition-colors"
              >
                Sign In
              </Link>
            )}
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

