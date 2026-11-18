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
ls -la public/art
