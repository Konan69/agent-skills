# Gate 8: Music and sound

## Music comes last

Cutting a film to a track first is tempting, and it usually produces a montage: dozens of cuts on the beat, too much energy, and no room for the story. Let the story set the pace.

- **Picture and voice set the clock.** Use temp music until picture lock.
- **Choose the track for the story's feeling**, not for energy. A good track can also suggest the world (see [04-world.md](04-world.md)).
- **Music makes room for the pain.** The problem act sits quieter (about 5 LU under the main groove) so the picture and voice carry it.

## AI music (Suno and similar)

- The decision maker often generates the music themselves. Give them a cue sheet with the hit points and the length, and let them generate in the style they like.
- **Extend what's liked.** Once a track is liked, only ask for continuations or extensions of it. A fresh batch of variants rarely beats the one someone already loves.
- Keep every take with its prompt and seed in `audio/music/`.

## Editing music so it sounds like one performance

Splices made anywhere make a song dip or jump and lose its continuous feel. Listeners notice even when they can't say why.

```bash
python3 scripts/music/join_on_downbeats.py --help
```

- Join only on **downbeats**, where the harmony (bass note, chroma) matches on both sides.
- Align takes by their drum transients.
- One-beat equal-power crossfades.
- **Never time-stretch** to fit a picture. Move the picture, or cut whole bars.
- Leave long spans uncut. The best score is often the liked track, extended with its own continuations and played to its real ending.

## The cue sheet

Write [../templates/CUE-SHEET.md](../templates/CUE-SHEET.md) from the locked picture: time, what happens, energy, and whether the music must hit it.

```bash
python3 scripts/music/cue_sheet.py plan.json --music music.wav
```

It checks every must-hit against the music's beats and flags misses over 0.1 s. Move the picture to the music's real accent rather than nudging the music.

**Map the song's own structure onto the story.** The strongest moments use effects that *are* the story instead of effects laid on top: a tape stop when the picture freezes, the song's own breakdown under a dark moment, the full band returning on the frame the product arrives, the biggest chord on the resolution.

## Sound effects

- **Fewer.** A sound on every landing turns into noise. Keep only sounds that help the viewer understand or feel a beat; cutting half of a first pass usually improves it.
- **Tune SFX to the track's key.** A ding, an error tone or a bell pitched to notes in the key sits inside the music instead of on top of it. `render/mix.py` supports a pitch shift per cue.
- **Snap cues to the picture.** When props move on twos, a cue must land on the frame where the pose appears, not on the tween's start, or the sound arrives before the picture.
- After mixing, listen once and delete any cue that is too loud, out of place, or explains nothing.
- Use sounds you have the rights to. Keep their sources and licences in `assets/sfx/SOURCES.md`.

## Mix levels

- Voice at about -16 dBFS RMS, music ducked under speech (about -5 dB, with 0.3 s ramps).
- Master to **-14 LUFS integrated, -1 dBTP** for social platforms.
- A constant music level otherwise. Automate only for story reasons (a dip into a dark moment before the turn).

## Lock

One full listen, start to end, with no audible splice, no cue out of place and every must-hit landing.
