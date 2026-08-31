#!/usr/bin/env bash
# Assembles the recorded segments into one cut.
# Playwright writes a randomly-named .webm per context, so we glob each dir.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=film
[ -d "$OUT" ] || { echo "No $OUT/ — run: npm run film"; exit 1; }

echo "Normalising segments"
i=0
: > "$OUT/list.txt"
for dir in "$OUT"/[0-9]*; do
  [ -d "$dir" ] || continue
  src=$(find "$dir" -name '*.webm' | head -1)
  [ -n "$src" ] || { echo "  ! no video in $dir"; continue; }
  dst="$OUT/norm-$(printf %02d $i).mp4"
  # One codec, one frame rate, one pixel format, so concat is lossless-safe.
  ffmpeg -y -loglevel error -i "$src" \
    -vf "fps=30,scale=1440:900:flags=lanczos,format=yuv420p" \
    -c:v libx264 -preset slow -crf 18 -an "$dst"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$dst")
  printf "  %-22s %6.1fs\n" "$(basename "$dir")" "$dur"
  echo "file '$(basename "$dst")'" >> "$OUT/list.txt"
  i=$((i+1))
done

# Record what was actually filmed, so the voice can lock to it.
python3 - "$OUT" <<'PYEOF'
import json, os, subprocess, sys
out = sys.argv[1]
segs = sorted(d for d in os.listdir(out) if d[0].isdigit() and os.path.isdir(os.path.join(out, d)))
norm = sorted(f for f in os.listdir(out) if f.startswith("norm-"))
m = {}
for seg, n in zip(segs, norm):
    d = subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",
                        os.path.join(out, n)], capture_output=True, text=True).stdout.strip()
    m[seg] = round(float(d), 3)
json.dump(m, open(os.path.join(out, "segments.json"), "w"), indent=2)
print("  manifest: " + ", ".join(f"{k} {v:.1f}s" for k, v in m.items()))
PYEOF

echo "Concatenating"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$OUT/list.txt" -c copy "$OUT/cleave-silent.mp4"
d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/cleave-silent.mp4")
printf "\n  %s  (%.1fs)\n" "$OUT/cleave-silent.mp4" "$d"
echo "  Next: record narration, then  npm run film:voice <audio-file>"
