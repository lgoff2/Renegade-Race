# Renegade Race Rentals — Web Application

The customer-facing web app for **Renegade Race Rentals**, a digital paddock where motorsports professionals (drivers, teams, coaches, crew, vehicle owners, sponsors) discover each other, talk, agree, and pay — all in one place. Track-car rentals and coaching are features inside the social platform, not the platform itself.

## Information architecture

| Section | Path | Purpose |
|---------|------|---------|
| Paddock | `/paddock` | Social feed: posts, follows, activity from across the platform |
| People | `/motorsports` | Discover drivers, teams, and coaches |
| Garage | `/vehicles` | Browse rentable track vehicles |
| Coaching | `/coaches` | Book paid driver coaching sessions |
| Deals | `/deals` | Custom invoices, e-signed contracts, agreements |

## Tech stack

- Next.js 16 (App Router) + React 19
- TypeScript 5.7+
- Convex (database + serverless backend)
- Clerk (authentication)
- Stripe Connect (marketplace payouts) + Stripe Billing (subscriptions) + Stripe ACH (high-value invoices)
- Cloudflare R2 + ImageKit (images)
- Resend (email) + Documenso (e-signatures, scaffolded)
- Tailwind CSS v4 + shadcn/ui
- Biome (lint + format)

## Local development

1. Install dependencies (from repo root):

   ```bash
   pnpm install
   ```

2. Set up `.env.local` (see `.env.example` for the full list):

   ```env
   NEXT_PUBLIC_CONVEX_URL=...
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
   CLERK_SECRET_KEY=...
   NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT=...
   NEXT_PUBLIC_SENTRY_DSN=...
   ```

3. Run the dev server (from repo root):

   ```bash
   pnpm dev:web
   ```

## Roadmap

The long-term roadmap is in [`docs/ROADMAP.md`](../../docs/ROADMAP.md) at the repo root.
