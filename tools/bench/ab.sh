#!/bin/sh
# tools/bench/ab.sh <outdir> <rounds-of-alternation> <labelA=binA> <labelB=binB> ...
# Alternates the binaries (the machine is noisy; min over repeats is the stable number) and writes <outdir>/<label>-<i>/summary.json.
# Then: node tools/bench/table.mjs <outdir> <labelA> <labelB> ...
out=$1; n=$2; shift 2
i=1
while [ $i -le $n ]; do
  for spec in "$@"; do
    label=${spec%%=*}; bin=${spec#*=}
    node "$(dirname "$0")/replay.mjs" --bin "$bin" --port "${BENCH_PORT:-33000}" --dbdir "${BENCH_DBDIR:-/tmp}" --rounds "${BENCH_ROUNDS:-10}" --seconds "${BENCH_SECONDS:-3}" --out "$out/$label-$i" ${BENCH_EXTRA} >/dev/null 2>&1
  done
  i=$((i+1))
done
