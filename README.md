LCARS World Monitor

A self-hosted, always-on situational-awareness dashboard with an LCARS-inspired interface, designed for a dedicated 1280×720 kiosk display and eventually controlled by a local voice assistant.

LCARS World Monitor is a personal fork of World Monitor, extending the upstream dashboard with a dedicated theme architecture, LCARS visual system, kiosk deployment, and a roadmap toward fully local voice interaction.

The project is designed around a simple idea:

A situational-awareness display should be something you glance at — and eventually something you can talk to — rather than another application you have to sit down and operate.

⸻

Status

Area	Status
Upstream World Monitor integration	🟢 Active
Theme engine	🟢 Complete
Default theme compatibility	🟢 Verified
LCARS theme	🟢 Implemented
LCARS bright palette	🟢 Implemented
Self-hosted fonts	🟢 Implemented
LCARS sound system	🟢 Implemented
Kiosk deployment configuration	🟡 Written / hardware verification pending
12-column panel mapping	🟡 In progress
Local voice assistant	⚪ Planned
Voice commands	⚪ Planned
Proactive alerts	⚪ Planned
Home-lab telemetry	⚪ Planned

The current implementation corresponds primarily to P0 — Foundation and the core P1 — LCARS Theme work.

See SCOPE.md for the authoritative project roadmap and acceptance criteria.

⸻

What This Project Adds

LCARS World Monitor intentionally keeps the upstream World Monitor application intact wherever possible.

The fork adds several layers around it:

🎨 Theme system

A dedicated theme engine provides an abstraction for visual themes without coupling the project to upstream’s own variant system.

Themes may change:

* Design tokens
* Typography
* Colors
* Borders
* Panels
* Navigation
* Structural chrome
* Sounds
* Other presentation behavior

The architecture is deliberately capable of supporting structurally different themes, rather than limiting themes to simple recoloring.

🖥️ LCARS interface

The first major theme recreates the visual language of the Library Computer Access and Retrieval System (LCARS) from Star Trek: The Next Generation and related Trek-era interfaces.

The implementation emphasizes the underlying design language rather than simply applying a collection of familiar colors.

Key characteristics include:

* Strong horizontal and vertical instrumentation
* Pill-shaped controls
* Large rounded structural elements
* Black separation gutters
* Compact technical typography
* High information density
* Distinct semantic alert states
* Instrument-panel rather than application-window composition

🖥️ Dedicated kiosk

The intended deployment target is a fixed 1280×720 display.

The kiosk environment is designed around:

* Chromium
* Wayland
* cage
* Ubuntu Server
* Automatic startup
* No browser chrome
* No scrollbars
* Pixel-specific layout

The initial hardware target is an Intel NUC6i7KYK “Skull Canyon”.

🎙️ Local voice assistant

The eventual voice system is designed to operate entirely on local infrastructure.

The planned pipeline is:

Microphone
    ↓
openWakeWord
    ↓
faster-whisper
    ↓
Ollama
    ↓
Action / Context System
    ↓
Text-to-Speech
    ↓
Audio Output

No cloud AI service is intended to be part of the runtime path.

The voice system will understand a structured representation of the dashboard rather than scraping the rendered DOM.

⸻

Architecture

At a high level, the system is divided into four major layers:

┌─────────────────────────────────────────────────────┐
│                  Chromium Kiosk                     │
│                                                     │
│   ┌─────────────────┐     ┌─────────────────────┐   │
│   │  Theme Engine   │     │  World Monitor      │   │
│   │                 │────▶│  Dashboard          │   │
│   │  Tokens         │     │  Globe / Feeds      │   │
│   │  Chrome         │     │  Panels / Data      │   │
│   └─────────────────┘     └─────────────────────┘   │
│             ▲                     │                 │
│             │                     ▼                 │
│             │              Context Snapshot         │
│             │                     │                 │
└─────────────┼─────────────────────┼─────────────────┘
              │                     │
              │ WebSocket           │ HTTP
              │                     │
┌─────────────┴─────────────────────┴─────────────────┐
│                Local Voice Sidecar                  │
│                                                     │
│   Wake Word → STT → Local LLM → Actions → TTS      │
│                                                     │
└─────────────────────────────────────────────────────┘

Two architectural decisions are particularly important.

The browser does not own the audio pipeline

Microphone capture, wake-word detection, speech recognition, and text-to-speech belong in the voice sidecar.

This avoids making Chromium responsible for the hardware and audio lifecycle and allows the voice system to operate independently of browser permissions.

The frontend receives voice-state events through WebSocket.

The LLM does not read the DOM

The voice system will consume a structured context snapshot describing the current dashboard state.

For example:

Dashboard
├── Current theme
├── Visible panels
├── Panel state
├── Selected geographic region
├── Alert state
├── Relevant metrics
└── Available actions

This keeps the voice interface independent of upstream HTML implementation details.

⸻

Theme Architecture

LCARS World Monitor maintains its own theme mechanism alongside the upstream World Monitor variant system.

This distinction is intentional.

Upstream’s variant system is primarily token-based and is coupled to an enumerated variant list. LCARS requires the ability to replace structural chrome and introduce behavior that cannot be represented solely through CSS custom properties.

The project therefore keeps the two systems separate.

Upstream variants
        │
        └── Continue working normally
LCARS Theme Engine
        │
        ├── Tokens
        ├── Structural chrome
        ├── Navigation
        ├── Sounds
        └── Theme behavior

The default World Monitor experience remains the baseline compatibility target.

The default theme in the LCARS theme engine is intentionally an identity theme: it contributes no visual overrides and exists primarily to validate that enabling the theme engine does not alter upstream rendering.

⸻

LCARS Theme

The LCARS theme currently provides:

* LCARS structural frame
* Left navigation rail
* Header elbow
* Footer voice indicator
* Pill-style controls
* LCARS typography
* Self-hosted Antonio font
* LCARS sound effects
* Dark LCARS palette
* Bright/high-contrast LCARS palette
* Theme switching
* Theme persistence
* Theme action bus
* Dashboard re-parenting into LCARS content chrome

The two primary palettes are:

lcars

The screen-accurate darker LCARS palette.

lcars-bright

A higher-contrast variation intended for improved readability on physical displays.

The correct palette is ultimately a hardware decision. A display that looks excellent in a browser development window is not necessarily the display that performs best at a distance on the physical kiosk.

⸻

Design Principles

The LCARS implementation follows several rules.

1. Instrumentation, not decoration

LCARS elements should communicate structure or state.

Decorative use of semantic colors weakens the interface.

In particular, the salmon/red alert color is reserved for alert conditions rather than being treated as a generic accent.

2. The 5px gutter matters

The black separation gutter is a major part of the visual language.

The interface should read as a collection of independent instrument modules rather than a conventional web page.

3. Information density is intentional

The target user should be able to glance at the display from approximately 2.5 meters.

This means:

* No unnecessarily small text
* No excessive whitespace
* Strong visual hierarchy
* High-contrast state changes
* Clear panel boundaries
* Minimal interaction required for common information

4. Structural themes must be possible

The theme engine must support more than:

--primary-color: ...
--background-color: ...

A future theme should be able to replace the entire visual chrome while continuing to consume the same World Monitor application.

⸻

Action System

Interactive operations use a centralized action bus.

Actions follow the form:

namespace.verb

Examples:

theme.set
theme.cycle
voice.ptt
panel.focus

The intent is to maintain a single source of truth for interaction.

The same action should eventually be reachable from:

* LCARS rail buttons
* Voice commands
* Other future control surfaces

This prevents the voice system and graphical UI from developing separate command implementations.

⸻

Project Structure

The fork is deliberately organized so that most new functionality lives outside upstream files.

worldmonitor/
│
├── src/
│   ├── themes/
│   │   ├── ...
│   │   └── LCARS implementation
│   │
│   ├── voice/
│   │   └── Local voice integration
│   │
│   └── context/
│       └── Structured dashboard context
│
├── public/
│   ├── fonts/
│   └── sounds/
│
├── deploy/
│   └── kiosk/
│       └── Kiosk deployment configuration
│
├── e2e/
│   └── Theme and acceptance tests
│
├── docs/
│   ├── DESIGN-SYSTEM.md
│   ├── LCARS-ASSETS.md
│   ├── P0-PORT.md
│   ├── UPSTREAM-DIFF.md
│   ├── VOICE-CHARACTER.md
│   └── WORKING-BRIEF.md
│
└── SCOPE.md

Not every directory listed above is populated by the current implementation. Some represent planned P2/P3 architecture.

⸻

Upstream Relationship

This repository is a fork of:

koala73/worldmonitor

World Monitor is actively maintained and has a large upstream history. Keeping the fork mergeable is therefore treated as a first-class engineering constraint.

The project follows these rules:

1. New functionality should live in new directories whenever possible.
2. Changes to upstream files should be limited to small, deliberate integration seams.
3. Upstream files should never be reformatted merely for style.
4. DOM attributes and hooks should be preferred over invasive upstream modifications.
5. Every upstream file touched by fork-specific functionality should be documented in docs/UPSTREAM-DIFF.md.

To configure the upstream remote:

git remote add upstream https://github.com/koala73/worldmonitor.git
git fetch upstream

The objective is to make upstream synchronization predictable rather than allowing the fork to gradually become an unmaintainable divergence.

⸻

Development Roadmap

P0 — Foundation

Status: Complete

P0 established the theme architecture and demonstrated that it could coexist with the upstream application without altering the default experience.

Completed:

* Theme engine
* Default identity theme
* Theme switching
* Theme persistence
* URL theme selection
* Action bus
* Kiosk configuration
* Theme-engine acceptance tests
* Upstream compatibility verification

The central acceptance criterion was that the default experience remain visually and structurally equivalent to upstream.

⸻

P1 — LCARS Theme

Status: In progress

Completed or substantially implemented:

* LCARS chrome
* Navigation rail
* Header and footer elements
* LCARS typography
* Self-hosted font
* Sound integration
* Two LCARS palettes
* Rail actions
* Dashboard content integration
* 1280×720 kiosk composition

Remaining work includes finalizing the 12-column panel mapping and resolving the remaining upstream header-space constraint at the fixed 1280px width.

⸻

P2 — Voice, Read Only

Status: Planned

The voice assistant will initially be read-only.

Planned pipeline:

openWakeWord
      ↓
faster-whisper
      ↓
Ollama
      ↓
TTS

Features:

* Wake word
* Push-to-talk
* Live transcript
* Voice-state indicator
* Local inference
* LCARS audio feedback
* Structured dashboard questions

Target:

Under 3 seconds from end-of-speech to first audio on CPU.

⸻

P3 — Voice Commands

Status: Planned

P3 turns the voice assistant into an actual dashboard control interface.

Commands will map onto the same action registry used by the graphical interface.

Examples:

"Computer, change the theme."
"Computer, show the Pacific."
"Computer, focus the market panel."
"Computer, listen."

The LLM should never directly manipulate application state.

Instead:

User speech
    ↓
LLM
    ↓
Validated action
    ↓
wm:action
    ↓
Application

This provides a deterministic boundary between natural-language interpretation and application control.

⸻

Future Features

The project maintains a larger P4 feature backlog, including:

1. Proactive alert states
2. Scheduled spoken briefings
3. Presence-aware attract mode
4. Conversational follow-up
5. Voice-driven map control
6. Panel focus brackets
7. Home-lab telemetry
8. PADD companion interface
9. Historical time-scrubbing
10. A second structurally different theme

The most strategically interesting future feature is proactive alerting.

A dashboard that merely displays information still requires attention.

A dashboard that recognizes significant changes and speaks to the user becomes an actual monitoring system.

⸻

Home-Lab Integration

A future version is intended to integrate with the surrounding self-hosted infrastructure.

Potential telemetry includes:

* Docker Swarm node health
* Harbor registry status
* NAS capacity
* Media services
* Application health
* Infrastructure alerts

This would allow the system to evolve from a world-news dashboard into a broader personal operations console.

For example:

“Computer, status of the compute swarm.”

could eventually produce a concise spoken response based on live infrastructure telemetry.

⸻

Kiosk Hardware

The primary target is:

Intel NUC6i7KYK “Skull Canyon”

CPU       Intel Core i7-6770HQ
Cores     4
Threads   8
GPU       Intel Iris Pro 580
Memory    32 GB
Display   1280×720
OS        Ubuntu Server 26.04 LTS
Compositor cage / Wayland
Browser   Chromium

The fixed display resolution is intentional.

This is not intended to become another responsive web application.

The primary interface is a dedicated physical instrument.

⸻

Local-First Philosophy

The project is intended to run on infrastructure controlled by the operator.

The long-term architecture avoids cloud dependencies for:

* Wake-word detection
* Speech recognition
* LLM inference
* Text-to-speech
* Dashboard control

Network access may still be required by the underlying World Monitor data sources, but the assistant and kiosk control plane are intended to remain local.

This provides:

* Privacy
* Predictable operation
* No subscription requirement for AI inference
* Independence from external AI APIs
* Better control over latency
* Continued operation when external AI services are unavailable

⸻

Testing

Theme functionality is covered by automated browser tests.

The P0 acceptance suite verifies, among other things:

* Default rendering
* Theme switching
* Theme persistence
* Repeated theme cycling
* DOM stability
* Theme-engine integration

The project treats visual regressions seriously because the target is a fixed physical display rather than an arbitrary collection of browser viewport sizes.

Future hardware acceptance testing will additionally verify:

* Readability at distance
* No horizontal overflow
* No vertical overflow
* Audio behavior
* Wake-word reliability
* CPU utilization
* End-to-end voice latency
* Long-duration kiosk stability

⸻

Documentation

The repository contains deeper documentation for specific areas of the system.

Document	Purpose
SCOPE.md	Authoritative roadmap, architecture, constraints, and acceptance criteria
docs/DESIGN-SYSTEM.md	LCARS visual and implementation specification
docs/LCARS-ASSETS.md	Asset research, licensing, and integration guidance
docs/P0-PORT.md	P0 theme-engine implementation and verification
docs/UPSTREAM-DIFF.md	Fork-specific changes to upstream files
docs/VOICE-CHARACTER.md	Voice interaction and character design
docs/WORKING-BRIEF.md	Engineering guidance and project working rules

⸻

Contributing

This is primarily a personal self-hosted project, but contributions and technical discussion are welcome.

When making changes:

Keep upstream changes small

Prefer adding functionality under:

src/themes/
src/voice/
src/context/

rather than modifying upstream components.

Preserve the default experience

Changes to the theme infrastructure should not unintentionally alter the standard World Monitor experience.

Avoid unnecessary churn

Do not reformat or reorganize upstream files unless the change is required.

Document integration seams

If an upstream file must be changed, document it in:

docs/UPSTREAM-DIFF.md

Test at the actual target resolution

The primary design target is:

1280 × 720

A feature that looks correct at a developer’s 2560×1440 monitor but fails at 1280×720 is not considered complete.

⸻

Licensing

This repository is a fork of World Monitor and is distributed under the GNU Affero General Public License v3.0 (AGPL-3.0), consistent with the upstream project’s licensing.

See the repository’s license files and upstream project for the applicable terms.

Third-party assets, fonts, sounds, and other resources may have separate licensing requirements. Only assets with appropriate licensing or redistribution rights should be included in the repository.

In particular, commercially licensed Trek fonts and proprietary franchise assets should not be copied into this project merely because they resemble the LCARS aesthetic.

The goal is an LCARS-inspired interface implemented with legally redistributable assets and original code.

⸻

Attribution

This project builds upon the work of the World Monitor project:

World Monitor
https://github.com/koala73/worldmonitor

The LCARS visual language is inspired by the fictional computer interfaces developed for the Star Trek television franchise.

This project is an independent fan/technical project and is not affiliated with or endorsed by Paramount, CBS, or the Star Trek franchise.

⸻

Project Philosophy

The final system is intended to feel less like a website and more like a piece of equipment.

It should be:

* Always available
* Quiet when nothing matters
* Visually informative at a glance
* Audible when something important changes
* Controllable without a keyboard
* Locally operated
* Deterministic where actions matter
* Easy to maintain
* Easy to synchronize with upstream

The ideal interaction is not:

Open browser → find dashboard → inspect panels → click around.

It is:

Look at the computer.

And eventually:

“Computer, status.”

⸻

Upstream Project

World Monitor

Repository

github.com/mtaylor45/worldmonitor