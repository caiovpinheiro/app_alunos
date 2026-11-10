#!/bin/zsh
# Gera as artes (PNG 1080x1350) e o guia (PDF A4) do enxoval do calouro em public/enxoval/.
# Uso: tools/enxoval/render.sh   (precisa do Google Chrome e de internet para as fontes)
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SAIDA="../../public/enxoval"
mkdir -p "$SAIDA"
for f in arte-*.html; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor=1 --window-size=1080,1350 --virtual-time-budget=4000 \
    --screenshot="$SAIDA/${f%.html}.png" "file://$PWD/$f" 2>/dev/null
done
if [ -f guia.html ]; then
  "$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --virtual-time-budget=4000 \
    --no-pdf-header-footer --print-to-pdf="$SAIDA/guia-do-calouro.pdf" "file://$PWD/guia.html" 2>/dev/null
fi
ls -la "$SAIDA"
