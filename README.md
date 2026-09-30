<div align="center">

# TAFF Sportwear

**Production operations platform for a custom jersey manufacturer.**

Order intake → 11-stage production pipeline → automated WhatsApp updates → customer tracking.

[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres_%2B_RLS-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)

</div>

---

## The problem

TAFF Sportwear produces custom full-printing jerseys. Every order passes through eleven production stages across different workstations — design, layout, colour proofing, printing, press transfer, cutting, sewing, finishing, QC, packing, shipping.

Before this platform, keeping customers informed meant someone pausing work to answer *"how far along is my order?"* on WhatsApp. Order status lived in the operator's head; the customer had no way to check it themselves.

Three problems followed from that:

- **No visibility.** Customers messaged repeatedly for updates that were already known internally.
- **No accountability.** Nothing recorded when an order actually moved between stages, so a stalled order was invisible until the customer complained.
- **No memory.** Deadlines were tracked verbally, and photo assets (design approvals, work orders) were scattered across shared chats.

This platform turns that flow into a tracked, self-reporting pipeline: the moment an operator advances a stage, the system records the history, recalculates progress, and notifies the customer automatically.

## What it does

| Module | What it does |
|---|---|
| **Orders dashboard** | Create, search, edit and advance jersey orders through the 11-stage pipeline. Deadline tracking, design & work-order photo uploads, per-order production reports. |
| **Maklon dashboard** | A separate 6-stage pipeline for toll-manufacturing (maklon) jobs, with its own numbering and stage set. |
| **Automated WhatsApp updates** | Each genuine stage change sends a templated update to the customer via the Fonnte gateway — deduplicated so a stage can never notify twice. |
| **Deadline reminders** | A scheduled job warns production staff about orders due in 3 / 2 / 1 days, configurable per installation. |
| **Customer tracking** | Customers check progress themselves with order number + phone, or through a signed link sent over WhatsApp. No login, no phone call. |
| **Reports** | Average production turnaround, derived from the recorded stage history rather than a manually maintained sheet. |
| **Settings** | Shop profile, WhatsApp gateway token, reminder schedule and monthly capacity — all editable from the dashboard. |

## Architecture

A single Next.js App Router application. Server Components read data directly; mutations go through Route Handlers that own the authorisation check.

```
Browser
  dashboards · tracking pages · public entry page
        │
        ▼
Next.js 15 (App Router)
  middleware.ts        session refresh, tags each request with its pathname
  Server Components    read through the service client
  Route Handlers       auth check FIRST (getAdminDb), then service client
                       tracking       phone match / signed token, then read
                       cron           CRON_SECRET, then service client
                       cloudinary     session check, then hand out a signed upload grant
        │
        ▼
Supabase (Postgres)
  all tables           RLS enabled, zero anon policies — service role only
  public read          only the shop identity + stage-name lists the status pages need
  RPCs                 atomic stage-claim for notifications
        │
        ├──▶ Fonnte (WhatsApp gateway)
        └──▶ Cloudinary (media, signed uploads)
```

### Data model

The schema is versioned as SQL migrations. Three baseline files describe a fresh database (`0001` schema, `0002` functions, `0003` seed); everything after that is incremental and idempotent, so an existing database applies only the files it hasn't seen. Eleven tables remain — everything that served the marketing site was dropped once the platform was scoped to operations. The core of it:

| Table | Holds |
|---|---|
| `orders` | Order number, customer, deadline, `current_status`, `current_stage`, photo assets, product line items |
| `order_status_history` | Append-only record of every stage transition, with notes, photos and timestamps |
| `maklon_orders` / `maklon_status_history` | The equivalent pair for toll-manufacturing jobs |
| `production_steps` / `maklon_steps` | Operator-editable stage names, so the pipeline isn't hardcoded |
| `notification_logs` | Deadline reminder attempts: recipient, status, provider error, days-to-deadline |
| `stage_notification_logs` | Anti-duplicate slot claims for stage updates — the unique `(order_id, stage)` that makes double-sends impossible |
| `app_settings` | Encrypted gateway token, reminder schedule, capacity |

## Engineering notes

A few parts that were genuinely interesting to get right.

**One source of truth for "what stage is this order at?".** `current_status` has 12 possible values but the pipeline only has 11 stages — `selesai` (completed) is a terminal order state, not a twelfth stage. The rule "completed = final stage = 100%" was originally re-implemented in four places, and each copy had its own missing guard. It now lives once in `lib/order-status.ts`, together with a normalisation map that transparently upgrades legacy slugs (`print`, `pres`, `potong`) from an earlier 9-stage pipeline. Old rows keep reading correctly without a data migration.

**Stage notifications that cannot double-send.** Advancing a stage triggers a WhatsApp message, and the naive implementation races: two operators tapping at once, or a client retry, sends the customer the same update twice. `lib/fonnte.ts` instead calls an RPC (`claim_stage_notification`) that wins or loses on a unique `(order_id, stage)` constraint *before* any message is sent. A lost claim means another request already sent it. `last_notified_stage` is only written after the provider confirms success, so a failed send is retried rather than silently dropped.

**A silent notification outage, found by calling the function.** That anti-duplicate log lived in a table which an unrelated later migration dropped and recreated for a different purpose. Nothing failed loudly: the table existed, the RPC existed, and the app reported nothing worse than a log line — but the claim now errored on a missing column, and the trigger returned early, so *no* jersey stage notification had been going out. Calling the RPC directly returned `column "stage" does not exist`, which is what a passing type-check and a green build can never tell you. The log moved to its own table (`stage_notification_logs`), the RPCs were rewritten against it, and a regression check against the RPC itself was added to the migration notes.

**Tracking links that don't leak.** A dashboard behind a shared password is fine for staff, but customers shouldn't need accounts. Jersey orders are verified by normalising both sides to digits before comparing the phone number. Messages sent over WhatsApp carry an HMAC-SHA256 signed token (30-day TTL) so the link works without re-typing an order number, while `/status`, `/track` and `/status/maklon` resolve independently and never expose one customer's data to another.

**Uploads that are signed, not open.** Media choice matters less than the upload path. Cloudinary offers an *unsigned* upload preset, which means anyone who reads the cloud name out of the page source can push files into the account. This platform uses a **signed** preset instead: the browser asks `POST /api/pesanan/cloudinary/sign` for a short-lived grant, and the server signs `timestamp`, `upload_preset` and `folder` with the API secret. That secret never reaches the browser, and the endpoint is behind the same session guard as every other dashboard route. Forging the signature is rejected at Cloudinary's end (verified: HTTP 401).

**Photos are never stored at camera resolution.** The billed unit here is not requests, it's stored bytes plus delivery bandwidth plus derived transformations. A phone photo is routinely 4000 px and 2 MB, while the largest place this app ever shows a photo is a 1600 px lightbox — every pixel above that is paid for forever and never looked at. So the browser downsizes to a 1600 px long edge and re-encodes to JPEG q0.82 *before* the upload, which lands a photo around 200–400 KB: roughly a 5–8× reduction in stored bytes, with no visible difference at the sizes the app actually displays. The helper is deliberately pessimistic — it falls back to the original file if the browser can't decode, if the image is already small enough, or if the re-encode didn't actually save bytes. PNG stays PNG, because jersey mockups often carry transparency and a JPEG re-encode would turn those areas black. EXIF orientation is honoured so phone photos don't come back rotated.

**Order numbers that survive being read aloud.** `TAFF` + `YYMMDD` + four characters drawn from a CSPRNG, with the ambiguous characters `B I O L 0 1` removed from the alphabet. Uniqueness is checked against the database with retry, because customers read these numbers over the phone. Numbers minted before the rename (`MENARA…`) and under the previous prefix (`VSP…`) both still resolve on the tracking page, so links already sent to customers keep working.

**Theming as a one-file change.** Every colour and font in the product is a CSS variable in `app/globals.css` (`:root` plus a `.dark` override) that `tailwind.config.ts` reads from. Rebranding the whole application — palette, typeface, logo, order-number prefix — is a change to that token block plus the logo files, not a hunt through hundreds of components.

## Security model

Worth calling out, because an earlier version of this platform had a serious flaw that the rewrite fixed.

**What was wrong.** The operational tables shipped with row-level security enabled but policies written as `USING (true)` for the `public` role. Because `NEXT_PUBLIC_SUPABASE_ANON_KEY` is embedded in the browser bundle by design, anyone who opened DevTools could read *every* customer record — names, phone numbers, cities — insert fabricated orders, or rewrite any order's status and tracking number by calling the REST API directly. The application never came into it.

**What changed.**

- **Authorisation moved to the server.** Every call site that touches operational tables now uses a service-role client created in exactly one place (`createServiceClient()`), used only from server code. The public anon key no longer has any access to customer data.
- **A single guard, applied first.** `getAdminDb()` verifies the admin session and returns the service client only if it passes — so every handler begins with an explicit 401 path rather than trusting RLS to filter results.
- **The RLS hole was closed.** The permissive policies were removed from the four operational tables and both stage lists. The baseline schema simply never grants them: anon can read the shop identity and the stage-name lists, nothing else.
- **RPCs are service-role only.** The notification/settings functions are `SECURITY DEFINER`, so the grants matter more than the table policies. They are revoked from `public`, `anon` and `authenticated` and granted to `service_role` — otherwise the public anon key could overwrite the WhatsApp token or claim a stage on someone else's behalf and silence their notifications.
- **Secrets stay encrypted.** The WhatsApp gateway token is stored AES-256-GCM encrypted (key from the environment, never in code), so a database dump alone doesn't expose the account.
- **The remaining anon surface is only what has to be public:** the stage-name lists the customer status pages read, nothing else.

## Verified on this deployment

Claims are cheap, so these were checked against the live project rather than assumed:

| Check | Result |
|---|---|
| Migrations `0001`–`0010` applied to a fresh database | 11 tables created, versions recorded in `supabase_migrations` |
| Anon key reads the public brand row | `200` — intended, this is the shop identity the status pages need |
| Anon key writes a fabricated order | `401` — `new row violates row-level security policy for table "orders"` |
| Signed upload without a session | `401` from the sign endpoint |
| Signed upload with a valid session | `200`, asset landed in the intended folder |
| Upload with a forged signature | `401` from Cloudinary — the signature is genuinely enforced |
| `tsc --noEmit` and `next build` | clean |
| Production deploy (`taffsport.vercel.app`) | `/`, `/login`, `/track`, `/status` all return `200` |
| Dashboard API without a session | `401` |
| Cron endpoint without the secret | `401` |
| Signed upload grant in production | `200` with a session, `401` without |

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router), React 19 | Server Components keep DB credentials and secrets off the client while still allowing rich dashboards |
| Language | TypeScript, `strict` | The status/pipeline logic spans a dozen files; the compiler catches the drift |
| Styling | Tailwind CSS 3 + Radix UI primitives | Design tokens live in CSS variables so the brand palette is themeable in one place |
| Database | Supabase (Postgres) + RLS | Real relational constraints for order history, plus a first-party RPC path for atomic claims |
| Media | Cloudinary (signed uploads) | Direct-from-browser uploads with no media server to run, and no open upload endpoint |
| Messaging | Fonnte (WhatsApp gateway) | Where the customers already are; no app install required |
| Hosting | Vercel | Cron for reminders, plus edge middleware for session refresh |

## Running it yourself

The app is self-contained: one Supabase project, one Cloudinary account, one Vercel
project. `.env.local.example` lists every variable with a note on what it is for.

```bash
pnpm install
cp .env.local.example .env.local   # then fill in the values
# run migrations 0001 → 0010 in the Supabase SQL editor
pnpm dev
```

Two optional seeders ship with the repo if you want sample data to click through:
`scripts/seed-pesanan-demo.mjs` (jersey orders with a full stage history, so the
customer tracking timeline has something in it) and `scripts/seed-maklon-demo.mjs`
(maklon orders). Both write only rows named `Demo …`, and both take `--clean` to
remove exactly those rows and nothing else.

To deploy, set the same variables on the Vercel project (Production and Preview), then
push to `main` or run `vercel --prod`. Four of them are secrets the app refuses to run
without — `SETTINGS_ENCRYPTION_KEY`, `TRACK_SESSION_SECRET`, `PESANAN_PASSWORD` and
`CRON_SECRET` — and each should be freshly generated for production, never copied from a
development file. `APP_URL` must be the production domain, because that is what tracking
links are built from. Cloudinary's upload preset has to be set to Signed mode to match
the signing endpoint; leaving it unsigned would reopen the upload path.

**Scheduling.** `vercel.json` carries no `crons` block — the daily deadline reminder is
driven by cron-job.org instead. One job: GET
`https://taffsport.vercel.app/api/admin/deadline-notif` with custom header
`Authorization: Bearer <CRON_SECRET>` (same value as the Vercel env var), timezone
Asia/Jakarta, daily at 09:00 WIB. The route remains the gatekeeper: it only sends when
`deadline_notif_enabled` is on, the configured "Jam Kirim (WIB)" has been reached, and
`deadline_notif_last_sent_date` is still empty for today — so the job time must fall at
or after the configured send time (09:00 WIB vs the default 08:00 WIB).

## Status

The platform covers operations only — no storefront, no catalogue — so the data model stays as small as the work it supports. Freshly provisioned on its own Supabase project and migrations, with the checks above passing. Live at **[taffsport.vercel.app](https://taffsport.vercel.app)**, redeployed on every push to `main`.

## Author

Built by **Erset Digital** · [GitHub](https://github.com/ersetdigital-sudo)
