# Proxy view sidebar nav + permission scope (cmd_813)

A proxy view is an entity whose `parent` (its own view/route name, e.g.
`setting1`) differs from its `model` (the underlying Prisma model it
proxies, e.g. `xxxxx_xxxxx`) -- declared as a pass-through `allOf` wrapper
in the user schema (see `build_user_schema.py`'s module docstring,
"Anything else ... is a pass-through"). `setting` (proxies `user`) is the
framework's own example; a consumer schema can declare more (a demo
fixture like `setting1`/`setting2` sharing one model is the motivating
case here).

Before cmd_813, three things were gated on `parent == model`, which is
false for every proxy view, entity name notwithstanding -- none of these
gates check *which* proxy view, they blanket-exclude the whole category:

## 1. Sidebar nav (`generators_i18n.py`)

`nav_entities` used to require `parent == model`. A proxy view with
`x-generate.list: true` still got a working list page, API route,
getters, and search (`extract_entities()`'s output is never gated this
way) -- only the sidebar link, `@sidebar/page.tsx`'s href to i18n-key map,
and the `messages/*.json` `Nav` section entry were missing. Fixed: the
gate is now just `generate_config.list`. A proxy view that should stay
hidden (the framework's own `setting`) opts out via its own
`x-generate.list: false` -- the exception lives on the declaring side,
not baked into the generator by entity name.

`cleanup.py`'s own `_clean_appended_files` (line ~624) intentionally
keeps its OWN, narrower `parent == model` mirror of this predicate -- do
not "fix" it to match. `cleanup.py`'s `_clean_site_config` /
`_clean_sidebar` delete every href in their **current** nav-entities
computation from the appended files (it is a revert-to-baseline tool for
the generate -> cleanup -> generate roundtrip test, not a stale-entry
pruner -- see its own module docstring). Measured empirically for this
change (not inferred from reading the code -- see cmd_812's own
self-correction on exactly this point): a proxy view's sidebar entry,
once added by `generate.py`, **survives** a `cleanup.py` run intact,
because cleanup's narrower predicate never selects it for removal. If a
future change ever makes proxy-view nav entries *disappear* after a
`generate -> cleanup` cycle (the fix going hollow), align
`cleanup.py:624`'s predicate then -- not before, and not on inference
alone.

## 2. `x-nav` group/order resolution (`nav_config.py`)

`build_nav_config()`'s `entity_group` dict used to key on
`entity['model']` -- so every proxy view sharing one model was forced
into whichever one's `x-nav` happened to resolve last (harmless when no
proxy view declared `x-nav` at all, since `entity_group.get(...)`
returned `None` uniformly, but wrong the moment two proxy views sharing a
model wanted independent placement). Fixed: `entity_group` is now keyed
on `entity['parent']` (the view/route name), so `setting1` and `setting2`
can sit in different groups/orders independently even though both share
model `xxxxx_xxxxx`.

`_entity_nav()` resolves `x-nav` at the VIEW unit first -- a proxy view's
own (pass-through, never raw/view-split) definitions entry, e.g.
`definitions.setting1.x-nav` -- falling back to the raw model's `x-nav`
(`_raw_def()`, cmd_744) only when the view declares none of its own. Do
not drop the raw-model fallback: it is what makes `x-nav` resolve at all
for the common (non-proxy) paired-entity case, where `x-nav` lives on the
raw `__`-prefixed entity, never the view.

## 3. `grant-all-permissions` seed scope (`generators.py`'s `seed_entities_context()`)

Used to require a definitions entry to carry a direct `id` property --
which structurally excludes every proxy view (they're an `allOf`
wrapper, never own `id` directly), `setting` included. That's the wrong
axis: `requirePermission()` (`lib/authz.ts`, called from
`actions.ts.jinja2`) is keyed to each entity's own `parent`/route name,
not the underlying Prisma model, so a proxy view needs its **own**
grant-all-permissions entry -- granting only the shared model leaves
every proxy view's own route ungranted.

Fixed: a proxy view (`allOf`-wrapper, no direct `id`) is now included
too, UNLESS it declares `x-self-only: {admin_bypass: true}` -- the
actual, schema-driven reason `setting` alone should stay excluded (an
Administrator already reaches it via `trySelfOnlyAdminBypass()`, so a
redundant grant is unnecessary). A proxy view with no such declaration
(`setting1`-`setting8` in the proj_c demo fixtures) is no longer excluded
by name or by accident of structure -- only entities that actually opt
into `x-self-only` admin_bypass are.
