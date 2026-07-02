# rate-limit x-cloud 対応 設計書

**cmd_263 / 2026-07-02**
**対象**: `~/work/sandbox/app-generator-2` (branch: doreen/cloud)
**ステータス**: 殿裁可待ち

---

## 1. 現状確認 (劣化の根拠)

### 1-1. lib/rate-limit/ の構造

| ファイル | 役割 |
|---------|------|
| `lib/rate-limit/index.ts` | エントリポイント。`getRateLimiter()` factory + `DEFAULT_BUCKETS` 定義 |
| `lib/rate-limit/redis.ts` | ioredis + Lua sliding-window。分散環境で真のセキュリティ境界を提供 |
| `lib/rate-limit/in-memory.ts` | per-process sliding-window log。MAX_KEYS=10,000 LRU。**dev/Cypress 用** |

**SoT**: handwritten (code_generator テンプレートなし)

### 1-2. 分岐ロジック

```typescript
// lib/rate-limit/index.ts
function getRateLimiter(): RateLimiter {
  if (process.env.REDIS_URL) {
    return createRedisRateLimiter(DEFAULT_BUCKETS);   // redis.ts
  }
  return createInMemoryRateLimiter(DEFAULT_BUCKETS);  // in-memory.ts
}
```

### 1-3. auth bucket 設定

| bucket | limit | window | 対象パス |
|--------|-------|--------|---------|
| `auth:signin:credentials` | **10/min** | 60s | `/api/auth/signin/credentials`, `/api/auth/_log` (POST) |
| `auth:signin:provider` | **30/min** | 60s | `/api/auth/signin/{provider}` (OAuth開始) |
| `auth:callback` | **60/min** | 60s | `/api/auth/callback/*` |

### 1-4. GCP Cloud Run での劣化

**問題**: `REDIS_URL` 未設定 → `in-memory.ts` fallback

| 劣化要因 | 影響 |
|---------|------|
| **scale-to-zero** | cold start でプロセス再起動 → カウンタリセット → ウィンドウ内試行回数リセット |
| **複数インスタンス** | 各インスタンスが独立カウンタ → 実効 limit = `N × 設定値`。攻撃者は `N × 10/min` まで試行可能 |
| **セキュリティ境界** | `in-memory.ts` コメント: "本番マルチインスタンス環境ではセキュリティ境界にならない" — 実装者自身が明記 |

**結論**: REDIS_URL 未設定の Cloud Run 本番環境では、クレデンシャル brute force 保護が**実質無効**。

---

## 2. backend 4案 trade-off 表

| 案 | backend | コード変更 | VPC / インフラ | コスト | GCP 専用 | scale-to-zero 親和 |
|----|---------|-----------|---------------|--------|---------|-------------------|
| **(a) Upstash Redis (TCP)** | Upstash managed Redis (ioredis TCP) | **ゼロ** (REDIS_URL 設定のみ) | **不要** | 従量課金 (free tier あり) | **No** (任意クラウド) | **◎** |
| **(b) GCP Memorystore for Redis** | Google Cloud Memorystore | ゼロ (REDIS_URL = VPC内IP) | VPC Connector 必須 ($6〜/月) | 常時課金 $16〜/月 | **Yes** (GCP固有) | △ (常時稼働) |
| **(c) Upstash REST adapter 新設** | @upstash/redis (HTTP API) | adapter 新設 (redis.ts を置換) | **不要** | 従量課金 | No | **◎** |
| **(d) in-memory 継続** | 既存 in-memory.ts | **ゼロ** | 不要 | ゼロ | No | — |

### 各案の詳細

#### (a) Upstash Redis via REDIS_URL **[推奨]**

```
REDIS_URL=rediss://:password@xyz.upstash.io:6379
```

- `redis.ts` の ioredis が Upstash TCP endpoint (TLS: `rediss://`) を**そのまま利用可能**
- コード変更なし。環境変数1本の追加のみ
- Upstash free tier: 10,000 commands/day (PoC には十分)
- 複数インスタンス・cold start 後もカウンタ永続
- Cloud Run → Upstash は Public Internet 経由 TLS → VPC Connector 不要

#### (b) GCP Memorystore for Redis

- ioredis adapter そのまま使用可 (REDIS_URL を VPC 内の IP に変更)
- **VPC Connector が必須** (Cloud Run → VPC は Serverless VPC Access Connector 経由)
  - Connector コスト: $0.08/CPU-hr × 2 minimum インスタンス ≒ **$6〜/月**
  - Memorystore Basic 1GB: **$16〜/月** (常時課金)
- GCP 以外のクラウドに移植不可
- rate-limit 用途に対しては over-spec かつ高コスト

#### (c) Upstash REST adapter 新設

- `@upstash/redis` パッケージ (Upstash 公式 HTTP クライアント)
- VPC 不要・完全 serverless
- Edge Runtime でも動作 (HTTP fetch ベース)
- **新規 adapter 作成が必要** (redis.ts の ioredis → REST 置換、既存テスト書き換え)
- (a) で ioredis が Upstash TCP をサポートするため**追加の利点が薄い**

#### (d) in-memory 継続

- コスト・インフラ変更ゼロ
- PoC / dev / Cypress 専用として許容
- **本番環境では非セキュリティ境界** — brute force 保護として機能しない

---

## 3. DP-1〜4 (殿裁可ポイント)

### DP-1: rate-limit backend 選定

**推奨: (a) Upstash Redis via REDIS_URL**

| 選択肢 | 推奨理由 / 懸念点 |
|--------|-----------------|
| (a) Upstash TCP **[推奨]** | コード変更ゼロ・VPC 不要・free tier あり・複数クラウド対応・PoC / 本番ともに最小コスト |
| (b) Memorystore | GCP 専用・VPC Connector + 常時課金 = PoC に不釣り合い |
| (c) REST adapter | 利点が (a) と重複・adapter 新設コストが高い |
| (d) in-memory | 本番不可 |

### DP-2: PoC フェーズの rate-limit 方針

**推奨: PoC は (d) in-memory 許容・本番 go-live 前に (a) Upstash 化を必須化**

| オプション | 内容 | 推奨度 |
|-----------|------|--------|
| A: PoC も即 Redis 化 | Upstash アカウント作成 + REDIS_URL 設定のみ。コスト $0 (free tier) | 可 |
| **B: PoC は in-memory 許容 [推奨]** | PoC 完遂が目的 → rate-limit 強化は本番フェーズで実施 | 推奨 |

判断基準: PoC が実ユーザーを招待するか否か。招待するなら Option A 推奨。

### DP-3: Upstash REST adapter 新設の要否

**推奨: 不要**

理由:
- `redis.ts` の ioredis は Upstash TCP endpoint (`rediss://`) を**そのまま利用可能**
- REST adapter を新設する技術的必要性がない
- ioredis + TLS で Next.js middleware (proxy.ts) から問題なく接続可能
- Edge Runtime 対応が必要な場合のみ REST adapter を検討 (今回は不要)

### DP-4: runbook への REDIS_URL provisioning 追記

**推奨: §1-3 に Upstash 登録手順 + §1-6 に未設定時警告を追記**

提案する runbook 追記内容:

```bash
# §1-3 (オプション / 本番推奨): Upstash Redis で rate-limit を分散化
# PoC は REDIS_URL 未設定で in-memory fallback (per-instance のみ)
# 本番 go-live 前に以下を実施:
# 1. Upstash Console (console.upstash.com) で Redis database 作成
# 2. Endpoint (rediss://...) を Secret に格納:
echo -n "rediss://:password@xyz.upstash.io:6379" | gcloud secrets create app-redis-url \
  --data-file=- --replication-policy=automatic
# 3. deploy コマンドの --set-secrets に追加:
#    REDIS_URL=app-redis-url:latest

# §1-6 注記:
# ⚠️ REDIS_URL 未設定 = rate-limit は per-instance in-memory のみ (PoC 可・本番不可)
# 複数インスタンス / scale-to-zero で limit がリセットされ brute force 保護が無効になる。
```

---

## 4. runbook 反映方針

| セクション | 追記内容 | 優先度 |
|-----------|---------|--------|
| §1-3 | Upstash Redis セットアップ手順 (DP-4 option A採用時) | DP-1/DP-2 裁可後 |
| §1-6 | `# ⚠️ REDIS_URL 未設定 = per-instance rate-limit (prod 不可)` 注記 | 常に追記推奨 |
| §1-8 | 症状E追加: rate-limit が効かない場合 → REDIS_URL 確認 | DP-1 裁可後 |

---

## 5. 実装スコープ (裁可後の作業一覧)

### DP-1 = (a) Upstash 採用の場合

| 作業 | 担当 | 備考 |
|------|------|------|
| Upstash Console で DB 作成 | 殿 | console.upstash.com |
| `app-redis-url` Secret 作成 | 足軽 | gcloud secrets create |
| deploy コマンドに `--set-secrets REDIS_URL=app-redis-url:latest` 追加 | 足軽 | runbook §1-6 更新 |
| runbook §1-3 に Upstash 手順追記 | 足軽 | gcp-cloud-run-runbook.md |
| runbook §1-6 に REDIS_URL 未設定時警告追記 | 足軽 | |
| 動作確認: GCP 上で 429 応答確認 | 殿 | 11回目で 429 が返ることを確認 |

### DP-2 = PoC は in-memory 許容の場合 (最小作業)

| 作業 | 担当 | 備考 |
|------|------|------|
| runbook §1-6 に REDIS_URL 未設定時警告のみ追記 | 足軽 | コード・Secret 変更なし |

**コード変更なし**: DP-1 = (a) Upstash 採用でも既存 `redis.ts` (ioredis) が動作するためコード修正不要。

---

*設計者: gunshi / 2026-07-02*
*調査ベース: subtask_263a (ashigaru1) — lib/rate-limit/ コード調査*
