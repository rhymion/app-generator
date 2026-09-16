# Many-to-Many Relationship Implementation

## Overview
The code generation script has been updated to automatically handle many-to-many relationships when defined in the JSON schema using `x-relationships`.

## Schema Configuration

Add `x-relationships` directly on the entity, in the current **single-file entity
format** (no separate `_detail` definition, no `allOf` wrapper — see
`docs/knowledge/schema-yaml-configuration.md` §2). The base+`_detail`/`allOf` split
shown in earlier versions of this doc is legacy: `code_generator/json_schema.yaml`
has zero `_detail`-suffixed entities today (`grep -c "_detail:" code_generator/json_schema.yaml`
→ 0) and the generator's own build tooling no longer produces that shape.

This repo's own dogfood schema declares exactly this pattern on `user` (`roles` is
a real many-to-many relationship to `role`, `code_generator/json_schema.yaml`
around line 112):

```yaml
user:
  x-generate:
    # ...
    fields:
      - name
      - image_id
      - roles
  x-relationships:
    roles:
      type: many-to-many
      target: role
  fields:
    name: {}
    # ...
```

`x-outputType: list` is not needed on the `roles` property to get many-to-many
handling — `x-relationships.<prop>.type: many-to-many` alone drives it
(`code_generator/build_context.py`'s `_build_child_data()`, `is_many_to_many = relationship.get('type') == 'many-to-many'`).

## Generated Code

### 1. Types (`lib/{entity}/types.ts`)
- FormUpsertProps does **not** carry a full `allTarget?: Target[]` list. Instead it
  carries an initial page plus a search callback (`code_generator/templates/types.ts.jinja2`,
  the `{% for target in all_option_targets %}` loop):
  ```typescript
  export type FormUpsertProps = Readonly<FormViewProps & {
    isEdit: boolean;
    initialRoles?: Role[] & { permissionDenied?: boolean };
    initialRolesPermissionDenied?: boolean;
    searchRoleOptions?: (query: string, includeIds: string[], limit?: number, context?: { callerEntity?: string; formValues?: Record<string, unknown> }) => Promise<Role[] & { permissionDenied?: boolean }>;
  }>;
  ```
  This is a search-as-you-type autocomplete contract, not an upfront full-list fetch.

### 2. Actions (`lib/{entity}/actions.ts`)
- Uses `connect` for create operations
- Uses `set` for update operations
- Extracts IDs from FormData
  
  ```typescript
  async function addUserAccount(..., roleIds: string[]) {
    await prisma.user_account.create({
      data: {
        ...,
        roles: {
          connect: roleIds.map((id) => ({ id })),
        },
      },
    });
  }

  async function updateUserAccount(..., roleIds: string[]) {
    await prisma.user_account.update({
      where: { id },
      data: {
        ...,
        roles: {
          set: roleIds.map((id) => ({ id })),
        },
      },
    });
  }
  ```

### 3. FormUpsert Component (`components/{entity}/FormUpsert.tsx`, rendered inside
   `FormWithChildGrid`'s `formFields`)
- Still uses `EditableListWrapper` with `itemType="autocomplete"` — that part of
  this doc held up. But the JSX is assembled dynamically in Python
  (`code_generator/generators.py`'s `child_grid_components_parts` /
  `_ch_m2m_jsx`, ~line 6071) and passed through the template as the opaque
  `child_grid_components` placeholder — it will not show up by grepping
  `form_upsert.tsx.jinja2` directly for `EditableListWrapper`.
- No `useMemo`/`useState`-based client-side filtering against a full target list,
  and no `autocompleteOptions`/`onItemsChange` props. The actual props are an
  async `searchOptions` callback (calls the search server action passed down as
  `search{Target}Options`), `initialAutocompleteOptions` (seeded from the page's
  initial 50-row search, not a full list), and `excludeOptionIds`:
  ```tsx
  <EditableListWrapper
    ref={rolesRef}
    initialItems={localInitialRoles}
    itemType="autocomplete"
    addButtonLabel="Add Role"
    showTitle={true}
    title={tf('roles')}
    textFieldLabel="Name"
    textFieldPlaceholder="Enter name"
    searchOptions={async (query, includeIds) => {
      const rows = (await searchRoleOptions?.(query, includeIds)) ?? [];
      return rows.map(item => ({ id: item.id, label: item.name }));
    }}
    initialAutocompleteOptions={(initialRoles ?? []).map(item => ({
      id: item.id,
      label: item.name,
    }))}
    excludeOptionIds={[src.id]}
  />
  ```

### 4. New Page (`app/[locale]/{entity}/new/page.tsx`, `code_generator/templates/page_new.tsx.jinja2`)
- Does **not** fetch the full target list. It fetches only an initial page (50
  rows) via the search action, in parallel with other selector targets:
  ```tsx
  export default async function AddUserAccountPage() {
    const [userPermissions, initialRoles] = await Promise.all([
      /* ... */
      searchRoleOptions('', [], 50),
    ]);
    const src = { ..., roles: [] };
    return <FormUpsert src={src} isEdit={false} permissions={userPermissions}
      initialRoles={initialRoles} initialRolesPermissionDenied={Boolean((initialRoles as { permissionDenied?: boolean } | undefined)?.permissionDenied)}
      searchRoleOptions={searchRoleOptions} />;
  }
  ```

### 5. Edit Page (`app/[locale]/{entity}/edit/[id]/page.tsx`, `code_generator/templates/page_edit.tsx.jinja2`)
- Still uses `Promise.all` for parallel fetching (this part held up), but fetches
  entity detail plus an initial page of the target search, not the full target list:
  ```tsx
  export default async function EditUserAccountPage({ params }: UserAccountDetailPageProps) {
    const { id } = await params;
    const [detail, initialRoles] = await Promise.all([
      getUserAccountDetail(id),
      searchRoleOptions('', [], 50),
    ]);
    return <FormUpsert src={detail.user_account} isEdit={true} permissions={detail.userPermissions}
      initialRoles={initialRoles} initialRolesPermissionDenied={Boolean((initialRoles as { permissionDenied?: boolean } | undefined)?.permissionDenied)}
      searchRoleOptions={searchRoleOptions} />;
  }
  ```

## Key Features

1. **Automatic Detection**: Script automatically detects many-to-many relationships from `x-relationships`
2. **Bidirectional Support**: Both sides of the relationship are properly generated
3. **Efficient Queries**: Uses `Promise.all` for parallel fetching
4. **Smart Autocomplete**: Filters out already-assigned items from autocomplete options
5. **Prisma Best Practices**: Uses `connect` and `set` operations instead of nested creates

## Example Entities

The implementation works for both sides of the relationship:
- `user_account` ↔ `role`
- Generated code for both entities handles the many-to-many relationship correctly

## Testing

All generated files have been validated:
- ✅ No TypeScript errors
- ✅ Proper type safety with FormUpsertProps
- ✅ Correct Prisma operations (connect/set)
- ✅ Autocomplete filtering logic
- ✅ Parallel data fetching with Promise.all
