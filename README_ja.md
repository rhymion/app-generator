> **Note:** This is the Japanese translation of README.md.
> The English version is the authoritative document.
> 本文書は README.md の日本語訳です。正式な文書は英語版です。

# Rhymion App Generator — スキーマ駆動型 Web アプリケーションジェネレーター

YAML スキーマ定義から本番対応の Web アプリケーションを生成します。データモデルと画面レイアウトを一度記述するだけで、完全な Next.js アプリケーション（CRUD ページ一式、REST API、ロールベースアクセス制御、テナント対応バックエンド、多言語対応）が生成されます。

[Next.js](https://nextjs.org/)、[Prisma](https://www.prisma.io/)、[MUI](https://mui.com/) で構築されています。

> **旧バージョンからのアップグレードをお考えですか？** 3.0 の破壊的変更と移行手順は [docs/UPGRADE-3.0.md](docs/UPGRADE-3.0.md) を参照してください。

---

## 機能

### コード生成

- **スキーマ駆動生成** — YAML スキーマ (`code_generator/json_schema.yaml`) + Prisma スキーマ → Python パイプラインによる TypeScript、React、Cypress ファイルの生成
- **CRUD ページ一式** — エンティティごとに一覧、詳細、作成、編集、削除ページを生成
- **ガントチャートビュー** — エンティティ単位でオプトインできるガントチャートページ
- **REST API** — エンティティごとに API キー認証付き JSON エンドポイントを生成
- **Cypress テスト生成** — アプリケーションコードと並行して UI および API テストスイートを生成
- **ダッシュボードチャート** (`x-display.dashboard: true`) — カラム・バー・ライン・パイチャートのレンダリングを生成；スタッキングモード・タイムスタンプバケット・型付きフィルター・CSV/Excel エクスポート・REST アグリゲートエンドポイント（`/api/{entity}/aggregate`）をエンティティごとに生成
- **インベントリ予約** (`x-reservation`) — 容量・在庫管理のためのスキーマレベルのオプトイン；`count` モードは数値カウンターカラムを条件付き UPDATE で予約し、`item` モードは `inventory_allocation` ブリッジテーブルで行ロックを実施
- **ラッパーコンポーネントアーキテクチャ** — エンティティごとに生成されたコンポーネントが `components/_standard/` の共有ラッパーを使用（静的提供；`generate-code` 再実行で上書きされない）、生成コンポーネントは `@mui/*` の代わりに `components/ui/` の共有 `App*` ラッパーを import するため、自動生成コードが MUI に直接依存しなくなりました（プロバイダー設定を除く）
- **エンティティ横断全文検索** (`x-generate.search: true`) — 検索可能なエンティティが存在する場合に `GET /api/search` REST エンドポイントとグローバル検索 UI ページ（`app/[locale]/search/page.tsx`）を生成；オプトインしたエンティティ全体への UNION ALL クエリで、エンティティごとにテナント・権限フィルターを適用；pg_bigm による日本語 2-gram 検索；ファセット（エンティティタイプ別ヒット件数）と XSS セーフなスニペットハイライト
- **`x-ui.rows`** — スキーマの `x-ui: { rows: N }` で任意の文字列フィールドのテキストエリア行数を制御
- **FK スカラーの自動推論** — FK スカラーカラム（例: `organization_id`）を `code_generator/json_schema.yaml` に明示宣言する必要がなくなり、Prisma のリレーション定義から自動導出
- **FK オートコンプリートのカスタムフィルターフック**（`autocomplete_filter_stub.ts.jinja2`） — 組み込みの権限フィルターを超えてオートコンプリート・一覧結果を絞り込むためのエンティティごとのワンスタブ

### リレーションシップ

- 多対1、多対多、1対1、自己参照リレーションシップ
- インライン DataGrid による子エンティティと埋め込みリスト
- 独立した子エンティティ（専用ページ付き）
- **ブリッジパターンの汎用化** — 実 1対1・ポリモーフィックリレーションを内部スルーテーブル（`<model>able`）で実現する再利用可能なスキーマレベルのブリッジ。親に余分な FK カラムを追加せず親オートコンプリートも維持、内部ブリッジテーブルは JSON スキーマ出力から除外

### 認証・認可

- メール/パスワード認証
- Google SSO（Auth.js v5）
- アカウントリンク（ユーザーごとに複数の OAuth プロバイダー）
- ロールベースアクセス制御（モデルごとの CRUD 権限）
- 作成者/担当者ベースのアクセス制御
- `x-self-only` — 権限設定に依存しないユーザー単位のデータ分離。作成者/担当者スコープ(権限付与で緩められる設定値)と異なり、`x-self-only` を宣言したエンティティは常に自分が作成した行のみへアクセス可能で、`admin_bypass: true` により特権ロールへ監査付きの例外アクセスを許可できます。詳細は [`docs/knowledge/self-only-entity.md`](docs/knowledge/self-only-entity.md) を参照してください
- 組織スコープフィルタリング — organization_id を持つエンティティは、ユーザーが所属する組織に自動的にフィルタリングされます。CSV インポートのドット付き自然キー FK 解決（例: `role.name`）も、参照先エンティティ自体が組織スコープを持つ場合は同様にフィルタリングされます。詳細は [`docs/knowledge/csv-import-dotted-fk-org-filter.md`](docs/knowledge/csv-import-dotted-fk-org-filter.md) を参照してください
- 表示ラベルが複合または複数階層（ドット区切り）のFK列に対するCSVインポート — 事前構築したルックアップマップに対しレンダリング済みラベル全文を照合して解決します（行単位の `NOT_FOUND`/`MULTI_MATCH` エラー、組織分離対応）。詳細は [`docs/knowledge/csv-import-composite-labelfield.md`](docs/knowledge/csv-import-composite-labelfield.md) を参照してください
- FK 参照先の閲覧権限が不足している場合のグレースフルデグラデーション — あるロールがエンティティの作成・編集はできても、その FK 参照先の閲覧権限がない場合（例: `approval_flow` は管理できるが `role` は閲覧できない）、該当フィールドはページをクラッシュさせず無効化表示になります。権限付与の際は [`docs/knowledge/fk-read-permission-graceful-degradation.md`](docs/knowledge/fk-read-permission-graceful-degradation.md) を参照してください
- `x-server-value` — 常にサーバー側で計算される値を持つフィールド（現状は `source: actor`、認証済みユーザーのID）で、クライアントからは書き込み不可、かつ自動的に読み取り専用になります。dict形式では委任機能を追加できます: `{source: actor, override_permission: <Operation>}` により、その権限を持つ actor は作成時に明示的な値を指定でき（例: 管理者が他者の代わりに申請する場合）、権限を持たぬ actor が値を送った場合はリクエスト失敗ではなく自分自身のIDへ静かに置き換えられ、この置き換えの有無はレスポンスの `_server_value_overrides` フラグで判別できます。委任を伴わぬ通常の `x-readonly`/`x-readonly-fields` フィールドは、作成時にクライアントが何らかの値を送ると即座に拒否されます — CREATE には PUT と異なり比較対象となる既存行が無いため、更新時の不一致と違い妥当な代替値が存在しないためです。詳細は [`docs/knowledge/x-server-value-actor-delegation.md`](docs/knowledge/x-server-value-actor-delegation.md) を参照してください

### 組み込みシステム

- **コメントスレッド** — ポリモーフィックブリッジパターンにより、任意のエンティティにコメントスレッドを付与。リアクションボタン対応（トグルエンドポイント・バッチ集計・親オーナー read 認可）
- **添付ファイル管理** — ポリモーフィックブリッジ経由のファイル・画像アップロード；画像・ファイルのプレビューはエンティティごとに個別にオプトアウト可能（`AttachmentSection` の `showImages`/`showFiles` props、両方デフォルト `true`）
- **インベントリ予約** — スキーマレベルの `x-reservation` による容量・在庫管理（count モードと item モード）；予約元エンティティのライフサイクル遷移は独自の予約ライフサイクル機構ではなく承認フローシステムの承認/（terminal）却下を経由
- **インベントリ台帳**（`x-ledger-source`） — スキーマにledgerトップレベル宣言がある場合に生成される `inventory_transaction` 台帳エンティティと `transactionable` ブリッジ；入荷伝票や請求明細エンティティに `x-ledger-source` を付与すると write/adjust/move のスタブテンプレートを生成
- **入荷ワークフロー** — 入荷伝票スキーマ向けに生成される `ledger` / `transactionable` / `pool` トップレベルエンティティ宣言と入荷確定ルート
- **分割アクション**（`x-splittable`） — エンティティに付与すると、一覧・編集ページからロット単位の分割操作を行う分割アクション UI セクションと API ルートを生成
- **ダッシュボードチャート** — スキーマから生成されるエンティティごとのチャートウィジェット（カラム・バー・ライン・パイ）；スタッキング・時間バケット・型付きフィルター・CSV/Excel エクスポート・REST アグリゲートエンドポイント
- **エンティティ横断検索** — オプトインしたエンティティへの UNION ALL による `GET /api/search`；ファセット・ハイライト・日本語 pg_bigm 対応；ヘッダー検索アイコンと検索ページを生成
- **承認後イベント発火** — `x-approval.on_approved.set_fields`（フィールド更新）および `x-approval.on_approved.emit_hook`（生成 `service_after_approve.ts` による カスタムロジック）；`approvable.approved_at` による冪等性保証。`x-approval-lines` は承認明細エンティティをインベントリ台帳操作に接続する作成前後のヘルパーを生成
- **終端却下**（`x-readonly-fields`） — エンティティが終端の却下状態に達した後にフィールドをロックするための注釈；却下時は `on_rejected_dispatch` 経由でワンスタブ（`service_after_reject_stub.ts`）を発火し、通知や在庫調整などのカスタムロジックに対応

### パフォーマンス

- 高速 TTFB のためのストリーミング Suspense
- ローディング中のスケルトン画面
- データと権限の並列フェッチ
- 直結接続パスにおけるクエリタイムアウトの設定（`STATEMENT_TIMEOUT_MS`、デフォルト30秒、`0` で無効化）
- FK インデックスの自動網羅と、検索用の pg_trgm GIN インデックス自動生成
- 検索の `COUNT(*)` オプトアウト（`SearchOpts.count: false`）で大量結果時に2本のCOUNTクエリをスキップ

### セキュリティ

- レート制限（Redis、インメモリフォールバック付き）
- CSRF 保護
- Prisma によるパラメータ化クエリ

### デプロイメント

- **GCP Cloud Run**（`x-cloud` アノテーション、オプトイン） — マルチステージ `Dockerfile`、GCS バックエンドのアップロード（Signed URL アップロード + プロキシルート）、冪等な環境自動化スクリプト（`gcp-env.sh`、`gcp-setup.sh`、`gcp-deploy.sh`、`gcp-seed.sh`、`gcp-teardown.sh`）；`x-cloud` 未指定時は Vercel がデフォルトのまま

### 監査・コンプライアンス

- **監査ログ** — 全エンティティの作成・更新・削除操作を横断表示する、スキーマ非依存の read-only ビューア（`app/[locale]/audit_log/page.tsx`）
- **GDPR / データ保護** — `x-pii` フィールド分類（`direct`/`sensitive`/`indirect`）、`anonymizeUser()` 消去関数、`x-gdpr-mode` によるデータ主体区分の分類（`internal`/`consumer`/`both`。スキーマ検証のみで生成コードへの反映は未実装）、添付ファイル名の AES-256-GCM at-rest 暗号化、コメント内の `x-mention` ユーザーメンション解析
- **利用規約 / プライバシーポリシー**（`/[locale]/legal/terms`、`/[locale]/legal/privacy`）— 登録画面から導線を張ったMarkdown雛形文書。文書の言語追加は `content/legal/<doc>.<locale>.md` ファイルを追加するのみで、サイトUIの言語一覧とは独立（詳細は `docs/knowledge/legal-documents.md`）

### その他

- 国際化（英語・日本語、next-intl v4）
- ダークモード（システム連動、SSR セーフ）
- 生成コードを上書きせずにカスタマイズできる 5 つの拡張ポイント

---

## ロードマップ

これらの機能は部分的に実装されており、現在も開発中です。

### マルチテナント（テナントレベルの分離）
**動作するもの:** `tenant` モデルが name、slug、status フィールドとともに存在します（Phase 1.1）。すべてのユーザーは `tenant_id` でテナントに紐付けられています（Phase 1.2）。組織スコープフィルタリング（独立した動作中の機能）がサブテナントのデータグループ化を提供します。

**未実装のもの:** 生成コードは `tenant_id` によるフィルタリングを行いません。マルチテナントロードマップの Phase 1.3〜4.3 はまだ実装されていません: 認証セッションでのテナント解決、テナント対応コード生成テンプレート、クロステナント分離テスト、招待制サインアップ。現在、同一デプロイメントの異なるテナントのユーザーはお互いのデータにアクセスできます。詳細な段階的計画はplanning docとしてcommit b11269bで削除済み。`git show b11269b^:docs/multi-tenancy.md` で復元可能。

### MFA / 二要素認証

**動作するもの:** TOTP 認証ロジック、暗号化シークレットストレージ（AES-256-GCM）、リカバリーコード（登録ごとに 8 件、bcrypt ハッシュ化）が `lib/mfa/` に実装されています。セルフサービスによる登録と無効化は `/setting/mfa` で利用できます。

**注:** リカバリコードはログイン時の標準 MFA コード入力欄に入力できます。
専用のリカバリコード専用フォームはなく、TOTP コードとリカバリコードの両方を
同一フィールドで受け付けます。

### 承認フロー

**動作するもの:** 設定可能なフロー（`approval_flow`）、ステータス管理（`pending`/`approved`/`rejected`/`terminal_rejected`）、監査証跡（`approval_history`）、ロールベースの承認・却下権限を備えた完全な承認ワークフローが実装されています。また、承認後イベント発火（`x-approval.on_approved.set_fields` によるフィールド更新、`x-approval.on_approved.emit_hook` による生成 `service_after_approve.ts` カスタムロジック）と却下イベント発火（`on_rejected_dispatch`、生成 `service_after_reject_stub.ts` とペア）もサポートしています。`x-readonly-fields` はエンティティが終端の却下状態に達した後、指定フィールドをロックします。

**未実装のもの:** 複雑なマルチステップオーケストレーション（例：承認を外部ワークフローにチェーン、予約変更の自動起動）はカスタムロジックを各ワンスタブに実装する必要があります。

---

## アーキテクチャ概要

このプロジェクトのコアは Python コード生成パイプラインです。単一の YAML スキーマファイルがジェネレーターを駆動し、TypeScript、React、Cypress ファイルを出力します。

```
code_generator/json_schema.yaml
        │
        ▼  npm run generate-code
        │
        ├── generate_types.py    — エンティティ抽出
        ├── build_context.py     — ベースコンテキストビルダー
        ├── generators.py        — ページ/サービス/列定義/チャートコンテキスト
        ├── generators_i18n.py   — i18n メッセージキー + next-intl 設定
        ├── generators_test.py   — Cypress ヘルパー/スペック/API スペックコンテキスト
        ├── generators_doc.py    — ドキュメントエンティティ/インデックスページ
        ├── validate.py          — スキーマ + Prisma インデックス検証
        └── templates/*.jinja2   — Jinja2 テンプレート（出力ファイルタイプごと）
```

`code_generator/json_schema.yaml` で定義された各エンティティに対して、パイプラインは CRUD ページ、サービス/ゲッターモジュール、API ルート、Cypress テストスペック、エンティティドキュメントを生成します。生成されたファイルは毎回の実行で上書きされます — カスタマイズは指定の拡張ポイント（`lib/{entity}/service_after_create.ts`、`components/_standard/`、`custom/`）に配置してください。

パイプライン全体のリファレンスおよび生成コードと手書きコードの境界については [docs/knowledge/architecture-overview.md](docs/knowledge/architecture-overview.md) を参照してください。

---

## はじめに

### 前提条件

| ツール | 用途 | 最低バージョン |
|------|---------|----------------|
| [Git](https://git-scm.com/downloads) | リポジトリのクローン | 任意 |
| [Node.js](https://nodejs.org/) | Next.js アプリケーションの実行 | 20 LTS |
| [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) | JavaScript 依存パッケージのインストール | 10 |
| [Python 3](https://www.python.org/downloads/) | コードジェネレーターの実行 | 3.10+ |
| [pip](https://pip.pypa.io/en/stable/installation/) | Python 依存パッケージのインストール | 任意 |
| [Docker](https://docs.docker.com/get-docker/) | PostgreSQL・Redis コンテナの実行 | 任意 |

### インストール

```bash
git clone git@github.com:rhymion/app-generator.git
cd app-generator

# JavaScript 依存パッケージ
npm install

# Python 依存パッケージ
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### AUTH_SECRET の設定（必須）

`AUTH_SECRET` は必須です — 未設定の場合、Auth.js が `MissingSecret` エラーで起動を拒否します。

以下のコマンドでシークレットを生成してください:

```bash
openssl rand -base64 32
```

生成した値を `.env.development`（ローカル開発用）と `.env.test`（E2E テスト用）に追加してください。本番環境では Vercel ダッシュボードで設定します。

### クイックスタート（コマンド一発）

依存パッケージのインストール後、一つのコマンドでデータベースの起動、コード生成、マイグレーション実行、シーディング、開発サーバー起動まで完了します:

```bash
npm run dev:full
```

`dev:full` の実行順序: `docker:up:dev` → `generate-code` → `migrate:dev` → `db:generate` → `db:seed-tenant` → `dev`

本番ビルドの場合:

```bash
npm run build:full
```

`build:full` の実行順序: `docker:up:prod` → `generate-code` → `migrate:deploy` → `db:generate` → `db:seed-tenant` → `build`

> **重要**: `build:full` を初めて実行する前に、`dev:full` を少なくとも一度実行してください。`dev:full` は `migrate:dev` を使用して Prisma マイグレーションファイルを作成します。`build:full` が使用する `migrate:deploy` は既存のマイグレーションファイルを適用するだけです。

または、以下の手順に従って段階的に実行することもできます。

### 開発用データベースの起動

```bash
npm run docker:up:dev    # postgres-dev を起動（ポート 5433、DB: my_next_dev）
```

### コード生成・スキーマ反映・シーディング

```bash
npm run setup            # generate-code → db:push → db:generate → db:seed-tenant
```

### 開発サーバーの起動

```bash
npm run dev              # ポート 3001 で Next.js 開発サーバーを起動
```

[http://localhost:3001](http://localhost:3001) を開いてアプリケーションを確認してください。サーバー起動後、[http://localhost:3001/docs](http://localhost:3001/docs) で生成されたエンティティドキュメントを閲覧できます（現在英語のみ）。

```bash
npm run docker:down:dev  # 作業終了時にデータベースを停止
```

---

## ベースプロジェクトとしての使い方

このジェネレーターをご自身のアプリケーションの基盤として利用したい場合は [app-template](https://github.com/rhymion/app-template) を参照してください。app-template は app-generator を submodule として取り込む thin wrapper で、プロジェクト固有のスキーマ定義とカスタムコードをその上に追加する構成になっています。

---

## 組み込みシステム

### 承認フロー

ステータス管理（`pending`/`approved`/`rejected`/`terminal_rejected`）と完全な監査証跡を備えた、マルチステップかつロールベースの承認ワークフローです。承認・終端却下のいずれも、フィールド更新や在庫調整などのダウンストリーム処理のためのワンスタブフック（`x-approval.on_approved`、`on_rejected_dispatch`）を発火します。`x-readonly-fields` は終端却下後にフィールドをロックします。未実装の部分（マルチステップのクロスワークフローオーケストレーション）はロードマップセクションを参照してください。

[docs/knowledge/appendix/approval-flow.md](docs/knowledge/appendix/approval-flow.md) を参照してください。

### コメントスレッド

ポリモーフィックブリッジパターンにより、各エンティティのスキーマを変更することなく任意のエンティティにコメントスレッドを付与できます。コメントは詳細ページにインラインで表示され、各コメントにはリアクションボタンを付与できます（コメントごとのトグルエンドポイント・バッチ集計・親オーナー read 認可）。

`x-mention: true` を付与したコメントフィールドには `@mention` 機能も付与されます: 所属組織で絞り込んだ候補検索（`MentionInput`）、GDPR安全なIDベースの保存形式（`@[user_id:<id>]`）、閲覧権限に応じたプロフィールリンク表示（`MentionText`）、新規メンション相手への通知（自己メンションは除外・編集時は新たに追加されたメンションのみ通知）。他の任意エンティティのフィールドに `x-mention: true` を付与した場合も、編集フォームに `MentionInput` ピッカーが付与されます。

[docs/knowledge/appendix/comment-bridge.md](docs/knowledge/appendix/comment-bridge.md) および [docs/knowledge/mention-system.md](docs/knowledge/mention-system.md) を参照してください。

### 添付ファイル管理

デフォルトでは Vercel Blob をバックエンドとした、ポリモーフィックブリッジ経由のファイル・画像アップロードです（`x-cloud` による GCP デプロイ有効時は GCS バックエンド — [デプロイメント](#デプロイメント)を参照）。オプトインしたエンティティの詳細ページにはファイル添付パネルが表示されます。画像・ファイルのプレビューはエンティティごとに個別に非表示にできます（`AttachmentSection` の `showImages`/`showFiles` props、両方デフォルト `true`）。

### インベントリ予約・分割・入荷

任意のエンティティがオプトインできる汎用プリミティブ — `x-reservation`、`x-splittable`、`x-ledger-source` — であり、在庫専用の機構ではありません。`x-reservation` は2つの役割に限定されます: インベントリ割当（`count` モード、数値プールから数量を予約）と特定リソースの予約（`item` モード、例：ホテルの部屋の予約）。`x-splittable` はライン明細を複数パートに分割し、各パートは明示指定または自動割当されたプール行から引き当てます。`x-ledger-source` は入荷伝票・請求明細エンティティ向けに `inventory_transaction` 台帳エンティティと write/adjust/move のスタブテンプレートを生成します。予約元エンティティの承認・却下は、独自の予約ライフサイクルではなく上記の承認フローシステムを経由します。

[docs/knowledge/appendix/inventory-reservation-split.md](docs/knowledge/appendix/inventory-reservation-split.md) を参照してください。

---

## セキュリティ

**レート制限**は API ミドルウェアの `getRateLimiter()` で処理されます。開発環境（`REDIS_URL` 未設定時）は自動的にインメモリリミッターにフォールバックします。テスト・本番環境では Redis を使用します。

**CSRF 保護**はすべての状態変更 API ルートに適用されます。

**組織スコープフィルタリング**はクエリレイヤーで適用されます: すべてのリストクエリに自動的な `organization_id` フィルターが適用され、データを認証済みユーザーの組織にスコープします。組織スコープエンティティの更新系操作（update/delete/CSV インポートによる更新）も、ID指定での組織跨ぎアクセスを拒否します — 他組織のレコードを対象としたリクエストは、`creator_id`/`assignee_id` の権限だけでは成功せず拒否されます（API ルートは `404`、セッションアクションはサイレントに no-op）。テナントレベルの分離（クロステナントのデータ分離）はまだ実装されていません — ロードマップセクションを参照してください。

**ロールベースアクセス制御**はスキーマでモデルごとに定義されます。`authz.ts` モジュールがすべてのリクエストに対してモデルごとの CRUD 権限を強制します。

**デフォルト拒否**: 新規ユーザーは権限ゼロで開始します。Administrator が明示的にロールを割り当てることで初めてアクセスが許可されます。`seed-tenant.ts` によってシードされる `Administrator` ロールはすべてのエンティティに対して完全な CRUD 権限を付与します。詳細は [docs/knowledge/authorization-default-deny.md](docs/knowledge/authorization-default-deny.md) を参照してください。

**未認証のページリクエスト**は、ページが描画される前に `proxy.ts` によって `/login` へリダイレクトされ、サインイン後は元のページへ戻ります(オープンリダイレクト対策済み — サイト外の `redirect` 値は拒否されます)。API ルートは影響を受けず、従来どおり JSON の `401`/`404` を返します。詳細は [docs/knowledge/unauthenticated-page-redirect.md](docs/knowledge/unauthenticated-page-redirect.md) を参照してください。

**生成される権限 E2E テスト**には、エンティティごとの権限拒否テスト(GET/POST/PUT/DELETE/export/import、4xx)と、組織境界をまたぐ作成・更新・参照を拒否するクロス組織分離テストが `cypress/e2e/api/<entity>.cy.ts` に含まれます。詳細は [docs/knowledge/permission-e2e-test-design.md](docs/knowledge/permission-e2e-test-design.md) を参照してください。

[docs/knowledge/multi-tenancy-and-permissions.md](docs/knowledge/multi-tenancy-and-permissions.md) を参照してください。

---

## 監査・コンプライアンス

**監査ログ** — `audit_log` モデル上に構築された、スキーマ非依存の read-only ビューア（`app/[locale]/audit_log/page.tsx`）で、全生成エンティティの作成・更新・削除操作を横断表示します。`lib/audit_log/getters.ts` が FK JOIN でアクター（実行ユーザー）を解決し、`CardListPagination` でページネーションします。生JSONの `metadata` は admin 専用の詳細ページでのみ表示されます。`audit_log` モデルのカラム自体は2.0.0以前から存在しますが、JOIN先である `actor_user` リレーション（`onDelete: Restrict` の外部キー制約含む）は3.0の新規追加です — 詳細は [docs/UPGRADE-3.0.md](docs/UPGRADE-3.0.md) を参照。

**GDPR / データ保護**:
- `x-pii` フィールド分類（`direct`/`sensitive`/`indirect`）が、消去（GDPR第17条・忘れられる権利）時に `anonymizeUser()` がスクラブするフィールドを決定します。このスクラブはトランザクション内で不可逆的に実行され、参照整合性を保つためユーザー行自体は削除せず、`user` モデルに `anonymized_at` を記録します。
- `x-gdpr-mode`（`internal`/`consumer`/`both`）はモデル/フィールド単位のデータ主体区分（対象が従業員データか一般消費者データか）を分類する注釈です。`code_generator/validate.py` でスキーマ検証はされますが、コード生成テンプレート側では未参照のため、3.0時点で生成コードへの影響はありません。
- 添付ファイル名は AES-256-GCM で at-rest 暗号化されます（`lib/compliance/attachment_name_crypto.ts`）。
- `x-mention` によりコメント内で `@[user_id:uuid]` メンション構文が有効になり、メンションパーサーが生成されます。

---

## パフォーマンス

- **ストリーミング Suspense**: ページが即座にブラウザへ HTML をストリームし、TTFB を削減します。データは Suspense 境界内で非同期に読み込まれます。
- **スケルトン画面**: 生成されたすべてのリスト・詳細ページは、データ読み込み中にスケルトンを表示してレイアウトシフトを防ぎます。
- **並列フェッチ**: データと権限チェックを `Promise.all` で並列フェッチし、サーバーへのラウンドトリップを最小化します。
- **クエリタイムアウト**（`lib/prisma.ts`）: 直結接続（PrismaPg）パスにはデフォルト30秒の `statement_timeout` が適用されます。`STATEMENT_TIMEOUT_MS` で設定変更可能（`0` で無効化）。Accelerate パス（Vercel）は `statement_timeout` を転送しないため対象外です。
- **FK インデックス網羅**: `scripts/add_required_indexes.py` が `@relation` の FK カラムを自動検出し `@@index` を追加します（ジェネレーターのデモスキーマは18本から36本へ増加）。
- **検索用 pg_trgm GIN インデックス**: `generate-code` が `scripts/create-gin-indexes.sql` を生成し、`psql` で手動適用します — `gin_trgm_ops` による `prisma migrate dev` のドリフトループを避けるため `prisma/schema.prisma` の外に置いています。
- **検索の `COUNT(*)` オプトアウト**: `SearchOpts.count: false` でエンティティ横断検索の2本の `COUNT(*)` クエリをスキップできます（`total: -1` を返却）。

[docs/knowledge/performance-improvements.md](docs/knowledge/performance-improvements.md) を参照してください。

---

## テストの実行

### ユニットテスト（Vitest）

```bash
npm run test
```

### Python ジェネレーターテスト（pytest）

```bash
npm run test:pytest
```

### リント

```bash
npm run lint
```

### E2E テスト — フルパイプライン

```bash
npm run test:e2e:build   # docker:up:test は自動起動; generate-code + db:push + db:generate + db:seed-tenant + build
npm run test:e2e:cy:api  # API のみの Cypress スペック
npm run test:e2e         # Cypress フルスイート（build + start + run）
npm run docker:down:test # テスト終了後にテスト用データベースを停止
```

### E2E テスト — ホットリロードモード

```bash
npm run test:e2e:dev     # docker:up:test は自動起動; 開発サーバーモード（ビルド不要）
npm run docker:down:test # テスト終了後にテスト用データベースを停止
```

`NODE_ENV=test` はすべての `test:e2e` スクリプトで自動的に設定されます — 手動での環境切り替えは不要です。

Cypress のパターンと CI/CD 設定については [docs/knowledge/testing-cypress.md](docs/knowledge/testing-cypress.md) を参照してください。

---

## 環境設定

Next.js は `NODE_ENV` に基づいて環境ファイルを自動的に読み込みます:

| ファイル | 環境 | 備考 |
|------|------------|-------|
| `.env` | 全環境 | 共通ベースライン（コミット済み） |
| `.env.development` | 開発 | PORT 3001、postgres-dev（ポート 5433） |
| `.env.test` | テスト/E2E | PORT 3000、postgres-test（ポート 5432）、redis-test（ポート 6379） |
| `.env.production` | 本番 | Vercel ダッシュボードで変数を設定（gitignore 済み） |
| `.env.local` | ローカル機密情報 | gitignore 済み；必要に応じて手動作成 |

主要な変数:

| 変数 | 開発 | テスト | 本番 |
|----------|------------|------|-----------|
| `PORT` | 3001 | 3000 | Vercel が割り当て |
| `DATABASE_URL` | `postgresql://…@localhost:5433/my_next_dev` | `postgresql://…@localhost:5432/my_next_test` | Vercel 環境変数 |
| `REDIS_URL` | 未設定（インメモリフォールバック） | `redis://localhost:6379` | マネージド |
| `AUTH_SECRET` | `.env.development` で設定 | `.env.test` で設定 | Vercel で設定 |
| `NEXTAUTH_URL` | `http://localhost:3001` | `http://localhost:3000` | 本番 URL |

手動での環境切り替えやシンボリックリンクは不要です。

### ポート番号の変更

ポート 3001（開発）または 3000（テスト）が他のアプリケーションと競合する場合は、該当する env ファイルの `PORT` を変更してください — `docker-compose.*.yml` の編集は不要です:

- 開発: `.env.development` に `PORT=<新しいポート番号>` を設定
- テスト: `.env.test` に `PORT=<新しいポート番号>` を設定

### ローカルでの本番ビルド

`build:full` をローカルで実行するには `.env.production` と `.env.production.local`（いずれも gitignore 済み）が必要です。ローカルで本番コードパスをテストする場合は、既存のテスト用コンテナを再利用できる `.env.test` + `docker-compose.test.yml` の組み合わせが手軽な代替手段です。

---

## デプロイメント

**Vercel** がデフォルトのデプロイ先です — 設定不要です。

**GCP Cloud Run** は `code_generator/json_schema.yaml` の `x-cloud` アノテーションによるオプトインです（デフォルトでコメントアウト）。`enabled: true` と `provider: gcp` の両方を明示指定した場合のみ有効化され、未指定であれば生成物に影響はありません。

有効化すると、`generate-code` は追加で以下を生成します:
- `HEALTHCHECK` 付きのマルチステージ・non-root `Dockerfile` および `.dockerignore`
- `output: 'standalone'` を設定した `next.config.ts`
- GCS Signed URL アップロードルート（デフォルトの Vercel Blob アップロードルートを上書き）と V4 Signed URL プロキシルート（`app/api/gcs/[...path]/route.ts`）
- Cloud Run 内部ポート `:8080` がリダイレクトの `Location` ヘッダーに漏出しないようにする `proxy.ts` のヘッダー書き換え

`scripts/` 配下の冪等な自動化スクリプトが GCP 側を駆動します:

| スクリプト | 用途 |
|---|---|
| `gcp-env.sh` | 環境変数の読み込み；シークレットの一度きり生成・永続化 |
| `gcp-setup.sh` | GCP インフラ（Cloud SQL、サービスアカウント、Upstash、Secret Manager、GCS）の冪等プロビジョニング |
| `gcp-deploy.sh` | イメージビルド・マイグレーション実行・Cloud Run へのデプロイ |
| `gcp-seed.sh` | データベースのシード |
| `gcp-teardown.sh` | GCP リソースの削除（2段階確認付き） |

GCP はデータベースに直結します（`DATABASE_URL`、`PrismaPg`、pooler 無し、`STATEMENT_TIMEOUT_MS` 適用）。Vercel は `PRISMA_DATABASE_URL`（Accelerate）を使用し、Accelerate は `statement_timeout` を転送しないため `STATEMENT_TIMEOUT_MS` は無効です。

詳細なランブックは [docs/knowledge/gcp-automation-design.md](docs/knowledge/gcp-automation-design.md) を参照してください。

---

## プロジェクト構成

```
app-generator/
├── app/                      Next.js App Router
│   ├── [locale]/             すべてのユーザー向けページ（ロケールプレフィックス付き URL）
│   │   ├── {entity}/         エンティティごとに生成された CRUD ページ
│   │   ├── docs/             自動生成されたエンティティドキュメント（MDX）
│   │   ├── login/            認証ページ（手書き）
│   │   ├── register/
│   │   └── setting/          ユーザー設定: MFA、アカウントリンク（手書き）
│   ├── api/
│   │   ├── {entity}/         生成された REST エンドポイント（api: true の場合）
│   │   └── auth/             Auth.js v5 ルートハンドラー（手書き）
│   └── generated/            プレースホルダーディレクトリ
├── code_generator/           Python コード生成パイプライン
│   ├── json_schema.yaml      唯一の情報源: エンティティ定義
│   ├── generate.py           メインオーケストレーター
│   ├── generators*.py        出力タイプごとのコンテキストビルダー
│   ├── templates/            Jinja2 テンプレート（*.jinja2）
│   └── tests/                ジェネレーター用 pytest ユニットテスト
├── components/               React コンポーネント
│   ├── _standard/            共有 UI（ListWrapper、FormSkeleton — 手書き）
│   └── {entity}/             エンティティごとに生成されたコンポーネント
├── lib/                      ビジネスロジックとユーティリティ
│   ├── {entity}/             エンティティごとに生成されたサービス/アクション/タイプ/ゲッター
│   ├── auth/                 認証ヘルパー（手書き）
│   ├── mfa/                  TOTP/MFA ロジック（手書き）
│   ├── account-link/         OAuth アカウントリンク（手書き）
│   ├── authz.ts              認可の強制（手書き）
│   └── prisma.ts             Prisma クライアントシングルトン
├── prisma/                   データベーススキーマとマイグレーション
│   ├── schema.prisma         正式な DB スキーマ（手書き）
│   └── migrations/           Prisma マイグレーション履歴
├── scripts/                  ユーティリティスクリプト
│   ├── seed.ts               DB シーディング
│   ├── seed-tenant.ts        テナント固有シーディング
│   └── run-next-dev.js       開発サーバー起動スクリプト
├── cypress/                  E2E テスト
│   ├── e2e/                  エンティティごとに生成されたスペック + 手書きフローテスト
│   └── support/              エンティティごとに生成されたヘルパー + フィクスチャ
├── docs/
│   ├── generated/            自動生成されたエンティティリファレンスドキュメント
│   └── knowledge/            手書きのアーキテクチャナレッジドキュメント
├── messages/                 i18n 翻訳ファイル（en、ja）
├── auth.ts                   Auth.js v5 設定（手書き）
├── proxy.ts                  Next.js ミドルウェア（手書き）
└── docker-compose.*.yml      環境ごとの DB + Redis コンテナ
```

---

## ドキュメント

アーキテクチャ関連のドキュメントはすべて `docs/knowledge/` に格納されています:

| ファイル | 内容 |
|------|---------|
| [architecture-overview.md](docs/knowledge/architecture-overview.md) | コード生成パイプライン、プロジェクト構成、生成コードと手書きコードの境界、技術スタック、環境設定 |
| [schema-yaml-configuration.md](docs/knowledge/schema-yaml-configuration.md) | `code_generator/json_schema.yaml` の全リファレンス |
| [prisma-schema-conventions.md](docs/knowledge/prisma-schema-conventions.md) | Prisma モデルの命名、インデックス、リレーション規約 |
| [code-generation-custom-extensions.md](docs/knowledge/code-generation-custom-extensions.md) | 拡張ポイント: 生成ファイルを上書きせずにカスタムコードを追加する場所 |
| [testing-cypress.md](docs/knowledge/testing-cypress.md) | 生成された Cypress パターン、MUI インタラクションヘルパー、CI/CD 設定 |
| [multi-tenancy-and-permissions.md](docs/knowledge/multi-tenancy-and-permissions.md) | テナント分離、RBAC、作成者/担当者アクセス制御 |
| [authentication.md](docs/knowledge/authentication.md) | Auth.js v5 セットアップ、Google SSO、MFA/TOTP、アカウントリンク |
| [performance-improvements.md](docs/knowledge/performance-improvements.md) | ストリーミング Suspense、スケルトン画面、並列フェッチ |
| [troubleshooting.md](docs/knowledge/troubleshooting.md) | ビルド、テスト、コード生成、データベースの一般的な障害パターンと段階的な修正手順 |
| [i18n-locale-routing.md](docs/knowledge/i18n-locale-routing.md) | next-intl v4 セットアップ、ロケールルーティング、翻訳ファイル規約 |
| [dark-mode-and-hydration.md](docs/knowledge/dark-mode-and-hydration.md) | システム連動ダークモード、SSR セーフなテーマ初期化 |
| [timezone-handling.md](docs/knowledge/timezone-handling.md) | サーバー/クライアントのタイムゾーン規約 |
| [child-datagrid-reference-columns.md](docs/knowledge/child-datagrid-reference-columns.md) | インライン DataGrid 子エンティティ、参照列のレンダリング |
| [mobile-responsive-layout.md](docs/knowledge/mobile-responsive-layout.md) | レスポンシブレイアウト規約、検索ヘッダーアイコン、モバイルアカウントセクション |
| [search.md](docs/knowledge/search.md) | エンティティ横断全文検索：スキーマオプトイン・pg_bigm・認可・生成 API と UI |
| [appendix/approval-flow.md](docs/knowledge/appendix/approval-flow.md) | 承認フローシステムの詳細、承認後イベント発火（`on_approved`） |
| [appendix/comment-bridge.md](docs/knowledge/appendix/comment-bridge.md) | コメントブリッジシステムの詳細 |
| [appendix/inventory-reservation-split.md](docs/knowledge/appendix/inventory-reservation-split.md) | インベントリ予約（`x-reservation`）、分割（`x-splittable`）、入荷（`x-ledger-source`）の汎用プリミティブ — 現在の挙動 |
| [cleanup.md](docs/knowledge/cleanup.md) | 生成ファイルの削除: デフォルトクリーンアップ、マニフェスト vs スキーマ駆動、`--prune-orphans`、孤児ファイル処理 |
| [gcp-automation-design.md](docs/knowledge/gcp-automation-design.md) | GCP Cloud Run デプロイ: `x-cloud` オプトイン、Dockerfile、GCS アップロード、環境自動化スクリプト |
| [claude-code-settings-consumer-side.md](docs/knowledge/claude-code-settings-consumer-side.md) | `.claude/settings.json` の読み込みルール、OS非依存な権限記法、複合コマンドのマッチングの罠、設定ファイルが実際に読み込まれたかの確認方法 — 本リポジトリまたは `app-template` の `.claude/settings.json` を編集する前に読むこと |
| [legal-documents.md](docs/knowledge/legal-documents.md) | 利用規約・プライバシーポリシー画面: 文書の言語がサイトUIの言語一覧から独立している理由、Markdown採用（JSON/MDX不採用）の理由、文書の言語追加手順 |

---

## 現在の状況・ロードマップ

### 実装済み

| 機能 | ステータス |
|---------|--------|
| スキーマ駆動 CRUD 生成 | ✅ 実装済み |
| API キー認証付き REST API | ✅ 実装済み |
| ガントチャートビュー | ✅ 実装済み |
| 生成された Cypress テスト | ✅ 実装済み |
| メール/パスワード認証 | ✅ 実装済み |
| Google SSO（Auth.js v5） | ✅ 実装済み |
| アカウントリンク | ✅ 実装済み |
| ロールベースアクセス制御 | ✅ 実装済み |
| コメントスレッド | ✅ 実装済み |
| 添付ファイル管理 | ✅ 実装済み |
| 国際化（en/ja） | ✅ 実装済み |
| ダークモード | ✅ 実装済み |
| レート制限 | ✅ 実装済み |
| ストリーミング Suspense / スケルトン画面 | ✅ 実装済み |
| ダッシュボードチャート（x-display.dashboard） | ✅ 実装済み |
| インベントリ予約（x-reservation） | ✅ 実装済み |
| インベントリ台帳（x-ledger-source） | ✅ 実装済み |
| 入荷ワークフロー | ✅ 実装済み |
| 分割アクション（x-splittable） | ✅ 実装済み |
| 承認明細ヘルパー（x-approval-lines） | ✅ 実装済み |
| 終端却下（x-readonly-fields）/ 却下イベント発火（on_rejected_dispatch） | ✅ 実装済み |
| 整数 enum | ✅ 実装済み |
| nativeEnum 型安全性（6フィールド昇格） | ✅ 実装済み |
| FK スカラー自動推論 | ✅ 実装済み |
| FK オートコンプリートカスタムフィルターフック | ✅ 実装済み |
| 組織アイソレーション強制（組織跨ぎ更新系操作の拒否） | ✅ 実装済み |
| ラッパーコンポーネントアーキテクチャ | ✅ 実装済み |
| MUI 非依存の生成コード（ラッパー第2弾） | ✅ 実装済み |
| コメントリアクション | ✅ 実装済み |
| ブリッジパターンの汎用化 | ✅ 実装済み |
| エンティティ横断全文検索（x-generate.search） | ✅ 実装済み |
| 承認後イベント発火（on_approved） | ✅ 実装済み |
| モバイルヘッダー / サイドバーアカウントセクション | ✅ 実装済み |
| スキーマ駆動テキストエリア行数（x-ui.rows） | ✅ 実装済み |
| GCP Cloud Run デプロイ（x-cloud） | ✅ 実装済み |
| 監査ログビューア | ✅ 実装済み |
| GDPR / データ保護（x-pii, anonymizeUser, x-gdpr-mode） | ✅ 実装済み |
| 添付ファイル表示オプトアウト（showImages/showFiles） | ✅ 実装済み |
| 性能ハードニング（statement_timeout, FK インデックス, GIN インデックス, COUNT オプトアウト） | ✅ 実装済み |

> **後方互換（v1.4 → v1.5）**: 非破壊的変更。既存のスキーマはそのまま動作します。エンティティ横断検索はエンティティごとのオプトイン（`x-generate.search: true`）です。承認後イベント発火はスキーマに `x-approval.on_approved` を設定した場合のみ有効になります。

> **後方互換（v2.0 → v3.0）**: 8領域で**破壊的変更**あり — デフォルト `statement_timeout`（30秒、直結接続パス）、`pageSize > 200` は切り詰めではなく `400` を返すように変更、組織スコープの更新系操作がID指定での組織跨ぎアクセスを拒否するように変更、新規 `user.anonymized_at` カラム、新規 `audit_log.actor_user` 外部キー制約、6件の旧`Int`フィールドの`nativeEnum`化、新規 `notification` テーブル、`nativeEnum` メンバー名の小文字スネークケースへの正規化。後五者は既存データベースで `prisma db push`/`migrate deploy` および/またはデータ移行が必要（`nativeEnum` 化フィールドはデータ損失を避けるため事前に明示的な `ALTER TABLE ... USING` が必要・外部キーは事前に孤立行の掃除が必要な場合あり・メンバー名の正規化は [docs/knowledge/enum-member-naming.md](docs/knowledge/enum-member-naming.md) の移行 SQL が必要）。GCP デプロイ・添付ファイル表示オプトアウトは非破壊的です。詳細は [docs/UPGRADE-3.0.md](docs/UPGRADE-3.0.md) を参照してください。

### 開発中

部分的に実装された機能については [ロードマップ](#ロードマップ) セクションを参照してください。

### 計画中

- 大規模データセット（10 万行以上）のパフォーマンス改善
- ホスト型ノーコードスキーマエディター

---

## ライセンス

このプロジェクトは **Business Source License 1.1（BUSL-1.1）** の下でライセンスされています。

### できること

ジェネレーターを使用したアプリケーションの構築・商用化・配布、および内部利用のためのジェネレーター改変が許可されています。

- ✅ Use the generator to build and commercialize web applications
- ✅ Modify the application framework, generated code, and configuration
  files freely — these modifications do not need to be shared publicly
- ✅ Distribute your customized application (framework + generated code)
  without sharing modifications publicly
- ✅ Modify the generator for internal use

### 改変の共有について

公開共有の要件は `code_generator/` 内のジェネレーターソースコード（`.py`、`.jinja2` 等）の改変にのみ適用されます。生成コード、フレームワークコード、設定ファイルは非公開にできます。

The public sharing requirement applies only to modifications of
**generator source code** — source files (`.py`, `.jinja2`, and similar
programming language files) within the `code_generator/` directory.

Schema definitions (`.yaml`, `.json`) and all files outside
`code_generator/` — including generated code, framework code,
components, and configuration — may be kept private.

> **Example**: If you improve the Python code generator, share those
> improvements. If you customize your authentication flow, form
> components, or API routes, those are yours to keep private.

### できないこと

競合する商用コード生成サービスの運営は禁止されています。

- ❌ Use the generator to operate a competing commercial code generation
  service (Competing Use)

### MIT への移行

このバージョンの最初の公開リリースから 4 周年の日に、ライセンスは自動的に MIT ライセンスに転換されます。

On the fourth anniversary of the first public release of this version, the license automatically converts to the **MIT License**.

### 商用ライセンス

BUSL-1.1 の許諾範囲外での利用には商用ライセンスが必要です。

If you need to use this software in a way not permitted by BUSL-1.1, contact [contact@rhymion.com](mailto:contact@rhymion.com).

See [LICENSE](./LICENSE) for the full license text.

法的効力は英語版（LICENSE）が優先されます。

---

## コントリビューション

コントリビューションを歓迎します。プルリクエストを提出することで、あなたのコントリビューションがこのプロジェクトと同じ条件でライセンスされることに同意したものとみなします。

大規模な作業を始める前に、アプローチについて話し合うために Issue を開いてください。

---

## このプロジェクトについて

このアプリケーションは [Rhymion Labs](https://rhymion.com) によって開発されています（2026 年創業）。

私たちは、組織がコアビジネスからエンジニアリングリソースを転用することなく、必要な社内ツールを構築できるよう支援することに注力しています。

- ウェブサイト: [rhymion.com](https://rhymion.com)
- GitHub: [github.com/rhymion](https://github.com/rhymion)
- LinkedIn: [linkedin.com/company/rhymion](https://linkedin.com/company/rhymion)
- お問い合わせ: [contact@rhymion.com](mailto:contact@rhymion.com)
