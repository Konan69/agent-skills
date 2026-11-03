#!/usr/bin/env bash
# Launch one raw pi turn with every invariant applied, detached from the calling
# shell, and record the REAL pid so liveness can be checked later.
#
#   pi-launch.sh <cwd> <session-id> <prompt-file> <log-file> [extra pi args...]
#
# Model: $PI_MODEL (default openrouter/z-ai/glm-5.3-flash); exact allowlist in model-policy.mjs.
# Prints the pid. Writes <log-file>.pid. The launcher returns immediately; the
# turn is finished only when the log tail carries {"type":"agent_end"}.
# Liveness: `kill -0 $(cat <log>.pid)` — NOT pgrep on argv (pi retitles itself "pi").
set -u
export DO_NOT_TRACK=1 PI_TELEMETRY=0
if [ "${1:-}" = --help ] || [ $# -lt 4 ]; then
  echo 'usage: pi-launch.sh <cwd> <session-id> <prompt-file> <log-file> [extra pi args...]'
  [ "${1:-}" = --help ] && exit 0
  exit 2
fi
policy="$(dirname "$(readlink -f "$0")")/model-policy.mjs"
cwd="$(readlink -f "$1")"; sid="$2"; prompt_file="$(readlink -f "$3")"; log="$(readlink -f -m "$4")"; shift 4
[ -d "$cwd" ] || { echo "no such cwd: $cwd" >&2; exit 2; }
[ -f "$prompt_file" ] || { echo "no such prompt file: $prompt_file" >&2; exit 2; }
mkdir -p "$(dirname "$log")"
cd "$cwd"
model="${PI_MODEL:-openrouter/z-ai/glm-5.3-flash}"
node "$policy" --check "$model" || exit 2
# Extra model/provider flags could override the validated ID or enable model cycling.
for arg in "$@"; do
  case "$arg" in --model*|--provider*|--explore) echo "model/provider overrides are not allowed; set PI_MODEL" >&2; exit 2;; esac
done
setsid nohup pi --session-id "$sid" --mode json --model "$model" -xt intercom "$@" \
  "Read $prompt_file and carry out the task it describes completely." \
  < /dev/null >> "$log" 2>&1 &
pid=$!
echo "$pid" > "$log.pid"
echo "$pid"
