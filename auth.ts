import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import type { Adapter, AdapterUser } from "@auth/core/adapters";
import type { Provider } from "@auth/core/providers";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { createId } from "@paralleldrive/cuid2";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { siteConfig } from "@/lib/site-config";
import { recordAuditEvent } from "@/lib/audit-log";

// True iff the Google provider will actually be registered for this deploy.
// Both the siteConfig opt-in AND the server-side secrets have to be present.
// We need this *before* building providers so the session strategy can be
// chosen consistently — see notes on session.strategy below.
function isGoogleEnabled(): boolean {
  return Boolean(
    siteConfig.auth?.providers?.includes("google") &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET,
  );
}

function buildProviders(): Provider[] {
  const providers: Provider[] = [];

  // Credentials: always wired up code-wise so the form can be rendered when
  // siteConfig opts in. The login page is the visibility gate.
  //
  // Auth.js v5 still routes Credentials through JWT regardless of the
  // configured strategy — the Session row is never written for these
  // sign-ins. With a mixed-provider deployment (Credentials + Google) the
  // global strategy can still be "database": OAuth users get Session rows
  // and server-side revocation, Credentials users keep a JWT cookie. See
  // `session.strategy` below.
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

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        // SSO-provisioned users have password === null and must not be allowed
        // to sign in via the credentials form. Treat them the same as a missing
        // account so we don't leak that the email is registered.
        if (!user || !user.password) {
          throw new Error("Invalid credentials");
        }

        const isCorrectPassword = await bcrypt.compare(
          credentials.password as string,
          user.password,
        );

        if (!isCorrectPassword) {
          throw new Error("Invalid credentials");
        }

        // v5 expects authorize() to return a User-shape object (or null).
        return user as unknown as AdapterUser;
      },
    }),
  );

  // Google: only registered when both the siteConfig flag and the env vars
  // are present. Listing 'google' in siteConfig.auth.providers without the
  // env vars set causes /api/auth/signin/google to 500 — keep the two in
  // sync.
  if (isGoogleEnabled()) {
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        // Explicit even though false is the v5 default. With the adapter in
        // play, an OAuth login whose email matches an existing user row but
        // whose (provider, providerAccountId) has no Account row is rejected
        // with OAuthAccountNotLinked rather than auto-linked.
        allowDangerousEmailAccountLinking: false,
        authorization: {
          params: { prompt: "select_account" },
        },
      }),
    );
  }

  return providers;
}

// PrismaAdapter wrapper: the default createUser only writes the NextAuth-shape
// fields (name?, email?, emailVerified?, image?). After merging the User /
// user_account models, our `user` row also requires non-null name plus a
// self-referencing creator_id / updater_id (the bootstrap pattern shared with
// /api/auth/register). We override createUser to fill those in atomically;
// the rest of the adapter (getUser, linkAccount, updateUser, …) is the
// default behaviour.
//
// v5 note: AdapterUser includes a pre-generated `id` (Auth.js core generates
// it before calling createUser). We override it with a cuid2 to keep the id
// format consistent with /api/auth/register and the cuid2 pattern enforced
// on `id` fields in json_schema.yaml. The returned id is what the adapter
// then uses for the subsequent Account row insert, so the FK stays correct.
function buildAdapter(): Adapter {
  const base = PrismaAdapter(prisma);
  return {
    ...base,
    async createUser(data: AdapterUser) {
      const id = createId();
      const created = await prisma.user.create({
        data: {
          id,
          email: data.email!,
          name: data.name ?? data.email!,
          emailVerified: data.emailVerified ?? null,
          image: data.image ?? null,
          creator_id: id,
          updater_id: id,
        },
      });
      console.info(
        "[auth:createUser]",
        JSON.stringify({
          at: new Date().toISOString(),
          userId: created.id,
          email: created.email,
        }),
      );
      await recordAuditEvent({
        action: "auth:createUser",
        actor_user_id: created.id,
        target_table: "user",
        target_id: created.id,
        metadata: { email: created.email },
      });
      return {
        id: created.id,
        name: created.name,
        email: created.email,
        emailVerified: created.emailVerified,
        image: created.image,
      } as AdapterUser;
    },
  };
}

// session.strategy: pinned to "jwt" for the whole deployment.
//
// v5's assert only blocks `strategy === "database"` when *only* the
// Credentials provider is configured — it doesn't block the mixed case
// (Credentials + Google). But at runtime, that mixed case is still
// broken: v5 sets a JWT cookie for credentials sign-ins regardless of
// the configured strategy, then the session resolver — running in
// database mode — tries to look that JWT cookie up in the `Session`
// table and finds nothing, so `auth()` returns null. Net result: the
// user is "logged in" (cookie set, 302 to /) but every subsequent
// request is treated as anonymous and the proxy redirects back to
// /login.
//
// Forcing "jwt" globally means OAuth users *also* get JWT cookies
// (no server-side revocation by row delete). That's the gap and the
// trade-off; closing it for credentials needs either an SSO-only
// deployment (drop credentials entirely) or a custom session-shim that
// writes a `Session` row from `authorize()` and binds it to the
// cookie. Both are out of scope today.
//
// The adapter stays wired up: it still writes `User` and `Account`
// rows on OAuth sign-in (identity stability via providerAccountId,
// refresh tokens at rest, room for future Auth.js v5+ database
// sessions). Only the *session* row stays empty.
const sessionStrategy: "jwt" = "jwt";

export const authConfig: NextAuthConfig = {
  secret: process.env.AUTH_SECRET,

  adapter: buildAdapter(),
  session: { strategy: sessionStrategy },

  providers: buildProviders(),
  pages: {
    signIn: "/login",
  },
  callbacks: {
    /**
     * OAuth-only gate. Runs *before* the adapter writes any rows, so this
     * is where we enforce verified email, the optional domain allow-list,
     * and the credentials↔OAuth email-collision rule. Credentials sign-ins
     * reach this callback already-authenticated by `authorize()` and pass
     * through unchanged.
     */
    async signIn({ user, account, profile }) {
      if (!account || account.provider === "credentials") return true;

      const email = user.email ?? null;
      if (!email) return false;

      // Verified-email guard. Google's id_token carries `email_verified`;
      // treat an explicit `false` as a hard fail. Other providers we add
      // later need an equivalent check.
      if (account.provider === "google") {
        const verified = (profile as { email_verified?: boolean } | undefined)
          ?.email_verified;
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
          await recordAuditEvent({
            action: "auth:signIn.reject",
            actor_user_id: null,
            metadata: { reason: "domain_not_allowed", provider: account.provider, email },
          });
          return false;
        }
      }

      // Credentials↔OAuth collision guard. After the user_account / User
      // merge, both flows write to the same `user` row. A row with a
      // non-null password was created via /register; rejecting here keeps
      // the credentials boundary intact (admin reconciles by pre-linking
      // an Account row to that user). Without this, the adapter would
      // attempt to create a new `user` row and hit the @unique(email)
      // constraint — same outcome, less explicit.
      const existing = await prisma.user.findUnique({
        where: { email },
        select: { password: true },
      });
      if (existing && existing.password !== null) {
        console.info(
          "[auth:signIn:reject]",
          JSON.stringify({
            at: new Date().toISOString(),
            reason: "email_in_use_by_credentials",
            provider: account.provider,
            email,
          }),
        );
        await recordAuditEvent({
          action: "auth:signIn.reject",
          actor_user_id: null,
          metadata: { reason: "email_in_use_by_credentials", provider: account.provider, email },
        });
        return false;
      }

      return true;
    },
    // The session callback receives `user` for database sessions (OAuth)
    // and `token` for JWT sessions (credentials). Forward `id` from
    // whichever branch fired.
    async session({ session, user, token }) {
      const id = (user?.id ?? (token as { id?: string } | undefined)?.id) ?? "";
      return { ...session, user: { ...session.user, id } };
    },
    // Only fires for JWT-strategy sessions (credentials). Carries the id
    // from authorize() into the token so the session callback can echo it.
    async jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
  },
  events: {
    // Minimal structured audit logs for auth events. A log aggregator
    // (Vercel logs, Cloudwatch, Datadog, …) can collect these by prefix;
    // replace with a proper audit-log table when role/permission change
    // auditing lands.
    async signIn({ user, account, isNewUser }) {
      const provider = account?.provider ?? "unknown";
      console.info(
        "[auth:signIn]",
        JSON.stringify({
          at: new Date().toISOString(),
          provider,
          userId: user.id,
          email: user.email,
          // With the adapter in place, `isNewUser` is true on first OAuth
          // sign-in. Credentials flows still report it as undefined.
          isNewUser: isNewUser ?? null,
        }),
      );
      await recordAuditEvent({
        action: "auth:signIn",
        actor_user_id: user.id ?? null,
        target_table: "user",
        target_id: user.id ?? null,
        metadata: { provider, email: user.email ?? null, isNewUser: isNewUser ?? null },
      });
    },
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const session = "session" in message ? message.session : null;
      const userId =
        (token as { id?: string } | null)?.id ??
        (session as { userId?: string } | null)?.userId ??
        null;
      console.info(
        "[auth:signOut]",
        JSON.stringify({
          at: new Date().toISOString(),
          userId,
        }),
      );
      await recordAuditEvent({
        action: "auth:signOut",
        actor_user_id: userId,
        target_table: userId ? "user" : null,
        target_id: userId,
      });
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

// Module augmentation. The Session.user shape is project-wide; the JWT
// augmentation is only needed for the credentials (JWT-strategy) branch.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
  }
}
