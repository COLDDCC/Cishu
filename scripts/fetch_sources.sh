#!/usr/bin/env bash
# 下载体积较大、不放进仓库的源数据：JMdict 常用词子集（npm 包 kotobako-data，CC BY-SA 4.0）
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
(cd "$tmp" && npm pack kotobako-data@26.7.19 --silent >/dev/null && tar xzf kotobako-data-*.tgz)
cp "$tmp/package/kotobako-static.json" data-src/kotobako-static.json
rm -rf "$tmp"
echo "ok: data-src/kotobako-static.json"
