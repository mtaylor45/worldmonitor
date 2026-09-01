"""Tool registry: what the assistant can actually do.

Two kinds, and the split matters.

**UI tools** dispatch an action to the dashboard over the WebSocket. They are
the P3 boundary already built - the model names one, this module checks it
against the action registry the dashboard published, and the dashboard checks
it again before anything happens.

**Data tools** call World Monitor's own HTTP API and return a small structured
result. This is what keeps the prompt small: rather than pushing the whole
dashboard into every turn, the model asks for the one thing it needs.

Every data tool below is bound to an endpoint that exists. The paths were read
out of `proto/worldmonitor/**/service.proto` and their `sebuf.http.config`
annotations, not invented - the same discipline as "a rail button must name a
panel upstream actually renders". A tool that returns nothing is worse than an
absent one, because the model will keep choosing it.
"""

from __future__ import annotations

import asyncio
import json
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

# How long a data tool may take before the turn gives up on it. The whole turn
# has a few seconds; a tool that has not answered in two is not going to save
# the response.
TOOL_TIMEOUT_S = 2.0

# Results are trimmed hard before they reach the model. A tool that returns
# forty conflicts costs prompt tokens twice - once to process, once in the
# latency budget - and the model only ever speaks two or three of them.
MAX_ITEMS = 5


@dataclass
class Tool:
    """One callable capability."""

    name: str
    description: str
    #: JSON-schema properties for the arguments, keyed by name.
    parameters: dict[str, Any] = field(default_factory=dict)
    required: list[str] = field(default_factory=list)
    #: UI tools carry the action they dispatch; data tools carry a fetcher.
    action: str | None = None
    fetch: Callable[[dict[str, Any]], Awaitable[Any]] | None = None

    @property
    def is_ui(self) -> bool:
        return self.action is not None

    def schema(self) -> dict[str, Any]:
        """OpenAI / Ollama tool schema. Generated, never hand-maintained."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": self.parameters,
                    "required": self.required,
                },
            },
        }


# --------------------------------------------------------------------- data


class WorldMonitorApi:
    """Thin client for World Monitor's own HTTP API.

    urllib rather than a client library: these are GETs to a host on the same
    machine, and the kiosk image should not carry an HTTP stack for it.
    """

    def __init__(self, base_url: str) -> None:
        self._base = base_url.rstrip("/")

    async def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        query = "?" + urllib.parse.urlencode(params) if params else ""
        url = self._base + path + query

        def _run() -> Any:
            request = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=TOOL_TIMEOUT_S) as handle:
                return json.loads(handle.read())

        return await asyncio.to_thread(_run)


def trim(value: Any, limit: int = MAX_ITEMS) -> Any:
    """Cuts a response down to what a spoken answer can actually use.

    Lists are truncated; dicts keep their scalar fields and drop nested
    structure. The model is summarising for speech, not rendering a table, and
    every field it does not speak is latency it spent for nothing.
    """
    if isinstance(value, list):
        return [trim(item, limit) for item in value[:limit]]
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if isinstance(item, (str, int, float, bool)) or item is None:
                out[key] = item
            elif isinstance(item, list):
                out[key] = [trim(i, limit) for i in item[:limit]]
        return out
    return value


def data_tools(api: WorldMonitorApi) -> list[Tool]:
    """Data tools, each bound to a verified World Monitor endpoint.

    Paths come from the `sebuf.http.config` annotations in
    `proto/worldmonitor/**/service.proto`. If an endpoint moves, this list is
    where it moves - one file, not scattered through prompts.
    """
    return [
        Tool(
            name="get_region_status",
            description="Current situation snapshot for a world region.",
            parameters={
                "region": {
                    "type": "string",
                    "description": "Region name, e.g. 'Middle East', 'Asia-Pacific'.",
                }
            },
            required=["region"],
            fetch=lambda args: api.get(
                "/api/intelligence/v1/get-regional-snapshot", {"region": args["region"]}
            ),
        ),
        Tool(
            name="get_region_brief",
            description="Short intelligence brief for a world region.",
            parameters={"region": {"type": "string", "description": "Region name."}},
            required=["region"],
            fetch=lambda args: api.get(
                "/api/intelligence/v1/get-regional-brief", {"region": args["region"]}
            ),
        ),
        Tool(
            name="get_country_risk",
            description="Instability and risk scores for one country.",
            parameters={
                "country": {"type": "string", "description": "Country name or ISO code."}
            },
            required=["country"],
            fetch=lambda args: api.get(
                "/api/intelligence/v1/get-country-risk", {"country": args["country"]}
            ),
        ),
        Tool(
            name="get_market_quotes",
            description="Current market quotes.",
            parameters={},
            fetch=lambda args: api.get("/api/market/v1/list-market-quotes"),
        ),
        Tool(
            name="get_cyber_threats",
            description="Recent cyber threat activity.",
            parameters={},
            fetch=lambda args: api.get("/api/cyber/v1/list-cyber-threats"),
        ),
    ]


# ----------------------------------------------------------------------- ui


def ui_tools(actions: list[str], panels: list[str]) -> list[Tool]:
    """UI tools, generated from what the dashboard published.

    Nothing is offered that the dashboard did not say it supports. Before the
    first context frame arrives this returns an empty list, so the model may
    request nothing - deliberately, since acting on a dashboard it has never
    seen is worse than refusing.
    """
    available = set(actions)
    tools: list[Tool] = []

    if "panel.focus" in available:
        tools.append(
            Tool(
                name="focus_panel",
                description="Bring a dashboard panel into view and highlight it.",
                parameters={
                    "panel": {
                        "type": "string",
                        "description": "Panel key.",
                        # The enum is the actual panel list. A model offered a
                        # key the dashboard does not render would dispatch,
                        # do nothing, and look like a broken display.
                        "enum": panels,
                    }
                },
                required=["panel"],
                action="panel.focus",
            )
        )
    if "map.focus" in available:
        tools.append(
            Tool(name="focus_map", description="Bring the world map into view.", action="map.focus")
        )
    if "theme.cycle" in available:
        tools.append(
            Tool(
                name="cycle_theme",
                description="Switch to the next display theme.",
                action="theme.cycle",
            )
        )
    return tools


# ------------------------------------------------------------------ registry


class ToolRegistry:
    """Everything the model may call this turn."""

    def __init__(self, api: WorldMonitorApi | None = None) -> None:
        self._data = data_tools(api) if api else []
        self._ui: list[Tool] = []

    def update(self, snapshot: dict[str, Any]) -> None:
        """Rebuilds the UI tools from the dashboard's latest snapshot."""
        self._ui = ui_tools(
            list(snapshot.get("actions") or []),
            [str(p.get("key")) for p in snapshot.get("panels") or [] if p.get("key")],
        )

    @property
    def all(self) -> list[Tool]:
        return [*self._ui, *self._data]

    def get(self, name: str) -> Tool | None:
        return next((t for t in self.all if t.name == name), None)

    def schemas(self) -> list[dict[str, Any]]:
        """Tool schemas for a model that supports native tool calling."""
        return [t.schema() for t in self.all]

    def describe(self) -> str:
        """Compact text listing, for a model without native tool calling.

        The same registry through a different door: a model that cannot take a
        tool schema is told the same things in prose, and its answer goes
        through the same validation.
        """
        lines = []
        for tool in self.all:
            args = ", ".join(tool.parameters)
            lines.append("- " + tool.name + "(" + args + "): " + tool.description)
        return "\n".join(lines)

    async def call(self, name: str, arguments: dict[str, Any]) -> tuple[bool, Any]:
        """Executes a data tool. Returns (ok, result).

        UI tools are NOT executed here - they are dispatched to the dashboard,
        which validates them again. This method refusing to run them is what
        keeps the two paths from quietly merging.
        """
        tool = self.get(name)
        if tool is None:
            return False, "unknown tool: " + name
        if tool.is_ui:
            return False, "ui tool must be dispatched, not called"
        if tool.fetch is None:
            return False, "tool has no implementation"

        missing = [key for key in tool.required if not arguments.get(key)]
        if missing:
            return False, "missing argument: " + ", ".join(missing)

        try:
            result = await asyncio.wait_for(tool.fetch(arguments), timeout=TOOL_TIMEOUT_S)
        except asyncio.TimeoutError:
            # A slow tool is a failed turn, not a hung assistant.
            return False, "timed out"
        except Exception as exc:  # noqa: BLE001 - any transport failure is the same to us
            return False, str(exc) or exc.__class__.__name__

        return True, trim(result)
