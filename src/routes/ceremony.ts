import { Router } from "express";
import { readJsonFile, writeJsonFile } from "../drive.js";
import { requireRole } from "../auth/session.js";
import { asyncRoute } from "../asyncHandler.js";
import { mountRevisionRoutes } from "../revision-routes.js";
import { ceremonyDiffConfig } from "../ceremony-diff-config.js";

const FILE_NAME = "ceremony.json";

const DEFAULT_STATE = {
  moments: [] as { id: number; time: string; title: string; description?: string; participants?: string }[],
  // Aisle order for the processional/recessional: who walks in/out, in what
  // order, and how many seconds after that moment starts. Drives the aisle
  // diagram. Independent lists — recessional isn't derived from processional
  // (different pairing, someone leaving early, etc. are all real cases) —
  // the frontend backfills recessionalOrder once from the old reverse-of-
  // processional behavior for data saved before this field existed.
  processionalOrder: [] as { id: number; name: string; role?: string; emoji?: string; startAt: number }[],
  recessionalOrder: [] as { id: number; name: string; role?: string; emoji?: string; startAt: number }[],
  nextId: 1,
};

const router = Router();

router.get("/ceremony", requireRole("editor", "vendor", "guest"), asyncRoute(async (_req, res) => {
  const { data, revisionId } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
  res.json({ data, revisionId });
}));

// Simpler than seating's PUT: no plain-English conflict diff, just refuse
// on a stale revision and ask to reload — per the spec, ceremony/playlist/
// transportation are append-only-ish lists edited by ~2 people, not a real
// concurrent-collision risk worth the extra diff machinery seating needed.
router.put("/ceremony", requireRole("editor"), asyncRoute(async (req, res) => {
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
  res.json({ revisionId: result.revisionId });
}));

// Past-saves list + "compare with a previous version" — same reusable
// route pair seating's data file gets, see mountRevisionRoutes. Doesn't
// change the save-conflict UX above (still "someone else saved, reload" —
// that asymmetry with seating is a separate, deliberate decision, not
// touched here); this only adds the History feature.
mountRevisionRoutes(router, { path: "/ceremony", fileName: FILE_NAME, defaultState: DEFAULT_STATE, diffConfig: ceremonyDiffConfig });

export default router;
