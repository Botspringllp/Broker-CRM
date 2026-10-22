"use client";

import React, { useEffect } from "react";

interface ToastProps {
  message: string | null;
  onClose: () => void;
  type?: "success" | "info" | "warning";
}

export function Toast({ message, onClose, type = "success" }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      onClose();
    }, 4000);
    return () => clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;

  const bgStyles =
    type === "success"
      ? "bg-crm-primary text-white border-teal-700"
      : type === "warning"
      ? "bg-crm-accent text-white border-orange-700"
      : "bg-crm-link text-white border-blue-700";

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border text-sm animate-fade-in transition-all">
      <div className={`flex items-center gap-2 ${bgStyles} px-4 py-2.5 rounded-md shadow`}>
        <span className="font-semibold text-xs tracking-wide uppercase bg-black/20 px-1.5 py-0.5 rounded">
          Demo Action
        </span>
        <span>{message}</span>
        <button
          onClick={onClose}
          className="ml-2 text-white/80 hover:text-white font-bold"
          aria-label="Close"
        >
          ×
        </button>
      </div>
    </div>
  );
}

