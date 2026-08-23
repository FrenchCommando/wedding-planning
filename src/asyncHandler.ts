import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async Express route handler so a rejected promise is forwarded
 * to next(err) instead of becoming an unhandled promise rejection.
 * Express 4 (what this app uses) does not catch async handler rejections
 * itself — an uncaught one crashes the whole Node process, taking the app
 * down for every user, not just the one request that failed. Discovered via
 * a real Drive API error (an old, non-milestone revision that had become
 * undownloadable — a normal, expected condition, not an edge case) crashing
 * the dev server outright. Pair with the catch-all error middleware in
 * server.ts, which turns whatever lands in next(err) into a clean 500
 * instead of a crash.
 */
export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
