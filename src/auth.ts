import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Okta from "next-auth/providers/okta";
import Credentials from "next-auth/providers/credentials";
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

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: "user" | "admin";
  }
}

const oidcIssuer = process.env.AUTH_OIDC_ISSUER?.trim();
const oidcClientId = process.env.AUTH_OIDC_CLIENT_ID?.trim();
const oidcClientSecret = process.env.AUTH_OIDC_CLIENT_SECRET?.trim();
const oidcProviderConfigured = Boolean(
  oidcIssuer && oidcClientId && oidcClientSecret
);
const devLoginEnabled =
  process.env.NODE_ENV === "development" &&
  process.env.AUTH_DEV_LOGIN === "true";
const secureCookies =
  process.env.NODE_ENV === "production" ||
  process.env.AUTH_URL?.startsWith("https://");

const authProviders: NextAuthConfig["providers"] = [];

if (oidcProviderConfigured) {
  authProviders.push(
    Okta({
      clientId: oidcClientId!,
      clientSecret: oidcClientSecret!,
      issuer: oidcIssuer!,
    })
  );
}

if (devLoginEnabled) {
  authProviders.push(
    Credentials({
      id: "dev",
      name: "Local Development",
      credentials: {},
      async authorize() {
        const email =
          process.env.AUTH_DEV_EMAIL?.trim() || "dev@aikeyhive.local";
        return {
          id: `dev:${email}`,
          email,
          name: process.env.AUTH_DEV_NAME?.trim() || "Local Dev User",
        };
      },
    })
  );
}

export const authConfig: NextAuthConfig = {
  providers: authProviders,
  callbacks: {
    async signIn({ profile, user }) {
      const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN?.trim();
      if (allowedDomain) {
        const email = profile?.email || user?.email;
        if (!email) return false;
        const emailDomain = email.split("@").pop();
        return emailDomain === allowedDomain;
      }
      return true;
    },
    async jwt({ token, profile, user, trigger }) {
      if ((trigger === "signIn" || trigger === "signUp") && (profile || user)) {
        try {
          const email = profile?.email || user?.email;
          const sub = profile?.sub || user?.id;
          const name = ((profile?.name || user?.name) as string) || null;
          if (!email || !sub) return token;

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
              process.env.INITIAL_ADMIN_EMAIL?.trim() &&
              email === process.env.INITIAL_ADMIN_EMAIL.trim();
            const role = isInitialAdmin ? "admin" : "user";

            const newUser = await db
              .insert(users)
              .values({ oidcSub: sub, email, name, role })
              .returning()
              .get();

            token.id = newUser.id;
            token.role = newUser.role as "user" | "admin";
          }
        } catch (error) {
          console.error("[auth][jwt] DB error during sign-in:", error);
        }
      } else if (token.id) {
        // Refresh role from DB on every token renewal to reflect admin changes immediately
        const user = await db
          .select()
          .from(users)
          .where(eq(users.id, token.id as string))
          .get();
        if (user) {
          token.role = user.role as "user" | "admin";
        } else {
          // User deleted — invalidate token
          return {};
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
    maxAge: 1 * 60 * 60, // 1 hour
  },
  trustHost: true,
  cookies: {
    sessionToken: {
      name: "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: secureCookies,
      },
    },
    callbackUrl: {
      name: "authjs.callback-url",
      options: {
        sameSite: "lax",
        path: "/",
        secure: secureCookies,
      },
    },
    csrfToken: {
      name: "authjs.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: secureCookies,
      },
    },
    state: {
      name: "authjs.state",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: secureCookies,
        maxAge: 900,
      },
    },
    pkceCodeVerifier: {
      name: "authjs.pkce.code_verifier",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: secureCookies,
        maxAge: 900,
      },
    },
  },
  logger: {
    error(error) {
      console.error("[auth][error]", error);
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
