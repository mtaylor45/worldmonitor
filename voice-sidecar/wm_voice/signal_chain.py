"""Post-TTS signal chain.

Layer 4 of docs/VOICE-CHARACTER.md. The voice comes from a panel in a room, not
from a studio: band-limit it, level it, and put it in a small space.

This is a handful of ffmpeg filters, not a model. On the NUC it runs far faster
than real time, so it costs nothing perceptible.
"""

from __future__ import annotations

import asyncio
import shutil

# Each stage earns its place:
#
#   highpass 180 / lowpass 7k  the whole trick. Removes chest resonance and air,
#                              which is what separates "voice in the room" from
#                              "voice from a speaker".
#   +3 dB at 3 kHz             presence lift for intelligibility across a room.
#                              Matters more than it sounds like on a small driver.
#   acompressor                consistent level regardless of phrase length.
#   aecho                      a short slap standing in for a small room. Subtle:
#                              if you can clearly hear it, it is too wet.
#   loudnorm                   stable perceived volume across every response.
FILTERS = (
    "highpass=f=180,"
    "lowpass=f=7000,"
    "equalizer=f=3000:t=q:w=1.2:g=3,"
    "acompressor=threshold=-18dB:ratio=3:attack=5:release=120,"
    "aecho=0.8:0.88:24:0.07,"
    "loudnorm=I=-16:TP=-1.5:LRA=7"
)

# Some engines synthesize breath intake. The ship's computer does not breathe.
GATE = "agate=threshold=0.02:ratio=4:attack=1:release=40"


def available() -> bool:
    return shutil.which("ffmpeg") is not None


async def process(wav: bytes, *, gate_breath: bool = False) -> bytes:
    """Runs the chain over a WAV buffer.

    Returns the input unchanged when ffmpeg is absent. A kiosk that loses its
    signal chain should sound wrong, not go silent - an unprocessed voice is
    still a working assistant, and this is the layer that matters least of the
    four.
    """
    if not available():
        return wav

    chain = FILTERS + ("," + GATE if gate_breath else "")
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-i", "pipe:0", "-af", chain, "-f", "wav", "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate(wav)
    if proc.returncode != 0 or not out:
        # Falling back to the raw audio is the right failure: the response still
        # gets spoken, it just sounds like a podcast instead of a panel.
        raise RuntimeError("ffmpeg signal chain failed: " + err.decode(errors="replace")[:200])
    return out
