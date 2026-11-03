#!/usr/bin/env bash
# Resume a KG extraction slice until its report and minimum coverage are complete.
set -uo pipefail
if [ "${1:-}" = --help ] || [ $# -ne 1 ]; then
  echo 'usage: run-lane.sh <slice-key> (KG_ROOT, KG_MODEL and KG_SESSION_SUFFIX are optional)'
  [ "${1:-}" = --help ] && exit 0
  exit 2
fi
export PATH="$HOME/.local/npm-global/bin:$HOME/.local/real-node/bin:$HOME/.local/bin:$PATH"
export DO_NOT_TRACK=1 PI_TELEMETRY=0
model="${KG_MODEL:-${PI_MODEL:-openrouter/z-ai/glm-5.3-flash}}"
node "$(dirname "$(readlink -f "$0")")/model-policy.mjs" --check "$model" || exit 2
cd "${KG_ROOT:-$HOME/work/agent-lanes/kg}" || exit 2
k="$1"
[[ "$k" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || exit 2
[ -s "prompts.$k.md" ] || exit 2
task="Read prompts.$k.md and carry out its task completely. Write as you go."
[ ! -s "logs/$k.jsonl" ] || task="Read your brief and ontology/$k.* files, then continue this slice without restarting. Write as you go."
for attempt in $(seq 1 12); do
  turn_rc=0
  pi --session-id "kg-$k${KG_SESSION_SUFFIX:-}" --mode json --model "$model" -xt intercom "$task" >> "logs/$k.jsonl" 2>&1 < /dev/null || turn_rc=$?
  need="$(awk -F'\t' -v k="$k" '$1==k{print $2}' min.tsv)"
  have=0
  [ ! -f "ontology/$k.coverage.tsv" ] || have=$(( $(wc -l < "ontology/$k.coverage.tsv") - 1 ))
  if [ "$turn_rc" -eq 0 ] && [ -s "ontology/$k.md" ] && [ "$have" -ge "${need:-0}" ] && ! tail -c 4000 "logs/$k.jsonl" | grep -q '"finalError"'; then
    echo "done attempt $attempt coverage $have/$need" >> "logs/$k.status"
    exit 0
  fi
  echo "attempt $attempt incomplete coverage $have/${need:-0}" >> "logs/$k.status"
  [ "$attempt" -eq 12 ] || sleep 15
  task="You were interrupted or short of coverage. Read your brief and ontology/$k.* files, then continue to at least ${need:-0} whole documents. Write as you go."
done
exit 1
