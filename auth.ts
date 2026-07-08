import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { authConfig } from "./auth.config";

/**
 * Dev-only login bypass for local UI verification (no Google round-trip).
 * Structurally impossible in production: requires NODE_ENV=development AND
 * AUTH_DEV_LOGIN=1 (set only in .env.local, which is gitignored).
 */
const devLoginEnabled =
  process.env.NODE_ENV === "development" &&
  process.env.AUTH_DEV_LOGIN === "1";

/**
 * Full auth config. Runs on the Node.js runtime (route handler, server
 * components, server actions) — NOT the Edge Middleware, which uses the
 * providers-less `authConfig` from ./auth.config so no Node-only provider
 * dependency (oauth4webapi) is bundled into the edge.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // hd pre-filters the Google account picker; enforcement is the signIn callback below.
      authorization: { params: { hd: "vammo.com" } },
    }),
    ...(devLoginEnabled
      ? [
          Credentials({
            id: "dev-login",
            name: "Dev login",
            credentials: {},
            authorize: () => ({
              name: "Dev (local)",
              email: "dev@vammo.com",
            }),
          }),
        ]
      : []),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Only verified @vammo.com Google accounts may sign in.
    signIn({ user, profile }) {
      const isVammo = user.email?.toLowerCase().endsWith("@vammo.com") ?? false;
      const isVerified = profile?.email_verified !== false;
      return isVammo && isVerified;
    },
  },
});
