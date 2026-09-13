"""Preflight: does this panel actually work?

    python -m wm_voice.doctor

Every dependency this sidecar has fails *silently*. No microphone, no wake
model, a model server that is not up, an upstream API whose schema moved, alert
rules with a typo — each produces a panel that looks alive and does nothing,
on the one machine nobody is sitting in front of. That asymmetry is the whole
argument for this file: the operator is present exactly once, at install, and
absent forever afterwards.

So every check names a **remedy**, not just a verdict. "FAIL: no audio device"
is a bug report; "FAIL: no audio device — pass `--device /dev/snd` to the
container" is a fix.

The distinction between WARN and FAIL is load-bearing and deliberately strict:

  **FAIL** — the panel cannot do its job. No audio device, no model server,
  a TTS engine that cannot be built, alert rules that parsed to nothing.
  **WARN** — degraded but honest. No wake model means push-to-talk still
  works, which is a documented state rather than a fault.

Checks are injectable so the reporting logic is testable without any of the
hardware it exists to check for.
"""

from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass
from typing import Callable

from .alerts import parse_rules, parse_window, readings_from_risk_scores
from .config import CONFIG, Config

OK, WARN, FAIL = "ok", "warn", "fail"

_MARK = {OK: "  ok  ", WARN: " warn ", FAIL: " FAIL "}


@dataclass(frozen=True)
class Check:
    """One verdict, and how to act on it."""

    name: str
    status: str
    detail: str
    remedy: str = ""

    def line(self) -> str:
        out = f"[{_MARK[self.status]}] {self.name:<22} {self.detail}"
        if self.remedy and self.status != OK:
            out += "\n" + " " * 32 + "-> " + self.remedy
        return out


# ------------------------------------------------------------------- probes
#
# Each returns a Check and never raises: a preflight that crashes on the first
# problem hides every problem behind it, which is the opposite of the job.


def check_alert_rules(config: Config) -> Check:
    rules = parse_rules(config.alert_rules)
    if not rules:
        return Check(
            "alert rules",
            FAIL,
            f"nothing parsed from {config.alert_rules!r}",
            "fix WM_ALERT_RULES, e.g. '*>85, Sudan>75, Taiwan+12'",
        )
    window = parse_window(config.alert_quiet_hours)
    quiet = (
        f"{window[0].strftime('%H:%M')}-{window[1].strftime('%H:%M')}"
        if window
        else "none"
    )
    return Check("alert rules", OK, f"{len(rules)} rule(s), quiet hours {quiet}")


def check_wake(config: Config) -> Check:
    if not config.wake_model:
        return Check(
            "wake word",
            WARN,
            "no model configured; push-to-talk only",
            'train a "Computer" model — docs/VOICE-CHARACTER.md — then set WM_WAKE_MODEL',
        )
    from .wake import build_scorer  # noqa: PLC0415 - defers openwakeword

    scorer = build_scorer(config.wake_model, config.wake_framework)
    if not scorer.available:
        return Check(
            "wake word",
            FAIL,
            f"{config.wake_model!r} did not load",
            "check the path and WM_WAKE_FRAMEWORK (onnx | tflite)",
        )
    return Check("wake word", OK, f"armed at {config.wake_threshold}")


def check_audio(config: Config) -> Check:
    try:
        import sounddevice  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        return Check("audio device", FAIL, f"sounddevice unavailable: {exc}",
                     "pip install -r requirements.txt")
    try:
        default = sounddevice.query_devices(kind="input")
    except Exception as exc:  # noqa: BLE001
        return Check(
            "audio device",
            FAIL,
            f"no input device: {exc}",
            "pass --device /dev/snd to the container, and check the user is in group audio",
        )
    return Check("audio device", OK, str(default.get("name", "input")))


def check_tts(config: Config) -> Check:
    from .adapters import TTS_ENGINES  # noqa: PLC0415

    if config.tts_engine not in TTS_ENGINES:
        return Check(
            "speech engine",
            FAIL,
            f"unknown WM_TTS_ENGINE {config.tts_engine!r}",
            "known engines: " + ", ".join(sorted(TTS_ENGINES)),
        )
    return Check("speech engine", OK, f"{config.tts_engine} / {config.tts_voice}")


def _get(url: str, timeout: float = 4.0) -> object:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as handle:
        return json.loads(handle.read())


def check_llm(config: Config, fetch: Callable[[str], object] = _get) -> Check:
    url = config.llm_url.rstrip("/") + "/models"
    try:
        fetch(url)
    except Exception as exc:  # noqa: BLE001
        return Check(
            "model server",
            FAIL,
            f"{url} unreachable: {exc}",
            "make -C deploy up, and check WM_LLM_URL",
        )
    return Check("model server", OK, f"{config.llm_model} at {config.llm_url}")


def check_api(config: Config, fetch: Callable[[str], object] = _get) -> Check:
    """The dashboard API, and — more usefully — whether its schema still fits.

    A reachable API whose response shape moved is the failure mode that turns
    alerts off silently: `readings_from_risk_scores` drops what it cannot
    parse rather than false-alarming, so a schema change reads as a calm world.
    """
    url = config.api_url.rstrip("/") + "/api/intelligence/v1/get-risk-scores"
    try:
        payload = fetch(url)
    except Exception as exc:  # noqa: BLE001
        return Check(
            "dashboard API",
            FAIL,
            f"{url} unreachable: {exc}",
            "start the dashboard, and check WM_API_URL",
        )

    readings, trustworthy = readings_from_risk_scores(payload)
    if not readings:
        return Check(
            "dashboard API",
            FAIL,
            "reachable, but no CII readings parsed from the response",
            "upstream's schema may have moved: check readings_from_risk_scores "
            "against src/generated/client/worldmonitor/intelligence/v1/",
        )
    if not trustworthy:
        return Check(
            "dashboard API",
            WARN,
            f"{len(readings)} readings, but reported degraded or stale",
            "alerts are held until the feed recovers; this is upstream's state, not a fault",
        )
    return Check("dashboard API", OK, f"{len(readings)} CII readings")


#: Order matters: cheap and local first, so a misconfigured panel fails on the
#: typo rather than on a four-second network timeout.
PROBES: tuple[Callable[[Config], Check], ...] = (
    check_alert_rules,
    check_tts,
    check_wake,
    check_audio,
    check_llm,
    check_api,
)


def run(config: Config = CONFIG, probes: tuple = PROBES) -> list[Check]:
    checks: list[Check] = []
    for probe in probes:
        try:
            checks.append(probe(config))
        except Exception as exc:  # noqa: BLE001
            checks.append(
                Check(getattr(probe, "__name__", "check"), FAIL, f"probe raised: {exc}")
            )
    return checks


def report(checks: list[Check]) -> str:
    lines = [c.line() for c in checks]
    failed = [c for c in checks if c.status == FAIL]
    warned = [c for c in checks if c.status == WARN]

    lines.append("")
    if failed:
        lines.append(f"{len(failed)} check(s) failed. The panel will not work correctly.")
    elif warned:
        lines.append(f"Ready, with {len(warned)} degraded capability.")
    else:
        lines.append("Ready.")
    return "\n".join(lines)


def main() -> int:
    checks = run()
    print(report(checks))
    return 1 if any(c.status == FAIL for c in checks) else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
