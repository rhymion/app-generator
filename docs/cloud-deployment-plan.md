# Cloud Deployment Plan for proj_b Generated Apps

## 1. 概要・背景

proj_b (app-generator-2) はNext.js 15 + Prisma (PostgreSQL) を生成するアプリケーションジェネレータである。現状はVercel向けの設定が既定だが、AWS / Azure / GCP の任意クラウドにコンテナ（Docker）経由でデプロイする方法が求められている。本設計書はその方針を定め、殿裁可が必要な決定点を列挙する。

---

## 2. 現状スタック把握

### 2.1 Next.js 出力モード

**`output: 'standalone'` 未設定。**

`next.config.ts` を実確認した結果、`output` フィールドは設定されていない（標準 `.next/` フォルダ出力）。Dockerでの最適展開には `output: 'standalone'` を有効化する必要がある。現在の設定から変更点は1行のみ。

| 項目 | 現状 |
|------|------|
| `output` | 未設定（標準ビルド） |
| 画像最適化 | AVIF/WEBP、TTL=24h |
| `remotePatterns` | `*.public.blob.vercel-storage.com`（要置換） |
| rewrites | `/uploads/:path*` → `/api/uploads/:path*` |
| i18n | `next-intl`（Node.jsランタイム、Edge非依存） |

### 2.2 Prisma / PostgreSQL

| 項目 | 現状 |
|------|------|
| DBプロバイダ | PostgreSQL（標準） |
| Prismaクライアント出力 | `app/generated/prisma` |
| Prisma Accelerate | オプション（`PRISMA_DATABASE_URL`セット時のみ有効） |
| SQLite | テスト用途のみ（`@prisma/adapter-better-sqlite3`） |
| マイグレーション | `npx prisma migrate deploy`（デプロイ時） |

マイグレーション実行場所の設計は§4参照。

### 2.3 env/secrets 一覧

`.env.example` および `lib/prisma.ts`, `app/api/upload/route.ts` から確認:

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `DATABASE_URL` | 必須 | PostgreSQL接続文字列 |
| `AUTH_SECRET` | 必須 | NextAuth署名秘密鍵 |
| `NEXTAUTH_URL` | 必須 | アプリのベースURL |
| `REDIS_URL` | 任意 | レートリミット共有ストア（未設定時はin-memoryフォールバック） |
| `BLOB_READ_WRITE_TOKEN` | 任意 | Vercel Blob用（未設定時はローカルFSフォールバック） |
| `PRISMA_DATABASE_URL` | 任意 | Prisma Accelerate URL（Vercel専用） |
| `PRISMA_SLOW_QUERY_LOG` | 任意 | スロークエリログ有効化 |
| `NODE_ENV` | 推奨 | `production` に設定 |

**クラウド移行時の変更点**: `BLOB_READ_WRITE_TOKEN` と `PRISMA_DATABASE_URL` は不要になる。代替ストレージ接続文字列（`S3_BUCKET` 等）を追加する。

### 2.4 Vercel固有依存の洗い出し

```bash
# grep結果 (node_modules除く)
grep -r "vercel" ~/work/generated-apps/app-template-3/app-generator --include="*.ts|*.tsx|*.json" -l
```

| ファイル | Vercel依存内容 | 移行難度 |
|---------|-------------|---------|
| `app/api/upload/route.ts` | `@vercel/blob` (put) | **中**: `BLOB_READ_WRITE_TOKEN`未設定時はローカルFS使用のフォールバック実装済み。S3 SDK等に差し替え可能 |
| `next.config.ts` | `remotePatterns: *.public.blob.vercel-storage.com` | **低**: ストレージ置換後にホスト名を更新するだけ |
| `vercel.json` | `buildCommand: npm run vercel-build` | **低**: Vercel外では使用しない。Docker化後は不要 |
| `package.json` | `@vercel/blob`, `@vercel/postgres` (deps) | **低**: `@vercel/postgres`はアプリコードで未使用（grep確認済み）。両パッケージは削除可 |

**Edge Runtime依存なし**: `proxy.ts`（Next.jsミドルウェア相当）は明示的に `runtime: "nodejs"` を使用。Vercel Edge固有APIの使用なし。

---

## 3. クラウド × デプロイ案 マトリクス

| クラウド | 案 | サービス | PostgreSQL | コスト目安(月) | 運用負荷 | 推奨度 |
|---------|---|---------|-----------|-------------|---------|------|
| **GCP** | (a) PaaS | Cloud Run | Cloud SQL | $35〜80 | **低** | ★★★ **第一推奨** |
| **GCP** | (b) 制御 | GKE / App Engine | Cloud SQL | $80〜200 | 高 | ★★ |
| **AWS** | (a) PaaS | App Runner | RDS | $55〜100 | 低 | ★★ |
| **AWS** | (b) 制御 | ECS/Fargate + ALB | RDS | $80〜160 | 中 | ★★ |
| **Azure** | (a) PaaS | Container Apps | Azure DB for PostgreSQL | $45〜90 | 低 | ★★ |
| **Azure** | (b) 制御 | App Service | Azure DB for PostgreSQL | $60〜130 | 低〜中 | ★ |

> **コスト前提**: 最小構成（1 vCPU, 512MB〜1GB RAM、PostgreSQL最小tier）。アイドル時スケールゼロで下限。本番トラフィックがあれば上限に近づく。

---

## 4. 各クラウド詳細設計

### 4.1 GCP (推奨クラウド)

#### (a) Cloud Run ← **第一推奨**

```
App: Cloud Run (リージョン: asia-northeast1)
DB:  Cloud SQL for PostgreSQL 16 (db-f1-micro)
File: Cloud Storage (STANDARD)
Secret: Secret Manager
LB: Cloud Run付属 (HTTPS自動、独自ドメインはCloud Run Domains Mapping)
```

**構成手順概要**:
1. `docker build` → Artifact Registry にpush
2. `gcloud run deploy` でデプロイ（`--set-secrets`でSecret Manager参照）
3. Cloud SQLにPrisma migrate deploy (Migration Job or コンテナ起動時)
4. カスタムドメイン: Cloud Run Domains Mapping + Google管理SSL証明書

**Secrets管理**: Secret Managerに格納 → Cloud Run サービスアカウントに `roles/secretmanager.secretAccessor` 付与 → `--set-secrets DATABASE_URL=projects/.../secrets/db-url:latest` で自動マウント

**Prisma migrate実行場所**: Cloud Run Jobs を使う（§5に詳述）

**ファイルストレージ置換**: `@vercel/blob` → `@google-cloud/storage`  
- `upload/route.ts` の `put()` を `bucket.file(path).save()` に差し替え
- `BLOB_READ_WRITE_TOKEN` → `GCS_BUCKET_NAME` + サービスアカウント

**コスト内訳（最小）**:
- Cloud Run: $0（スケールゼロ時）〜$15（常時起動1インスタンス）
- Cloud SQL db-f1-micro: ~$9/月
- Cloud Storage: ~$2/月
- Secret Manager: ~$1/月
- **合計: $12〜$27/月**（最安クラス）

**運用負荷: 低**

#### (b) GKE

Kubernetes管理のため運用負荷が高く、最小構成でもControl Plane料金 ($74/月)が発生。Cloud Runに比べ利点がなく非推奨。

---

### 4.2 AWS

#### (a) App Runner

```
App: AWS App Runner (ap-northeast-1)
DB:  Amazon RDS for PostgreSQL 16 (db.t3.micro)
File: S3
Secret: AWS Secrets Manager
LB: App Runner付属 (HTTPS自動)
DNS: Route 53 (独自ドメイン)
```

**Secrets管理**: Secrets Manager → App RunnerのIAMロールに `secretsmanager:GetSecretValue` 付与 → 環境変数として自動注入

**Prisma migrate実行場所**: ECS RunTask (one-off) または Lambda (migration用) を推奨。App Runner自体には実行タイミング制御機能なし。

**ファイルストレージ置換**: `@vercel/blob` → `@aws-sdk/client-s3`
- `DATABASE_URL` → `DATABASE_URL` (RDS接続文字列)
- `BLOB_READ_WRITE_TOKEN` → `AWS_S3_BUCKET`, `AWS_REGION`

**コスト内訳（最小）**:
- App Runner (0.25 vCPU, 0.5GB): ~$16/月（アイドル時も課金）
- RDS db.t3.micro: ~$25/月
- S3: ~$1/月
- Secrets Manager: ~$1/月
- **合計: $43〜$70/月**

**運用負荷: 低**

#### (b) ECS/Fargate + ALB

- ALB: ~$20/月追加
- Fargate: スケールゼロ可能だが設定が複雑
- **合計: $70〜$130/月**
- 利点: タスク定義でmigration job分離が容易

---

### 4.3 Azure

#### (a) Azure Container Apps

```
App: Azure Container Apps (japaneast)
DB:  Azure Database for PostgreSQL Flexible Server (Burstable B1ms)
File: Azure Blob Storage
Secret: Key Vault
LB: Container Apps付属 (HTTPS自動)
DNS: カスタムドメイン + マネージドTLS
```

**Secrets管理**: Key Vault → Managed Identity → Container Apps環境変数にシークレット参照

**Prisma migrate実行場所**: Container Appsの Job機能 (one-off) で実行可能

**ファイルストレージ置換**: `@vercel/blob` → `@azure/storage-blob`
- `BLOB_READ_WRITE_TOKEN` → `AZURE_STORAGE_CONNECTION_STRING`

**コスト内訳（最小）**:
- Container Apps (スケールゼロ可): $0〜$15/月
- PostgreSQL Flexible Burstable B1ms: ~$13/月
- Blob Storage: ~$1/月
- Key Vault: ~$1/月
- **合計: $15〜$35/月**（GCPと同等）

**運用負荷: 低**

---

## 5. ポータブル共通基盤: Docker設計

### 5.1 Dockerfile設計方針（マルチステージ）

```dockerfile
# =====================
# Stage 1: deps
# =====================
FROM node:22-alpine AS deps
WORKDIR /app
# Python + build tools for code_generator
RUN apk add --no-cache python3 py3-pip libc6-compat
COPY package*.json ./
RUN npm ci --only=production

# =====================
# Stage 2: builder
# =====================
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 py3-pip
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 1) Pythonコードジェネレータ実行 (jinja2テンプレから生成物を作成)
RUN pip3 install -r requirements.txt --break-system-packages
RUN python3 code_generator/generate.py code_generator/json_schema.yaml ./
# 2) Prisma Clientを生成
RUN npx prisma generate
# 3) Next.jsビルド (output: standalone が前提)
ENV NODE_ENV=production
RUN npm run build

# =====================
# Stage 3: runner
# =====================
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# standalone成果物のみコピー
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Prisma migrationファイルとスキーマをコピー (migrate deploy用)
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

### 5.2 前提: next.config.ts への追加

```typescript
const nextConfig: NextConfig = {
  output: 'standalone',   // ← この1行を追加
  // ... existing config
};
```

### 5.3 Prisma migrate deploy の実行設計

**推奨: 分離Migrationジョブ方式**（アプリ起動とは別に1回だけ実行）

| 方式 | 詳細 | 推奨度 |
|------|------|--------|
| A. コンテナ起動時 (`CMD`) | `npx prisma migrate deploy && node server.js` をentrypointに | **非推奨**: 複数レプリカで競合発生リスク |
| B. Init Container / Job | Cloud Run Jobs / ECS RunTask / ACA Jobs で別途実行 | **推奨** |
| C. CI/CDパイプライン | デプロイワークフロー内でmigrate実行 → 成功後にコンテナデプロイ | **推奨** |

方式C（CI実行）が最もシンプルで競合リスクゼロ。ただしCIがDBに直接アクセスできる必要がある。方式Bはアクセス制限が厳しい環境向け。

### 5.4 .dockerignore 設計

```
node_modules
.next
.git
*.md
docs/
cypress/
.env*
!.env.example
__pycache__
.pytest_cache
*.pyc
```

### 5.5 Docker非使用案との比較

| 観点 | Docker (standalone) | PaaSネイティブNode.js |
|------|--------------------|--------------------|
| ビルド再現性 | 高（全環境同一イメージ） | 中（PaaSのNode.jsバージョンに依存） |
| Pythonジェネレータ実行 | Dockerfileに含められる | 別途設定が複雑 |
| ポータビリティ | **高**（3クラウド同一Dockerfile） | 低（PaaS固有設定が必要） |
| 初回設定コスト | 中 | 低 |
| **推奨** | **◎** | △（PoC初期のみ） |

**Pythonジェネレータ**（`code_generator/generate.py`）の存在がDocker有利の主な理由。PaaSネイティブビルドではPython環境セットアップが非自明。

---

## 6. ジェネレータ統合方針

### 6a. デプロイ単位: (A) generator直接 vs (B) consumer wrapper/submodule

#### 案(A): app-generator-2 リポジトリを直接デプロイ

```
~/work/sandbox/app-generator-2/
  Dockerfile          ← ここに配置
  docker-compose.prod.yml (既存: DBのみ)
  vercel.json (既存、共存)
```

**長所**:
- シンプル。Dockerfileが1箇所で管理容易
- 既存の `npm run build:full` や `vercel-build` スクリプトとの親和性高
- PoC実施が最速

**短所**:
- ジェネレータ本体コード（code_generator/）がデプロイイメージに含まれる（セキュリティ上は問題なし、イメージが若干大きくなる）
- プロジェクト固有の `json_schema.yaml` をどう管理するかが不明確

#### 案(B): proj_c型 wrapper/submodule をデプロイ単位とする

```
consumer-repo/
  app-generator/          ← submodule (app-generator-2 固定ポインタ)
  prj/                    ← プロジェクト固有設定 (json_schema.yaml等)
  Dockerfile              ← consumer側に配置
  docker-compose.prod.yml
  .github/workflows/
    deploy.yml
```

**submodule pointer固定手順**:
```bash
# consumer repo内で
git submodule add https://github.com/.../app-generator-2 app-generator
git submodule update --init
# バージョン固定
cd app-generator && git checkout v1.2.3
cd .. && git add app-generator && git commit -m "pin app-generator to v1.2.3"
```

**CI でのビルド段取り**:

| 案 | 方法 | 比較 |
|----|------|------|
| CI-Aで generate-code | CIで `python3 app-generator/code_generator/generate.py prj/json_schema.yaml ./` を実行、生成物はコミットしない | **推奨**: 生成物がVCS汚染せず、常に最新 |
| 生成物をcommit | 生成物をconsumer repoにcommit | 非推奨: diff肥大、手動生成ミス |

**長所**:
- ジェネレータバージョンを固定できる（本番安定性高）
- app-template-3 のような実際の生成アプリを consumer repo として管理できる
- Dockerfile/デプロイ設定をconsumer側の固定資産として管理可能

**短所**:
- submodule管理のオーバーヘッド
- CIでの `git submodule update --init --recursive` 必須

**推奨: Phase 1は案(A)、Phase 2以降は案(B)**

> PoC (Phase 1: Cloud Run) は案(A)で最速検証。本番運用開始後は案(B)に移行し、ジェネレータバージョンをプロジェクト固有に固定する。

### 6b. ジェネレータ統合方針: Dockerfileテンプレート自動生成

#### テンプレート配置場所

```
~/work/sandbox/app-generator-2/
  code_generator/
    templates/
      Dockerfile.jinja2              ← 新規追加
      .dockerignore.jinja2           ← 新規追加
      cloud_run_deploy.sh.jinja2     ← 新規追加 (Phase 1)
```

#### opt-in設計: `--cloud` フラグ推奨

`code_generator/json_schema.yaml` に `x-cloud` フィールドを追加し、opt-inで生成:

```yaml
# json_schema.yaml (consumer側)
x-cloud:
  enabled: true
  provider: gcp          # gcp | aws | azure
  service: cloud_run     # cloud_run | app_runner | container_apps
  region: asia-northeast1
```

`generate.py` は `x-cloud.enabled: true` の場合のみDockerfile等を出力。

#### Vercel設定との共存

`vercel.json` はそのまま残す。`x-cloud` 有効時はDockerfileを追加生成するのみ。Vercel / Docker の両方でデプロイ可能な状態を維持。

#### Phase分割推奨

| Phase | 内容 | 工数目安 |
|-------|------|---------|
| **Phase 1** | Dockerfile + .dockerignore + Cloud Run (GCP) PoC | 1〜2日 |
| **Phase 2** | AWS App Runner / Azure Container Apps 対応テンプレート追加 | 1日 |
| **Phase 3** | ECS/Fargate, GKE 等のより複雑な構成 | 2〜3日 |

Phase 1 完了基準: `docker build && docker run` で動作確認、Cloud Runへの手動デプロイ成功。

---

## 7. easily受入定義 + 総合推奨

### 受入条件 (Phase 1 完了の定義)

| 項目 | 条件 |
|------|------|
| ビルド成功 | `docker build` がエラーなく完了 |
| ローカル動作 | `docker run` でhttp://localhost:3000 が応答 |
| DB接続 | クラウドDBへの接続・`prisma migrate deploy` 成功 |
| 認証動作 | ログイン/ログアウトが正常動作 |
| ファイルアップロード | クラウドストレージへのアップロード成功 |
| TLS/独自ドメイン | HTTPS + 独自ドメインでアクセス可能 |

### 手順数・所要時間 (GCP Cloud Run、既存GCPアカウント前提)

| ステップ | コマンド数 | 時間目安 |
|---------|-----------|---------|
| GCP CLI設定 | 3〜5 | 5分 |
| Artifact Registry作成 | 2 | 2分 |
| Cloud SQL作成 | 2 | 10分 |
| Secret Manager設定 | 5〜8 | 5分 |
| docker build & push | 2 | 5〜10分（初回ビルド） |
| Cloud Run deploy | 2 | 3分 |
| カスタムドメイン設定 | 3 | 5分 |
| **合計** | **〜25コマンド** | **約35〜40分（初回）** |

リピートデプロイ（コード変更後）: `docker build && docker push && gcloud run deploy` の3コマンド、約10分。

### 総合推奨: **GCP Cloud Run**

**理由**:
1. **最安値**: Cloud Sqlの最小tiers+Cloud Runで月$12〜$27（3クラウド中最安）
2. **スケールゼロ**: トラフィックなし時は課金ゼロ（App Runnerはアイドル課金あり）
3. **Prisma Jobサポート**: Cloud Run Jobsでmigrate deployを分離実行可能
4. **最少手順**: `gcloud` CLIで完結、追加サービス設定が最小
5. **Vercel移行経路が最短**: app-template-3はすでにGCP/Vercel境界で動作検証済み

---

## 8. 次cmd候補 (実装フェーズ)

| 優先度 | cmd候補 | 内容 |
|--------|---------|------|
| 1 | cmd_248 | `next.config.ts` に `output: 'standalone'` 追加 + `Dockerfile` 作成 + `docker build` 動作確認 |
| 2 | cmd_249 | `app/api/upload/route.ts` のVercel Blob → GCS差し替え (Phase 1: Cloud Run PoC) |
| 3 | cmd_250 | Cloud Run デプロイ手動実行 + 受入テスト |
| 4 | cmd_251 | `code_generator/templates/Dockerfile.jinja2` 追加（ジェネレータ統合 Phase 1） |
| 5 | cmd_252 | CI/CDパイプライン設計（GitHub Actions + Cloud Run） |

---

## 9. 殿裁可が必要な決定点

| # | 決定点 | 選択肢 | 推奨 |
|---|--------|--------|------|
| D-1 | **第一推奨クラウド** | GCP / AWS / Azure | **GCP Cloud Run**（コスト・操作性） |
| D-2 | **next.config.ts 変更可否** | `output: 'standalone'` 追加 vs 非Docker化 | `standalone`追加 推奨 |
| D-3 | **Vercel Blob 置換先** | GCS / S3 / Azure Blob / ローカルFSのまま | **GCS**（Cloud Run採用時） |
| D-4 | **Prisma migrate実行場所** | A. コンテナ起動時 / B. Cloud Run Jobs / C. CI実行 | **C. CI実行**（シンプル） |
| D-5 | **デプロイ単位** | (A) generator直接 / (B) consumer wrapper/submodule | **Phase 1=(A), Phase 2以降=(B)** |
| D-6 | **Dockerfile配置先** | (A) generatorテンプレが生成 / (B) consumer repo固定資産 | **Phase 1=(A)でPoC、Phase 2=(B)** |
| D-7 | **ジェネレータ統合タイミング** | Phase 1 (Cloud Run PoC)完了後 vs 同時実施 | **PoC完了後**（Phase 2） |
| D-8 | **opt-in方式** | `x-cloud` フラグ (json_schema.yaml) / `--cloud` CLI引数 | **`x-cloud` フラグ**（設定の永続性） |
