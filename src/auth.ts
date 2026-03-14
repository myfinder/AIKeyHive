import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Okta from "next-auth/providers/okta";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: "user" | "admin";
    };
  }
}

declare module "next-auth" {
  interface JWT {
    id?: string;
    role?: "user" | "admin";
  }
}

export const authConfig: NextAuthConfig = {
  providers: [
    Okta({
      clientId: process.env.AUTH_OIDC_CLIENT_ID,
      clientSecret: process.env.AUTH_OIDC_CLIENT_SECRET,
      issuer: process.env.AUTH_OIDC_ISSUER,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;
      if (allowedDomain && profile?.email) {
        return profile.email.endsWith(`@${allowedDomain}`);
      }
      return true;
    },
    async jwt({ token, profile, trigger }) {
      if ((trigger === "signIn" || trigger === "signUp") && profile) {
        const email = profile.email!;
        const sub = profile.sub!;
        const name = (profile.name as string) || null;

        // Upsert user
        const existing = await db
          .select()
          .from(users)
          .where(eq(users.oidcSub, sub))
          .get();

        if (existing) {
          token.id = existing.id;
          token.role = existing.role as "user" | "admin";
        } else {
          const isInitialAdmin =
            process.env.INITIAL_ADMIN_EMAIL &&
            email === process.env.INITIAL_ADMIN_EMAIL;
          const role = isInitialAdmin ? "admin" : "user";

          const newUser = await db
            .insert(users)
            .values({ oidcSub: sub, email, name, role })
            .returning()
            .get();

          token.id = newUser.id;
          token.role = newUser.role as "user" | "admin";
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) {
        session.user.id = token.id as string;
        session.user.role = (token.role as "user" | "admin") || "user";
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
  session: {
    strategy: "jwt",
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
