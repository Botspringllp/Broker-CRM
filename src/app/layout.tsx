import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Broker CRM | Real Estate Operations (Phase 1)",
  description: "Multi-tenant CRM for Indian real estate brokers (secondary market: resale and rentals)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="min-h-full bg-crm-bg text-crm-text antialiased">
        {children}
      </body>
    </html>
  );
}
