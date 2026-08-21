#!/bin/bash
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
PROJ="/c/Users/good-/OneDrive/Desktop/Claude/Apex Project/commercial"
BASE="file:///C:/Users/good-/OneDrive/Desktop/Claude/Apex%20Project/commercial"
FR="$PROJ/frames"
mkdir -p "$FR"

# scene durations (ms)
durs=(4800 4200 4600 3800 4400 4200 4200 5200)
fracs=(0 0.6)

idx=0
declare -a NAMES
declare -a DELAYS

capture(){
  local n=$1 scene=$2 frac=$3
  local UD="$FR/ud_${n}_$$_$(date +%s%N)"
  "$EDGE" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=1280,720 \
    --user-data-dir="$UD" \
    --screenshot="$FR/frame_$(printf '%02d' $n).png" "$BASE/video.html?scene=$scene&frac=$frac" > "$FR/log_$n.txt" 2>&1
  rm -rf "$UD" 2>/dev/null
}

n=0
for s in "${!durs[@]}"; do
  dur=${durs[$s]}
  delay=$((dur/2))
  for frac in "${fracs[@]}"; do
    capture $n $s $frac
    NAMES[$n]="frame_$(printf '%02d' $n).png"
    DELAYS[$n]=$delay
    n=$((n+1))
    sleep 0.3
  done
done

echo "TOTAL_FRAMES=$n"

# retry any missing frames once
n=0
for s in "${!durs[@]}"; do
  dur=${durs[$s]}
  for frac in "${fracs[@]}"; do
    f="$FR/frame_$(printf '%02d' $n).png"
    if [ ! -s "$f" ]; then
      echo "RETRY frame $n (scene=$s frac=$frac)"
      capture $n $s $frac
      sleep 0.5
      if [ ! -s "$f" ]; then
        echo "RETRY2 frame $n (scene=$s frac=$frac)"
        capture $n $s $frac
      fi
    fi
    n=$((n+1))
  done
done

echo "--- final listing ---"
ls -la "$FR"/frame_*.png

# write delays file for the GIF builder (ms per frame)
printf "%s\n" "${DELAYS[@]}" > "$FR/delays.txt"
echo "delays written: $(wc -l < "$FR/delays.txt")"
