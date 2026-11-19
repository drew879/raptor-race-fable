#!/bin/zsh
# win.sh name windowid -> shots/name.png of that window, even if it is covered
D=${0:A:h}/shots
screencapture -x -o -l "$2" "$D/$1.png" && sips -g pixelWidth -g pixelHeight "$D/$1.png" | tail -2 | tr '\n' ' '; echo "$D/$1.png"
