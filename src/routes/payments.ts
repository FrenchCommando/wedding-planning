import { Router } from "express";
import { readJsonFile, writeJsonFile } from "../drive.js";
import { requireRole } from "../auth/session.js";
import { asyncRoute } from "../asyncHandler.js";
import { mountRevisionRoutes } from "../revision-routes.js";
import { paymentsDiffConfig } from "../payments-diff-config.js";
import { logRequest } from "../activity-log.js";

const FILE_NAME = "payments.json";

// Money owed and money paid: one row per payment to a vendor (a deposit,
// a balance, a single invoice). Two states — Pending with a due date, or
// Done with a paid date. Editor-only end to end: this is the couple's
// ledger, not something a vendor or a guest should read.
const DEFAULT_STATE = {
  currency: "EUR",
  items: [] as {
    id: number;
    vendor: string;
    description?: string;
    amount?: number;
    // "Pending" (default) or "Done".
    status?: string;
    // ISO date. Pending rows: when it's due. Done rows: when it was paid.
    dueDate?: string;
    paidDate?: string;
    // Bank transfer, card, cheque, cash — free text.
    method?: string;
    notes?: string;
  }[],
  nextId: 1,
};

const router = Router();

router.get("/payments", requireRole("editor"), asyncRoute(async (_req, res) => {
  const { data, revisionId } = await readJsonFile(FILE_NAME, DEFAULT_STATE);
  res.json({ data, revisionId });
}));

// Same simpler PUT as welcome-drinks/bar: refuse on a stale revision and ask
// to reload. `keepForever` pins a milestone ("everything paid before the
// day"), same gesture as the seating chart's.
router.put("/payments", requireRole("editor"), asyncRoute(async (req, res) => {
  const { data, revisionId, keepForever } = req.body ?? {};
  if (!data || typeof revisionId !== "string") {
    res.status(400).json({ error: "data and revisionId required" });
    return;
  }

  const result = await writeJsonFile(FILE_NAME, data, revisionId, { keepForever: !!keepForever });
  if ("conflict" in result) {
    res.status(409).json({ error: "conflict", currentRevisionId: result.currentRevisionId });
    return;
  }
  logRequest(req, "save", "payments", keepForever ? "milestone" : "");
  res.json({ revisionId: result.revisionId });
}));

mountRevisionRoutes(router, { path: "/payments", fileName: FILE_NAME, defaultState: DEFAULT_STATE, diffConfig: paymentsDiffConfig, roles: ["editor"] });

export default router;
