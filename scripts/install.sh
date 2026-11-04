#!/bin/sh
# 把 dsh-niuma-timer 装进某个 DSH profile（默认 desktop）。
# 用法: sh scripts/install.sh [profile]   # profile 省略时为 desktop
# 幂等：重复执行不会重复加 bundles 行。
set -e

PKG_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
PROFILE=${1:-desktop}
PKG_NAME=dsh-niuma-timer
DSH_HOME=${DSH_HOME:-"$HOME/.dsh"}
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
CLI="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"

if [ ! -d "$PROFILE_DIR" ]; then
  echo "找不到 profile 目录: $PROFILE_DIR" >&2
  exit 1
fi
if [ ! -x "$CLI" ]; then
  CLI=$(command -v dsh || true)
fi
if [ -z "$CLI" ]; then
  echo "找不到 dsh CLI，请改用 DSH 内的插件管理面板安装本目录。" >&2
  exit 1
fi

STAMP=$(date +%Y%m%d-%H%M%S)
cp "$PROFILE_DIR/package.json" "$PROFILE_DIR/package.json.bak-$STAMP"
echo "已备份: $PROFILE_DIR/package.json.bak-$STAMP"

echo "==> pnpm add $PKG_DIR"
"$CLI" plugin --profile "$PROFILE" add "$PKG_DIR"

echo "==> 确保 $PKG_NAME 在 dsh.profile.bundles 中"
node -e '
const fs = require("fs");
const file = process.argv[1];
const name = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
if (!bundles.includes(name)) bundles.push(name);
pkg.dsh.profile.bundles = bundles;
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
console.log("bundles: " + bundles.join(", "));
' "$PROFILE_DIR/package.json" "$PKG_NAME"

echo
echo "装好了。重启 DeepSeek Harness 后，任意会话的输入框下方会出现那枚「牛马费」小胶囊。"
echo "卸载: $CLI plugin --profile $PROFILE remove $PKG_NAME  （再从 bundles 里删掉该行）"
