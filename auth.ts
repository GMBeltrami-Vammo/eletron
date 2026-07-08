import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authOptions } from "./auth.config";

/**
 * Dev-only login bypass for local UI verification (no Google round-trip).
 * Structurally impossible in production: requires NODE_ENV=development AND
 * AUTH_DEV_LOGIN=1 (set only in .env.local, which is gitignored), so the
 * production providers array is [Google] only.
 */
const devLoginEnabled =
  process.env.NODE_ENV === "development" &&
  process.env.AUTH_DEV_LOGIN === "1";

/**
 * Full app auth instance — used by the route handler, server components and
 * server actions (all Node runtime). Adds the Node-only Credentials provider
 * that must NOT reach the Edge Middleware bundle (middleware imports the
 * Google-only instance from ./auth.config instead). Both instances share
 * AUTH_SECRET and the same cookie, so their sessions interoperate.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authOptions,
  providers: [
    ...authOptions.providers,
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
});
