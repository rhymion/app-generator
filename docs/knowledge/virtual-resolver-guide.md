# Virtual Column Resolver Guide

Virtual columns are fields declared in `x-display.table` that have no matching property in the schema.
Each entity with virtual columns gets a single resolver stub generated once by `generate-code`.

## 配置

`lib/{entity}/virtual_resolvers.ts`

Example: `lib/user/virtual_resolvers.ts`

## Signature

```typescript
export async function resolveVirtualColumns(
  rows: ReadonlyArray<Record<string, unknown>>
): Promise<Map<string, Record<string, string>>>
```

The function receives **all rows at once** and returns a `Map` keyed by row `id`.
This enables a single external API call for the entire page (N+1 排除).

## Example — custom implementation

```typescript
// lib/user/virtual_resolvers.ts (手動 custom — generate-code で上書きされない)
export async function resolveVirtualColumns(
  rows: ReadonlyArray<Record<string, unknown>>
): Promise<Map<string, Record<string, string>>> {
  return new Map(
    rows.map(row => {
      const id = String(row['id'] ?? '');
      return [id, { additional_info: `INFO-${id}` }];
    })
  );
}
```

## Example — async external API

```typescript
export async function resolveVirtualColumns(
  rows: ReadonlyArray<Record<string, unknown>>
): Promise<Map<string, Record<string, string>>> {
  const ids = rows.map(r => String(r['id'] ?? ''));
  const results = await externalApi.getInfoBatch(ids);
  return new Map(results.map(r => [String(r.id), { additional_info: r.value }]));
}
```

## 動作

- `generate-code` は既存 resolver ファイルを **上書きしない**
- custom logic 不在時 (generate-code で生成された stub) はすべての行で空のオブジェクト `{}` を返す
- 例外発生時は getter が `new Map()` で fallback し、空文字を返す
- dummy / custom data が必要な場合はファイルを手動編集してよい

## 命名規則

| 要素 | 規則 |
|------|------|
| ファイル名 | `virtual_resolvers.ts` (entity 毎1ファイル) |
| 関数名 | `resolveVirtualColumns` (固定) |
| 配置ディレクトリ | `lib/{entity}/` |

## getter での呼び出し

`getters.ts` (generate-code 生成) は以下のように呼び出す:

```typescript
import { resolveVirtualColumns } from '@/lib/{entity}/virtual_resolvers';

// prisma.$transaction の後、rowsRaw.map() の前:
let virtualData: Map<string, Record<string, string>>;
try {
  virtualData = await resolveVirtualColumns(rowsRaw as unknown as ReadonlyArray<Record<string, unknown>>);
} catch (e) {
  console.warn('virtual resolver error:', e);
  virtualData = new Map();
}
const rows = rowsRaw.map(row => ({
  ...row,
  additional_info: virtualData.get(String(row.id ?? ''))?.additional_info ?? '',
}));
```
