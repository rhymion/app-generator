# Virtual Column Resolver Guide

Virtual columns are fields declared in `x-display.table` that have no matching property in the schema.
Each virtual column gets a resolver stub generated once by `generate-code`.

## 配置

`lib/{entity}/resolver_{field_name}.ts`

Example: `lib/user/resolver_additional_info.ts`

## Signature

```typescript
export function resolve{FieldPascal}(row: Record<string, unknown>): string
```

Example:
```typescript
export function resolveAdditionalInfo(row: Record<string, unknown>): string {
  return `INFO-${row['id'] ?? 'unknown'}`;
}
```

## 動作

- `generate-code` は既存 resolver ファイルを **上書きしない**
- custom logic 不在時 (generate-code で生成された stub) は空文字 `''` を返す
- dummy / custom data が必要な場合はファイルを手動編集してよい

## 命名規則

| 要素 | 規則 |
|------|------|
| ファイル名 | `resolver_{field_name}.ts` (snake_case) |
| 関数名 | `resolve{FieldPascal}` (PascalCase) |
| 配置ディレクトリ | `lib/{entity}/` |
