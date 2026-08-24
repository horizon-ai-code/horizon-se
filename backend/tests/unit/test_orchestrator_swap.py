"""Tests for swap-aware client resolution (FR-011 resilient runs)."""

from unittest.mock import MagicMock

from app.modules.orchestrator import Orchestrator


def _make_orchestrator() -> Orchestrator:
    return Orchestrator(agent_service=MagicMock(), validator=MagicMock(), db=MagicMock())


class TestCurrentClientResolution:
    def test_resolves_swapped_client_over_stale_reference(self):  # TC-SW-001
        orch = _make_orchestrator()
        stale = MagicMock(name="stale-conn")
        live = MagicMock(name="live-conn")
        orch.current_client = live

        assert orch._current_client(stale) is live

    def test_falls_back_to_original_when_no_swap(self):  # TC-SW-002
        orch = _make_orchestrator()
        orch.current_client = None
        original = MagicMock(name="original-conn")

        assert orch._current_client(original) is original

    def test_single_mode_registers_in_swap_table(self, monkeypatch):  # TC-SW-003
        """Regression: single-mode runs must occupy the swap slot, otherwise a
        rebind could resolve onto a previous session's dead socket."""
        import asyncio
        from unittest.mock import AsyncMock

        orch = _make_orchestrator()
        captured = {}

        class FakeSingle:
            async def run(self, client, code, instruction):
                captured["registered"] = orch.current_client is client
                captured["resolved"] = orch._current_client(client) is client

        monkeypatch.setattr(orch, "_single", FakeSingle())
        client = MagicMock()
        asyncio.run(orch.run_single_refactor(client, "code", "refactor"))

        assert captured["registered"] is True
        assert captured["resolved"] is True
