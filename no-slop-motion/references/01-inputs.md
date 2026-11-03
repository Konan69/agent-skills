# Gate 0: Inputs

Collect everything real before making anything. Most weak choices in an AI-made film are gaps in this pack that the agent filled by guessing: a font taken from an outdated brand doc, a track picked for "energy", a claim that implies more automation than the product has.

## The input pack

Put these in the project's `inputs/` folder and summarise them in `BRIEF.md`.

### Brand truth, taken from production

- **Logo files** (SVG) and, if there is one, the mascot's canonical source image. Sample colours from these files, not from a brand doc.
- **Fonts and colours from the live marketing site.** Open the site, read the computed styles, download the font files if the licence allows. Internal brand docs go stale; the live site is what customers see.
- **The product's real CSS and copy** for any UI that will appear: button labels, empty states, success messages, the exact wording of a notification. Real copy is funnier and more believable than invented copy.
- **Existing brand assets that carry personality**: a success animation, a 404 illustration, a signature sound, a sticker the team uses. These become motifs (see [04-world.md](04-world.md)).

### Product surfaces worth filming

Walk through the product and list the moments that are good on camera: something appearing, a diff, a counter, a "published" state. Also list the moments that look bad (a slow spinner, a cramped panel, a streaming log). The bad ones get art-directed from real ingredients instead of shown raw.

### Claims

- **Whitelist**: every claim the film may make, each with its source (a marketing page, a pricing page, a case study).
- **Do-not-claim list**: things the product doesn't do, does only with review, or does only on some plans. For AI products the usual trap is autonomy: say plainly when a human approves the result.

### Platform and format

- **Where it will be posted.** X and LinkedIn autoplay muted, so the first 1 to 3 seconds must work with no sound and captions must carry the story. YouTube is watched with sound.
- **Masters and cuts.** Usually a 16:9 1920x1080 master, plus a 4:5 or 9:16 cut for feeds. Decide now, because safe areas and the caption band depend on it.
- **Length budget.** A narrated launch film that explains a platform usually lands around 90 to 120 seconds. A wordless teaser can be 20 to 50. Length follows the script, not the other way round.

### References, with what to take from each

2 to 4 films the decision maker likes. For each, write one line saying what to take and what to leave: "that film's look, not its tempo", "its opening hook, not its colour". Without this line, a reference gets copied whole or ignored.

Watch them properly: pull 2 frames per second into a contact sheet (`scripts/qa/contact_sheet.py`) and note camera moves, how type enters, how scenes hand off and how long holds last.

### Accounts ready

TTS key, music tool account, and any capture access (a seeded demo workspace, a logged-in browser). A missing TTS key tends to push a film into being wordless by default, and a narrated film is much easier to understand.

## Start `LOVES-HATES.md` now

Copy [../templates/LOVES-HATES.md](../templates/LOVES-HATES.md) and seed it with anything the decision maker has already said about taste. Update it after every message for the rest of the project.

## Lock

The input pack exists, `BRIEF.md` has the platform, length and references filled in, and `LOVES-HATES.md` is started.
