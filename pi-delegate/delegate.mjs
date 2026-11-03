#!/usr/bin/env node
/**
 * pi-delegate — reusable bridge that lets Claude Code (the orchestrator) hand work
 * to the pi-subagents extension running inside a persistent, write-capable pi session.
 *
 * WHY THIS EXISTS
 *   Explicit API-key alternatives use pi. Ordinary engineering uses T3 delegation.
 *   pi loads the pi-subagents extension in every session, exposing the `subagent`,
 *   `wait`, and `subagent_supervisor` tools — so a single pi turn can fan out to
 *   child agents (scout/worker/reviewer/oracle/planner/...), each in its own session,
 *   optionally async / parallel / worktree-isolated.
 *
 * DESIGN INVARIANTS (encode the user's hard corrections so they can't regress):
 *   - NEVER `-nt` / read-only: pi gets full tools so `worker` can actually edit files.
 *   - NEVER a blocking `timeout`: long fanouts must not be guillotined. Backgrounding
 *     is the caller's job (Claude's Bash run_in_background); this script just runs pi
 *     to completion and prints ONE clean final answer to stdout.
 *   - NOT an ephemeral one-shot: every run uses `--session-id`, so the session persists
 *     on disk and is resumable/steerable via follow-up turns (see `steer`).
 *
 * OUTPUT CONTRACT
 *   stdout begins with an immediate `[pi-delegate] started` header (session id, log
 *   path, a copy-paste `tail -f` watch command), then low-noise live progress lines
 *   (`+child`, heartbeats) as the fanout unfolds — so a backgrounded run is never
 *   silent: the Claude Code task output file shows life from second zero and the
 *   human can watch the raw stream via the printed tail command. The parent's final
 *   answer follows after a `=== RESULT ===` marker, then the compact footer (session
 *   id, child runIds, token cost). The full `--mode json` event stream is tee'd to a
 *   log file for debugging/artifacts.
 *
 * USAGE
 *   node delegate.mjs run   "<task prompt>" [--session <id>] [--cwd <dir>] [--model <m>]
 *   node delegate.mjs steer "<message>"      --session <id>   [--cwd <dir>]
 *   node delegate.mjs resume "<message>"     --session <id>   [--cwd <dir>]   (alias of steer)
 *
 * `run`   starts (or reuses) a session and dispatches the task.
 * `steer` sends another turn to an existing session — mid-run guidance or a follow-up
 *         instruction the parent applies (it can re-fan-out to children as needed).
 */

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertApprovedModel, DEFAULT_MODEL } from "./model-policy.mjs";
import { acquireSessionLock } from "./session-lock.mjs";

/** Parse argv into { command, prompt, opts } without a dependency. */
function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  const positionals = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    // Long options consume the next token as their value.
    if (a === "--session") opts.session = rest[++i];
    else if (a === "--cwd") opts.cwd = rest[++i];
    else if (a === "--model") opts.model = rest[++i];
    else positionals.push(a);
  }
  // The prompt is the first positional; join extras so unquoted multi-word still works.
  return { command, prompt: positionals.join(" "), opts };
}

/**
 * Derive a stable-ish session id when the caller does not pass one. We want distinct
 * ids per delegation (so unrelated fanouts don't collide) but human-readable. Date.now()
 * and Math.random() ARE available in a normal Node process (unlike Workflow scripts).
 */
function defaultSessionId(cwd) {
  const base = cwd.split("/").filter(Boolean).pop() || "repo";
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `cc-${base}-${stamp}-${rand}`;
}

/**
 * Recursively collect every assistant text block inside a parsed JSON event object.
 * pi's `--mode json` nests text under content arrays; we don't care about the exact
 * shape, only that text lives in `{ type: "text", text: "..." }` leaves.
 */
function collectText(node, out) {
  if (Array.isArray(node)) {
    for (const v of node) collectText(v, out);
  } else if (node && typeof node === "object") {
    if (node.type === "text" && typeof node.text === "string") out.push(node.text);
    for (const v of Object.values(node)) collectText(v, out);
  }
}

async function main() {
  const { command, prompt, opts } = parseArgs(process.argv.slice(2));
  if (!command || command === "--help" || !["run", "steer", "resume"].includes(command)) {
    console.error("usage: delegate.mjs <run|steer> \"<prompt>\" [--session id] [--cwd dir] [--model m]");
    process.exit(command === "--help" ? 0 : 2);
  }
  if (!prompt) {
    console.error("error: missing prompt");
    process.exit(2);
  }
  const cwd = opts.cwd || process.cwd();
  // steer/resume REQUIRE an existing session; run creates one if absent.
  const session = opts.session || (command === "run" ? defaultSessionId(cwd) : null);
  if (!session) {
    console.error("error: steer/resume require --session <id>");
    process.exit(2);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(session)) {
    console.error("error: session must be a filename-safe ID");
    process.exit(2);
  }
  const model = opts.model || DEFAULT_MODEL;
  try {
    assertApprovedModel(model);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  // Tee the full event stream to a log for later inspection (artifacts/debugging).
  const logDir = join(tmpdir(), "pi-delegate-logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${session}.jsonl`);

  // SESSION LOCK — one live turn per session. Concurrent `pi --session-id X`
  // processes wedge each other (observed: flatlined multi-GB event replays and
  // $0 no-answer turns when steers were stacked on an in-flight session).
  const lockPath = join(logDir, `${session}.lock`);
  const { readFileSync, unlinkSync } = await import("node:fs");
  acquireSessionLock(lockPath);
  const releaseLock = () => {
    try {
      if (readFileSync(lockPath, "utf8").trim() === String(process.pid)) unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  };
  process.on("exit", releaseLock);

  const log = createWriteStream(logPath, { flags: "a" });

  // Build pi args: persistent session + structured output + full tools (NO -nt, NO -p,
  // NO timeout). Model override is optional (defaults to GLM 5.3 flash on OpenRouter).
  const args = ["--session-id", session, "--mode", "json"];
  // Validate the configured parent model before starting Pi.
  args.push("--model", model);
  const GATE_INVARIANT = process.env.PI_GATE_INSTRUCTIONS ?? (
    "\n\nHARD RULE: do NOT run pnpm, turbo, typecheck, lint, format, vitest, or any install " +
    "(pnpm install / npm ci / vp install) — the orchestrator owns every gate and runs them " +
    "itself. If one of those gate/build/install commands, or any long-running command, fails " +
    "or times out, report it once and never retry it. That is NOT a reason to stop the task: " +
    "an exploratory command that exits non-zero (rg/grep finding no match, a missing file, a " +
    "failed lookup) is information — use it and keep working until the task is done.");
  args.push(prompt + GATE_INVARIANT);

  // Visibility: announce the run IMMEDIATELY so the backgrounded task's output file
  // is never empty and the orchestrator can hand the human a watch command up front.
  const startedAt = Date.now();
  process.stdout.write(
    `[pi-delegate] started session=${session} cwd=${cwd}\n` +
      `[pi-delegate] watch: tail -f ${logPath}\n`,
  );

  const child = spawn("pi", args, {
    cwd, stdio: ["ignore", "pipe", "pipe"], detached: true,
    env: { ...process.env, DO_NOT_TRACK: "1", PI_TELEMETRY: "0" },
  });
  let stopCode;
  let escalation;
  const signalChild = (signal) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    process.on(signal, () => {
      if (stopCode) return;
      stopCode = code;
      signalChild(signal);
      escalation = setTimeout(() => signalChild("SIGKILL"), 2000);
    });
  }

  // Live processing: parse the JSON event stream line-by-line INCREMENTALLY —
  // never accumulate the whole stream in memory. A single pi fanout can emit
  // gigabytes of events (learned the hard way: a 66k-row data enumeration blew
  // V8's max string length via `out += chunk`), so we keep only: the current
  // partial line, the latest final-answer candidate, and small delta sets for
  // the footer. The raw stream still goes to the log file in full.
  const seenAgents = new Set();
  const seenRunIds = new Set();
  let finalText = "";
  let cost = null;
  let lineBuf = "";
  let droppedOversizedLines = 0;
  // A single well-formed event line can legitimately be MBs (a full turn
  // snapshot); cap the reassembly buffer well below V8's string ceiling so a
  // pathological no-newline stream degrades to a dropped line, not a crash.
  const MAX_LINE_BYTES = 256 * 1024 * 1024;
  const elapsed = () => Math.round((Date.now() - startedAt) / 1000);
  const processLine = (line) => {
    const s = line.trim();
    if (!s.startsWith("{")) return;
    // Regex over the raw line (not JSON.parse) so streaming fragments still count.
    for (const m of s.matchAll(/"agent":"([^"]+)"/g)) {
      if (!seenAgents.has(m[1])) {
        seenAgents.add(m[1]);
        process.stdout.write(`[pi-delegate] +child agent=${m[1]} t+${elapsed()}s\n`);
      }
    }
    for (const m of s.matchAll(/"runId":"([^"]+)"/g)) seenRunIds.add(m[1]);
    const costMatch = s.match(/"total":([0-9.]+)}/);
    if (costMatch) cost = costMatch[1];
    // Complete turn snapshots carry a `messages` array; the parent's final
    // answer is the LAST such snapshot's last assistant message (children and
    // streaming deltas are filtered out by the messages check inside).
    if (!s.includes('"messages"')) return;
    let obj;
    try {
      obj = JSON.parse(s);
    } catch {
      return; // partial/streaming fragment — skip
    }
    if (!Array.isArray(obj?.messages)) return;
    const assistant = [...obj.messages].reverse().find((m) => m?.role === "assistant");
    const chosen = assistant ?? obj.messages[obj.messages.length - 1];
    const texts = [];
    collectText(chosen?.content ?? chosen, texts);
    const joined = texts.filter((t) => t.length > 0).join("");
    if (joined.trim().length > 0) finalText = joined;
  };
  const consumeChunk = (text) => {
    lineBuf += text;
    if (lineBuf.length > MAX_LINE_BYTES) {
      // Give up on this line rather than growing toward the V8 string limit.
      droppedOversizedLines += 1;
      lineBuf = "";
      return;
    }
    const lines = lineBuf.split("\n");
    lineBuf = lines.pop() ?? ""; // keep the trailing partial line for the next chunk
    for (const line of lines) processLine(line);
  };

  // Heartbeat so long quiet stretches (one big child turn) still show liveness.
  let bytesSeen = 0;
  const heartbeat = setInterval(() => {
    process.stdout.write(
      `[pi-delegate] heartbeat t+${elapsed()}s agents=${seenAgents.size} children=${seenRunIds.size} stream=${Math.round(bytesSeen / 1024)}KB\n`,
    );
  }, 30_000);

  child.stdout.on("data", (d) => {
    const text = d.toString();
    bytesSeen += text.length;
    log.write(d);
    consumeChunk(text);
  });
  child.stderr.on("data", (d) => log.write(d));

  const code = await new Promise((res, reject) => {
    child.on("close", res);
    child.on("error", reject);
  });
  clearTimeout(escalation);
  processLine(lineBuf); // flush any final unterminated line
  clearInterval(heartbeat);
  log.end();

  const runIds = [...seenRunIds];
  const agents = [...seenAgents];
  if (droppedOversizedLines > 0) {
    process.stdout.write(
      `[pi-delegate] warning: dropped ${droppedOversizedLines} oversized event line(s) (>256MB) — see log for the full stream\n`,
    );
  }
  // Emit the clean answer behind a stable marker (progress lines precede it), then a
  // compact footer proving the delegation path.
  process.stdout.write(`\n=== RESULT ===\n`);
  process.stdout.write((finalText || "(pi returned no final text — inspect log)") + "\n");
  process.stdout.write(
    `\n---\n[pi-delegate] session=${session} exit=${code} elapsed=${elapsed()}s` +
      (agents.length ? ` agents=${agents.join(",")}` : "") +
      (runIds.length ? ` children=${runIds.length}` : "") +
      (cost ? ` cost=$${cost}` : "") +
      `\n[pi-delegate] log=${logPath}\n`,
  );
  process.exit(stopCode ?? (code === 0 ? 0 : 1));
}

main().catch((e) => {
  console.error("[pi-delegate] fatal:", e?.message || e);
  process.exit(1);
});
