# GDPR / APPI コンプライアンス設計書

**proj_a (app-generator-1) — Privacy by Design 実装方針**

| 項目 | 内容 |
|------|------|
| 文書バージョン | 0.1 (初版) |
| 作成日 | 2026-06-27 |
| 作成者 | 軍師 (subtask_238b) |
| 調査元 | 足軽1号 調査報告 (subtask_238a) |
| ステータス | 設計書 — 実装は後続 cmd |
| 対象法域 | GDPR (EU), APPI (日本), CCPA/CPRA (米・参考) |

> **免責**: 本書は実装で取りうる対応策を尽くす技術設計文書である。最終的な法的判断は弁護士の領分であり、本書のみをもって法的コンプライアンスを保証するものではない。

---

## 目次

1. [概要と背景](#1-概要と背景)
2. [現状 PII 分布マップ](#2-現状-pii-分布マップ)
3. [消去権 (GDPR 17条) 戦略](#3-消去権-gdpr-17条-戦略)
4. [氏名平文残存の対処設計](#4-氏名平文残存の対処設計)
5. [サインアップ時の法的根拠設計](#5-サインアップ時の法的根拠設計)
6. [internal vs consumer 切替設計](#6-internal-vs-consumer-切替設計)
7. [analytics (cmd_102) との接続](#7-analytics-cmd_102-との接続)
8. [APPI / CCPA-CPRA 差分と横断要件](#8-appi--ccpa-cpra-差分と横断要件)
9. [実装ロードマップ](#9-実装ロードマップ)
10. [要裁可の決定点 (DP)](#10-要裁可の決定点-dp)

---

## 1. 概要と背景

### 1.1 proj_a の位置付け

proj_a は **app generator** (コード自動生成システム) である。その North Star は「自動生成コードのパフォーマンス改善と品質向上」である。Privacy by Design をジェネレーター側に組み込むことで、ジェネレーターが出力するすべてのアプリに一貫したプライバシー対応を自動付与する — これが本書の根幹戦略である。

個別アプリをパッチ対応するのではなく、**generator テンプレートとスキーマアノテーションを変更することで、生成物すべてに波及させる**。これが North Star との整合である。

### 1.2 本書の位置付け

```
本書 (設計書)
  ↓
後続 cmd (Phase 1-3 実装)
  ↓
generator テンプレート変更 + schema アノテーション追加
  ↓
全生成アプリへの自動波及
```

本書は **設計のみ** を行う。コード変更・schema 変更・generate-code 実行は行わない。

### 1.3 対応すべき法的義務の概観

| 法域 | 主要義務 | 優先度 |
|------|---------|--------|
| GDPR (EU) | 忘れられる権利 (Art.17), 法的根拠 (Art.6), 侵害通知 72h (Art.33) | 最高 |
| APPI (日本) | 第三者提供制限, 保有個人情報の開示・訂正・利用停止, 漏洩報告 | 最高 |
| CCPA/CPRA (米) | 削除権, オプトアウト権, データ最小化 | 参考 |

---

## 2. 現状 PII 分布マップ

*足軽1号調査報告 (subtask_238a) より引用。ファイル行番号は `prisma/schema.prisma` を指す。*

### 2.1 直接 PII フィールド一覧

| モデル | フィールド | 型 | 行番号 | 分類 | 備考 |
|--------|----------|----|--------|------|------|
| `user` | `name` | `String` | schema.prisma:47 | 直接 PII | 表示名・氏名そのもの |
| `user` | `email` | `String @unique` | schema.prisma:48 | 直接 PII | メールアドレス・ユニーク制約あり |
| `user` | `password` | `String?` | schema.prisma:49 | 機密 | bcrypt ハッシュ。SSO ユーザーは null |
| `user` | `api_key` | `String?` | schema.prisma:50 | 機密 | API キー。@@index あり |
| `user` | `image` | `String?` | schema.prisma:51 | 間接 PII | プロフィール画像 URL |
| `user` | `emailVerified` | `DateTime?` | schema.prisma:52 | 間接 PII | アカウント活動履歴 |
| `user` | `mfa_secret` | `String?` | schema.prisma:66 | 機密 | AES-256-GCM 暗号文 |
| `Account` | `providerAccountId` | `String` | schema.prisma:360 | 間接 PII | OAuth プロバイダー固有 ID |
| `Account` | `refresh_token` | `String?` | schema.prisma:361 | 機密 | OAuth リフレッシュトークン |
| `Account` | `access_token` | `String?` | schema.prisma:362 | 機密 | OAuth アクセストークン |
| `Account` | `id_token` | `String?` | schema.prisma:364 | 直接 PII リスク | JWT 内に name/email/sub を含む可能性 |
| `Session` | `sessionToken` | `String @unique` | schema.prisma:375 | 機密 | セッショントークン |

### 2.2 削除阻害 FK 一覧

物理削除を阻む Restrict 制約。**赤字**は特に対処が必要な箇所。

| 参照元モデル | フィールド | on_delete | 行番号 | リスク評価 |
|------------|----------|-----------|--------|----------|
| `user` (自己参照) | `creator_id` | Restrict (非 nullable) | schema.prisma:73-74 | **最高**: ブートストラップユーザーが実質削除不可 |
| `user` (自己参照) | `updater_id` | Restrict (非 nullable) | schema.prisma:75-76 | **最高**: 同上 |
| `audit_log` | `actor_user_id` | Restrict (明示・nullable) | schema.prisma:301-302 | **高**: 設計意図的 Restrict。監査ログ存在中は削除不可 |
| `role` | `creator_id` / `updater_id` | Restrict (非 nullable) | schema.prisma:109-112 | 中 |
| `organization` | `creator_id` / `updater_id` | Restrict (非 nullable) | schema.prisma:127-130 | 中 |
| `permission` | `creator_id` / `updater_id` | Restrict (非 nullable) | schema.prisma:146-149 | 中 |
| `approval_flow` | `creator_id` / `updater_id` | Restrict (非 nullable) | schema.prisma:177-180 | 中 |
| `approval_history` | `creator_id` | Restrict (非 nullable) | schema.prisma:205-206 | 中 |
| `comment` | `creator_id` | Restrict (非 nullable) | schema.prisma:223-224 | 中 |
| `reaction` | `user_id` | Restrict (非 nullable) | schema.prisma:231-232 | 中 |
| `dashboard` | `creator_id` / `updater_id` | Restrict (非 nullable) | schema.prisma:266-269 | 中 |
| `tenant` | `creator_id` / `updater_id` | SetNull (nullable) | schema.prisma:36-39 | 低 (削除阻害なし) |
| `mfa_recovery_code` | `user_id` | Cascade | schema.prisma:322-323 | 低 (GDPR 対応済み) |
| `Account` | `userId` | Cascade | schema.prisma:357, 368 | 低 (GDPR 対応済み) |
| `Session` | `userId` | Cascade | schema.prisma:376, 378 | 低 (GDPR 対応済み) |

### 2.3 平文 PII 漏れ込みリスク一覧

| モデル | フィールド | 行番号 | リスクレベル | 懸念事項 |
|--------|----------|--------|------------|---------|
| `comment` | `message` | schema.prisma:217 | **高** | 自由記述テキスト。他ユーザーの氏名・メールが書き込まれる可能性が最も高い |
| `approval_history` | `message` | schema.prisma:202 | 中 | 承認コメント欄。レビュアーが他者名を平文で記述する可能性 |
| `audit_log` | `metadata` | schema.prisma:306 | 中 | `lib/audit-log.ts` にガイドあり (`PII-sensitive should be omitted or hashed`) が強制なし |
| `attachment` | `name`, `path` | schema.prisma:252-253 | 中 | `John_Smith_passport.pdf` 等の PII 含有ファイル名が平文保存 |

### 2.4 スキーマアノテーション現状

足軽調査より: **`x-pii` / `x-retention` / `x-gdpr` / `x-sensitive` アノテーションはすべて未実装**。`code_generator/json_schema.yaml` に該当記述なし (grep 確認済み、subtask_238a)。

---

## 3. 消去権 (GDPR 17条) 戦略

### 3.1 user 物理削除不可の前提と根拠

現状の schema では **user を物理削除することは不可能**である。根拠:

1. `user.creator_id` / `user.creator_id` (自己参照・非 nullable・Restrict): あるユーザーが別ユーザーを作成した瞬間、creator は削除不可になる (schema.prisma:73-76)
2. `audit_log.actor_user_id` (nullable だが明示的 Restrict, schema.prisma:301-302): コメントに `Rows must outlive the user they reference` とあり、意図的設計
3. 10 モデル・14 以上の非 nullable Restrict FK が連鎖的に削除を阻む

**結論**: 物理削除ではなく **「行保持 + PII スクラブ (匿名化)」** を採用する。これは GDPR Art.17 の実現方法として認められている (消去 = 復元不可能にすること)。

### 3.2 anonymization vs pseudonymization の峻別

| 手法 | 定義 | GDPR 上の扱い | proj_a における採用方針 |
|------|------|-------------|-------------------|
| **Anonymization (匿名化・不可逆)** | 個人を特定できる情報を完全に除去。復元経路なし | 個人データではなくなる → GDPR 適用外 | **採用**: 消去要請時のデフォルト |
| **Pseudonymization (仮名化・可逆)** | 直接識別子を仮名 (トークン等) に置換。元データへのマッピングテーブルを別保管 | 個人データのまま → GDPR 適用継続 | **採用しない** (マッピングテーブルが残る限り消去権未達成) |

> **重要**: 「user_id を uuid のまま保持しつつ PII フィールドを消去」する手法は、**user_id → 実人物への復元経路が存在しない**ことを条件に Anonymization として扱う。復元経路の有無が峻別のポイント。

### 3.3 行保持 + PII スクラブによる匿名化の具体手順

消去要請 (DSAR) を受けた際の処理フロー:

```
1. 対象 user レコードを特定 (email で検索)
2. user テーブルの PII フィールドをスクラブ:
   - name      → "[deleted]"  (または固定プレースホルダ)
   - email     → "${userId}@deleted.invalid"  (userId 由来 placeholder — @unique 制約維持のため NULL 化より適切。NULL 化には nullable マイグレーションが必要で過剰。userId 由来のため実 PII を含まない)
   - password  → NULL
   - api_key   → NULL
   - image     → NULL
   - emailVerified → NULL
   - mfa_secret → NULL
3. Account テーブルの対象行を削除 (Cascade 済みだが明示的に確認)
4. Session テーブルの対象行を削除 (Cascade 済み)
5. audit_log.metadata の email 等 PII キーを "[redacted]" に置換
   actor_user_id は保持 (擬似匿名キーとして監査チェーン維持 — DP-6 改定参照)
6. comment.message / approval_history.message の PII 検出・上書き
   (自由記述のため半自動: 検索 + 人的確認 → Phase 3 で自動化検討)
7. attachment.name / attachment.path → "[redacted_N]" に変名
8. user レコードに anonymized_at タイムスタンプを記録
9. DSAR 対応完了を記録 (監査証跡)
```

### 3.4 user_id を opaque 代理キーとして扱う条件

匿名化後も `user_id` (UUID) はレコードに残る。これが「復元経路」にならないための条件:

- **user テーブルに個人を特定できるフィールドが一切残らない** (name / email / image がすべてスクラブ済み)
- **外部システムに user_id → 実人物のマッピングを保持しない** (analytics, ログシステム等)
- **スクラブ後の user レコードは `anonymized_at` フラグで管理し、ログイン不能にする**

条件が揃えば、`user_id` は匿名化後の参照整合性のための opaque キーとして扱え、GDPR 上は「個人データ」でなくなる。

### 3.5 FK 参照先の扱い (コメント/投稿等に残るユーザー参照の処理)

| 参照元 | `creator_id` / `user_id` の扱い | PII テキストの扱い |
|--------|-------------------------------|-----------------|
| `comment` | user 行残存・`creator_id` FK はそのまま (表示時 `[deleted]`) | `message` 内の PII テキストを人的 + 半自動で redact |
| `approval_history` | `creator_id` FK はそのまま | `message` 内の PII テキストを redact |
| `audit_log` | `actor_user_id` を保持 (擬似匿名キー — DP-6 改定) | `metadata` 内の email 等 PII キーを `[redacted]` に |
| `reaction` | `user_id` FK はそのまま (匿名ユーザーのリアクションとして扱う) | N/A |
| その他 `creator_id` 系 | FK はそのまま。表示時に「削除済みユーザー」として処理 | N/A |

---

## 4. 氏名平文残存の対処設計 (mention = 参照パターン)

### 4.1 現状の確認

足軽1号調査 (subtask_238a) によると:

- **`mention` テーブルは schema.prisma に存在しない**
- `reaction.user_id` は user_id FK 参照であり安全
- 平文 `@mention` パターンはテンプレートに確認できず
- **主要リスクは `comment.message` (schema.prisma:217) 内の自由記述テキスト**

### 4.2 @mention を user_id 参照として保存・表示時にレンダリングする設計

フリーテキスト内に `@john.smith` のような平文氏名を埋め込む代わりに、`@[user_id:uuid]` 形式で保存し、表示時に名前解決する設計を採用する。

```
保存形式 (DB): "承認をお願いします @[user_id:550e8400-e29b-41d4-a716-446655440000]"
表示形式 (UI): "承認をお願いします @John Smith"
消去後 (UI):  "承認をお願いします @[削除済みユーザー]"
```

**実装ポイント**:
- `comment.message` フィールドのパーサーで `@[user_id:xxx]` パターンを認識
- UI レンダリング時に user テーブルを JOIN して名前解決
- 消去後は user.name が `[deleted]` になるため自動的に匿名表示

### 4.3 generator テンプレートへの組み込み方針

`code_generator/templates/` に以下を追加:

1. **`mention_parser.ts.jinja2`**: `@[user_id:xxx]` パターンのパース・レンダリングユーティリティ
2. **`comment_actions.ts.jinja2`**: コメント保存時に `@名前` → `@[user_id:xxx]` に変換するロジック
3. **スキーマアノテーション `x-mention: true`**: フィールドに付与することで、generator がメンション対応コードを自動生成

### 4.4 手入力自由記述の運用プロセス (消去要請時の search/redact フロー)

既存の自由記述 (Phase 1 実装前の過去データ、または `@mention` 非対応フィールド) への対応:

```
Phase 1 (手動・セミ自動):
  1. 消去要請受領
  2. 対象 user の name / email を検索キーとして全テキストフィールドをフルテキスト検索
     (PostgreSQL: ilike '%name%' OR ilike '%email%')
  3. 発見した行を人的確認 → [redacted] で上書き
  4. 対応記録を DSAR 台帳に記録

Phase 3 (自動化検討):
  - LLM または正規表現ベースの PII 検出 + 自動 redact
  - 精度・誤検知率の評価が必要
```

### 4.5 残余リスクの文書化方針

以下は**技術的には除去困難な残余リスク**として文書化する:

- 匿名化処理前に第三者がコメントをスクリーンショット・コピーした場合
- バックアップメディアからの PII 復元 (バックアップ保持ポリシーを別途定義)
- 第三者統合サービスへの一時的なデータ送信履歴

---

## 5. サインアップ時の法的根拠設計

### 5.1 核心処理: 契約の履行 (GDPR 6条1(b))

サービス提供 (アカウント作成・ログイン・コア機能) に必要な個人データの処理は **契約の履行** を法的根拠とする。

- **consent 不要**: ユーザーが規約に同意してサインアップした時点で契約関係が成立
- **対象データ**: `user.email`, `user.name`, `user.password`, `Session`, `Account` (NextAuth)
- **「契約の履行」の適用条件**: サービス提供に真に必要なデータのみ (過剰収集は不可)

```
サインアップフロー:
  1. Privacy Notice 提示 (何を・なぜ・どのくらい保存するか)
  2. 利用規約同意チェックボックス (必須)
  3. アカウント作成 → 契約成立
  4. 追加処理 (analytics 等) は別の同意フローへ → Section 7 参照
```

### 5.2 付帯処理 (analytics 等): 明示 opt-in 同意の分離設計

契約の履行に **含まれない** 処理は、**明示的な同意 (GDPR 6条1(a))** を別途取得する。

| 処理 | 法的根拠 | 同意取得タイミング |
|------|---------|----------------|
| アカウント作成・認証 | 契約の履行 (Art.6(1)(b)) | 規約同意で完結 |
| 監査ログ (内部統制) | 正当な利益 (Art.6(1)(f)) | 不要 (LIA 実施が前提) |
| analytics (PostHog) | 同意 (Art.6(1)(a)) | サインアップ時の別途 opt-in |
| マーケティングメール | 同意 (Art.6(1)(a)) | 別途 opt-in |

### 5.3 サインアップ時に必要なもの

1. **Privacy Notice** (必須): 処理する個人データの種類・目的・保持期間・権利の案内
2. **利用規約同意** (必須): コア処理の法的根拠
3. **analytics opt-in** (任意・デフォルト off): 別チェックボックスで独立した同意
4. **未成年者チェック** (推奨): GDPR は 16歳未満に保護者同意を要求 (加盟国が 13歳に引き下げ可)

### 5.4 consent と legitimate interest の区別

```
consent (同意):
  - ユーザーが明示的に選択 (opt-in)
  - いつでも撤回可能
  - 撤回されたら処理を停止しなければならない
  - 使用場面: analytics, マーケティング

legitimate interest (正当な利益):
  - 事業上の利益 vs ユーザーの権利のバランステスト (LIA) が必要
  - 撤回権はない (反対権 = right to object があるだけ)
  - 使用場面: 内部不正調査、セキュリティ監視、監査ログ
  - ⚠️ 濫用注意: analytics を "legitimate interest" と主張する企業は GDPR 当局に否定されている
```

---

## 6. internal vs consumer 切替設計

### 6.1 二つのモード

| モード | 想定利用者 | controller/processor | DSAR 対応 | 同意管理 |
|--------|-----------|---------------------|---------|---------|
| **internal** | 企業内従業員 | Processor (企業がデータ管理者) | 簡略 (企業 IT を経由) | 雇用契約が根拠・consent 無効 |
| **consumer** | 一般消費者 | Controller (自社がデータ管理者) | フル対応 (直接受付・30日以内) | 明示 opt-in 必須 |

### 6.2 internal モードの特例

- **consent 無効**: 雇用関係においてユーザーは同意を自由に与えられないため、GDPR は雇用データへの consent を法的根拠として認めない
- **DSAR 簡略**: 従業員 DSAR は企業 IT/HR を経由。処理記録は企業が管理
- **保持期間**: 労働法に従う (退職後 N 年など)

### 6.3 consumer モードの要件

- DSAR 直接受付 (email または Web フォーム)
- 30 日以内の対応義務 (GDPR Art.12)
- 応答記録の保持
- 消去・ポータビリティ・訂正の各権利対応

### 6.4 schema アノテーション案

```yaml
# code_generator/json_schema.yaml への追加案 (DP-2 裁可待ち)

x-pii:
  type: string
  enum: [direct, indirect, sensitive, none]
  description: |
    PII分類。
    - direct: 直接個人を特定できる (name, email)
    - indirect: 組み合わせで特定可能 (image, emailVerified)
    - sensitive: 特別カテゴリ (GDPR Art.9) または機密認証情報
    - none: PII なし

x-retention:
  type: string
  description: |
    保持期間ポリシー。例: "account_lifetime", "7_years", "30_days_after_deletion"

x-gdpr-mode:
  type: string
  enum: [internal, consumer, both]
  default: both
  description: |
    このモデル/フィールドが適用されるモード。
    internal: 従業員データ専用
    consumer: 一般消費者専用
    both: 両方
```

### 6.5 proj_a の schema 駆動アーキテクチャへの乗せ方

```
json_schema.yaml にアノテーション追加
  ↓
code_generator が x-pii / x-retention / x-gdpr-mode を読み取る
  ↓
生成コード:
  - DSAR handler に PII フィールドを自動列挙
  - anonymization 関数に対象フィールドを自動指定
  - UI に同意バナー/プライバシーラベルを自動挿入
  ↓
全生成アプリに一貫した対応が波及
```

---

## 7. analytics (cmd_102) との接続

### 7.1 cmd_102 設計との整合確認

cmd_102 設計原則 (memory より):
- PostHog セルフホスト (WSL2 docker 制約あり)
- PII を含まぬキー計装
- opt-in default off

これらはすべて Section 5 の「consent 分離」設計と整合する。

### 7.2 analytics は非必須処理 → consent ゲート必須

```
サインアップ:
  □ 規約同意 (必須) → コア処理開始
  □ analytics 同意 (任意・デフォルト off) → PostHog 計装 ON

同意なし:
  → PostHog の identify() / capture() を呼ばない
  → 匿名セッション ID のみで集計 (個人特定不可)

同意あり:
  → PostHog に distinct_id として user_id (UUID のみ) を送信
  → PII フィールド (name, email) は送信しない
```

### 7.3 analytics 上の user_id の消去対応

消去要請時:

1. PostHog の `DELETE /api/person` API を呼び出し、distinct_id (= user_id) に紐づくデータを削除
2. 自社 DB の analytics_consent を revoked に更新
3. 以降の PostHog 送信を停止

**注意**: PostHog セルフホストの場合、`clickhouse` データの完全削除が必要。`person_distinct_id` テーブルも含む。削除 API の完全性は事前確認が必要。

### 7.4 audit_log.metadata との分離

足軽調査より: `lib/audit-log.ts` の `metadata` フィールドが事実上の内部 analytics ログとして機能するリスクがある (schema.prisma:306)。

対処:
- `audit_log.metadata` は **セキュリティ/コンプライアンス用途のみ** (正当な利益で処理可)
- 行動分析・マーケティング目的のデータは **PostHog のみ** に分離
- `lib/audit-log.ts` に型定義を追加し、`metadata` に PII が入らないよう型レベルで強制

---

## 8. APPI / CCPA-CPRA 差分と横断要件

### 8.1 APPI (日本) — 最優先対応

| 義務 | 内容 | GDPR との差分 |
|------|------|------------|
| 利用目的の特定・通知 | 取得時に利用目的を特定し、本人に通知または公表 | GDPR の Privacy Notice と概ね同等 |
| 第三者提供制限 | 本人同意なく第三者に提供不可 (オプトアウト方式は条件付き可) | GDPR よりやや緩い (オプトアウト可の場合あり) |
| 保有個人情報の開示 | 請求から「可能な限り速やかに」対応 | GDPR の 30 日より柔軟だが速やかさが求められる |
| 訂正・追加・削除 | 正確性確保のため応じる義務 | GDPR Art.16 (訂正権) に相当 |
| 利用停止 | 違法な取り扱いの場合に停止義務 | GDPR 消去権より限定的 |
| 漏洩報告 | 個人情報保護委員会への報告 + 本人通知 | 規模・内容に応じて義務 (GDPR 72h より猶予は状況による) |
| 越境移転制限 | 同等保護水準の国・相当措置が必要 | GDPR 十分性認定・SCCに相当 |

**APPI 固有の実装ポイント**:
- 利用目的をアプリ内に明示 (プライバシーポリシーへの参照で可)
- 第三者提供の記録義務 (GDPRの処理記録 Art.30 に相当)
- 25,000件超の漏洩は個人情報保護委員会への報告が義務

### 8.2 CCPA/CPRA (米・参考)

| 権利 | 内容 | GDPR との差分 |
|------|------|------------|
| 削除権 | カリフォルニア州居住者の削除要請への対応 | GDPR 消去権に準拠。免除事由は異なる |
| オプトアウト権 | 個人情報の販売・共有のオプトアウト | GDPR にない独自権利。"Do Not Sell" リンクが必要 |
| データポータビリティ | 機械可読形式での提供 | GDPR Art.20 に相当 |
| 差別禁止 | 権利行使者への不利益取扱禁止 | GDPR に準拠 |
| 処理目的の制限 | CPRA 追加: 機密情報の使用制限 | GDPR 目的限定原則に相当 |

**実装上の注意**: 従業員数・売上・処理件数で適用閾値あり。現時点では「参考」として実装計画に織り込む。

### 8.3 横断要件 (三法域共通)

```
1. データ最小化・目的限定
   - 収集するデータは目的達成に必要な最小限に限る
   - 収集時の目的以外に使用しない
   - 実装: schema の x-retention + x-pii で管理

2. 72時間侵害通知 (GDPR)
   - 監督機関への通知: 侵害認知から 72 時間以内
   - 本人通知: 高リスクの場合に速やかに
   - 実装: インシデント対応 SOP を別途策定 (本書スコープ外)

3. 処理記録 (GDPR Art.30)
   - 処理活動の記録を内部に保持
   - 実装: docs/compliance/records-of-processing.md を別途作成

4. Sub-processor DPA (データ処理契約)
   - 外部サービス (PostHog, Vercel, その他クラウド) との DPA 締結
   - 実装: 各サービスの DPA を確認・署名
```

---

## 9. 実装ロードマップ

### Phase 1: 最優先 (匿名化基盤 / consent 分離 / 内部 vs 消費者フラグ)

**目標**: 消去権の技術的実現と法的根拠の分離

| タスク | 詳細 | 工数感 |
|--------|------|--------|
| P1-1 | `user` モデルに `anonymized_at: DateTime?` フィールド追加 (schema 変更) | 小 |
| P1-2 | anonymize_user() 関数実装: PII スクラブ・account/session cascade 確認 | 中 |
| P1-3 | `audit_log.actor_user_id` の NULL 化処理を anonymize_user に含める | 小 |
| P1-4 | `user` テーブルの `creator_id` / `updater_id` を nullable + SetNull に変更 | 中 (マイグレーション注意) |
| P1-5 | analytics_consent フィールド追加 + サインアップ時の opt-in UI | 中 |
| P1-6 | Privacy Notice 文書作成 (法務確認必須) | 大 (法務依存) |
| P1-7 | DSAR 受付エンドポイント (email フォーム + 台帳記録) | 中 |

**後続 cmd への落とし方**: P1-1〜P1-4 を一つの cmd (schema + migration)、P1-5〜P1-7 を別 cmd に分割。

### Phase 2: mention=参照パターン実装 / generator テンプレ組み込み

**目標**: 自由記述内の PII 混入を構造的に防ぐ

| タスク | 詳細 |
|--------|------|
| P2-1 | `comment.message` のメンションパーサー実装 (`@[user_id:xxx]` 形式) |
| P2-2 | generator テンプレートに mention_parser.ts.jinja2 追加 |
| P2-3 | `x-pii` / `x-retention` / `x-gdpr-mode` スキーマアノテーション実装 (DP-2 裁可後) |
| P2-4 | anonymize_user() を generator テンプレートから自動生成に移行 |
| P2-5 | attachment ファイル名の UUID 化 (オリジナル名はメタデータとして暗号化保存) |

### Phase 3: DSAR フル対応 / analytics 同意ゲート

**目標**: 消費者向け完全対応

| タスク | 詳細 |
|--------|------|
| P3-1 | DSAR 管理 UI (管理者画面): 要請一覧・ステータス管理・期限追跡 |
| P3-2 | データポータビリティ API (JSON/CSV エクスポート) |
| P3-3 | PostHog 同意ゲート実装 (consent あり/なしで track のオン/オフ) |
| P3-4 | 自由記述 PII 検出の半自動化 (フルテキスト検索 + 候補ハイライト) |
| P3-5 | 処理記録 (Records of Processing) の機械生成 |
| P3-6 | 侵害通知 SOP 文書化 |

---

## 10. 要裁可の決定点 (DP)

*家老が dashboard 🚨要対応へ転記できるよう整理*

---

### DP-1: 実装順序 — 社内先行か消費者先行か

**問**: Phase 1 をどちらのユーザー層から優先するか

| 選択肢 | 内容 | 利 | 害 |
|--------|------|---|---|
| **A: 社内先行** (推奨) | internal モードの anonymize 基盤から実装 | 影響範囲が限定的・テスト容易 | 消費者向け DSAR 対応は遅れる |
| **B: 消費者先行** | consumer モードのフル DSAR から実装 | 外部公開時のコンプライアンスを先行確保 | スコープ大・リリースに時間がかかる |
| **C: 同時並行** | 共通基盤 (anonymize_user) を先に実装し両モード対応 | バランスが良い | 依存関係管理が複雑 |

**推奨**: A — まず社内利用で匿名化基盤を実戦検証してから消費者展開が安全。

---

### DP-2: x-pii / x-retention アノテーション仕様の採否

**問**: Section 6.4 で提案したスキーマアノテーションを採用するか

| 選択肢 | 内容 |
|--------|------|
| **A: 採用** (推奨) | `x-pii`, `x-retention`, `x-gdpr-mode` を json_schema.yaml に追加 → generator が自動反映 |
| **B: 不採用** | 手動でコード管理。アノテーションなし |
| **C: 段階採用** | Phase 1 は手動、Phase 2 以降でアノテーション導入 |

**推奨**: A — generator 駆動の North Star と完全整合。

---

### DP-3: mention=参照パターンを Phase 1 に含めるか

**問**: `@[user_id:xxx]` 形式のメンションパーサーをいつ実装するか

| 選択肢 | 内容 |
|--------|------|
| **A: Phase 1 に含める** | 平文 PII 漏れ込みリスクを早期に封じる |
| **B: Phase 2 (推奨)** | Phase 1 は基盤構築に集中。mention は Phase 2 で対応 |
| **C: 見送り** | 運用プロセス (手動 redact) のみで対応 |

**推奨**: B — Phase 1 に含めるとスコープが過大。手動 redact プロセスで暫定対応。

---

### DP-4: analytics consent ゲートの実装タイミング

**問**: PostHog の同意ゲートをいつ実装するか

| 選択肢 | 内容 |
|--------|------|
| **A: Phase 1** | analytics 実装前に同意基盤を先行整備 |
| **B: Phase 3 (推奨)** | PostHog 実装 (cmd_102) と同時に同意ゲートを実装 |
| **C: PostHog 実装後** | Phase 3 完了後に別途追加 |

**推奨**: B — PostHog 未実装の現状では Phase 3 が自然なタイミング。

---

### DP-5: user.creator_id / updater_id の nullable 化 (追加 DP)

**問**: Section 3.5 / Phase 1-4 で提案した user 自己参照 FK の nullable 化をいつ・どのように行うか

| 選択肢 | 内容 | リスク |
|--------|------|--------|
| **A: Phase 1 で nullable + SetNull に変更** | 消去権を Phase 1 で完全実現 | マイグレーション複雑。既存データの creator_id がすべて非 NULL → NOT NULL 制約解除 + デフォルト値設計が必要 |
| **B: Phase 1 は論理削除フラグのみ** (推奨) | `anonymized_at` フラグで anonymize。FK は Phase 2 で変更 | 一時的に FK が "deleted user" を指すが anonymized なので実害なし |
| **C: FK を変更せず anonymize のみ** | FK はそのまま。表示時に `[deleted]` | Phase 1 最速。ただし将来の完全削除が困難 |

**推奨**: B — Phase 1 は `anonymized_at` フラグと PII スクラブのみ。FK 構造変更は Phase 2 のマイグレーション設計とセット。

---

### DP-6: audit_log の Restrict 維持 vs actor_user_id 扱い (改定 2026-06-27)

**問**: `audit_log.actor_user_id` の明示的 Restrict (schema.prisma:301-302) を維持するか

| 選択肢 | 内容 |
|--------|------|
| **A: Restrict 維持 + actor_user_id NULL 化** | 監査ログ行を保持しつつ、消去要請時に `actor_user_id` を NULL に更新 |
| **B: Restrict 維持 + actor_user_id 保持** (**採用**) | `actor_user_id` を削除せず擬似匿名キーとして保持。PII(email/name/metadata) は redact 済で表示上識別不能。同一 actor の監査チェーン追跡・不正調査参照可能性を維持 |
| **C: Cascade** | user 削除と同時に監査ログも削除。⚠️ 監査完全性が失われ法的リスク |

**殿裁定 (cmd_244)**: B — `actor_user_id` NULL 化を廃止。
- PII(name/email/metadata) は redact 済で表示上識別不能
- `actor_user_id`(UUID) は擬似匿名キーとして保持: 削除済 user の不正調査・同一 actor 追跡に必要
- 根拠: GDPR 17条(3)(b)(e) — 法的請求・正当利益による保持例外

**実装**: `anonymizeUser()` の `actor_user_id` NULL 化ステップを削除し、代わりに `audit_log.metadata` の email 等 PII キーを `[redacted]` に置換。

---

### DP-7: legal-hold — 削除済 wrongdoer の再識別手段 (将来 Decision Point)

**背景**: 擬似匿名キー保持 (DP-6 B) だけでは、真の意味で削除済み wrongdoer を後から再識別するには不足する。

**将来課題**:
- 匿名化前 snapshot を封緘ストア (access-controlled vault) へ保存
- 17条(3)(e) 正当化: 公共の利益・法的義務・legal hold
- アクセス制限付き・期間限定の identity 保持機構

**本 Phase での扱い**: 作り込まず。将来 Phase (Phase 3 以降) で設計する Decision Point とする。

---

*以上、全 7 決定点を列挙。DP-1〜4 は当初タスクYAML記載のもの。DP-5・DP-6 は設計分析中に発見。DP-7 は cmd_244 殿指摘による将来 Decision Point。*

---

**文書終了**
