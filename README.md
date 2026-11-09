# agent-skills

Claude Code skills I use every day.

Seven skills: steering Codex lanes, a Codex review loop that stops before it grows the diff, sending work to API-key models through Pi, driving a browser, telling the time, and two ways to make a product film. Each names the tools it needs, so the agent checks for them before it starts.

![The terminal copies every skill folder into ~/.claude/skills and lists the seven installed skills](docs/media/hero.gif)

## Install

Claude Code, plus the tools listed below for each skill you use. A skill is a folder, so installing is a copy. Keep the folder names; the skills refer to their own files by installed path.

```bash
mkdir -p ~/.claude/skills
cp -r $(dirname */SKILL.md) ~/.claude/skills/   # all seven
cp -r now sol-loop ~/.claude/skills/            # or just the ones you want
```

Start a new Claude Code session to pick them up.

## Use

Claude loads a skill when the task matches its description, or when you type `/<name>`.

| Skill | Does | Needs |
| --- | --- | --- |
| [`codex-lanes`](codex-lanes/SKILL.md) | Launch, steer and inspect long-running Codex lanes from a scoped brief | [`codex-lane`](https://github.com/Konan69/codex-lane), `codex` |
| [`sol-loop`](sol-loop/SKILL.md) | Codex reviews Claude's code in rounds (3, or 5 for auth, data loss or concurrency) under a scope fence | `codex`, `git`, `gh` for PRs |
| [`pi-delegate`](pi-delegate/SKILL.md) | Send work to allowlisted API-key models through Pi; only runs when you type `/pi-delegate` | `pi`, Node.js, `git` |
| [`pi-browser`](pi-browser/SKILL.md) | Browser flows with `agent-browser`, locally or over SSH, with evidence screenshots | `agent-browser` |
| [`product-film`](product-film/SKILL.md) | A Remotion film built from the product's own components and tokens, cut to music beats | Remotion, `bun`, `uv` |
| [`no-slop-motion`](no-slop-motion/SKILL.md) | A narrated launch film in HyperFrames and GSAP, gated from customer pain to final render | Node 20+, `ffmpeg`, `uv` |
| [`now`](now/SKILL.md) | Prints the real date and time before the agent says "tonight" | Bash, GNU `date` |

The scripts inside them run on their own too:

```console
$ LOCAL_TZ=Europe/Berlin bash now/scripts/now.sh
now: Tue 03 Nov 2026 20:02 CET (local, Europe/Berlin)
     Tue 03 Nov 2026 19:02 UTC
     Tue 03 Nov 2026 14:02 EST (US East / Toronto)
     part of day: evening
$ node pi-delegate/model-policy.mjs --check openai-codex/gpt-6.1-sol   # exits 2
model openai-codex/gpt-6.1-sol is not approved for pi; use an exact ID from PI_APPROVED_MODELS or the defaults in model-policy.mjs.
$ bun test no-slop-motion/scripts/qa/lint-slop.test.ts               # 8 pass
```

## Configuration

Set these in the shell that starts Claude Code.

| Variable | Skill | Default |
| --- | --- | --- |
| `CODEX_HOME` | `codex-lanes`, `sol-loop` | `~/.codex` |
| `PI_APPROVED_MODELS` | `pi-delegate` | the list in `model-policy.mjs` |
| `PI_MODEL` | `pi-delegate` | `openrouter/z-ai/glm-5.3-flash` |
| `PI_GATE_INSTRUCTIONS` | `pi-delegate` | built-in gate text; empty appends none |
| `BROWSER_HOST` | `pi-browser` | unset, runs locally |
| `BROWSER_LOG_DIR` | `pi-browser` | `$HOME/browser-evidence` |
| `CARTESIA_API_KEY` | `no-slop-motion` | unset; only needed for generated narration |
| `LOCAL_TZ` | `now` | `UTC` |

## Limits

- The skills are instructions. They do not install their tools.
- `codex-lanes` needs `codex-lane`, which is Linux only. `now` needs GNU `date`, not the macOS one.
- `sol-loop` and `codex-lanes` mention T3 Code's delegation tools and fall back to the CLIs elsewhere.
- Remotion, used by `product-film`, has its own license. Check it before commercial use.
- Tested for this README: the copy install, `now.sh`, `model-policy.mjs`, and the `lint-slop` tests. The film renders, Pi launchers and browser flows were not run.

What each skill's scripts do: [docs/internals.md](docs/internals.md).

## License

MIT, except:

- `sol-loop/` is adapted from Theo Browne's tstack (MIT, `sol-loop/LICENSE`).
- `no-slop-motion/starter/assets/vendor/gsap.min.js` is GSAP 3.14.2 under the Standard "No Charge" GSAP License, which is not MIT and forbids use in no-code animation builders that compete with Webflow.
- The Inter and Archivo fonts in `no-slop-motion/starter/assets/fonts/` are SIL OFL 1.1.
