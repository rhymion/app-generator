#!/usr/bin/env bash
set -euo pipefail

PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ID="$PROJ_ROOT/.next/BUILD_ID"

# .next/BUILD_ID が存在しなければ stale
if [ ! -f "$BUILD_ID" ]; then
  echo "ERROR: .next/BUILD_ID not found. Build is missing." >&2
  echo "  Run: npm run build:all" >&2
  exit 1
fi

# 偽陽性（新鮮なのに stale と判定されるケース）:
#   - app/generated/ 内の自動生成ファイルが更新された場合（除外済み）
#   - ファイルのタッチだけで中身が変わらない場合
# 偽陰性（stale なのに新鮮と判定されるケース）:
#   - .env.* の変更のみ（環境変数はビルドに影響しない想定のため除外）
#   - next.config.* 以外の設定ファイル変更
# この freshness チェックはベストエフォート。確実な再ビルドは `npm run build:all` を使うこと。

STALE_FILE=""

for TARGET in \
  "$PROJ_ROOT/app" \
  "$PROJ_ROOT/lib" \
  "$PROJ_ROOT/prisma/schema.prisma" \
  "$PROJ_ROOT/auth.ts" \
  "$PROJ_ROOT/package.json"; do
  if [ -e "$TARGET" ]; then
    FOUND=$(find "$TARGET" -newer "$BUILD_ID" \
      -not -path "*/app/generated/*" \
      -not -path "*/node_modules/*" \
      2>/dev/null | head -1 || true)
    if [ -n "$FOUND" ]; then
      STALE_FILE="$FOUND"
      break
    fi
  fi
done

# next.config.* を個別にチェック
if [ -z "$STALE_FILE" ]; then
  for F in "$PROJ_ROOT"/next.config.*; do
    if [ -f "$F" ] && [ "$F" -nt "$BUILD_ID" ]; then
      STALE_FILE="$F"
      break
    fi
  done
fi

if [ -n "$STALE_FILE" ]; then
  echo "ERROR: Build is stale. Source file newer than .next/BUILD_ID: $STALE_FILE" >&2
  echo "  Run: npm run build:all" >&2
  exit 1
fi

echo "Build freshness check: OK (.next/BUILD_ID is up to date)"
