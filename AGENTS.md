<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Broker CRM: Project Rules & Guidelines

Multi-tenant SaaS CRM for Indian real estate brokers (secondary market: resale and rentals).  
Both Antigravity and Codex must strictly adhere to these instructions.

---

## 1. Scope & Source of Truth

- **Strict Scope Boundary:** Phase 1 implementation covers only what is specified in `docs/Broker PRD.pdf` up to the line **"End of Phase 1"** (pages 1–9).
- **Working Specification:** `docs/PRD-phase1.md` is the active requirements specification.
- **Source Verification:** `docs/Broker PRD.pdf` is the definitive source of truth for verifying original requirements.
- **Decisions & Architecture:** `docs/decisions.md` records all confirmed, provisional, and external dependency decisions.
- **Out of Scope (Do Not Build in Phase 1):**
  - Anything after the "End of Phase 1" marker in the PDF.
  - Broker website from templates (Section 4, p. 12).
  - Detailed post-boundary deal stages (`Negotiation`, `Token`, `Final Deal`, `Commission active`).
  - Commission accounting, invoices, and billing modules.
  - The "Navigation and screen inventory" table.
  - Post-boundary verification jobs, checklists, evidence capture review, and the entire Blueprint v1.0 (pp. 16–26).
  - Telecaller same-day visit reconfirmation workflows from draft notes (p. 11).

---

## 2. Engineering & Security Rules

- **Strict Multi-Tenancy:** Every tenant-owned database record must carry a `tenant_id` foreign key.
- **Server-Side Enforcement:** Tenant scoping and authorization checks must be enforced strictly server-side in a centralized data-access layer. Hiding UI elements or navigation tabs is never an authorization control.
- **Data Protection & Privacy:** Owner contact numbers and exact private property addresses must never be exposed in buyer-facing shared links or unauthenticated views.
- **No Secrets in Source Control:** Never commit `.env` files, API keys, database credentials, or tokens to git.
- **No Invented Live Data:** Never invent real phone numbers, real broker credentials, fake production leads, or mock API responses that masquerade as live third-party integrations.

---

## 3. Workflow & Development Discipline

- **Task Isolation:** Work on one assigned task at a time. Do not continue to future phases or speculate on unassigned scope.
- **Minimal Dependencies:** Do not install unnecessary dependencies. When a new package is required, document the architectural justification.
- **Quality Gates:** Run appropriate lint checks (`npm run lint`), type checks (`npx tsc --noEmit`), tests (`npm run test`), and build (`npm run build`) after implementation tasks.
- **Package Integrity:** Never run `npm audit fix --force`.
- **Deployment Control:** Do not deploy to Vercel or any environment without an explicit, direct request from the project lead.

---

## 4. Mandatory UI/UX Design Rules

This application must use a **LIGHT THEME**.  
The UI must look like a professionally designed, modern business SaaS application (similar to Stripe, Linear, or GitHub Enterprise), not a generic or flashy AI-generated dashboard.

### Design Principles
- **Light, Crisp Surfaces:** Pure white (`#FFFFFF`) cards and surfaces over soft neutral page backgrounds (`#F8FAFC`).
- **Typography & Spacing:** Clean typography hierarchy, readable font sizes, comfortable padding, and scannable layouts.
- **Functional & Usable:** Prioritize workflow efficiency, compact forms, high-density data tables, responsive filters, and clear status indicators over decorative visuals.
- **Restrained Styling:** Modest border radii (`rounded-md` / `rounded-lg`), subtle borders (`#E2E8F0`), and soft, minimal shadows.
- **Strictly Prohibited:**
  - No dark-mode styling or dark-theme components.
  - No excessive gradients, glassmorphism, glow effects, or decorative blur backdrops.
  - No oversized, low-density cards with empty space.
  - No unnecessary or distracting motion animations.
  - Do not introduce fragmented or different design languages across pages.

### Design Palette Tokens
- **Primary Action:** `#2563EB` (Tailwind blue-600)
- **Secondary / Supporting:** `#0D9488` (Tailwind teal-600)
- **Accent / Alerting:** `#D97706` (Tailwind amber-600)
- **Page Background:** `#F8FAFC` (Tailwind slate-50)
- **Surface / Card Background:** `#FFFFFF`
- **Main Heading & Text:** `#0F172A` (Tailwind slate-900)
- **Muted Text / Secondary Labels:** `#64748B` (Tailwind slate-500)
- **Border / Divider:** `#E2E8F0` (Tailwind slate-200)
- **Success / Validated:** `#15803D` (Tailwind green-700)
- **Error / Rejected / Due:** `#DC2626` (Tailwind red-600)

*(Note: These design tokens are engineering recommendations to guarantee accessible contrast and visual consistency; they are not requirements from the original PRD).*
