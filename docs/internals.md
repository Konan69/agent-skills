# How agent-skills works

![Claude Code loads each skill from ~/.claude/skills; codex-lanes and sol-loop drive codex-lane and codex exec, pi-delegate and pi-browser drive pi and agent-browser, product-film drives Remotion, no-slop-motion drives HyperFrames and GSAP, and now runs scripts/now.sh](media/diagram.png)

Each `SKILL.md` starts with YAML frontmatter that holds `name` and `description`. Claude Code puts the descriptions in the agent's context, and the agent loads a skill's body when the task matches the description, or when you type `/<name>`. `pi-delegate` sets `disable-model-invocation: true`, so only `/pi-delegate` loads it.

The body is instructions, not code. The skills call tools that you install yourself:

- `codex-lanes` drives the `codex-lane` CLI, which keeps one steerable `codex app-server` per lane. It ships separately.
- `sol-loop` runs `codex exec -m <model>` as the reviewer, one reviewer per round, and keeps a ledger of findings with severity and outcome.
- `pi-delegate` runs `pi` directly, or through `pi-launch.sh` (one detached turn with its real pid recorded for liveness checks) and `delegate.mjs` (a bridge to the pi-subagents extension in a persistent Pi session). `model-policy.mjs` checks models against `PI_APPROVED_MODELS` and, with `--scope`, prints the `subagents.modelScope` block for `~/.pi/agent/settings.json`. `worktree-seed.sh` seeds a new git worktree from an installed sibling checkout. It links every `node_modules` and copies untracked local files, including `.env*`, `.npmrc`, `.pi/` and `.codex/`. `gate.sh` is a template for a monorepo's check script, and `run-lane.sh` resumes a long extraction job until its report is complete.
- `pi-browser` drives `agent-browser` sessions, locally or through `ssh "$BROWSER_HOST"`, and writes evidence to `BROWSER_LOG_DIR`.
- `product-film` copies `templates/kit/` and `scripts/` into the product's `videos/` workspace. `scripts/beats.py` finds beats in the music, `scripts/stills.ts` and `scripts/render.ts` render through Remotion, and `scripts/verify.py` checks the final files.
- `no-slop-motion` starts each film from `starter/`, a HyperFrames project pinned to `hyperframes@0.8.78`. Its scripts score and split voice takes, join music on downbeats, scan for pops, build contact sheets, mix audio and lint the composition for default-looking motion.
