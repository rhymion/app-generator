# Inventory Domain Generalization — Design Document

> **cmd_310** · 2026-07-13 · **Status: APPROVED — rulings OD-1~8 + RC-1 + RC-2 applied**
>
> **Scope**: Design only. Implementation follows separate cmds after cmd_309 is serialized and
> closed (same working tree; concurrent modification forbidden).
>
> **Related**: `appendix/inventory-reservation-split.md` (current behavior reference, cmd_309 item5)
> `docs/generic-primitives-redesign.md` (upstream design rationale)

---

## 0. North Star

> "Lift the inventory domain from a bespoke implementation that assumes literal model names
> (`inventory` / `inventory_transaction` / `inventory_transactionable`) to **generic primitives
> where customers declare roles with x-* markers and the generator resolves by marker, not name**."
>
> — cmd_310 north_star (direct quote)

### 0.1 Governing Design Principle (OD-1~8 underlying idea)

> **No backward compatibility. No defaults. Config is required. Simplicity is paramount.**

All previous design proposals that used `optional + default` patterns to preserve backward
compatibility are **replaced** by this principle. Existing schemas that do not declare new required
config will fail validation — that is intentional. There is no migration path for old schemas;
existing data can be deleted and recreated. This simplification eliminates an entire class of
"default-value drift" bugs and makes the design significantly easier to reason about.

---

## 1. Dependency Audit — Consolidated Table (AC1)

### 1.1 Investigation Scope

| Subtask | Area | Scope |
|---------|------|-------|
| 310a | jinja2 templates | `code_generator/templates/` |
| 310b | Python generator | `code_generator/*.py` + `prj/code_generator/json_schema.yaml` |
| 310c | x-ledger-source | current state + receiving/reservation asymmetry |
| 310d | x-reservation | full text (3 blocks) + warehouse/location current state |

Classification key:
- **(a-role)** Role-dependent: generator resolves by literal name; **must be replaced with marker**
- **(a-default)** Implicit default: `dict.get(key, 'inventory')` pattern; fires when schema omits field
- **(b)** Internal fixed name: implementation detail, no customer impact
- **(c)** Cosmetic: comment, docstring, test fixture value; no functional dependency

### 1.2 Consolidated Audit Table

#### Templates (`code_generator/templates/`)

| Location | Excerpt | Class | hardcoded_lookup | Ruling |
|---|---|---|---|---|
| `split_action_route.ts.jinja2:102–134` | `tx.inventory_transaction.findMany/create`, `tx.inventory.updateMany`, `.inventory_transactionable_id` | **(a-role)** | **YES** | Fix via top-level `ledger`/`transactionable`/`pool` declarations (OD-1). |
| `split_action_route.ts.jinja2:156–272` | Same 3 model names across ~115 lines | **(a-role)** | **YES** | Same. |
| `split_action_route.ts.jinja2:283` | `{% if ... f == 'inventory_id' %}` | **(a-role)** | **YES** | Derive from `lineTransactionableField` config. |
| `split_action_route.ts.jinja2:303–305` | `inventory_transactionable_id: _childBridgeId` | **(a-role)** | **YES** | Same. |
| `ledger_write_stub.ts.jinja2` (whole file) | `tx.inventory.*`, `tx.inventory_transaction.*`, `tx.inventory_transactionable.*` | **(a-role)** | **YES** | Fix via top-level entity declarations (OD-1). |
| `receiving_confirm_form.tsx.jinja2:58–71` | `inventory_selections`, `inventory_id` — POST body keys | **(a-role)** | no | Part of x-receiving mechanism (OD-5 abolition — see §4.5). |
| `service.ts.jinja2:231,253` | `InsufficientInventoryError` | **(b)** | no | Rename to `InsufficientPoolCapacityError` (OD-4). |
| `test_reservation_spec.cy.ts.jinja2:157` | `cy.task('db:seedReservationInventory', ...)` | **(a-role)** | **YES (BUG)** | Phase 1 template fix: replace with `db:seedReservation{{ pascal }}` (OD-8). |

#### Python Generator (`code_generator/*.py`)

| Location | Excerpt | Class | hardcoded_lookup | Ruling |
|---|---|---|---|---|
| `generators.py:822` | `tx.inventory_transactionable.create(...)` literal | **(a-role)** | **YES** | Read `transactionable` entity name from top-level declaration (OD-1). |
| `generators.py:834–836` | `tx.inventory_transaction.create({..., inventory_transactionable_id: ...})` | **(a-role)** | **YES** | Same. |
| `generate.py:637–639` | `_has_inventory_bridge = 'inventory_transactionable_id' in props` | **(a-role)** | **YES** | **P0 (Phase 1)**: Read `lineTransactionableField` from config (like `build_context.py:191–198`). No schema change needed. |
| `generate.py:663` | `_always_exclude = {..., 'inventory_transactionable_id', ...}` | **(a-role)** | **YES** | Same P0 fix. |
| `generate.py:650` | `_split_reserves_inventory = _has_inventory_bridge and ...` | **(a-role)** | **YES** (derived) | Fixed automatically by P0 fix. |
| `generators_test.py:730–731` | `if 'inventory_transactionable_id' in props: excludes.add(...)` | **(a-role)** | **YES** | Same P0 fix (3rd independent implementation). |
| `generators.py:782,1030,1236` | `pool.get('entity', 'inventory')` | **(a-default)** | no | **Removed entirely**: under new design, pool entity is declared top-level and required. |
| `generate.py:553` | `_xr_inv.get('entity', 'inventory')` | **(a-default)** | no | **Removed with x-receiving abolition** (OD-5). |
| `generate.py:549` | `inventoryMutation == 'confirm_receipt'` | **(b)** | no | **Removed with x-receiving abolition** (OD-5). |
| `generators.py:2057,2194–2197` | `key.endswith('able_id')` generic suffix | **(b)** | no | Good pattern — retain as-is. |
| `build_context.py:191–198` | reads `lineTransactionableField` dynamically | **(b)** | no | **Reference implementation** for P0 fix. |

### 1.3 Priority Ranking

| Priority | Fix | Phase |
|---|---|---|
| **P0** | `generate.py:637–639,663` + `generators_test.py:730–731`: read `lineTransactionableField` from config | Phase 1 |
| **P0** | `test_reservation_spec.cy.ts.jinja2:157`: template bug `db:seedReservationInventory` | Phase 1 |
| **P1** | Top-level entity declarations + all generator/template sites that reference 3 model names | Phase 2 |
| **P2** | x-receiving abolition + delete `ReceivingConfirmForm.tsx` and confirm route (no replacement) | Phase 2 (see §4.5) |
| **P3** | `InsufficientInventoryError` rename (OD-4) | Phase 3 |
| **P4** | location/warehouse FK (OD-6 atomic) | Phase 4 |
| **P5** | movement/adjustment new event types (OD-7) | Phase 5 |

---

## 2. Role Marker Design — Top-Level Entity Declarations (AC2, OD-1)

### 2.1 Ruling (OD-1 = B, refined)

The design reviewer's original recommendation (embed `ledgerEntity`/`transactionableEntity` inside
`x-reservation.transaction`) was **not adopted**. The ruling:

> **Declare `ledger`, `transactionable`, and `pool` as top-level schema entities.
> Both `x-reservation` and `x-ledger-source` reference them by key.**

Rationale: supports multiple independent inventory-like sets in the same schema (e.g., a schema
with both `inventory` and `supply_pool` each having their own ledger/transactionable entities).
The per-reservation-block embedding (the inline-embedding option) cannot express this.

### 2.2 New Top-Level Schema Structure

At the schema root level (alongside `x-receiving`, `definitions`, etc.):

```yaml
# Schema root — new top-level declarations
x-ledger-entities:
  # Named sets. Each entry is an independent inventory-like domain.
  inventory_domain:
    pool: inventory                          # entity that holds quantity/reserved_quantity
    ledger: inventory_transaction            # entity for ledger row writes
    transactionable: inventory_transactionable  # through-table/bridge entity

  supply_domain:
    pool: supply_pool
    ledger: supply_transaction               # hypothetical — customer-named
    transactionable: supply_transactionable  # hypothetical
```

### 2.3 Referencing From x-reservation and x-ledger-source

```yaml
# On purchase_order (requesting entity)
x-reservation:
  ledgerDomain: inventory_domain    # NEW: references the x-ledger-entities key
  mode: count
  pool:
    quantityField: quantity         # pool entity name comes from x-ledger-entities, not here
    reservedField: reserved_quantity
  ...

# On receiving_receipt_line
x-ledger-source:
  ledgerDomain: inventory_domain    # NEW: same reference
  event_type: receive
  quantity_delta_field: receipt_quantity
  poolIdField: inventory_id         # field on THIS entity pointing to the pool row
```

The generator reads `x-ledger-entities[ledgerDomain]` to resolve `pool`, `ledger`,
`transactionable` entity names. No literal names anywhere in generator code.

### 2.4 What Changes in the Generator

| Site | Before | After |
|---|---|---|
| `generators.py:822` | `'inventory_transactionable'` literal | `rc['ledgerDomain']['transactionable']` |
| `generators.py:834–836` | `'inventory_transaction'`/`'inventory_transactionable_id'` | from domain config |
| `generate.py:637–639` | literal `'inventory_transactionable_id'` membership check | `lineTransactionableField` from config (P0 fix unchanged by OD-1) |
| `split_action_route.ts.jinja2:102–305` | literal model name strings | jinja context vars `ledger_entity`, `transactionable_entity`, `pool_entity` |
| `ledger_write_stub.ts.jinja2` | literal `inventory.*` | same jinja vars |
| Default fallbacks (`pool.get('entity', 'inventory')` etc.) | exist everywhere | **Removed** — declaration is required |

### 2.5 Relationship to x-reservation (OD-2)

x-reservation is **not deprecated**. The new `ledgerDomain` reference replaces only the implicit
entity-name assumption. When a new mechanism provides overlapping capability (e.g., a future
declarative ship mechanism), only the specifically duplicated x-reservation keys are removed —
not the whole block.

### 2.6 P0 Fix — Phase 1 (independent of OD-1, no schema change)

The three literal `'inventory_transactionable_id'` membership checks:
- `generate.py:637–639`
- `generate.py:663`
- `generators_test.py:730–731`

Must read `x-reservation.result.lineTransactionableField` from config, exactly as
`build_context.py:191–198` already does. This fix is independent of the top-level declaration
design and can ship in Phase 1 with zero schema changes.

---

## 3. Warehouse / Location Addition Design (AC3, OD-6)

### 3.1 Current State

- `inventory.location`: plain nullable `String` — free-text, no FK, no entity
- `warehouse`, `location` models: **do not exist** anywhere

### 3.2 Ruling (OD-6 = B: Atomic Migration)

> **Atomic migration. No parallel-column transition. No data preservation. Existing data may be
> deleted. No backward compatibility.**

### 3.3 Design

Standard many-to-one FK using existing `x-relationship` mechanism. No new generator code needed.

```yaml
# Customer schema — entity names are their choice
location:
  properties:
    id: { type: string, pattern: "^c[a-z0-9]{24,}$" }
    name: { type: string }
    code: { type: [string, "null"] }
    warehouse_id:
      type: string
      x-relationship:
        type: many-to-one
        target: warehouse
        labelField: name

warehouse:
  properties:
    id: { type: string, pattern: "^c[a-z0-9]{24,}$" }
    name: { type: string }

inventory:
  properties:
    ...existing fields...
    # REMOVE: location: { type: [string, "null"] }
    # ADD: FK to location entity
    location_id:
      type: [string, "null"]
      x-relationship:
        type: many-to-one
        target: location          # whatever the customer names their location entity
        labelField: name
```

### 3.4 Generator Impact (All Existing Generic Paths — Zero New Code)

| Layer | Impact |
|---|---|
| Prisma | `@relation` via existing many-to-one generator path |
| UI | Autocomplete dropdown via existing x-relationship path |
| Types | Generated automatically |
| API | Filter/include via existing relation handling |
| x-ledger-source | `poolIdField` still points to `inventory_id` (pool row); no change |

### 3.5 Migration (Atomic)

1. Remove `inventory.location` string field from schema
2. Add `location` and `warehouse` entity definitions to schema
3. Add `inventory.location_id` FK to schema
4. Run `generate-code` + `prisma db push` (atomic, existing data dropped per OD-6)

---

## 4. Movement / Adjustment / Ledger-Source Unification (AC4)

### 4.1 Ruling Summary

| OD | Ruling |
|---|---|
| OD-3 | claim/ship gets **config-driven richer skeleton** (Option B). No full declarative (Option C). |
| OD-5 | x-receiving **abolished** — `ReceivingConfirmForm.tsx` + confirm route deleted (no replacement) — see §4.5 |
| OD-7 | inventory_movement: **single entity** with `from_inventory_id`/`to_inventory_id`; generator emits 2 ledger rows |

### 4.2 Current Asymmetry (from an earlier design review)

| Operation | Entity | Mechanism | Code style |
|---|---|---|---|
| Reserve | purchase_order | `x-reservation` (ledger_transaction) | Declarative |
| Release | purchase_order | `x-reservation` (internal to split) | Declarative |
| Ship/Claim | purchase_per_item | Handwritten (approval hook) | Manual |
| Receive | receiving_receipt_line | `x-ledger-source` → write-once stub | Declarative stub |

### 4.3 Operation Correspondence Table — Approved Design

| Operation | event_type | Schema declaration | Generator output | Phase |
|---|---|---|---|---|
| Reserve | (internal) | `x-reservation` (ledger_transaction) | TS reserve code in service.ts | ✅ Exists |
| Release | (internal) | `x-reservation` (internal to split) | Release in split route | ✅ Exists |
| Ship/Claim → **renamed: Ship** | `ship` | `x-reservation` + new richer skeleton trigger | Improved `service_after_approve_stub.ts` | Phase 3 |
| Receive | `receive` | `x-ledger-source` (+ `ledgerDomain` ref) | `ledger_write_stub.ts` | Phase 2 |
| Move (new) | `move` | `x-ledger-source: {event_type: move, fromPoolIdField, toPoolIdField, ledgerDomain}` | New `ledger_move_stub.ts` | Phase 5 |
| Adjust (new) | `adjust` | `x-ledger-source: {event_type: adjust, quantity_delta_field, ledgerDomain}` | New `ledger_adjust_stub.ts` | Phase 5 |

### 4.4 Ship/Claim Terminology — Renamed to "Ship" (C.3 Verification Result)

It was identified that `_claim` (a TypeScript local variable in split templates representing
quantity being allocated) conflicts conceptually with "claim" as an operation name. Investigation
confirmed these are distinct:
- `_claim` = quantity amount in a loop iteration (local variable, `const _claim = Math.min(...)`)
- "claim/ship" = the approval-time operation that turns `reserved → consumed`

**Recommendation: rename operation to "Ship"** (adopted):
- Aligns with `event_type: ship` already in `inventory_transaction` enum
- Matches json_schema.yaml comment: "ship/cancel are driven by the standard approve/reject flow"
- `_claim` local variable is unaffected (different scope and purpose)

### 4.5 x-receiving Abolition — Confirmed Ruling (RC-1 resolved, 2026-07-13)

**OD-5 + RC-1 ruling (2026-07-13)**:

> Approval and rejection are handled by `receiving_receipt_line`, not by `ReceivingConfirmForm`.
> `ReceivingConfirmForm.tsx` and `app/api/receiving_receipt/.../actions/confirm/route.ts` are
> **not needed in the current approval flow**. Abolish x-receiving and **delete these generated
> files outright — no replacement**. The design reviewer's alternative proposal (re-generate confirm
> form/route via `x-ledger-source: {event_type: receive}`) is **not adopted** because the
> form/route themselves are unnecessary.

**What gets deleted (Phase 2)**:
1. `components/receiving_receipt/ReceivingConfirmForm.tsx` — generated file, deleted
2. `app/api/receiving_receipt/[id]/actions/confirm/route.ts` — generated file, deleted
3. `x-receiving` top-level block from `json_schema.yaml`
4. `generate.py:546–576` code path that reads x-receiving and generates the above

**Mandatory implementation-time checks** (acceptance criteria for the Phase 2 implementation cmd):

**(a) FormView.tsx import cleanup**: When `generate.py` removes `ReceivingConfirmForm.tsx`,
it MUST also remove the import site at `components/receiving_receipt/FormView.tsx:11`
and the render call at `:54`. A dangling import causes a TypeScript/build error. The generator
must surgically remove these two references — not just stop generating the form file.

**(b) Build and e2e green**: After re-generation, `next build` must pass with exit code 0, and
the receiving approval/rejection flow (`receiving_receipt_line`-side) e2e tests must remain green.

**Stop-and-report clause**: If, during Phase 2 implementation, `ReceivingConfirmForm` proves
to be reachable in a currently-exercised user path and its deletion breaks the build or the
receiving flow, the implementor must **stop and raise the issue for maintainer review** rather than
proceeding with blind deletion. The ruling is based on the premise that the form is
unused in the current approval flow; if that premise is wrong, escalate.

**Update (cmd_651)**: item 2 above ("confirm route... deleted") was not literally true at the time
this section was written — only `ReceivingConfirmForm.tsx` and its `generate.py` call site were
removed; `code_generator/templates/receiving_confirm_route.ts.jinja2` itself was left behind,
unreferenced by any `_render()`/`_write()` call, until cmd_651 deleted it. See `CHANGELOG.md`
(`### Internal`, cmd_651) for the full grep evidence trail.

### 4.6 Standalone Release Action — Deletion Safety (C.2 Verification Result)

**Investigation finding: no standalone `/actions/release` routes exist in the current schema.**

Evidence:
- All 3 x-reservation entities (`purchase_order`, `supply_request`, `room_reservation`) have
  **no `actions` block** in their `x-reservation` declaration (Python-confirmed: empty result)
- The validator (`validate.py:387`) accepts `'release'` as a valid act_type, but no schema uses it
- The `release` in the codebase occurs only as:
  1. `event_type: release` in `inventory_transaction` enum (internal, must stay)
  2. Internal operation within split template (parent release before child reservation)
  3. Reject-triggered release via approval flow (`service_after_reject.ts`)

**Conclusion: Removing standalone release from the generator action vocabulary is safe.**
No e2e tests cover it, no routes are generated, no customer UI relies on it.
The **internal release primitive** (split template + approval reject path) must be preserved.

### 4.7 inventory_movement Design (OD-7 = A)

Single entity model with two pool FK fields. Generator emits two `x-ledger-source`-driven
ledger rows within a single transaction:

```yaml
inventory_movement:
  properties:
    id: { type: string, pattern: "^c[a-z0-9]{24,}$" }
    from_inventory_id:
      type: string
      x-relationship:
        type: many-to-one
        target: inventory
        labelField: ...  # composite label
    to_inventory_id:
      type: string
      x-relationship:
        type: many-to-one
        target: inventory
        labelField: ...
    quantity: { type: integer, minimum: 1 }
  x-ledger-source:
    ledgerDomain: inventory_domain
    event_type: move
    fromPoolIdField: from_inventory_id
    toPoolIdField: to_inventory_id
    quantity_delta_field: quantity
```

Generator emits a new `ledger_move_stub.ts.jinja2` that creates two `inventory_transaction`
rows in a single `$transaction`: one with `event_type: move, quantity_delta: -N` on the
from-pool row, one with `event_type: move, quantity_delta: +N` on the to-pool row.

---

## 5. Error Rename (OD-4)

**OD-4 = Approved: `InsufficientInventoryError` → `InsufficientPoolCapacityError`**

Sites affected:
- `service.ts.jinja2:231,253` — exception throw
- `api_route.ts.jinja2:9,38` — import/catch
- `generators.py:653,1915–1938,1964` — class definition build
- All generated TypeScript files that import/catch this class

This is a **breaking change in generated TS API** (exception class name appears in API responses
and catch blocks). Per ruling, this is accepted. All callers must update when regenerated.

---

## 6. Staged Implementation Plan (B)

> All phases assume cmd_309 is fully serialized and closed before any implementation begins.
> Phases are independent cmds; each requires its own QC gate.

### Phase 1 — Smallest Safe Fix (P0, no schema change)

**Content:**
- Fix `generate.py:637–639,663` to read `lineTransactionableField` from config (like `build_context.py:191–198`)
- Fix `generators_test.py:730–731` same pattern
- Fix `test_reservation_spec.cy.ts.jinja2:157` template bug (`db:seedReservationInventory` → `db:seedReservation{{ pascal }}`)

**Gate**: re-generate with default schema; golden diff must be empty for all affected files.
**Approval needed before**: none — these are pure fixes.

### Phase 2 — Top-Level Entity Declarations + Ledger Generalization

**Content:**
- Add `x-ledger-entities` top-level schema block with `inventory_domain` entry
- Add `ledgerDomain` reference to `x-reservation` on `purchase_order`
- Add `ledgerDomain` reference to `x-ledger-source` on `receiving_receipt_line`
- Update `generators.py:822,834–836` to read from domain config
- Update `split_action_route.ts.jinja2:102–305` to use jinja context vars
- Update `ledger_write_stub.ts.jinja2` similarly
- Abolish `x-receiving` top-level block + `generate.py:546–576` code path
- Delete generated `ReceivingConfirmForm.tsx` and confirm route (no replacement — RC-1 ruling)
- Surgically remove `FormView.tsx:11` import and `:54` render call in the generator
- Remove all `dict.get(key, 'inventory')` default fallback patterns

**Gate**: full e2e suite must pass. Write-once stubs re-generated with explicit entity names.
**Implementation-time checks (mandatory — from RC-1 ruling, see §4.5)**:
- (a) `FormView.tsx` has no dangling import after re-generation (build must not error on import)
- (b) `next build` exits 0; `receiving_receipt_line`-side approval/rejection e2e tests remain green
- Stop and raise for maintainer review if `ReceivingConfirmForm` proves reachable and deletion breaks the flow
**Approval needed before**: none (RC-1 resolved — delete without replacement confirmed).

### Phase 3 — Rename + Richer Ship Skeleton

**Content:**
- Rename `InsufficientInventoryError` → `InsufficientPoolCapacityError` everywhere (OD-4)
- Generate richer `service_after_approve_stub.ts` skeleton when `x-reservation.transaction.strategy == 'ledger_transaction'`: include correct entity names from `ledgerDomain`, netting code structure as comments
- Rename "claim" operation concept to "Ship" in documentation and validator vocabulary

**Gate**: build clean; no test regressions; exception rename reflected in type checker.
**Approval needed before**: none (already approved in OD-3, OD-4).

### Phase 4 — Warehouse / Location FK

**Content:**
- Add `warehouse` and `location` entity definitions to schema
- Replace `inventory.location` string field with `inventory.location_id` FK (atomic)
- Run `generate-code` + `prisma db push` (data deletion per OD-6)

**Gate**: build + e2e clean; `inventory.location` string field must no longer exist in generated Prisma schema.
**Approval needed before**: none (OD-6 already approved atomically).

### Phase 5 — Movement / Adjustment New Event Types

**Content:**
- Add `inventory_movement` and `inventory_adjustment` entity definitions to schema
- Add `ledger_move_stub.ts.jinja2` template (2-row transaction per OD-7)
- Add `ledger_adjust_stub.ts.jinja2` template
- Wire through generator: `x-ledger-source: {event_type: move/adjust}` detection

**Gate**: build + e2e clean; new e2e specs for move and adjust operations.
**Approval needed before**: none (OD-7 already approved).

---

## 7. Rulings Applied — Record

The following decisions from the original Open Decisions record are now resolved:

| OD | Decision | Adopted design |
|---|---|---|
| OD-1 | Refined B | Top-level `x-ledger-entities` declarations; x-reservation and x-ledger-source reference by domain key |
| OD-2 | No timeline | x-reservation not deprecated; only remove keys if exact duplicate exists in new mechanism |
| OD-3 | Option B | Config-driven richer ship skeleton; Option C (full declarative) not adopted |
| OD-4 | Approved | `InsufficientInventoryError` → `InsufficientPoolCapacityError` |
| OD-5 + RC-1 | x-receiving abolished | `ReceivingConfirmForm.tsx` + confirm route **deleted, no replacement** (RC-1 resolved 2026-07-13). Approval flow lives on `receiving_receipt_line` side. |
| OD-6 | Atomic | No parallel-column transition; data deletion accepted |
| OD-7 | Option A | Single `inventory_movement` entity; generator emits 2 ledger rows |
| OD-8 | Phase 1 | Template bug fix in Phase 1 |

---

## 8. Remaining Concerns (dashboard action items)

### ~~RC-1~~ — RESOLVED (2026-07-13)

RC-1 (x-receiving abolition replacement mechanism) is closed. Ruling: delete
`ReceivingConfirmForm.tsx` and confirm route outright, no replacement. Implementation-time
checks documented in §4.5 and Phase 2 gate (§6).

### RC-2 — RESOLVED (2026-07-13): "Ship" confirmed

**Issue**: the design review recommends renaming "claim" operation to "Ship". This matches existing schema
`event_type: ship` and existing code comments. However, if "Fulfill" is preferred for semantic
reasons, code comments and design docs should be updated accordingly.

Confirmed 2026-07-13: adopt "Ship" over "Fulfill" for the Phase 3 renamed operation
(Fulfill rejected — would require a new `event_type`).

---

## 9. Appendix: x-reservation Config Reference (from an earlier design record)

*(Unchanged from that earlier record — verbatim extraction for reference only)*

Three current x-reservation declarations:

### purchase_order (mode: count, ledger_transaction)
```yaml
x-reservation:          # json_schema.yaml:1848
  mode: count
  transaction:
    strategy: ledger_transaction
    # Phase 2 addition (OD-1):
    # ledgerDomain: inventory_domain
  lines: items
  pool:
    # entity field removed — comes from x-ledger-entities.inventory_domain.pool
    quantityField: quantity
    reservedField: reserved_quantity
  ...
  result:
    parentField: purchase_order_id
    lineTransactionableField: inventory_transactionable_id
```

### supply_request (mode: count, conditional_update)
```yaml
x-reservation:          # json_schema.yaml:2156
  mode: count
  pool:
    entity: supply_pool  # kept until supply_domain is declared in x-ledger-entities
    quantityField: quantity
    reservedField: reserved_quantity
  result:
    allocationEntity: supply_allocation
    parentField: supply_request_id
    allocationAudit: false
```

### room_reservation (mode: item, row_lock)
```yaml
x-reservation:          # json_schema.yaml:2345
  mode: item
  pool:
    entity: room         # kept; room is not part of an inventory ledger domain
  ...
```

Note: `supply_request` and `room_reservation` do not use `ledger_transaction` strategy and have
no `inventory_transaction`/`inventory_transactionable` involvement. They are unaffected by Phase 2.
Only `purchase_order` gains the `ledgerDomain` reference in Phase 2.

---

*Document end. All confirmations resolved (OD-1–8, RC-1, RC-2) as of 2026-07-13. Design phase complete.*
*Implementation begins after cmd_309 serialization. Phase order: 1 → 2 → 3 → 4 → 5.*
