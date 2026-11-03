"""Cut a film's music out of a song, on the song's bar grid.

    uv run --with numpy --with imageio-ffmpeg python3 scripts/audio-edit.py src/videos/<name>/edit.json

Segments are song bars, so every cut lands on a downbeat and the film's beat
grid runs straight through the joins. Each cut gets a 5 ms fade so nothing
clicks; the end fades out.
Bars are 1-based since 2026-10-22. Add 1 to every numeric fromBar/toBar in
older 0-based edit.json files; keep "start" unchanged.
"""

import json
import subprocess
import sys
import wave

import imageio_ffmpeg
import numpy as np

SR = 48000
FADE = int(0.005 * SR)


def decode(path):
    out = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", path, "-ac", "2", "-ar", str(SR),
         "-f", "s16le", "-acodec", "pcm_s16le", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(out, dtype=np.int16).reshape(-1, 2).astype(np.float32) / 32768.0


def main():
    edit = json.load(open(sys.argv[1]))
    for segment in edit["segments"]:
        for key in ("fromBar", "toBar"):
            value = segment[key]
            if value != "start" and value < 1:
                sys.exit(f'{key}={value}: bars are 1-based since 2026-10-22: bar 1 is the first downbeat. Add 1 to every numeric fromBar/toBar in old 0-based edit.json files; keep "start" unchanged.')
    song = decode(edit["source"])
    bar = 60 / edit["bpm"] * 4

    def at(value):
        return 0.0 if value == "start" else edit["firstDownbeat"] + (value - 1) * bar

    pieces = []
    for segment in edit["segments"]:
        piece = song[int(round(at(segment["fromBar"]) * SR)): int(round(at(segment["toBar"]) * SR))].copy()
        ramp = np.linspace(0, 1, FADE)[:, None]
        if pieces:
            piece[:FADE] *= ramp
        piece[-FADE:] *= ramp[::-1]
        pieces.append(piece)

    film = np.concatenate(pieces)[: int(round(edit["duration"] * SR))]
    fade = int(edit["fadeOutSeconds"] * SR)
    film[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2

    with wave.open(edit["out"], "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes((np.clip(film, -1, 1) * 32767).astype(np.int16).tobytes())
    print(f"{edit['out']}: {len(film) / SR:.3f} s from {len(pieces)} segments")


if __name__ == "__main__":
    main()
