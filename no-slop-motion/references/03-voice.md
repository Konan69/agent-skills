# Gate 3: Voice

Narration is the cheapest route to understanding, and once it is recorded it sets the clock for everything else. Films timed to the voice feel natural; films whose voice is squeezed to fit the picture feel stitched.

## Casting

- **One narrator.** Keeping two voices in parallel doubles the work and splits the decision. Cast once and commit.
- Render **one act in 2 or 3 voices** and let the decision maker pick. Pick for character, not polish.
- Keep the voice ID and model in `BRIEF.md`.

## Record acts, not lines

**Never generate one line at a time and stitch the lines together.** Separately generated lines don't share a breath, a pitch contour or a pace, so stitched together they sound robotic.

Instead, record each act from `SCRIPT.md` as one continuous take, several times, with different direction:

```bash
CARTESIA_API_KEY=... npx tsx scripts/audio/tts-cartesia.ts voice/lines.json --out voice/takes
```

`lines.json` lists the acts, each with 2 or 3 takes at different emotion and speed settings. See the header of `tts-cartesia.ts` for the format. Generation is not deterministic, so repeated takes with the same direction still differ.

### Direction that works

- Give each act an emotion that serves the story: frustrated in the pain, curious in the investigation, warm and confident after the turn.
- Emotion labels are coarse. "Sarcastic" often comes out as shouting, and irony is easy to lose. Try two or three labels for the same line and judge the reading, not the label.
- Listen for stress on the key words. If it lands in the wrong place, rephrase or change the punctuation until it doesn't.
- Spell brand names phonetically in the TTS text if the model mispronounces them, and map them back for captions.

## Score, then listen

```bash
python3 scripts/audio/score_takes.py voice/takes/takes.json --out voice/scores.json
```

It ranks takes by word accuracy (transcribed back and compared to the script), emotional dimensions (arousal, valence, dominance), pitch range and pace. A narrow pitch range is the numeric signature of a flat, robotic read. The ranking is a shortlist: listen to the top two of each act and choose.

## Split only in silence

The film needs each act as separate pieces (one per caption line or picture beat). Splitting is where voice most often breaks: transcription word end-times run early, and the quietest point near a word boundary is often a consonant closure inside a word, so a naive cut leaves half a word at the head of the next piece.

```bash
python3 scripts/audio/split_takes.py voice/split.json --scores voice/scores.json --out-dir assets/audio/vo
```

The rules it enforces:

- Cut only inside a real pause (at least 150 ms continuously quiet), with margin on both sides.
- If a boundary has no real pause, fail rather than guess. Re-record with a clearer full stop, or merge the two pieces.
- Re-transcribe every piece and require it to read back as exactly its text.
- Sentences are indivisible. Clauses that belong together ("it syncs with your bank, so every payment matches itself") stay in one piece and play as one breath.

## Retime the picture to the voice

Place the pieces at the spacing they were recorded with. Squeezing the gaps to fit a shot is audible immediately. If a shot needs more time, add a hold after the line, not a gap inside it.

Write the onset of every piece into the starter's timing table (`assets/js/plan.js`, `PLAN.vo`) and the word timings into `assets/js/vo-data.js`. Scenes then anchor their beats to words, so retiming a line moves every beat attached to it (see `starter/README.md`).

## Captions

Build captions from the final audio's word timestamps, never from the script text and a guess.

- One style for the whole film, word by word, on a strip, no shadow on text that already sits on a strip.
- Each line replaces the previous one. No overlaps.
- Clamp each caption to the speech onset, not the file start (files have leading silence).
- Normalise digits against words ("19 days" in one line, not "19" and "days" split apart).
- Reserve a caption band (for 1080p, roughly the bottom 120 to 160 px) and keep every important object above it.
- Where the words are already on screen as kinetic type, turn the caption off for that line.

## Lock

The VO timeline: every piece placed, `plan.js` and `vo-data.js` filled, and the decision maker has heard the whole narration in order.
