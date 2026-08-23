import crypto from "node:crypto";
import { Router } from "express";
import { readJsonFile, writeJsonFile } from "../drive.js";
import { issueSession } from "./session.js";
import { asyncRoute } from "../asyncHandler.js";

interface GuestAuthFile {
  households: { household: string; token: string; createdAt: string }[];
}

const router = Router();

// Editor/vendor passwords live in .env, not Drive — same treatment as
// SESSION_SECRET and the OAuth secret. Simpler than a bootstrap step, and
// there's nothing sensitive enough here to warrant hashing-at-rest when the
// only "at rest" is the same .env that already holds other plaintext secrets.
function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

router.post("/login/editor", (req, res) => {
  const { password } = req.body ?? {};
  const expected = process.env.EDITOR_PASSWORD;
  if (!expected || typeof password !== "string" || !timingSafeEquals(password, expected)) {
    res.status(401).json({ error: "invalid password" });
    return;
  }
  issueSession(res, { role: "editor" });
  res.json({ ok: true });
});

router.post("/login/vendor", (req, res) => {
  const { password, vendorType } = req.body ?? {};
  const expected = process.env.VENDOR_PASSWORD;
  if (!expected || typeof password !== "string" || !timingSafeEquals(password, expected) || typeof vendorType !== "string") {
    res.status(401).json({ error: "invalid password" });
    return;
  }
  issueSession(res, { role: "vendor", vendorType });
  res.json({ ok: true });
});

router.post("/login/guest", asyncRoute(async (req, res) => {
  const { token } = req.body ?? {};
  if (typeof token !== "string") {
    res.status(400).json({ error: "token required" });
    return;
  }
  const { data } = await readJsonFile<GuestAuthFile>("guests-auth.json", { households: [] });
  const match = data.households.find((h) => h.token === token.toUpperCase());
  if (!match) {
    res.status(401).json({ error: "invalid token" });
    return;
  }
  issueSession(res, { role: "guest", household: match.household });
  res.json({ ok: true });
}));

// Crockford-base32-style alphabet, excludes ambiguous 0/O, 1/I/L.
const TOKEN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateToken(length = 7): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
  }
  return out;
}

/** Editor-only admin route: mint a new household guest link. Mounted separately behind requireRole("editor"). */
export async function createGuestToken(household: string): Promise<string> {
  const { data, revisionId } = await readJsonFile<GuestAuthFile>("guests-auth.json", { households: [] });
  const token = generateToken();
  data.households.push({ household, token, createdAt: new Date().toISOString() });
  const result = await writeJsonFile("guests-auth.json", data, revisionId);
  if ("conflict" in result) {
    // extremely unlikely (admin-only, low traffic) — retry once against fresh state
    return createGuestToken(household);
  }
  return token;
}

export default router;
