# app-generator 現挙動調査: 検索スコープ・attachable 両field

調査対象: `~/work/generated-apps/app-template/app-generator/` (rebase/app-generator-wip branch)
調査日: 2026-06-29

---

## 設問① 検索スコープ

### 結論

| 対象 | 判定 | 理由 |
|------|------|------|
| embedded entity のフィールド | **未実装/設計上の省略** | 単一テーブルのみスキャン。JOIN 未実装 |
| comment の本文 | **未実装/設計上の省略** | comment は別エンティティ。親エンティティ検索では対象外 |
| attachment のファイル名 | **未実装/設計上の省略** | `attachment` テーブルはオプトインなし。`name` フィールドは未索引 |
| attachment のファイル内容 | **技術的に未実装** | PostgreSQL FTS はバイナリファイルの内容を検索できない |

### コード根拠 (generators.py / generate.py / templates)

**`_derive_text_fields` — フィールド導出ロジック**

`generate.py:260-296`

```python
def _derive_text_fields(properties: dict) -> list[str]:
    """Auto-derive searchable text fields from entity properties.

    Excludes noise (id, FK, enum, CUID pattern, date/uri format, write-only)
    and per-field opt-outs (x-search: false).
    """
    # ... properties はエンティティ自身の base_def.properties のみ
```

呼び出し箇所 `generate.py:715-716`:

```python
# DP-1: auto-derive from base entity string properties (noise + sensitive excluded)
base_props = (base_def if isinstance(base_def, dict) else {}).get('properties', {})
text_fields = _derive_text_fields(base_props)
```

`base_def` は `schema['definitions'][model]` — **エンティティ自身の基底定義のみ**。
embedded child や comment、attachment テーブルの properties は ここに含まれない。

**除外ルール一覧** (`generate.py:272-294`):

| 除外条件 | コード |
|----------|--------|
| `id` または `x-primary` | line 273 |
| FK フィールド (`x-relationship` または `*_id`) | line 276 |
| enum フィールド | line 279 |
| CUID パターン文字列 | line 282-284 |
| date/time/uri フォーマット | line 286 |
| write-only フィールド | line 289-291 |
| `x-search: false` 個別オプトアウト | line 293 |

**実証: `resource` の検索クエリ** (`lib/search/helpers.ts:1054-1088`)

```sql
SELECT 'resource', id, ...
FROM "resource"
WHERE to_tsvector('simple', COALESCE(name, '') || ' ' || COALESCE(description, '')) ...
```

→ `resource` 行の `name`・`description` のみ検索。`attachment` テーブルへの JOIN なし。

**`attachment.path` が text_fields から除外される理由:**

`attachment` スキーマ (`json_schema.yaml:612`):
```yaml
path:
  type: string
  format: uri    # ← format: uri → _derive_text_fields が除外 (generate.py:286)
```

**`attachment.name` が索引されない理由:**

`json_schema.yaml` の `attachable` / `attachment` 定義に `x-generate.search: true` が設定されていない。`generate.py:703-704`:
```python
else:  # opt_in
    is_search = explicit_search is True   # None → skip
```

### 詳細分析

#### embedded entity の扱い

generator における「embedded entity」は `x-outputType: flatten` を持つ子エンティティ。  
子エンティティは **独立したデータベーステーブル** を持ち、`base_def.properties` には現れない。  
親エンティティの UNION ALL クエリは自テーブルのみを `FROM "parent"` で参照する (`search_helpers.ts.jinja2:100`)。

**判定: 未実装/設計上の省略**  
`docs/search-strategy.md` の限界一覧に明記:
> b) 関連エンティティ非対応: `include` した関連先フィールドを `buildFilter` の対象にできない

#### comment の扱い

comment は `commentable` bridge を介した **独立エンティティ** (テーブル: `comment`)。  
comment の `content` フィールドは `resource` や `product` の `base_def.properties` に含まれない。  
`comment` エンティティ自体に `x-generate.search: true` を付ければ comment は別途索引可能だが、  
その場合も「resource 検索 → resource に紐づく comment がヒット」という横断検索にはならない  
(UNION ALL の各サブクエリは独立したエンティティのみを対象にする)。

**判定: 未実装/設計上の省略**

#### attachment ファイルの扱い

`attachment` テーブルの有用フィールド:
- `name` (string): ファイル名 — `x-generate.search` なしで索引対象外
- `path` (string, format: uri): ファイル URL — format: uri 除外ルールで対象外
- `type` (integer enum): image/file/video/audio — enum 除外ルールで対象外

owning entity (`resource`, `product`) の search クエリは自テーブルのみ。  
attachment の `name` (ファイル名) を検索対象にするには `attachment` エンティティへの  
`x-generate.search: true` と UNION ALL 参加が必要だが、現状どちらもない。

**判定: 未実装/設計上の省略**

### 影響

| 影響 | 内容 |
|------|------|
| ユーザー | `resource` に `"仕様書.pdf"` を添付しても `GET /api/search?q=仕様書` でヒットしない |
| ユーザー | `booking` に comment を書いても comment 本文は全文検索対象外 |
| 開発者 | `x-generate.search: true` で索引したエンティティの「直接フィールド」のみが対象と理解する必要がある |

### 推奨

| 対象 | 推奨 | 理由 |
|------|------|------|
| attachment ファイル名 | **修正要** (優先度低) | `attachment` エンティティに `search: true` を追加し UNION ALL 参加させれば対応可能。ただし attachment 単体としてヒットする形になる |
| comment 本文 | **現状維持 or 修正要** | comment エンティティに `search: true` 追加で対応可能。親エンティティとの紐付けはファセットで表現 |
| embedded entity フィールド | **現状維持** | embedded は独立ページを持つエンティティ。それ自体に `search: true` を設定する設計が自然 |
| attachment ファイル内容 | **現状維持** | PostgreSQL FTS はバイナリ非対応。外部サービス (Apache Tika 等) が必要で scope 外 |

---

## 設問② attachable images/attachments 片方のみ表示設定

### 結論

**不可 (現状)**  
`AttachmentSection` コンポーネントは images と files の両セクションを**常に両方**レンダリングする。  
片方を抑止するフラグは schema にも component にも存在しない。

### 両fieldが派生する仕組み

**`AttachmentSection` の実装** (`app-generator/components/_standard/AttachmentSection.tsx`)

```tsx
const TYPE_IMAGE = 0;
const TYPE_FILE  = 1;

// 全 attachments をフィルタして両セクションに分割
const initialImages = all.filter((a) => a.type === TYPE_IMAGE).map(toItem);  // line 56
const initialFiles  = all.filter((a) => a.type === TYPE_FILE) ...map(toItem); // line 57-60

return (
  <Box>
    <EditableListWrapper        // images セクション (常に表示) — line 99-108
      ref={imagesRef}
      fileVariant="image"
      title={tf('images') ?? 'Images'}
    />
    <OrderedEditableListWrapper // files セクション (常に表示) — line 109-118
      ref={filesRef}
      fileVariant="file"
      title={tf('attachments') ?? 'Attachments'}
    />
  </Box>
);
```

**スキーマでの宣言方法** (`json_schema.yaml:1394-1419`, `1658-1679`)

```yaml
resource_detail:
  x-custom-components:
    - name: AttachmentSection
      path: "@/components/_standard/AttachmentSection"
      target:
        - view
        - edit
```

`x-custom-components` は component 名とパスのみ指定可能。props の渡し方は schema 上未定義。

**generator 側の処理** (`build_context.py:983-1010`)

```python
_xcc_items.append({
    'name': _item['name'],
    'path': _item.get('path'),
    'target': _item.get('target') or ['list'],
})
# ... props は保存されない
```

### 現状の設定可否

**既存フラグで不可**。以下をすべて確認:

| 確認項目 | 結果 |
|----------|------|
| `x-show-images` / `x-show-attachments` フラグ | 存在しない |
| `x-attachable-config` 設定キー | 存在しない |
| `AttachmentSection` の props | `showImages` / `showFiles` 等の抑止 prop なし |
| `x-custom-components` の `props` フィールド | generator が未サポート |

### (不可の場合) 追加設計案

#### オプション A: `AttachmentSection` に props 追加 (最小変更)

**改修箇所 1: `AttachmentSection.tsx`**

```tsx
type Props = {
  src: { ... };
  permissions?: ModelPermissions;
  showImages?: boolean;   // 追加 (default: true)
  showFiles?: boolean;    // 追加 (default: true)
};

export default function AttachmentSection({ src, permissions, showImages = true, showFiles = true }: Props) {
  return (
    <Box>
      {showImages && <EditableListWrapper ref={imagesRef} ... />}
      {showFiles  && <OrderedEditableListWrapper ref={filesRef} ... />}
    </Box>
  );
}
```

**改修箇所 2: `json_schema.yaml` 拡張**

```yaml
x-custom-components:
  - name: AttachmentSection
    path: "@/components/_standard/AttachmentSection"
    target: [view, edit]
    props:
      showImages: false   # ← 追加 (images セクションを非表示)
      showFiles: true
```

**改修箇所 3: `build_context.py:989-997`**

```python
_xcc_items.append({
    'name': _item['name'],
    'path': _item.get('path'),
    'target': _item.get('target') or ['list'],
    'props': _item.get('props') or {},   # ← 追加
})
```

**改修箇所 4: templates (`page_view.tsx.jinja2`, `page_edit.tsx.jinja2`, `form_upsert.tsx.jinja2`)**

```tsx
// 現在の生成コード (props なし)
<AttachmentSection src={src} permissions={permissions} />

// 改修後 (props を注入)
<AttachmentSection src={src} permissions={permissions} showImages={false} showFiles={true} />
```

Jinja2 テンプレートで `comp.props` を展開して JSX 属性に変換する処理を追加。

#### オプション B: コンポーネント分割 (後方互換性重視)

`AttachmentSection` (既存: 両方) に加えて、以下を標準コンポーネントとして追加:
- `ImageOnlySection` — images のみ
- `FileOnlySection` — files のみ

schema 著者が目的に合ったコンポーネントを `x-custom-components` で選択する。  
generator 側の改修なし。

**既定値と後方互換:**
- 既存の `AttachmentSection` はそのまま (両方表示) → 後方互換
- オプション A の場合: `showImages=true, showFiles=true` がデフォルト → 既存動作維持

### 影響

| 影響 | 内容 |
|------|------|
| 現状 | 画像のみ添付したいエンティティでもファイルアップロード欄が常時表示される |
| 現状 | ファイルのみ扱うエンティティでも画像アップロード欄が常時表示される |
| UX | 意図しないファイルタイプのアップロードボタンがユーザーに混乱を与える可能性あり |

### 推奨

**設定追加を推奨 (オプション A)**

理由:
- オプション A はコンポーネント1ファイル + generator 3箇所の小変更で実現可能
- `x-custom-components.props` は汎用拡張点として他コンポーネントでも再利用できる
- 後方互換: `showImages`/`showFiles` のデフォルトは `true` のため既存エンティティへの影響なし
- オプション B は component ファイルが増殖しやすい (3種類 → 今後さらに増える可能性)

---

## 横展開への示唆 (proj_a/proj_b/proj_f への影響)

| プロジェクト | 影響 |
|------------|------|
| proj_a (app-generator-1) | 検索スコープの制約は同一。attachment を検索に含めたい場合は `attachment` entity に `x-generate.search: true` 追加を検討 |
| proj_b (app-generator-2) | `AttachmentSection` は同一コンポーネント。設問② の設計変更は proj_b で実装 → proj_a へ横展開 |
| proj_f (app-template-3) | app-generator-1 ベース。検索スコープ制約は同一。comment (cry_post 等) を検索に含めるには別途 `search: true` 設定が必要 |

---

## 殿裁可が必要な決定点

| # | 設問 | 決定内容 | 推奨 |
|---|------|----------|------|
| D-1 | ① | attachment ファイル名を検索対象に追加するか | 修正要 (低優先度) — `attachment` エンティティに `search: true` 追加 |
| D-2 | ① | comment 本文を検索対象に追加するか | 修正要 or 現状維持 — `comment` エンティティに `search: true` 追加 |
| D-3 | ② | `AttachmentSection` に `showImages`/`showFiles` props を追加するか | 推奨: 追加 (オプション A) |
| D-4 | ② | props 追加と同時に `x-custom-components.props` を generator がサポートするか | 推奨: サポート追加 (汎用拡張点として有用) |
