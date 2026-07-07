import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Edge-safe subset of the auth config: no Credentials provider (Node-only),
 * so this can be bundled into Edge Middleware. Full config lives in auth.ts.
 */
export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // hd pre-filters the Google account picker; enforcement is the signIn callback below.
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
