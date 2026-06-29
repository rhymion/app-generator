# GCP Cloud Run デプロイ Runbook (PoC 使い捨て)

## 前提

- `x-cloud: gcp` opt-in が `code_generator/json_schema.yaml` に設定済み
- `gcloud` CLI インストール済み
- `gcloud auth login` 実施済み（殿が実行: `! gcloud auth login`）
- `gcloud config set project <PROJECT_ID>`
- Docker インストール済み（`docker --version` で確認）

## Phase 1: 構築手順

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

### 1-1. Artifact Registry の作成

```bash
PROJECT_ID=$(gcloud config get-value project)
REGION=asia-northeast1
REPO_NAME=app-repo

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
  --region="$REGION" \
  --storage-type=SSD \
  --storage-size=10GB \
  --no-backup

gcloud sql databases create "$DB_NAME" --instance="$INSTANCE_NAME"

# DBパスワードを生成・記録
DB_PASSWORD=$(openssl rand -base64 32)
echo "DB_PASSWORD=$DB_PASSWORD"  # 次ステップで使用

gcloud sql users set-password postgres \
  --instance="$INSTANCE_NAME" \
  --password="$DB_PASSWORD"

# Cloud SQL接続文字列 (Cloud Runからは Unix socket経由)
CLOUD_SQL_CONNECTION_NAME="${PROJECT_ID}:${REGION}:${INSTANCE_NAME}"
DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${CLOUD_SQL_CONNECTION_NAME}"
```

### 1-3. Secret Manager へのシークレット登録

```bash
# 必須シークレット
echo -n "$DATABASE_URL" | gcloud secrets create app-database-url --data-file=-
echo -n "$(openssl rand -base64 32)" | gcloud secrets create app-auth-secret --data-file=-
echo -n "https://<your-cloud-run-url>" | gcloud secrets create app-nextauth-url --data-file=-

# GCS バケット名 (§1-4 でバケット作成後に設定)
GCS_BUCKET="${PROJECT_ID}-app-uploads"
gcloud storage buckets create "gs://${GCS_BUCKET}" --location="$REGION"
echo -n "$GCS_BUCKET" | gcloud secrets create app-gcs-bucket-name --data-file=-
```

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

# GCS 書き込み
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin" \
  --condition="resource.name.startsWith(//storage.googleapis.com/projects/_/buckets/${GCS_BUCKET})"
```

### 1-5. docker build & push to Artifact Registry

```bash
IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/app:latest"

# プロジェクトルートで実行 (x-cloud opt-in 済み Dockerfile を使用)
docker build -t "$IMAGE_TAG" .

docker push "$IMAGE_TAG"
```

### 1-6. Cloud Run deploy

```bash
gcloud run deploy app \
  --image="$IMAGE_TAG" \
  --platform=managed \
  --region="$REGION" \
  --service-account="$SA_EMAIL" \
  --add-cloudsql-instances="$CLOUD_SQL_CONNECTION_NAME" \
  --set-secrets="DATABASE_URL=app-database-url:latest,AUTH_SECRET=app-auth-secret:latest,NEXTAUTH_URL=app-nextauth-url:latest,GCS_BUCKET_NAME=app-gcs-bucket-name:latest" \
  --set-env-vars="NODE_ENV=production" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=10 \
  --memory=1Gi \
  --cpu=1
```

### 1-7. Cloud Run Jobs で prisma migrate deploy

```bash
gcloud run jobs create app-migrate \
  --image="$IMAGE_TAG" \
  --region="$REGION" \
  --service-account="$SA_EMAIL" \
  --add-cloudsql-instances="$CLOUD_SQL_CONNECTION_NAME" \
  --set-secrets="DATABASE_URL=app-database-url:latest" \
  --command="npx" \
  --args="prisma,migrate,deploy"

# 実行
gcloud run jobs execute app-migrate --region="$REGION" --wait
```

### 1-8. 初期画面 200 確認

```bash
SERVICE_URL=$(gcloud run services describe app --region="$REGION" --format="value(status.url)")
echo "Service URL: $SERVICE_URL"

curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL"
# → 200 であること
```

---

## Phase 2: 検証

```bash
# ヘルスチェック
curl -s "${SERVICE_URL}/api/health" | jq .

# ログ確認
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=app" \
  --limit=50 --format="table(timestamp,textPayload)"

# ファイルアップロード確認 (GCS)
# ブラウザで ${SERVICE_URL} を開き、添付ファイルアップロードを試みる
# アップロード後: gcloud storage ls gs://${GCS_BUCKET}/
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
for secret in app-database-url app-auth-secret app-nextauth-url app-gcs-bucket-name; do
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

# prisma migrate
docker exec app-local-test sh -c "npx prisma migrate deploy"

# 200 確認
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:3009/

# クリーンアップ
docker stop app-local-test pg-local-test
docker rm app-local-test pg-local-test
```
