import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { readSession } from "./auth/session.js";
import loginRouter from "./auth/login.js";
import seatingRouter from "./routes/seating.js";
import ceremonyRouter from "./routes/ceremony.js";
import adminRouter from "./routes/admin.js";
import welcomeDrinksRouter from "./routes/welcome-drinks.js";
import sundayBrunchRouter from "./routes/sunday-brunch.js";

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(readSession);

app.use("/api", loginRouter);
app.use("/api", seatingRouter);
app.use("/api", ceremonyRouter);
app.use("/api", adminRouter);
app.use("/api", welcomeDrinksRouter);
app.use("/api", sundayBrunchRouter);

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

app.use(express.static("public"));
app.use("/seating-chart", express.static("seating-chart"));
app.use("/ceremony", express.static("ceremony"));
app.use("/welcome-drinks", express.static("welcome-drinks"));
app.use("/sunday-brunch", express.static("sunday-brunch"));

// Catch-all error handler — must be last, and must take 4 params (that's
// what makes Express treat it as an error middleware rather than a normal
// one). Turns anything forwarded via next(err), including rejections
// asyncRoute() catches, into a clean 500 instead of the crash this app hit
// with a real Drive API error before this middleware existed.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "server error" });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`listening on http://localhost:${port}`);
});
