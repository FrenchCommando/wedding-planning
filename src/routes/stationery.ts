import { Router } from "express";
import { readJsonFile, writeJsonFile } from "../drive.js";
import { requireRole } from "../auth/session.js";
import { asyncRoute } from "../asyncHandler.js";
import { mountRevisionRoutes } from "../revision-routes.js";
import { stationeryDiffConfig } from "../stationery-diff-config.js";
import { logRequest } from "../activity-log.js";

const FILE_NAME = "stationery.json";

// Every printed/written piece: save-the-dates, invitations, menus, place
// cards, signage, thank-yous. One flat list — each piece carries where it
// is in the pipeline (`status`), how many are needed, who's printing it,
// when it's due and what it costs. Organizer/vendor data (the stationer
// wants the quantities and the proofs schedule), never guest-facing.
const DEFAULT_STATE = {
  items: [] as {
    id: number;
    name: string;
    status?: string;
    quantity?: number;
    vendor?: string;
    dueDate?: string;
    cost?: number;
    notes?: string;
    // The copy printed on the piece itself — long-form, edited behind a
    // click on the page rather than in the row.
    wording?: string;
  }[],
  nextId: 1,
};

const router = Router();

router.get("/stationery", requireRole("editor", "vendor"), asyncRoute(async (_req, res) => {
  const { data, revisionId } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
  res.json({ data, revisionId });
}));

// Same simpler PUT as welcome-drinks/ceremony: no plain-English conflict
// diff on save, just refuse on a stale revision and ask to reload.
router.put("/stationery", requireRole("editor"), asyncRoute(async (req, res) => {
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
  logRequest(req, "save", "stationery");
  res.json({ revisionId: result.revisionId });
}));

mountRevisionRoutes(router, { path: "/stationery", fileName: FILE_NAME, defaultState: DEFAULT_STATE, diffConfig: stationeryDiffConfig });

export default router;
