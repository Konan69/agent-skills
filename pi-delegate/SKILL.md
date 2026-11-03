---
name: pi-delegate
description: Explicit Pi dispatch for approved non-OpenAI API-key alternatives and second opinions. Covers persistent sessions, worktrees, liveness and recovery. Ordinary engineering uses T3 delegation.
disable-model-invocation: true
---

# pi-delegate

Pi dispatch is for API-key alternatives and second opinions requested by the caller.
Choose ownership and reviewer roles from the calling project's rules.
Inside T3, prefer its configured delegation tools for ordinary engineering.

## Sensitive work needs a written design

For auth, tenancy, persistence, migrations and other load-bearing changes, read the
implementation and any named reference before briefing. The orchestrator owns the design and assigns implementation explicitly. A hypothesis alone
is not a design. Keep the cross-family review and real-runtime proof.

## Model configuration

`PI_APPROVED_MODELS` is a comma-separated allowlist of exact provider/model IDs.
`PI_MODEL` selects the default and must appear in that allowlist. Without configuration, the existing example allowlist and `openrouter/z-ai/glm-5.3-flash` default apply.
Both launchers validate the parent model. Check availability with `pi --offline --list-models`.
`PI_GATE_INSTRUCTIONS` replaces the wrapper's appended gate ownership instructions. Set it to an empty string to append none. By default the orchestrator runs gates and delegates report failed long-running commands without retrying.
Set `DO_NOT_TRACK=1 PI_TELEMETRY=0`; both launchers set these automatically.

```bash
node ~/.claude/skills/pi-delegate/model-policy.mjs --check <provider/model>
node ~/.claude/skills/pi-delegate/model-policy.mjs --scope
```

Merge the generated scope into `~/.pi/agent/settings.json`, preserving existing settings.
Project `.pi/settings.json` can override the user scope. Check both before dispatch.
The launchers do not change settings or fully enforce child-model fallbacks. Pin child models explicitly.

## When to use

- A second opinion from a non-OpenAI model family on a design, diff or RCA.
- Bounded recon where an approved API-key alternative was explicitly requested.
- Parallel read-only research on approved models when authorized.
- Browser work goes to the sibling `pi-browser` skill, outside Pi dispatch.

A Pi second opinion does not replace the project's required review gate.

You (Claude) remain the conductor: scope the task, write the pi prompt, dispatch, read
the result, then **review the output yourself** against the project's CLAUDE.md rules
(Effect, Schema, domain honesty).

## How to invoke — wrapper for one stream, raw `pi` when you want control

Two ways in. Both go through the Bash tool with **`run_in_background: true`** (long
fanouts must never be timed out). Pick per dispatch:

### A. Raw `pi` via Bash — the default when you want CONTROL (user's explicit preference)

Drive pi directly. This is what the wrapper shells out to anyway, minus the opinions:

```bash
cd <repo> && pi --session-id <id> --mode json \
  --model openrouter/z-ai/glm-5.3-flash -xt intercom "<task>" < /dev/null > /tmp/pi-<id>.jsonl 2>&1
```

**Flag status (pi 0.84.2):** `--session-id <id>` works again and is
the way to create AND continue a session (a second invocation with the same id appends a
new turn to the same transcript). Clone with `--fork <path|id>`. Session files live at
`~/.pi/agent/sessions/<cwd-slug>/<timestamp>_<id>.jsonl`. The 0.7.0-era breakage (id flag
removed, `--resume` only) is gone; still glance at `pi --help` before a big dispatch, and
remember a resumed turn on a huge session replays the transcript for minutes before its
first event — don't declare it wedged early.

**Two hard-won invariants for raw dispatch from Claude Code's Bash tool:**
- Always end the command with `< /dev/null`. Without it pi 0.84 sits forever on the tool's
  stdin socket before the first model call (15 MB idle node process, no session file).
- Add `-xt intercom` when several pi sessions run at once. The `pi-intercom` extension lets a
  session `ask` its siblings for contracts; two concurrent asks crash the whole session with
  `Error: Already waiting for a reply`. Put the cross-branch contracts in the prompt instead.

- The orchestrator owns worktree lifecycle. Delegates must not remove or prune sibling worktrees.

Why raw: **you** decide concurrency, forking, and lifetime. The wrapper takes a
per-session pid lock and hard-REFUSES a second turn (exit 3) — correct for one linear
stream, but it also blocks you from steering mid-run and from cloning a session. Raw
`pi` gives you the whole CLI: `--fork`, several sessions at once, per-run `--model`,
`--thinking`, `-t/--tools` allowlists, `--append-system-prompt`.

What you give up and must do yourself: the `=== RESULT ===` marker, the live
`+child agent=` lines, the cost footer, and the crash-safe incremental JSON parsing.
With `--mode json` the stream is one JSON event per line — read the final answer with
the last complete turn snapshot, e.g.

```bash
grep '"messages"' /tmp/pi-<id>.jsonl | tail -1 | python3 -c 'import json,sys; m=json.load(sys.stdin)["messages"]; print("\n".join(c.get("text","") for c in [x for x in m if x.get("role")=="assistant"][-1]["content"] if c.get("type")=="text"))'
```

**Never `out += chunk` the whole stream** — a big fanout emits GBs and blows V8's string
limit. Always redirect to a file and read the tail.

### B. The wrapper — for a single supervised stream you'll steer linearly

```bash
node ~/.claude/skills/pi-delegate/delegate.mjs run "<task>" \
  --session <run-id> --cwd <repo> [--model <model>]
```

Use it when one long job wants babysitting: it prints an immediate `started` header
(session, log path, `tail -f` command), live `+child agent=…` lines and 30s heartbeats,
then the final answer after `=== RESULT ===` plus a footer (session, child runIds, cost).
Full event stream lands in `$TMPDIR/pi-delegate-logs/`. Its session lock is a feature
here — it stops you wedging the session with concurrent turns.
Lock creation is exclusive (`wx`). The wrapper requires `flock` to serialize dead-PID
reclamation, renames a stale lock to a unique tombstone, then retries exclusive creation.
Live, empty and malformed locks fail closed. Keep the `.lock.guard` file; its kernel
lock releases automatically on process death. SIGINT, SIGTERM and SIGHUP stop the Pi
process group, wait for it to close, release the session lock and exit. An unresponsive
group receives SIGKILL after two seconds.

- `--session <run-id>` makes the session persistent, resumable, and **steerable** — reuse
  the same id to send follow-up turns. Pick a stable id per unit of work (e.g. `cc-project-authfix`).
- Omit `--session` and the wrapper mints one (printed in the footer) — capture it if you'll steer.
- `--cwd` MUST be the repo root so child `worker` agents edit the right tree.
- Delegates report touched files and leave formatting, lint and typecheck to the
  orchestrator's configured gates. They do not run those gates or commit before it passes.
- **NEVER pipe the wrapper through `tail`/`head`/`grep`** — that buffers/discards the live
  progress stream and makes the backgrounded task look dead. Run it bare; read the task
  output file for interim progress.

### Visibility — background runs must never be silent (user's explicit correction)

The user cannot see backgrounded delegations in the Claude Code UI unless you surface
them. On EVERY dispatch, do all three:

1. **TaskCreate** one UI task per delegation — subject `pi: <short label> [<session-id>]`,
   `activeForm` like `pi: building decision-maker filter`, metadata `{ session, outputFile }`
   — and immediately TaskUpdate it to `in_progress`. This puts the run in the visible
   task list/spinner. When the run lands, TaskUpdate → `completed` (or keep `in_progress`
   + a follow-up task if it failed).
2. **Tell the user the watch command** in your reply right after dispatching: the
   wrapper's task output file (Claude Code prints it) and the raw stream
   `tail -f $TMPDIR/pi-delegate-logs/<session>.jsonl`.
3. **On completion**, relay the `=== RESULT ===` block's substance — the notification the
   harness sends is invisible to the user; your summary is what they see.

## Parallelism has TWO axes — use both

Fanning out is the point, not a luxury. There are two independent levers and they
compose:

### Default posture: parallel but bounded

If two units of work are not hard-blocked on each other, run them as separate sessions in the
same dispatch message. File overlap is not a hard block — give overlapping writers a worktree
and "git fetch && rebase onto origin/main before committing". But keep it to a handful of
sessions. Keep the batch bounded.

### Outer axis — several pi SESSIONS, launched by me from Bash

Each `--session-id` is its own process, its own context, its own lifetime. Launch N of
them in one message (independent Bash calls run concurrently) for genuinely independent
work. This is real parallelism I control, and it sidesteps the one-turn-per-session
constraint entirely because the sessions are different.

```bash
cd <repo> && pi --session-id job-a --mode json --model openrouter/z-ai/glm-5.3-flash "<task A>" < /dev/null > /tmp/pi-a.jsonl 2>&1
cd <repo> && pi --session-id job-b --mode json --model openrouter/z-ai/glm-5.3-flash "<task B>" < /dev/null > /tmp/pi-b.jsonl 2>&1
```

**Hard constraint that survives going raw:** one live turn per session id. Two concurrent
turns on the SAME id wedge the session. Parallelism comes from more session ids, never
from more turns on one id.

### Inner axis — pi's own subagent tree, composed inside the task text

pi drives `pi-subagents` itself. Say what shape you want in the prompt and it builds it:

| shape | syntax pi uses |
|---|---|
| one child | `/run reviewer "review this diff"` |
| fan out | `/parallel scout "audit frontend" -> reviewer "audit backend"` |
| chain | `/chain scout "analyze auth" -> planner` |
| chain with a parallel group | `/chain scout "scan" -> (reviewer "A" \| reviewer "B")[concurrency=2,failFast,worktree]` |
| N copies of one role | `count=3` inside a `( ... )` group |
| background | append `--bg` |
| per-step overrides | `scout[output=context.md]`, `planner[reads=context.md]`, `[model=…]`, `[skills=a+b]`, `[cwd=packages/api]` |

Nested runs appear in pi's status tree, so a fanout stays inspectable rather than
disappearing inside a child process.

### CLONE the context — `--fork`, the highest-leverage move

A fresh child re-derives everything from scratch and usually gets it wrong. A **forked**
child branches from the parent session's current leaf and inherits the whole transcript.
After an expensive research/recon turn, fork it into follow-up research children instead
of re-explaining the findings. Implementation still goes through the owning T3 seat.

- CLI: `pi --fork <session-id-or-path> --session-id <new-id> …` clones a finished session
  into a new one. This is how I hand a completed Phase-1 research session to N Phase-2
  workers, each already knowing everything.
- Inside pi: append `--fork` to `/run`, `/chain`, `/parallel`, or pass `context: "fork"`
  to the `subagent` tool. Builtin `planner` / `worker` / `oracle` already default to fork.
- Fork fails fast rather than silently degrading to fresh; provider-private thinking
  blocks get stripped. Pass `context: "fresh"` when a child genuinely must start clean.

### Isolate parallel WRITERS — `worktree`

Parallel children editing one checkout clobber each other. `worktree: true` (or the
`[worktree]` group option) gives each child its own git worktree branched from `HEAD`;
per-agent diff stats and full patches land in artifacts, worktrees are cleaned up after.
Requires a clean working tree. **Any time two or more children write code, use it.**

**Gates belong to the orchestrator.** The wrapper appends the configured gate instructions to each task.
`gate.sh` is a template for a monorepo with `apps/web` and `packages/{core,ui,skills,views}`, TypeScript project references, oxlint, oxfmt and Drizzle.
It does not discover arbitrary project layouts. Adapt its commands to your repository before using it.
`GATE_LOG_DIR` defaults to `$HOME/work/agent-lanes/logs`. `GATE_TSC=1` enables its typecheck step.
`GATE_MIN_AVAILABLE_MB` defaults to 5000, `GATE_LINT_MIN_AVAILABLE_MB` to 3000, `GATE_MEMORY_MAX` to `6G`, and `GATE_MEMORY_HIGH` to `5G`.
These limits serialize expensive checks on constrained Linux machines. Tune them for the execution host.
Run `gate.sh <lane-path> [typecheck|lint|format|drizzle|all]`. It requires Linux, util-linux `flock`, procps and the repository's installed binaries.

**Seeding a new worktree.** NEVER run `pnpm install` / `vp install` / `npm ci` in a fresh worktree, locally or on
a remote box. Seed it from the installed sibling checkout with
`~/.claude/skills/pi-delegate/worktree-seed.sh <installed-checkout> <new-worktree>` (symlinks
every `node_modules` dir incl. per-package ones; copies `.env*`, `*.local`, `.npmrc`, `.pi/`,
`.codex/`, `settings.local.json`). Use `--hardlink` to copy when links to the source tree are unsuitable. Put the same instruction in the task text so pi does not "helpfully" reinstall either.
Same rule for `git worktree add` done by pi's own `worktree` option — seed before dispatching.

Composing the fanout in plain language works — pi picks the shape:

- `"Use scout to map the auth flow, then have planner turn it into a plan."`
- `"Have reviewers inspect <approved plan> for correctness, tests and complexity; report findings without editing."`
- `"Ask oracle for a second opinion on <decision> before we edit anything."`
- `"Run these in parallel, each in its own worktree: <task A> / <task B> / <task C>."`

### Steering / follow-up (mid-run or after)

```bash
node ~/.claude/skills/pi-delegate/delegate.mjs steer "<new instruction or correction>" \
  --session <same run-id> --cwd <repo>
```

### Liveness — how to know a raw turn is alive or done

pi rewrites its process title to a bare `pi`, so **`pgrep -af "pi --session-id <id>"` finds
nothing while the turn is alive** and `/proc/<pid>/cmdline` shows only `pi`. On 2026-09-02 I
read that as "both lanes died silently", relaunched them, and created concurrent turns on
one session id (the hazard below), then had to kill the duplicate. Rules:

- **Launch with the helper and keep the pid:** `~/.claude/skills/pi-delegate/pi-launch.sh
  <cwd> <session-id> <prompt-file> <log>` applies every invariant (`--session-id`, `--mode
  json`, `-xt intercom`, `< /dev/null`, `setsid nohup`, file-pointer prompt, absolute log
  path), prints the pid and writes `<log>.pid`. It returns immediately.
- **Alive?** `kill -0 $(cat <log>.pid)`, or `for p in $(pgrep -x pi); do readlink /proc/$p/cwd;
  done` (the lane worktree identifies the session), plus the jsonl growing. Never argv.
- **Done?** Only when the log tail carries `{"type":"agent_end"}`. `turn_end`/`message_end`
  are per model step, and a `message_start … "stopReason":"pending"` with no follow-up for a
  minute is normal thinking, not death.
- **Get notified:** the launching Bash task completes instantly, so its notification means
  nothing. Background a separate wait on the real pid:
  `while kill -0 <pid> 2>/dev/null; do sleep 15; done; echo exited` with `run_in_background`.
- **Never relaunch a session id while its pid is alive.** If you must steer mid-run, kill the
  pid first (one command), verify it is gone, then start the next turn (another command).
- Logs go under `~/work/agent-lanes/logs/` (WSL wipes `/tmp` on reboot), always absolute
  paths — a relative `logs/x.jsonl` after `cd <lane>` silently lands in the lane tree.

### Resumable extraction batches

`run-lane.sh <slice-key>` resumes a persistent session until a report and its coverage floor exist.
Set `KG_ROOT` to the batch directory. It defaults to `$HOME/work/agent-lanes/kg`.
The directory must contain `prompts.<key>.md`, `min.tsv` with tab-separated key and minimum count, and writable `logs/` and `ontology/` directories.
Completion requires `ontology/<key>.md` and at least the minimum data rows in `ontology/<key>.coverage.tsv`.
`KG_MODEL` selects the model, defaulting to `PI_MODEL` or the example default. `KG_SESSION_SUFFIX` separates independent runs.
The runner allows 12 attempts, waiting 15 seconds between incomplete turns. Write results after each document so a resumed turn can continue.

### Recovering a stalled turn

`steer` is REFUSED while the session has a live turn. Before calling anything stalled, run
the liveness checks above (pid alive? log growing? `agent_end` present?). If the stream size
stays flat for 5+ minutes and the pid shows 0% CPU (usually a wedged tool call),
send SIGTERM to the wrapper pid and wait for it to exit, then `run` a NEW turn on the SAME
`--session` id — the session context survives, so a "stop searching, report what you have"
prompt recovers the work. Footgun: never `pkill -f <session-id>` from the same compound
command that relaunches — the pattern matches the new run's own command line and kills it
(exit 144, empty output). Kill first in one command, relaunch in another.
SIGKILL cannot run cleanup. Confirm any surviving Pi child is stopped before rerunning;
the next wrapper reclaims the dead owner's lock automatically.

## Subagents are YOUR call — this section guides, it does not dictate

You (Claude) decide what child agents to make and how to compose them. There is no
mandatory routing table. Read the task, then design the fanout that fits.

**What pi gives you (the available menu — use these OR make your own):**
| builtin | for |
|---|---|
| `scout` | fast local codebase recon before you understand the code |
| `researcher` | web/docs research with sources |
| `planner` | turn context into an implementation plan (reads, doesn't edit) |
| `worker` | reserved for an explicitly authorized alternative; ordinary implementation uses Sol |
| `reviewer` | read-only review vs task/tests/edge-cases |
| `context-builder` | heavier setup pass; writes handoff material |
| `oracle` | second opinion / risk check before acting (no edits) |
| `delegate` | general child that behaves close to the parent |

These are the ready-made options, **not a cage.** When the job wants a persona the
builtins don't cover, define a **custom subagent**:
  - inline — describe the child's role/instructions in the task text you pass pi, or
  - authored — drop a `~/.pi/agents/<name>.md` (frontmatter `name`/`tools`/`skills`/
    optional `prompt`; pin an API-key model) for one you'll reuse.
Compose freely — one child, parallel fanout, or a chain — when it genuinely helps. This
is judgment, not a checklist; don't force a panel where one agent is plainly enough.

For code review, ask for findings with severity, file and line, concrete failure mode and a suggested fix. The orchestrator makes the final decision.

## Workflows & goals — explicitly requested Pi alternatives

When the caller requests a Pi workflow, pin each child to the configured allowlist:

- **Workflows** → `@quintinshaw/pi-dynamic-workflows` — the `workflow` tool plus
  `/workflows`, `/adversarial-review`, `/deep-research`. "Break up the work into a
  workflow with multiple reviewers" = drive this inside a pi session (via the wrapper):
  it writes a JS orchestration script that spawns many pi subagents in parallel, keeps
  intermediate work out of context, and returns one synthesized answer. Right for
  codebase-wide audits, multi-perspective review, large refactors, cross-checked research.
- **Goals** → `@narumitw/pi-goal` — `/goal <goal>` (+ `pause`/`resume`/`clear`/`edit`,
  optional `--tokens`) with a `goal_complete` tool for autonomous, verifiable, session-
  scoped persistence. Run goal mode inside pi.

I still own scoping and the final review judgment. Pi workflows do not override T3's
thread restrictions, implementation ownership or the independent review gate.

## Hard rules (do not regress — these are the user's explicit corrections)

- **Only** the exact model allowlist may run through Pi. Ordinary implementation,
  uses the caller's assigned implementation provider.
- **Never** `pnpm/vp/npm install` in a fresh worktree (local or remote) — seed `node_modules` and
  secrets from the sibling checkout with `worktree-seed.sh` (see "Isolate parallel WRITERS").
- **Never** pass a blocking `timeout`; background the Bash call instead.
- **Never** run pi read-only (`-nt`) or ephemeral (`--no-session`) for real work. The
  wrapper enforces full tools + a persistent `--session-id`; **when you invoke `pi` raw
  you enforce it yourself** — always pass `--session-id`, never `-nt`, never `-p`.
- **Never** run two turns against the same `--session-id` at once. Going raw removes the
  wrapper's lock but not the underlying hazard — concurrent turns wedge the session.
  Parallelism comes from more session ids, or from pi's own subagent tree. Check the pid
  (see "Liveness"), never argv, before deciding a session is free — pi hides its argv.
- **Never** let a raw run's stream accumulate in memory — redirect to a file, read the tail.
- **Never** pass a long task as the argv prompt. Observed 2026-08-29 (pi 0.6x, `--mode json`):
  a ~3.5 KB multi-paragraph prompt made pi print only the "creating a new session" warning and
  exit 0 with no events — silent no-op, twice. Short prompts in the same dir/model worked. Rule:
  anything beyond a few lines goes in a file (`/tmp/pi-<id>.prompt`) and the argv prompt is a
  pointer: `"Read /tmp/pi-<id>.prompt and carry out the task it describes completely."` Check
  the jsonl has `agent_start` within seconds; a ~100-byte jsonl means the prompt was dropped.
- Prefer `--fork` over re-explaining. Re-deriving context a finished session already holds
  is the most common way a delegation comes back subtly wrong.
- pi runs cost real API-key money. Pick the cheapest model that fits and say which one.

## Cost/altitude judgment

Pi is for explicitly requested alternatives, second opinions and bounded research.
Delegate when there's real work that fits that, not by default.
