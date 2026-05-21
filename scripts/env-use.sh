#!/usr/bin/env bash
set -euo pipefail

ENV_NAME="${1:-}"
PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# cloud → deprecated, treat as off
if [[ "$ENV_NAME" == "cloud" ]]; then
  echo "Warning: 'cloud' is deprecated. Use 'off' to return to Next.js native .env.local loading." >&2
  ENV_NAME="off"
fi

# 引数チェック
if [[ "$ENV_NAME" != "test" && "$ENV_NAME" != "off" ]]; then
  echo "Usage: npm run env:use -- <test|off>" >&2
  exit 1
fi

# off: .env symlink/file を削除して native に戻す
if [[ "$ENV_NAME" == "off" ]]; then
  if [[ -L "$PROJ_ROOT/.env" ]]; then
    rm "$PROJ_ROOT/.env"
  elif [[ -f "$PROJ_ROOT/.env" && -f "$PROJ_ROOT/.env.current" ]]; then
    # copy fallback で作成された通常ファイルも .env.current が存在する場合は削除
    rm "$PROJ_ROOT/.env"
  fi
  rm -f "$PROJ_ROOT/.env.current"
  echo "env reset to native (.env.local)"
  exit 0
fi

# 対象envファイルの存在チェック (test only)
SRC=".env.test"
if [[ ! -f "$PROJ_ROOT/$SRC" ]]; then
  echo "Error: $SRC not found." >&2
  exit 1
fi

# 既存 .env が通常ファイルかつ .env.current が無い場合は安全停止
if [[ -f "$PROJ_ROOT/.env" && ! -L "$PROJ_ROOT/.env" && ! -f "$PROJ_ROOT/.env.current" ]]; then
  echo "Error: .env exists as a regular file and .env.current is absent." >&2
  echo "       Back up .env manually, then re-run with --force to overwrite." >&2
  if [[ "${2:-}" != "--force" ]]; then
    exit 1
  fi
fi

# symlinkを試み、失敗したらcopyにフォールバック
if ln -sfn "$SRC" "$PROJ_ROOT/.env" 2>/dev/null; then
  MODE="symlink"
else
  cp "$PROJ_ROOT/$SRC" "$PROJ_ROOT/.env"
  MODE="copy"
fi

# .env.current にenv名とmodeを保存
echo "env=$ENV_NAME" > "$PROJ_ROOT/.env.current"
echo "mode=$MODE" >> "$PROJ_ROOT/.env.current"
echo "src=$SRC" >> "$PROJ_ROOT/.env.current"

echo "✓ env switched to '$ENV_NAME' (mode: $MODE, src: $SRC)"
