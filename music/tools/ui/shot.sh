#!/bin/zsh
# shot.sh name x y w h  -> shots/name.png at one pixel per screen point
D=${0:A:h}/shots
mkdir -p $D
screencapture -x -R "$2,$3,$4,$5" "$D/$1-raw.png"
W=$(sips -g pixelWidth "$D/$1-raw.png" | awk '/pixelWidth/{print $2}')
if [ "$W" -gt "$4" ]; then sips --resampleWidth "$4" "$D/$1-raw.png" --out "$D/$1.png" >/dev/null; else cp "$D/$1-raw.png" "$D/$1.png"; fi
rm -f "$D/$1-raw.png"
sips -g pixelWidth -g pixelHeight "$D/$1.png" | tail -2 | tr '\n' ' '; echo "$D/$1.png"
