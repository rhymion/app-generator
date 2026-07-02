# GCP Cloud Run デプロイ Runbook (PoC 使い捨て)

## 前提

- `x-cloud: gcp` opt-in が `code_generator/json_schema.yaml` に設定済み
- `gcloud` CLI インストール済み
- `gcloud auth login` 実施済み（殿が実行: `! gcloud auth login`）
- `gcloud config set project <PROJECT_ID>`
- Docker インストール済み（`docker --version` で確認）

## Phase 1: 構築手順

## 変数定義 (全節で共通)

以下を一度実行することで、runbook の全コマンドを copy-paste 可能になる:

```bash
# GCP プロジェクト設定
PROJECT_ID=$(gcloud config get-value project)
REGION=asia-northeast1

# Cloud SQL
INSTANCE_NAME=app-pg16
DB_NAME=appdb

# Cloud Run サービス名
SERVICE_NAME=app

# サービスアカウント
SA_NAME=app-cloud-run-sa
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Artifact Registry
REPO_NAME=app-generator

# Cloud Run サービス URL (deploy 後に取得)
# export SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
#   --region="$REGION" --format='value(status.url)')
```

> ℹ️ `SERVICE_NAME=app` は実機で確認済み (gcloud run services describe/logs/update が `app` で通る)。
> `INSTANCE_NAME=app-pg16` / `DB_NAME=appdb` は §1-2 の作成値に準拠。

### 1-0. 事前: x-cloud opt-in で generate-code

```bash
# json_schema.yaml の x-cloud ブロックをコメント解除して有効化
# x-cloud:
#   enabled: true
#   provider: gcp
#   service: cloud_run
#   region: asia-northeast1
# ↑ 先頭の # を外す

npm run generate-code
# 生成後に確認:
ls Dockerfile .dockerignore                      # 存在すること
grep "output: 'standalone'" next.config.ts       # 1行ヒットすること
head -5 app/api/upload/route.ts | grep google    # GCS import があること
```

### 1-0.5. GCP APIs の有効化 (初回のみ)

新規 GCP プロジェクトでは以下の APIs がデフォルト無効のため、最初に有効化する。
有効化済みでも実行して問題ない（冪等）。

```bash
gcloud services enable \
  sqladmin.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com
```

> **注意**: `sqladmin.googleapis.com` が無効の場合、§1-7 の `--set-cloudsql-instances`
> によるCloud SQL接続が失敗する。(出典: subtask_257b 調査)

### 1-1. Artifact Registry の作成

```bash
PROJECT_ID=$(gcloud config get-value project)
REGION=asia-northeast1
REPO_NAME=app-generator # changed from app-repo but other name is okay

gcloud artifacts repositories create "$REPO_NAME" \
  --repository-format=docker \
  --location="$REGION" \
  --description="App Generator Docker images"

gcloud auth configure-docker "${REGION}-docker.pkg.dev"
```

### 1-2. Cloud SQL (PostgreSQL 16) の作成

```bash
INSTANCE_NAME=app-pg16
DB_NAME=appdb

gcloud sql instances create "$INSTANCE_NAME" \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --edition=ENTERPRISE \
  --region="$REGION" \
  --storage-type=SSD \
  --storage-size=10GB \
  --no-backup

gcloud sql databases create "$DB_NAME" --instance="$INSTANCE_NAME"

# DBパスワードを生成・記録
# ⚠ base64 は +/= を含み DATABASE_URL を破壊するため hex を使用すること
DB_PASSWORD=$(openssl rand -hex 32)
echo "DB_PASSWORD=$DB_PASSWORD"  # 次ステップで使用

gcloud sql users set-password postgres \
  --instance="$INSTANCE_NAME" \
  --password="$DB_PASSWORD"

# Cloud SQL接続文字列 (Cloud Runからは Unix socket経由)
#   - マイグレーション用 (§1-7 の Job)。Cloud Run → Cloud SQL は Auth Proxy socket。
CLOUD_SQL_CONNECTION_NAME="${PROJECT_ID}:${REGION}:${INSTANCE_NAME}"
DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${CLOUD_SQL_CONNECTION_NAME}"

# --- Accelerate 用の外部到達性 (Option B) ---
# Prisma Accelerate は Prisma のクラウドから Cloud SQL へ *外部* 接続するため、
# パブリック IP + 承認済みネットワーク + SSL が必要（socket 文字列は使えない）。
# PoC 簡易版として 0.0.0.0/0 を許可し SSL を必須化する。
#   ⚠ 本番では 0.0.0.0/0 を使わず、Prisma の静的 egress IP レンジのみ許可すること。
gcloud sql instances patch "$INSTANCE_NAME" \
  --authorized-networks=0.0.0.0/0 \
  --ssl-mode=ENCRYPTED_ONLY

# パブリック IP を取得し、Accelerate に登録する「直結・公開」接続文字列を組み立てる。
CLOUD_SQL_PUBLIC_IP=$(gcloud sql instances describe "$INSTANCE_NAME" \
  --format="value(ipAddresses[0].ipAddress)")
DATABASE_URL_PUBLIC="postgresql://postgres:${DB_PASSWORD}@${CLOUD_SQL_PUBLIC_IP}:5432/${DB_NAME}?sslmode=require"
echo "Accelerate 登録用 (公開直結): $DATABASE_URL_PUBLIC"   # §1-3.5 の Prisma Console に貼り付ける
```

> **重要 (Option B を選択した場合)**: すでに Prisma Postgres データベース
> (`prisma+postgres://...`) を作成済みなら、それは *Prisma ホスト* の別 DB なので
> **削除**すること（課金・混乱回避）。ソース・オブ・トゥルースは GCP Cloud SQL。
> Accelerate は次の §1-3.5 で Cloud SQL に対して設定する。

### 1-3. Secret Manager へのシークレット登録

```bash
# 必須シークレット
# DATABASE_URL: Cloud SQL への「直接」接続文字列。
#   - Cloud Run Jobs の `prisma db push` が使用（db push は
#     Accelerate 経由では実行不可のため必ず直結）。
echo -n "$DATABASE_URL" | gcloud secrets create app-database-url --data-file=-

# PRISMA_DATABASE_URL: Prisma Accelerate 接続文字列（prisma:// で始まる）。
#   - Cloud Run "service"（実行時）はこちらを使い、lib/prisma.ts の
#     Accelerate 分岐に入る（GCP では pg アダプタを使わない）。
#   - 値は §1-3.5 で発行する Accelerate API キー付き URL に置換すること。
#   - ⚠ prisma:// であること。prisma+postgres:// は「Prisma Postgres(別のホスト DB)」
#     であり Cloud SQL ではない（Option B では使わない）。
echo -n "prisma://accelerate.prisma-data.net/?api_key=<YOUR_ACCELERATE_API_KEY>" \
  | gcloud secrets create app-prisma-database-url --data-file=-

> ⚠ **app-prisma-database-url は placeholder のまま登録しないこと**
>
> `<YOUR_ACCELERATE_API_KEY>` 部分は §1-3.5 で発行する本物の API キーに置換してから登録すること。
> 必ず本物の Accelerate URL (`prisma://accelerate.prisma-data.net/...?api_key=...`) を設定すること。
> placeholder のまま deploy すると P1001 "Can't reach database server" + driverAdapterError が発生する
> （lib/prisma.ts が Accelerate 分岐に入れず pg アダプタ直結に落ちるため）。
> 登録後に確認: `gcloud secrets versions access latest --secret=app-prisma-database-url | head -c 20`
> → `prisma://` で始まれば OK。`<YOUR_ACCELERATE` で始まれば要更新。

echo -n "$(openssl rand -hex 32)" | gcloud secrets create app-auth-secret --data-file=-

# NEXTAUTH_URL: NextAuth.js がコールバック URL 生成に使うアプリのベース URL (Auth.js v4 変数名)。
# ⚠ この変数は Auth.js v4 用。v5 (next-auth >= 5.x) では AUTH_URL を使用。
#   アプリが Auth.js v5 を使用している場合は AUTH_URL に読み替えること。
#   確認方法: package.json の "next-auth" バージョンを確認 (v5.x → AUTH_URL, v4.x → NEXTAUTH_URL)。
# 【鶏卵問題】サービス URL は §1-6 の deploy 後にしか確定しないが、Secret は deploy 前に必要。
# 【解決策 A (推奨)】Cloud Run の URL は PROJECT_NUMBER ベースで事前予測できる（2024年以降）:
#   https://app-${PROJECT_NUMBER}.${REGION}.run.app
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
NEXTAUTH_URL="https://app-${PROJECT_NUMBER}.${REGION}.run.app"
echo "NEXTAUTH_URL=$NEXTAUTH_URL"

echo -n "$NEXTAUTH_URL" | gcloud secrets create app-nextauth-url \
  --data-file=- --replication-policy=automatic

# GCS バケット名 (§1-4 でバケット作成後に設定)
GCS_BUCKET="${PROJECT_ID}-app-uploads"
# バケット作成 (UBLA を無効化してレガシーACLを使用可能にする — PoC専用)
gcloud storage buckets create "gs://${GCS_BUCKET}" \
  --location="$REGION" \
  --no-uniform-bucket-level-access

# 既存バケットの UBLA を無効化する場合
# gcloud storage buckets update "gs://${GCS_BUCKET}" \
#   --no-uniform-bucket-level-access

echo -n "$GCS_BUCKET" | gcloud secrets create app-gcs-bucket-name --data-file=-
```

> **注意 (GCS UBLA と ACL)**
>
> `public:true` (旧式 ACL) はアップロード画像を公開 URL 化する。PoC では許容するが、
> 本番環境では UBLA を維持した上で IAM 制御または Signed URL による配信に改修すること。
> UBLA を有効にしたバケットで `public:true` を使うと
> "Cannot insert legacy ACL when uniform bucket-level access is enabled" 400 エラーになる。
> `--no-uniform-bucket-level-access` は PoC 専用の設定であり、本番では使用しないこと。

> **解決策 B: placeholder → deploy → 値更新（URL 予測が不確かな場合）**
>
> §1-3 の `app-nextauth-url` に仮 URL を設定し、§1-6 deploy 後に実際の URL へ置き換える:
> ```bash
> # §1-3 時点: placeholder で Secret を作成
> echo -n "https://REPLACE_AFTER_DEPLOY" | gcloud secrets create app-nextauth-url \
>   --data-file=- --replication-policy=automatic
>
> # §1-6 deploy 後に実行: 実際の URL に更新
> SERVICE_URL=$(gcloud run services describe app --region="$REGION" --format='value(status.url)')
> echo -n "$SERVICE_URL" | gcloud secrets versions add app-nextauth-url --data-file=-
> # ↑ 更新後は必ず再 deploy または services update で revision に反映させること (⚠ 下記参照)
> ```

> ⚠ **Secret 更新後の revision 反映**
>
> Secret の `:latest` を Cloud Run に注入している場合、値を更新しても **既存 revision は旧値を保持したまま**。
> 新しい値を反映するには再 deploy または次のコマンドが必要:
> ```bash
> gcloud run services update app --region="$REGION"
> ```

> **NEXTAUTH_URL の値の要件**
> - 先頭: `https://`（`http://` 不可）
> - 末尾: スラッシュ禁止（NextAuth.js のコールバック URL 完全一致のため）
>   - ✅ `https://app-12345.asia-northeast1.run.app`
>   - ❌ `https://app-12345.asia-northeast1.run.app/`

> **NEXTAUTH_URL と 403 Forbidden は無関係**
>
> NEXTAUTH_URL の設定ミスはコールバックリダイレクト失敗として現れる（§1-8 の 403 とは別問題）。
> 403 の対処は §1-8 を参照。

> **⚠ Auth.js v5 必須設定 (非 Vercel デプロイ)**
>
> `NEXTAUTH_URL` は Auth.js v5 では**無視される** (v4 の変数名)。
> v5 では以下の環境変数を使用すること:
>
> ```
> AUTH_URL = <Cloud Run サービス URL (末尾スラッシュなし)>
> # 例: https://app-447339764272.asia-northeast1.run.app
>
> AUTH_TRUST_HOST = true  # 非 Vercel デプロイでは必須 (Vercel は自動設定)
> ```
>
> §1-6 の deploy コマンドの `--set-env-vars` に追加するか、deploy 後に `gcloud run services update` で設定する (§1-6 参照)。

### 1-3.5. PRISMA_DATABASE_URL (Accelerate) の取得と登録

GCP コンソールにこの操作は無い。Accelerate は Prisma の製品なので **Prisma Data
Platform (console.prisma.io)** で設定する。Vercel で「Prisma Postgres」を作ると
自動発行されたのは、あちらが *Prisma ホストの DB* だから。Option B では自前の
**Cloud SQL** に対して *standalone Accelerate* を設定する（＝接続文字列の入力を求められる）。

手順 (2026年7月確認済み。出典: https://www.prisma.io/docs/accelerate/getting-started および https://www.prisma.io/docs/guides/supabase-accelerate):

1. `console.prisma.io` にサインインする。
2. **'New project'** をクリックし、プロジェクト名を入力する。
3. 製品選択画面で **'Accelerate'** を選択する（**'Prisma Postgres' は選ばない**）。
   - 'Prisma Postgres' は Prisma ホストの別 DB を作成するため Cloud SQL とは別物。
4. データベース接続文字列の入力欄に §1-2 で組み立てた **`$DATABASE_URL_PUBLIC`** を貼り付ける:
   `postgresql://postgres:<PASSWORD>@<CLOUD_SQL_PUBLIC_IP>:5432/appdb?sslmode=require`
   - Accelerate は Prisma のクラウドから接続するため socket 文字列は不可。
   - §1-2 の `--authorized-networks=0.0.0.0/0` と `--ssl-mode=ENCRYPTED_ONLY` が
     設定済みであること（未設定の場合は接続検証が失敗する）。
5. DB に最も近いリージョンを選択する（例: `asia-northeast1` = Tokyo）。
6. **'Create project'** をクリックして Accelerate を有効化する。
7. **'Generate API key'** をクリックし API キーを生成する。
8. 発行された **`prisma://accelerate.prisma-data.net/?api_key=<KEY>`** をコピーする。
   - ⚠ ファイアウォールで Cloud SQL への IP 絞り込みをする場合は **'Enable Static IP'**
     オプションを有効化し、発行された静的 IP を `--authorized-networks` に追加すること。
9. §1-3 の `app-prisma-database-url` シークレットのプレースホルダをこの値に置換する:

   ```bash
   echo -n "prisma://accelerate.prisma-data.net/?api_key=<PASTE_REAL_KEY>" \
     | gcloud secrets versions add app-prisma-database-url --data-file=-
   ```

| 用途 | シークレット | 文字列 | 経路 |
|------|-------------|--------|------|
| service 実行時 | `app-prisma-database-url` | `prisma://...?api_key=` | Accelerate → Cloud SQL (公開 IP) |
| migrate Job | `app-database-url` | `postgresql://...?host=/cloudsql/...` | Auth Proxy socket (直結) |

### 1-3.7. Redis (rate-limit) — Upstash 接続設定

app の認証 rate-limit (`lib/rate-limit/`) は環境変数 `REDIS_URL` の有無で動作が変わる。

| REDIS_URL | 動作 | 本番可否 |
|-----------|------|---------|
| 設定あり  | ioredis (Lua sliding-window) | ✅ インスタンス間で共有 |
| **未設定** | **in-memory per-process** | **❌ Cloud Run 複数インスタンスで counter が独立 → brute-force 保護が実質無効** |

> ⚠️ **PoC フェーズ**: in-memory のまま進める場合、認証試行の brute-force 防御は per-instance のみ有効。
> 実ユーザー招待前 / 本番 go-live 前に必ず (ii) の手順で Upstash を接続すること。

#### (i) Upstash Redis の作成と接続文字列取得

```bash
# 1. https://upstash.com でサインアップ / ログイン
# 2. "Create Database" → Redis → リージョン例: ap-northeast-1 (Tokyo)
# 3. "Connect" → "ioredis" タブを選択
# 4. 表示される TLS 接続文字列をコピー (形式: rediss://:PASSWORD@HOST:PORT)
REDIS_URL="rediss://:PASSWORD@HOST:PORT"
```

> ioredis は TLS (`rediss://`) に対応済み。VPC Connector は不要。

#### (ii) Secret Manager への登録と Cloud Run 配線

```bash
# Secret 登録
echo -n "$REDIS_URL" \
  | gcloud secrets create app-redis-url \
      --replication-policy=automatic \
      --data-file=-
# (既存の場合は versions add)
# echo -n "$REDIS_URL" | gcloud secrets versions add app-redis-url --data-file=-

# SA に secretAccessor 権限付与 (§1-4 で付与済みの場合はスキップ)
gcloud secrets add-iam-policy-binding app-redis-url \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

# Cloud Run に配線 (再デプロイ)
gcloud run services update "$SERVICE_NAME" \
  --region="$REGION" \
  --update-secrets=REDIS_URL=app-redis-url:latest
```

#### (iii) 動作確認 — 429 応答テスト

```bash
# credentials 認証を 11 回叩いて 429 を確認 (bucket limit = 10/min)
for i in $(seq 1 11); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${SERVICE_URL}/api/auth/signin/credentials" \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"wrong","csrfToken":"dummy"}')
  echo "Request $i: $STATUS"
done
# 11 回目以降が 429 かつ Retry-After ヘッダ付きであれば正常
```

#### (iv) REDIS_URL 未設定時の注意

`REDIS_URL` を設定しない場合、`lib/rate-limit/in-memory.ts` の per-process カウンタが使われる。
Cloud Run はリクエスト数に応じてインスタンスを増減するため、各インスタンスが独立したカウンタを持ち、
**rate-limit はセキュリティ境界として機能しない**。
PoC / 開発環境での利用は許容するが、実ユーザー向けデプロイ前に必ず上記 (i)〜(ii) を実施すること。

#### (v) 補足: ioredis の接続挙動

- `lazyConnect: true` で import 時に TCP 接続しない (Next.js middleware に安全)
- Upstash TCP endpoint は `rediss://` スキームで TLS 必須。`redis://` (非TLS) は接続拒否される
- VPC Connector 不要 (Upstash はパブリックエンドポイント)
- ioredis が `rediss://` に接続できない場合 (例: ファイアウォール問題) → ログに ECONNREFUSED が出る。
  REDIS_URL を未設定に戻して in-memory fallback で継続し、ネットワーク経路を確認すること

### 1-4. サービスアカウントの作成と権限付与

```bash
SA_NAME=app-cloud-run-sa
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create "$SA_NAME" \
  --display-name="App Cloud Run SA"

# Secret Manager アクセス
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

# Cloud SQL 接続
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.client"

# GCS 書き込み（バケット単位直付与を推奨）
# ⚠ project-level + --condition 方式は GCS リソース名形式の噛み合わせミスで 403 になりやすい
#   (条件式で `//storage.googleapis.com/projects/_/buckets/BUCKET` と書いても
#    実際の形式が `projects/_/buckets/BUCKET` 等で一致せず実質無権限になる場合あり)。
#   バケット単位の直付与 (条件無し) を使うこと。
gcloud storage buckets add-iam-policy-binding gs://${GCS_BUCKET} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin"

# ⚠️ 必須 (省略不可): V4 Signed URL 発行に必要な self-impersonation 権限
# Cloud Run では SA の秘密鍵が露出しない (Workload Identity/ADC)。
# GCS proxy (app/api/gcs/[...path]/route.ts) は new Storage() + getSignedUrl v4 を使用。
# V4 署名には IAM Credentials API (signBlob) が必要なため、
# runtime SA に自身への self-impersonation 権限が必須 (permission: iam.serviceAccounts.signBlob)。
# 省略すると: GCS proxy (/api/gcs/...) が SigningError で 403 → 画像が表示されない。
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator"

# 付与確認
# gcloud iam service-accounts get-iam-policy ${SA_EMAIL} \
#   --format="table(bindings.role, bindings.members)"
# → roles/iam.serviceAccountTokenCreator に自 SA が含まれることを確認
```

### 1-5. docker build & push to Artifact Registry

```bash
IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/app:latest"
MIGRATE_IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/app-migrate:latest"

# サービス用イメージ (slim standalone runner)。プロジェクトルートで実行。
docker build -t "$IMAGE_TAG" .
docker push "$IMAGE_TAG"

# db push 用イメージ (builder ステージ)。
#   slim な runner には Prisma CLI / エンジン / prisma.config.ts が含まれないため、
#   `prisma db push` は full node_modules + prisma.config.ts + schema を持つ
#   builder ステージのイメージから実行する。
#   上の build とレイヤキャッシュを共有するので追加コストは小さい。
docker build --target builder -t "$MIGRATE_IMAGE_TAG" .
docker push "$MIGRATE_IMAGE_TAG"
```

### 1-6. Cloud Run deploy

```bash
EMAIL_ADDRESS=<YOUR_GMAIL_ADDRESS>
gcloud beta run services add-iam-policy-binding --region=asia-northeast1 --member="user:$EMAIL_ADDRESS" --role=roles/run.invoker app

# ---- deploy 前確認: PRISMA_DATABASE_URL が placeholder でないことを確認 ----
# prisma:// で始まれば OK。<YOUR_ACCELERATE で始まれば §1-3.5 を参照して更新すること。
# placeholder のまま deploy すると P1001 "Can't reach database server" + driverAdapterError が発生する。
gcloud secrets versions access latest --secret=app-prisma-database-url | head -c 20
# ↑ 出力例: prisma://accelerate.prisma-data.net... → OK
# ↑ 出力例: <YOUR_ACCELERATE_API_K → 要更新: echo -n "prisma://..." | gcloud secrets versions add app-prisma-database-url --data-file=-

# 実行時は PRISMA_DATABASE_URL(Accelerate) を注入し、lib/prisma.ts の Accelerate
# 分岐に入れる（GCP では pg アダプタを使わない）。Accelerate はコネクションプールを
# 肩代わりするため Cloud SQL への直結は不要。マイグレーション専用の直結
# DATABASE_URL は §1-7 の Job 側にのみ渡す。
# ⚠ Domain Restricted Sharing (constraints/iam.allowedPolicyMemberDomains) 配下では
# --allow-unauthenticated が失敗する。
# 推奨: --no-invoker-iam-check (IAM チェック無効化) を使用。
# allUsers IAM バインディング不要・org policy 変更不要で公開アクセスが実現する。
# 出典: cloud.google.com/run/docs/authenticating/public
gcloud run deploy app \
  --image="$IMAGE_TAG" \
  --platform=managed \
  --region="$REGION" \
  --service-account="$SA_EMAIL" \
  --set-secrets="PRISMA_DATABASE_URL=app-prisma-database-url:latest,AUTH_SECRET=app-auth-secret:latest,GCS_BUCKET_NAME=app-gcs-bucket-name:latest" \
  --set-env-vars="NODE_ENV=production,AUTH_TRUST_HOST=true" \
  --no-invoker-iam-check \
  --min-instances=0 \
  --max-instances=10 \
  --memory=2Gi \
  --cpu=1
# ⚠️ AUTH_URL/NEXTAUTH_URL をハードコード厳禁 (Auth.js v5 は HOST から自動推定・再デプロイ耐性)
# AUTH_TRUST_HOST=true のみ設定せよ。AUTH_URL 付与は再デプロイ後に placeholder 未展開 → 404 の原因になる。

# ---- deploy 後: 実 Service URL を取得 ----
# ⚠️ Service URL は手入力・ハードコード禁止 (hash形式とproject-number形式の2つが有効で予測不可)
# 実 URL の取得:
export SERVICE_URL=$(gcloud run services describe app \
  --region=$REGION --format='value(status.url)')
echo "Service URL: $SERVICE_URL"

# ---- Auth.js v5 UntrustedHost 対処 (deploy 後確認・URL 変更時) ----
# ⚠ NEXTAUTH_URL は v5 で無視。AUTH_TRUST_HOST=true のみで HOST ヘッダから自動推定する。
# AUTH_URL/NEXTAUTH_URL は設定不要。未設定・再デプロイ後も AUTH_TRUST_HOST=true で動作継続。
# UntrustedHost が出た場合は AUTH_TRUST_HOST=true が欠落しているか revision に未反映:
gcloud run services update app \
  --region=$REGION \
  --update-env-vars=AUTH_TRUST_HOST=true
```

> ⚠️ **注意: 再デプロイ時の DB 配線巻き戻りに注意**
>
> 上記 deploy コマンドは Accelerate 前提の既定設定で動作する。
> PoC を直結 socket (Cloud SQL) で運用している場合、再デプロイ・再ビルドのたびに
> PRISMA_DATABASE_URL が復活し、--add-cloudsql-instances / DATABASE_URL ソケット設定が
> 消失するため、P1001 エラーが再発する。
>
> **直結 socket PoC 構成の再適用コマンド** (再デプロイ後に毎回実行):
> ```bash
> gcloud run services update ${SERVICE_NAME} \
>   --region=${REGION} \
>   --add-cloudsql-instances=${PROJECT_ID}:${REGION}:${DB_INSTANCE_NAME} \
>   --update-secrets=DATABASE_URL=app-database-url:latest \
>   --remove-secrets=PRISMA_DATABASE_URL
> ```
>
> **恒久対応**: deploy コマンドを直結 socket 版と Accelerate 版で明示分岐させることを推奨。
> データ (appdb テーブル + seed) は Cloud SQL に永続するため、配線の再設定のみで回復する。

### 1-7. Cloud Run Jobs で prisma db push

> **Note**: 本 generator 出力は `prisma/migrations` を持たない（db push 方式）。
> `prisma migrate deploy` は migration ファイルが 0 件のため空振りし、
> テーブルが作成されず P2021 "table public.user does not exist" が発生する。
> `prisma db push` を使用すること。

```bash
# builder ステージのイメージを使用（Prisma CLI + prisma.config.ts + schema +
# full node_modules を含む）。DATABASE_URL は Cloud SQL 直結を渡す
# （Accelerate では db push 不可のため PRISMA_DATABASE_URL は渡さない）。
# --accept-data-loss: schema 変更時のデータロス承認フラグ（本番では慎重に）
# --skip-generate は Prisma 7 で廃止 (github.com/prisma/web/issues/7373)
gcloud run jobs create app-migrate \
  --image="$MIGRATE_IMAGE_TAG" \
  --region="$REGION" \
  --service-account="$SA_EMAIL" \
  --set-cloudsql-instances="$CLOUD_SQL_CONNECTION_NAME" \
  --set-secrets="DATABASE_URL=app-database-url:latest" \
  --command="npx" \
  --args="prisma,db,push,--accept-data-loss"

# 実行
gcloud run jobs execute app-migrate --region="$REGION" --wait

# 完了確認: ログで以下のいずれかが出力されていれば成功
# - "Your database is now in sync with your Prisma schema."  (schema 同期完了)
# - "Database is already in sync with the Prisma schema."   (既に同期済み)
gcloud run jobs logs show app-migrate --region="$REGION" --limit=50
```

#### db:seed-tenant — 初回 db push 後の必須ステップ

> **警告**: db push 後に seed を実行しないと、signup 時に `user_tenant_id_fkey` FK 違反でサインアップが失敗する。
> **必須順序**: db push → db:seed-tenant → (アプリ起動後) signup 可

seed スクリプト (`scripts/seed-tenant.ts`) は DATABASE_URL (Cloud SQL socket 直結) を使用する。
PRISMA_DATABASE_URL (Accelerate) は不要。migrate Job 経由で socket 接続するため、既存の app-migrate Job に続けて実行できる。

seed が作成するもの:
1. `pg_trgm` 拡張
2. default テナント (`id`/`slug=default` — `user.tenant_id` の既定値と一致)
3. 管理者ユーザー `admin@example.com` / `password123`

```bash
# db push 完了後に続けて seed を実行する
# (同じ app-migrate Job に db:seed-tenant コマンドを渡す)
gcloud run jobs update app-migrate \
  --region="$REGION" \
  --args="npm,run,db:seed-tenant"

# seed 実行
gcloud run jobs execute app-migrate --region="$REGION" --wait

# 完了確認
gcloud run jobs logs read app-migrate --region="$REGION" --limit=50

# 次のステップ (§1-8) に進む前に app-migrate を db push コマンドに戻す
gcloud run jobs update app-migrate \
  --region="$REGION" \
  --args="prisma,db,push,--accept-data-loss"
```

### 1-8. 403 Forbidden トラブルシュート / 公開アクセス堅牢化

#### 症状

**症状 A: HTTP 403 Forbidden**

Cloud Run サービス URL にアクセスすると `Error: Forbidden` (HTTP 403) が返る。

**症状 B: ページが無応答 / curl 000**

```
[auth][error] UntrustedHost: Host must be trusted. URL was: https://app-xxx.asia-northeast1.run.app/api/auth/session
```

Cloud Run ログに上記が出ていれば Auth.js v5 UntrustedHost が原因（reverse proxy 越しの Host ヘッダ検証失敗）。
`NEXTAUTH_URL` は Auth.js v5 では無視されるため、この設定では解消しない。

対処: `AUTH_TRUST_HOST=true` のみ設定 (§1-6 参照)。AUTH_URL ハードコード禁止 (再デプロイ後に placeholder 未展開 → 404 の原因)。
出典: errors.authjs.dev#untrustedhost

#### 原因の切り分け (インフラ層 vs アプリ層、症状 A 向け)

**Step 1: IDトークン curl でインフラ層かアプリ層かを確認**

```bash
# IDトークン付きリクエスト → 200 なら Cloud Run 認証設定が原因 (インフラ層)
# IDトークン付きでも 403/500 → アプリ側のエラー (アプリ層)
TOKEN=$(gcloud auth print-identity-token)
curl -sL -H "Authorization: Bearer $TOKEN" "$SERVICE_URL"
```

- 200 が返る → Cloud Run の IAM 設定が原因 → Step 2 へ
- 200 が返らない → アプリ側エラー → ログ確認: `gcloud run services logs read app --region=$REGION`

**Step 2: IAM ポリシーで allUsers invoker を確認**

```bash
gcloud run services get-iam-policy app --region=$REGION
```

出力に `members: - allUsers` + `role: roles/run.invoker` がなければ非公開。

**Step 3: allUsers に invoker を付与**

```bash
gcloud run services add-iam-policy-binding app \
  --region=$REGION \
  --member="allUsers" \
  --role="roles/run.invoker"
```

成功すれば 403 が解消される。

```bash
# ✅ -L フラグ必須 (307 リダイレクト追従)
curl -sL https://$SERVICE_URL/
# → 200 なら OK。途中 307 は正常。
```

#### 組織ポリシーでブロックされている場合

エラー例:

```
ERROR: (gcloud.run.services.add-iam-policy-binding) FAILED_PRECONDITION:
One or more users named in the policy do not belong to a permitted domain.
```

原因: `constraints/iam.allowedPolicyMemberDomains` (Domain Restricted Sharing) が
組織レベルで設定されており、allUsers (非ドメインメンバー) の付与を禁止している。

**対処 A: 組織管理者へ例外依頼 (推奨)**

1. GCP 組織管理者 (Org Policy Admin ロール保有者) に連絡
2. 対象プロジェクトへの `constraints/iam.allowedPolicyMemberDomains` 例外を申請
3. 例外付与後に Step 3 を再実行

> 注意: `iam.allowedPolicyMemberDomains` の例外追加には:
> - `roles/orgpolicy.policyAdmin` ロール (Org Admin ロール単独では不足)
> - 対象プロジェクトへの `constraints/iam.allowedPolicyMemberDomains` 例外追加
> の 2 ステップが必要。
> 通常は `--no-invoker-iam-check` (§1-6) の方が手間が少ない。

**対処 B: 非公開運用 + IDトークン認証**

allUsers 付与を諦め、認証付きアクセスのみで運用:

```bash
# アクセス時は常に IDトークンを付与
curl -sL -H "Authorization: Bearer $(gcloud auth print-identity-token)" https://$SERVICE_URL/
```

PoC・内部確認目的ならこれで十分。

**対処 C: IAP (Identity-Aware Proxy) 経由で公開**

Cloud Run に IAP を設定し、Google アカウント認証 (特定ドメイン) での公開アクセスを実現。
詳細は https://cloud.google.com/iap/docs/enabling-cloud-run を参照。

#### NEXTAUTH_URL との関係

> **NEXTAUTH_URL は 403 Forbidden と無関係**
>
> NEXTAUTH_URL は Next.js (NextAuth.js) がコールバック URL を生成するための
> アプリケーション設定変数。Cloud Run の IAM / 組織ポリシーとは無関係。
> 403 の解消は上記 Step 1〜3 で行う。

#### 症状 C: P1001 "Can't reach database server" / driverAdapterError

**症状**

サインアップ等の DB アクセス時に以下のエラーが発生する:

```
PrismaClientInitializationError: Can't reach database server
error code: P1001
driverAdapterError: ...
```

**原因**

`PRISMA_DATABASE_URL` が Cloud Run service env に未設定、または placeholder のまま。
`lib/prisma.ts` が `else`（pg アダプタ直結）分岐に落ち、Cloud Run から DB への直接 socket 接続を試みるが、
Cloud Run では Cloud SQL socket は `--set-cloudsql-instances` なしに使えないため P1001 が発生する。
`driverAdapterError` は Accelerate 分岐に入っていない証拠。

**診断**

```bash
# service env に PRISMA_DATABASE_URL が存在するか確認
gcloud run services describe app --region=$REGION \
  --format='value(spec.template.spec.containers[0].env[].name)' \
  | grep PRISMA_DATABASE_URL
# → 出力なし → 未設定 (下記対処 1)

# secret の値が placeholder でないか確認
gcloud secrets versions access latest --secret=app-prisma-database-url | head -c 20
# → "<YOUR_ACCELERATE" で始まれば placeholder のまま (下記対処 2)
```

**対処 1: env に PRISMA_DATABASE_URL を追加**

```bash
gcloud run services update app \
  --region=$REGION \
  --update-secrets=PRISMA_DATABASE_URL=app-prisma-database-url:latest
```

**対処 2: secret の値が placeholder の場合**

§1-3.5 を参照して Prisma Accelerate API キーを取得し、以下で secret を更新:

```bash
echo -n "prisma://accelerate.prisma-data.net/?api_key=<REAL_KEY>" \
  | gcloud secrets versions add app-prisma-database-url --data-file=-
# 更新後は revision に反映させるため再 deploy または:
gcloud run services update app --region=$REGION
```

**注意**: Accelerate 分岐発動後に別エラーが出る可能性あり。§1-9 の Step B（起動ログ確認）で継続監視すること。

#### 症状 D: 再デプロイ後 P1001 再発

- **症状**: 再デプロイ後に P1001 "Can't reach database server" が再発
- **原因**: `gcloud run deploy` が Accelerate 既定設定に戻し、直結 socket 構成が消失
  - `PRISMA_DATABASE_URL` が復活、`--add-cloudsql-instances` / `DATABASE_URL` ソケット設定が消失
- **対処**: §1-6 の「直結 socket PoC 構成の再適用コマンド」を実行

---

### 1-9. 初期画面 200 確認

```bash
SERVICE_URL=$(gcloud run services describe app --region="$REGION" --format="value(status.url)")
echo "Service URL: $SERVICE_URL"

curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL"
# → 200 であること

# ---- Prisma Accelerate 分岐確認 ----
# Step A: service env に PRISMA_DATABASE_URL が実在することを確認
gcloud run services describe app --region=$REGION \
  --format='value(spec.template.spec.containers[0].env[].name)' \
  | grep PRISMA_DATABASE_URL
# → "PRISMA_DATABASE_URL" が出力されれば OK
# → 出力なし → --update-secrets で追加:
#   gcloud run services update app --region=$REGION \
#     --update-secrets=PRISMA_DATABASE_URL=app-prisma-database-url:latest

# Step B: 起動ログで Accelerate 分岐が発動していることを確認
gcloud run services logs read app --region=$REGION --limit=50 \
  | grep -i "accelerate\|prisma"
# → "Using Accelerate URL for Prisma Client" が出ていれば OK
# → 出ていなければ PRISMA_DATABASE_URL が設定されていないか placeholder のまま
```

---

## Phase 2: 検証

```bash
# 生存確認: root URL の疎通確認 (200 が返れば稼働中)
curl -sL -o /dev/null -w "%{http_code}" "${SERVICE_URL}/"
# → 200 であること

# 機能疎通: signup ページの疎通確認
curl -sL -o /dev/null -w "%{http_code}" "${SERVICE_URL}/signup"
# → 200 または 302 (auth redirect) であること

# 注意: 本 generator 出力には `/api/health` route が存在しない。
# health check endpoint が必要な場合は `app/api/health/route.ts` を別途追加すること (PoC 範囲外)。

# ログ確認
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=app" \
  --limit=50 --format="table(timestamp,textPayload)"

# ファイルアップロード確認 (GCS)
# --- 事前: GCS_BUCKET_NAME が env に存在するか確認 ---
gcloud run services describe app \
  --region=$REGION \
  --format='value(spec.template.spec.containers[0].env)'
# → GCS_BUCKET_NAME が表示されること・バケット名が実在バケットと一致すること

# ブラウザで ${SERVICE_URL} を開き、添付ファイルアップロードを試みる
# アップロード後: gcloud storage ls gs://${GCS_BUCKET}/

# --- GCS 403 発生時の切り分け ---
# (A) env 欠落: GCS_BUCKET_NAME が service env に未設定
#     対処: gcloud run services update app --region=$REGION --update-env-vars=GCS_BUCKET_NAME=<実際のバケット名>
# (B) SA 権限不足: service logs に `403 Forbidden`
#     対処: §1-4 のバケット単位直付与コマンドを再実行する
```

---

## Phase 3: 完全撤去手順 (課金を残すな)

PoC 終了後は必ず全リソースを削除すること。**削除順序を守ること**（依存関係あり）。

```bash
# 1. Cloud Run サービス削除
gcloud run services delete app --region="$REGION" --quiet

# 2. Cloud Run Jobs 削除
gcloud run jobs delete app-migrate --region="$REGION" --quiet

# 3. Cloud SQL インスタンス削除 (バックアップも含む)
gcloud sql instances delete "$INSTANCE_NAME" --quiet

# 4. GCS バケット削除 (オブジェクトごと)
gcloud storage rm -r "gs://${GCS_BUCKET}/"

# 5. Artifact Registry リポジトリ削除 (イメージごと)
gcloud artifacts repositories delete "$REPO_NAME" \
  --location="$REGION" --quiet

# 6. Secret Manager シークレット削除
for secret in app-database-url app-prisma-database-url app-auth-secret app-nextauth-url app-gcs-bucket-name; do
  gcloud secrets delete "$secret" --quiet
done

# 7. サービスアカウント削除
gcloud iam service-accounts delete "$SA_EMAIL" --quiet

# 8. 課金リソース確認
gcloud projects list  # このプロジェクトのリソースが消えたこと
gcloud sql instances list --filter="name:app-*"   # 空であること
gcloud run services list --region="$REGION"       # 空であること
gcloud artifacts repositories list --location="$REGION"  # 空であること
```

---

## pg_bigm / 全文検索の制約 (🚨殿裁可待ち)

| 項目 | 内容 |
|------|------|
| **問題** | Cloud SQL では `pg_bigm` 拡張がサポートされない（2024年時点で未提供） |
| **影響** | GCP デプロイ後の日本語全文検索（`bigm_fields` 指定のカラム）が動作しない可能性 |
| **現状** | opt-in 外（Vercel/ローカル）では全文検索の挙動変化なし |

### 代替案

| 案 | 内容 | コスト | 精度 |
|----|------|--------|------|
| **A: pg_trgm 使用** | PostgreSQL 標準拡張（Cloud SQL 対応済み）。`LIKE '%検索語%'` より高速だが日本語精度は bigm より低い | なし | 中 |
| **B: Algolia / Typesense 外部検索** | 専用検索サービスへのインデックス同期。高精度・高可用だが費用増 | +$30〜/月 | 高 |
| **C: GCP 環境で全文検索縮退** | `bigm_fields` を GCP 向けビルドでは無効化。検索機能を部分的に制限 | なし | なし |

**推奨**: まず **A (pg_trgm)** で試し、精度不足であれば **B** へ移行。

**殿の裁可をお待ちする事項**:
- Cloud SQL での全文検索方針（A / B / C）の決定
- pg_trgm 採用の場合: schema 変更ルールを generator に追加するか否か

---

## @google-cloud/storage の追加方法

x-cloud:gcp opt-in 後、consumer 側（または app-generator-2 自体）で以下を実行:

```bash
npm install @google-cloud/storage
```

### 必要な環境変数

| 変数名 | 説明 |
|--------|------|
| `GCS_BUCKET_NAME` | GCS バケット名（§1-3 で作成したバケット） |
| `GOOGLE_APPLICATION_CREDENTIALS` | サービスアカウントキーのパス（ローカル開発時のみ） |

Cloud Run 上では Workload Identity（サービスアカウント紐付け）を使用するため `GOOGLE_APPLICATION_CREDENTIALS` は不要。

---

## ローカル Docker 動作確認手順（PoC 事前検証）

```bash
# next.config.ts に output: 'standalone' があることを確認
grep "output: 'standalone'" next.config.ts

# ビルド確認 (standalone ビルドが必要)
npm run build

# Docker ビルド
docker build -t app-local-test .

# ローカル Postgres 起動 (殿サーバ proj_a=3006 と非重複ポート 5433 使用)
docker run -d --name pg-local-test \
  -e POSTGRES_DB=localtest \
  -e POSTGRES_PASSWORD=testpass \
  -p 5433:5432 \
  postgres:16-alpine

# コンテナ起動 (3009 ポート)
docker run -d --name app-local-test \
  -e DATABASE_URL="postgresql://postgres:testpass@host.docker.internal:5433/localtest" \
  -e AUTH_SECRET="local-test-secret" \
  -e NEXTAUTH_URL="http://localhost:3009" \
  -e NODE_ENV="production" \
  -p 3009:3000 \
  app-local-test

# prisma db push（本 generator 出力は db push 方式）
docker exec app-local-test sh -c "npx prisma db push --accept-data-loss"

# 200 確認
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:3009/

# クリーンアップ
docker stop app-local-test pg-local-test
docker rm app-local-test pg-local-test
```
