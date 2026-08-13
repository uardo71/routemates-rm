import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  // Exclude auth endpoints, internal machine-to-machine endpoints (api/internal/* — gated by their
  // own shared secret, not a user session), Next internals, and any static asset (files with an
  // image/font extension) — otherwise the auth guard 307-redirects those to /login: public assets
  // like the logo would break on the login page, and secret-gated cron endpoints could never be hit.
  matcher: ["/((?!api/auth|api/internal|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)"],
};
