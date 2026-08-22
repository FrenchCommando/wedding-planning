// Generic seed-sync tool, one entry point for every sub-project's
// repeatable "push real content to the live Drive file" need (ceremony,
// playlist, transportation, ... — anything that, unlike seating's
// first-creation-only venue-seed, is expected to be reseeded more than
// once). Not project-specific: pass the sub-project name and it maps to
// `data/<name>-seed.json` (gitignored, real content) and Drive's
// `<name>.json`.
//
// Usage:
//   npx tsx src/seed-sync.ts ceremony            # dry run: prints a diff
//   npx tsx src/seed-sync.ts ceremony --apply     # overwrites the live file
//
// Dry run is the default on purpose — this talks to the real prod Drive
// folder, so seeing what would change before it changes is the safe path.
import "dotenv/config";
import fs from "node:fs";
import { readJsonFile, seedJsonFile } from "./drive.js";

function seedPath(name: string): string {
  return `./data/${name}-seed.json`;
}

function loadSeed(name: string): unknown {
  const p = seedPath(name);
  if (!fs.existsSync(p)) {
    throw new Error(`missing ${p} — copy data/${name}-seed.json.example and fill in real data`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Small recursive diff: reports added/removed/changed leaf paths between
// the live data and the seed. Good enough for the flat, id-keyed shapes
// every sub-project's data file uses — not a general-purpose diff library.
function diff(live: unknown, seed: unknown, path = ""): string[] {
  if (JSON.stringify(live) === JSON.stringify(seed)) return [];
  const isObj = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);

  if (isObj(live) && isObj(seed)) {
    const keys = new Set([...Object.keys(live as object), ...Object.keys(seed as object)]);
    return [...keys].flatMap((k) => diff((live as any)[k], (seed as any)[k], path ? `${path}.${k}` : k));
  }
  if (Array.isArray(live) && Array.isArray(seed)) {
    const len = Math.max(live.length, seed.length);
    const lines: string[] = [];
    for (let i = 0; i < len; i++) {
      lines.push(...diff(live[i], seed[i], `${path}[${i}]`));
    }
    return lines;
  }
  return [`${path || "(root)"}: ${JSON.stringify(live)} -> ${JSON.stringify(seed)}`];
}

async function main() {
  const [name, flag] = process.argv.slice(2);
  if (!name) {
    throw new Error("usage: npx tsx src/seed-sync.ts <name> [--apply]");
  }
  const apply = flag === "--apply";

  const folder = process.env.DRIVE_FOLDER_NAME ?? "";
  if (folder.includes("dev")) {
    throw new Error(`refusing to run: DRIVE_FOLDER_NAME="${folder}" looks like a dev folder`);
  }

  const seed = loadSeed(name);
  const { data: live } = await readJsonFile(`${name}.json`, seed);

  const changes = diff(live, seed);
  if (changes.length === 0) {
    console.log(`${name}.json on Drive already matches data/${name}-seed.json. Nothing to do.`);
    return;
  }

  console.log(`Live ${name}.json differs from data/${name}-seed.json:`);
  for (const line of changes) console.log(`  ${line}`);

  if (!apply) {
    console.log(`\nDry run only — rerun with --apply to overwrite the live file with the seed above.`);
    return;
  }

  await seedJsonFile(`${name}.json`, seed);
  console.log(`\n${name}.json overwritten on Drive.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
