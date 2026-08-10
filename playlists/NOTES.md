# Music plan — notes

`music-plan.html` is the whole thing: planner UI + Spotify sync, single file, no build step.
The file is its own save format — state is baked into the `#stateData` script tag, so whatever
copy you're looking at *is* the plan. Edits are stashed in localStorage continuously; **Save file**
writes them back into the HTML. Shift-click Save to force the file picker.

## Running it

Planning only (no Spotify) — just open the file.

Anything touching Spotify needs it served over loopback, because Spotify refuses `file://`
redirect URIs:

```
cd playlists
python -m http.server 8000 --bind 127.0.0.1
```

then `http://127.0.0.1:8000/music-plan.html`. Ctrl+C to stop.

No venv, no installs — `http.server` is stdlib and everything else runs in the browser.
On this machine `python` is 3.12 (`%LOCALAPPDATA%\Programs\Python\Python312`) and `py` is 3.14 —
either is fine, `http.server` is identical in both and there's no Python code here to care about it.
**Don't use `python3`** — that resolves to the Microsoft Store stub in `WindowsApps` and opens the
Store instead of serving. `npx serve -l 8000` is an equivalent if Node is handier, but check what it
prints: some servers say `localhost` where Spotify's registered URI says `127.0.0.1`, and those are
different strings as far as the redirect check is concerned.

## Spotify setup (one-time, already done once)

1. developer.spotify.com/dashboard → Create app (any name).
2. Redirect URI must match the serving URL **exactly**: `http://127.0.0.1:8000/music-plan.html`.
   Change the port and you must add the new URI to the app too.
3. Tick **Web API**. Save.
4. Copy the Client ID, paste it into the Connect Spotify dialog.

Auth is PKCE — no client secret is stored anywhere, so the HTML is safe to send to people.
The Client ID and tokens live in localStorage, i.e. per-browser: on a new machine you re-paste
the Client ID and log in again. The plan itself travels in the file.

## The three Spotify buttons

- **Import playlist** — pull an existing Spotify playlist into a segment. Replaces that segment's
  bed tracks, keeps its cues. Use this first: it fills in real durations, which is what makes the
  runtime-vs-slot maths meaningful.
- **Match tracks** — searches for hand-typed entries, shows a review table before applying.
  Anything under 70% confidence is flagged. Untick a bad match, fix the spelling, run it again.
- **Sync to Spotify** — pushes each segment to its playlist as an exact mirror (replace, not append).
  Creates the playlist if the segment has none. Idempotent — re-run after every edit, it won't
  duplicate. Entries with no matched track are skipped silently, so run Match first.

Sync is one-directional: plan → Spotify. If you edit a playlist in the Spotify app, the plan
doesn't know — re-import that segment to pull the changes back.

## Model

- **Segments** = blocks of the day, in order. Times are HH:MM and wrap past midnight (Party ends 02:00).
- **Bed tracks** flow in order and fill the slot.
- **Cues** (★) are pinned to a clock time and reset the running clock shown next to each row —
  so the times down the left are the predicted actual start time of each track.
- Sidebar shows runtime vs. slot length per segment, plus gaps/overlaps between consecutive segments.
- **Timeline** view is the run-of-show page — cues at their times, for the DJ or venue.

## Gotchas

- Durations only exist for tracks matched to Spotify. Untimed tracks count as zero, so a segment
  can look "short" purely because nothing is matched yet. The header shows an *N untimed* warning.
- The default seed segments (Prelude → Party) are placeholders; real times need confirming against
  the venue schedule.
- Bulk add: paste many `Artist – Title` lines into the add box at once. Enter adds a track,
  Shift+Enter adds a cue.
- Fallback if the API path is ever annoying: **Export text** gives per-segment blocks formatted for
  paste-import at spotlistr.com or tunemymusic.com.
