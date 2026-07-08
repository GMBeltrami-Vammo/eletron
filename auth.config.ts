import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  providers: [],
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    authorized({ auth: session }) {
      return !!session?.user;
    },
  },
} satisfies NextAuthConfig;
