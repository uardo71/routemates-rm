import type { NextRequest } from "next/server";
import { handlers } from "@/auth";

// Auth.js always stamps an explicit `Expires` on the session cookie for JWT-strategy
// sessions (computed from `session.maxAge`), regardless of the `cookies.sessionToken`
// config in auth.ts — there's no declarative way to make it a true browser-session
// cookie. Strip Expires/Max-Age from that one cookie here so it's cleared on browser
// close; the JWT's own embedded `exp` claim (still set from `session.maxAge`) keeps
// enforcing the 1-day cap server-side regardless of how long the cookie physically
// survives (e.g. a browser's "restore previous session" feature).
function stripSessionCookieExpiry(response: Response): Response {
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length === 0) return response;

  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const cookie of setCookies) {
    headers.append(
      "set-cookie",
      cookie.includes("session-token")
        ? cookie.replace(/;\s*Expires=[^;]+/i, "").replace(/;\s*Max-Age=[^;]+/i, "")
        : cookie
    );
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function GET(req: NextRequest) {
  return stripSessionCookieExpiry(await handlers.GET(req));
}

export async function POST(req: NextRequest) {
  return stripSessionCookieExpiry(await handlers.POST(req));
}
