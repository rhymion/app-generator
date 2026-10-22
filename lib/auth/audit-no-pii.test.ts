import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Guards the rule that auth code identifies users by id only: no email in
// audit_log metadata and no email in the [auth:*] console.info lines.
// auth.ts builds NextAuth at import time, so these checks read the source.

function read(file: string): string {
  return readFileSync(resolve(__dirname, "../..", file), "utf8");
}

// Returns the full text of every `<callee>(...)` call, using paren balancing.
function calls(src: string, callee: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const start = src.indexOf(callee + "(", from);
    if (start === -1) return out;
    let depth = 0;
    let i = start + callee.length;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) break;
    }
    out.push(src.slice(start, i + 1));
    from = i + 1;
  }
}

describe.each(["auth.ts", "lib/auth/create-user.ts"])("%s", (file) => {
  const src = read(file);
  const all = [
    ...calls(src, "recordAuditEvent").filter((c) => c.includes("action:")),
    ...calls(src, "console.info"),
  ];

  it("has audit and log calls to check", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it.each(all.map((c, n) => [`call #${n + 1}`, c]))(
    "%s carries no email",
    (_label, call) => {
      expect(call).not.toMatch(/\bemail\b|oauthEmail|user\.email|created\.email/);
    },
  );
});

describe("auth.ts email_in_use_by_credentials rejection", () => {
  it("targets the existing user and keeps the actor null", () => {
    const call = calls(read("auth.ts"), "recordAuditEvent").find((c) =>
      c.includes('reason: "email_in_use_by_credentials"'),
    );
    expect(call).toBeDefined();
    expect(call).toContain("actor_user_id: null");
    expect(call).toContain('target_table: "user"');
    expect(call).toContain("target_id: existing.id");
  });
});
