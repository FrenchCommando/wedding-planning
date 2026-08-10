import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { readSession, requireRole } from "./auth/session.js";
import loginRouter from "./auth/login.js";
import { createGuestToken } from "./auth/login.js";
import seatingRouter from "./routes/seating.js";
import ceremonyRouter from "./routes/ceremony.js";

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(readSession);

app.use("/api", loginRouter);
app.use("/api", seatingRouter);
app.use("/api", ceremonyRouter);

app.get("/api/whoami", (req, res) => {
  res.json({ session: req.session ?? null });
});

// Public, unauthenticated: venue name / wedding site URL are display copy,
// not secret, but they're personal to this couple so they can't be
// hardcoded in the repo's HTML — env-config instead, same as passwords.
app.get("/api/config", (_req, res) => {
  res.json({
    venueName: process.env.VENUE_NAME ?? "",
    weddingSiteUrl: process.env.WEDDING_SITE_URL ?? "",
  });
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
});

// Admin: mint a household guest link. Editor-only.
app.post("/api/admin/guest-token", requireRole("editor"), async (req, res) => {
  const { household } = req.body ?? {};
  if (typeof household !== "string" || !household.trim()) {
    res.status(400).json({ error: "household required" });
    return;
  }
  const token = await createGuestToken(household.trim());
  res.json({ household, token });
});

app.use(express.static("public"));
app.use("/seating-chart", express.static("seating-chart"));
app.use("/ceremony", express.static("ceremony"));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`listening on http://localhost:${port}`);
});
