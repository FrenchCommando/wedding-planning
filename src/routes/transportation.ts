import { Router } from "express";
import { readJsonFile, writeJsonFile } from "../drive.js";
import { requireRole } from "../auth/session.js";
import { asyncRoute } from "../asyncHandler.js";
import { mountRevisionRoutes } from "../revision-routes.js";
import { transportationDiffConfig } from "../transportation-diff-config.js";
import { logRequest } from "../activity-log.js";

const FILE_NAME = "transportation.json";

const DEFAULT_STATE = {
  // One row per departure: a coach leaving somewhere at some time. `capacity`
  // is seats on that vehicle, so the page can set the sum against the rider
  // count for each direction.
  shuttles: [] as {
    id: number;
    time: string;
    from: string;
    to: string;
    direction?: "toVenue" | "back";
    capacity?: number;
    notes?: string;
  }[],
  // Only people who asked for a seat, seeded from the RSVP form's two shuttle
  // questions and editable afterward like the other guest lists. Each rider
  // says which legs they take — most take both, a few only the return.
  riders: [] as { id: number; name: string; household?: string; toVenue?: boolean; back?: boolean; notes?: string }[],
  // A group tallied as a headcount with no per-person names, same as the
  // welcome-drinks / brunch pages.
  extraCount: 0,
  extraCountNote: "",
  nextId: 1,
};

const router = Router();

// Guests can see the timetable — it's their ride — but not who else is on
// it: the rider list is other households' names, so it comes off the
// response for the guest role rather than being hidden client-side.
router.get("/transportation", requireRole("editor", "vendor", "guest"), asyncRoute(async (req, res) => {
  const { data, revisionId } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
  if (req.session?.role === "guest") {
    res.json({ data: { shuttles: data.shuttles, nextId: data.nextId }, revisionId });
    return;
  }
  res.json({ data, revisionId });
}));

router.put("/transportation", requireRole("editor"), asyncRoute(async (req, res) => {
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
  logRequest(req, "save", "transportation");
  res.json({ revisionId: result.revisionId });
}));

mountRevisionRoutes(router, { path: "/transportation", fileName: FILE_NAME, defaultState: DEFAULT_STATE, diffConfig: transportationDiffConfig, roles: ["editor", "vendor"] });

export default router;
