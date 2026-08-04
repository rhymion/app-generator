import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Structural gate for `user.creator_id === id` (cmd_536 §零.五).
 *
 * `x-self-only` on the `setting` entity (a proxy view of the `user` row
 * itself) uses `creator_id` as its unconditional ownership filter — the
 * SAME column every other x-self-only entity uses. That only reads as "is
 * this my own account's settings" if `creator_id` equals `id` on every real
 * user row. All 4 production/seed user-creation paths already generate a
 * cuid up front and use it for both `id` and `creator_id`
 * (lib/auth/create-user.ts, app/api/auth/register/route.ts,
 * scripts/seed-tenant.ts, scripts/seed.ts) — this test is a structural gate
 * against that silently regressing, since "be careful" is not a mechanism.
 *
 * A DB-level `CHECK (creator_id = id)` constraint was considered and
 * REJECTED: two existing, legitimate test fixtures deliberately create user
 * rows with `creator_id` set to a DIFFERENT user (simulating the `user`
 * entity's own pre-existing Creator-permission-scope CSV import feature,
 * unrelated to x-self-only) — `cypress.config.ts`'s `db:createUserWithName`
 * task (backs `cypress/e2e/api/user_import.cy.ts` and `round_trip.cy.ts`)
 * and the auto-generated `cypress/support/audit_log/helper.ts`'s
 * `populateAuditLogDependencies()`. A blanket CHECK constraint would break
 * both currently-passing suites. Both are cypress task-runner/test-support
 * code that never ships to production, and both stamp an unusable password
 * (`'not_needed'` / a raw non-hash string) on the row, so neither can ever
 * be the actor behind a real login session — they can never be the
 * self-only actor whose OWN /setting page is being checked. This test
 * therefore scopes the guarantee to production-reachable code only, with
 * those two paths as a named, reasoned allowlist — anything else that
 * starts writing `prisma.user.create`/`.upsert()` without self-referencing
 * `creator_id` fails the build.
 */

const REPO_ROOT = path.resolve(__dirname, "../..");

// Directories scanned for prisma.user.create/upsert call sites. Deliberately
// excludes cypress/** (test-support code, see rationale above) and
// app/generated/** (Prisma client internals — only ever contain the method
// name in doc comments, never a real call site).
const SCAN_DIRS = ["app", "lib", "scripts"];

const EXCLUDED_DIR_SEGMENTS = ["generated", "node_modules", ".next"];

// Named, reasoned exceptions — see file header. Anything not listed here
// must self-reference creator_id === id.
const ALLOWLIST = new Set<string>([
  "cypress.config.ts",
  "cypress/support/audit_log/helper.ts",
]);

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_SEGMENTS.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Given text starting at an opening '(' (or '{'), return the substring up
 * to (and including) its matching closer, using simple bracket counting.
 * Good enough for well-formatted TS source; not a real parser. */
function matchBalanced(text: string, openIdx: number): string {
  const open = text[openIdx];
  const close = open === "(" ? ")" : "}";
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return text.slice(openIdx);
}

interface CallSite {
  file: string;
  callText: string;
}

function findUserCreateCallSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of listFiles(abs)) {
      const rel = path.relative(REPO_ROOT, file);
      const text = fs.readFileSync(file, "utf8");
      const re = /prisma\.user\.(create|upsert)\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const parenIdx = m.index + m[0].length - 1;
        const callText = matchBalanced(text, parenIdx);
        sites.push({ file: rel, callText });
      }
    }
  }
  return sites;
}

/** Extracts the `create: { ... }` sub-block for an upsert call, or the
 * whole call text itself for a plain `.create(...)` call (whose top-level
 * shape already IS `{ data: { ... } }`). */
function ownershipBlock(callText: string): string {
  const createIdx = callText.search(/\bcreate\s*:\s*\{/);
  if (createIdx === -1) return callText;
  const braceIdx = callText.indexOf("{", createIdx);
  return matchBalanced(callText, braceIdx);
}

/** Returns the identifier bound to `key` in an object literal, handling both
 * explicit (`key: identifier`) and ES6 shorthand (`key,` / `key }`, whose
 * value identifier is the key name itself) forms. Returns null if `key`
 * isn't assigned in `block` at all. */
function extractAssignedIdentifier(block: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const explicit = block.match(new RegExp(`\\b${escaped}\\s*:\\s*([A-Za-z_$][\\w$]*)`));
  if (explicit) return explicit[1];
  const shorthand = block.match(new RegExp(`[{,]\\s*${escaped}\\s*[,}]`));
  if (shorthand) return key;
  return null;
}

describe("user.creator_id self-reference structural gate (cmd_536 §零.五)", () => {
  it("finds at least the known production call sites (sanity check the scanner itself works)", () => {
    const sites = findUserCreateCallSites();
    const files = new Set(sites.map((s) => s.file));
    expect(files.has("lib/auth/create-user.ts")).toBe(true);
    expect(files.has("app/api/auth/register/route.ts")).toBe(true);
    expect(files.has("scripts/seed-tenant.ts")).toBe(true);
    expect(files.has("scripts/seed.ts")).toBe(true);
  });

  it("every non-allowlisted prisma.user.create/upsert call sets creator_id to the same identifier as id", () => {
    const sites = findUserCreateCallSites();
    const violations: string[] = [];

    for (const site of sites) {
      if (ALLOWLIST.has(site.file)) continue;
      const block = ownershipBlock(site.callText);
      const idValue = extractAssignedIdentifier(block, "id");
      const creatorValue = extractAssignedIdentifier(block, "creator_id");

      if (!idValue || !creatorValue) {
        violations.push(
          `${site.file}: prisma.user.create/upsert call is missing an explicit ` +
            `id and/or creator_id assignment — cannot confirm self-reference.`,
        );
        continue;
      }
      if (idValue !== creatorValue) {
        violations.push(
          `${site.file}: creator_id (${creatorValue}) does not match id ` +
            `(${idValue}) — new user rows must self-reference creator_id, ` +
            `or x-self-only's setting entity loses its ownership invariant ` +
            `for this account.`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
