import { Router } from "express";
import { readJsonFile, writeJsonFile } from "../drive.js";
import { requireRole } from "../auth/session.js";
import { asyncRoute } from "../asyncHandler.js";
import { mountRevisionRoutes } from "../revision-routes.js";
import { scriptDiffConfig } from "../script-diff-config.js";
import { logRequest } from "../activity-log.js";

const FILE_NAME = "script.json";

// The officiant's actual spoken script — ordered, named sections of
// long-form text (Welcome, Readings, Vows, Ring exchange, Pronouncement,
// ...), as opposed to the Speeches tab (who's speaking + notes about their
// toast) or the ceremony timeline (moment titles/times, not the words said).
// Own Drive file/router/history, same pattern as speeches.json.
const DEFAULT_STATE = {
  sections: [] as { id: number; heading: string; body?: string }[],
  nextId: 1,
};

const router = Router();

router.get("/script", requireRole("editor", "vendor", "guest"), asyncRoute(async (_req, res) => {
  const { data, revisionId } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
  res.json({ data, revisionId });
}));

router.put("/script", requireRole("editor"), asyncRoute(async (req, res) => {
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
  logRequest(req, "save", "script");
  res.json({ revisionId: result.revisionId });
}));

mountRevisionRoutes(router, { path: "/script", fileName: FILE_NAME, defaultState: DEFAULT_STATE, diffConfig: scriptDiffConfig });

export default router;
