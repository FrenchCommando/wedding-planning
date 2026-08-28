import { Router } from "express";
import { requireRole } from "../auth/session.js";
import { asyncRoute } from "../asyncHandler.js";
import { createGuestToken, listGuestTokens } from "../auth/login.js";
import { readActivity, logRequest } from "../activity-log.js";

const router = Router();

// Editor-only: list every minted household guest token, powers
// public/admin.html's table (household / token / link / created date).
router.get("/admin/guest-tokens", requireRole("editor"), asyncRoute(async (_req, res) => {
  const households = await listGuestTokens();
  res.json({ households });
}));

// Editor-only: mint a new household guest link.
router.post("/admin/guest-token", requireRole("editor"), asyncRoute(async (req, res) => {
  const { household } = req.body ?? {};
  if (typeof household !== "string" || !household.trim()) {
    res.status(400).json({ error: "household required" });
    return;
  }
  const token = await createGuestToken(household.trim());
  logRequest(req, "mint-guest-link", "", household.trim());
  res.json({ household, token });
}));

// Editor-only: the activity log, newest first. Reads the plain local file on
// the Pi (never Drive) — see src/activity-log.ts for why.
router.get("/admin/activity", requireRole("editor"), (_req, res) => {
  res.json({ entries: readActivity() });
});

export default router;
