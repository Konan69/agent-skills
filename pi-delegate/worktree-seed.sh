#!/usr/bin/env bash
# Seed a NEW git worktree from an already-installed sibling checkout:
#   - hardlink-copies (or symlinks) every node_modules dir (root + per-package)
#   - copies untracked secrets/local config (.env*, *.local, .npmrc, .pi/, .codex/, .claude/settings.local.json)
#   - copies husky's generated hook dir (.husky/_) so the pre-push gate RUNS in the worktree; without it
#     core.hooksPath points at a missing dir and git pushes with no gate at all (2026-10-06)
#   - copies untracked agent skills (.claude/skills, .agents/skills), symlinks kept as symlinks
# NEVER run pnpm/vp install in a fresh worktree — use this instead.
# usage: worktree-seed.sh <source-checkout> <dest-worktree> [--symlink|--hardlink]  (default --symlink)
set -euo pipefail
if [ "${1:-}" = --help ] || [ $# -lt 2 ]; then
  echo 'usage: worktree-seed.sh <source-checkout> <dest-worktree> [--symlink|--hardlink]'
  [ "${1:-}" = --help ] && exit 0
  exit 2
fi
src=$(cd "${1:?source checkout}" && pwd -P); dst=$(cd "${2:?dest worktree}" && pwd -P); mode=${3:---symlink}  # pass --hardlink to copy
[ "$src" != "$dst" ] || { echo "src == dst" >&2; exit 2; }
n=0
while IFS= read -r nm; do
  rel=${nm#"$src"/}; target="$dst/$rel"
  [ -e "$target" ] && continue
  mkdir -p "$(dirname "$target")"
  if [ "$mode" = "--symlink" ]; then ln -s "$nm" "$target"
  else cp -al "$nm" "$target" 2>/dev/null || cp -a "$nm" "$target"; fi
  n=$((n+1))
done < <(find "$src" -type d -name node_modules -not -path '*/node_modules/*' -not -path '*/.git/*' | sort)
s=0
while IFS= read -r f; do
  rel=${f#"$src"/}; target="$dst/$rel"
  [ -e "$target" ] && continue
  mkdir -p "$(dirname "$target")"; cp -a "$f" "$target"; s=$((s+1))
done < <(cd "$src" && git ls-files --others --ignored --exclude-standard -z 2>/dev/null | tr '\0' '\n' \
  | grep -E '(^|/)(\.env[^/]*|[^/]+\.local|\.npmrc|\.pi/.*|\.codex/.*|\.claude/settings\.local\.json|\.husky/_/.*|\.(claude|agents)/skills/.*)$' \
  | grep -vE '(^|/)node_modules/|(^|/)(dist|build|\.turbo|\.cache)/' | sed "s|^|$src/|")
echo "seeded $dst: node_modules dirs=$n secrets/local/hook/skill files=$s (mode=$mode)"
if [ -d "$src/.husky" ] && [ ! -x "$dst/.husky/_/pre-push" ]; then echo "WARNING: $dst/.husky/_/pre-push missing: a push from here skips the gate" >&2; fi
# A host crash mid-seed leaves 0-byte executables that exit 0 and do nothing, so lint, typecheck and
# tests all "pass" in seconds. Refuse to call such a worktree seeded.
e=$(find "$dst" -path '*/node_modules/.bin/*' -size 0 2>/dev/null | wc -l)
if [ "$e" -gt 0 ]; then echo "ERROR: $e empty executables under $dst node_modules/.bin (crash-truncated): delete the worktree's node_modules and re-seed" >&2; exit 3; fi
