#!/bin/bash
# sheet.sh <dir> <prefix> <tile-width> <cols> <out>   : labelled contact sheet of <dir>/<prefix>*.png
d=$1; p=$2; tw=$3; cols=$4; out=$5
files=$(ls $d/${p}*.png | sort)
montage -label '%t' -font DejaVu-Sans -pointsize 13 -fill white -background '#000' $files -tile ${cols}x -geometry ${tw}x+2+2 $out
