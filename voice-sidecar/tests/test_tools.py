"""Tool registry tests.

The discipline these enforce: nothing is offered that the dashboard did not
publish, and a UI tool is never executed here - it is dispatched, and validated
again on the other side.
"""

from __future__ import annotations

import asyncio
import unittest

from wm_voice.tools import Tool, ToolRegistry, WorldMonitorApi, trim

SNAPSHOT = {
    "actions": ["panel.focus", "map.focus", "theme.cycle"],
    "panels": [{"key": "cii", "title": "Country Instability"}, {"key": "markets", "title": "Markets"}],
}


class FakeApi(WorldMonitorApi):
    def __init__(self, payload=None, fail: bool = False, delay: float = 0.0) -> None:
        super().__init__("http://127.0.0.1:3000")
        self.payload = payload if payload is not None else {"ok": True}
        self.fail = fail
        self.delay = delay
        self.calls: list[tuple[str, dict | None]] = []

    async def get(self, path: str, params: dict | None = None):
        self.calls.append((path, params))
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise ConnectionError("api down")
        return self.payload


class UiTools(unittest.TestCase):
    def test_only_offers_actions_the_dashboard_published(self) -> None:
        registry = ToolRegistry()
        registry.update(SNAPSHOT)
        names = [t.name for t in registry.all]
        self.assertIn("focus_panel", names)
        self.assertIn("cycle_theme", names)

        registry.update({"actions": ["map.focus"], "panels": []})
        self.assertEqual([t.name for t in registry.all], ["focus_map"])

    def test_offers_nothing_before_the_first_snapshot(self) -> None:
        # Acting on a dashboard it has never seen is worse than refusing.
        self.assertEqual(ToolRegistry().all, [])

    def test_the_panel_enum_is_the_real_panel_list(self) -> None:
        # A model offered a key the dashboard does not render would dispatch,
        # do nothing, and look like a broken display.
        registry = ToolRegistry()
        registry.update(SNAPSHOT)
        schema = registry.get("focus_panel").schema()
        enum = schema["function"]["parameters"]["properties"]["panel"]["enum"]
        self.assertEqual(sorted(enum), ["cii", "markets"])

    def test_a_ui_tool_is_never_executed_here(self) -> None:
        # It is dispatched to the dashboard, which validates it again. Running
        # it here would quietly merge the two paths.
        registry = ToolRegistry()
        registry.update(SNAPSHOT)
        ok, message = asyncio.run(registry.call("focus_panel", {"panel": "cii"}))
        self.assertFalse(ok)
        self.assertIn("dispatched", str(message))


class DataTools(unittest.TestCase):
    def test_calls_the_bound_endpoint(self) -> None:
        api = FakeApi({"region": "Taiwan", "risk": 61})
        registry = ToolRegistry(api)
        ok, result = asyncio.run(registry.call("get_region_status", {"region": "Taiwan"}))

        self.assertTrue(ok)
        self.assertEqual(result["risk"], 61)
        self.assertEqual(api.calls[0][0], "/api/intelligence/v1/get-regional-snapshot")
        self.assertEqual(api.calls[0][1], {"region": "Taiwan"})

    def test_a_missing_required_argument_is_refused_before_the_call(self) -> None:
        api = FakeApi()
        ok, message = asyncio.run(ToolRegistry(api).call("get_region_status", {}))
        self.assertFalse(ok)
        self.assertIn("missing argument", str(message))
        self.assertEqual(api.calls, [])

    def test_an_unknown_tool_is_refused(self) -> None:
        ok, message = asyncio.run(ToolRegistry(FakeApi()).call("get_warp_core", {}))
        self.assertFalse(ok)
        self.assertIn("unknown tool", str(message))

    def test_a_failing_endpoint_is_a_failed_turn_not_a_crash(self) -> None:
        ok, message = asyncio.run(
            ToolRegistry(FakeApi(fail=True)).call("get_market_quotes", {})
        )
        self.assertFalse(ok)
        self.assertIn("api down", str(message))

    def test_a_slow_endpoint_times_out(self) -> None:
        # A tool that has not answered in two seconds is not going to save the
        # response; the turn has a few seconds in total.
        registry = ToolRegistry(FakeApi(delay=5.0))
        ok, message = asyncio.run(registry.call("get_market_quotes", {}))
        self.assertFalse(ok)
        self.assertEqual(message, "timed out")


class Trimming(unittest.TestCase):
    def test_lists_are_truncated(self) -> None:
        self.assertEqual(len(trim(list(range(50)))), 5)

    def test_nested_structure_is_dropped_but_scalars_kept(self) -> None:
        value = {"name": "Taiwan", "score": 61, "deep": {"a": {"b": 1}}, "items": [1, 2, 3]}
        result = trim(value)
        self.assertEqual(result["name"], "Taiwan")
        self.assertEqual(result["score"], 61)
        self.assertEqual(result["items"], [1, 2, 3])
        # The model is summarising for speech, not rendering a table.
        self.assertNotIn("deep", result)


class Schemas(unittest.TestCase):
    def test_every_tool_produces_a_well_formed_schema(self) -> None:
        registry = ToolRegistry(FakeApi())
        registry.update(SNAPSHOT)
        for schema in registry.schemas():
            self.assertEqual(schema["type"], "function")
            self.assertIn("name", schema["function"])
            self.assertIn("description", schema["function"])
            self.assertEqual(schema["function"]["parameters"]["type"], "object")

    def test_the_text_listing_names_every_tool(self) -> None:
        # A model without native tool calling is told the same things in prose,
        # and its answer goes through the same validation.
        registry = ToolRegistry(FakeApi())
        registry.update(SNAPSHOT)
        described = registry.describe()
        for tool in registry.all:
            self.assertIn(tool.name, described)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
