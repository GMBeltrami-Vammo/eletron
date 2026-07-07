import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

/**
 * Dev-only login bypass for local UI verification (no Google round-trip).
 * Structurally impossible in production: requires NODE_ENV=development AND
 * AUTH_DEV_LOGIN=1 (set only in .env.local, which is gitignored).
 */
const devLoginEnabled =
  process.env.NODE_ENV === "development" &&
  process.env.AUTH_DEV_LOGIN === "1";

export const { handlers, signIn, signOut, auth } = NextAuth({
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
});
