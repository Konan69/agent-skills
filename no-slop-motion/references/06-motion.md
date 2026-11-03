# Motion, transitions and pacing

This is the grammar for Gates 6 and 7. The short version: **one shot is one idea, every entrance and exit is animated, every cut has a named transition, and every big beat gets room to breathe.**

## One shot, one idea

- Each moment has **one key object**, centred or on a strong thirds line, with generous empty space around it. Remove or dim everything else.
- **Freeze test**: pause on any frame. The single focus should be obvious within one second.
- **Never show text to read that differs from what the voice is saying** at the same moment.
- **Progressive disclosure**: build the object, push in on the one line that matters, mark it (a circle, a highlight, a strike). Then move on.
- **Energy comes from many small, orderly arrivals**, not from big blocks appearing. Notifications stack neatly one by one; they do not pile up crooked.
- A shot with no camera move, no build and no morph is a slide. Redo it.
- A scene that is hard to follow is fixed by removing elements, not by slowing everything down.

## Type is an actor

- Headlines enter **blur to sharp**: blur 14px to 0, y 24px to 0, opacity 0 to 1, 0.5 to 0.7 s, `power3.out`, words 60 to 90 ms apart. They leave with a soft blur out.
- Type can **become the object it names**: the word "invoice" unfolds into an invoice; a number counts up into a stack of coins.
- No text parked at the top of the frame. Type lives where the eye already is.
- Big, clean, centred. Keynote rather than slide deck.

## Eases

| Use | Ease |
| --- | --- |
| Entrances | `expo.out`, `power3.out` |
| Moves and camera | `power2.inOut`, `power3.inOut` |
| Exits | `power2.in`, short |
| Character squash and stretch | `back.out`, elastic, overshoot: **character only** |

- No linear moves (except constant drifts and rotations meant to feel mechanical).
- No overshoot on UI. Premium product films almost never overshoot UI.
- Overlap tweens: the next one starts before the previous one ends.

## Motion texture can tell the story

Frame rate is a storytelling tool. A problem half where props move **on twos** (sampled at 12 poses per second with a tiny hand-placed jitter, like tabletop stop motion) while the camera stays smooth, then a product half where everything moves smoothly on ones, lets the audience feel the world get cleaner without being told. The starter engine does this with `PLAN.smoothFrom` (see `starter/README.md`).

## Transitions

**Every cut gets a named transition in `SHOTLIST.md`.** When one scene flows into the next, the viewer accepts that it belongs there.

In order of preference:

1. **Match cut.** The outgoing key object becomes the incoming one: same position, scale or shape. A notification badge becomes a calendar date; a search box becomes the product's search.
2. **Camera through.** The camera pushes into an element (a button, a word, a dot) until it fills the frame, and the next scene is inside it. A little motion blur helps.
3. **Morph.** One object reshapes into the next (a card unfolds into a page).
4. **The world's native transition.** Whatever belongs to the chosen world (a slide-projector click, a page turn, a stamp). List them in `DESIGN.md` and use only those.
5. **Soft fade or light sweep**, as a fallback.

Avoid:

- Black dips between shots. They make a film feel heavy and stop its momentum.
- Hard flashes and pops: things appearing with a white flash, lines vanishing, a cursor blinking out and back.
- Shader transitions (glitch, burn, iris, whip) picked for energy. They also tend to drop colour or canvas content during capture.
- Wipes that don't come from the world.

**Check both sides of every cut**: compare the last frame of scene N with the first frame of scene N+1 (`scripts/qa/contact_sheet.py --around <cut times>`). A match cut that is 20 px off reads as a jump.

## Crescendos

Mark 2 or 3 moments in the script that must feel like an event. Each one gets:

1. **A setup**: stillness, darkness, a held breath, the music thinning out.
2. **A hit**: one decisive visual (a stamp, a light switching on, the logo landing) on a music accent.
3. **One sound**, tuned to the music.
4. **At least one second of air** after it.

Without the setup and the air, a big moment just happens and nobody notices it.

## Pacing

- **Burst, then hold.** After each key beat, 0.4 to 0.8 s of stillness or slow drift before the next move.
- **At least 0.4 s** from the end of a voice line to the next visual change, or the scene cuts away before the thought has landed.
- **No dead air in explainer sections.** A gap over about 1.5 s with no voice and no purposeful motion feels empty. Air goes after hits, not in the middle of an explanation.
- **Give short claims room.** Several features shown in quick succession blur into nothing; each needs time for its animation to land.

## Cursors and actions

- Measure cursor targets from the DOM. A cursor that misses its button reads as a bug.
- Actions finish. If the cursor goes to a button, the button gets pressed, changes state, and the result appears.
- Clicks have a press (the button moves 1 to 2 px and darkens) and usually a sound.

## Hooks

The first 1 to 3 seconds must work muted: one strong image of the effect (the pain happening), moving, readable without sound, and ideally hinting at the structure to come (a freeze, a rewind, a countdown).
