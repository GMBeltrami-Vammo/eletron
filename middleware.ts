import { NextResponse } from "next/server";

import { auth } from "./auth.config";

// Imports the PRE-BUILT, Google-only edge instance from auth.config (no
// Credentials, so no Node-only module reaches the Edge bundle). See auth.config.ts.
export default auth((req) => {
  const isLoggedIn = !!req.auth?.user;
  const { pathname } = req.nextUrl;

  // Cron endpoints are machine-called (n8n / Vercel Cron) with a CRON_SECRET
  // bearer, never a session — let the route's own constant-time check gate them.
  if (pathname.startsWith("/api/cron")) {
    return NextResponse.next();
  }

  // Auth.js API routes and the login page are always public.
  if (pathname === "/login" || pathname.startsWith("/api/auth")) {
    if (isLoggedIn && pathname === "/login") {
      return NextResponse.redirect(new URL("/", req.nextUrl.origin));
    }
    return NextResponse.next();
  }

  if (!isLoggedIn) {
    // API routes: return JSON 401 so fetch callers handle it gracefully.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
