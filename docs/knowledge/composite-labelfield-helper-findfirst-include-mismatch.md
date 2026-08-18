# Composite-labelField dep: findFirst/create include mismatch

## The problem it solves

When a many-to-one relationship's `labelField` is composite (a list, e.g.
`labelField: [purchase_order.po_number, item.sku]` or a dotted path into another relation),
`generators_test.py`'s `helper_context()` computes a Prisma `include` (`dep.prisma_include_str`) so
the generated test helper's label expression can read the included relation off the dependency
record (e.g. `purchaseOrderLineRecord.purchase_order?.po_number`).

`test_helper.ts.jinja2`'s find-or-create block for a lookup-keyed dep (`dep.lookup_field` set) spliced
that `include` into the `create()` call but not into the paired `findFirst()` call that precedes it
in the same block:

```ts
let purchaseOrderLineRecord = await prisma.purchase_order_line.findFirst({
  where: { purchase_order_id: purchaseOrder.id, item_id: item.id },
  orderBy: { created_at: 'asc' },
  // no include here
});
if (!purchaseOrderLineRecord) {
  purchaseOrderLineRecord = await prisma.purchase_order_line.create({
    data: { /* ... */ },
    include: { purchase_order: true, item: true },
  });
}
const purchaseOrderLine = { ...purchaseOrderLineRecord, name: `${purchaseOrderLineRecord.purchase_order?.po_number ?? ''} ...` };
```

Because `purchaseOrderLineRecord` is declared via `let x = await ...findFirst(...)`, TypeScript fixes
its type to the (relation-less) `findFirst` result — the later `create()` reassignment inside the
`if` block is structurally compatible in the other direction (wider → narrower is allowed), but does
not widen the variable's *declared* type. The label-expression line then reads
`.purchase_order`/`.item`, properties that only exist on the `create()` branch's type, producing:

```
error TS2551: Property 'purchase_order' does not exist on type '{ id: string; ...; unit_price: number }'. Did you mean 'purchase_order_id'?
error TS2339: Property 'item' does not exist on type '{ id: string; ...; unit_price: number }'.
```

Reproduced in `cypress/support/goods_receipt_line/helper.ts` at the `purchase_order_line`
dep (labelField `[purchase_order.po_number, item.sku]`) and the `asn_line` dep (labelField
`[asn.asn_number, item.sku]`) — both FK deps of `goods_receipt_line` in proj_g's (inventory-app)
schema.

**No current gate catches this.** `tsconfig.json` excludes `cypress` from the type-check scope
`next build` runs, and `cypress run` transpiles support files (esbuild-based) without type-checking
them. The error is real and will surface the moment anyone runs `tsc --noEmit` over `cypress/`
directly, opens the file in an editor with TS language-service diagnostics on, or a future gate adds
cypress to its type-check scope — but `npm run test:e2e:build` and `npm run test:e2e:cy:api` both
report green with the bug present, which is how it went undetected as a pre-existing defect.

## The fix

`test_helper.ts.jinja2`: every `findFirst()` call in a lookup-keyed dep's find-or-create block now
carries the same conditional `include` its paired `create()` call already had:

```jinja2
  let {{ dep.var_name }}Record = await prisma.{{ dep.target }}.findFirst({
    where: {{ dep.lookup_where }},
    orderBy: { created_at: 'asc' },
{% if dep.prisma_include_str %}
    include: { {{ dep.prisma_include_str }} },
{% endif %}
  });
```

Five call sites in the template share this exact shape (the `{{ dep.var_name }}Record`/
`{{ dep.var_name }}2Record` × `_create{{ pascal }}BaseDeps()` self-ref-dep branch /
`populate{{ pascal }}Dependencies()` self-ref branch / non-self-ref branch) — all five needed the
same one-line addition, since they're all instances of the same "findFirst declares the variable's
type, create() alone gets the include" bug.

Entities with a `dep.prisma_include_str`-less findFirst dep (the common case — `labelField: name` or
unset) render byte-identical output; the `{% if dep.prisma_include_str %}` guard is a no-op for them.

## Verification

- Reproduced first (before any fix) via an isolated `tsc --noEmit` pass scoped to the affected file
  (`tsconfig.json` extended with `include` overridden to just that file — `cypress/` is excluded from
  the main config, so `next build`/`npx tsc -p tsconfig.json` alone won't surface it).
- Confirmed the same errors, same two file:line locations, before and after toggling
  `goods_receipt_line.x-generate.edit`/`delete` (unrelated to the schema fields the composite
  labelField reads) — ruling out other unrelated changes as the cause.
- Deviation-injection: reverted the template to HEAD, regenerated, confirmed the exact same 4 errors
  reappear at the exact same lines; re-applied the fix, regenerated, confirmed zero errors.
- Full proj_g `test:e2e:build` (next build) and `test:e2e:cy:api` (30 specs / 616 tests) both pass,
  0 failures, 0 skips, post-fix, in an isolated worktree + dedicated docker-compose stack.
- Blast radius: an isolated `tsc --noEmit` pass over proj_g's entire `cypress/support/**/*.ts` (all 5
  composite-labelField occurrences in the schema: `purchase_order_line`/`asn_line` deps of
  `goods_receipt_line`, `purchase_order_line`'s own dep of `asn_line`, and `inventory`'s dep in
  `goods_receipt_line`) — zero errors of this class remain. Two unrelated, pre-existing errors
  (`approval_test_helpers.ts` possibly-null, `commands.ts` duplicate `Chainable` type param) are in
  hand-written/static files untouched by `generate-code`, out of scope.
- proj_c (the other current consumer) has one composite-labelField occurrence
  (`labelField: [entity_name, approver_role.name]`) — same latent bug class, currently dormant there
  too; not exercised by this fix since proj_c's generator submodule pointer hasn't bumped to include
  it yet.
- New regression test (`code_generator/tests/test_composite_labelfield_helper_findfirst_include.py`):
  renders the actual `test_helper.ts.jinja2` against a minimal `product`/`inventory`/
  `inventory_movement` fixture reproducing both preconditions (lookup-keyed dep + composite-labelField
  include), and asserts the `findFirst()` and `create()` calls carry matching `include` blocks.
  Verified red (fails with the exact assertion message) against the un-fixed template, green with it.
- Full `code_generator` pytest suite: 1130 passed (+2 new), 0 regressions. The only failures are 3
  pre-existing, environment-gated tests that refuse to run inside a submodule mount with a sibling
  `prj/` directory (unrelated to this change, self-explanatory refusal message).
