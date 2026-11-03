---
name: pi-browser
description: "Drive browser flows with agent-browser or Jev, locally or on a configured remote host. Use for form fills, screenshots, login flows and browser verification."
---

# Pi browser

Use a dedicated browser session per task. Reuse the same session through the flow.

## Configuration

Install `agent-browser` and its browser runtime on the machine that runs the flow.
Jev is optional. Install `jev-browser` separately if the task uses its goal-based steps.
Set `BROWSER_HOST` to your SSH alias when using a remote machine. Leave it unset for local work.
Set `BROWSER_LOG_DIR` to a directory for evidence. The default in the examples is `$HOME/browser-evidence`.
Provider and model selection follows the caller's configuration. Pi dispatch uses the sibling `pi-delegate` skill.

## Drive a flow

1. Read `agent-browser --help` on the execution machine. Confirm the target URL and expected outcome.
2. If remote execution is configured, run commands through `ssh "$BROWSER_HOST"`. Keep the browser and app on the same machine when possible. Configure SSH connection reuse for repeated commands.
3. Open the page and inspect interactive references.

```bash
mkdir -p "${BROWSER_LOG_DIR:-$HOME/browser-evidence}"
agent-browser --session <name> open <url>
agent-browser --session <name> snapshot -i
agent-browser --session <name> click @e1
agent-browser --session <name> snapshot -i --delta
agent-browser --session <name> screenshot "${BROWSER_LOG_DIR:-$HOME/browser-evidence}/<name>.png"
```

4. Confirm each expected result from the page and a screenshot. Refresh references after navigation or a DOM change.
5. For Jev, write one observable outcome per step. Put input strings in `values` and verify completion with page assertions. Read the installed Jev CLI's help before choosing its invocation syntax.
6. Report the actual result and absolute evidence paths. Mark anything unseen as not confirmed.

## Authentication

Sign in separately on the execution machine using its own persistent profile.
Do not copy cookies for GitHub, Google, X, banks or the Cloudflare dashboard.
For interactive login, use a browser profile owned by this task and attach through its configured CDP port.
Do not attach to an unrelated browser or copy a locked desktop profile.
Take project URLs, account names and authentication steps from the caller. Do not invent a database login bypass.

## Recordings

Record only when the sequence itself is evidence, such as an animation bug or a flaky flow.
Use `agent-browser --session <name> record start <absolute-path.webm>` and stop recording after the final screenshot.
Keep recordings outside the product repository unless the caller requests otherwise.

## Cleanup

Finish with `agent-browser --session <name> record stop` if recording, then `agent-browser --session <name> close`, including after a failed assertion.
Stop only processes this task started. Reuse shared dev servers without restarting them.
