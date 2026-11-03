#!/usr/bin/env bash
# Gate template for a monorepo with apps/web and packages/{core,ui,skills,views}.
# The orchestrator runs checks directly and serializes expensive processes.
# Adapt the commands to the target repository before use.
set -u
if [ "${1:-}" = --help ] || [ $# -lt 1 ]; then
  echo 'usage: gate.sh <lane-path> [typecheck|lint|format|drizzle|all]'
  [ "${1:-}" = --help ] && exit 0
  exit 2
fi
lane="${1:?lane path}"; step="${2:-all}"
name="$(basename "$lane")"; logs="${GATE_LOG_DIR:-$HOME/work/agent-lanes/logs}"; mkdir -p "$logs"
cd "$lane" || exit 2
exec 9>"$lane/.gate.lock"
if ! flock -n 9; then
  echo "gate: another gate is already running in $lane (holder: $(cat "$lane/.gate.pid" 2>/dev/null)); refusing" >&2
  exit 3
fi
echo $$ >"$lane/.gate.pid"
for b in node_modules/.bin/oxlint node_modules/.bin/oxfmt apps/web/node_modules/.bin/tsc apps/web/node_modules/.bin/drizzle-kit; do
  [ -x "$b" ] || { echo "gate: missing $b — seed the lane first (worktree-seed.sh), never pnpm install here" >&2; exit 4; }
done
if { [ "$step" = all ] || [ "$step" = typecheck ]; } && [ "${GATE_TSC:-}" != "1" ]; then
  echo "gate: typecheck requires GATE_TSC=1; the orchestrator owns this check." >&2
  echo "gate: do NOT retry. Run 'gate.sh <lane> lint' and 'gate.sh <lane> format' only, commit, and write in your report: 'typecheck deferred to orchestrator'." >&2
  exit 7
fi
n_tsc=$(pgrep -xc tsc); if [ "$n_tsc" -ge 1 ]; then
  echo "gate: $n_tsc tsc process already running on this machine (limit 1); refusing:" >&2
  for p in $(pgrep -x tsc); do echo "  $p $(ps -o rss= -p $p | awk '{printf "%dMB",$1/1024}') cwd=$(readlink /proc/$p/cwd 2>/dev/null)" >&2; done
  exit 5
fi
avail_mb=$(free -m | awk 'NR==2{print $7}')
if [ "$avail_mb" -lt "${GATE_MIN_AVAILABLE_MB:-5000}" ]; then
  echo "gate: only ${avail_mb} MB available (< ${GATE_MIN_AVAILABLE_MB:-5000}); refusing to start a tsc build" >&2
  exit 6
fi
capped() { # capped <cmd...>: run under a 6 GB user cgroup when systemd --user is reachable
  if systemd-run --user --scope -p MemoryMax="${GATE_MEMORY_MAX:-6G}" -p MemoryHigh="${GATE_MEMORY_HIGH:-5G}" --quiet -- true 2>/dev/null; then
    systemd-run --user --scope -p MemoryMax="${GATE_MEMORY_MAX:-6G}" -p MemoryHigh="${GATE_MEMORY_HIGH:-5G}" --quiet -- "$@"
  else
    "$@"
  fi
}
rc=0
run() { # run <label> <cmd...>: log + one-line verdict
  local label="$1"; shift
  local log="$logs/$name-gate-$label.log"
  "$@" >"$log" 2>&1; local r=$?
  printf '%-10s exit=%s errors=%s log=%s\n' "$label" "$r" "$(grep -c 'error TS' "$log" 2>/dev/null)" "$log"
  [ $r -eq 0 ] || rc=1
}
if [ "$step" = all ] || [ "$step" = typecheck ]; then
  rm -rf apps/web/.turbo
  for p in core ui skills views; do
    run "tc-$p" capped bash -c "cd packages/$p && ../../node_modules/.bin/tsc --noEmit --pretty false"
  done
  run tc-web capped bash -c 'cd apps/web && T=./node_modules/.bin/tsc && $T -b tsconfig.shared.json --pretty false && $T -b tsconfig.server.json --pretty false && $T -b tsconfig.agent.json --pretty false && $T -p tsconfig.entry.json --pretty false && $T -p tsconfig.client.json --pretty false && $T -p tsconfig.e2e.json --pretty false'
fi
lint_lock="$logs/.gate-lint.lock"
serialized() { # serialized <cmd...>: hold the global lint/format lock, then require 3 GB free
  exec 8>"$lint_lock"; flock 8
  while [ "$(free -m | awk 'NR==2{print $7}')" -lt "${GATE_LINT_MIN_AVAILABLE_MB:-3000}" ]; do sleep 15; done
  "$@"; local r=$?; flock -u 8; return $r
}
[ "$step" = all ] || [ "$step" = lint ] && run lint serialized ./node_modules/.bin/oxlint . --ignore-pattern 'open-src/**' --threads 4
[ "$step" = all ] || [ "$step" = format ] && run format serialized ./node_modules/.bin/oxfmt --check 'apps/**/*.{ts,tsx,json,jsonc}' '!apps/**/routeTree.gen.ts' '!apps/web/drizzle/**/*.json' 'packages/**/*.{ts,tsx,json,jsonc}' 'tools/**/*.{ts,json}' 'scripts/**/*.{mjs,json}' package.json turbo.json
[ "$step" = all ] || [ "$step" = drizzle ] && run drizzle bash -c 'cd apps/web && ./node_modules/.bin/drizzle-kit check'
rm -f "$lane/.gate.pid"
exit $rc
