# Search Strategy — app-generator エンティティ横断テキスト検索 設計書

> **Phase**: 計画フェーズ (実装・PoC コード無し)
> **対象**: app-generator (~/work/tutorial/app-generator-1)
> **作成**: 2026-06-19 | cmd_195

---

## Phase 1: 現状の問題整理

### 1.1 現行の検索/フィルタ仕組み

**`lib/_pagination.ts` の `buildFilter`:**

```typescript
// 文字列フィールド: ILIKE (case-insensitive contains)
{ [field]: { contains: value, mode: 'insensitive' } }

// FILTERABLE_FIELDS ホワイトリストにないフィールドは無言で除外
const FILTERABLE_FIELDS = new Set<string>([/* スキーマ由来 */]);
```

**`lib/{entity}/getters.ts` の `build{Entity}AccessWhere`:**

```typescript
function buildPostAccessWhere(perms, userId, associatedOrganizationIds) {
  const and = [];
  and.push({ organization_id: { in: associatedOrganizationIds } }); // テナント分離
  if (!perms.general.read) {
    // Creator/Assignee スコープに縮退
    and.push({ OR: [{ creator_id: userId }, { assignee_id: userId }] });
  }
  return and;
}
```

すべての list クエリは `build{Entity}AccessWhere` + `buildFilter` を AND 結合して実行する。
**このフィルタは全エンティティで必ず適用される** (generator による強制)。

### 1.2 現在の限界

| 限界 | 内容 |
|------|------|
| a) 単一エンティティのみ | `FILTERABLE_FIELDS` はエンティティ単位。`post` と `comment` を1クエリで横断できない |
| b) 関連エンティティ非対応 | `include` した関連先フィールドを `buildFilter` の対象にできない (where 直下フィールドのみ) |
| c) モバイル非対応 | DataGrid の column filter は web 専用。`/api/search` エンドポイントが存在しない |
| d) 精度上限 | `contains + insensitive` = ILIKE。typo 耐性・ランキングなし |

### 1.3 検索が満たすべき要件

1. **横断検索**: 複数エンティティ (`post`, `comment`, `channel` 等) を1エンドポイントで横断
2. **関連エンティティ対応**: `include` されたフィールド (例: comment.message) も検索テキストに含める
3. **モバイル API**: `GET /api/search?q=foo` 形式でモバイル (cmd_194 RN+Expo) から利用可能
4. **部分一致・typo 耐性・ランキング** (要件によって濃淡あり)
5. **tenancy + read permission フィルタ** (最重要・漏洩厳禁)
   - `organization_id` によるテナント分離
   - Role の read permission (general / creator / assignee) による行レベル制御

---

## Phase 2: 方式比較

### 2.1 比較マトリクス

| 観点 | 案A: PG FTS + pg_trgm | 案B: index table | 案C: 外部 SE | 案D: MongoDB |
|------|----------------------|-----------------|-------------|-------------|
| **feasibility** | 高 — 既存 PG に拡張追加のみ | 中 — schema + sync 設計が必要 | 中 — 同期パイプライン実装要 | 低 — 2 DB 管理が必要 |
| **検索品質** | 中 — 部分一致◎、ランキング△、日本語は pg_bigm 要 | 中 — PG FTS と同等 | 高 — ランキング◎、多言語◎、typo◎ | 中〜高 (Atlas Search) |
| **横断カバレッジ** | UNION ALL で可能 (クエリ複雑化) | 1テーブル1クエリで完結 | 1インデックス1クエリで完結 | 1コレクション横断 |
| **インフラコスト** | ゼロ (PG 拡張のみ) | ゼロ | Docker 1コンテナ追加 | MongoDB サーバー追加 |
| **同期整合性** | 不要 (クエリ時に評価) | 要 — create/update/delete 時に同期 | 要 — outbox pattern で非同期同期 | 要 — 二重 DB 同期 |
| **tenancy+権限フィルタ** | ◎ 最シンプル — WHERE 句に直接埋め込み | 〇 事前計算だが権限変更時の再計算が難 | △ 二重確認パターン必須 (遅延リスク) | △ MongoDB query に org_id 追加 |
| **generator 適合** | 高 — テンプレート追加のみ | 中 — schema + service テンプレート両方 | 中 — service テンプレートに同期追加 | 低 — Prisma 外の別スキーマ |
| **モバイル API** | 可 (`/api/search` REST) | 可 (`/api/search` REST) | 可 (SE proxy or REST) | 可 |
| **工数概算** | 低〜中 | 中 | 中〜高 | 高 |

### 2.2 案A: PostgreSQL FTS + pg_trgm 詳細

**仕組み:**

```
クライアント → GET /api/search?q=foo&entityTypes=post,comment
                    │
                    ▼
             search route (生成)
                    │
       ┌────────────┴────────────┐
       │  $queryRaw UNION ALL   │
       │  post WHERE org + perm │
       │  comment WHERE org + p  │
       └────────────┬────────────┘
                    ▼
             { results: [{entity_type, id, snippet}], total }
```

**generator 適合:**

新テンプレート `search_route.ts.jinja2` を `code_generator/templates/` に追加。
`x-generate.search: true` なエンティティのみ UNION 対象にする。
既存の `build{Entity}AccessWhere` を再利用するか、共通ヘルパーを抽出する。

**pg_trgm の typo 耐性:**

```sql
-- trigram similarity で typo 吸収 (similarity > 0.3 を部分一致とみなす)
AND (
  to_tsvector('simple', title || ' ' || COALESCE(body, ''))
    @@ plainto_tsquery('simple', $query)
  OR similarity(title, $query) > 0.3
)
```

**日本語対応:**
- `pg_bigm` 拡張を追加 (マイグレーション): bigram index で日本語部分一致
- または `pg_trgm` の trigram LIKE でも部分一致は可能 (精度は pg_bigm に劣る)
- `to_tsvector('japanese', ...)` は形態素解析辞書が必要なため別途検討

**権限フィルタ (最シンプル):**

```sql
WHERE organization_id = ANY($org_ids::text[])
  AND ($general_read::boolean = true
       OR creator_id = $user_id
       OR assignee_id = $user_id)  -- schema に assignee があれば
```

クエリ実行時に評価するため、権限変更は即座に反映される。遅延なし。

**欠点:**
- UNION の entity 数が増えるほどクエリが大きくなる (ただし CTE で整理可能)
- ランキング: ts_rank をエンティティ間で正規化する必要がある
- 横断結果のページネーション: UNION 後の LIMIT/OFFSET が複雑

### 2.3 案B: 横断検索インデックステーブル 詳細

**スキーマ:**

```sql
CREATE TABLE search_index (
  id              TEXT PRIMARY KEY,
  entity_type     TEXT NOT NULL,           -- 'post', 'comment', ...
  entity_id       TEXT NOT NULL,
  organization_id TEXT NOT NULL,           -- テナント分離
  permission_scope JSONB NOT NULL,         -- { general_read, creator_id, assignee_id }
  indexed_text    TEXT NOT NULL,           -- 全フィールドを結合したテキスト
  ts_col          tsvector GENERATED ALWAYS AS
                    (to_tsvector('simple', indexed_text)) STORED,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON search_index USING GIN (ts_col);
CREATE INDEX ON search_index (organization_id, entity_type);
```

**最大の課題 — 権限変更時の再計算:**

```
Role A の read permission を変更
  → Role A を持つ全ユーザー U1, U2, ... に影響するエンティティを特定
  → 影響エンティティ全件の permission_scope を再計算して search_index を更新
  → 件数が多ければバックグラウンドジョブが必要
```

この再計算が遅延している間、剥奪済みのドキュメントが検索結果に残る (セキュリティリスク)。
generator 生成コードの外側の運用タスクになる点が最大の欠点。

### 2.4 案C: 外部検索エンジン (Typesense / Meilisearch) 詳細

**同期アーキテクチャ (Outbox パターン):**

```
service.ts の create/update/delete
    │
    ├── prisma.$transaction:
    │   ├── 主エンティティ書き込み
    │   └── search_outbox に {entity_type, entity_id, op: 'upsert'|'delete'} 追加
    │
    └── バックグラウンドワーカー:
        search_outbox を消費 → Typesense API に upsert/delete
```

**必須: 二重確認パターン (漏洩防止):**

```
1. Typesense に q=foo, filter: organization_id=org123 で検索
   → [{ entity_type: 'post', id: 'abc123' }, ...]
2. 取得した id を DB で再確認:
   SELECT id FROM post
   WHERE id = ANY($ids) AND build{Entity}AccessWhere(...)
   → DB で permission check を通過したものだけ返す
```

外部 SE の同期遅延・権限変更遅延を DB 再確認で補完する。
ただしこの二重確認のコストと実装の確実性が運用上の課題。

**Typesense vs Meilisearch:**

| | Typesense | Meilisearch |
|--|-----------|-------------|
| 日本語 | △ (設定で改善可) | ◎ (組込み辞書) |
| セルフホスト | 容易 (Docker) | 容易 (Docker) |
| ランキング | ◎ | ◎ |
| Multi-tenant filter | ◎ (tenantToken) | 〇 (filter_rules) |
| スループット | 高 | 高 |

### 2.5 案D: MongoDB Atlas Search 詳細

**主な問題:**
- PostgreSQL + Prisma と MongoDB の **2 DB を並行維持** → スキーマ変更時に両方更新
- generator が Prisma スキーマ (`schema.prisma`) と MongoDB スキーマの両方を管理する必要がある
- MongoDB Atlas は SaaS → WSL2 環境では self-host MongoDB が必要
- 案C (Typesense/Meilisearch) と比較して明確なメリットがない
- **推奨外**: 既存スタックからの乖離コストが最大、案C の上位互換にならない

---

## Phase 3: 推奨案とセキュリティ設計・段階計画

### 3.1 推奨案: 案A (PostgreSQL FTS + pg_trgm)

**選定理由:**

| 軸 | 根拠 |
|----|------|
| セキュリティ最強 | organization_id + permission を WHERE 句で直接評価。外部 SE の同期遅延問題が原理的に存在しない |
| 新規インフラ不要 | 既存 PostgreSQL に `CREATE EXTENSION pg_trgm` のみ。Docker 追加コンテナ不要 |
| generator 適合 | `search_route.ts.jinja2` テンプレート追加のみ。既存 `buildFilter` / `build{Entity}AccessWhere` の設計を踏襲 |
| 十分な品質 | pg_trgm で部分一致・typo 耐性。日本語は pg_bigm 追加で対応。PoC で精度確認後に案C へ移行判断可能 |
| 段階拡張容易 | PoC で精度不足が判明すれば案C (Typesense) に切り替えるパスが明確 |

**案A vs 案B の判断:**
案B (index table) の権限変更時再計算問題は、generator の責務外の運用タスクになる。
Role 変更 → 影響エンティティ全件の `permission_scope` 再計算は、件数によっては長時間処理になり
その間に漏洩リスクが生じる。案A はクエリ時に権限評価するため、この問題が原理的に発生しない。

### 3.2 セキュリティ設計 (詳細)

#### organization_id フィルタの実装パターン

```typescript
// lib/search/build_search_where.ts (新規手書きファイル)
export function buildSearchAccessWhere(
  entityTable: string,
  perms: RichPermissions,
  userId: string,
  associatedOrgIds: string[],
): string[] {
  // SQL フラグメントを返す (Prisma $queryRaw の ${sql} テンプレートリテラルで使用)
  const conditions: string[] = [
    `${entityTable}.organization_id = ANY(${associatedOrgIds})`,
  ];
  if (!perms.general.read) {
    const orParts = [];
    if (perms.creator?.read) orParts.push(`${entityTable}.creator_id = '${userId}'`);
    if (perms.assignee?.read) orParts.push(`${entityTable}.assignee_id = '${userId}'`);
    if (orParts.length > 0) conditions.push(`(${orParts.join(' OR ')})`);
    else conditions.push(`1=0`); // no access
  }
  return conditions;
}
```

**重要**: SQL インジェクション防止のため、`associatedOrgIds` と `userId` は
Prisma の `$queryRaw` の `${sql}` テンプレートリテラル + `Prisma.sql` で安全にバインドすること。
文字列結合は使用しない。

#### role read permission チェックの実装位置

```
案A の正解: DB 層 (WHERE 句に直接埋め込み)

検索 API ハンドラ
  ├── authenticateApiKey → userId 確認
  ├── requireApiPermission(userId, 'search', 'read') → search エンドポイント自体の認可
  ├── getAssociatedOrganizations(userId) → org_ids 取得
  ├── getModelPermissions('post', userId) → post の richPermissions 取得
  └── $queryRaw:
        WHERE post.organization_id = ANY($org_ids)
          AND ($general_read OR post.creator_id = $user_id ...)
        UNION ALL
        WHERE comment.organization_id = ANY($org_ids)
          AND ($comment_general_read OR comment.creator_id = $user_id)
```

各エンティティごとに個別の richPermissions を取得してフィルタ条件に変換する。
これにより「post は読めるが comment は読めない」ユーザーの結果が正確になる。

#### 権限変更時の整合性保証

案A は権限変更の整合性問題が**原理的に発生しない**:
- Role A の read permission を変更 → 次の検索クエリ時に新しい権限が即座に反映
- search_index の再計算が不要
- キャッシュ: `getModelPermissions` は `React cache()` でリクエスト単位にキャッシュされており、
  権限変更後の最初のリクエストで新しい値を読み込む

### 3.3 段階計画 (案A)

#### フェーズ 0: PoC (1〜2 週間)

**目的:** PG FTS の精度・パフォーマンスを実測

**変更内容:**
1. `pg_trgm` 拡張の有効化 (マイグレーション):
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE INDEX ON post USING GIN (title gin_trgm_ops);
   ```
2. `GET /api/search?q=foo` エンドポイントを手書き実装 (`app/api/search/route.ts`)
   - `post` エンティティのみ対象
   - `build{Entity}AccessWhere` の条件を再利用した `$queryRaw`
3. 検索精度・レスポンスタイムを実測

**完了基準:**
- `q=foo` で post の title / body から部分一致が動作する
- organization_id + permission フィルタが正しく機能する
- レスポンスタイム < 200ms (10万件データで)

#### フェーズ 1: Generator 統合 (3〜4 週間)

**新規テンプレート:**
```
code_generator/templates/
├── search_route.ts.jinja2   ← GET /api/search を生成
└── search_helpers.ts.jinja2 ← 共通 helper (buildSearchAccessWhere 等)
```

**スキーマ拡張:**
```yaml
# json_schema.yaml のエンティティ定義に追加
post:
  x-generate:
    search: true           # このエンティティを横断検索の対象にする
  x-search:
    text_fields: [title, body]          # 検索テキストに含めるフィールド
    snippet_field: title                # 検索結果のスニペットに使うフィールド
    include_related:                    # 関連エンティティのフィールドも索引に含める
      - entity: comment
        via: commentable
        field: message
```

**生成される API:**
```
GET /api/search?q=foo&entityTypes=post,comment&page=0&pageSize=20
```

**レスポンス形式:**
```json
{
  "results": [
    { "entity_type": "post", "id": "abc", "snippet": "...foo...", "score": 0.8 },
    { "entity_type": "comment", "id": "xyz", "snippet": "...foo...", "score": 0.6 }
  ],
  "total": 42,
  "page": 0,
  "pageSize": 20
}
```

#### フェーズ 2: 品質向上 (後続 cmd)

- `pg_bigm` による日本語精度向上
- ts_rank のエンティティ間正規化
- facet フィルタ (`entityType`, `createdAt` 範囲)
- highlight / snippet 生成 (`ts_headline`)

#### フェーズ 3 (条件付き): 案C への移行

PoC 後に以下のいずれかが判明した場合、Typesense/Meilisearch に移行を検討:
- 日本語検索精度が業務要件を満たせない
- レスポンスタイムが許容値を超える (50万件+)
- ランキング品質が重要な用途が追加された

移行時は `/api/search` エンドポイントのインターフェースを維持したまま
バックエンドのみ切り替えることができるため、クライアント (web/mobile) への影響はない。

### 3.4 generator 統合アーキテクチャ

```
json_schema.yaml (SoT)
  x-generate.search: true / x-search.text_fields
         │
         ▼
  generate.py (--target web, 既存)
         │
         ├── search_route.ts.jinja2 → app/api/search/route.ts
         │      (UNION ALL: x-generate.search: true なエンティティ)
         │      (build{Entity}AccessWhere を各エンティティで適用)
         │
         └── search_helpers.ts.jinja2 → lib/search/helpers.ts
                (共通 buildSearchAccessWhere, pagination)
```

### 3.5 モバイル API との統合 (cmd_194 RN+Expo)

```
Expo RN App
  → GET https://{app}/api/search?q=foo
  → Authorization: Bearer {jwt}

  same endpoint as web → レスポンス形式統一
  → RN SearchScreen: FlatList で results を表示
```

`/api/search` エンドポイントは REST なので web と mobile で共有。
generator が生成するため、スキーマ変更が search にも自動反映される。

### 3.6 リスクと撤退条件

| リスク | 影響度 | 緩和策 |
|--------|--------|--------|
| PG の全文検索精度が業務要件未満 | 高 | PoC で実測後判断。不足なら案C (Typesense) に移行 |
| UNION クエリのパフォーマンス (entity 数増加時) | 中 | GIN インデックス設計最適化。entity 数上限を設ける (上位 N エンティティのみ) |
| 日本語検索品質 | 中 | pg_bigm 追加 (マイグレーション) で改善。PoC で確認 |
| $queryRaw SQL インジェクション | 高 | Prisma.sql テンプレートリテラルを厳守。文字列結合禁止 |

**撤退条件:**
- PoC でレスポンスタイム > 500ms (適切な GIN インデックス後でも) → 案C に移行
- 日本語精度が pg_bigm でも不足 → Meilisearch (多言語対応) に移行

---

## Phase 4: 決定点 (殿裁可必要)

| ID | 決定点 | 選択肢 | 推奨 |
|----|--------|--------|------|
| **DP-1** | 方式選定 | A: PG FTS+pg_trgm / B: index table / C: 外部SE / D: MongoDB | **A: PG FTS + pg_trgm** |
| **DP-2** | 検索品質要件 | 部分一致のみ可 / typo 耐性必須 / ランキング必須 / 多言語 (日本語) 必須 | **まず部分一致 + typo 耐性。ランキング・多言語は PoC 後判断** |
| **DP-3** | 対象エンティティ範囲 | 全エンティティ自動 / 主要エンティティのみ opt-in | **opt-in (`x-generate.search: true`) — スキーマ設計者が明示的に指定** |
| **DP-4** | 新規インフラ可否 | PG 完結必須 / 外部サービス (Docker追加) 許容 | **PG 完結 (PoC)。精度不足なら案C (Typesense) へ移行可** |
| **DP-5** | PoC スコープ | entity 名と API 形式 | **`post` entity, `GET /api/search?q=foo`, 結果は {entity_type, id, snippet}** |

---

## 付録: private 名チェック

提出前の汚染チェックを実施。結果: 本文に private 名の混入なし (OK)。

---

## Phase 2: pg_bigm Setup (Implementation)

### pg_bigm セットアップ (Phase 2)

**Docker**: `docker/Dockerfile.postgres` をベースとした
`app-postgres-bigm:16` イメージを使用。`docker compose up --build` で再ビルド。

**拡張とインデックス**: `prisma/migrations/20260620_add_pg_bigm/migration.sql`
で `CREATE EXTENSION pg_bigm` と `gin_bigm_ops` インデックスを追加。

**pg_trgm との関係**: 両拡張を共存。英語は trgm、日本語は bigm でカバー。

**検索ロジック**:
- ヒット判定: pg_trgm similarity OR pg_bigm `%%` 演算子 (OR 結合)
  - 英語クエリは trgm でヒット、日本語クエリは bigm でヒット
- スコア計算: trgm スコア + bigm スコア × 0.5 で合算

**フェイシット (facets)**: 各 entityType のヒット件数を集計して返す。
`{ facets: { organization: 8, role: 3 } }` 形式。

**ハイライト (highlight)**: `ts_headline()` で FTS マッチ箇所をマークアップ。
XSS 対策として `<<<` / `>>>` マーカーを使用し、UI 層で `<mark>` に変換する。

---

## Phase 3: text_fields Auto-Derivation (cmd_222)

### 背景と RCA (cmd_221)

`generate.py` L558 にて `text_fields = xsearch.get('text_fields', ['name'])` というデフォルトが
存在し、`name` 列を持たないエンティティ（例: `shift_template`, `shift`）の SQL 生成時に
PostgreSQL エラー 42703 (column "name" does not exist) が発生していた。

### DP-1: text_fields 自動導出ロジック

`x-search.text_fields` が明示されていない場合、エンティティの base properties から以下のルールで自動導出する:

**選出条件**: 型が `string`（または nullable string `["string", "null"]`）

**ノイズ除外**:
| 条件 | 理由 |
|------|------|
| フィールド名 `id` または `x-primary: true` | PK — 意味のある自由文字列ではない |
| `x-relationship` を持つ、または `*_id` 命名 | 外部キー — UUID が検索されても意味がない |
| `enum: [...]` がある | 定型値 — FTS/trigram 検索に不適 |
| `pattern` が CUID パターン (`^c[a-z0-9]{24,}$`) | ID 文字列 — FTS 不適 |
| `format: date`, `date-time`, `time`, `uri` | 日付・URI — テキスト検索に不適 |

**機微除外**:
| 条件 | 理由 |
|------|------|
| `x-custom-component: {target: [upsert]}` | 書き込み専用フィールド（例: password, api_key）|
| `x-search: false`（フィールドレベル） | スキーマ設計者による明示的 opt-out |

**空集合処置**: 除外後 text_fields が空のエンティティは UNION から除外し、警告ログを出力する。
これにより SQL 42703 エラーを根絶する。

**snippet_field 選定優先順**: x-display primary フィールド → text_fields の先頭

### DP-2: stale search ファイル削除 (Option A)

`search_entities` がゼロ件になった場合（例: opt_in→all 切替時の stale 状態）:
- `lib/search/helpers.ts` を削除（存在する場合のみ）
- `app/api/search/route.ts` を削除（存在する場合のみ）
- `app/[locale]/search/page.tsx` を削除（存在する場合のみ）
- `app/[locale]/search/actions.ts` を削除（存在する場合のみ）
- 警告ログを出力

### フィールドレベル opt-out: `x-search: false`

個別フィールドを text_fields から除外するには:

```yaml
properties:
  internal_code:
    type: string
    x-search: false   # 検索対象から除外
```

### x-audit エンティティの search 有効化

`x-audit: true` エンティティは `default_scope: all` 配下でもデフォルト除外される。
明示的に検索対象にするには `x-generate.search: true` が必要:

```yaml
role_detail:
  x-generate:
    search: true
  x-audit: true
```

### organization の org_id_field 設定

organization エンティティ自身（org IS the org）を search 対象にする場合、
org フィルターに使う列を明示する必要がある:

```yaml
organization_detail:
  x-search:
    org_id_field: id   # organization.id が本エンティティの "所属 org" 列
```

未設定だと `organization_id` を探して `should_filter_by_org = False` となり、
全ユーザーに全組織が見えるセキュリティ問題が発生する。
