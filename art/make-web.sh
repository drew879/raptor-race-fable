#!/bin/sh
# The art the game ships with, made small enough for a phone to fetch quickly.
# The originals stay in art/; run this again after any of them changes.  Needs cwebp.
set -e
cd "$(dirname "$0")/.."
mkdir -p public/art
cwebp -quiet -q 84 art/home/home-background.png -o public/art/home-background.webp
cwebp -quiet -q 88 -alpha_q 92 -resize 1300 0 art/home/home-title.png -o public/art/home-title.webp
for name in feathered-tail baby-bird spider-web; do
  cwebp -quiet -q 86 -alpha_q 92 -resize 640 0 "art/finds/$name.png" -o "public/art/find-$name.webp"
done
# the results screen's pieces (the blank page is used only if it is there, and is not the home painting saved under its name)
cwebp -quiet -q 86 -alpha_q 92 -resize 520 0 art/results/chick.png -o public/art/results-chick.webp
cwebp -quiet -q 86 -alpha_q 92 -resize 300 0 art/results/amber.png -o public/art/results-amber.webp
cwebp -quiet -q 86 -alpha_q 92 -resize 360 0 art/results/log.png -o public/art/results-log.webp
cwebp -quiet -q 86 -alpha_q 92 -resize 900 0 art/results/next-gobi.png -o public/art/results-next-gobi.webp
cwebp -quiet -q 84 -resize 360 0 art/journal/jehol-forest-page.png -o public/art/journal-jehol-thumb.webp
if [ -f art/results/page.png ] && ! cmp -s art/results/page.png art/home/home-background.png; then
  cwebp -quiet -q 84 art/results/page.png -o public/art/results-page.webp
fi
ls -la public/art
