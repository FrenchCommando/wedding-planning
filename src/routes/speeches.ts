import { Router } from "express";
import { readJsonFile, writeJsonFile } from "../drive.js";
import { requireRole } from "../auth/session.js";
import { asyncRoute } from "../asyncHandler.js";
import { mountRevisionRoutes } from "../revision-routes.js";
import { speechesDiffConfig } from "../speeches-diff-config.js";
import { logRequest } from "../activity-log.js";

const FILE_NAME = "speeches.json";

// Own Drive file, own revision history — split out of ceremony.json so
// speeches can be tracked/diffed/History'd independently of the ceremony
// timeline (order matters, exact clock time doesn't, and it's edited on a
// different cadence than the moments/processional data).
const DEFAULT_STATE = {
  speeches: [] as { id: number; speaker: string; relation?: string; notes?: string }[],
  nextId: 1,
};

const router = Router();

router.get("/speeches", requireRole("editor", "vendor", "guest"), asyncRoute(async (_req, res) => {
  const { data, revisionId } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
  res.json({ data, revisionId });
}));

// Same simpler PUT as ceremony/welcome-drinks: no plain-English conflict
// diff on save, just refuse on a stale revision and ask to reload.
router.put("/speeches", requireRole("editor"), asyncRoute(async (req, res) => {
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
  logRequest(req, "save", "speeches");
  res.json({ revisionId: result.revisionId });
}));

mountRevisionRoutes(router, { path: "/speeches", fileName: FILE_NAME, defaultState: DEFAULT_STATE, diffConfig: speechesDiffConfig });

export default router;
