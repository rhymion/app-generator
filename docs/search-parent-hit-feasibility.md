# 検索「親ページヒット」実装 技術的実現可能性調査

**前提**: cmd_248 調査報告 (`search-attachable-investigation.md`) の継承  
**調査対象**: `~/work/generated-apps/app-template/app-generator/`  
**調査日**: 2026-06-29 | cmd_249

---

## 1. 5カテゴリの「独立ページ無し」確認

### 調査対象の定義

「独立ページ無し」= `{child}_detail.x-generate` が設定されていない(またはすべて false)  
→ `/{child}/view/{id}` の URL が生成されない  
→ ユーザーはその entity を閲覧するために **親ページへアクセスする必要がある**

### §7.1 inline grid children (output_type=None)

**コード根拠**: `generators.py:2032`
```python
grid_children = [c for c in children_raw if c.get('output_type') not in ('list', 'comments')]
```

`output_type` が `None`(= 未設定)の children が inline grid として描画される。  
テンプレート: `page_view.tsx` の `<FieldsViewGrid fields={src.{prop}} columns={...Columns} />`

**独立ページが生成されない条件**:  
`build_context.py:158-161` の `is_independent` 判定:
```python
is_independent = (
    output_type == 'list' and not is_many_to_many  # ← 'list' 必須
    and bool(schema['definitions'].get(f'{child_name}_detail', {}).get('x-generate'))
)
```
→ `output_type=None` のグリッド children は **`is_independent` が常に False** → 独立ページ生成なし

**実例** (json_schema.yaml 確認済み):

| 子 entity | 親 entity | 親FK フィールド | 独立ページ |
|-----------|-----------|---------------|---------|
| `dashboard_widget` | `dashboard` | `dashboard_id` (m2o) | ❌ |
| `field` | `db_table` | `db_table_id` (FK, x-relationship無) | ❌ |
| `purchase_per_item` | `purchase_order` | `purchase_order_id` (m2o) | ❌ |
| `receiving_purchase_order_line` | `receiving_purchase_order` | `receiving_purchase_order_id` (m2o) | ❌ |

→ **子テーブルに `{parent}_id` FK が必ず存在する** (方式②の実現根拠)

### §7.2 embedded list children (output_type=list, is_independent=False)

**コード根拠**: `build_context.py:776`
```python
embedded_ch = [c for c in non_comment_ch if c['use_connect'] or c.get('output_type') != 'list' or not c['is_independent']]
```

`output_type=list` かつ `is_independent=False` (= `{child}_detail.x-generate` 未設定) の children。  
親ページのフォームに完全な CRUD UI として埋め込まれる。

**実例** (json_schema.yaml 確認済み):

| 子 entity | 親 entity | 親FK フィールド | 独立ページ |
|-----------|-----------|---------------|---------|
| `approval_request` | `approvable` | `approvable_id` (m2o) | ❌ |
| `parent1_list` | `parent1` | `parent1_id` (FK) | ❌ |
| `attachment` | `attachable` | `attachable_id` (m2o) | ❌ (bridge経由) |

→ 同様に子テーブルに親FK が存在する

### §7.3 x-outputType: flatten (非配列 $ref, 独立ページ無し)

**コード根拠**: `schema_helpers.py:331-365` の `get_flatten_rels()`  
条件: `_detail` 定義の non-array `$ref` property で `x-outputType: flatten` が設定されている

```python
is_m2o = f'{prop_name}_id' in base_props  # True: FK が親側 / False: FK が子側(reverse OTO)
```

**独立ページ無しの条件**: `{child}_detail.x-generate` 未設定

**2種類のFK方向**:

| 種別 | FK所在 | 例 |
|------|--------|---|
| non-m2o flatten (reverse OTO) | 子テーブルに `{parent}_id` FK | `checkup_result.checkup_id → checkup` |
| m2o flatten | 親テーブルに `{child}_id` FK | `parent.{child_name}_id → child` |

**non-m2o 例** (menlab-auto json_schema.yaml 確認):
- `checkup_result` (独立ページ無し): `checkup_id → checkup` (reverse OTO)
- → `checkup_result.checkup_id` から親 `checkup` を直接解決可能

**m2o 例**: 親テーブルに `{child}_id` があり、子テーブルには親FKが存在しない。  
→ 方式②での親解決には親テーブルへの逆引きJOINが必要 (複雑)

### §7.4 comments (x-outputType: comments / has_commentable)

**コード根拠**: `generators.py:2028-2030` / `build_context.py:767-772`

```python
has_commentable = ctx.get('has_commentable', False)  # commentable bridge (OTO)
comment_children = [c for c in children_raw if c.get('output_type') == 'comments']
```

**DB構造** (prisma/schema.prisma 確認):
```
comment.commentable_id → commentable.id   (FK in comment)
db_table.commentable_id → commentable.id  (OTO FK in parent entity)
```
→ `commentable` はポリモーフィック pivot テーブル。  
→ 親解決は 2ホップ: `comment → commentable → {parent entity}`  
→ 複数の entity type が `commentable` を持てる → スキーマ起因のポリモーフィック問題

### §7.5 attachments (x-attachable)

**DB構造** (prisma/schema.prisma 確認):
```
attachment.attachable_id → attachable.id  (FK in attachment)
resource.attachable_id → attachable.id    (OTO FK in parent entity)
product.attachable_id → attachable.id     (OTO FK in parent entity)
```
→ `attachable` も同様のポリモーフィック pivot テーブル。  
→ 親解決は 2ホップ + CASE WHEN (どの entity type がオーナーか):
```sql
FROM attachment
JOIN attachable ON attachment.attachable_id = attachable.id
LEFT JOIN resource ON attachable.id = resource.attachable_id
LEFT JOIN product  ON attachable.id = product.attachable_id
```
→ `attachment.name` (ファイル名) は text フィールドとして検索対象にできる。  
→ `attachment.path` は format:uri → `_derive_text_fields` で除外済み (cmd_248 確認)

---

## 2. 実装方式比較

### 方式① index側集約

「`_derive_text_fields` を拡張し、子/関連 entity のテキストを親の tsvector に畳み込む」

検索 SQL は親テーブルのみを `FROM "parent"` で参照する現構造を変えずに、  
相関サブクエリで子テキストを連結する:

```sql
FROM "purchase_order" p
WHERE to_tsvector('simple',
  COALESCE(p.name, '') ||
  COALESCE((SELECT string_agg(chi.name, ' ') 
            FROM purchase_per_item chi 
            WHERE chi.purchase_order_id = p.id), '')
) @@ plainto_tsquery('simple', $q)
```

**カテゴリ別評価**:

#### inline grid (方式①)
- 必要変更: `generate.py` で検索対象 entity の children を収集 → 各 child の `_derive_text_fields` を実行 → 相関サブクエリを生成
- テンプレート改修: `search_helpers.ts.jinja2:100` の `FROM "{{ entity.model }}"` 行を拡張
- **問題**: 子が複数行ある場合 `string_agg` 必須 (多対一)。全行スキャン時に相関サブクエリが実行される → O(N×M) パフォーマンスリスク。GINインデックスで `to_tsvector()` を事前評価していないため、クエリごとに再計算される。

#### embedded list (方式①)
- inline grid と同じ構造 → 同じ難易度

#### flatten non-m2o (方式①)
- OTO なので行数は最大1 → `string_agg` 不要、直接 JOIN で可能:
  ```sql
  LEFT JOIN checkup_result cr ON cr.checkup_id = p.id
  ```
- inline grid より相関サブクエリのコスト低
- ただし generator の改修量は同等

#### m2o flatten (方式①)
- 親が FK を持つ (`parent.{child}_id`) → 既に`base_def.properties` に `{child_id}` フィールドが存在  
- 子テーブルへは JOIN で参照可能 (1行固定) → コスト低
- **ただし**: 子の text_fields を generator が検出するロジックが現状なし

#### comments (方式①)
- 多対一 (コメントは複数) → `string_agg(message, ' ')` 相関サブクエリ必須
- commentable bridge 経由: `(SELECT string_agg(c.message, ' ') FROM comment c JOIN commentable co ON c.commentable_id = co.id WHERE co.id = parent.commentable_id)`
- パフォーマンスリスク大: コメント件数が多い entity では極めて遅い可能性
- generator 改修: `has_commentable` を検知した entity に subquery を注入

#### attachment.name (方式①)
- 添付ファイルは複数 → `string_agg(name, ' ')`
- attachable bridge 経由: `(SELECT string_agg(a.name, ' ') FROM attachment a WHERE a.attachable_id = parent.attachable_id)`
- inline grid と同等のパフォーマンスリスク

---

### 方式② query側横断検索→親URL解決

「子テーブルを UNION ALL に追加し、結果の entity_type と id を親エンティティの値にすることで親ページ URL を返す」

現在: `SELECT entity_type, id FROM child_table WHERE ...`  
変更後: `SELECT 'parent_entity'::text AS entity_type, child.parent_id::text AS id FROM child_table ...`

これにより、search page の `/${item.entity_type}/view/${item.id}` → 親ページ URL になる。

**重複除外**: 親 entity 自体もヒットした場合に重複する → DISTINCT ON が必要:
```sql
SELECT DISTINCT ON (entity_type, id) entity_type, id, snippet, rank
FROM ($union_all_including_children) _u
ORDER BY entity_type, id, rank DESC
```
外側で `ORDER BY rank DESC` を適用し LIMIT/OFFSET。

**アクセス制御**: 子テーブルに `organization_id` / `creator_id` が無い場合、  
親テーブルへ JOIN してアクセスチェックを行う:
```sql
FROM purchase_per_item chi
JOIN purchase_order parent ON chi.purchase_order_id = parent.id
WHERE parent.organization_id IN ($org_ids)
  AND ($general_read OR parent.creator_id = $user_id)
```

#### inline grid (方式②)

- FK `{parent}_id` が子テーブルに直接存在 → 親解決は1ホップ JOIN
- 生成ロジック (`generate.py` での変更):
  1. search entity のループ内で `entity['children']` をスキャン
  2. `output_type=None` かつ `is_independent=False` の children を抽出
  3. 各 child の `_derive_text_fields` を実行
  4. テンプレートに新ブロック `{% for child in entity.no_page_children %}` を追加
- テンプレート改修箇所 (`search_helpers.ts.jinja2`): `line 75` の subquery ブロックに新しい child 用ブロックを追加

**アクセス制御**: 子テーブルへの access_where は親の条件で十分  
(子テーブルに org_id が無い場合は JOIN 必須)

#### embedded list (方式②)

- inline grid と同構造 → 同実装で対応可能
- `output_type='list'` かつ `is_independent=False` を抽出条件に追加するのみ

#### flatten non-m2o (方式②)

- FK `{parent}_id` が子テーブルに存在 → inline grid と同一実装パターン
- `get_flatten_rels()` で `is_m2o=False` を抽出すればよい

#### flatten m2o (方式②)

- 子テーブルには親FK が存在しない
- 「親 entity → 子 entity」の FK は親にあるので、逆引きが必要:
  ```sql
  FROM flatten_child chi
  JOIN parent_entity par ON par.{child_name}_id = chi.id
  ```
  → 生成ロジックが複雑化。`generate.py` で `flatten_m2o_fk_props` から逆引きテーブルを特定する必要あり
- 実用ケースが限られる (m2o flatten ≒ "parent embeds child as extension") → Phase 3以降推奨

#### comments (方式②)

- 2ホップ: `comment → commentable → {parent entity}`
- ポリモーフィック: 複数の entity type が commentable を持てる
- 生成SQL:
  ```sql
  SELECT 
    CASE WHEN db_table.id IS NOT NULL THEN 'db_table'
         -- ... (generator が commentable 所有 entity を全列挙)
    END AS entity_type,
    COALESCE(db_table.id) AS id,
    comment.message AS snippet,
    ... rank ...
  FROM comment
  JOIN commentable ON comment.commentable_id = commentable.id
  LEFT JOIN db_table ON commentable.id = db_table.commentable_id
  -- ... LEFT JOIN for each commentable owner ...
  WHERE comment.message ILIKE '%' || $q || '%'
    AND ... (access check via parent entity JOIN) ...
  ```
- generator 改修: `commentable` 所有 entity 全体をスキャンして CASE WHEN を生成
- アクセス制御: `comment.creator_id` は存在するが parent entity の `organization_id` は 2ホップ先 → JOIN 必須

#### attachment.name (方式②)

- inline grid と同様に `attachable_id` を経由するが、ポリモーフィック (resource/product どちらが owner かを判定)
- generator が `x-attachable` entity を全列挙して CASE WHEN を生成
- attachable bridge は commentable と完全に同構造 → comments ② の実装を共用可能

---

## 3. カテゴリ × 方式 難易度表

| カテゴリ | 方式① index側 | 方式② query側 | 推奨方式 | 難易度 | 概算工数 | 主要リスク | 推奨順位 |
|---------|:------------:|:------------:|:-------:|:------:|:-------:|-----------|:-------:|
| inline grid children | 高 (相関subquery+generator大改修) | **中** (直接FK, 1ホップJOIN) | **②** | **中** | 2-3日 | 子テーブルに org_id 無しのため親JOINでACL | **1** |
| embedded list (non-independent) | 高 (同上) | **中** (同上) | **②** | **中** | 2-3日 (inline gridと共用実装可) | 同上 | **1** |
| flatten (non-m2o, 独立ページ無し) | 中 (OTO=1行, JOINシンプル) | **中** (直接FK, 同一パターン) | **②** | **中** | 2日 (inline gridと共用) | 実用ケース少ない可能性 | **2** |
| flatten (m2o, 独立ページ無し) | 高 (別テーブル+逆引き必要) | 高 (逆引きJOIN+generator複雑化) | ②(設計要) | **高** | 1週間+ | 逆引きロジック複雑, 実用ケースはさらに少ない | **3** |
| comment (commentable bridge) | 高 (string_agg+perf risk) | 高 (2ホップ+ポリモーフィック) | ②(設計要) | **高** | 1週間+ | ポリモーフィックCASE WHEN, ACL 2ホップ | **3** |
| attachment.name | 中高 (string_agg+bridge) | 高 (ポリモーフィック) | ②(comments共用) | **高** | 1週間+ (comments②と共用実装) | 同上 | **3** |
| attachment.contents | 断念 | 断念 | — | — | — | FTS非対応 (バイナリ) | **断念** |

**難易度の目安**:
- 低: 数時間〜1日。既存パターン踏襲、テンプレート追加のみ
- 中: 2〜3日。設計判断が必要、複数ファイル改修
- 高: 1週間+。アーキテクチャ変更、性能リスク、テスト工数大

---

## 4. Phase推奨

### Phase 1: inline grid + embedded list (最容易・最高価値)

**対象**: output_type=None / output_type=list かつ is_independent=False の children  
**共通実装**: 両カテゴリとも「子テーブルに `{parent}_id` FK が直接存在」という同一パターン  
**template 改修**: `search_helpers.ts.jinja2` に `no_page_children` ブロックを追加  
**generate.py 改修**: search entity loop 内で非独立 children を収集、text_fields を導出  
**dedup**: outer DISTINCT ON (entity_type, id) ORDER BY rank DESC を追加

**具体的な価値**:
- `purchase_per_item.name` を検索して `purchase_order` の詳細ページにヒット
- `receiving_*_line` を検索して受領書ページにヒット
- `dashboard_widget.name` で dashboard にヒット

**判断ポイント**: 検索エンティティの children に `organization_id` を持たないテーブルが多い。  
アクセス制御は親テーブルへの JOIN で行うと決定すれば実装は直線的。

---

### Phase 2: flatten non-m2o (中程度・Phase 1と共用実装)

**対象**: `get_flatten_rels()` で `is_m2o=False` かつ child の独立ページなし  
**実装**: Phase 1 の「直接FK → 親解決」パターンと完全に同じ  
**追加コスト**: `generate.py` で `flatten_rels` を検索 entity loop に統合するだけ  
**工数**: Phase 1 実装後であれば追加 1日程度

---

### Phase 3: 要設計 (comments, attachment.name, flatten m2o)

**comments**:
- ポリモーフィック CASE WHEN の自動生成ロジック設計が必要
- generator が `commentable` を持つ全 entity を収集する新しいスキャンが必要
- アクセス制御の 2ホップ JOIN 設計: comment → commentable → parent
- 殿裁可: 実装するかどうか, 対象 entity 絞り込み方針

**attachment.name**:
- comments と同構造 → 共用実装できれば追加コスト低
- ただし comments が Phase 3 以降なら自然と同時実装

**flatten m2o**:
- 実用ケースが少ない (m2o flatten は "parent extends child" パターンで稀)
- 設計対象として残すが Phase 3 以降

---

### 断念 (attachment.contents)

- PostgreSQL FTS はバイナリファイルのコンテンツを検索できない
- 外部サービス (Apache Tika, Elasticsearch) が必要
- generator のスコープ外 → 断念推奨 (cmd_248 調査確認済み)

---

## 5. 殿裁可が必要な決定点

| # | 対象 | 決定内容 | 推奨 |
|---|------|----------|------|
| D-1 | inline grid + embedded list | Phase 1 として実装するか | **実装推奨** — 直接FK, 2-3日, 高価値 |
| D-2 | flatten non-m2o | Phase 2 として実装するか (Phase 1 と共用) | **実装推奨** — Phase 1 実装後に追加1日 |
| D-3 | flatten m2o | Phase 3 で実装するか、延期・断念か | **延期推奨** — 実用ケース少ない、複雑 |
| D-4 | comment | Phase 3 で実装するか、延期・断念か | **要設計** — 価値は高いが工数大。ポリモーフィックACL設計が先決 |
| D-5 | attachment.name | comments ② と同時実装するか、延期か | **comments と同時推奨** (共用実装で追加コスト低) |
| D-6 | attachment.contents | 断念確定か | **断念推奨** — FTS非対応、外部サービス要 |
| D-7 | dedup設計 | 親+子が両方ヒット時の重複除去方針 | **DISTINCT ON 推奨** — outer query でシンプルに解決 |
| D-8 | ACL方針 | 子テーブルに org_id 無し → 親JOIN方式の採用 | **親JOIN推奨** — 子のアクセス制御は親に委譲 |

---

## 付録A: 主要コード参照

| コード箇所 | 内容 |
|-----------|------|
| `generate.py:260-296` | `_derive_text_fields`: 検索対象フィールド自動導出 |
| `generate.py:680-795` | search entity 収集ループ (拡張対象) |
| `templates/search_helpers.ts.jinja2:52-110` | エンティティごとの UNION ALL subquery ブロック (新ブロック追加対象) |
| `templates/search_helpers.ts.jinja2:117` | `Prisma.join(subQueries, ' UNION ALL ')` (dedup wrapper 追加対象) |
| `build_context.py:156-161` | `is_independent` 判定ロジック |
| `build_context.py:331-365` | `get_flatten_rels()` / flatten 種別判定 |
| `generate_types.py:48-79` | `_extract_children()`: children 収集 |
| `app/[locale]/search/page.tsx:162` | URL 解決 `/${item.entity_type}/view/${item.id}` |

## 付録B: 実装時の注意事項

1. **子テーブルの text_fields**: 子 entity に `organization_id` などの FK が混在する。`_derive_text_fields` の除外ルールを適用すれば自動的にノイズ除去される。
2. **dedup の snippet**: 親と子の両方がヒットした場合、どちらの snippet を採用するかは rank 順 (DISTINCT ON の選択) で決まる。高 rank の snippet が表示される。
3. **Phase 1 の ACL**: 子テーブルの多くが `organization_id` を持たない。親テーブルへの JOIN でのアクセス制御は、`generate.py` で親の `should_filter_by_org` / `has_assignee_id` を子の subquery 生成にも引き継ぐことで対応。
4. **SQL injection 対策**: 子テーブル名 / 親テーブル名はすべて generator 生成時に静的に展開される。Prisma.sql テンプレートリテラルで bind される値はクエリパラメータのみ — 現行設計の踏襲で安全。
