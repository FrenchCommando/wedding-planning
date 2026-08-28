# Status

**Built and working:**
- Backend skeleton, auth, Drive integration — done, per spec below.
- Seating chart — migrated off File System Access API to the backend; optimistic-lock save with plain-English conflict diff + force-overwrite. Real 175-guest data is live in the **prod** Drive folder. Mobile: sidebar becomes an off-canvas drawer below 720px width (toggled by a `#sideToggle` "☰ Guests" button, backdrop click / Escape to close) instead of the old fixed 290px grid column that ate the whole phone screen. Pan/zoom is clamped (`clampPan` inside `applyTransform`, in `seating-chart/seating-plan.js`) so dragging/scrolling can no longer push the plan fully off-canvas with nothing left to grab. Dark mode uses proper tokens now (`--floor`, `--hover`, `--th-bg`, `--nocell-bg`, `--chip-bg`, `--kbd-bg`, `--outline-bg/border/ink`) instead of several hardcoded light-only colors (the canvas floor background and the occupied-seat text/background contrast were the worst offenders). The "PDF" print output is forced light always (`background:#fff` in `@media print`, not `var(--panel)`) since paper output shouldn't follow OS dark mode. `seating-chart/seating-plan.html` is now just the HTML shell — its CSS/JS live in sibling `seating-plan.css`/`seating-plan.js`, and the "Read-only" downloadable snapshot's markup/CSS live in their own `readonly.html`/`readonly.css` (fetched at export time and inlined into the downloaded blob, so the download is still a single self-contained file), all no longer duplicated as JS template strings. History/milestone-save feature: see "Concurrent editing" below. **Verified via the running dev server + `curl`/`node --check`/`tsc --noEmit`, but not click-tested end-to-end in an actual browser (no browser tool connected) — worth a manual pass over mobile drawer, dark mode, Read-only export, and History before fully trusting it.**
- Ceremony page — timed program outline with scroll-reveal, plus a real vertical aisle diagram (Entrance bottom → Altar top) for Processional/Recessional moments. Motion is scroll-linked (position tied to scroll offset via `getBoundingClientRect`), not timer/autoplay-based. Uses a `position:sticky` spacer-pin pattern so the page freezes while the diagram animates, then releases. "End" marker caps the timeline; page bottom padding is computed in JS so max-scroll lands exactly at End's top. Each processional-order person has a plain-text `emoji` field (default 🚶) editable in the UI — not inferred from name/role text. Rail geometry (gutter/line/dot/time-column widths) is driven by CSS custom properties with a `@media (max-width:520px)` override, so it's not fixed-desktop-pixel-only. Real 8-moment/6-processional-entry program is live in the **prod** Drive folder (pushed via `src/seed-sync.ts`, see below). Backend now also has the History/"compare with a previous version" feature (see "Concurrent editing" below) — no frontend button for it yet on the ceremony page itself, only the API routes.
- Landing page — role-aware nav, editor "preview as vendor" toggle, warm light/dark theme consistent across all three pages, banner link to the main wedding site (`WEDDING_SITE_URL` env var, hidden when unset). The role `<select>` dropdown used `background:transparent;color:inherit` — the closed control looked fine, but the opened native dropdown list is a separate rendering surface that doesn't reliably honor `transparent`, so it fell back to the browser's own default background while still forcing through the theme's (adapted) text color, landing light-on-light or dark-on-dark depending on OS/browser. Fixed with an explicit `background:var(--panel);color:var(--ink)`, same fix applied to the seating chart's search input for the same underlying reason.
- Deployed — Docker (standalone, no shared network dependency) + host nginx, live on the Pi. Redeploys on every push to `master` automatically via a self-hosted GitHub Actions runner on the Pi. See "Deployment" below for details and the manual fallback.
- Welcome Drinks (Friday night) and Sunday Brunch — two new sub-projects, same architecture as seating/ceremony: own Drive file (`welcome-drinks.json` / `sunday-brunch.json`), own router (`src/routes/welcome-drinks.ts` / `sunday-brunch.ts`), own page (`welcome-drinks/` / `sunday-brunch/`, split into `.html`/`.css`/`.js` from the start). Each has a simple `schedule` (time/title/description, no processional/aisle complexity) and a `guests` list (name/household/dietary/notes) — only attendees go in the list, filtered at import time, editable afterward like the seating chart's guest list. Both have the History/diff feature from day one (`src/welcome-drinks-diff-config.ts` / `sunday-brunch-diff-config.ts`). Nav-visible to `editor`/`vendor` only, not `guest` — this is organizer/caterer headcount data, not guest-facing (adjustable if that's wanted later). **Verified via the dev server + `curl`/`tsc --noEmit`/`node --check` (full GET/PUT/History/diff/role-gate pass), not click-tested in a browser.**
- Guest-list CSV importer (`src/import-guests-csv.ts`) — one-off script, hand-rolled RFC4180 CSV parser (no dependency added, by explicit decision), reads `data/guests-export.csv` (gitignored — the original export was deleted from the repo earlier as "superseded by Drive"; a fresh one must be dropped there before running this). **Deliberately does one thing only**: parses every guest's relevant raw fields (name, household, side, group, age, dietary, notes, RSVP, email, phone, and the raw Welcome-Drinks/shuttle/Brunch answers — unfiltered, no attendance judgment applied) into one canonical `data/guests-import.json`. No per-app filtering/seed-writing logic lives in this script — an earlier version tried to also generate `welcome-drinks-seed.json`/`sunday-brunch-seed.json` directly with a hardcoded yes/no filter, which was re-deciding the CSV's intent per app instead of once; per-app seed files get written by hand (Claude reading `guests-import.json` and applying judgment about who counts as attending, e.g. for `data/welcome-drinks-seed.json`) rather than by an automated filter. Doesn't touch Drive itself — pushing a seed once written still goes through the existing `src/seed-sync.ts <name>` tool (dry-run by default). Parser verified against a synthetic CSV reproducing the real export's tricky bits (embedded commas in quoted fields, the Excel-style `="+1"` escaped column, mixed-case yes/no values) — correct on all cases tested.

**Not yet built:** playlist as a backend-integrated page (`playlists/music-plan.html` is actually a fully-built, working Spotify-integrated planner — segments, cues, a run-of-show timeline, real OAuth/sync — just architecturally disconnected from the rest of the app: own directory, state saved inside the HTML file + localStorage, no Drive, no backend, not linked from the landing nav; **explicitly deferred**, "we have not designed anything there yet, hold off on porting anything" — moving its serving into the Express app will also break its Spotify OAuth redirect URI, which needs re-registering in the Spotify dashboard as a manual step, not something to do as a side effect of an unrelated change); transportation not started.

**Reseedable sub-project content (ceremony, and future playlist/transportation):** unlike seating's room outlines (first-creation-only, see below), a sub-project's main content is expected to be pushed more than once as it's drafted/revised. One generic tool handles this for all of them: `npx tsx src/seed-sync.ts <name>` — reads `data/<name>-seed.json` (gitignored, real content; see e.g. `data/ceremony-seed.json.example` for the shape), diffs it against the live `<name>.json` on Drive, and **prints the diff without writing anything** (dry run is the default since this targets real prod data). `npx tsx src/seed-sync.ts <name> --apply` actually overwrites, via `seedJsonFile` in `src/drive.ts`. Refuses to run if `DRIVE_FOLDER_NAME` looks like dev. Editors can also edit content directly in each sub-project's own edit mode; the seed tool is for bulk/initial loads, not the only way in. (`ceremony/ceremony-seed-dev.json` is a separate, committed fake-data fixture used only by `setup-dev.ts` — not the same file as the gitignored real `data/ceremony-seed.json`.)

**Room floor-plan outline data:** room objects in `seating.json` can carry `x1/y1/x2/y2` (fractional plan coordinates) to draw an outline; rooms without them just render with no outline. This is real venue data, so it's seeded once from a local, gitignored `data/venue-seed.json` (see `data/venue-seed.json.example` for the shape) by `setup-prod.ts`/`setup-dev.ts` on first file creation only — never re-seeded, never hardcoded in the HTML. There's deliberately no in-app UI to add/resize rooms: the seating editor is for seating guests, not surveying the venue, so room geometry stays data-only, edited by hand on Drive if it ever needs to change after first setup.

**CSS gotcha hit while adding the seating chart's mobile drawer:** adding a new DOM child inside a `display:grid` container (`.app` in `seating-chart/seating-plan.html`, a 2-column grid) silently becomes a third grid item unless it's given `display:none` (or taken out of flow) *outside* any media query that later re-enables it — a backdrop `<div>` meant only for a mobile breakpoint pushed the two real columns (`.side`, `.main`) into the wrong grid cells on desktop, because it had no default display rule and CSS grid auto-placed it into column 1. Fixed by unconditionally setting `display:none` on the extra element at the top level, only overridden to `block` inside the breakpoint. Worth checking for this pattern before adding any new child to `.app`.

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
     token into `guests-auth.json`. Admin UI at `public/admin.html`
     (editor-gated via `/api/whoami`) — table of household/token/created/
     link plus a "generate new" form, copy-to-clipboard on each link.
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
  - **Redeploying after a code change**: automatic. `.github/workflows/deploy.yml`
    runs on every push to `master` on a self-hosted GitHub Actions runner
    installed on the Pi itself (`~/actions-runner`, registered as a systemd
    service via `sudo ./svc.sh install`/`start` — survives reboot/logout).
    It `git pull --ff-only`s the existing provisioned clone at `APP_DIR`
    (hardcoded in the workflow to `/home/frenchcommando/wedding-planning`,
    overridable via an `APP_DIR` repo variable without a commit), runs
    `docker compose build` → `up -d`, then curls each sub-project's page to
    confirm it returns 200 before declaring success (catches the class of
    bug where build/up/nginx all "succeed" but a missing Dockerfile `COPY`
    still 404s the page). Manual fallback if the runner is ever down: `git
    pull` → `docker compose build` → `docker compose up -d` on the Pi
    directly, same as before this existed.
  - **Redeploying after an env-only change** (e.g. rotating a password,
    changing `VENUE_NAME`/`WEDDING_SITE_URL`): still manual — the workflow
    only pulls tracked files. `scp` the updated `.env.production` in, then
    `docker compose up -d` on the Pi — no rebuild.
- **Secrets**: `.env.example` committed to the repo (placeholder keys only);
  the real `.env` (dev) and `.env.production` (prod) are never committed —
  `.gitignore` excludes `.env*` except `.env.example`. On the Pi, `.env`
  would be scp'd directly, read by `docker-compose.yml` via `env_file`.
- **`.deploy-key` / `.deploy-key.pub`**: an SSH keypair, scoped to this repo
  only (registered as a GitHub deploy key, not a personal-account key),
  used to push to `master` from Martial's Claude Dispatch-triggered push
  flow (Dispatch tasks run outside a normal git-configured dev machine, so
  they need their own scoped push credential). Gitignored (`.gitignore`
  excludes `.deploy-key*`), never committed. Unrelated to the GitHub
  Actions self-hosted runner on the Pi, which only pulls — it doesn't need
  push access at all.
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
+ the generic diff engine (`src/data-diff.ts`, see below).

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
stores raw byte snapshots per revision. The diff is custom code, but it's a
**generic, reusable engine** (`src/data-diff.ts`'s `diffData()`) rather than
a hand-written function per sub-project, because the data shape is
diff-friendly the same way across all of them (flat, id-keyed record arrays,
sometimes a fixed-position "slot" array referencing another collection, no
free-form text). Originally seating had its own bespoke `seating-diff.ts`
and ceremony had none (per the old "not worth the machinery" reasoning
below); once "compare with a previous version" became a feature every
sub-project should have, that asymmetry stopped making sense, so it's now
one engine driven by a small per-sub-project config:

- Each sub-project declares its collections in a config file
  (`src/seating-diff-config.ts`, `src/ceremony-diff-config.ts`) — a `label()`
  function per collection (e.g. a guest's name, a moment's title), which
  fields are worth surfacing as "changed" (opt-in, not every field — most
  fields like a table's `fx`/`fy` position aren't worth a diff line), and
  optionally a `slots` config for fixed-position reference arrays (seating's
  `tables[].seats` → guest ids), which `diffData()` turns into "X moved to
  Table Y, seat Z" / "added to" / "removed from" messages by cross-
  referencing the target collection's own `label()` — not raw index noise.
- `diffData(baseline, current, config)` does the actual comparing: id-keyed
  `Map`s per collection for add/remove detection, opt-in field comparison,
  and the slot-array move detection described above.
- Adding a new sub-project's diff support (playlist, transportation) is
  writing one small config file, not another hand-rolled diff function.

**Note on `nextId` (new-record id assignment):** two editors concurrently
adding *different* new records should not collide, but only if `nextId` is
read fresh from Drive at save time rather than cached from page-load —
worth being deliberate about this when implementing, not assumed to be safe
by default.

### History / "compare with a previous version"

Beyond the save-conflict diff (above), there's a standing **History** button
(seating chart toolbar) that lists past Drive revisions and diffs any of
them against the current live data — same `diffData()` engine, different
baseline (a past revision's content instead of the editor's stale in-browser
copy). Reusable route pair for this, `mountRevisionRoutes()` in
`src/revision-routes.ts`, mounted once per sub-project's router (currently
seating and ceremony) rather than copy-pasted — `GET <path>/revisions`
(list) and `GET <path>/revisions/:id/diff` (compare with current).

- **Milestone saves**: `Shift`+click the seating chart's Save button (or
  `keepForever: true` in the PUT body) pins that revision so Drive never
  auto-prunes its content — the intended way to guarantee a save stays
  comparable long-term (e.g. "final chart before printing"). There's no
  dedicated UI for this on ceremony yet, only the `keepForever` field on the
  PUT body itself.
- **Revision retention for non-milestone saves is not fully understood** —
  don't assert a specific rule. One three-week-old dev revision came back
  `cannotDownloadRevision` (Drive still lists it, but `alt=media` 403s) while
  two more-recent, also-non-milestone saves diffed successfully. So it's
  *not* "prunes almost immediately," but there's clearly some retention
  boundary for unpinned revisions and its exact shape (time-based? count-
  based?) hasn't been pinned down. `getRevision()` in `src/drive.ts` handles
  the undownloadable case as a clean 404 either way, so this isn't a crash
  risk — just don't promise users a specific "how far back" guarantee.
- Discovered while building this: an unhandled rejection in an async Express
  route handler **crashes the whole server process** (Express 4, used here,
  doesn't auto-catch these — Express 5 does). Confirmed for real via the
  `cannotDownloadRevision` case above taking down the dev server outright.
  Fixed with a shared `asyncRoute()` wrapper (`src/asyncHandler.ts`) applied
  to every async route handler across the backend, plus a catch-all error
  middleware in `server.ts` (must be last, must take 4 params to be
  recognized as Express error middleware) — worth wrapping any new async
  route in `asyncRoute()` from now on, not just the revision ones.

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
