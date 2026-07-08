import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Edge-safe auth options + a PRE-BUILT edge instance.
 *
 * Two things matter for Vercel's Edge Middleware and both mirror goBuy's
 * working setup (see root CLAUDE.md "Auth on Vercel"):
 *   1. NO Credentials provider here — its module is Node-only and makes Vercel
 *      reject the Edge Function ("unsupported modules"). Credentials (dev-login)
 *      lives only in auth.ts, which runs on Node.
 *   2. The `auth` instance is built HERE and imported by middleware, rather than
 *      middleware calling NextAuth() itself. Calling NextAuth() inside the
 *      middleware module made the Edge bundler emit a CJS wrapper that threw
 *      "__dirname is not defined" at runtime. Importing a pre-built instance
 *      (exactly how goBuy does it) avoids that.
 */
export const authOptions = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // hd pre-filters the Google account picker; enforcement is the signIn callback.
      authorization: { params: { hd: "vammo.com" } },
    }),
  ],

  pages: { signIn: "/login", error: "/login" },

  callbacks: {
    // Only verified @vammo.com Google accounts may sign in.
    signIn({ user, profile }) {
      const isVammo = user.email?.toLowerCase().endsWith("@vammo.com") ?? false;
      const isVerified = profile?.email_verified !== false;
      return isVammo && isVerified;
    },

    authorized({ auth: session }) {
      return !!session?.user;
    },
  },
} satisfies NextAuthConfig;

/** Pre-built edge instance for middleware. Reads the session cookie; no providers needed at request time. */
export const { auth } = NextAuth(authOptions);
