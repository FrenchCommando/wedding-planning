import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

export type Role = "guest" | "editor" | "vendor";

export interface SessionPayload {
  role: Role;
  vendorType?: string;
  household?: string;
}

const COOKIE_NAME = "session";
const EXPIRY = "30d";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET not set");
  return s;
}

export function issueSession(res: Response, payload: SessionPayload): void {
  const token = jwt.sign(payload, secret(), { expiresIn: EXPIRY });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

declare global {
  namespace Express {
    interface Request {
      session?: SessionPayload;
    }
  }
}

/** Reads and verifies the session cookie if present; never rejects — route-level middleware decides what's required. */
export function readSession(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      req.session = jwt.verify(token, secret()) as SessionPayload;
    } catch {
      // expired or tampered — treat as unauthenticated, don't error
    }
  }
  next();
}

export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session || !allowed.includes(req.session.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    // re-issue on active use so 30-day expiry doesn't interrupt regular usage;
    // strip exp/iat from the decoded payload first, or jwt.sign rejects the
    // combination of an existing "exp" claim with a new expiresIn option
    const { exp: _exp, iat: _iat, ...payload } = req.session as SessionPayload & { exp?: number; iat?: number };
    issueSession(res, payload);
    next();
  };
}
