import { Router } from "express";
import { readJsonFile, writeJsonFile } from "../drive.js";
import { requireRole } from "../auth/session.js";
import { asyncRoute } from "../asyncHandler.js";
import { mountRevisionRoutes } from "../revision-routes.js";
import { playlistDiffConfig } from "../playlist-diff-config.js";
import { logRequest } from "../activity-log.js";

const FILE_NAME = "playlist.json";

// Same shape as the standalone music-plan.html's in-browser state, minus
// the fields that only ever made sense client-side (rev/localStorage
// stash) — Drive's revisionId is the save-conflict mechanism now, the
// same as every other sub-project.
const DEFAULT_STATE = {
  nextId: 1,
  segments: [] as {
    id: number;
    name: string;
    start: string;
    end: string;
    playlistId: string | null;
    playlistName: string | null;
    items: {
      id: number;
      kind: "track" | "cue";
      title: string;
      artist: string;
      uri: string | null;
      durationMs: number | null;
      at: string | null;
      cue: string | null;
      matchTried: boolean;
    }[];
  }[],
};

const router = Router();

router.get("/playlist", requireRole("editor", "vendor"), asyncRoute(async (_req, res) => {
  const { data, revisionId } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
  res.json({ data, revisionId });
}));

// Same simpler PUT as ceremony/welcome-drinks: no plain-English conflict
// diff on save, just refuse on a stale revision and ask to reload.
router.put("/playlist", requireRole("editor"), asyncRoute(async (req, res) => {
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
  logRequest(req, "save", "playlist");
  res.json({ revisionId: result.revisionId });
}));

mountRevisionRoutes(router, { path: "/playlist", fileName: FILE_NAME, defaultState: DEFAULT_STATE, diffConfig: playlistDiffConfig });

export default router;
