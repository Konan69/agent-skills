#!/usr/bin/env python3
"""Run model-policy and concurrent-launch probes with a fake Pi executable."""
import json
import os
import signal
from pathlib import Path
import subprocess
import tempfile
import time


def main():
    skill = Path(__file__).resolve().parent
    approved = ["openrouter/z-ai/glm-5.3-flash", "opencode/deepseek-v4-pro",
                "opencode/deepseek-v4-flash", "opencode/kimi-k3", "opencode/qwen3.8-max"]
    denied = ["openai/gpt-6.1-sol", "openai/not-gpt", "openai-codex/gpt-6-luna",
              "openrouter/openai/gpt-6.1-sol", "opencode/gpt-6.1-sol", "xai/grok-4",
              "openrouter/x-ai/grok-4", "anthropic/claude-sonnet-4", "claude/fable",
              "openai/gpt-6-astra", "claude-bridge/opus", "unknown/model", "--scope", "--check"]
    with tempfile.TemporaryDirectory(prefix="pi-delegate-probe-") as tmp:
        root = Path(tmp)
        fake_pi = root / "pi"
        fake_pi.write_text('''#!/usr/bin/env python3
import json, os, pathlib, signal, sys, time
r = pathlib.Path(os.environ["PROBE_ROOT"])
assert os.environ.get("DO_NOT_TRACK") == "1"
assert os.environ.get("PI_TELEMETRY") == "0"
if os.environ.get("IGNORE_TERM"): signal.signal(signal.SIGTERM, signal.SIG_IGN)
(r / ("started-" + str(os.getpid()))).write_text(json.dumps(sys.argv[1:]))
if os.environ.get("HOLD_PI"):
    until = time.monotonic() + 20
    while not (r / "release").exists() and time.monotonic() < until: time.sleep(0.02)
print(json.dumps({"messages":[{"role":"assistant","content":[{"type":"text","text":"probe done"}]}]}))
print('{"type":"agent_end"}')
''')
        fake_pi.chmod(0o755)
        prompt = root / "prompt.txt"
        prompt.write_text("Offline probe.")
        env = dict(os.environ, PATH=f"{root}:{os.environ['PATH']}", TMPDIR=str(root),
                   PROBE_ROOT=str(root), DO_NOT_TRACK="0", PI_TELEMETRY="1")
        launcher = ["bash", str(skill / "pi-launch.sh"), str(root), "probe", str(prompt), str(root / "launch.log")]
        for model in approved + denied:
            policy = subprocess.run(["node", str(skill / "model-policy.mjs"), "--check", model], capture_output=True, text=True)
            assert policy.returncode == (0 if model in approved else 2), (model, policy.stderr)
            if model in approved:
                continue
            wrapper = subprocess.run(["node", str(skill / "delegate.mjs"), "run", "probe",
                                      "--model", model], env=env, cwd=root, capture_output=True, text=True)
            raw = subprocess.run(launcher, env=dict(env, PI_MODEL=model), cwd=root,
                                 capture_output=True, text=True)
            assert wrapper.returncode == raw.returncode == 2, (model, wrapper, raw)
        assert not list(root.glob("started-*")), "denied models reached Pi"
        override = subprocess.run(launcher + ["--model", "openai/gpt-6.1-sol"], env=env,
                                  capture_output=True, text=True)
        assert override.returncode == 2 and not list(root.glob("started-*"))
        command = ["node", str(skill / "delegate.mjs"), "run", "probe",
                   "--session", "same-session", "--cwd", str(root)]
        runs = [subprocess.Popen(command, env=dict(env, HOLD_PI="1"), cwd=root,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(8)]
        try:
            deadline = time.monotonic() + 10
            while (sum(run.poll() is not None for run in runs) < 7 or not list(root.glob("started-*"))) and time.monotonic() < deadline:
                time.sleep(0.02)
            assert sum(run.poll() == 3 for run in runs) == 7, "concurrent launches were not refused"
            assert len(list(root.glob("started-*"))) == 1, "multiple Pi children entered one session"
            (root / "release").touch()
            results = [(run.wait(timeout=10), run.communicate()) for run in runs]
            assert sorted(code for code, _ in results) == [0] + [3] * 7
            assert any("=== RESULT ===\nprobe done" in out for _, (out, _) in results)
            lock = root / "pi-delegate-logs" / "same-session.lock"
            assert not lock.exists(), "completed session retained its lock"
            lock.write_text("")
            stale = subprocess.run(command, env=env, cwd=root, capture_output=True, text=True)
            assert stale.returncode == 3 and lock.exists(), "empty lock was stolen during initialization"
            lock.unlink()
        finally:
            (root / "release").touch()
            for run in runs:
                if run.poll() is None:
                    run.terminate()
                    run.wait(timeout=10)
        launched = subprocess.run(launcher, env=env, cwd=root, capture_output=True, text=True)
        assert launched.returncode == 0, launched.stderr
        deadline = time.monotonic() + 5
        while "agent_end" not in (root / "launch.log").read_text() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert "agent_end" in (root / "launch.log").read_text()
        assert len(list(root.glob("started-*"))) == 2
        kg = root / "kg"
        (kg / "logs").mkdir(parents=True)
        (kg / "ontology").mkdir()
        (kg / "prompts.slice.md").write_text("Offline recovery probe.")
        (kg / "min.tsv").write_text("slice\t1\n")
        (kg / "ontology/slice.md").write_text("Existing complete report.")
        (kg / "ontology/slice.coverage.tsv").write_text("document\nfixture\n")
        recovery_env = dict(env, HOME=str(root), KG_ROOT=str(kg))
        recovery_env.pop("KG_MODEL", None)
        recovery_env.pop("KG_SESSION_SUFFIX", None)
        recovered = subprocess.run(["bash", str(skill / "run-lane.sh"), "slice"],
                                   env=recovery_env, cwd=root, capture_output=True, text=True, timeout=10)
        assert recovered.returncode == 0, recovered.stderr
        assert "done attempt 1 coverage 1/1" in (kg / "logs/slice.status").read_text()
        invocations = [json.loads(path.read_text()) for path in root.glob("started-*")]
        assert any("kg-slice" in args and args[args.index("--model") + 1] == approved[0] for args in invocations)
        denied_recovery = subprocess.run(["bash", str(skill / "run-lane.sh"), "slice"],
                                         env=dict(recovery_env, KG_MODEL=denied[0]), capture_output=True, text=True)
        assert denied_recovery.returncode == 2
        scope = subprocess.run(["node", str(skill / "model-policy.mjs"), "--scope"],
                               check=True, capture_output=True, text=True)
        assert json.loads(scope.stdout) == {"subagents": {"modelScope": {"enforce": True, "allow": approved}}}

        def wait_started(previous):
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                added = set(root.glob("started-*")) - previous
                if added:
                    return int(next(iter(added)).name.split("-")[1])
                time.sleep(0.02)
            raise AssertionError("fake Pi did not start")

        for sig, expected, ignore in ((signal.SIGINT, 130, False), (signal.SIGTERM, 143, False),
                                      (signal.SIGHUP, 129, False), (signal.SIGTERM, 143, True)):
            (root / "release").unlink(missing_ok=True)
            session = f"signal-{sig.name}{'-ignores' if ignore else ''}"
            cmd = command[:-4] + ["--session", session, "--cwd", str(root)]
            previous = set(root.glob("started-*"))
            run = subprocess.Popen(cmd, env=dict(env, HOLD_PI="1", IGNORE_TERM="1" if ignore else ""), cwd=root,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                child_pid = wait_started(previous)
                run.send_signal(sig)
                if ignore:
                    time.sleep(0.1)
                    run.send_signal(sig)
                    assert run.poll() is None, "repeated signal bypassed cleanup"
                run.communicate(timeout=10)
                assert run.returncode == expected, (sig, run.returncode)
                assert not (root / "pi-delegate-logs" / f"{session}.lock").exists()
                try:
                    os.kill(child_pid, 0)
                except ProcessLookupError:
                    pass
                else:
                    raise AssertionError(f"{sig.name} left Pi child {child_pid} alive")
                rerun = subprocess.run(cmd, env=env, cwd=root, capture_output=True, text=True, timeout=10)
                assert rerun.returncode == 0 and "probe done" in rerun.stdout, rerun.stderr
                print(f"PASS: {sig.name}{' with repeated signal and forced cleanup' if ignore else ''} kills Pi child, exits {expected}, releases lock; same-session rerun succeeds")
            finally:
                (root / "release").touch()
                if run.poll() is None:
                    run.terminate()
                    run.wait(timeout=10)

        dead = subprocess.Popen(["true"])
        dead.wait()
        lock.write_text(str(dead.pid))
        (root / "release").unlink()
        previous = set(root.glob("started-*"))
        runs = [subprocess.Popen(command, env=dict(env, HOLD_PI="1"), cwd=root,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(8)]
        try:
            wait_started(previous)
            deadline = time.monotonic() + 10
            while sum(run.poll() is not None for run in runs) < 7 and time.monotonic() < deadline:
                time.sleep(0.02)
            assert sum(run.poll() == 3 for run in runs) == 7
            assert len(set(root.glob("started-*")) - previous) == 1
            (root / "release").touch()
            results = [run.communicate(timeout=10) for run in runs]
            assert sorted(run.returncode for run in runs) == [0] + [3] * 7, results
            assert not lock.exists()
            assert not list(lock.parent.glob("*.stale"))
        finally:
            (root / "release").touch()
            for run in runs:
                if run.poll() is None:
                    run.terminate()
                    run.wait(timeout=10)
        print("PASS: five approved models; fourteen forbidden/unknown IDs and command flags rejected by policy and both launchers; override blocked; eight-way fresh and dead-PID lock races each have one winner; empty lock fails closed; generated scope equals allowlist; telemetry disabled; wrapper/raw/recovery completed offline")


if __name__ == "__main__":
    main()
