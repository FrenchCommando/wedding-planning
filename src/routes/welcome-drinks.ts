import { Router } from "express";
import { readJsonFile, writeJsonFile } from "../drive.js";
import { requireRole } from "../auth/session.js";
import { asyncRoute } from "../asyncHandler.js";
import { mountRevisionRoutes } from "../revision-routes.js";
import { welcomeDrinksDiffConfig } from "../welcome-drinks-diff-config.js";
import { logRequest } from "../activity-log.js";

const FILE_NAME = "welcome-drinks.json";

const DEFAULT_STATE = {
  schedule: [] as { id: number; time: string; title: string; description?: string }[],
  // Only attendees go here (filtered at CSV-import time from the RSVP
  // form's Welcome Drinks column) — editable afterward like the seating
  // chart's guest list, so a manual override or late addition doesn't
  // need a re-import.
  guests: [] as { id: number; name: string; household?: string; dietary?: string; notes?: string }[],
  nextId: 1,
};

const router = Router();

router.get("/welcome-drinks", requireRole("editor", "vendor"), asyncRoute(async (_req, res) => {
  const { data, revisionId } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
  res.json({ data, revisionId });
}));

// Same simpler PUT as ceremony: no plain-English conflict diff on save,
// just refuse on a stale revision and ask to reload — small, low-traffic
// list edited by ~2 people, not a real concurrent-collision risk.
router.put("/welcome-drinks", requireRole("editor"), asyncRoute(async (req, res) => {
  const { data, revisionId } = req.body ?? {};
  if (!data || typeof revisionId !== "string") {
    res.status(400).json({ error: "data and revisionId required" });
    return;
  }

  const result = await writeJsonFile(FILE_NAME, data, revisionId);
  if ("conflict" in result) {
    res.status(409).json({ error: "conflict", currentRevisionId: result.currentRevisionId });
    return;
  }
  logRequest(req, "save", "welcome-drinks");
  res.json({ revisionId: result.revisionId });
}));

mountRevisionRoutes(router, { path: "/welcome-drinks", fileName: FILE_NAME, defaultState: DEFAULT_STATE, diffConfig: welcomeDrinksDiffConfig });

export default router;
