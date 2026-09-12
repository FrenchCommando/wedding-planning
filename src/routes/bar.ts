import { Router } from "express";
import { readJsonFile, writeJsonFile } from "../drive.js";
import { requireRole } from "../auth/session.js";
import { asyncRoute } from "../asyncHandler.js";
import { mountRevisionRoutes } from "../revision-routes.js";
import { barDiffConfig } from "../bar-diff-config.js";
import { logRequest } from "../activity-log.js";

const FILE_NAME = "bar.json";

// The alcohol order for the reception: what's being considered, what was
// chosen, and how much of it is being bought. One flat list, one row per
// bottle line (a champagne, a red, a gin, ...). Unrelated to the Welcome
// Drinks page, which is Friday night's guest list and schedule.
const DEFAULT_STATE = {
  // Drinking headcount the quantity estimates are worked from. Kept here
  // rather than derived from the seating chart because the number that
  // matters (adults who drink, minus the ones who drive) is a judgment
  // call, not a guest count.
  guestCount: 0,
  guestCountNote: "",
  // When the order arrives at the venue, shown across the top of the
  // board. Free text ("10 AM", "Friday 10:00"), with a note for where and
  // who signs for it.
  deliveryTime: "",
  deliveryNote: "",
  items: [] as {
    id: number;
    name: string;
    // Closed list on the page (Champagne & sparkling, White wine, ...),
    // groups the rows.
    category?: string;
    // When it's poured: cocktail hour, dinner, party. Free text.
    moment?: string;
    // Considering → Shortlisted → Chosen → Ordered → Delivered, or Dropped.
    // Only Chosen/Ordered/Delivered count toward the order totals.
    status?: string;
    quantity?: number;
    // What one unit is: "75cl bottle", "magnum", "case of 6", "keg".
    unit?: string;
    supplier?: string;
    // Tile emoji; blank falls back to the category's on the page. Prices
    // are deliberately not tracked — the page is a picture of the order,
    // not a budget.
    emoji?: string;
    // Estimate inputs: glasses per unit and glasses per guest give a
    // suggested quantity from `guestCount`; the typed `quantity` is what's
    // actually ordered.
    servingsPerUnit?: number;
    perGuest?: number;
    notes?: string;
  }[],
  nextId: 1,
};

const router = Router();

router.get("/bar", requireRole("editor", "vendor"), asyncRoute(async (_req, res) => {
  const { data, revisionId } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
  res.json({ data, revisionId });
}));

// Same simpler PUT as welcome-drinks/stationery: no plain-English conflict
// diff on save, just refuse on a stale revision and ask to reload.
router.put("/bar", requireRole("editor"), asyncRoute(async (req, res) => {
  // `keepForever` pins the revision — "this is the order that went to the
  // supplier", same as the seating chart's and stationery's milestone save.
  const { data, revisionId, keepForever } = req.body ?? {};
  if (!data || typeof revisionId !== "string") {
    res.status(400).json({ error: "data and revisionId required" });
    return;
  }

  const result = await writeJsonFile(FILE_NAME, data, revisionId, { keepForever: !!keepForever });
  if ("conflict" in result) {
    res.status(409).json({ error: "conflict", currentRevisionId: result.currentRevisionId });
    return;
  }
  logRequest(req, "save", "bar", keepForever ? "milestone" : "");
  res.json({ revisionId: result.revisionId });
}));

mountRevisionRoutes(router, { path: "/bar", fileName: FILE_NAME, defaultState: DEFAULT_STATE, diffConfig: barDiffConfig });

export default router;
