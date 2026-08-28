// One-off importer: parses the wedsites guest-list CSV export into ONE
// canonical JSON (data/guests-import.json, gitignored) with every relevant
// field per guest, kept as raw values — no filtering, no per-app logic.
// This is the single parse pass; per-app seed files (data/welcome-drinks-
// seed.json, data/sunday-brunch-seed.json, etc.) get written by hand from
// this canonical file when actually needed, applying judgment about who
// counts as attending rather than a rigid regex filter baked into a script.
// Re-parsing the CSV once per app was the thing being avoided here.
//
// Usage:
//   npx tsx src/import-guests-csv.ts [path-to-csv]
//   (defaults to ./data/guests-export.csv, gitignored — drop a fresh
//   export there first)
//
// Hand-rolled CSV parser (no new dependency, by explicit decision) —
// handles RFC4180 quoting (quoted fields, embedded commas, doubled ""
// for a literal quote), which is what this export's Excel-style escaped
// fields (e.g. a raw ="+1" cell) actually need; no special-casing beyond
// correct quote handling. Verified against a synthetic CSV reproducing
// these cases.
import "dotenv/config";
import fs from "node:fs";

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  // last field/row if the file doesn't end with a newline
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function findCol(headers: string[], pattern: RegExp): number {
  return headers.findIndex((h) => pattern.test(h));
}

// Columns kept, in the shape other tools/seeds will actually read.
// Skipped on purpose (internal wedsites tracking, not useful downstream):
// Stationery, List, Language code, Address, Country, Children, Gift,
// Update details, RSVP online, Check-in, Invitation, Save the date,
// Table, Seat (seating is now live in seating.json, a stale CSV snapshot
// of table/seat isn't the source of truth).
const COLUMNS: Record<string, RegExp> = {
  first: /^first name$/i,
  last: /^last name$/i,
  household: /^household$/i,
  side: /^side$/i,
  group: /^group$/i,
  age: /^age$/i,
  dietary: /^dietary$/i,
  notes: /^notes$/i,
  rsvp: /^rsvp$/i,
  email: /^email$/i,
  phone: /^phone$/i,
  welcomeDrinks: /friday welcome/i,
  shuttleToVenue: /shuttle to the venue/i,
  shuttleBack: /shuttle back/i,
  brunch: /brunch/i,
};

function main() {
  const csvPath = process.argv[2] ?? "./data/guests-export.csv";
  if (!fs.existsSync(csvPath)) {
    throw new Error(`missing ${csvPath} — drop a fresh guest-list export there (gitignored) or pass a path`);
  }

  const rows = parseCSV(fs.readFileSync(csvPath, "utf8").replace(/^﻿/, ""));
  if (!rows.length) throw new Error("CSV appears empty");
  const headers = rows[0];
  const dataRows = rows.slice(1).filter((r) => r.some((v) => v.trim() !== ""));

  const idx: Record<string, number> = {};
  for (const [key, pattern] of Object.entries(COLUMNS)) {
    idx[key] = findCol(headers, pattern);
    if (idx[key] === -1) throw new Error(`couldn't find a "${key}" column in the CSV header — check the export's column names`);
  }

  const guests = dataRows.map((row) => {
    const get = (key: string) => (row[idx[key]] || "").trim();
    const name = [get("first"), get("last")].filter(Boolean).join(" ");
    const record: Record<string, string> = { name };
    for (const key of Object.keys(COLUMNS)) {
      if (key === "first" || key === "last") continue;
      const v = get(key);
      if (v) record[key] = v;
    }
    return record;
  }).filter((g) => g.name);

  const outPath = "./data/guests-import.json";
  fs.writeFileSync(outPath, JSON.stringify({ guests }, null, 2) + "\n");
  console.log(`${guests.length} guests parsed, written to ${outPath}`);
}

main();
