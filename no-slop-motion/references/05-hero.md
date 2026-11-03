# Gate 5: The hero (mascot or hero object)

Every film needs one thing the viewer's eye follows through the turn: the thing that arrives and defeats the villain. With a mascot, that is the character. Without one, it is a **hero object**. Run this gate as a parallel lane next to the animatic and build, with its own files and its own review loop, so it never blocks the film.

## If the brand has no mascot

Most brands don't have one, and you should not invent one for the film. Pick a hero object the brand already owns:

| Brand has | Hero object | How it acts |
| --- | --- | --- |
| A logo mark with a shape | The mark itself | It arrives in the dark, lights the scene, and its colour spreads into the world. It can split into pieces, trace paths, or become a cursor. |
| A signature button or control | That button | It is the one pressable thing on screen. It gets pressed at each fix. |
| A signature product moment | That moment (a checkmark, a counter, a "paid" state) | It recurs at every fix and at the end. |
| A cursor-driven product | The cursor | It acts: hesitates in the problem half, moves with confidence after, lands precisely on every target. |
| A sound or jingle | The sound | It marks every turn, and can become a physical object on screen. |

Rules for a hero object:

- It is the **first thing in brand colour** at the turn, and colour spreads from it.
- It moves with more life than anything else (anticipation, a settle, a small squash on a press), while the UI around it moves cleanly.
- It is the same object every time. Build one component and reuse it.

## If the brand has a mascot

Mascot work drifts. Each "improvement" moves the character a little further from the logo until it stops looking like the brand. Start from the source and change only what animation needs.

### The loop

1. **Start from the canonical logo file.** Sample the palette directly from its pixels, not from a description of it.
2. **The logo is the character.** Bring the logo's own form to life (eyes, a blink, a head turn). Inventing a full body or a new setting for it usually fails.
3. **Build a rig with a fixed interface** (for example `pose(name)`, `look(dx, dy)`, `blink(t)`, `emote(kind)`), so the film never breaks when the drawing changes.
4. **A separate lane** (its own agent or chat) touches only rig files. New file per variant, never overwritten, so any earlier version can come back.
5. **One comparison sheet per change**: every variant next to the logo, at display size and at thumbnail size, with every pose, blink stage and gaze direction. A decision maker reacts fast to a sheet and slowly to a video.
6. **A handoff note** when a variant is picked: what changed, which file, which interface calls the film uses.

### What drifts, and what to hold

- **Fidelity.** Expressiveness beats detail. Fewer pixels or strokes, no outline, clear shapes.
- **Eyes.** Mirror them always. Design every in-between. Glossy highlights can tip a small character into creepy; plain, crisp eyes often read as cuter. Ask with a sheet.
- **Signature features.** Whatever makes the logo recognisable (a hairline, glasses, an ear shape) stays exactly as in the logo. Proportions too: simplifications often shrink the head.
- **Small art is judged from a distance.** A detail that looks crisp at 400% can look dirty at display size. Review at thumbnail size.
- **Expression language.** Borrow a genre's grammar for big emotion (comic hearts and stars, a sweat drop, speed lines). Design each expression on its own; don't add them as afterthoughts.
- **Motion.** Squash and stretch, pops, lots of scale. A character may keep moving on twos (12 poses per second) with a tiny jitter while the rest of the film moves smoothly; the contrast makes it feel handmade.

### Cultural gags

A meme only works if it is the exact meme. Get the reference image and copy its timing and framing. A near miss reads as a mistake.

## Lock

The rig file (or the hero object component) and an expression or state sheet, approved at display and thumbnail size.
