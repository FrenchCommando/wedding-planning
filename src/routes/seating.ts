import { Router } from "express";
import { readJsonFile, writeJsonFile } from "../drive.js";
import { requireRole } from "../auth/session.js";
import { diffSeating } from "../seating-diff.js";

const FILE_NAME = "seating.json";

const DEFAULT_STATE = {
  rooms: [],
  tables: [],
  guests: [],
  partyColors: {},
  nextId: 1,
};

const router = Router();

router.get("/seating", requireRole("editor", "vendor", "guest"), async (_req, res) => {
  const { data, revisionId } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
  res.json({ data, revisionId });
});

router.put("/seating", requireRole("editor"), async (req, res) => {
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
});

export default router;
