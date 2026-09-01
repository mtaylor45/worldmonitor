/**
 * The voice sidecar wire protocol.
 *
 * Mirrored byte-for-byte in `voice-sidecar/wm_voice/protocol.py`, and a
 * contract test in each language asserts the two agree. Two implementations of
 * one protocol in two languages is exactly the sort of thing that drifts
 * silently and then fails on the one machine nobody is sitting in front of.
 *
 * JSON over a plain WebSocket. No framing library, no schema runtime: the
 * message set is small enough to read in one screen, and a kiosk should not
 * take a dependency to move six message types across localhost.
 */

/**
 * What the assistant is doing, as far as the display is concerned.
 *
 * SCOPE.md §5 P2 names three states — idle, listening, speaking. `thinking` is
 * a deliberate addition: on this hardware there is up to three seconds between
 * end-of-speech and first audio, and showing LISTENING through it is a lie
 * while showing nothing reads as a hang. The chirp covers the first ~100 ms;
 * this covers the rest.
 */
export const VOICE_STATES = ['idle', 'listening', 'thinking', 'speaking'] as const;
export type VoiceState = (typeof VOICE_STATES)[number];

/** Messages the sidecar sends to the dashboard. */
export const SERVER_MESSAGES = ['state', 'wake', 'transcript', 'response', 'error'] as const;
export type ServerMessageType = (typeof SERVER_MESSAGES)[number];

/** Messages the dashboard sends to the sidecar. */
export const CLIENT_MESSAGES = ['hello', 'ptt', 'cancel'] as const;
export type ClientMessageType = (typeof CLIENT_MESSAGES)[number];

/** Protocol version. Bumped when a message changes shape, never for additions. */
export const PROTOCOL_VERSION = 1;

export interface StateMessage {
  type: 'state';
  state: VoiceState;
}

/**
 * Wake word detected.
 *
 * Sent the instant the detector fires, BEFORE speech recognition has produced
 * anything. Its whole purpose is that the chirp can sound immediately: that
 * latency is the only latency the user actually perceives, and everything
 * downstream can take a second.
 */
export interface WakeMessage {
  type: 'wake';
  /** Detector confidence, 0-1. Useful for tuning the threshold in the field. */
  confidence?: number;
}

export interface TranscriptMessage {
  type: 'transcript';
  text: string;
  /** False for partial hypotheses, true once recognition has settled. */
  final: boolean;
}

/** What the assistant is about to say, already through the phrasing layer. */
export interface ResponseMessage {
  type: 'response';
  text: string;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | StateMessage
  | WakeMessage
  | TranscriptMessage
  | ResponseMessage
  | ErrorMessage;

export interface HelloMessage {
  type: 'hello';
  client: 'lcars-world-monitor';
  version: number;
}

/** Push-to-talk, from the rail's LISTEN button. */
export interface PttMessage {
  type: 'ptt';
  pressed: boolean;
}

/** Abandon the current utterance and return to idle. */
export interface CancelMessage {
  type: 'cancel';
}

export type ClientMessage = HelloMessage | PttMessage | CancelMessage;

export function isVoiceState(value: unknown): value is VoiceState {
  return typeof value === 'string' && (VOICE_STATES as readonly string[]).includes(value);
}

/**
 * Narrows an untrusted frame to a known server message.
 *
 * The sidecar is on the same host and is not hostile, but it can be a version
 * behind after an update, and a malformed frame must not take out the
 * dashboard. Anything unrecognised is dropped rather than thrown.
 */
export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;

  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'state':
      return isVoiceState(message.state) ? { type: 'state', state: message.state } : null;
    case 'wake':
      return {
        type: 'wake',
        ...(typeof message.confidence === 'number' ? { confidence: message.confidence } : {}),
      };
    case 'transcript':
      return typeof message.text === 'string'
        ? { type: 'transcript', text: message.text, final: message.final === true }
        : null;
    case 'response':
      return typeof message.text === 'string' ? { type: 'response', text: message.text } : null;
    case 'error':
      return typeof message.message === 'string'
        ? { type: 'error', message: message.message }
        : null;
    default:
      return null;
  }
}
