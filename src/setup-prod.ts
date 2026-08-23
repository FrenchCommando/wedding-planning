// First-run prod setup: ensures the Drive data folder and its files exist.
// Editor/vendor passwords come from .env (EDITOR_PASSWORD / VENDOR_PASSWORD)
// — set those before deploying, nothing to do here for passwords.
//
// Venue-specific seating setup (room names + floor-plan outline coordinates)
// is real venue data, so it's never hardcoded here — it's read from an
// optional local data/venue-seed.json (gitignored, same treatment as
// drive-token.json) if present. Once seating.json exists on Drive, this
// script never touches it again — room outlines from then on are edited
// in the seating app itself (drag a room outline's corner), not re-seeded.
import "dotenv/config";
import fs from "node:fs";
import { readJsonFile } from "./drive.js";

const VENUE_SEED_PATH = "./data/venue-seed.json";
const EMPTY_SEATING = { rooms: [], tables: [], guests: [], partyColors: {}, nextId: 1 };

function loadSeatingSeed(): typeof EMPTY_SEATING {
  if (!fs.existsSync(VENUE_SEED_PATH)) return EMPTY_SEATING;
  const seed = JSON.parse(fs.readFileSync(VENUE_SEED_PATH, "utf8"));
  return { ...EMPTY_SEATING, ...seed };
}

async function main() {
  const folder = process.env.DRIVE_FOLDER_NAME ?? "";
  if (folder.includes("dev")) {
    throw new Error(`refusing to run: DRIVE_FOLDER_NAME="${folder}" looks like a dev folder`);
  }
  if (!process.env.EDITOR_PASSWORD || !process.env.VENDOR_PASSWORD) {
    throw new Error("set EDITOR_PASSWORD and VENDOR_PASSWORD in .env first");
  }

  await readJsonFile("guests-auth.json", { households: [] });
  await readJsonFile("seating.json", loadSeatingSeed());
  await readJsonFile("ceremony.json", { moments: [], processionalOrder: [], recessionalOrder: [], nextId: 1 });
  await readJsonFile("welcome-drinks.json", { schedule: [], guests: [], nextId: 1 });
  await readJsonFile("sunday-brunch.json", { schedule: [], guests: [], nextId: 1 });

  console.log("Drive data folder and files ready.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
