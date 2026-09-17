#!/usr/bin/env bash
# 更新矢量地图数据(MapLibre):中国区 PMTiles + 字体 glyphs + sprites。
# 数据源:Protomaps 每日构建(OpenStreetMap / Natural Earth,ODbL)。
# 用法:scripts/update-map-data.sh [YYYYMMDD]   # 默认取 3 天前的构建(当日构建可能尚未生成)
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_DATE="${1:-$(date -d '3 days ago' +%Y%m%d)}"
BBOX="73.0,17.5,135.5,54.0"           # 中国及周边(西到帕米尔,含南海诸岛北界)
PMTILES_VERSION="1.30.1"
MAP_DIR="data/map"
FONTS_BASE="https://protomaps.github.io/basemaps-assets/fonts"
SPRITES_BASE="https://protomaps.github.io/basemaps-assets/sprites/v4"

mkdir -p "$MAP_DIR" /tmp/pmtiles-bin

# 1. pmtiles CLI(不存在才下载)
if [ ! -x /tmp/pmtiles-bin/pmtiles ]; then
  echo "==> 下载 pmtiles CLI v${PMTILES_VERSION}"
  curl -sL "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz" \
    | tar xz -C /tmp/pmtiles-bin pmtiles
fi

# 2. 中国区 PMTiles(约 13GB,提取走 Range 请求只下所需部分)
echo "==> 提取中国区 PMTiles(构建 ${BUILD_DATE},bbox ${BBOX})"
/tmp/pmtiles-bin/pmtiles extract "https://build.protomaps.com/${BUILD_DATE}.pmtiles" \
  "$MAP_DIR/china.pmtiles.new" --bbox="$BBOX"
mv "$MAP_DIR/china.pmtiles.new" "$MAP_DIR/china.pmtiles"
/tmp/pmtiles-bin/pmtiles verify "$MAP_DIR/china.pmtiles"

# 3. 字体 glyphs(3 个栈 × 256 分块,含 CJK;已存在则跳过)
for STACK in "Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"; do
  dir="$MAP_DIR/fonts/$STACK"
  mkdir -p "$dir"
  for lo in $(seq 0 256 65280); do
    hi=$((lo + 255)); f="$dir/$lo-$hi.pbf"
    [ -s "$f" ] && continue
    code=$(curl -s -o "$f" -w '%{http_code}' --connect-timeout 8 "$FONTS_BASE/${STACK// /%20}/$lo-$hi.pbf")
    [ "$code" = "200" ] || rm -f "$f"   # 某段无字形属正常,404 由前端容错
  done
  echo "==> 字体 $STACK: $(ls "$dir" | wc -l) 个分块"
done

# 4. sprites(POI 图标)
mkdir -p "$MAP_DIR/sprites"
for flav in light dark; do
  for v in "" "@2x"; do
    curl -s --connect-timeout 8 -o "$MAP_DIR/sprites/$flav$v.json" "$SPRITES_BASE/$flav$v.json"
    curl -s --connect-timeout 8 -o "$MAP_DIR/sprites/$flav$v.png"  "$SPRITES_BASE/$flav$v.png"
  done
done

echo "==> 完成。磁盘占用: $(du -sh "$MAP_DIR" | cut -f1)"
