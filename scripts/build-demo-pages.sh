#!/usr/bin/env bash
# ===== 构建 GitHub Pages 演示页 =====
# 从 app/static/ 源文件生成 docs/demo/ 静态包(相对路径,可部署到任意子路径)。
# docs/ 是 GitHub Pages 的发布目录(Settings → Pages → main /docs,或
# gh api repos/{owner}/{repo}/pages -X POST -f source[branch]=main -f source[path]=/docs)。
# 用法:./scripts/build-demo-pages.sh   # 改了 demo.html/demo.js/pageturn.js/style.css 后重跑
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=app/static
OUT=docs/demo
rm -rf "$OUT"
mkdir -p "$OUT/fonts"

cp "$SRC"/{style.css,theme.js,echarts.min.js,pageturn.js,demo.js,model-y-l.png,model-yl-badge.png} "$OUT/"
cp "$SRC"/fonts/Universal-Sans-Display-Medium.woff2 "$OUT/fonts/"

# 绝对路径 → 相对路径;Pages 上没有"正式面板","返回"链接改为指向 GitHub 仓库
sed -e 's|href="/style.css"|href="style.css"|' \
    -e 's|src="/theme.js"|src="theme.js"|' \
    -e 's|src="/echarts.min.js"|src="echarts.min.js"|' \
    -e 's|src="/pageturn.js"|src="pageturn.js"|' \
    -e 's|src="/demo.js"|src="demo.js"|' \
    -e 's|src="/model-y-l.png"|src="model-y-l.png"|' \
    -e 's|<a href="/">返回正式面板</a>|<a href="https://github.com/Savior2016/teslamate-visualizer">GitHub 仓库</a>|' \
    "$SRC/demo.html" > "$OUT/index.html"

# style.css 内的绝对资源引用 → 相对
sed -i -e "s|url('/fonts/|url('fonts/|g" \
       -e "s|url('/model-yl-badge.png')|url('model-yl-badge.png')|g" \
       "$OUT/style.css"

# Pages 根路径直接跳到演示页;关闭 Jekyll(静态直出)
cat > docs/index.html <<'EOF'
<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=demo/"><a href="demo/">TESLA Home 演示页</a>
EOF
touch docs/.nojekyll

echo "built: $OUT/"
ls -la "$OUT"
