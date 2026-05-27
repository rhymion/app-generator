# Many-to-Many Relationship Implementation

## Overview
The code generation script has been updated to automatically handle many-to-many relationships when defined in the JSON schema using `x-relationships`.

## Schema Configuration

Add `x-relationships` to the detail definition:

```yaml
user_account_detail:
  x-relationships:
    roles:
      type: many-to-many
      target: role
  allOf:
    - $ref: "#/definitions/user_account"
    - type: object
      properties:
        roles:
          type: array
          x-outputType: list
          items:
            $ref: "#/definitions/role"
```

## Generated Code

### 1. Types (`lib/{entity}/types.ts`)
- FormUpsertProps includes `allTarget?: Target[]` parameter
  ```typescript
  export type FormUpsertProps = Readonly<FormViewProps & {
    isEdit: boolean;
    allRoles?: Role[];
  }>;
  ```

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

### 3. FormUpsert Component (`components/{entity}/FormUpsert.tsx`)
- Uses `EditableListWrapper` with `itemType="autocomplete"`
- Implements `useMemo` to filter already-assigned items
- Manages selected items with `useState`
  
  ```tsx
  const [selectedRoles, setSelectedRoles] = useState<EditableListWrapperItem[]>(initialRole);
  
  const autocompleteOptionsRole = useMemo(() => {
    const assignedRoleIds = new Set(
      selectedRoles
        .map((role) => role.originalId ?? role.value)
        .filter((roleId): roleId is string => typeof roleId === 'string')
    );
    return allRoles
      .filter((role) => !assignedRoleIds.has(role.id))
      .map((role) => ({
        id: role.id,
        label: role.name,
        value: role.name,
      }));
  }, [allRoles, selectedRoles]);

  <EditableListWrapper
    ref={roleRef}
    initialItems={initialRole}
    itemType="autocomplete"
    autocompleteOptions={autocompleteOptionsRole}
    onItemsChange={setSelectedRoles}
  />
  ```

### 4. New Page (`app/{entity}/new/page.tsx`)
- Fetches all available target entities
- Passes them to FormUpsert
  
  ```tsx
  export default async function AddUserAccountPage() {
    const allRoles = await getAllRoles();
    const src = { ..., roles: [] };
    return <FormUpsert src={src} isEdit={false} allRoles={allRoles} />;
  }
  ```

### 5. Edit Page (`app/{entity}/edit/[id]/page.tsx`)
- Uses `Promise.all` for parallel fetching
- Fetches entity detail and all available target entities
  
  ```tsx
  export default async function EditUserAccountPage({ params }: UserAccountDetailPageProps) {
    const { id } = await params;
    const [user_account, allRoles] = await Promise.all([
      getUserAccountDetail(id),
      getAllRoles(),
    ]);
    return <FormUpsert src={user_account} isEdit={true} allRoles={allRoles} />;
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
