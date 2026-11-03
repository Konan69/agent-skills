"""Mix a film's soundtrack: music bed + voiceover + the composition's SFX cue sheet.

usage:
  python3 mix.py --project <dir> --film <film.json> --out <mix.wav> [--report <report.json>]

film.json is the #film-data object that E.mount() writes and render.ts extracts:
  { duration, music: { file, gainDb, fadeOut }, vo: [{ id, onset, file, on, off }], sfx: [{ t, sfx, db, pitch?, pan? }] }
All file paths in it are relative to the project root.

What it does, and why:
  - Music (optional, PLAN.music.file) plays at a constant level (gainDb, default -3 dB) and fades out over
    the last fadeOut seconds (default 0.8). No music file: the mix is voice and SFX only.
  - Each voice take is levelled to about -16 dBFS RMS measured over its SPEECH (on..off), not over the
    whole file, so a long leading silence does not make a line louder. It is placed so its speech starts
    at `onset`. A take whose file does not exist yet is skipped with a warning: the starter renders
    before any audio exists.
  - The music ducks about 5 dB under every placed line, with 0.35 s ramps, and only there.
  - SFX come from assets/sfx/<name>.wav at the cue's dB, with optional pitch (semitones) and pan (-1..1).
    A missing SFX file is skipped with a warning.
  - The result is written as 32-bit float at 48 kHz with no limiting. render.ts then normalises loudness
    to -14 LUFS for social playback (two-pass loudnorm) and muxes it under the picture.

The report (--report) tells render.ts what was actually placed, so it can skip loudness normalisation
for an SFX-only mix (normalising a few clicks to -14 LUFS would make them painfully loud).

Requirements: numpy, soundfile, librosa (see requirements.txt).
"""
import argparse
import json
import os
import sys

import numpy as np
import soundfile as sf
import librosa

SR = 48000  # the delivery rate: mixing at it avoids a resample at the mux
VO_RMS_DB = -16.0
DUCK_DB = -5.0
DUCK_RAMP = 0.35


def warn(msg):
    print(f'! {msg}', file=sys.stderr)


def db(x):
    return 10 ** (x / 20)


def load(path, mono):
    y, _ = librosa.load(path, sr=SR, mono=mono)
    if not mono and y.ndim == 1:
        y = np.vstack([y, y])
    return y


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--project', required=True)
    ap.add_argument('--film', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--report')
    a = ap.parse_args()

    film = json.load(open(a.film))
    root = os.path.abspath(a.project)
    n = int(round(film['duration'] * SR))
    out = np.zeros((2, n), dtype=np.float64)
    missing = []

    # ---- music ------------------------------------------------------------------------------------
    music_cfg = film.get('music') or {}
    bed = np.zeros((2, n))
    has_music = False
    if music_cfg.get('file'):
        path = os.path.join(root, music_cfg['file'])
        if os.path.exists(path):
            m = load(path, mono=False)[:, :n]
            bed[:, : m.shape[1]] = m * db(music_cfg.get('gainDb', -3.0))
            fade = int(music_cfg.get('fadeOut', 0.8) * SR)
            if fade > 0:
                bed[:, n - fade :] *= np.linspace(1, 0, fade)
            has_music = True
        else:
            warn(f'music file not found, mixing without it: {music_cfg["file"]}')
            missing.append(music_cfg['file'])

    # ---- voiceover + ducking ------------------------------------------------------------------------
    duck = np.ones(n)
    ramp = int(DUCK_RAMP * SR)
    floor = db(DUCK_DB)
    vo_track = np.zeros(n)
    vo_placed = 0
    for line in film.get('vo', []):
        rel = line.get('file')
        path = os.path.join(root, rel) if rel else None
        if not path or not os.path.exists(path):
            warn(f'voice take {line["id"]} not found ({rel}); skipped')
            missing.append(rel or line['id'])
            continue
        y = load(path, mono=True)
        on, off = line.get('on', 0.0), line.get('off', len(y) / SR)
        speech = y[int(on * SR) : int(off * SR)]
        rms = np.sqrt(np.mean(speech**2)) if len(speech) else 0.0
        if rms < 1e-6:
            warn(f'voice take {line["id"]} is silent between on and off; check vo-data.js')
            continue
        y = y * (db(VO_RMS_DB) / rms)
        start = int(round((line['onset'] - on) * SR))  # where the file starts so the speech lands on onset
        i, j = max(0, start), min(n, start + len(y))
        if j <= i:
            warn(f'voice take {line["id"]} falls outside the film; skipped')
            continue
        vo_track[i:j] += y[i - start : j - start]
        vo_placed += 1
        # duck from just before the speech to just after it, with smooth ramps either side
        da = max(0, int((line['onset'] - 0.06) * SR))
        dbb = min(n, int((line['onset'] - on + off + 0.12) * SR))
        duck[da:dbb] = np.minimum(duck[da:dbb], floor)
        ra = max(0, da - ramp)
        duck[ra:da] = np.minimum(duck[ra:da], np.linspace(1, floor, da - ra))
        rb = min(n, dbb + ramp)
        duck[dbb:rb] = np.minimum(duck[dbb:rb], np.linspace(floor, 1, rb - dbb))

    out += bed * duck + vo_track  # the voice is centred: same signal in both channels

    # ---- SFX ------------------------------------------------------------------------------------------
    sfx_dir = os.path.join(root, 'assets', 'sfx')
    cache = {}
    sfx_placed = 0
    for cue in film.get('sfx', []):
        name, pitch = cue['sfx'], cue.get('pitch', 0)
        key = (name, pitch)
        if key not in cache:
            path = os.path.join(sfx_dir, f'{name}.wav')
            if not os.path.exists(path):
                if name not in missing:
                    warn(f'sfx "{name}" not found at assets/sfx/{name}.wav; its cues are skipped')
                    missing.append(name)
                cache[key] = None
            else:
                y = load(path, mono=True)
                if pitch:
                    y = librosa.effects.pitch_shift(y, sr=SR, n_steps=pitch)
                cache[key] = y
        y = cache[key]
        if y is None:
            continue
        i = int(round(cue['t'] * SR))
        if i >= n:
            continue
        j = min(n, i + len(y))
        pan = max(-1.0, min(1.0, cue.get('pan', 0)))
        # equal-power pan, scaled so a centred cue is at its authored level in each channel
        left, right = np.sqrt((1 - pan) / 2) * np.sqrt(2), np.sqrt((1 + pan) / 2) * np.sqrt(2)
        g = db(cue.get('db', -12))
        out[0, i:j] += y[: j - i] * g * left
        out[1, i:j] += y[: j - i] * g * right
        sfx_placed += 1

    # a 20 ms fade at both ends so the film never starts or stops on a click
    edge = int(0.02 * SR)
    out[:, :edge] *= np.linspace(0, 1, edge)
    out[:, -edge:] *= np.linspace(1, 0, edge)

    peak = float(np.abs(out).max()) if n else 0.0
    sf.write(a.out, out.T.astype(np.float32), SR, subtype='FLOAT')
    report = {'vo_placed': vo_placed, 'music': has_music, 'sfx_placed': sfx_placed, 'missing': missing, 'peak': round(peak, 4)}
    if a.report:
        json.dump(report, open(a.report, 'w'), indent=1)
    print(f'  mixed {vo_placed} voice lines, {sfx_placed} sfx cues, music: {"yes" if has_music else "no"}; peak {peak:.3f}')


if __name__ == '__main__':
    main()
