# Fitvive

A members-only online fitness club: live trainer-led sessions in rooms of six, workout partners, a weekly ranking,
paid membership and company seats.

To put it online, follow [SETUP.md](SETUP.md).

## How it is built

| Part | Technology | Where |
| --- | --- | --- |
| Website | Plain HTML, CSS and JavaScript modules. No build step. | `web/` |
| Database, logins, file storage, live updates | Supabase (PostgreSQL with row level security) | `supabase/schema.sql` |
| Server functions | Supabase Edge Functions (Deno, TypeScript) | `supabase/functions/` |
| Live video | Daily (`daily-js` call object) | `web/js/room.js`, `functions/video-token` |
| Payments | Paystack | `functions/paystack-*` |

The website loads two libraries from a CDN in `web/index.html`: `@supabase/supabase-js@2` and `@daily-co/daily-js`.
Pin both to exact versions once you have confirmed which versions work for you.

### Website files

- `web/config.js` — the Supabase URL and anon key. The only file to edit for deployment.
- `web/js/core.js` — Supabase client, shared state, helpers.
- `web/js/main.js` — start-up, login state, hash routing, menu, click and form delegation.
- `web/js/public.js` — welcome, apply, log in, legal pages, ID upload and pending screens.
- `web/js/member.js` — home, timetable, games, partners, ranking, membership, settings.
- `web/js/room.js` — live rooms and partner calls.
- `web/js/staff.js` — trainer, company admin and club admin screens.

Each screen is an entry in a `views` object with `load`, `render`, and optional `mount`, `actions`, `forms` and
`changes`. Buttons use `data-act`, forms use `data-form`, and inputs that save on change use `data-change`.

### How rooms of six work

- A session is one Daily call. Members join with `subscribeToTracksAutomatically: false`.
- `join_session()` in the database places each member in a room number: with a partner or colleague if one is
  already there, otherwise the emptiest room with space, otherwise a new room that takes two recent joiners along
  so nobody sits alone. `leave_session()` moves a member who is left alone.
- The client subscribes only to the hosts and its own room-mates (`session_roster()`), and re-subscribes when room
  numbers change. Low-data mode subscribes to the trainer and two members at the lowest video layer.
- The trainer is a host in room 0. The trainer's client subscribes to six members at a time and rotates.
- `heartbeat()` runs every 30 seconds and adds training time, which drives streaks and the weekly ranking.

### Access rules

- `profiles.status` gates everything: `pending`, `approved`, `rejected`, `suspended`, `removed`.
- `has_access()` decides who may join rooms: staff, an unexpired subscription, an active company, or the
  `free_access` switch in `app_settings`.
- Members cannot change their own role, status, company, email or gender (`guard_profile` trigger).
- Other members only ever see `member_cards`: first name and surname initial.
- `member_cards` is a view that deliberately bypasses row level security on `profiles` and filters by
  `is_approved()`. Supabase's linter will flag it as a security definer view. That is intended.
- Photo IDs live in the private `id-docs` bucket. Only the owner and admins can read them.

### Payments

`paystack-init` records a pending row in `payments` and returns Paystack's checkout address. `paystack-verify`
(when the member returns) and `paystack-webhook` (from Paystack) both call `apply_payment()`, which is idempotent
and rejects underpayment. `apply_payment()` can only be called with the service role.

## Verification status

- `schema.sql` was run twice on PostgreSQL 16 with stubbed `auth` and `storage` schemas, followed by 38 assertions
  on room placement, access rules, row level security, payments, partners and companies.
- Every route was loaded in Chromium at 1280 px and 390 px against a mocked Supabase client and a mocked Daily
  client, checking for console errors, uncaught exceptions and horizontal overflow.
- The Edge Functions were checked for syntax only.
- Nothing has run against real Supabase, Daily or Paystack services. Treat those integrations as untested.
