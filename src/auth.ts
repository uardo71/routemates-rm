import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { isPasswordLoginAllowed } from "@/lib/settings";

const ONE_DAY = 60 * 60 * 24;

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt", maxAge: ONE_DAY },
  // No `maxAge` on the cookie itself (only on the JWT above) makes this a browser
  // session cookie — cleared on browser close, capped at 1 day server-side either way.
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) return null;

        // Server-side enforcement of the admin "password login" toggle — hiding the form in the UI
        // isn't enough (someone could POST credentials directly). Break-glass rules in isPasswordLoginAllowed.
        // CUSTOMER portal accounts are exempt: they always authenticate with a password (they can't use
        // the org's SSO), so the staff SSO-only lock must never shut them out.
        if (user.role !== "CUSTOMER" && !(await isPasswordLoginAllowed())) return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          companyId: user.companyId,
        };
      },
    }),
    // Microsoft Entra ID (SSO) — only wired up when its env vars are present, so the app runs
    // fine (Credentials-only) until you fill them in. Single-tenant issuer locks it to your org.
    ...(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
      ? [
          MicrosoftEntraID({
            clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
            clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
            issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ account, profile, user }) {
      // Credentials sign-ins are already vetted in authorize() — let them through.
      if (account?.provider !== "microsoft-entra-id") return true;

      // Defense in depth: reject any token not from our tenant. (Auth.js also validates the
      // single-tenant issuer, so a mismatched tid should never actually occur.)
      const expectedTid = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER?.match(
        /microsoftonline\.com\/([^/]+)\/v2\.0/i,
      )?.[1];
      const tid = (profile as { tid?: string } | undefined)?.tid;
      if (expectedTid && tid && tid !== expectedTid) return false;

      // Admit ONLY someone who already exists as an ACTIVE app user — no self-provisioning.
      // Match on email, case-insensitively (Entra may return a different case than the seeded row).
      const email = user.email ?? (profile as { email?: string } | undefined)?.email;
      if (!email) return false;
      const appUser = await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { active: true },
      });
      return appUser?.active === true;
    },
    async jwt({ token, user, account, profile }) {
      if (!user) return token; // later requests: token already hydrated

      if (account?.provider === "microsoft-entra-id") {
        // OAuth identity: user.id is the Entra `sub` (not our User.id) and carries no role/companyId.
        // signIn() already guaranteed an active local user with this email exists — re-key the token
        // onto the LOCAL user so every RBAC/scoping query (visibleProjectIds, assignments, …) resolves.
        // Entra frequently leaves `user.email` null and delivers the address in the profile claims
        // (`email` or the UPN in `preferred_username`/`upn`) instead — resolve it the same robust way
        // signIn() does, or the re-key silently fails and the whole session gets no id/role/company.
        const p = profile as { email?: string; preferred_username?: string; upn?: string } | undefined;
        const email = user.email ?? p?.email ?? p?.preferred_username ?? p?.upn ?? (token.email as string | undefined);
        const appUser = email
          ? await prisma.user.findFirst({
              where: { email: { equals: email, mode: "insensitive" } },
              select: { id: true, role: true, companyId: true },
            })
          : null;
        if (appUser) {
          token.sub = appUser.id; // session.user.id reads token.sub
          token.role = appUser.role;
          token.companyId = appUser.companyId;
        }
      } else {
        // Credentials: authorize() already returned id/role/companyId; token.sub = user.id.
        token.role = user.role;
        token.companyId = user.companyId;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role as typeof session.user.role;
        session.user.companyId = token.companyId as string;
      }
      return session;
    },
  },
});
