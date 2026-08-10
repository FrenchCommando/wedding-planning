# Status

**Built and working:**
- Backend skeleton, auth, Drive integration — done, per spec below.
- Seating chart — migrated off File System Access API to the backend; optimistic-lock save with plain-English conflict diff + force-overwrite. Real 175-guest data is live in the **prod** Drive folder.
- Ceremony page — timed program outline with scroll-reveal, plus a real vertical aisle diagram (Entrance bottom → Altar top) for Processional/Recessional moments. Motion is scroll-linked (position tied to scroll offset via `getBoundingClientRect`), not timer/autoplay-based. Uses a `position:sticky` spacer-pin pattern so the page freezes while the diagram animates, then releases. "End" marker caps the timeline; page bottom padding is computed in JS so max-scroll lands exactly at End's top. Each processional-order person has a plain-text `emoji` field (default 🚶) editable in the UI — not inferred from name/role text. Rail geometry (gutter/line/dot/time-column widths) is driven by CSS custom properties with a `@media (max-width:520px)` override, so it's not fixed-desktop-pixel-only.
- Landing page — role-aware nav, editor "preview as vendor" toggle, warm light/dark theme consistent across all three pages, banner link to the main wedding site (`WEDDING_SITE_URL` env var, hidden when unset).
- Deployed — Docker (standalone, no shared network dependency) + host nginx, live on the Pi. See "Deployment" below for the actual redeploy commands.

**Not yet built:** playlist, transportation sub-projects as backend-integrated pages (playlist exists only as a standalone client-only HTML file, spec'd below but not wired to `/api`; transportation not started).

**Room floor-plan outline data:** room objects in `seating.json` can carry `x1/y1/x2/y2` (fractional plan coordinates) to draw an outline; rooms without them just render with no outline. This is real venue data, so it's seeded once from a local, gitignored `data/venue-seed.json` (see `data/venue-seed.json.example` for the shape) by `setup-prod.ts`/`setup-dev.ts` on first file creation only — never re-seeded, never hardcoded in the HTML. There's deliberately no in-app UI to add/resize rooms: the seating editor is for seating guests, not surveying the venue, so room geometry stays data-only, edited by hand on Drive if it ever needs to change after first setup.

**Recurring CSS gotcha hit multiple times in the ceremony page:** `position:absolute` children ignore their own ancestor's `padding` value (padding is drawn inside the box; absolute children resolve against the padding-box edge regardless of padding thickness) — so adding `padding-top` to a container to create breathing room silently misaligns any absolutely-positioned child (like the `.dot`/`.time` timeline markers) unless its `top` is manually shifted by the same amount. Worth remembering before adding padding near any of the `.dot`/`.time` rail elements.

---

# Design spec

## Overview

One landing page, per-user: reads the same session JWT as the sub-projects
and shows relevant links/info for that role (e.g. vendor sees their
`vendorType`-scoped default pages, guest sees only their household's
relevant sub-projects, editor sees everything) — not a static list of links,
it goes through the same auth middleware as everything else.

Linking out to independent sub-projects:

- Seating chart (built)
- Playlist (not built)
- Ceremony (built)
- Transportation (not built)

Each sub-project is its own static app (HTML/JS), reading and writing its own
data file. No shared database, no framework — same pattern repeated four times.

## Storage split

- **Code**: GitHub repo. Can be public — no PII lives in code. One repo, one
  deploy pipeline for all sub-projects plus the landing page.
- **Data**: Google Drive, one JSON file per sub-project (not one shared blob).
  Separate files so an editing session on one project can't corrupt another.
  Drive gives free revision history per file (use `keepForever: true` on
  milestone saves, e.g. "final seating chart before printing").
- **Hosting**: existing Raspberry Pi (already hosts many other domains/
  services). Standalone: the app container publishes to the Pi's own
  localhost, and a plain host-nginx server block proxies to it — no shared
  Docker network, no dependency on any other stack being up first.

## Google Drive integration

- Drive API v3, scope `drive.file` (app can only touch files it creates or
  files explicitly granted via Drive Picker — fine here since the app creates
  its own data files on first save).
- **Ownership consequence of `drive.file`**: the app can only read/write
  files it created itself — not any pre-existing file dropped into the
  Drive folder manually. All sub-project JSON files (and `guests-auth.json`)
  must be created *by the app* on first run, not hand-placed on Drive
  beforehand. One Google account's refresh token is used throughout, so
  this isn't a multi-identity conflict — just means bootstrapping a new
  sub-project always goes through the app's own "create if missing" logic,
  never a manual file upload.
- Auth: **OAuth Device Authorization Grant** (headless-friendly — Pi displays
  a code + URL, approve from phone/laptop once, Pi receives a long-lived
  refresh token and stores it locally, never in the repo). Must use an
  OAuth client of type **"TVs and Limited Input devices"** — a "Desktop app"
  client fails device-flow with `invalid_client`.
- OAuth consent screen must be flipped to **"In production"** publishing
  status (not "Testing") — otherwise refresh tokens expire after 7 days.
  `drive.file` is not a sensitive/restricted scope, so this doesn't require
  Google's app review.
- Cost: free at this scale (Drive API quota is per-user ~1000 req/100s,
  nowhere close to what this traffic looks like). Storage is a non-issue
  (2TB Drive plan already in place).
- Replaces the seating chart's original File System Access API save-to-local-
  file flow with `GET`/`PUT` calls to the app's own backend, which in turn
  talks to Drive. No more per-browser localStorage staging, no more
  "discard changes" pointing at a local file handle.
- All data files live inside one Drive folder per environment, found or
  created by name on first use (`dataFolderId()` in `src/drive.ts`) — dev
  and prod point at two entirely separate real folder names via
  `DRIVE_FOLDER_NAME` in `.env` (`wedding-planning-data-dev` /
  `wedding-planning-data`), not a shared name with a prefix/suffix trick.

## Auth / access scopes

Three tiers:

| Scope   | Storage             | Access          | Auth mechanism |
|---------|----------------------|-----------------|-----------------|
| Guest   | `guests-auth.json` on Drive (household/token/createdAt records) | read-only, per-household | none — frictionless, no password to forget (esp. for older relatives). Short, household-specific token link (reuse the `?token=` pattern already used by the wedsites RSVP tool, but shorter — meant to be texted/typed easily). One link per household, not per individual. |
| Editor  | `EDITOR_PASSWORD` in `.env` | full read/write  | shared password, session cookie carries `role: editor` |
| Vendor  | `VENDOR_PASSWORD` in `.env` | full read-only, all sub-projects | shared password, session cookie carries `role: vendor` + `vendorType` (e.g. photographer, caterer, DJ). No hard access restriction by type — any vendor can see any page (fine for the florist to see the DJ's notes, or the photographer to see the hair/makeup schedule). `vendorType` only changes which pages are shown by default in the nav, not what's reachable. |

Editor/vendor passwords live in `.env` as plaintext, compared with a
timing-safe check — not hashed and stored in a Drive file. `.env` already
holds equally sensitive secrets (OAuth client secret, JWT signing key)
in plaintext, and nothing reads `.env` that couldn't already read those,
so hashing-at-rest for these two would add a bootstrap/rotation step
without a real security benefit. Guest tokens are the exception, staying
in `guests-auth.json` on Drive, because they're dynamically generated
per household rather than a fixed value that belongs in static config.

Server-side: every write endpoint checks `role === 'editor'`. Read endpoints
accept `editor` or `vendor` (and `guest` where applicable). This is
deliberately not routed through Authelia — Authelia stays scoped to your own
sysadmin access to the Pi, not guest/vendor-facing app auth.

## Activity logging

- Plain local log file on the Pi, exposed via the existing admin page
  pattern already used for other services on the Pi.
- Not written to Drive per-event — a live per-login Drive write means a full
  read-modify-write of the log file plus a new revision snapshot every time,
  which is latency and revision-history noise, not a quota problem (quota is
  a non-issue at this traffic volume).
- If a Drive-backed archive of the log is wanted for consistency, buffer
  locally and flush periodically (e.g. every 5 minutes or every 20 entries)
  rather than one API call per event.
- Losing the log file in a Pi failure is a non-event; losing planning data
  is not — hence the split between "durable data on Drive" and "operational
  logs on the Pi."
- **Not yet implemented.**

## Backend implementation

- **Runtime**: Node + TypeScript, run directly via `tsx` in dev
  (`npx tsx src/server.ts`), compiled with `tsc` for prod. Chosen over
  Python despite Martial's stronger Python background: `googleapis` has
  notably better types/docs than `google-api-python-client` for the
  Drive + OAuth device-flow calls this needs, and TypeScript's signatures
  double as documentation for the Drive response shapes — worth the small
  build-step cost for a project of this size.
- **Framework**: Express — one process, one port. `express.static('public')`
  serves the landing page; `express.static('seating-chart')` /
  `express.static('ceremony')` serve those sub-project's plain HTML/JS
  unchanged (no Vue/Vite, no frontend build step — the spec's "no
  framework" call stays for the frontend). `/api/*` routes handle Drive
  proxying, auth, and the conflict diff logic.
- **Packages**: managed via `npm`/`package.json`, versions pinned via
  `package-lock.json` (commit the lockfile, not `node_modules`).
- **Auth, layers**:
  1. **Google OAuth (app ↔ Drive)** — one refresh token from the device
     grant, stored in a local file (`DRIVE_TOKEN_PATH` in `.env`, not in
     the repo, not on Drive itself). `google-auth-library` mints access
     tokens from it. App-level identity, shared across all requests
     regardless of role. The device-flow HTTP calls themselves are hand-rolled
     in `src/drive.ts` since `google-auth-library`'s `OAuth2Client` has no
     built-in device-flow support.
  2. **App-level role auth** — `EDITOR_PASSWORD`/`VENDOR_PASSWORD` in `.env`
     (plaintext, timing-safe compare — see "Auth / access scopes" above for
     why); guest access uses the household token link from
     `guests-auth.json` on Drive. Login issues a signed session cookie
     carrying `{ role, vendorType?, household? }` — stateless, verified by
     signature, no server-side session store.
  3. **Authorization enforcement** — Express middleware (`requireRole` in
     `src/auth/session.ts`) checks `req.session.role` per route (`editor`
     required for writes; `editor`/`vendor`/`guest` accepted for reads).
     Re-issues the session cookie on active use so the 30-day expiry
     doesn't interrupt regular usage.
  4. **Session token format**: JWT (`jsonwebtoken`) — signed, not encrypted;
     payload `{ role, vendorType?, household?, exp }`. Stateless, no
     server-side session store; tampering fails signature verification.
     Expiry: 30 days — this is a low-friction family app, not something
     that needs re-login prompts; re-issued on any active use.
  5. **Guest token generation**: an admin route (editor role required,
     `POST /api/admin/guest-token`), not just a script — mints a household
     token into `guests-auth.json`. *(Admin UI page for this — table of
     household/token/link/created-date plus a "generate new" form — is
     not yet built; the route exists.)*
  6. **Guest token format**: human-readable, not a UUID/hex string — short
     Crockford-base32-style code (excludes ambiguous `0/O`, `1/I/l`), e.g.
     7 uppercase chars. Same reasoning as the wedsites `?token=` pattern:
     these get texted/typed by relatives, some elderly, on phones. ~35 bits
     of entropy is plenty for a read-only wedding-logistics threat model.
  7. **JWT expiry tradeoff**: since sessions are stateless (no server-side
     store), the 30-day expiry is the *only* revocation mechanism short of
     rotating the signing secret (which logs everyone out at once) — there
     is no per-user "revoke this session" button. Acceptable for this
     threat model; worth remembering if a token ever needs fast revocation.
     Guest re-auth after expiry is frictionless (re-clicking their
     original link re-validates and re-issues a fresh JWT); editor/vendor
     just retype the shared password.
- **Styling**: plain CSS, hand-written. No Bootstrap/Tailwind — full CSS
  frameworks are more than four small static pages need, and Tailwind
  specifically would reintroduce a frontend build step the rest of this
  spec deliberately avoids.
- **Deployment**: Docker, standalone, **live on the Pi**. The container
  publishes `127.0.0.1:3000` (loopback only), and a plain host-nginx server
  block (`deploy/nginx/wedding-planning.conf`) proxies to it — no shared
  Docker network, no dependency on any other stack being up first. Docker's
  `restart: unless-stopped` policy covers process supervision (no separate
  pm2/systemd unit needed). TLS terminates at nginx, same as the Pi's other
  services — this app never handles certs directly.
  - **First-time setup on the Pi**: `git clone` the repo, `scp` `.env.production`
    and `data/drive-token.json` in (both gitignored, never committed), then
    `docker compose build` → `docker compose up -d`. Wire nginx per
    `deploy/nginx/wedding-planning.conf`'s own header comment, fill in the
    real domain there (not in the repo), reload nginx.
  - **Redeploying after a code change**: `git pull` → `docker compose build`
    → `docker compose up -d` — Compose recreates the container automatically
    once the built image changes, no extra flags needed.
  - **Redeploying after an env-only change** (e.g. rotating a password,
    changing `VENUE_NAME`/`WEDDING_SITE_URL`): `scp` the updated
    `.env.production` in, then just `docker compose up -d` — no rebuild.
- **Secrets**: `.env.example` committed to the repo (placeholder keys only);
  the real `.env` (dev) and `.env.production` (prod) are never committed —
  `.gitignore` excludes `.env*` except `.env.example`. On the Pi, `.env`
  would be scp'd directly, read by `docker-compose.yml` via `env_file`.
- **Local dev**: separate Drive *folder* for dev vs prod, same Google
  account/refresh token — two distinct real folder names
  (`wedding-planning-data-dev` / `wedding-planning-data`) selected via
  `DRIVE_FOLDER_NAME` in `.env`, not a filename prefix/suffix trick. No
  mocking layer needed (Drive API quota is a non-issue for one more folder).
  Run Express directly on the laptop (`npx tsx src/server.ts`, no Docker)
  against the dev folder for a fast edit/reload loop; Docker/Pi stays the
  deploy target, not the day-to-day dev loop. Keeps experimentation off the
  real data while costing almost nothing to set up.

## Concurrent editing (seating chart)

The seating chart is the one sub-project where concurrent edits can
genuinely collide (~200 guests each pinned to exactly one seat; playlist/
ceremony/transportation are mostly append-only lists and don't have this
problem).

Chosen approach: **optimistic lock via Drive's revision ID**, not a
field-level merge, not a soft lock. Implemented in `src/routes/seating.ts`
+ `src/seating-diff.ts`.

- On load, the app records the file's current `headRevisionId`.
- On save, it checks that ID against Drive's current one for the file.
  - Unchanged → save proceeds normally.
  - Changed → refuse the silent overwrite; tell the editor the file changed
    since they opened it and they need to reload before saving (their
    in-progress edits are not lost, just blocked from saving until they
    reconcile manually).
- No auto-merge logic, no per-guest/per-table diffing to *apply* changes.
  Simple, and enough given this is realistically just two people (Martial +
  Hanna, occasionally a helper) editing, not a crowd — worth revisiting only
  if that usage pattern changes.

### Conflict UI

When Save is refused (revision ID mismatch), show a modal:

1. **Plain-English diff, display-only** — compare the current Drive version
   against the baseline the editor loaded from, and list what changed
   remotely (e.g. "Hanna moved 3 guests (Jane Doe → Table 9, ...),
   renamed Table 14"). This is a read-side diff for the editor's information;
   nothing gets auto-applied.
2. **Three actions:**
   - *Reload their version* — discards local edits, loads current Drive
     state fresh.
   - *Save mine anyway* — force-overwrites, discarding the remote changes
     instead (`force: true` in the PUT body — server re-checks Drive's own
     current revision rather than the stale client-supplied one).
   - *Cancel* — back to editing, decide later, nothing saved.
3. No side-by-side visual floor-plan diff — real UI work for a conflict that
   should be rare with only two editors; the text summary is enough to make
   an informed choice.

### Diff logic

Drive has no built-in semantic diff for arbitrary (non-Docs) files — it only
stores raw byte snapshots per revision. The diff has to be custom code, but
it's small because the data shape is diff-friendly (flat, id-keyed records,
fixed-position arrays, no free-form text):

- `guests`: array of `{id, name, party, unconfirmed?}`. Build an `id`-keyed
  map for both the baseline and the current Drive version; anything missing
  in one map is an add/remove, anything present in both with different
  field values is a change. No fuzzy matching needed — `id` is stable.
- `tables`: array of `{id, name, seats: [guestId|null, ...10]}`. Same
  `id`-keyed approach for table-level fields (name, position); `seats` is
  compared index-by-index (`seatsOld[i] !== seatsNew[i]` → seat i changed
  occupant) since seats are fixed slots, not a reorderable list.
- Roughly 30-40 lines: two `Map`s, two loops, a handful of message templates
  ("X moved to Table Y", "Z renamed to W", "guest A added/removed") to turn
  raw diffs into the plain-English list shown in the conflict modal.

**Note on `nextId` (new-guest id assignment):** two editors concurrently
adding *different* new guests should not collide, but only if `nextId` is
read fresh from Drive at save time rather than cached from page-load —
worth being deliberate about this when implementing, not assumed to be safe
by default.

## First-run setup

One-time steps before the platform is usable:

1. **OAuth device grant approval** — run any script that touches Drive
   (e.g. `npx tsx src/setup-prod.ts`); it prints a device code + URL.
   Approve once from phone/laptop; Google returns a refresh token, written
   to the local credentials file (`DRIVE_TOKEN_PATH`). Silent afterward
   (OAuth consent screen must already be "In production," per above, or
   the refresh token expires in 7 days). **This must always be run by
   Martial himself, never automated** — device-flow approval looks
   identical to a phishing pattern, so the assistant hands over the exact
   command rather than running it.
2. **Initial Drive file creation** — every file the app touches
   (`seating.json`, `playlist.json`, `ceremony.json`, `transportation.json`,
   `guests-auth.json`) must be created *by the app* (not hand-uploaded — see
   `drive.file` ownership note above). Run `npx tsx src/setup-prod.ts`
   once against the prod folder — it creates any missing files (never
   overwrites existing ones). `seating.json`'s first-creation shape comes
   from `data/venue-seed.json` if present (real venue rooms/outlines —
   gitignored, see `data/venue-seed.json.example` for the shape), otherwise
   an empty default. Editor/vendor passwords aren't Drive files at all —
   just set `EDITOR_PASSWORD`/`VENDOR_PASSWORD` in `.env`. (`npx tsx
   src/setup-dev.ts` is the dev-folder equivalent, seeded instead from the
   committed `seating-chart/seating-seed-dev.json` fake data — refuses to
   run unless `DRIVE_FOLDER_NAME` contains `"dev"`.)

## Resolved

- **Guest link shape**: short, household-specific token link (not per
  individual, not a shared open link). One token per household.
- **Vendor page scoping**: each `vendorType` gets a custom default set of
  pages/nav (e.g. photographer sees the ceremony timeline + hair/makeup
  schedule by default), but this is a UI convenience, not an access boundary
  — every vendor can reach every page (read-only) regardless of type.
