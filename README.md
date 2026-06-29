# RapidMOT

Mobile-first app for UK MOT garages: onboard in minutes (map fly-to → MOT classes → AI agent), load leads by scanning a paper register or uploading a CSV, and let a WhatsApp AI agent reactivate customers as their MOT comes due.

## Stack

- **Next.js (App Router) + TypeScript + Tailwind v4 + Framer Motion**
- **Clerk** - auth (Google OAuth 2.0 via custom credentials, see `docs/google-oauth-setup.md`)
- **Supabase** - multi-tenant data (`supabase/schema.sql`)
- **MapLibre GL + OpenFreeMap** - cinematic onboarding map, keyless and free; **Google Places API (New)** - business data
- **Wasup** - WhatsApp instances per garage
- **n8n** - outbound / inbound / reminder engine (generalized from the TJ Katsastus workflows)

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. The app degrades gracefully with **zero env vars**:

- Business search falls back to demo garages
- The map works out of the box (no key needed)
- Onboarding saves to localStorage until Supabase is configured
- Auth is open until Clerk keys are set

Create `.env.local` and fill in keys as they become available.

## Status

| Area | State |
|---|---|
| Landing + onboarding (search → fly-to → confirm → classes → prices/tone → done) | ✅ |
| Supabase schema (tenants, settings, agent configs, leads, sessions, messages, bookings, uploads) | ✅ |
| Tenant save API (Supabase w/ local fallback) | ✅ |
| Google OAuth 2.0 prod setup guide | ✅ `docs/google-oauth-setup.md` |
| Agent builder + chat playground (GPT-5.5) | ✅ |
| WhatsApp connect (Wasup onboard + QR + pairing) | ✅ |
| Leads: register scan (Azure OCR pipeline) + CSV import, DVLA enrichment | ✅ |
| Dashboard: leads, chats (with human takeover), settings | ✅ |
| Engine: outbound feeder (`/api/engine/outbound` cron) + inbound webhook (`/api/webhooks/wasup`) | ✅ |
| Run `supabase/migration-002-engine.sql` + set `APP_BASE_URL`/`ENGINE_SECRET` | ⏳ |
| Reminders cadence + booking calendar UI | ⏳ next |
