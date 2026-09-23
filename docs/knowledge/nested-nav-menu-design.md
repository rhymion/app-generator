# Nested Sidebar Navigation (`x-nav` / `x-nav-groups`)

Generated apps render their sidebar as a flat list of entity links by
default. This feature lets a schema group related entities under a
collapsible heading, and lets those headings themselves nest into a
multi-level tree. It is entirely additive: a schema that declares neither
`x-nav` nor `x-nav-groups` produces zero groups, and every entity keeps its
existing flat, top-level link — see [§9](#9-golden-diff-zero).

Implementation: `code_generator/nav_config.py` (schema parsing, validation,
group-list construction), `code_generator/generators_i18n.py` (writes the
result into `lib/site-config.ts`, `app/[locale]/@sidebar/page.tsx`, and
`messages/*.json`), `code_generator/cleanup.py` (reverses those writes),
`lib/nav-tree.ts` (runtime tree-building), and
`components/_standard/NavGroupWrapper.tsx` (the rendered, collapsible
group).

## Design decisions (D1–D11)

- **D1.** Two independent schema surfaces. Entity-side `x-nav: {parent,
  order}` declares "this entity belongs to group `parent`, at position
  `order`." Top-level `x-nav-groups: {<slug>: {parent, order, icon}}`
  declares metadata for a group and, via its own `parent`, nests one
  group under another. A group referenced only through an entity's
  `x-nav.parent` needs no companion `x-nav-groups` entry at all — see
  [§3](#3-group-construction).
- **D2.** All validation is fail-closed at code-generation time
  (`NavValidationError`), not silently ignored or defaulted away: a
  malformed `x-nav-groups`, a cycle, an excess-depth chain, an unknown
  parent slug, or an unrecognized icon name aborts generation.
- **D3.** Cycle and depth checks run only over `x-nav-groups`' own
  `parent` edges, via DFS, with a fixed `MAX_NAV_DEPTH = 8`. A group that
  exists purely because an entity references it (no `x-nav-groups` entry
  of its own) has no `parent` and is always depth 1 (top-level) — it is
  outside this check's scope.
- **D4.** Group order resolves in this precedence: an explicit
  `x-nav-groups.<slug>.order` wins; otherwise the minimum of that group's
  child entities' `x-nav.order` values; otherwise a shared default of
  `999` (the same default used for an entity with no explicit order).
- **D5.** A group's label is derived purely from its slug (snake_case →
  Title Case), never a separate schema field. The derived value seeds the
  translation file once; a human can freely edit it afterward without a
  schema change (see D6).
- **D6.** i18n writes are upsert-only: a key that already exists in
  `messages/*.json` is left untouched. Regeneration must never clobber a
  human translation.
- **D7.** An icon is referenced by name, validated at generation time
  against a fixed allowlist (`nav_config.NAV_ICON_ALLOWLIST`), and
  resolved at runtime through a parallel map
  (`NavGroupWrapper.ICON_MAP`). Generated code never imports
  `@mui/icons-material` directly (the `components/_standard/` wrapper
  convention) — the two lists are kept in sync by hand, not by a shared
  source.
- **D8.** An entity's `x-nav` is resolved at the *view* unit first
  (`definition_key`/`model`), falling back to the raw model's `x-nav`
  only when the view declares none of its own. Two proxy views sharing
  one model can therefore sit in independent groups.
- **D9.** "Which entities appear in the sidebar nav" is one predicate
  (`nav_config.nav_list_entities`) shared by the generate side
  (`generators_i18n.py`) and the cleanup side (`cleanup.py`), rather than
  two independently maintained copies of the same filter — a prior
  regression showed that two copies drift apart, so cleanup silently
  stops retracting a nav entry generate is still adding (e.g. for a proxy
  view) the moment one side's filter is loosened and the other is not.
- **D10.** Every appended-file write (`lib/site-config.ts`, the
  sidebar's `navTranslationKeys` map, `messages/*.json` `Nav.groups`) is
  append/upsert-only and idempotent: `generate → cleanup → generate` must
  reproduce byte-for-byte identical output, and cleanup must restore the
  exact pre-generate baseline.
- **D11.** The feature is golden-diff-zero: the default schema declares
  no `x-nav`/`x-nav-groups` anywhere, so it produces no groups and no
  behavior change from before this feature existed. At render time, a
  group with no visible descendant link (recursively) is omitted rather
  than shown as an empty heading.

## 1. Overview

`build_nav_config(entities, schema)` (`code_generator/nav_config.py`) is
the single entry point: it reads every entity's `x-nav` plus the
top-level `x-nav-groups`, validates them, and returns

```python
{
  'groups': [
      {'slug', 'label', 'i18n_key', 'order', 'icon', 'parent'}, ...
  ],
  'entity_group': {parent_name: {'group': slug, 'order': int}},
}
```

`groups` is sorted by `(order, slug)`. `entity_group` is keyed by
`entity['parent']` — the view/route name, not `entity['model']` (D8) —
so two proxy views sharing one model can sit in different groups
independently.

## 2. Schema: `x-nav` and `x-nav-groups`

```yaml
definitions:
  inventory_reservation:
    x-nav:
      parent: inventory_group   # required to join a group
      order: 2                  # optional, defaults to 999
x-nav-groups:                   # optional; only required for group-to-group nesting
  logistics_group:
    order: 5
  inventory_group:
    parent: logistics_group     # nests inventory_group under logistics_group
    icon: Inventory2
```

`x-nav-groups` is additive: a group referenced only via `x-nav.parent`
(no icon, no nesting) needs no entry here at all — see
[§3](#3-group-construction). `x-nav-groups` is validated as a mapping of
slug → config; anything else raises `NavValidationError`.

Fail-closed validation performed here (D2/D3):

- **Cycle detection.** A `parent` chain that loops back on itself (direct
  self-reference or a longer cycle) raises `nav group cycle detected:
  <chain>`.
- **Max depth.** A `parent` chain longer than `MAX_NAV_DEPTH` (8) raises
  `nav group depth exceeds maximum (8): path: <chain> (depth <n>)`. A
  chain of exactly 8 groups is allowed.
- **Unknown parent slug.** `x-nav-groups.<slug>.parent` (or an entity's
  `x-nav.parent` chain feeding into it) referencing a slug not defined in
  `x-nav-groups` and not otherwise referenced raises `nav group '<slug>'
  declares parent '<parent>', which is not defined in x-nav-groups`.

## 3. Group construction

For every entity with an `x-nav.parent`, `build_nav_config` records
`entity_group[entity['parent']] = {'group': parent_slug, 'order': order}`
and adds `parent_slug` to the working set of groups — with no
`x-nav-groups` entry required (D1). The full group set is the union of
`x-nav-groups`' own keys and every slug referenced by an entity.

For each group in that set:

- **`label`** — `derive_group_label(slug)` (§5.1).
- **`i18n_key`** — `group_i18n_key(slug)`, i.e. `f'nav.groups.{slug}'`.
  This value is informational (used only by `nav_config`'s own tests);
  the string actually written into `lib/site-config.ts`'s `labelKey`
  field, and read back by the sidebar, is the shorter `groups.<slug>`
  (relative to the `Nav` `useTranslations` namespace) computed directly
  in `generators_i18n._update_site_config` — see §5.2 and §7.1.
- **`order`** — explicit `x-nav-groups.<slug>.order`, else the minimum of
  that group's child entities' orders, else `999` (D4).
- **`icon`** — `x-nav-groups.<slug>.icon`, validated against
  `NAV_ICON_ALLOWLIST` (§6).
- **`parent`** — `x-nav-groups.<slug>.parent`, or `None` for a top-level
  group.

**Typo-warning heuristic.** If a slug is referenced by exactly one entity
and has no `x-nav-groups` entry of its own, generation prints (not
raises) `WARNING: nav group '<slug>' is referenced by exactly one entity
and has no x-nav-groups entry -- check for a typo'd slug`. A slug
referenced by two or more entities, or declared in `x-nav-groups`, never
triggers this warning — the signal is specifically "this looks like an
unintentional one-off," not "this group has no metadata."

## 4. Entity → group resolution (view vs. raw model)

`_entity_nav(entity, schema)` resolves an entity's `x-nav` in this order
(D8):

1. The entity's own definitions key (`entity['definition_key']` or
   `entity['model']`) — this is the *view* unit. A proxy view (e.g. a
   demo fixture like `setting1`/`setting2` sharing one underlying model)
   can declare `x-nav` directly here, independent of any sibling view
   sharing the same model.
2. If the view declares no `x-nav` of its own, fall back to the raw
   model's `x-nav` (the `__`-prefixed entity `build_user_schema.py`'s
   Stage-4 raw/view split produces for a paired entity, e.g.
   `organization`).

A view-level declaration always wins over the raw-model fallback when
both are present. This fallback must resolve the raw entity via the same
key `build_context.py`'s own `_raw_def` uses — a naive
`entity['model'] != entity['parent']` gate silently skips the fallback
for the common case of a paired entity whose model equals its own
parent, dropping its `x-nav` entirely.

## 5. Labels and i18n

### 5.1 Label derivation

`derive_group_label(slug)` applies the same rule as
`helpers.naming.to_title_case`: split the slug on `_`, capitalize the
first letter of each word, join with a space.

```
inventory_group             -> Inventory Group
logistics                   -> Logistics
purchasing_and_procurement  -> Purchasing And Procurement
```

There is no separate schema field for a group's label — the slug is the
only input.

### 5.2 i18n upsert semantics

`upsert_nav_group_i18n(messages, key, derived_label)` writes
`messages['Nav']['groups'][key] = derived_label` **only if `key` is
absent**. If the key already exists, its current value is left untouched
and the function returns `False` — regeneration must never clobber a
human translation already sitting in `Nav.groups.<slug>` (D6).

`generators_i18n._update_nav_group_i18n_file` calls this once per group,
for every locale file in `messages/*.json`, and re-sorts
`Nav.groups` alphabetically (case-insensitive) whenever at least one key
was added — the same sort convention `_update_json` applies to the
file's other sections.

## 6. Icon allowlist

`x-nav-groups.<slug>.icon` is validated at generation time against
`nav_config.NAV_ICON_ALLOWLIST` (a fixed list of MUI icon names); any
other value raises `NavValidationError: Unknown nav icon '<icon>' in
group '<slug>'. Supported icons: <comma-separated list>`.

At runtime, `components/_standard/NavGroupWrapper.tsx` resolves the same
string through its own `ICON_MAP`, which imports each icon from
`@mui/icons-material` and keeps generated code from importing that
package directly (the `components/_standard/` wrapper-boundary
convention). `NAV_ICON_ALLOWLIST` and `ICON_MAP` are two independently
maintained lists that must be kept in sync by hand (D7) — there is no
shared source of truth enforcing this at generation time.

## 7. Generated artifacts and runtime rendering

### 7.1 Appended-file invariant

`lib/site-config.ts` declares two exported types nested navigation adds:

```ts
export type NavLink = {
  label: string;
  href: string;
  external?: boolean;
  group?: string;   // slug of the NavGroup this link is nested under; absent = top-level
  order?: number;    // sort position among siblings; only meaningful when group is set
};

export type NavGroup = {
  slug: string;
  labelKey: string;  // e.g. "groups.inventory_group" — resolved via useTranslations("Nav")
  order: number;
  icon?: string;
  parent?: string;   // slug of the parent group; absent = top-level group
};
```

`generators_i18n._update_site_config` appends one `NavLink` literal per
new nav entity (with `group`/`order` fields present only when that
entity resolved to a group) into the `navLinks` array, and one
`NavGroup` literal per new group into the `navGroups` array — both are
plain string-insertion before the array's closing `] satisfies ...[]`
marker, matched against hrefs/slugs already present in the file so a
re-run adds nothing already there.

`cleanup._clean_site_config` reverses this with the same href/slug list
the generate side used, via a regex anchored on the literal shape
generate produces (`{ label: "...", href: "<href>"[, group: "...", order:
N] },` for links; `{ slug: "<slug>", labelKey: "...", order: N[, icon:
"..."][, parent: "..."] },` for groups).

This round-trips exactly: `generate → cleanup → generate` reproduces
byte-for-byte identical `lib/site-config.ts`, and `cleanup` alone
restores the file to precisely its pre-generate baseline (D10) —
verified directly (not just visually) by
`code_generator/tests/test_nav_roundtrip.py`, including for a proxy
view's entry and for a nested (`x-nav-groups`-declared) group.
`cleanup._clean_appended_files` drives the *real* cleanup entry point
end-to-end (not a hand-rebuilt href list) using the same
`nav_config.nav_list_entities` predicate generate used to add the entry
(D9) — this is what makes a proxy view's nav entry actually retract, not
just an ordinary entity's.

### 7.2 Empty-group suppression

`lib/nav-tree.ts`'s `buildGroupChildren` and `buildRootTree` filter out
any group whose children array is empty **after** recursively building
its own children — so a group whose only descendants were themselves
suppressed (all empty) is itself suppressed, all the way up. A group is
never rendered as an empty, non-expandable heading (D11).

### 7.3 Auto-expand on the active path

`app/[locale]/@sidebar/page.tsx` passes
`defaultOpen={subtreeContainsPath(node.children, pathname)}` to
`NavGroupWrapper` for every group node — a group that contains the
current page anywhere in its subtree starts expanded; every other group
starts collapsed. `NavGroupWrapper` itself keeps a local `isOpen` state
after that (the initial expand is a one-time default, not a controlled
prop the parent keeps re-syncing).

### 7.4 `subtreeContainsPath`

`subtreeContainsPath(nodes, pathname)` recursively checks whether any
leaf link anywhere in `nodes` (including inside nested subgroups) has
`link.href === pathname`, powering §7.3's auto-expand. It is a pure
function over the already-built `TreeNode[]`, independent of routing —
`lib/nav-tree.ts` is kept free of `next-intl`/`next-auth` dependencies
specifically so it is unit-testable without mocking them.

## 8. Sidebar wiring

`app/[locale]/@sidebar/page.tsx` builds the render tree once per request
via `buildRootTree(visibleLinks, siteConfig.navGroups)` (`visibleLinks`
already excludes any `hiddenHrefs` the caller passed in) and walks it
with a small `NavTreeNode` component: a `{kind: 'link'}` node renders a
plain `<Link>`, a `{kind: 'group'}` node renders `NavGroupWrapper` with
its children recursively rendered inside.

A link's display label resolves through a separate, hand-maintained
`navTranslationKeys` map (`href → Nav translation key`) local to
`page.tsx` — `generators_i18n._update_sidebar` appends one entry per new
nav entity here too (`camelCase(entity.parent)`), inserted before the
`export default function Sidebar` line and reversible via
`cleanup._clean_sidebar`, matching the same href set `_update_site_config`
used. A group's label instead resolves directly from its own `labelKey`
field (§7.1) via `useTranslations("Nav")` — groups have no entry in
`navTranslationKeys`.

## 9. Golden-diff-zero

The default/dogfood schema (`code_generator/json_schema.yaml`) declares
no `x-nav` and no `x-nav-groups` anywhere. With no group declared,
`build_nav_config` returns `{'groups': [], 'entity_group': {}}` for every
entity, and every entity keeps its pre-feature, flat top-level
`NavLink` — no `group`/`order` field is added, no `NavGroup` entries
exist, and the sidebar renders exactly as it did before this feature
existed (D11). This is enforced as a standing precondition, not just
asserted once: `code_generator/tests/test_nav_config.py`'s paired-entity
regression test re-checks at import time that the live default schema
still declares no `x-nav` on `organization` before mutating a copy of it
to exercise the raw/view-split resolution path.
