import { type NextAuthOptions, type User } from "next-auth";
import type { Provider } from "next-auth/providers/index";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { createId } from "@paralleldrive/cuid2";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { siteConfig } from "@/lib/site-config";

function buildProviders(): Provider[] {
  const providers: Provider[] = [];

  // Credentials: always wired up code-wise so the form can be rendered when
  // siteConfig opts in. The login page is the visibility gate.
  providers.push(
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        name: { label: "Name", type: "name" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Invalid credentials");
        }

        const user = await prisma.user_account.findUnique({
          where: { email: credentials.email },
        });

        // SSO-provisioned users have password === null and must not be allowed
        // to sign in via the credentials form. Treat them the same as a missing
        // account so we don't leak that the email is registered.
        if (!user || !user.password) {
          throw new Error("Invalid credentials");
        }

        const isCorrectPassword = await bcrypt.compare(
          credentials.password,
          user.password,
        );

        if (!isCorrectPassword) {
          throw new Error("Invalid credentials");
        }

        return user as unknown as User;
      },
    }),
  );

  // Google: only registered when both the siteConfig flag and the env vars are
  // present. Listing 'google' in siteConfig.auth.providers without the env
  // vars set causes /api/auth/signin/google to 500 — keep the two in sync.
  if (
    siteConfig.auth?.providers?.includes("google") &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET
  ) {
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        // Explicit even though false is the NextAuth default — the contract
        // is "an OAuth login NEVER auto-links to an existing user by email
        // unless our own signIn callback decides to". With JWT-only sessions
        // the flag is only consulted by PrismaAdapter, but setting it
        // explicitly keeps the intent visible if we migrate to DB sessions.
        allowDangerousEmailAccountLinking: false,
        authorization: {
          params: { prompt: "select_account" },
        },
      }),
    );
  }

  return providers;
}

export const authOptions = {
  secret: process.env.AUTH_SECRET,
  providers: buildProviders(),
  pages: {
    signIn: "/login",
  },
  callbacks: {
    /**
     * Auto-provision the local user_account row on first SSO sign-in and
     * rewrite `user.id` to the *local* id so the JWT carries our row's id
     * (not the OAuth subject). For the credentials path this is a no-op —
     * authorize() already returned a local row.
     */
    async signIn({ user, account, profile }) {
      if (!account || account.provider === "credentials") return true;

      // OAuth flow. We require a verified email to match-or-create; without
      // one we'd risk linking to the wrong existing account.
      const email = user.email ?? null;
      if (!email) return false;
      if (account.provider === "google") {
        const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified;
        if (verified === false) return false;
      }

      // Optional per-deployment domain allow-list. Empty list = allow all.
      // Match is case-insensitive on the `@domain` half of the email.
      const allowed = siteConfig.auth?.allowedDomains ?? [];
      if (allowed.length > 0) {
        const domain = email.split("@")[1]?.toLowerCase();
        const normalised = allowed.map((d) => d.toLowerCase());
        if (!domain || !normalised.includes(domain)) {
          console.info(
            "[auth:signIn:reject]",
            JSON.stringify({
              at: new Date().toISOString(),
              reason: "domain_not_allowed",
              provider: account.provider,
              email,
            }),
          );
          return false;
        }
      }

      const existing = await prisma.user_account.findUnique({ where: { email } });
      if (existing) {
        user.id = existing.id;
        return true;
      }

      const newId = createId();
      await prisma.user_account.create({
        data: {
          id: newId,
          email,
          name: user.name ?? email,
          avatar: user.image ?? null,
          // Self-reference for the bootstrap row — mirrors the registration
          // endpoint's pattern (the user is the creator/updater of their own
          // account).
          creator_id: newId,
          updater_id: newId,
        },
      });
      user.id = newId;
      // Audit event: new SSO user was provisioned. We log it here rather than
      // from `events.createUser` because NextAuth only fires that event when
      // an Adapter creates the User row; on JWT-only sessions, this callback
      // is the creation site.
      console.info(
        "[auth:provision]",
        JSON.stringify({
          at: new Date().toISOString(),
          provider: account.provider,
          userId: newId,
          email,
        }),
      );
      return true;
    },
    async jwt({ token, user }) {
      return { ...token, id: token.id ?? user?.id };
    },
    async session({ session, token }) {
      return { ...session, user: { ...session.user, id: token.id } };
    },
  },
  events: {
    // Minimal structured audit logs for auth events. A log aggregator (Vercel
    // logs, Cloudwatch, Datadog, …) can collect these by prefix; replace with
    // a proper audit-log table when role/permission change auditing lands.
    async signIn({ user, account, isNewUser }) {
      console.info(
        "[auth:signIn]",
        JSON.stringify({
          at: new Date().toISOString(),
          provider: account?.provider ?? "unknown",
          userId: user.id,
          email: user.email,
          // NB: with JWT-only sessions NextAuth doesn't know we created the
          // local row, so `isNewUser` is always undefined here. The matching
          // creation event is emitted as `[auth:provision]` from signIn().
          isNewUser: isNewUser ?? null,
        }),
      );
    },
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      console.info(
        "[auth:signOut]",
        JSON.stringify({
          at: new Date().toISOString(),
          userId: (token as { id?: string } | null)?.id ?? null,
        }),
      );
    },
  },
} satisfies NextAuthOptions;
