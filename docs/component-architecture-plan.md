# Component Architecture Plan

## Purpose

This plan separates generated UI structure from design implementation. Generated
files should import stable application wrapper components instead of importing
MUI components or rendering layout HTML directly. A user should be able to
change the app design by editing wrapper components, without touching the
Python/Jinja2 generator.

The recommended direction is a hybrid wrapper architecture:

- semantic wrappers for generated screen patterns (`AppFormShell`,
  `AppDetailHeader`, `AppListToolbar`, `AppFieldText`, `AppBooleanField`,
  `AppRelationLink`, `AppSection`);
- thin primitive wrappers only where generated templates still need a simple
  reusable primitive (`AppButton`, `AppIconButton`, `AppLink`, `AppText`,
  `AppBox`);
- keep MUI and MUI X behind the wrapper layer, except for type-only DataGrid
  contracts during the first migration.

## 1. Current Inventory

### Direct MUI Imports in Jinja2 Templates

| Template | Direct imports |
|---|---|
| `code_generator/templates/column_def.tsx.jinja2` | `GridColDef`, `GridRenderEditCellParams` from `@mui/x-data-grid` |
| `code_generator/templates/form_upsert.tsx.jinja2` | `TextField`, `Autocomplete`, `Box`, `IconButton`, `Tooltip`, `Link`, `FormControlLabel`, `Checkbox`, `Accordion`, `AccordionSummary`, `AccordionDetails`, `Typography`; icons: `OpenInNewIcon`, `ExpandMoreIcon` |
| `code_generator/templates/form_view.tsx.jinja2` | `GridColDef`, `IconButton`, `Tooltip`, `TextField`, `Link`, `InputAdornment`, `FormControlLabel`, `Checkbox`, `Accordion`, `AccordionSummary`, `AccordionDetails`, `Typography`; icons: `EditIcon`, `ArrowBackIcon`, `OpenInNewIcon`, `ExpandMoreIcon` |
| `code_generator/templates/page_list.tsx.jinja2` | `Link`, `Button`, `Box`; icon: `BarChartIcon` |

No direct MUI import was found in `page_new.tsx.jinja2`, `page_edit.tsx.jinja2`,
`page_view.tsx.jinja2`, or `page_chart.tsx.jinja2`.

### Raw HTML Tags in Jinja2 Templates

| Template | Raw tags found | Current use |
|---|---|---|
| `form_upsert.tsx.jinja2` | `p` | validation error text |
| `form_view.tsx.jinja2` | `div`, `h1` | detail page layout, action header |
| `page_list.tsx.jinja2` | `h1` | list page title |

No direct `form`, `input`, `button`, `table`, `tr`, `td`, `th`, or `span` tags
were found in the TSX Jinja2 templates checked.

### Generated and Standard Component Surface

Generated `components/{entity}/FormUpsert.tsx`, `FormView.tsx`, and
`column_def.tsx` currently inherit the imports above. Generated list pages under
`app/[locale]/{entity}/page.tsx` also inherit the list toolbar imports when the
entity has a chart or custom list component.

`components/_standard/*` already centralizes much of the UI, but it still imports
MUI directly. That is acceptable for the first migration if `_standard` is
treated as implementation detail. A later migration can move `_standard` itself
onto the same wrapper layer.

Handwritten screens such as login, register, settings, account management, MFA,
and the app provider also import MUI directly. They are outside the generated
template scope and should be migrated after generated CRUD screens are stable.

## 2. Wrapper Layer Design

### Recommended Granularity

Use a hybrid model.

| Option | Verdict | Reason |
|---|---|---|
| Pure 1:1 wrappers (`AppButton` for MUI `Button`, etc.) | Not enough alone | It hides imports but preserves MUI-shaped generated code and does not give users a clean design surface. |
| Pure semantic wrappers (`AppForm`, `AppDataTable`, etc.) | Too risky for one step | It requires broad template rewrites and changes many behavior contracts at once. |
| Hybrid wrappers | Recommended | It removes MUI imports from generated templates while keeping migration small and preserving current behavior. |

Semantic wrappers should be preferred wherever the generator is expressing app
intent, not MUI mechanics:

- `AppFormShell`: form title, submit/delete/back controls, error slot, children.
- `AppDetailShell`: detail layout with header actions and content.
- `AppDetailHeader`: title plus edit/back actions.
- `AppListHeader` or `AppListToolbar`: list title, chart button, entity custom
  list components.
- `AppFieldText`: text field, read-only field, helper/error display.
- `AppFieldBoolean`: checkbox and label.
- `AppFieldRelation`: relation autocomplete and relation link.
- `AppSection`: accordion/section wrapper for flattened relation groups.
- `AppValidationError`: validation error presentation.

Thin primitive wrappers are allowed for common low-level controls that appear in
many semantic wrappers:

- `AppButton`
- `AppIconButton`
- `AppLink`
- `AppText`
- `AppBox`
- `AppTooltip`

### Naming Convention

Use `App*` names for public design wrappers. This keeps generated imports
distinct from MUI and existing `_standard` components.

| Type | Path | Example |
|---|---|---|
| Primitive wrapper | `components/ui/primitives/{name}.tsx` | `components/ui/primitives/AppButton.tsx` |
| Form and field wrapper | `components/ui/forms/{name}.tsx` | `components/ui/forms/AppFieldText.tsx` |
| Layout wrapper | `components/ui/layout/{name}.tsx` | `components/ui/layout/AppDetailHeader.tsx` |
| Data wrapper | `components/ui/data/{name}.tsx` | `components/ui/data/AppDataGridTypes.ts` |
| Barrel exports | `components/ui/index.ts` | `import { AppFieldText } from '@/components/ui'` |

Generated files should import from `@/components/ui` only. They should not import
from `@mui/*` after the generated-template migration is complete.

### Props Policy

Use constrained application props, not full MUI pass-through props, for generated
templates.

Recommended rules:

- support explicit app-level props such as `label`, `value`, `onChange`,
  `error`, `helperText`, `disabled`, `required`, `href`, `children`, `variant`;
- expose `slotProps` only where a wrapper must support controlled escape hatches;
- avoid `sx` in generated code after migration;
- do not export raw MUI component prop types from generated files;
- keep event and form contracts React-native (`onChange`, `onSubmit`) so wrappers
  can later move away from MUI.

This makes wrappers editable by app users while keeping the generated surface
stable.

### Theme and Styling

Keep `ThemeProvider` and `CssBaseline` in the app provider for now. The wrapper
layer should own visual defaults with MUI theme support underneath:

- global tokens: MUI theme in `app/[locale]/providers.tsx` remains the baseline;
- component-level defaults: wrappers set variants, spacing, density, and
  accessibility attributes;
- generated templates pass intent, not style (`variant="primary"` is acceptable;
  `sx={{ mx: 1 }}` is not);
- app users customize either wrapper files or the app theme, not Jinja2 templates.

## 3. Wrapper Generation Policy

**Decision (2026-06-05)**: write-once generation (`virtual_resolvers.ts` pattern) is **NOT adopted**.
`components/ui/**` is provided as static files in the repository, the same way as `components/_standard/**`.
The generator does not write to `components/ui/**` at all — it treats them as pre-existing application code.

Rationale:

- `_standard` already proves the pattern: static wrapper files live in the repo,
  generator templates import them, regeneration never touches them;
- eliminates bootstrap complexity and stub-overwrite race conditions in `generate.py`;
- clean project setup is handled by the starter repo including `components/ui` directly;
- wrapper files are fully user-owned from day one without any opt-in.

Approved decisions:

- `components/ui/**` are static repo files (Approved — Modified from write-once generation)
- unconditional wrapper output in generated templates (Approved)
- type-only MUI X dependency in `column_def.tsx` for Phase 1-4 (Approved)
- first implementation scope = `page_list.tsx.jinja2` only (Approved)

## 4. Generator Refactor Policy

### Import Replacement

First migration target: generated templates only.

| Current template | Replacement direction |
|---|---|
| `form_upsert.tsx.jinja2` | Replace `TextField`, `Checkbox`, `FormControlLabel`, `Autocomplete`, relation link controls, accordion controls, and validation `<p>` with form/field wrappers. |
| `form_view.tsx.jinja2` | Replace raw `div`/`h1`, edit/back action buttons, relation links, read-only fields, checkbox view fields, and accordion sections with detail/layout wrappers. |
| `page_list.tsx.jinja2` | Replace raw `h1`, `Box`, chart `Button`, `Link`, and `BarChartIcon` usage with `AppListHeader`/`AppListToolbar`. |
| `column_def.tsx.jinja2` | Keep type-only DataGrid imports initially, then move column helper types behind `components/ui/data` if feasible. |

Do not start by rewriting `_standard` components. Generated templates already
delegate table/card/list/form shell behavior to `_standard` in several places.
The first objective is that generated entity files no longer import MUI directly.

### Wrapper Files

`components/ui/**` files are static repository files (same as `components/_standard/**`).
The generator does not write to `components/ui/**` at any point.

For Phase 1, only `AppListToolbar` is required by `page_list.tsx.jinja2`.
Add further wrappers as static files when later phases begin.

### Migration Mode

Use staged migration, not one large rewrite.

Reasons:

- `FormUpsert` and `FormView` are high-risk templates because they encode
  relations, custom components, validation, audit info, comments, and flattened
  sections;
- DataGrid types and cell editors have behavior contracts that should not be
  changed at the same time as visual wrappers;
- staged migration gives build and generated-code tests smaller failure domains.

## 5. Backward Compatibility and Regeneration

### Regenerate Behavior

After migration, `npm run generate-code` should:

- never touch `components/ui/**` (static files owned by the repo, not the generator);
- regenerate entity files to import wrappers from `@/components/ui`;
- preserve existing custom extension points:
  - `components/{entity}/{prop}.tsx`
  - `components/{entity}/{ComponentName}.tsx`
  - `components/{entity}/form_validation.ts`
  - `lib/{entity}/service_validation.ts`
  - `lib/{entity}/service_after_create.ts`
  - `lib/{entity}/virtual_resolvers.ts`

### Existing Custom Files

Do not move or rename existing custom files as part of the first implementation.
Generated templates should continue to render entity-level and property-level
custom components through the current schema options.

### Opt-In Compatibility Switch

**Approved (2026-06-05)**: Wrapper mode is unconditional — no schema gate needed.

Generated templates always use wrapper components. Wrapper files are already in
`components/ui/` as static repo files.

Reasoning:

- the current generated output is not a public runtime protocol like
  `x-analytics`; it is implementation output of the generator;
- maintaining both MUI-direct and wrapper modes doubles template complexity;
- static ui wrappers give users a stable customization point, so unconditional
  wrapper output better serves the north star.

Fallback option: add a generator-level compatibility switch such as
`x-ui.wrapper_components: true`. This lowers rollout risk but creates long-term
dual-path maintenance. Use this only if the first implementation must coexist
with legacy projects that cannot accept new `components/ui` files.

## 6. Phased Implementation Plan

### Phase 1: components/ui Static Files and List Header

Scope:

- `components/ui/**` files are already provided as static repo files (generator never creates or overwrites them);
- migrate `page_list.tsx.jinja2` chart/custom-component toolbar and raw `h1`;
- do not touch `FormUpsert`, `FormView`, or `column_def`.

Validation gates:

- `npm run generate-code`
- `npm run build`
- `cd code_generator && python3 -m pytest --tb=short -q`
- API E2E if generated app behavior changes beyond visual imports.

Why this first: list page has the smallest wrapper surface (`h1`, `Box`,
`Button`, `Link`, chart icon) and provides a low-risk proof of the import
replacement pattern.

### Phase 2: FormUpsert Fields and Validation Error

Scope:

- migrate `TextField` and boolean checkbox rendering to `AppFieldText` and
  `AppFieldBoolean`;
- migrate validation `<p>` to `AppValidationError`;
- keep relation autocomplete and flattened accordions unchanged until Phase 3.

Validation gates:

- `npm run generate-code`
- `npm run build`
- `cd code_generator && python3 -m pytest --tb=short -q`
- targeted Cypress UI smoke for new/edit forms if available.

### Phase 3: Relations, Links, and Sections

Scope:

- migrate relation links, relation autocomplete wrappers, `Tooltip`,
  `IconButton`, `Link`, `OpenInNewIcon`;
- migrate flattened `Accordion` sections to `AppSection`;
- preserve property-level custom component behavior.

Validation gates:

- `npm run generate-code`
- `npm run build`
- code generator pytest
- API E2E plus one UI E2E pass for relation-heavy entities.

### Phase 4: FormView Detail Shell

Scope:

- replace raw `div`/`h1` layout with `AppDetailShell` and `AppDetailHeader`;
- migrate edit/back actions to wrapper actions;
- migrate read-only fields and boolean display.

Validation gates:

- `npm run generate-code`
- `npm run build`
- code generator pytest
- UI E2E for list -> view -> edit -> back navigation.

### Phase 5: DataGrid and Standard Components

Scope:

- decide whether `GridColDef` remains as a type-level dependency or moves behind
  `components/ui/data`;
- migrate `_standard` components to wrapper primitives where valuable;
- include handwritten auth/settings screens only after generated CRUD is stable.

Validation gates:

- full build
- code generator pytest
- API E2E
- broad UI E2E, especially table/card responsive list behavior.

## 7. First Implementation Command

Recommended smallest implementation command:

> Migrate `page_list.tsx.jinja2` to use `AppListToolbar`/`AppText`/`AppButton` wrappers.
> (`components/ui/**` are static repo files — generator never creates or overwrites them.)
> No `FormUpsert`, `FormView`, or DataGrid changes.

Acceptance criteria for that command:

- generated list pages have no direct `@mui/*` imports;
- `components/ui/**` files are static repo files (generator never creates or overwrites them);
- existing custom list components still render;
- chart button behavior is unchanged;
- `generate-code`, `build`, and code generator pytest pass with SKIP=0.

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Wrapper APIs become too MUI-shaped | Users still need MUI knowledge to customize design | Prefer semantic props and keep pass-through escape hatches rare. |
| One large migration breaks generated forms | High regression risk | Stage list, simple fields, relations, detail shell, and DataGrid separately. |
| Wrapper API drift from generated expectations | Build errors after wrapper customization | Keep wrapper APIs small, add generated output tests, document public props. |
| DataGrid types keep MUI visible | Full MUI isolation is delayed | Accept type-only dependency initially, then add `components/ui/data` after CRUD wrappers stabilize. |
| Handwritten screens remain MUI-direct | Design customization is incomplete | Treat handwritten screens as Phase 5+ after generated CRUD is isolated. |

## 9. Decisions (Resolved 2026-06-05)

**Approved**: Use unconditional wrapper output (wrapper files are already in `components/ui/`).

**Approved (Modified)**: `components/ui/**` provided as static repo files (same as `_standard`),
NOT generated write-once files. See Section 3 for rationale.

**Approved**: Accept a temporary type-only MUI X dependency in `column_def.tsx` for Phase 1-4.

**Approved**: Limit the first implementation command to `page_list.tsx.jinja2` only.

