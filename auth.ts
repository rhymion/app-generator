import { type NextAuthOptions, type User } from "next-auth";
import type { Provider } from "next-auth/providers/index";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { siteConfig } from "@/lib/site-config";

function buildProviders(): Provider[] {
  const providers: Provider[] = [];

  // Credentials: always wired up code-wise so the form can be rendered when
  // siteConfig opts in. The login page is the visibility gate.
  //
  // NOTE: NextAuth v4 routes the Credentials provider through JWT sessions
  // regardless of the chosen strategy — that is why we keep
  // `session.strategy = 'jwt'` below even though PrismaAdapter is registered.
  // Switching to `session.strategy = 'database'` would silently break
  // credentials sign-in (the user authenticates but no Session row is
  // written). Auth.js v5 is the migration path that lifts this restriction.
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
        // Explicit even though false is the NextAuth default. With the adapter
        // now in play, this flag is enforced: an OAuth login whose email
        // matches an existing User row but whose (provider, providerAccountId)
        // has no Account row is rejected with OAuthAccountNotLinked rather
        // than auto-linked.
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

  // PrismaAdapter persists `User` / `Account` / `Session` / `VerificationToken`
  // rows for OAuth flows. We keep JWT sessions (see Credentials note above),
  // so `Session` stays empty — `User` and `Account` are what we get out of
  // this today: providerAccountId-based identity, refresh tokens at rest, and
  // a real `events.createUser` hook for first-time provisioning.
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },

  providers: buildProviders(),
  pages: {
    signIn: "/login",
  },
  callbacks: {
    /**
     * OAuth-only gate. Runs *before* the adapter writes any rows, so this is
     * where we enforce verified email, the optional domain allow-list, and
     * the credentials↔OAuth email-collision rule. Credentials sign-ins reach
     * this callback already-authenticated by `authorize()` and pass through.
     */
    async signIn({ user, account, profile }) {
      if (!account || account.provider === "credentials") return true;

      const email = user.email ?? null;
      if (!email) return false;

      // Verified-email guard. Google's id_token carries `email_verified`;
      // treat an explicit `false` as a hard fail. Other providers we add
      // later need an equivalent check.
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

      // Credentials↔OAuth collision guard. If a user_account already exists
      // for this email but has no matching User row, the user signed up via
      // /register and is now attempting SSO with the same address. Letting
      // the adapter run would (a) create a fresh User row whose id collides
      // with nothing in user_account, then (b) fire events.createUser which
      // would try to INSERT into user_account and hit the @unique(email)
      // constraint. Reject here so the admin can reconcile manually (e.g.
      // pre-populate the User and Account rows for the existing user).
      // Mirrors the spirit of allowDangerousEmailAccountLinking: false for
      // the credentials boundary the adapter doesn't know about.
      const existingUserAccount = await prisma.user_account.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existingUserAccount) {
        const linkedUser = await prisma.user.findUnique({
          where: { id: existingUserAccount.id },
          select: { id: true },
        });
        if (!linkedUser) {
          console.info(
            "[auth:signIn:reject]",
            JSON.stringify({
              at: new Date().toISOString(),
              reason: "email_in_use_by_credentials",
              provider: account.provider,
              email,
            }),
          );
          return false;
        }
      }

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
    /**
     * Fires after the adapter creates a User row (OAuth/Email flows only —
     * Credentials never goes through the adapter). We mirror the new User
     * into our domain `user_account` table with the same id so
     * `session.user.id` continues to address user_account directly without
     * any join.
     */
    async createUser({ user }) {
      const newId = user.id;
      await prisma.user_account.create({
        data: {
          id: newId,
          email: user.email!,
          name: user.name ?? user.email!,
          avatar: user.image ?? null,
          // Self-reference for the bootstrap row — mirrors the registration
          // endpoint's pattern (the user is the creator/updater of their own
          // account).
          creator_id: newId,
          updater_id: newId,
        },
      });
      console.info(
        "[auth:createUser]",
        JSON.stringify({
          at: new Date().toISOString(),
          userId: newId,
          email: user.email,
        }),
      );
    },
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
          // With the adapter in place, `isNewUser` is true on first OAuth
          // sign-in. Credentials flows still report it as undefined.
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
