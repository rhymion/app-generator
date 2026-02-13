import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createId } from "@paralleldrive/cuid2";

export const authOptions = {
  secret: process.env.AUTH_SECRET,
  providers: [
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

        if (!user) {
          const userId = createId();
          return await prisma.user_account.create({
            data: {
              id: userId,
              creator_id: userId,
              name: credentials.name ?? credentials.email,
              email: credentials.email,
              password: await bcrypt.hash(credentials.password, 10),
            },
          });
        }

        const isCorrectPassword = await bcrypt.compare(
          credentials.password,
          user.password
        );

        if (!isCorrectPassword) {
          throw new Error("Invalid credentials");
        }

        return user;
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      return { ...token, id: token.id ?? user?.id };
    },
    async session({ session, token }) {
      return { ...session, user: { ...session.user, id: token.id } };
    },
  },
} satisfies NextAuthOptions;