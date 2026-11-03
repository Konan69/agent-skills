# Gates 6 and 7: Animatic and build

## Gate 6: the animatic

Block every shot on the locked VO timeline with temp music, before polishing anything.

- Fill [../templates/SHOTLIST.md](../templates/SHOTLIST.md): one row per shot with its VO line, the one idea, the key object, the camera move, the named transition out, the hold after, and any sound.
- Rough blocks are fine: grey boxes that move where the real objects will move, real type, real timing.
- Preview it in HyperFrames Studio (or render it low-res) with captions on, and make a frame grid.
- **Story and timing freeze here.** Changes after this cost scene rebuilds.

## Gate 7: the build

### Project layout

Start from the [starter](../starter/). The pieces that let several agents build one long film at once:

| File | Owns | Who edits |
| --- | --- | --- |
| `assets/js/plan.js` | The timing table: VO onsets, music marks, captions band, where handmade motion switches to smooth | One owner. Scenes read it, never write it. |
| `assets/js/vo-data.js` | Word timings of every VO piece | Generated from the audio step |
| `assets/js/engine.js` | The single timeline, actors, cameras, captions, SFX cue collection | Read-only during the build |
| `assets/js/ui.js` | The props bible: one component per recurring object (the notification, the card, the button, the cursor) | One owner |
| `assets/js/sN-<name>.js` + `assets/css/sN-<name>.css` | One scene each | One agent per scene |
| `index.html` | Load order and the cut list (`window.SCENES`) | One owner |

Rules that keep it working:

- **Never type a raw second in a scene file.** Get every time from the plan, a word in a VO line, or the scene's window. Then a retimed voice line moves every beat attached to it.
- **Every pixel is a pure function of time.** HyperFrames seeks to frames in any order, on several workers. No `Math.random`, no `Date`, no network, no state carried from the previous frame. Seed jitter and grain from the frame number.
- **Explicit initial states.** Frame 0 of every scene must be set, not inherited. An empty frame 0 is a common bug.
- **The same object everywhere.** The broken thing in the problem half and the fixed thing in the product half must be the same component. Continuity is story logic, and a props bible is how you keep it.
- **SVG icons, not emoji.** Emoji often render as boxes in headless capture.

### Parallel agents

Once the animatic is locked, split scenes across subagents.

Assign design and implementation owners in the project brief. Review code independently at the exact head SHA. Keep a separate visual approval.

Each brief contains:

1. The scene's rows from `SHOTLIST.md` and its VO lines with their words.
2. `DESIGN.md`, the banned list and `LOVES-HATES.md`.
3. The engine API and the props bible (read-only).
4. The frames on both sides of its cuts, which it must match.
5. The files it owns. It edits only those.
6. The verification it must run: `npx hyperframes check` at 0 errors, `scripts/qa/lint-slop.ts`, dense snapshots at its cuts, and a reply in under 150 words saying what changed.

A refinement pass can go to every scene agent at once with one shared brief (for example "apply the one shot, one idea rules and cut half of your sound cues").

### Recording real UI (when you need it)

Build UI as HTML. When a real capture is part of the story (a screen recording that freezes, for example), have Claude capture it with Jev steps on the configured execution machine from a seeded demo account, following the installed `pi-browser` skill. Never copy cookies for GitHub, Google, X, banks or the Cloudflare dashboard. Crop tight and treat it as a prop. List which captures look bad on camera and art-direct those from real copy instead.

### Before handing over

Have Claude run these on the configured execution machine, in order, after the starter setup and preflight:

```bash
export HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1
npx hyperframes check                         # composition, layout, motion, contrast
npx tsx scripts/qa/lint-slop.ts .             # banned patterns
npx tsx scripts/render/render.ts --quality draft --out renders/draft.mp4
python3 scripts/qa/pop-scan.py renders/draft.mp4 --plan renders/.cache/film.json
python3 scripts/qa/contact_sheet.py renders/draft.mp4 --around <cut times>
```

Then an **adversarial subagent review**: a fresh agent gets the render, the contact sheets, `LOVES-HATES.md`, `DESIGN.md` and the script, and is asked to find everything the decision maker would flag. Fix what it finds before the handover.

## Lock

Picture lock. Keep the picture-only render: from here, audio changes remix onto it without re-rendering (`render.ts --audio-only`).
