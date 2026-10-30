import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { getRateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/rate-limit/client-ip";

export async function POST(request: Request) {
  try {
    // Per-IP ceiling, checked before any body parsing or database read.
    const decision = await getRateLimiter().check("auth:register", clientIp(request.headers));
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: decision.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
      );
    }

    const { name, email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    const userId = createId();
    await prisma.user.create({
      data: {
        id: userId,
        creator_id: userId,
        updater_id: userId,
        name: name ?? email,
        email,
        password: await bcrypt.hash(password, 10),
      },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    // Log only the error class and Prisma code: a database validation error's
    // message embeds the call arguments, including the submitted password hash.
    console.error("[register] failed", {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: unknown } | null)?.code,
    });
    return NextResponse.json(
      { error: "Registration failed", code: "REGISTRATION_FAILED" },
      { status: 500 }
    );
  }
}
