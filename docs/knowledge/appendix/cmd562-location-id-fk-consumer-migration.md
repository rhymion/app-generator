# Location id-FK migration — consumer patch

> Ready-to-apply reference for any consumer still on the pre-migration string-column design for the
> ledger entity's `location` column (`inventory_transaction.location`). Written against two
> consumer app repos ("Consumer A" and "Consumer B" below) as they stood on 2026-08-05 —
> re-verify current column/model names against the target repo's own `prj/prisma/schema.prisma` /
> `prj/code_generator/json_schema.yaml` before applying, since both were read-only at the time
> this doc was written (this generator repo's own tasks must not modify either consumer's working
> tree directly).

## 0. Prerequisite: both consumers' submodule pointer predates the required ledger-domain field keys

As of 2026-08-05, Consumer A's `app-generator` submodule is pinned at `2605998d` and Consumer B's
at `20557b8c` — both before the change that made the `x-ledger-entities.<domain>` `itemField`/
`locationField`/`lotField`/`expirationField` keys required. Bumping either submodule pointer past that change
(a prerequisite for reaching this migration's generator, independent of the migration itself) requires adding
those four keys to the domain declaration *first*, or `generate-code` fails immediately
(`resolve_ledger_domain` is fail-closed, no defaults). Both consumers currently only declare
`pool`/`ledger`/`transactionable`:

```yaml
x-ledger-entities:
  inventory_domain:
    pool: inventory
    ledger: inventory_transaction
    transactionable: inventory_transactionable
    # Add before bumping past that prerequisite change (unrelated to this migration itself, but blocks reaching it):
    itemField: product_id
    locationField: location_id
    lotField: lot_number
    expirationField: expiration_date
```

This is a config-only addition (no generated-output change when the values match each consumer's
existing column names) — see `inventory-reservation-split.md` §7 for why it's required with no
default.

## 1. Schema changes

### 1.1 `prisma/schema.prisma` — `inventory_transaction` model

**Consumer A** (`prj/prisma/schema.prisma`, current `inventory_transaction.location`):

```diff
-  location                      String
+  location_id                   String?
+  location                      location?                 @relation(fields: [location_id], references: [id], onDelete: Restrict)
```

**Consumer B** (`prj/prisma/schema.prisma`, current `inventory_transaction.location`):

```diff
-  // Denormalized location *name* (O-6), '' when the lot has no location.
-  location                     String                     @default("")
+  location_id                  String?
+  location                     location?                  @relation(fields: [location_id], references: [id], onDelete: Restrict)
```

Both: add the reverse relation field on the `location` model (e.g.
`inventory_transactions inventory_transaction[]`) if Prisma's validator requires it for the new
relation (it will — an unnamed relation needs both sides declared once there is more than one
relation between the same two models; Consumer B's `location` model already has an `inventories
inventory[]` back-relation from the pool side, so this new one needs its own relation name, e.g.
`@relation("InventoryTransactionLocation")` on both sides, to disambiguate from that existing one).

Do **not** drop the old `location` string column in this same migration — see §4.

### 1.2 `code_generator/json_schema.yaml` — `inventory_transaction` fields

**Consumer A** (`prj/code_generator/json_schema.yaml`, replacing the `location: {}` entry under
`inventory_transaction.fields`):

```diff
   inventory_transaction:
     ...
     fields:
       ...
-      location: {}
+      location_id:
+        x-relationship:
+          searchField: name
       lot_number: {}
+    properties:
+      location:
+        $ref: "#/definitions/location"
```

**Consumer B** (replacing the `location: {default: ""}` entry):

```diff
   inventory_transaction:
     ...
     fields:
       ...
-      # Explicit `default:` is required, not cosmetic: a Prisma-defaulted
-      # non-nullable scalar without one is typed `string | null` on the entity
-      # type while FormViewProps keeps the non-null `string`, and the two
-      # disagree at the FormUpsert call site.
-      location:
-        default: ""
+      location_id:
+        x-relationship:
+          labelField: name
       lot_number: {}
     properties:
       product:
         $ref: "#/definitions/item"
+      location:
+        $ref: "#/definitions/location"
```

(Consumer B's old comment about needing an explicit `default: ""` no longer applies — the column is
nullable now, so there's no non-nullable/`FormViewProps` type mismatch to route around.)

### 1.3 `location` entity — add `x-audit: true`

Neither consumer's `location` entity currently declares `x-audit`. Add it (Consumer A: near line
1196 `definitions.location`; Consumer B: near line 550 `definitions.location`):

```diff
   location:
     x-generate:
       ...
+    x-audit: true
     fields:
       name: {}
```

This is the only change needed for renames to leave a record — `x-audit: true` is an existing,
entity-agnostic mechanism (`build_context.py`'s `is_audited`, proven generic by
`code_generator/tests/test_audit_logging.py`), not new generator work. It wraps
`update{Location}`/`delete{Location}` in `recordAuditEvent()`, writing an `audit_log` row with the
actor, target id, and timestamp — it does not capture the old/new name values or offer a
per-entity history UI (both explicitly out of scope for this ruling).

## 2. Migration SQL

Applied via `npx prisma migrate dev --name location_id_fk` (or hand-authored under
`prj/prisma/migrations/`) once §1.1's schema.prisma edit is in place:

```sql
-- 1. Add the new nullable FK column (non-breaking — old `location` string
--    column is untouched, still populated by any code not yet regenerated).
ALTER TABLE "inventory_transaction" ADD COLUMN "location_id" TEXT;
ALTER TABLE "inventory_transaction"
  ADD CONSTRAINT "inventory_transaction_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "location"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "inventory_transaction_location_id_idx" ON "inventory_transaction"("location_id");

-- 2. Classify every existing row by how confidently its string `location`
--    value maps back to a real location row. Read-only — run this SELECT
--    first and review the ambiguous/unmatched rows before step 3.
SELECT
  CASE
    WHEN it.location IS NULL OR it.location = '' THEN 'safe_null'
    WHEN match_count = 1 THEN 'safe_unique_match'
    WHEN match_count = 0 THEN 'unmatched'
    ELSE 'ambiguous'
  END AS bucket,
  it.id AS ledger_row_id, it.location AS ledger_string,
  match_count, matched_ids
FROM (
  SELECT it.id, it.location, count(l.id) AS match_count,
         array_agg(l.id) FILTER (WHERE l.id IS NOT NULL) AS matched_ids
  FROM inventory_transaction it
  LEFT JOIN location l
    ON l.name = it.location AND it.location IS NOT NULL AND it.location <> ''
  GROUP BY it.id, it.location
) it
ORDER BY bucket, ledger_row_id;

-- 3. Backfill ONLY the unambiguous buckets. safe_null rows correctly stay
--    NULL (nothing to fill). safe_unique_match rows get their one match.
--    ambiguous/unmatched rows are deliberately left NULL here — do not
--    silently guess; resolve them by hand (see below), then re-run this
--    UPDATE (it is idempotent: already-filled rows are excluded by the
--    WHERE location_id IS NULL guard).
WITH classified AS (
  SELECT it.id,
         CASE
           WHEN it.location IS NULL OR it.location = '' THEN 'safe_null'
           WHEN match_count = 1 THEN 'safe_unique_match'
           WHEN match_count = 0 THEN 'unmatched'
           ELSE 'ambiguous'
         END AS bucket,
         matched_ids
  FROM (
    SELECT it.id, it.location, count(l.id) AS match_count,
           array_agg(l.id) FILTER (WHERE l.id IS NOT NULL) AS matched_ids
    FROM inventory_transaction it
    LEFT JOIN location l
      ON l.name = it.location AND it.location IS NOT NULL AND it.location <> ''
    GROUP BY it.id, it.location
  ) it
)
UPDATE inventory_transaction it
SET location_id = c.matched_ids[1]
FROM classified c
WHERE it.id = c.id AND c.bucket = 'safe_unique_match' AND it.location_id IS NULL;

-- 4. Confirm zero ambiguous/unmatched rows remain unresolved before treating
--    the migration as complete (re-run step 2's SELECT — any row still
--    bucketed 'ambiguous' or 'unmatched' needs a human decision: which
--    location it actually meant, recorded via a manual
--    `UPDATE inventory_transaction SET location_id = '<chosen id>' WHERE id = '<row id>'`
--    per row, not a bulk heuristic).
```

**Real-data measurement (2026-08-05, re-verified at the start of this task — do not reuse older
numbers)**: Consumer B's only reachable test database (a docker-compose Postgres test container)
holds exactly 1 `inventory_transaction` row with an empty-string `location` (Cypress seed/teardown
residue, not accumulated ledger history) — 0 rows need backfilling there today. Consumer A has no
running database container to query. Neither consumer currently has real ledger history requiring
backfill; the classification query above was demonstrated against a 6-row synthetic fixture (2
safe_unique_match, 2 safe_null, 1 ambiguous, 1 unmatched) in an isolated scratch database,
reproducing the exact same buckets — the query is real-data-ready whenever either consumer
accumulates ledger rows worth migrating.

## 3. onDelete: Restrict — reproduced against a real database

Demonstrated in an isolated scratch Postgres container (not either consumer's own):

```
=== attempt to delete REFERENCED location ===
ERROR:  update or delete on table "location" violates foreign key constraint
        "inventory_transaction_location_id_fkey" on table "inventory_transaction"
DETAIL:  Key (id)=(loc2) is still referenced from table "inventory_transaction".

=== attempt to delete UNREFERENCED location ===
DELETE 1
```

A location still pointed to by any ledger row cannot be deleted; an unreferenced one can.

## 4. Dropping the old `location` string column (separate, later step)

Not included in this migration. Once every row's `location_id` is confirmed non-ambiguous (§2
step 4) and the regenerated code (§1.2) is deployed and verified end-to-end, a follow-up migration
can drop the now-redundant `location` string column:

```sql
ALTER TABLE "inventory_transaction" DROP COLUMN "location";
```

Keeping the string column through one migration cycle costs nothing (it's simply unused by
regenerated code) and gives a rollback path if any backfilled row turns out wrong. Whether to drop
it at all, or keep it as a permanent point-in-time snapshot alongside the id, is a product
decision — flagged, not decided, here (see `inventory-reservation-split.md` §7.1's
"non-breaking, additive first" framing).

## 5. Order of operations

1. Add the four `x-ledger-entities` keys (§0) if not already present — prerequisite, independent
   of this migration itself.
2. Apply §1.1 (schema.prisma), §1.2 (json_schema.yaml), §1.3 (`x-audit: true` on `location`).
3. Bump the `app-generator` submodule pointer to (at least) the commit containing this migration, then
   run `generate-code`.
4. Run the migration SQL §2 steps 1–3 against the target database; review and hand-resolve any
   `ambiguous`/`unmatched` rows (§2 step 4).
5. Deploy the regenerated code; verify end-to-end (mandatory gate + manual smoke test of a
   reserve/receive/move/adjust/split flow).
6. Optionally, once stable, apply §4's column drop as its own migration.
