import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
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
});
