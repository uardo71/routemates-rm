import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

// Shared-secret gate for the machine-to-machine endpoints under /api/internal (timesheet nudge,
// operational alerts). These are deliberately NOT behind app RBAC/session — a scheduler has no user —
// so the header is the only gate. `src/proxy.ts` excludes api/internal from the auth redirect.
//
//   header: x-nudge-secret: <TIMESHEET_NUDGE_SECRET>
//
// One secret for all internal routes: whatever calls one will call the others, and a single value is
// one fewer thing to lose. Unset ⇒ every internal route is closed.
export function authorizedInternal(req: NextRequest): boolean {
  const secret = process.env.TIMESHEET_NUDGE_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("x-nudge-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal lengths
  return timingSafeEqual(a, b);
}

export function flag(v: string | null): boolean {
  return v === "1" || v === "true";
}
