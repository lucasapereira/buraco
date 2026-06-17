#!/usr/bin/env bash
# A/B paralelo da feature S (stagnant-last): 6×50 por assento, em paralelo.
# Uso: bash scripts/ab_stagnant.sh
set -u
cd "$(dirname "$0")/.."
OUT=$(mktemp -d)
BATCHES=${BATCHES:-6}
N=${N:-50}

run_seat() {
  local seat=$1            # 1 ou 2
  for i in $(seq 1 $BATCHES); do
    echo "$seat $i"
  done | xargs -P "$BATCHES" -n2 bash -c '
    seat=$0; i=$1
    FEAT=S FEATTEAM=$seat N='"$N"' npx tsx scripts/botSim.ts 2>/dev/null \
      | grep -E "^vitórias" > "'"$OUT"'/seat${seat}_${i}.txt"
  '
}

echo "== rodando seat 1 (S no team-1) =="
run_seat 1
echo "== rodando seat 2 (S no team-2) =="
run_seat 2

# Agrega. Em seat 1 a feature é T1; em seat 2 a feature é T2.
python3 - "$OUT" <<'PY'
import sys, re, glob, os
out = sys.argv[1]
def grab(path, tag):
    for line in open(path, encoding="utf-8"):
        if re.search(rf"T{tag}\b", line):
            m = re.search(r"(\d+)\s*/\s*(\d+)", line)
            if m: return int(m.group(1)), int(m.group(2))
    return 0, 0

def seat(seat_no, feat_tag):
    fw = fg = bw = 0
    for f in sorted(glob.glob(os.path.join(out, f"seat{seat_no}_*.txt"))):
        other_tag = 2 if feat_tag == 1 else 1
        w, g = grab(f, feat_tag)
        bwn, _ = grab(f, other_tag)
        fw += w; fg += g; bw += bwn
    return fw, bw, fg

f1, b1, g1 = seat(1, 1)
f2, b2, g2 = seat(2, 2)
print(f"\n── ASSENTO 1 (S no team-1) ──  feature {f1}/{g1}  vs  baseline {b1}/{g1}   ({100*f1/g1:.1f}% vs {100*b1/g1:.1f}%)")
print(f"── ASSENTO 2 (S no team-2) ──  feature {f2}/{g2}  vs  baseline {b2}/{g2}   ({100*f2/g2:.1f}% vs {100*b2/g2:.1f}%)")
tot_f = f1 + f2; tot_b = b1 + b2; tot_g = g1 + g2
print(f"\n── AGREGADO (simétrico, n={tot_g}) ──")
print(f"   feature  : {tot_f}/{tot_g}  ({100*tot_f/tot_g:.1f}%)")
print(f"   baseline : {tot_b}/{tot_g}  ({100*tot_b/tot_g:.1f}%)")
delta = 100*tot_f/tot_g - 100*tot_b/tot_g
print(f"   delta    : {delta:+.1f}pp  (>0 = feature melhora; simétrico nos 2 assentos = real)")
PY
rm -rf "$OUT"
