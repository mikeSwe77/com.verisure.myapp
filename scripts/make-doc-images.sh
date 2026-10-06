#!/usr/bin/env bash
# Regenerates docs/images/banner.png and docs/images/devices.png from the driver icons.
# Needs macOS (qlmanage renders the stroke-only SVGs correctly; ImageMagick alone drops
# them) and ImageMagick 7 (`magick`). Run from the app root:  bash scripts/make-doc-images.sh
set -euo pipefail

OUT=docs/images
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FONT=/System/Library/Fonts/Helvetica.ttc
FONT_BOLD=/System/Library/Fonts/HelveticaNeue.ttc
RED='#E2001A'
mkdir -p "$OUT"

# name|svg|label
ICONS=(
  "alarm|drivers/alarm/assets/icon.svg|Alarm"
  "door|drivers/door_window/assets/icon.svg|Door/window"
  "smoke|drivers/smoke_detector/assets/icon.svg|Smoke detector"
  "motion|drivers/motion_detector/assets/icon.svg|Motion detector"
  "water|drivers/water_detector/assets/icon.svg|Water detector"
  "climate|drivers/climate/assets/icon.svg|Climate sensor"
  "voicebox|drivers/climate/assets/icons/voicebox.svg|VoiceBox"
  "plug|drivers/smart_plug/assets/icon.svg|Smart plug"
  "lock|drivers/smart_lock/assets/icon.svg|Smart lock"
  "camera|drivers/camera/assets/icon.svg|Camera"
)

tiles=()
for entry in "${ICONS[@]}"; do
  IFS='|' read -r name svg label <<<"$entry"
  cp "$svg" "$TMP/$name.svg"
  qlmanage -t -s 300 -o "$TMP" "$TMP/$name.svg" >/dev/null 2>&1
  magick "$TMP/$name.svg.png" -background white -flatten -colorspace gray "$TMP/$name.png"

  # Gallery tile: red line icon + label
  magick "$TMP/$name.png" +level-colors "$RED",white -resize 140x140 -gravity center -background white -extent 220x170 \
    \( -size 220x44 xc:white -fill '#1d1d1f' -font "$FONT" -pointsize 21 -gravity center -annotate +0+0 "$label" \) \
    -append "$TMP/tile_$name.png"
  tiles+=("$TMP/tile_$name.png")

  # Banner icon: white strokes on transparent (negated icon used as alpha mask)
  magick -size 92x92 xc:white \( "$TMP/$name.png" -negate -resize 92x92 \) -alpha off -compose copy-opacity -composite "$TMP/white_$name.png"
done

magick montage -font "$FONT" "${tiles[@]}" -tile 5x -geometry +18+12 -background white "$TMP/gallery.png"
magick "$TMP/gallery.png" -bordercolor white -border 16 "$OUT/devices.png"

# Banner 1280x400: gradient, title, 3x3 icon grid on the right
magick -size 400x1280 gradient:'#F3263C'-'#A80018' -rotate 90 "$TMP/banner.png"
i=0
for name in alarm door smoke motion water climate plug lock camera; do
  col=$((i % 3)); row=$((i / 3))
  magick "$TMP/banner.png" "$TMP/white_$name.png" -geometry +$((790 + col * 150))+$((52 + row * 110)) -composite "$TMP/banner.png"
  i=$((i + 1))
done
magick "$TMP/banner.png" \
  -font "$FONT_BOLD" -fill white -pointsize 80 -annotate +70+180 'Verisure' -annotate +70+265 'for Homey' \
  -font "$FONT" -pointsize 27 -fill '#FFE3E6' -annotate +74+330 'Alarm, sensors and detectors in your Homey Flows' \
  "$OUT/banner.png"

echo "Wrote $OUT/banner.png and $OUT/devices.png"
