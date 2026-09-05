// Dev setup: ensures the Drive data folder and its files exist, and seeds
// fake seating data. Editor/vendor passwords come from .env (EDITOR_PASSWORD
// / VENDOR_PASSWORD), not Drive — nothing to set here.
// Safe to rerun (idempotent). Requires DRIVE_FOLDER_NAME to name a dev folder.
import "dotenv/config";
import fs from "node:fs";
import { readJsonFile, seedJsonFile } from "./drive.js";

// Fixture data lives in its own JSON file per sub-project (single source of
// truth, reviewable/editable directly) rather than as object literals here.
const FAKE_CEREMONY = JSON.parse(fs.readFileSync("./ceremony/ceremony-seed-dev.json", "utf8"));
const FAKE_SEATING = JSON.parse(fs.readFileSync("./seating-chart/seating-seed-dev.json", "utf8"));
const FAKE_WELCOME_DRINKS = JSON.parse(fs.readFileSync("./welcome-drinks/welcome-drinks-seed-dev.json", "utf8"));
const FAKE_SUNDAY_BRUNCH = JSON.parse(fs.readFileSync("./sunday-brunch/sunday-brunch-seed-dev.json", "utf8"));
const FAKE_SPEECHES = JSON.parse(fs.readFileSync("./ceremony/speeches-seed-dev.json", "utf8"));
const FAKE_SCRIPT = JSON.parse(fs.readFileSync("./ceremony/script-seed-dev.json", "utf8"));
const FAKE_STATIONERY = JSON.parse(fs.readFileSync("./stationery/stationery-seed-dev.json", "utf8"));

async function main() {
  const folder = process.env.DRIVE_FOLDER_NAME ?? "";
  if (!folder.includes("dev")) {
    throw new Error(`refusing to run: DRIVE_FOLDER_NAME="${folder}" doesn't look like a dev folder (must contain "dev")`);
  }
  if (!process.env.EDITOR_PASSWORD || !process.env.VENDOR_PASSWORD) {
    throw new Error("set EDITOR_PASSWORD and VENDOR_PASSWORD in .env first");
  }

  await readJsonFile("guests-auth.json", { households: [] });
  await seedJsonFile("seating.json", FAKE_SEATING);
  await seedJsonFile("ceremony.json", FAKE_CEREMONY);
  await seedJsonFile("welcome-drinks.json", FAKE_WELCOME_DRINKS);
  await seedJsonFile("sunday-brunch.json", FAKE_SUNDAY_BRUNCH);
  await seedJsonFile("speeches.json", FAKE_SPEECHES);
  await seedJsonFile("script.json", FAKE_SCRIPT);
  await seedJsonFile("stationery.json", FAKE_STATIONERY);

  console.log("Drive data folder ready. Login with EDITOR_PASSWORD / VENDOR_PASSWORD from .env.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
