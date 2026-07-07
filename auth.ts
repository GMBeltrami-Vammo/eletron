import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";

/**
 * Dev-only login bypass for local UI verification (no Google round-trip).
 * Structurally impossible in production: requires NODE_ENV=development AND
 * AUTH_DEV_LOGIN=1 (set only in .env.local, which is gitignored).
 */
const devLoginEnabled =
  process.env.NODE_ENV === "development" &&
  process.env.AUTH_DEV_LOGIN === "1";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
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
