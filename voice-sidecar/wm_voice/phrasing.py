"""Phrasing layer - the register of the ship's computer.

`docs/VOICE-CHARACTER.md` is explicit that this is Layer 1 and carries the most
effect for the least cost: if the *words* are right it reads as the computer
before any audio tuning at all. It is also the layer a language model will drift
away from over a long session, which is why the rules are enforced here rather
than trusted to a system prompt.

The contract is deliberately narrow. `validate()` says whether a candidate
response is in register; `speakable()` prepares an accepted response for TTS.
Nothing here talks to a model, a socket, or an audio device, so all of it is
testable without hardware - which matters, because almost nothing else in the
voice pipeline is.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ---------------------------------------------------------------- violations

# Straight and typographic apostrophes both, because a model emits either.
CONTRACTIONS = re.compile(r"\b\w+['’](?:s|t|re|ve|ll|d|m)\b", re.IGNORECASE)

# "I" at the start of a sentence. The computer has no first person; this single
# rule does more work than any other on the list.
FIRST_PERSON = re.compile(r"(?:^|(?<=[.!?]\s))\s*I\b")

# Hedges and pleasantries.
BANNED_PHRASES = (
    "sorry",
    "apologies",
    "unfortunately",
    "happy to",
    "feel free",
    "let me know",
    "great question",
    "of course",
    "certainly",
    "i think",
    "i believe",
    "i would suggest",
    "it seems",
    "it looks like",
    "probably",
    "might be",
    "would you like",
)

# The one question the computer is allowed to ask.
ALLOWED_QUESTION = "please specify"

MAX_SENTENCES = 2

# Canonical responses. A rejected generation falls back to one of these rather
# than being re-prompted forever: a fixed template in the right register beats a
# fluent sentence in the wrong one.
TEMPLATES = {
    "working": "Working.",
    "acknowledged": "Acknowledged.",
    "unavailable": "That information is not available.",
    "refused": "Unable to comply.",
    "ambiguous": "Please specify.",
    "affirmative": "Affirmative.",
    "negative": "Negative.",
}


@dataclass
class Verdict:
    """Outcome of validating one candidate response."""

    ok: bool
    reasons: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:  # pragma: no cover - trivial
        return self.ok


def split_sentences(text: str) -> list[str]:
    """Splits on terminal punctuation.

    A decimal point must not end a sentence - "61.4" is one number, not two
    sentences - so the decimal point is swapped for a sentinel while splitting
    and restored afterwards.

    The sentinel is a private-use codepoint rather than a space: a space is a
    character real responses genuinely contain, so using one would corrupt any
    text with a space next to a number.
    """
    sentinel = "\ue000"
    protected = re.sub(r"(?<=\d)\.(?=\d)", sentinel, text)
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", protected) if p.strip()]
    return [p.replace(sentinel, ".") for p in parts]


def validate(text: str) -> Verdict:
    """Checks a candidate response against the register.

    Every rule here is one a model will violate eventually, and each failure is
    reported separately so a caller can log *why* a generation drifted rather
    than only that it did.
    """
    reasons: list[str] = []
    stripped = text.strip()

    if not stripped:
        return Verdict(False, ["empty response"])

    sentences = split_sentences(stripped)
    if len(sentences) > MAX_SENTENCES:
        reasons.append(f"{len(sentences)} sentences, maximum is {MAX_SENTENCES}")

    if "!" in stripped:
        reasons.append("exclamation mark")

    if "?" in stripped and ALLOWED_QUESTION not in stripped.lower():
        reasons.append("question mark outside 'Please specify'")

    if FIRST_PERSON.search(stripped):
        reasons.append("sentence begins with 'I'")

    if CONTRACTIONS.search(stripped):
        reasons.append("contraction")

    lowered = stripped.lower()
    for phrase in BANNED_PHRASES:
        if phrase in lowered:
            reasons.append("banned phrase: " + repr(phrase))

    return Verdict(not reasons, reasons)


# ------------------------------------------------------------------ numerals

ONES = (
    "zero one two three four five six seven eight nine ten eleven twelve "
    "thirteen fourteen fifteen sixteen seventeen eighteen nineteen"
).split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def _under_thousand(n: int) -> str:
    if n < 20:
        return ONES[n]
    if n < 100:
        tens, unit = divmod(n, 10)
        return TENS[tens] + ("-" + ONES[unit] if unit else "")
    hundreds, rest = divmod(n, 100)
    out = ONES[hundreds] + " hundred"
    return out + " " + _under_thousand(rest) if rest else out


def number_to_words(value: str) -> str:
    """Renders a numeral as words.

    Engines disagree on how they read numerals - some spell digits, some read
    "61.4" as "sixty-one point four", some as "sixty-one four" - so the text
    handed to TTS carries words, not digits, and the ambiguity never arises.
    """
    negative = value.startswith("-")
    body = value.lstrip("-").replace(",", "")

    whole, _, frac = body.partition(".")
    number = int(whole)

    scales = ((1_000_000_000, "billion"), (1_000_000, "million"), (1_000, "thousand"))
    parts: list[str] = []
    for size, name in scales:
        if number >= size:
            count, number = divmod(number, size)
            parts.append(_under_thousand(count) + " " + name)
    if number or not parts:
        parts.append(_under_thousand(number))

    words = " ".join(parts)
    if frac:
        # Digits after the point, which is how a reading is spoken aloud:
        # "sixty-one point four", never "sixty-one point forty".
        digits = " ".join(ONES[int(d)] for d in frac)
        words = words + " point " + digits
    return "negative " + words if negative else words


# Identifiers keep their digits - a panel key or a callsign read as a cardinal
# number is unrecognisable. Anything with an adjacent letter or hyphen stays.
NUMERAL = re.compile(r"(?<![\w-])-?\d[\d,]*(?:\.\d+)?(?![\w-])")


def speakable(text: str) -> str:
    """Prepares an accepted response for TTS.

    Numerals become words and the percent sign is spoken, because "61.4%" is
    read differently by every engine and identically by none of them.
    """
    out = re.sub(r"(\d)\s*%", r"\1 percent", text)
    return NUMERAL.sub(lambda m: number_to_words(m.group(0)), out)


def enforce(candidate: str, fallback: str = TEMPLATES["unavailable"]) -> tuple[str, Verdict]:
    """Returns the response to speak, and the verdict on the candidate.

    A rejected candidate is replaced by `fallback` rather than re-prompted here:
    the retry belongs to the caller, which knows whether it still has budget
    inside the three-second latency target. This never returns out of register.
    """
    verdict = validate(candidate)
    return (candidate.strip() if verdict.ok else fallback), verdict
