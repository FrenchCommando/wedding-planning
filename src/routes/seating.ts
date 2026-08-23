import { Router } from "express";
import { readJsonFile, writeJsonFile, listRevisions, getRevision } from "../drive.js";
import { requireRole } from "../auth/session.js";
import { diffSeating } from "../seating-diff.js";
import { asyncRoute } from "../asyncHandler.js";

const FILE_NAME = "seating.json";

const DEFAULT_STATE = {
  rooms: [],
  tables: [],
  guests: [],
  partyColors: {},
  nextId: 1,
};

const router = Router();

router.get("/seating", requireRole("editor", "vendor", "guest"), asyncRoute(async (_req, res) => {
  const { data, revisionId } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
  res.json({ data, revisionId });
}));

router.put("/seating", requireRole("editor"), asyncRoute(async (req, res) => {
  // `baseData` is the snapshot the editor originally loaded (before their
  // edits) — required to produce a meaningful "what changed remotely" diff
  // if the write is refused; `data` is their edited version to save.
  // `force: true` is the "Save mine anyway" conflict option: overwrite
  // regardless of what's currently on Drive, by writing against Drive's
  // own current revision id instead of the editor's stale one.
  const { data, baseData, baseRevisionId, keepForever, force } = req.body ?? {};
  if (!data || (!force && (!baseData || typeof baseRevisionId !== "string"))) {
    res.status(400).json({ error: "data required; baseData and baseRevisionId required unless force" });
    return;
  }

  const effectiveBaseRevisionId = force
    ? (await readJsonFile(FILE_NAME, DEFAULT_STATE)).revisionId
    : baseRevisionId;

  const result = await writeJsonFile(FILE_NAME, data, effectiveBaseRevisionId, { keepForever: !!keepForever });

  if ("conflict" in result) {
    const { data: current } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
    res.status(409).json({
      error: "conflict",
      currentRevisionId: result.currentRevisionId,
      changes: diffSeating(baseData, current as any),
    });
    return;
  }

  res.json({ revisionId: result.revisionId });
}));

// Past Drive revisions of seating.json, newest first — powers the "compare
// with a previous version" UI. Read-only, so open to the same roles as GET
// /seating; only the PUT above (the actual write) is editor-gated.
router.get("/seating/revisions", requireRole("editor", "vendor", "guest"), asyncRoute(async (_req, res) => {
  const revisions = await listRevisions(FILE_NAME);
  res.json({ revisions });
}));

// Plain-English diff between one past revision and the current live data —
// reuses the same diffSeating() the save-conflict modal uses, just with a
// past revision as the baseline instead of the editor's stale in-browser copy.
router.get("/seating/revisions/:id/diff", requireRole("editor", "vendor", "guest"), asyncRoute(async (req, res) => {
  let past;
  try {
    past = await getRevision(FILE_NAME, req.params.id);
  } catch (e: any) {
    // Drive stops serving the content of older, non-milestone revisions
    // over time (they stay listed, but `alt=media` starts 403ing with
    // "cannotDownloadRevision") — an expected, common condition once a
    // save ages out, not a real server error, so it gets its own clean
    // response instead of falling through to the generic 500 below.
    if (e?.code === 403 || e?.code === 404) {
      res.status(404).json({ error: "That save is no longer available — Drive only keeps full content for milestone saves and recent history." });
      return;
    }
    throw e;
  }
  const { data: current } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
  res.json({ changes: diffSeating(past as any, current as any) });
}));

export default router;
