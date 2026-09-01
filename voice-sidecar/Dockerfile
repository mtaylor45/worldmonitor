# Voice sidecar for LCARS World Monitor.
#
# Runs beside the dashboard on the kiosk, never remotely. It owns the whole
# audio loop - microphone, wake word, recognition, synthesis, playback -
# because kiosk Chromium makes microphone permissions painful and the browser
# adds nothing to that path (SCOPE.md §3).
#
#   docker build -t wm-voice voice-sidecar/
#   docker run --rm --device /dev/snd --network host wm-voice
#
# --device /dev/snd and --network host are both load-bearing: the container
# needs the real audio devices, and Ollama plus the dashboard are on localhost.

FROM python:3.11-slim

# ffmpeg for the post-TTS signal chain (docs/VOICE-CHARACTER.md layer 4);
# libportaudio2 for sounddevice's capture path.
RUN apt-get update \
 && apt-get install --no-install-recommends -y ffmpeg libportaudio2 libsndfile1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Requirements first so a code change does not re-resolve a multi-hundred-MB
# dependency tree on a machine whose upstream link is a home connection.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY wm_voice ./wm_voice

# Models land here. Mount a volume or the container re-downloads several
# hundred megabytes on every start.
ENV HF_HOME=/models \
    WM_VOICE_HOST=0.0.0.0 \
    WM_VOICE_PORT=8765
VOLUME ["/models"]

EXPOSE 8765

# No healthcheck on the socket alone: an open port proves the process is up,
# not that the microphone is readable or the model loaded, and a green check
# that means neither is worse than none.
CMD ["python", "-m", "wm_voice"]
