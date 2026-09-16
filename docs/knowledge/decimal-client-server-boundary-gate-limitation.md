# No automated gate exercises the Decimal client/server module boundary

**Rule**: a helper that needs `Prisma` as a *value* (e.g.
`deepStringifyDecimals`'s `instanceof Prisma.Decimal`) must live in a
server-only module. Any function a `'use client'` component (or a
client-adjacent module like `column_def.tsx`/`page_list.tsx`) needs must
live in a module with **zero** value-level Prisma import, even
transitively through a re-export barrel — a bundler still evaluates a
re-exporting module's own top-level imports. `formatDecimalDisplay` lives
in `lib/_decimal_format.ts` for exactly this reason;
`deepStringifyDecimals`/`DeepStringifyDecimals` stay in `lib/_decimal.ts`.

## Why this gate gap exists

`tsc --noEmit` (what `decimal-gate` and every other `check_*_gate_fixture.sh`
script actually runs) type-checks each file in isolation against its own
declared imports — it has no concept of "which bundle does this module end
up in." A module that imports the Node.js Prisma client as a value and is
then pulled into a `'use client'` component's bundle type-checks perfectly
correctly; the failure only exists at the *bundler* level (webpack/Turbopack
resolving `[project]/node_modules`, `fs`, and other Node-only dependencies
of the Prisma client into a browser bundle). `tsc` green proves nothing
about this class of defect.

The *mandatory* gate that does run a real bundler pass
(`npm run test:e2e:build`, `next build`) can't catch it either — for a
different reason: **this repo's own `code_generator/json_schema.yaml` has
zero Decimal-typed fields** (same gap `decimal-gate`'s own docstring
already names for `tsc`). `next build` only compiles what's actually wired
into the generated app; with no Decimal field anywhere, `formatDecimalDisplay`
is never imported by anything, so the code path exercising this boundary
never runs.

## Incident this gap let through (PR #393/#394)

PR #393 wired `formatDecimalDisplay` into four client-side templates
(`form_view.tsx.jinja2`, `form_upsert.tsx.jinja2`, `column_def.tsx.jinja2`,
`page_list.tsx.jinja2`) while defining it in `lib/_decimal.ts` alongside
`deepStringifyDecimals` — pulling the Node.js Prisma client into every
consumer app's client bundle. Both `decimal-gate` (tsc-only) and
`test:e2e:build` (real build, but on a Decimal-free schema) stayed green.
The defect only surfaced downstream, on a *consumer* schema with an actual
Decimal field, as `TurbopackInternalError`. PR #394's first fix attempt
(`import type { Prisma }`) treated the symptom as a *type-only vs. value*
import problem and broke a different, unrelated line in the same file
(`deepStringifyDecimals`'s `instanceof Prisma.Decimal`, which genuinely
needs the value import) — `lib/_decimal.ts(59,24): error TS1361`. The real
fix is the module split described above, not an import-kind change.

## Chosen path: document the gap, not automate it

A fixture that reproduces this class of defect needs an actual Decimal
field wired into a `list: true` + `view: true` entity, then a real
`next build` — not a narrow tsc-only fixture like `decimal-gate`'s existing
shim approach (`decimal-gate` intentionally avoids a full Next.js build; see
its own script header). Two ways to get that:

1. **Scaffold a standalone mini Next.js app** for the fixture (its own
   `next.config`, `tsconfig`, and stubs for every `_standard`/`ui` component
   `form_view.tsx`/`page_list.tsx` import) — the same shape as every other
   `check_*_gate_fixture.sh`, just with a real `next build` instead of `tsc`.
   Rejected for now: the stub surface (every shared component these four
   templates transitively import) is large and would need to be
   hand-maintained in lockstep with the real components, or it silently
   stops testing the real thing.
2. **Temporarily inject a Decimal field into this repo's own live schema**
   (add a scale-bearing column to an existing `list: true` + `view: true`
   entity in both `code_generator/json_schema.yaml` and
   `prisma/schema.prisma`, `generate-code`, `prisma generate`, `next build`,
   then revert both schema files and re-`generate-code` to restore the
   derived output — this is the exact manual recipe used to verify the
   fix landed in this file's companion commit). This reuses the repo's real
   component tree (accurate) but mutates tracked schema files mid-run —
   automating it as an always-on CI gate step means every run temporarily
   dirties `json_schema.yaml`/`schema.prisma`/generated i18n keys, and a
   script interrupted between inject and revert would leave the repo in a
   broken, uncommittable state. That fragility/cost is a worse trade than a
   documented manual recipe for a defect class that (per this doc) is now
   understood and unlikely to recur silently in the same shape.

**Decision**: document the limitation here (this file) rather than build
either automation. If this class of defect recurs, prefer the scaffold
approach (option 1) over expanding option 2's live-schema-mutation approach
into CI.

## What to check by hand when adding a new client-importable helper

Before wiring any new function into a `'use client'` component (or a
client-adjacent module like `column_def.tsx`/`page_list.tsx`):

1. Does the function's own module have a top-level `import { X } from
   '@/app/generated/prisma/client'` (or any other Node-only import) as a
   **value** (not `import type`)? If yes, and the module also has a
   genuine need for that value elsewhere (so `import type` isn't a valid
   fix), the client-safe function must move to its own Prisma-free module.
2. Re-exporting through the Prisma-importing module is **not** a fix — a
   bundler still evaluates that module's own top-level imports when
   resolving the re-export.
3. Verify with a real `next build`, not `tsc --noEmit` alone — see the
   manual recipe above if no existing fixture already exercises the
   field/entity shape needed.
