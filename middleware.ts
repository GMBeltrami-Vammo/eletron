import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "./auth.config";

// Edge Middleware uses the providers-less edge-safe config only. Providers
// (Google, dev-login Credentials) live in auth.ts and pull Node-only deps
// (oauth4webapi) that break the Edge runtime; keeping them out of this bundle
// is what makes the middleware deployable. The session cookie is still read
// and `authorized` still runs — providers are only needed for the sign-in flow.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth?.user;
  const { pathname } = req.nextUrl;

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
  // Node.js runtime (not Edge): next-auth v5 pulls @auth/core code that the
  // Next 15.5 Edge bundler can't run (__dirname ReferenceError). See next.config.ts.
  runtime: "nodejs",
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
