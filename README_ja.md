> **Note:** This is the Japanese translation of README.md.
> The English version is the authoritative document.
> 本文書は README.md の日本語訳です。正式な文書は英語版です。

# Rhymion App Generator — スキーマ駆動型 Web アプリケーションジェネレーター

YAML スキーマ定義から本番対応の Web アプリケーションを生成します。データモデルと画面レイアウトを一度記述するだけで、完全な Next.js アプリケーション（CRUD ページ一式、REST API、ロールベースアクセス制御、テナント対応バックエンド、多言語対応）が生成されます。

[Next.js](https://nextjs.org/)、[Prisma](https://www.prisma.io/)、[MUI](https://mui.com/) で構築されています。

---

## 機能

### コード生成

- **スキーマ駆動生成** — YAML スキーマ (`code_generator/json_schema.yaml`) + Prisma スキーマ → Python パイプラインによる TypeScript、React、Cypress ファイルの生成
- **CRUD ページ一式** — エンティティごとに一覧、詳細、作成、編集、削除ページを生成
- **ガントチャートビュー** — エンティティ単位でオプトインできるガントチャートページ
- **REST API** — エンティティごとに API キー認証付き JSON エンドポイントを生成
- **Cypress テスト生成** — アプリケーションコードと並行して UI および API テストスイートを生成

### リレーションシップ

- 多対1、多対多、1対1、自己参照リレーションシップ
- インライン DataGrid による子エンティティと埋め込みリスト
- 独立した子エンティティ（専用ページ付き）

### 認証・認可

- メール/パスワード認証
- Google SSO（Auth.js v5）
- アカウントリンク（ユーザーごとに複数の OAuth プロバイダー）
- ロールベースアクセス制御（モデルごとの CRUD 権限）
- 作成者/担当者ベースのアクセス制御
- 組織スコープフィルタリング — organization_id を持つエンティティは、ユーザーが所属する組織に自動的にフィルタリングされます

### 組み込みシステム

- **コメントスレッド** — ポリモーフィックブリッジパターンにより、任意のエンティティにコメントスレッドを付与
- **添付ファイル管理** — ポリモーフィックブリッジ経由のファイル・画像アップロード

### パフォーマンス

- 高速 TTFB のためのストリーミング Suspense
- ローディング中のスケルトン画面
- データと権限の並列フェッチ

### セキュリティ

- レート制限（Redis、インメモリフォールバック付き）
- CSRF 保護
- Prisma によるパラメータ化クエリ

### その他

- 国際化（英語・日本語、next-intl v4）
- ダークモード（システム連動、SSR セーフ）
- 生成コードを上書きせずにカスタマイズできる 5 つの拡張ポイント

---

## ロードマップ

これらの機能は部分的に実装されており、現在も開発中です。

### マルチテナント（テナントレベルの分離）
**動作するもの:** `tenant` モデルが name、slug、status フィールドとともに存在します（Phase 1.1）。すべてのユーザーは `tenant_id` でテナントに紐付けられています（Phase 1.2）。組織スコープフィルタリング（独立した動作中の機能）がサブテナントのデータグループ化を提供します。

**未実装のもの:** 生成コードは `tenant_id` によるフィルタリングを行いません。マルチテナントロードマップの Phase 1.3〜4.3 はまだ実装されていません: 認証セッションでのテナント解決、テナント対応コード生成テンプレート、クロステナント分離テスト、招待制サインアップ。現在、同一デプロイメントの異なるテナントのユーザーはお互いのデータにアクセスできます。詳細な段階的計画については `docs/multi-tenancy.md` を参照してください。

### MFA / 二要素認証

**動作するもの:** TOTP 認証ロジック、暗号化シークレットストレージ（AES-256-GCM）、リカバリーコード（登録ごとに 8 件、bcrypt ハッシュ化）が `lib/mfa/` に実装されています。

**未実装のもの:** MFA 登録 UI（`/setting/mfa`）に状態遷移の不具合があります — 有効化をクリックしても QR コード画面が表示されない場合があります。ユーザーはアプリケーションインターフェースから確実に MFA を有効化できません。

### 承認フロー

**動作するもの:** 設定可能なフロー（`approval_flow`）、ステータス管理（保留中/承認済み/却下済み）、監査証跡（`approval_history`）、ロールベースの承認・却下権限を備えた基本的な承認ワークフローが実装されています。

**未実装のもの:** 承認完了後のダウンストリーム状態変更がトリガーされません。レコードを承認しても、関連データが自動更新されたり新しい操作が有効化されたりしません。

### ダッシュボード

**動作するもの:** コードジェネレーターは、スキーマの `x-display.dashboard: true` に基づいてダッシュボード対象エンティティのカタログを生成します。

**未実装のもの:** ダッシュボードページにチャートレンダリングがありません。グループ化可能なフィールドを持つエンティティを定義しても、ダッシュボードページに実際のチャートは生成されません。

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

ステータス管理（保留中/承認済み/却下済み）と完全な監査証跡を備えた、マルチステップかつロールベースの承認ワークフローです。ロールベース権限による基本的な承認・却下は動作しますが、承認完了後のダウンストリーム状態変更はまだトリガーされません。詳細はロードマップセクションを参照してください。

[docs/knowledge/appendix/approval-flow.md](docs/knowledge/appendix/approval-flow.md) を参照してください。

### コメントスレッド

ポリモーフィックブリッジパターンにより、各エンティティのスキーマを変更することなく任意のエンティティにコメントスレッドを付与できます。コメントは詳細ページにインラインで表示されます。

[docs/knowledge/appendix/comment-bridge.md](docs/knowledge/appendix/comment-bridge.md) を参照してください。

### 添付ファイル管理

Vercel Blob をバックエンドとした、ポリモーフィックブリッジ経由のファイル・画像アップロードです。オプトインしたエンティティの詳細ページにはファイル添付パネルが表示されます。

---

## セキュリティ

**レート制限**は API ミドルウェアの `getRateLimiter()` で処理されます。開発環境（`REDIS_URL` 未設定時）は自動的にインメモリリミッターにフォールバックします。テスト・本番環境では Redis を使用します。

**CSRF 保護**はすべての状態変更 API ルートに適用されます。

**組織スコープフィルタリング**はクエリレイヤーで適用されます: すべてのリストクエリに自動的な `organization_id` フィルターが適用され、データを認証済みユーザーの組織にスコープします。テナントレベルの分離（クロステナントのデータ分離）はまだ実装されていません — ロードマップセクションを参照してください。

**ロールベースアクセス制御**はスキーマでモデルごとに定義されます。`authz.ts` モジュールがすべてのリクエストに対してモデルごとの CRUD 権限を強制します。

[docs/knowledge/multi-tenancy-and-permissions.md](docs/knowledge/multi-tenancy-and-permissions.md) を参照してください。

---

## パフォーマンス

- **ストリーミング Suspense**: ページが即座にブラウザへ HTML をストリームし、TTFB を削減します。データは Suspense 境界内で非同期に読み込まれます。
- **スケルトン画面**: 生成されたすべてのリスト・詳細ページは、データ読み込み中にスケルトンを表示してレイアウトシフトを防ぎます。
- **並列フェッチ**: データと権限チェックを `Promise.all` で並列フェッチし、サーバーへのラウンドトリップを最小化します。

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
| [mobile-responsive-layout.md](docs/knowledge/mobile-responsive-layout.md) | レスポンシブレイアウト規約 |
| [appendix/approval-flow.md](docs/knowledge/appendix/approval-flow.md) | 承認フローシステムの詳細 |
| [appendix/comment-bridge.md](docs/knowledge/appendix/comment-bridge.md) | コメントブリッジシステムの詳細 |

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

### 開発中

部分的に実装された機能については [ロードマップ](#ロードマップ) セクションを参照してください。

### 計画中

- カラムフィルタリングを超えた全文検索
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
