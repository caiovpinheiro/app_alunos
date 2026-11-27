#!/bin/zsh
# Gera a versão leve (720p) dos capítulos da Aula Inaugural: public/trilha-midia/aula/<nome>-720.mp4.
# A Aula serve a leve primeiro e usa o original como reserva (public/js/trilha.js, fontesVideo).
# Rode de novo sempre que um capítulo for refeito. Uso: tools/video-720.sh   (precisa do ffmpeg)
set -e
cd "$(dirname "$0")/../public/trilha-midia/aula"
for f in *.mp4; do
  case "$f" in *-720.mp4) continue;; esac
  ffmpeg -v error -y -i "$f" -vf "scale=-2:720:flags=lanczos" -c:v libx264 -profile:v main -preset slow -crf 26 \
    -pix_fmt yuv420p -c:a aac -b:a 96k -ar 44100 -movflags +faststart "${f%.mp4}-720.mp4"
  echo "${f%.mp4}-720.mp4"
done
