// Activity log — plain local file on the Pi, deliberately NOT on Drive.
//
// Per CLAUDE.md "Activity logging": a live per-event Drive write would mean a
// full read-modify-write of the log file plus a new revision snapshot every
// time someone logs in — latency and revision-history noise. Losing this log
// in a Pi failure is a non-event; losing planning data is not. Hence the
// split: durable data on Drive, operational logs on the Pi.
//
// Format is one tab-separated line per event so it stays readable with a
// plain `tail -f` on the Pi while still being trivially parseable for the
// admin page:
//
//   2026-08-27T14:03:22.101Z<TAB>editor<TAB>save<TAB>seating<TAB>175 guests
import fs from "node:fs";
import path from "node:path";
import type { Request } from "express";
import type { SessionPayload } from "./auth/session.js";

export interface ActivityEntry {
  at: string;
  /** Who acted, already resolved to something readable: "editor", "vendor (photographer)", "guest (Smith Family)". */
  actor: string;
  /** What they did: "login", "save", "mint-guest-link", "login-failed". */
  action: string;
  /** What they did it to: "seating", "ceremony", "welcome-drinks", "sunday-brunch", "" for logins. */
  target: string;
  /** Free-text extra context, may be empty. */
  detail: string;
}

function logPath(): string {
  return process.env.ACTIVITY_LOG_PATH ?? "./data/activity.log";
}

/** Human-readable actor string from a session, for the log's second column. */
export function actorFrom(session: SessionPayload | undefined): string {
  if (!session) return "anonymous";
  if (session.role === "guest") return `guest (${session.household ?? "unknown"})`;
  if (session.role === "vendor") return `vendor (${session.vendorType ?? "unspecified"})`;
  return session.role;
}

/** Tabs and newlines would corrupt the one-line-per-event format. */
function clean(s: string): string {
  return (s ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

/**
 * Appends one event. Never throws and never blocks the request — a failed
 * log write must not turn into a failed save. Errors go to the container's
 * stdout (visible via `docker compose logs`) and are otherwise swallowed.
 */
export function logActivity(actor: string, action: string, target = "", detail = ""): void {
  const line = [new Date().toISOString(), clean(actor), clean(action), clean(target), clean(detail)].join("\t") + "\n";
  const p = logPath();
  fs.mkdir(path.dirname(p), { recursive: true }, (mkdirErr) => {
    if (mkdirErr) {
      console.error("activity-log: mkdir failed", mkdirErr);
      return;
    }
    fs.appendFile(p, line, (err) => {
      if (err) console.error("activity-log: append failed", err);
    });
  });
}

/** Convenience wrapper for the common "log what this request's session did" case. */
export function logRequest(req: Request, action: string, target = "", detail = ""): void {
  logActivity(actorFrom(req.session), action, target, detail);
}

/**
 * Most recent entries, newest first. Reads the whole file — fine at this
 * scale (a wedding's worth of logins and saves is kilobytes, not megabytes)
 * and avoids a rotation/seek scheme the spec doesn't call for. If the file
 * doesn't exist yet, that's a normal empty state, not an error.
 */
export function readActivity(limit = 500): ActivityEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(logPath(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }

  const entries: ActivityEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [at = "", actor = "", action = "", target = "", detail = ""] = line.split("\t");
    entries.push({ at, actor, action, target, detail });
  }
  // Sort by timestamp rather than trusting file order: appends are async and
  // two near-simultaneous events can land out of order. The timestamp is
  // taken synchronously when the event happens, so it's the reliable one.
  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return entries.slice(0, limit);
}
