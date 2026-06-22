# Search Authorization Design — 権限システム再利用設計書

> **Phase**: 設計フェーズ (コード変更・default_scope 切替は別 cmd)
> **対象**: app-generator
> **初版**: 2026-06-22 | cmd_214
> **全面改稿**: 2026-06-22 | cmd_217 (権限システム再利用へ全面作り直し)
> **前提**: search-strategy.md (cmd_195) / cmd_208 RCA / getters.ts.jinja2 / lib/authz.ts

---

## 1. 設計方針 — 権限システム再利用

### 1.1 新設計の中核

**検索の行可視性は、通常 list が使う `build<Entity>AccessWhere` / `RichPermissions` (lib/authz) と
完全に同じ認可ロジックを再利用して決める。**

| 項目 | 旧設計 (cmd_214/215) | 新設計 (cmd_217) |
|------|---------------------|----------------|
| 認可 SoT | 検索専用 (`org_filter` / `has_creator_filter`) | 権限システム (`lib/authz`) |
| org スコープ | schema 宣言 (`x-search.org_filter: <列>`) | `should_filter_by_org` 自動判定 |
| creator スコープ | schema 宣言 (`x-search.has_creator_filter: true`) | `perms.general.read` + `perms.creator.read` 自動適用 |
| global スコープ | `x-search.isolation: global` 明示 (未実装) | `general.read=true` かつ `should_filter_by_org=false` で自然に達成 |
| 新規エンティティ | isolation 宣言が必要・漏れで generate エラー | 宣言不要・権限システムが自動処理 |

### 1.2 なぜ cmd_214/215 設計を撤回するか

cmd_214/215 の独自 `isolation` 3分類は、既存の `build<Entity>AccessWhere` が解決済みの問題を
再実装しようとしていた。これには以下の欠陥があった:

1. **認可 SoT の分裂**: 通常 list と検索で別々の認可ロジック → 一方を変えると他方が外れる
2. **schema 宣言の意味論的誤用**: `role_detail.org_filter: creator_id` は OrgID 列に UserID を宣言
   (cmd_203/205 で確定した型不一致の根)
3. **generate エラーの誤解**: `role_detail` のエラーは設計上のガード発動(実験で宣言を除去した際)であり、
   isolation 宣言 *構造* の問題ではない
4. **search_helpers.ts.jinja2 の微妙なバグ**: 現行コードの `generalRead = perms.permissions.read`
   は merged フラグ(general|creator|assignee)を使用しており、creator-only ユーザーが全件可視になる
   可能性がある。`build<Entity>AccessWhere` は `perms.general.read` を正しく参照している。

---

## 2. 現コード事実確認 (AC-1)

### 2.1 lib/authz.ts の RichPermissions

```typescript
// lib/authz.ts
export interface RichPermissions extends OperationFlags {
  general:  OperationFlags;           // global roles — item-context 不要
  creator:  OperationFlags | null;    // Creator role — item 所有者のみ有効
  assignee: OperationFlags | null;    // Assignee role — item 担当者のみ有効
}
// 上位 read/create/update/delete = general | creator | assignee (merged)
// ← 検索の行可視性判定には general.read を使う必要がある
```

`getModelPermissions(model, userId)` は `{ permissions: RichPermissions, userId }` を返す。

### 2.2 build<Entity>AccessWhere の認可ロジック (getters.ts.jinja2)

```typescript
function build<Entity>AccessWhere(
  perms: RichPermissions,
  userId: string | null,
  associatedOrganizationIds: string[],  // should_filter_by_org=true の場合のみ
): Record<string, unknown>[] {
  const and = [];
  // ① org スコープ: organization_id 列があるエンティティのみ
  if (should_filter_by_org):
    and.push({ organization_id: { in: associatedOrganizationIds } })

  // ② general.read でない場合 → creator/assignee 所有スコープに絞る
  if (!perms.general.read) {
    const or = [];
    if (perms.creator?.read && userId)  or.push({ creator_id: userId });
    if (perms.assignee?.read && userId) or.push({ assignee_id: userId });
    if (or.length === 0) and.push({ id: '__no_access__' });  // 全アクセス拒否
    else and.push({ OR: or });
  }
  return and;
}
```

**このロジックが認可の SoT である**。検索もこれと同等の WHERE 句を生成すればよい。

### 2.3 should_filter_by_org による org 自動判定

`should_filter_by_org` は既存の Jinja2 変数 — generate.py がモデル定義を解析し、
`organization_id` 列の有無を自動判定する。**schema 宣言なし**に使用できる。

これは `getters.ts.jinja2` ですでに使用されており、search テンプレートでも同様に使える。

### 2.4 search_helpers.ts.jinja2 現状と問題点

```jinja2
// 現行コード(問題あり)
const generalRead = perms.permissions.read === true;
// ↑ merged read (general|creator|assignee) → creator-only ユーザーで全件可視バグの懸念

// build<Entity>AccessWhere 相当の正しい判定
const generalRead = perms.permissions.general.read === true;
// ↑ general 権限のみ。creator-only ユーザーは false → creator_id フィルタが適用される
```

新設計ではこの差異を修正し、`perms.permissions.general.read` を参照するように更新する。

---

## 3. 廃止事項 (AC-3)

### 3.1 廃止する schema フィールド

| フィールド | 廃止理由 | 代替 |
|-----------|---------|------|
| `x-search.org_filter: <列>` | `should_filter_by_org` が自動判定 | 不要 |
| `x-search.has_creator_filter: true` | `perms.general.read` + `perms.creator.read` が自動適用 | 不要 |

既存 schema の `x-search.org_filter` / `x-search.has_creator_filter` は
後続の実装 cmd で除去する(generate-code は両フィールドを無視するよう変更)。

### 3.2 廃止するガードロジック

`generate.py L546-556` の「`x-search.org_filter` 必須ガード」は廃止する。

```python
# 廃止するコード (generate.py L546-556)
if search_default_scope == 'all':
    if not xsearch_raw or 'org_filter' not in xsearch_raw:
        raise ValueError(...)  # ← このガードを撤去
```

**理由**: org スコープは `should_filter_by_org` で自動判定されるため、
schema 宣言がなくても認可が正しく動作する。宣言漏れによる危険はない。

### 3.3 role 型不一致の解消 (cmd_203/205 根本解消)

**旧**: `role_detail.x-search.org_filter: creator_id` — OrgID 列ではなく UserID 列を指定(型誤用)
**新**: schema 宣言不要

`role_detail` はモデルに `organization_id` 列を持たない → `should_filter_by_org=false`
`role_detail` の権限モデルは `perms.creator.read=true` → `creator_id = userId` が自動適用

結果: `role_detail.org_filter: creator_id` + `has_creator_filter: true` は schema から除去可能。
cmd_203/205 で確定した「UserID vs OrgID 型不一致」は根絶される。

---

## 4. cmd_214/215 設計の撤回 (AC-4)

以下を正式撤回する:

| 撤回事項 | 状態 |
|---------|------|
| `x-search.isolation: org\|creator\|global` の3分類導入 | 設計のみ(未実装)→撤回 |
| `default_scope=all` の `org_filter` 必須ガード | 実装済み(generate.py L546-556)→削除 |
| DP-4: `org_filter→isolation:creator` 一本化 | 撤回 |
| cmd_214/215 の DP-1〜4 | 本設計書の §6 DP に置換 |

---

## 5. 新しい検索認可ロジック (AC-2/AC-5)

### 5.1 検索 WHERE 句の新設計

検索テンプレート (`search_helpers.ts.jinja2`) が生成する WHERE 句:

```typescript
// build<Entity>AccessWhere と同等の SQL WHERE 句を生成
{% if entity.should_filter_by_org %}
  // ① org スコープ (organization_id 列あり)
  AND organization_id IN (${Prisma.join(associatedOrgIds)})
{% endif %}

{% if not entity.general_read %}  {# perms.general.read を使用 #}
  // ② creator/assignee スコープ
  AND (
    {% if entity.has_creator_id %}  creator_id = ${userId}  {% endif %}
    {% if entity.has_assignee_id %} OR assignee_id = ${userId} {% endif %}
    {# neither: impossible with assertPermission upstream #}
  )
{% endif %}
// ③ general.read=true かつ should_filter_by_org=false → フィルタなし (全件可視)
```

`entity.should_filter_by_org`, `entity.has_creator_id`, `entity.has_assignee_id` は
generate.py が model 定義から自動判定する。schema 宣言不要。

### 5.2 既定 ON 設計 (AC-5)

後方互換は不要(検索は未リリース)。

検索対象の schema 判断は以下の2点のみ:

| 判断 | 手段 |
|------|------|
| 検索対象か否か | `x-generate.search: false` (opt-out) |
| 監査/セキュリティ例外 | §6 DP-b 参照 |

**行可視性は権限システムが担保するため、`default-on` でも認可スコープ外の行は露出しない。**

新規エンティティを schema に追加した際:
- `x-generate.search: false` を書かなければ自動的に検索対象 ✅
- 認可は `should_filter_by_org` + `perms.general.read`/`creator.read`/`assignee.read` が自動処理 ✅
- generate エラーは起きない ✅

### 5.3 エンティティスコープ自動決定フロー

```
エンティティ
    │
    ├─ x-generate.search: false? ──────────────────────────→ UNION 除外
    │
    ├─ x-audit: true? (§5 DP-b) ──────────────────────────→ UNION 除外(推奨)
    │
    └─ 検索対象
           │
           ├─ organization_id 列あり? ─→ should_filter_by_org=true → org WHERE 追加
           │
           ├─ general.read=true? ──────→ WHERE なし(全件可視)
           │
           └─ general.read=false
                  │
                  ├─ creator.read=true + creator_id 列あり → creator_id = userId
                  ├─ assignee.read=true + assignee_id 列あり → OR assignee_id = userId
                  └─ 両方なし → id = '__no_access__' (認可ゼロ)
```

---

## 6. 監査例外設計 (AC-6)

### 背景

`x-audit: true` が付いたエンティティは、権限システム上は read 可能であっても
監査ログ・操作履歴として機密性が高く、横断検索 UNION に含めることは
セキュリティリスクになり得る (cmd_208 DP-2 と整合)。

### 提案

`x-audit: true` なエンティティは `x-generate.search` のデフォルトを `false` に設定
(= 既定で UNION 除外)。明示的に検索対象にしたい場合は `x-generate.search: true` で opt-in。

この挙動は DP-b として殿裁可を仰ぐ。

---

## 7. 残課題 DP (AC-7)

### DP-a: 検索認可ロジックの実装方式

**背景**: `build<Entity>AccessWhere` は Prisma ORM 形式 (`{ organization_id: { in: [...] } }`)。
検索は生 SQL (Prisma.sql UNION ALL)。実行時に直接コードを共有できない。

| 案 | 内容 | メリット | デメリット |
|----|------|---------|-----------|
| **案A (推奨)**: テンプレート水準での整合 | generate.py の既存 `should_filter_by_org` / `has_creator_id` / `has_assignee_id` 変数を検索テンプレートに渡し、`build<Entity>AccessWhere` と同等の SQL を生成 | 実装コスト低・既存変数を再利用 | getter ロジック変更時に別途テンプレートも更新要 |
| **案B**: 実行時共有 | SQL 版 `buildEntityAccessWhereSql(perms, userId, assocOrgIds)` ヘルパーを追加 | 真の SoT 一本化 | リファクタリングコスト高・ORM 版と SQL 版の二重保守 |

**推奨: 案A**。Phase 1 は案A で実装、divergence が問題化した際に案B を検討。

### DP-b: 監査除外の既定と粒度 (cmd_208 DP-2 整合)

| 案 | 内容 | メリット | デメリット |
|----|------|---------|-----------|
| **案A (推奨)**: x-audit:true → 既定 search:false | `x-audit: true` が付いていれば `x-generate.search` デフォルト = false (opt-out 不要・除外が既定) | Principle of Least Privilege。監査エンティティを誤って検索に含めない | 例外的に監査検索が必要な場合は `search: true` で明示 opt-in が必要 |
| **案B**: 明示 opt-out のみ | 現行どおり `x-generate.search: false` で手動除外 | 柔軟 | 宣言漏れで監査データが検索に露出するリスク |

**推奨: 案A**。cmd_208 で確定した DP-2「audit エンティティ除外」方針と整合。

### DP-c: organization_id 自動判定の例外

**背景**: `should_filter_by_org` は `organization_id` 列の有無で判定する。
「organization 自身」エンティティは `organization_id` FK を持たない(自身が org)が、
検索ではユーザーの所属組織レコードのみ返すべき。

| 案 | 内容 | メリット | デメリット |
|----|------|---------|-----------|
| **案A (推奨)**: `x-search.org_id_field` ヒント | `organization_id` 以外の列でフィルタしたい場合に列名を schema で指定 (例: `x-search.org_id_field: id` → `id IN associatedOrgIds`) | 最小限の schema 介入で対応 | 追加フィールド定義が必要 |
| **案B**: 既定で除外・明示 opt-in | organization 系エンティティは `search: false` 既定。検索したい場合は手動 | 安全側 | 検索に含めたい場合の設定が煩雑 |

**推奨: 案A**。`should_filter_by_org=false` かつ org 関係でのフィルタが必要な稀なケースに対応。

---

## 8. 自己 QC

| チェック項目 | 結果 |
|------------|------|
| build<Entity>AccessWhere との認可同期が設計として明確 | ✅ |
| 認可 SoT を権限システム(lib/authz)に一本化 | ✅ |
| 検索専用 generalRead/org_filter/has_creator_filter の撤去を明記 | ✅ |
| creator-only ユーザーの全件可視バグ (merged read vs general.read) を明記・修正 | ✅ |
| cmd_203/205 の role 型不一致が根本解消されることを設計で証明 | ✅ |
| cmd_208 整合: 監査除外(DP-2)が新設計でも保持(DP-b 案A) | ✅ |
| cmd_214/215 の DP-1〜4 を正式撤回・置換 | ✅ |
| 設計書実在確認 | ✅ |
| private 名・固有 entity 名 | ✅ 0件 |

---

## 9. 参照

- `code_generator/templates/getters.ts.jinja2` — `build<Entity>AccessWhere` の正本実装
- `lib/authz.ts` — `RichPermissions` 定義
- `code_generator/templates/search_helpers.ts.jinja2` — 改修対象の検索テンプレート
- `docs/search-strategy.md` (cmd_195) — 検索アーキテクチャ設計
- cmd_208 RCA: audit/permission/flow 系エンティティ除外裁定
- cmd_203: roleOrgFilter 型不一致確定 (creator_id: UserID vs OrgID)
- cmd_205: role creator スコープ是正
