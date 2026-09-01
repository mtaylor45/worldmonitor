/**
 * The action registry — one source of truth for everything the dashboard can
 * be told to do.
 *
 * Rail buttons dispatch `wm:action` events; P3's voice layer will dispatch the
 * same events, and its Ollama tool schema is *generated* from this list rather
 * than maintained beside it (`actionToolSchema()`). That is the P3 acceptance
 * criterion — "every rail button action is also reachable by voice" — made
 * structural instead of aspirational.
 *
 * Action strings are `namespace.verb`, optionally with a colon-suffixed
 * argument: `panel.focus:cii`. The suffix form exists because a rail button
 * carries its whole instruction in one `data-wm-action` attribute; the
 * equivalent `dispatch('panel.focus', 'cii')` payload form is what the voice
 * layer will use. Both parse to the same call.
 */

import { PANEL_ATTRIBUTE } from './engine';
import { ACTION_EVENT, type ActionDetail } from './types';

/** Set on a panel the assistant or rail has just focused. Drives P4-6. */
export const FOCUS_ATTRIBUTE = 'data-wm-focus';

/** How long the focus marker stays. Long enough to see, short enough to fade. */
const FOCUS_MS = 4_000;

export interface ActionArgument {
  readonly name: string;
  readonly description: string;
  /** Live enumeration of valid values, for the generated tool schema. */
  enumerate?(): string[];
}

export interface ActionDefinition {
  readonly action: string;
  /** One line. Becomes the tool description P3 hands the model. */
  readonly summary: string;
  readonly argument?: ActionArgument;
  /** Returns false when the action could not be carried out. */
  run(argument: string | undefined): boolean;
}

/** Every panel host upstream has rendered, keyed by its `data-panel` value. */
export function panelKeys(doc: Document = document): string[] {
  return [...doc.querySelectorAll<HTMLElement>(`[${PANEL_ATTRIBUTE}]`)]
    .map((el) => el.getAttribute(PANEL_ATTRIBUTE) ?? '')
    .filter(Boolean);
}

let focusTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Brings a panel into view and marks it.
 *
 * Deliberately does NOT change which dashboard tab is active or unhide a
 * disabled panel: that would be the theme layer reaching into upstream's own
 * state, which is exactly what §4 of the plan exists to prevent. A panel the
 * user has turned off stays off, and the action reports failure so the caller
 * can play the refusal tone.
 */
function focusPanel(key: string | undefined, doc: Document = document): boolean {
  if (!key) return false;
  const panel = doc.querySelector<HTMLElement>(`[${PANEL_ATTRIBUTE}="${CSS.escape(key)}"]`);
  if (!panel) return false;

  for (const previous of doc.querySelectorAll(`[${FOCUS_ATTRIBUTE}]`)) {
    previous.removeAttribute(FOCUS_ATTRIBUTE);
  }
  panel.setAttribute(FOCUS_ATTRIBUTE, 'true');
  // Instant, not smooth. "LCARS cuts, it does not fade" — a state change was
  // a lamp switching, and a glide is a transform over time. It is also the
  // right call on an always-on panel, where ambient motion is a cost paid
  // every hour of the day.
  panel.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });

  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    panel.removeAttribute(FOCUS_ATTRIBUTE);
  }, FOCUS_MS);
  return true;
}

/** Scrolls the map into view. The map lives outside the panel grid. */
function focusMap(doc: Document = document): boolean {
  const map = doc.querySelector<HTMLElement>('#mapPanel, .map-panel, #map');
  if (!map) return false;
  map.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  return true;
}

/**
 * Builds the registry.
 *
 * Theme actions are injected rather than imported so this module stays free of
 * a cycle with `index.ts`, which imports it.
 */
/** The voice layer's surface, as the action registry needs it. */
export interface VoicePort {
  ptt(): boolean;
  readonly connected: boolean;
}

export function createActions(
  theme: {
    set(id: string): void;
    cycle(): void;
    ids(): string[];
  },
  voice?: VoicePort,
): ActionDefinition[] {
  return [
    {
      action: 'panel.focus',
      summary: 'Bring a dashboard panel into view and highlight it.',
      argument: {
        name: 'panel',
        description: 'Panel key, e.g. "cii" for Country Instability.',
        enumerate: () => panelKeys(),
      },
      run: (arg) => focusPanel(arg),
    },
    {
      action: 'map.focus',
      summary: 'Bring the world map into view.',
      run: () => focusMap(),
    },
    {
      action: 'theme.set',
      summary: 'Switch to a named theme.',
      argument: {
        name: 'theme',
        description: 'Theme id.',
        enumerate: () => theme.ids(),
      },
      run: (arg) => {
        if (!arg || !theme.ids().includes(arg)) return false;
        theme.set(arg);
        return true;
      },
    },
    {
      action: 'theme.cycle',
      summary: 'Advance to the next registered theme.',
      run: () => {
        theme.cycle();
        return true;
      },
    },
    {
      action: 'voice.ptt',
      summary: 'Start push-to-talk listening.',
      // Reports failure when there is no sidecar to talk to, rather than
      // pretending: the rail then plays the refusal tone, which is the honest
      // feedback for a button whose backend is not up. A wall panel gives no
      // other signal that voice is unavailable.
      run: () => voice?.ptt() ?? false,
    },
  ];
}

/** Splits `panel.focus:cii` into its action and argument. */
export function parseAction(raw: string): { action: string; argument?: string } {
  const at = raw.indexOf(':');
  if (at === -1) return { action: raw };
  return { action: raw.slice(0, at), argument: raw.slice(at + 1) };
}

export interface ActionRouter {
  handle(raw: string, payload?: unknown): boolean;
  /** Ollama tool definitions, generated — never hand-maintained. See P3. */
  toolSchema(): {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: 'string'; description: string; enum?: string[] }>;
      required: string[];
    };
  }[];
  dispose(): void;
}

/**
 * Listens on the shared bus and routes to the registry.
 *
 * Returns a router so callers can also invoke actions directly (P3's tool
 * executor) without going through a DOM event.
 */
export function installActions(
  actions: ActionDefinition[],
  onResult?: (action: string, handled: boolean) => void,
): ActionRouter {
  const byName = new Map(actions.map((a) => [a.action, a]));

  const handle = (raw: string, payload?: unknown): boolean => {
    const parsed = parseAction(raw);
    const definition = byName.get(parsed.action);
    if (!definition) {
      onResult?.(parsed.action, false);
      return false;
    }
    const argument = parsed.argument ?? (typeof payload === 'string' ? payload : undefined);
    let handled = false;
    try {
      handled = definition.run(argument);
    } catch {
      // An action that throws is a failed action, not a broken dashboard.
      handled = false;
    }
    onResult?.(parsed.action, handled);
    return handled;
  };

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ActionDetail>).detail;
    if (!detail || typeof detail.action !== 'string') return;
    handle(detail.action, detail.payload);
  };
  window.addEventListener(ACTION_EVENT, listener);

  return {
    handle,
    toolSchema: () =>
      actions.map((a) => {
        const properties: Record<
          string,
          { type: 'string'; description: string; enum?: string[] }
        > = {};
        if (a.argument) {
          const values = a.argument.enumerate?.() ?? [];
          properties[a.argument.name] = {
            type: 'string',
            description: a.argument.description,
            ...(values.length > 0 ? { enum: values } : {}),
          };
        }
        return {
          name: a.action.replace('.', '_'),
          description: a.summary,
          parameters: {
            type: 'object' as const,
            properties,
            required: a.argument ? [a.argument.name] : [],
          },
        };
      }),
    dispose: () => {
      window.removeEventListener(ACTION_EVENT, listener);
      clearTimeout(focusTimer);
    },
  };
}
