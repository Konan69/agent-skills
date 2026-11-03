"""Synthesize the starter's placeholder sound effects from scratch (numpy only), so the starter ships
with sound that has no licence strings attached. The output is dedicated to the public domain (CC0).

usage: python3 synth_sfx.py [out_dir]          (default: ./assets/sfx, run from the project root)

Writes three short mono 16-bit WAVs:
  click.wav   a soft UI click: a 2 ms transient plus a short resonant body (presses, ticks, landings)
  whoosh.wav  filtered noise that swells and falls away (camera pushes, things flying)
  thud.wav    a low, round hit with a falling pitch (a confirmation, a settle)

They are deliberately plain. Replace them with sounds you made or licensed for the real film; keep the
file names, or change the names used in E.sfx(...) calls to match. Everything is seeded, so running
this twice gives byte-identical files.
"""
import os
import sys

import numpy as np
import soundfile as sf

SR = 44100
rng = np.random.default_rng(7)


def t_axis(seconds):
    return np.arange(int(seconds * SR)) / SR


def one_pole_lowpass(x, cutoff_hz):
    """Lowpass with a cutoff that may change per sample (an array), which is what makes a whoosh move."""
    cutoff = np.broadcast_to(np.asarray(cutoff_hz, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def fade_edges(x, ms=3):
    """Never start or stop a sound on a non-zero sample: that is an audible click of its own."""
    n = int(ms / 1000 * SR)
    x[:n] *= np.linspace(0, 1, n)
    x[-n:] *= np.linspace(1, 0, n)
    return x


def normalise(x, peak_db=-1.0):
    return x * (10 ** (peak_db / 20) / (np.abs(x).max() + 1e-12))


def click():
    t = t_axis(0.09)
    transient = rng.standard_normal(len(t)) * np.exp(-t / 0.0015)
    body = np.sin(2 * np.pi * 2300 * t) * np.exp(-t / 0.012) * 0.6
    low = np.sin(2 * np.pi * 420 * t) * np.exp(-t / 0.02) * 0.35
    x = one_pole_lowpass(transient, 6000) * 1.4 + body + low
    return fade_edges(normalise(x))


def whoosh():
    t = t_axis(0.75)
    p = t / t[-1]
    # swell to a peak at 60 % of the length, then fall away faster than it came
    env = np.where(p < 0.6, (p / 0.6) ** 2, np.exp(-(p - 0.6) / 0.09))
    noise = rng.standard_normal(len(t))
    cutoff = 350 + 2600 * np.sin(np.pi * np.clip(p / 0.75, 0, 1)) ** 2
    x = one_pole_lowpass(one_pole_lowpass(noise, cutoff), cutoff * 1.5) * env
    return fade_edges(normalise(x, -3.0), 8)


def thud():
    t = t_axis(0.45)
    freq = 55 + 60 * np.exp(-t / 0.04)  # pitch drops from ~115 Hz to 55 Hz: reads as weight
    phase = 2 * np.pi * np.cumsum(freq) / SR
    body = np.sin(phase) * np.exp(-t / 0.11)
    knock = one_pole_lowpass(rng.standard_normal(len(t)) * np.exp(-t / 0.006), 900) * 2.0
    x = body + knock
    return fade_edges(normalise(x, -2.0), 6)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join('assets', 'sfx')
    os.makedirs(out, exist_ok=True)
    for name, fn in [('click', click), ('whoosh', whoosh), ('thud', thud)]:
        path = os.path.join(out, f'{name}.wav')
        sf.write(path, fn().astype(np.float32), SR, subtype='PCM_16')
        print('wrote', path)


if __name__ == '__main__':
    main()
