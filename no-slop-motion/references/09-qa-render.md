# Gate 9: QA, render and export

## The final gauntlet

Nothing ships until an independent reviewer has tried to break it. Run all of these on the final render:

Run browser checks, snapshots and rendering on the configured execution machine and drives Jev steps for previews, following the installed `pi-browser` skill. Export `HYPERFRAMES_NO_TELEMETRY=1` and `DO_NOT_TRACK=1` before HyperFrames commands. Require an independent code review at the exact head SHA and a separate visual approval.

- [ ] `npx hyperframes check` at 0 errors.
- [ ] `scripts/qa/lint-slop.ts` clean (or every exception has a `slop-ok` reason).
- [ ] `scripts/qa/pop-scan.py` finds no pops, flashes or black dips off the planned cuts.
- [ ] Contact sheets every 0.2 to 0.3 s around every cut, reviewed by eye.
- [ ] Frame 0 is a real frame, not empty.
- [ ] One pass with sound, one pass muted. Muted, the captions alone must carry the story.
- [ ] Captions: one style, word by word, no overlaps, never ahead of the voice, inside the band.
- [ ] The cursor lands on every target; every started action finishes.
- [ ] One brand-coloured call to action per frame.
- [ ] Recurring props are the same component every time.
- [ ] Every line of script and on-screen text is on the claims whitelist.
- [ ] `LOVES-HATES.md` re-read; every hate checked against the film.
- [ ] An adversarial subagent review with the render, contact sheets, `LOVES-HATES.md`, `DESIGN.md` and the script.

## Rendering fast

Slow renders eat review loops, and they hurt most right before a deadline.

- **Time a full render in the first pass** and plan review loops around it.
- **Review in HyperFrames Studio** (`npx hyperframes preview --background`), not on renders. Render only for sign-off.
- **Shared memory on Linux.** Docker and cloud sandboxes often have a 64 MB `/dev/shm`, which forces Chrome to capture one frame at a time. Raising it (`sudo mount -o remount,size=4G /dev/shm`, or `--shm-size=4g` for Docker) and using several workers can make frame capture around three times faster. The remount resets on restart.
- **Quality**: the "high" setting uses a slow encoder preset and produces very large files. Standard quality plus a social export is usually enough.
- **Run long renders in the background** and poll, so tool timeouts don't kill them.
- **Picture-lock caching**: once the picture is locked, keep the picture-only render and remix audio onto it (`render.ts --audio-only`).
- **Draft for timing checks**, full quality only for the final.

## Determinism bugs to expect

| Symptom | Cause | Fix |
| --- | --- | --- |
| Frames differ between renders, jitter flickers | `Math.random`, `Date.now` | Hash the frame number |
| Canvas content vanishes | Some capture paths drop live canvas | Draw the canvas to an `<img>` or render it deterministically per frame |
| First frame empty | Initial states set in a tween, not explicitly | Set every scene's frame 0 state |
| Boxes where emoji should be | Headless Chrome fonts | SVG icons |
| Colour disappears in a transition | Shader capture path | Don't use shader transitions; author colours |

## Export

```bash
npx tsx scripts/export/social.ts renders/film.mp4
```

- **X**: H.264, AAC 48 kHz, -14 LUFS, faststart, under 512 MB.
- **4:5 or 9:16** cuts for feeds if planned in Gate 0. Check the crops by eye; objects near the edges need their own framing.
- Share a review page with the video and the frame grid, and a direct download link.

## After shipping

Delete temporary API keys. Keep `LOVES-HATES.md` where the team can reuse it: the next film for the same brand starts from it.
