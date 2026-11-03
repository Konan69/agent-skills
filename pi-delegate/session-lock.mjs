import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function acquireSessionLock(lockPath) {
  // Keep this guard inode. flock serializes stale renames and releases on death.
  const guard = `${lockPath}.guard`;
  writeFileSync(guard, "", { flag: "a", mode: 0o600 });
  const result = spawnSync("flock", ["-n", guard, process.execPath,
    fileURLToPath(import.meta.url), lockPath, String(process.pid)], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(result.stderr.trim() || "[pi-delegate] REFUSED: session lock acquisition is busy");
    process.exit(3);
  }
}

function acquire(lockPath, pid) {
  let tombstone;
  try {
    for (;;) {
      try {
        writeFileSync(lockPath, pid, { flag: "wx", mode: 0o600 });
        return;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      let holder;
      try { holder = readFileSync(lockPath, "utf8").trim(); }
      catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      let dead = false;
      if (/^[1-9][0-9]*$/.test(holder) && Number.isSafeInteger(Number(holder))) {
        try { process.kill(Number(holder), 0); }
        catch (error) { dead = error.code === "ESRCH"; }
      }
      if (!dead) {
        console.error(`[pi-delegate] REFUSED: session is locked (pid ${holder || "initializing"}): ${lockPath}`);
        process.exitCode = 3;
        return;
      }
      tombstone = `${lockPath}.${randomUUID()}.stale`;
      try { renameSync(lockPath, tombstone); }
      catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
    }
  } finally {
    if (tombstone) {
      try { unlinkSync(tombstone); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--help") {
    console.log("Internal helper, invoked under flock by delegate.mjs: session-lock.mjs <lock-path> <owner-pid>");
  } else {
    acquire(process.argv[2], process.argv[3]);
  }
}
