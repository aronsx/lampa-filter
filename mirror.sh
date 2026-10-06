#!/bin/sh
# Зеркало статики lampa.mx для локального запуска фронта.
set -u
BASE="http://lampa.mx"
DIR="mirror"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

FILES="
index.html
app.min.js
css/app.css
webos/webOSTV.js
vender/jquery/jquery.js
vender/notify/notify.js
vender/scrollbar/jquery.scrollbar.js
vender/scrollbar/jquery.scrollbar.css
vender/navigator/navigator.js
vender/keypad/keypad.js
vender/keypad/style.css
vender/qrcode/qrcode.js
vender/hls/hls.js
vender/dash/dash.js
plugins/modification.js
plugins_black_list.json
img/welcome.jpg
img/logo-icon.svg
img/loader.svg
img/img_load.svg
img/icons/menu/bookmark.svg
img/icons/menu/time.svg
img/icons/settings/more.svg
img/icons/settings/parser.svg
img/icons/settings/player.svg
img/icons/settings/server.svg
icons/favicon.ico
icons/favicon-16x16.png
icons/favicon-32x32.png
icons/apple-touch-icon.png
icons/safari-pinned-tab.svg
icons/site.webmanifest
fonts/SegoeUI/SegoeUI.woff
fonts/SegoeUI/SegoeUI-Bold.woff
fonts/SegoeUI/SegoeUI-Light.woff
fonts/SegoeUI/SegoeUI-SemiBold.woff
"

ok=0
fail=0
for f in $FILES; do
  mkdir -p "$DIR/$(dirname "$f")"
  code=$(curl -sS --compressed --max-time 30 -A "$UA" -o "$DIR/$f" -w '%{http_code}' "$BASE/$f" 2>/dev/null)
  case "$code" in
    200|304) ok=$((ok+1)) ;;
    *) fail=$((fail+1)); rm -f "$DIR/$f"; echo "fail($code): $f" ;;
  esac
done

cp lampa-mock-plugin.js "$DIR/lampa-mock-plugin.js"
if ! grep -q 'lampa-mock-plugin.js' "$DIR/index.html"; then
  sed -i '' 's#</body>#    <script src="lampa-mock-plugin.js"></script>\n</body>#' "$DIR/index.html"
fi

echo "mirror: ok=$ok fail=$fail -> $DIR"
