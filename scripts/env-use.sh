#!/usr/bin/env bash
set -euo pipefail

ENV_NAME="${1:-}"
PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 引数チェック
if [[ "$ENV_NAME" != "test" && "$ENV_NAME" != "cloud" && "$ENV_NAME" != "off" ]]; then
  echo "Usage: npm run env:use -- <test|cloud|off>" >&2
  exit 1
fi

# off: 両リンクを削除してネイティブに戻す
if [[ "$ENV_NAME" == "off" ]]; then
  rm -f "$PROJ_ROOT/.env.current"
  # .env を削除（symlink or ファイル）
  if [[ -L "$PROJ_ROOT/.env" || -f "$PROJ_ROOT/.env" ]]; then
    rm -f "$PROJ_ROOT/.env"
  fi
  # .env.local を削除（symlinkの場合のみ）
  if [[ -L "$PROJ_ROOT/.env.local" ]]; then
    rm -f "$PROJ_ROOT/.env.local"
  fi
  echo "env reset to off (native)"
  exit 0
fi

# ソースファイルの決定
if [[ "$ENV_NAME" == "test" ]]; then
  SRC=".env.test"
else
  SRC=".env.cloud.local"
fi

# ソースファイルの存在チェック
if [[ ! -f "$PROJ_ROOT/$SRC" ]]; then
  echo "Error: $SRC not found at $PROJ_ROOT/$SRC" >&2
  if [[ "$ENV_NAME" == "cloud" ]]; then
    echo "Hint: Create .env.cloud.local with your cloud credentials first." >&2
  fi
  exit 1
fi

# .env.local の安全確認:
# もし .env.local が symlink でなく通常ファイルなら、.env.cloud.local と内容が一致するか確認
# 一致しない場合は上書きを拒否（手動で .env.cloud.local を作ってから env:use -- cloud すべき）
if [[ -f "$PROJ_ROOT/.env.local" && ! -L "$PROJ_ROOT/.env.local" ]]; then
  if [[ "$SRC" == ".env.cloud.local" ]]; then
    # cloud profile の場合: .env.cloud.local がすでに作られているはずなので OK
    echo "Note: .env.local is a regular file; replacing with symlink to $SRC" >&2
  else
    # test profile の場合: .env.local を symlink に変える
    echo "Note: .env.local is a regular file; replacing with symlink to $SRC" >&2
  fi
fi

# .env を SRC へシンボリックリンク
ln -sfn "$SRC" "$PROJ_ROOT/.env"
# .env.local を SRC へシンボリックリンク (Next.js runtime 用)
ln -sfn "$SRC" "$PROJ_ROOT/.env.local"

# .env.current に記録
{
  echo "env=$ENV_NAME"
  echo "mode=symlink"
  echo "src=$SRC"
} > "$PROJ_ROOT/.env.current"

echo "✓ env switched to '$ENV_NAME' (src: $SRC)"
echo "  .env      → $SRC"
echo "  .env.local → $SRC"
