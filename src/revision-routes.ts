import { Router } from "express";
import { readJsonFile, listRevisions, getRevision } from "./drive.js";
import { requireRole } from "./auth/session.js";
import { asyncRoute } from "./asyncHandler.js";
import { diffData, type DiffConfig } from "./data-diff.js";

/**
 * Mounts the "past saves" / "compare with a previous version" routes for
 * one sub-project's data file: GET <path>/revisions (list) and
 * GET <path>/revisions/:id/diff (plain-English diff against current data).
 * One reusable pair of routes, not copy-pasted per sub-project — every
 * sub-project's data file gets the same History feature this way, just by
 * calling this with its own file name and diffData() config.
 */
export function mountRevisionRoutes(
  router: Router,
  opts: { path: string; fileName: string; defaultState: unknown; diffConfig: DiffConfig }
): void {
  const { path, fileName, defaultState, diffConfig } = opts;

  router.get(`${path}/revisions`, requireRole("editor", "vendor", "guest"), asyncRoute(async (_req, res) => {
    const revisions = await listRevisions(fileName);
    res.json({ revisions });
  }));

  router.get(`${path}/revisions/:id/diff`, requireRole("editor", "vendor", "guest"), asyncRoute(async (req, res) => {
    let past;
    try {
      past = await getRevision(fileName, req.params.id);
    } catch (e: any) {
      // Drive stops serving the content of older, non-milestone revisions
      // over time (they stay listed, but `alt=media` starts 403ing with
      // "cannotDownloadRevision") — an expected, common condition once a
      // save ages out, not a real server error, so it gets its own clean
      // response instead of falling through to asyncRoute's 500.
      if (e?.code === 403 || e?.code === 404) {
        res.status(404).json({ error: "That save is no longer available — Drive only keeps full content for milestone saves and recent history." });
        return;
      }
      throw e;
    }
    const { data: current } = await readJsonFile(fileName, defaultState);
    res.json({ changes: diffData(past, current, diffConfig) });
  }));
}
