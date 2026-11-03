---
name: codex-lanes
description: "Launch, steer and inspect Codex lanes from a scoped brief. Use for Codex lane work outside T3; inside T3 use the caller's configured delegation tools."
---

# Codex lanes

## Configuration

Install the `codex-lane` CLI separately and put it on PATH. These instructions assume its `start`, `steer`, `status`, `last`, `interrupt`, `stop`, `resume` and `watch` commands.
Choose the model explicitly with `--model`. Use the configured Codex account through `CODEX_HOME`, which defaults to `$HOME/.codex`.
Choose writer and reviewer roles in the calling project's rules. Name owned paths and the done checks in every brief.
The examples use `$HOME/work/agent-lanes` for checkouts and evidence. Set the lane CLI's log directory to match your installation.
Inside T3, use `orchestrator_capabilities` and `delegate_task` when available. Provider instance names come from the caller's catalog.

## Ownership and scope

One orchestrator owns a checkout. Split concurrent writers by explicitly owned paths.
Unrelated sessions use separate worktrees or run read-only. Writers commit only their own paths.
Before dispatch, inspect the relevant source and write the brief yourself. Include the owner system, files, contract, done checks and exclusions.
Give each shared runtime one named owner. The orchestrator owns worktree lifecycle and deployment.
For sensitive changes, write the design before dispatch and require an independent review of the exact head SHA.

## Launch: always steerable
```bash
git worktree add -b <branch> ~/work/agent-lanes/<name> origin/main   # only when writers overlap
codex-lane start <name> <cwd> <brief.md> --model <model>
```
Runs `codex app-server` per lane with CODEX_HOME="${CODEX_HOME:-$HOME/.codex}", full access, approvals never. A review/RCA lane can point at the primary checkout or an existing worktree; it needs no worktree of its own. Files: `~/work/agent-lanes/logs/lanes/<name>.{log,events.jsonl,state.json,last.md}`.

One-shot review without a lane: `CODEX_HOME="${CODEX_HOME:-$HOME/.codex}" codex exec -m gpt-6.1-sol -c service_tier='"fast"' -s danger-full-access -C <repo> "<review prompt>" </dev/null` — findings over summary: severity, file/line, failure mode, fix direction; no edits.

## Steer, never restart
New requirement from the caller while a lane runs → `codex-lane steer <name> "<text>"` (or `@file`). Mid-turn it is injected into the active turn (`turn/steer`); when idle it starts a follow-up turn on the same thread with full context. Killing and relaunching a lane to add scope throws away its work.
- `codex-lane status` / `codex-lane last <name>` / `codex-lane interrupt <name>` / `codex-lane stop <name>`.
- Legacy `codex exec` lanes can't be steered mid-run; for those, `codex exec resume <session-id> "<text>" </dev/null` after they finish.

## Reading status
`codex-lane status` shows `status`, `turns`, and `worktree_changed=<N>s ago` (newest change git sees in the lane's cwd). If status and worktree ever disagree again, believe the worktree and read `<name>.log.stderr`; debug by running `Supervisor(...).run()` in the foreground. A lane stopped by mistake continues with `codex-lane resume <name> <thread-id> <cwd> <note-file> --model <m>` (thread id in `<name>.state.json`).

To keep a lane alive beyond the calling session on a systemd host, launch it in its own user unit:
```bash
systemd-run --user --unit=lane-<name> --collect --property=KillMode=process \
  --setenv=CODEX_HOME="${CODEX_HOME:-$HOME/.codex}" --setenv=PATH="$PATH" --setenv=HOME=$HOME \
  --working-directory=<cwd> codex-lane start|resume <name> [<thread-id>] <cwd> <brief> --model <m>
```
Verify `tail -1 /proc/<pid>/cgroup` shows `lane-<name>.service`. A non-repo cwd needs `git init` first.

## While lanes run: push notifications, not sleep loops
Arm Claude Code's native **Monitor** tool on the lane event stream as soon as the first lane starts:
`Monitor(command: "codex-lane watch", description: "codex lane events", timeout_ms: 1800000)`.
It prints one line per turn end, error, failed command, supervisor exit and new commit — nothing else, because every line wakes me for a full turn at my current context size. Each line lands in my chat as a notification, so I keep working while lanes run. Monitor caps at 30 minutes: re-arm on every expiry until the last lane stops. `codex-lane watch <name>...` narrows it. No heartbeat, no hand-run `codex-lane status` polling: cache TTL is 1 hour, so warm-keeping polls are pure cost.

On events:
1. A Luna commit or turn end: review what it committed (`git diff origin/main..HEAD`) and steer fixes mid-turn. Look first for limits/caps that reduce what main allows today, dishonest types, gates nothing passes through, literals another lane's lint rule will reject.
2. A Luna lane with a clean tree that is only "reviewing"/"writing the report" is DONE: steer it to write ≤40 lines and stop. Sol review lanes end with their findings; act on them (the assigned writer fixes accepted findings) and stop the lane.
3. Errors or failed commands: read `codex-lane last <name>` and the log tail, then steer.
4. After each merge, steer the remaining lanes to rebase onto the new origin/main, naming the files that moved.
5. `codex exec` one-shots: run with `run_in_background: true`; the completion notification is the event.

## Parallel by default, but bounded
- Independent work = separate lanes (or agents in one lane) started in the same message. Never queue B behind A unless B reads A's output.
- Split writers by file ownership inside the session's own checkout; name the paths each lane owns and must not touch in every brief.
- Inside a lane: live evals and stress suites run concurrently (bounded pool, per-test isolated fixtures), never scenario-by-scenario serially.
- The machine is rarely the bottleneck (capacity depends on the execution machine); check `<your-build-slot-command>` + `uptime` before blaming it. But a handful of lanes, not tens of worktrees.

## Brief checklist
Model and role (Sol writing/review/RCA, or Luna mechanical); branch/worktree/base sha (Luna); product decision in the user's words; files owned / not to touch; for Sol reviews: the diff range, the spec or product doc to review against, and "findings only, no edits"; edge-case matrix (stress-test rule); heavy commands via `<your-build-slot-command>`; test DB env; push branch, no PR unless asked; report tables.

## Review

The orchestrator chooses the reviewer and supplies the scope and evidence.
Use a fresh reviewer context for authored code. Ask for findings without edits.
Inspect the diff and run the claimed checks before accepting a result. Follow the calling project's approval rules before pushing or merging.
