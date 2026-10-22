"use client";

import React from "react";

export type BadgeVariant =
  | "success" // Validated, Active, Available, Visit Done
  | "warning" // In Validation, Call Back, Pending, Tentative
  | "error"   // Mandate Declined, Inactive, Sold, Rented, Cancelled, Visit Not Done
  | "info"    // Connected, Sale, Rent
  | "neutral" // Not Validated, Unfurnished, etc.
  | "accent";  // Highlighted actions

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  size?: "sm" | "md";
}

export function Badge({
  children,
  variant = "neutral",
  className = "",
  size = "md",
}: BadgeProps) {
  const sizeStyles = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs";

  const variantStyles: Record<BadgeVariant, string> = {
    success: "bg-crm-success-light text-crm-success border border-emerald-200",
    warning: "bg-crm-warning-light text-crm-warning border border-amber-200",
    error: "bg-crm-error-light text-crm-error border border-red-200",
    info: "bg-crm-link-light text-crm-link border border-blue-200",
    accent: "bg-crm-accent-light text-crm-accent border border-orange-200",
    neutral: "bg-stone-100 text-crm-muted border border-crm-border",
  };

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${sizeStyles} ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  let variant: BadgeVariant = "neutral";

  switch (status) {
    case "Validated":
    case "Active":
    case "Available":
    case "Visit Done":
    case "Confirmed":
    case "Completed":
      variant = "success";
      break;

    case "In Validation":
    case "Call Back":
    case "Pending":
    case "Tentative":
    case "Tentative - Awaiting Owner":
    case "Due":
      variant = "warning";
      break;

    case "Mandate Declined":
    case "Inactive":
    case "Sold":
    case "Rented":
    case "Cancelled":
    case "Visit Not Done":
    case "Buyer / Tenant Says Not Looking":
      variant = "error";
      break;

    case "Connected":
    case "Sale":
    case "Rent":
      variant = "info";
      break;

    case "Ringing / Not Answering":
      variant = "accent";
      break;

    default:
      variant = "neutral";
      break;
  }

  return <Badge variant={variant}>{status}</Badge>;
}

