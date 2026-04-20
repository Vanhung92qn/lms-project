#!/bin/sh
# C++ runner entry script. STDIN carries a JSON envelope:
#   { "source": "<code>", "input": "<stdin for the program>" }
# STDOUT is a single-line JSON result:
#   { "verdict": "ok|ce|re|tle", "stdout": "...", "stderr": "...",
#     "runtime_ms": 12, "exit_code": 0 }
# Exit code is always 0 — the verdict is expressed in the JSON body so the
# orchestrator can always parse (even on compile error or crash).

set -u
umask 077

# ---------------------------------------------------------------------------
# 1. Read envelope from stdin (bounded by --tmpfs /tmp size).
# ---------------------------------------------------------------------------
envelope_file="/tmp/envelope.json"
if ! cat > "$envelope_file"; then
  printf '{"verdict":"ie","stderr":"failed to read envelope"}'
  exit 0
fi

source_code=$(jq -r '.source // ""' "$envelope_file" 2>/dev/null || printf '')
program_input=$(jq -r '.input // ""' "$envelope_file" 2>/dev/null || printf '')

if [ -z "$source_code" ]; then
  printf '{"verdict":"ie","stderr":"empty source"}'
  exit 0
fi

printf '%s' "$source_code" > /tmp/main.cpp

# ---------------------------------------------------------------------------
# 2. Compile. CPU-time cap is enforced by the orchestrator's wall-time
# timeout AND by `ulimit -t 5` below (compiler can be expensive).
# ---------------------------------------------------------------------------
ulimit -t 5 2>/dev/null || true
ulimit -f 2048 2>/dev/null || true  # max file size 2MB

compile_err_file="/tmp/compile.err"
if ! g++ -std=c++17 -O0 -o /tmp/main /tmp/main.cpp 2>"$compile_err_file"; then
  jq -cn --rawfile err "$compile_err_file" '{verdict:"ce", stderr:$err}'
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. Execute with the test input piped in. CPU cap 2s. Output capped at 64 KB.
# ---------------------------------------------------------------------------
stdout_file="/tmp/stdout.txt"
stderr_file="/tmp/stderr.txt"
start_ns=$(date +%s%N 2>/dev/null || printf 0)

# ulimit applies to the whole subshell; keeping it tight for execution only.
(
  ulimit -t 2 2>/dev/null || true
  ulimit -v 131072 2>/dev/null || true  # 128 MB address space
  printf '%s' "$program_input" | /tmp/main > "$stdout_file" 2>"$stderr_file"
)
exit_code=$?

end_ns=$(date +%s%N 2>/dev/null || printf 0)
runtime_ms=$(( (end_ns - start_ns) / 1000000 ))

# Truncate output to 64 KB to stay under orchestrator limits.
head -c 65536 "$stdout_file" > /tmp/stdout.cap && mv /tmp/stdout.cap "$stdout_file"
head -c  4096 "$stderr_file" > /tmp/stderr.cap && mv /tmp/stderr.cap "$stderr_file"

# exit 152 / 137 = killed by SIGXCPU / OOM; treat as tle/mle respectively.
case "$exit_code" in
  0)   verdict="ok" ;;
  137) verdict="mle" ;;
  152) verdict="tle" ;;
  *)   verdict="re" ;;
esac

jq -cn \
  --arg v "$verdict" \
  --rawfile so "$stdout_file" \
  --rawfile se "$stderr_file" \
  --argjson rt "$runtime_ms" \
  --argjson rc "$exit_code" \
  '{verdict:$v, stdout:$so, stderr:$se, runtime_ms:$rt, exit_code:$rc}'
