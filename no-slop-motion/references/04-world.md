# Gate 4: World and style frames

"Vibe coded" is the most common reaction to an AI-made film, and visual style is usually the layer that takes the most rounds. It gets fixed when the look comes from the story's feeling instead of from a list of effects. A coherent world gives every choice a reason, which is the opposite of vibe coded.

## Pitch 2 or 3 worlds

A world is a one-line concept plus the rules that follow from it. It comes from the story's emotion, the music's feel, or the brand's history, never from "what would look cool".

Pitch each as:

- **One line.** For example: "The problem half is a cramped 1970s back office of carbon-copy forms and rubber stamps; the product arrives in clean brand colour and everything goes digital."
- **Why it fits.** "The pain is paperwork, and the music has a dusty, analogue feel."
- **Native objects.** Carbon-copy forms, an in-tray, a rubber stamp, a rotary phone.
- **Native transitions.** A form sliding through a typewriter platen, a stamp coming down to cut, a slide-projector click.
- **One style frame**, drawn in HTML at full resolution.

Other shapes a world can take: a nature documentary (the product as a creature in its habitat), a heist blueprint, a lab notebook, a weather report, a sports broadcast. The test is whether the decision maker recognises it and whether the story's problem and fix both have natural objects in it.

Let the decision maker pick. A concept the agent invented alone tends to get polite interest and then get dropped.

**References are feelings, not filters.** "Vintage" rendered as a greyscale filter looks cheap. What works is hand-picked warm greys, real grain that moves, period-appropriate type, and a clean modern caption face.

## Five style frames

For the chosen world, build five stills at full resolution before animating anything:

1. The problem world (the hook frame).
2. The villain.
3. The turn (the product's arrival).
4. The product UI in the film's style.
5. The end card.

Show them as one contact sheet. It is the fastest artefact for a decision maker to judge, and changing a still is far cheaper than changing an animated scene.

## `DESIGN.md`

Fill [../templates/DESIGN.md](../templates/DESIGN.md) for the chosen world. The parts that matter most:

### Colour has meaning

Write down what each colour *means*, not just its hex.

- **Hold the brand colour back until the turn.** A problem half in a muted palette with one accent for problem markers, then the brand colour appearing first on the hero (see [05-hero.md](05-hero.md)) and spreading outward into the product world. The turn lands because the whole palette turns with it.
- One accent per shot.
- Author the palette in real colours. Don't fake a muted world with CSS filters; they look cheap and break some capture paths.
- Sample brand colours from the logo file and the live site.

### Type has jobs

At most 3 or 4 typefaces, one job each. For example: a display face for headlines, the brand font for statements, the product's UI font inside UI only, one caption face. Take the brand font from the live site. Novelty fonts (distressed, handwritten, "techy") are the fastest way to look amateur.

### Texture

Grain makes code-drawn frames feel filmed. Keep it moving, deterministic (seeded by frame number), and subtle in the clean half. Match the texture to the world (halftone on printed things, flicker for old film), and strip most of it after the turn.

### Depth

Containers (cards, notifications, emails, panels) get a 1px border and no shadow, like real product UI. Only buttons get depth: they are the one thing on screen that is pressed. Hard offset "brutalist" shadows on every card are tiring to look at.

### Motifs

List 3 to 5 things only this brand owns and say how each is used. Use motifs freely, not literally: a brand's texture used as a subtle accent works, while the same texture forced into the plot usually doesn't. See [05-hero.md](05-hero.md) if the brand has no mascot.

### Banned list

Copy the default banned list from `SKILL.md`, then add everything from `LOVES-HATES.md`. Add the project-specific entries to `slop.config.json` so `scripts/qa/lint-slop.ts` catches them.

## UI in the film

- **Every UI object is HTML, not a screenshot.** Code-drawn UI stays sharp at any zoom and can be animated piece by piece. Real brand marks as SVG paths are fine.
- **Fidelity makes it instant.** Emails need a sender, subject, preview and time. Slack must look like Slack, a bank app like a bank app. Build from the product's real CSS and copy and compare side by side.
- **Floating elements, not dashboards.** Pull one component out of the product and put it alone on a calm background. Build it up piece by piece.
- **One brand-coloured call to action per frame.**
- **A "screenshot" in the story must read as one**: a shutter flash, window chrome, a frame.

## Lock

The decision maker approves the contact sheet of five frames and `DESIGN.md`.
