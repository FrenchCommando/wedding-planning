import { Router } from "express";
import { readJsonFile, writeJsonFile } from "../drive.js";
import { requireRole } from "../auth/session.js";

const FILE_NAME = "ceremony.json";

const DEFAULT_STATE = {
  moments: [] as { id: number; time: string; title: string; description?: string; participants?: string }[],
  // Aisle order for the processional: who walks in, in what order, and how
  // many seconds after the processional starts. Drives the aisle diagram.
  processionalOrder: [] as { id: number; name: string; role?: string; emoji?: string; startAt: number }[],
  nextId: 1,
};

const router = Router();

router.get("/ceremony", requireRole("editor", "vendor", "guest"), async (_req, res) => {
  const { data, revisionId } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
  res.json({ data, revisionId });
});

// Simpler than seating's PUT: no plain-English conflict diff, just refuse
// on a stale revision and ask to reload — per the spec, ceremony/playlist/
// transportation are append-only-ish lists edited by ~2 people, not a real
// concurrent-collision risk worth the extra diff machinery seating needed.
router.put("/ceremony", requireRole("editor"), async (req, res) => {
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
});

export default router;
