"""Tests for module-level orchestration runners — queue wait + execution timeout."""

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

import app.main as m
from app.main import run_orchestration, run_single_refactor


class _StubClient:
    def __init__(self):
        self.id = str(uuid.uuid4())
        self.send_status = AsyncMock()
        self.send_connection_id = AsyncMock()
        self.send_halt_notification = AsyncMock()
        self.reset_id = MagicMock()

    def make_request(self, code="class A {}", instruction="refactor"):
        from app.utils.types import RefactorRequest

        return RefactorRequest(code=code, user_instruction=instruction)


@pytest.fixture(autouse=True)
def fast_timeouts(monkeypatch):
    monkeypatch.setattr(m, "LOCK_WAIT_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(m, "EXECUTION_TIMEOUT_SECONDS", 0.05)


@pytest.fixture(autouse=True)
def clean_lock():
    yield m.orchestration_lock
    if m.orchestration_lock.locked():
        m.orchestration_lock.release()


class TestRunOrchestration:
    @pytest.mark.asyncio
    async def test_execution_timeout_halts_and_notifies(self, monkeypatch):  # TC-RT-001
        async def slow_execute(**kwargs):
            await asyncio.sleep(5)

        monkeypatch.setattr(m.orchestrator, "execute_orchestration", slow_execute)
        halted = AsyncMock()
        monkeypatch.setattr(m.connection.db, "mark_as_halted", halted)

        client = _StubClient()
        await run_orchestration(client, client.make_request())

        halted.assert_called_once_with(client.id)
        assert "timed out" in str(client.send_status.await_args)
        assert not m.orchestration_lock.locked()  # lock released despite timeout

    @pytest.mark.asyncio
    async def test_queue_wait_timeout_returns_without_running(self, monkeypatch):  # TC-RT-002
        await m.orchestration_lock.acquire()  # someone else holds the lock
        try:
            executed = AsyncMock()
            monkeypatch.setattr(m.orchestrator, "execute_orchestration", executed)

            client = _StubClient()
            await asyncio.wait_for(
                run_orchestration(client, client.make_request()), timeout=2
            )

            assert "busy" in str(client.send_status.await_args).lower()
            executed.assert_not_awaited()
        finally:
            m.orchestration_lock.release()

    @pytest.mark.asyncio
    async def test_happy_path_releases_lock_and_completes(self, monkeypatch):  # TC-RT-003
        async def fast_execute(**kwargs):
            return None

        monkeypatch.setattr(m.orchestrator, "execute_orchestration", fast_execute)
        halted = AsyncMock()
        monkeypatch.setattr(m.connection.db, "mark_as_halted", halted)

        client = _StubClient()
        await run_orchestration(client, client.make_request())

        halted.assert_not_called()
        client.send_status.assert_not_awaited()
        assert not m.orchestration_lock.locked()


class TestRunSingleRefactor:
    @pytest.mark.asyncio
    async def test_execution_timeout_halts_and_notifies(self, monkeypatch):  # TC-RT-004a
        async def slow_single(*args, **kwargs):
            await asyncio.sleep(5)

        monkeypatch.setattr(m.orchestrator, "run_single_refactor", slow_single)
        halted = AsyncMock()
        monkeypatch.setattr(m.connection.db, "mark_as_halted", halted)

        client = _StubClient()
        await run_single_refactor(client, "code here", "refactor this")

        halted.assert_called_once_with(client.id)
        assert "timed out" in str(client.send_status.await_args)
        assert not m.orchestration_lock.locked()

    @pytest.mark.asyncio
    async def test_queue_wait_timeout_returns_without_running(self, monkeypatch):  # TC-RT-004b
        await m.orchestration_lock.acquire()
        try:
            executed = AsyncMock()
            monkeypatch.setattr(m.orchestrator, "run_single_refactor", executed)

            client = _StubClient()
            await asyncio.wait_for(
                run_single_refactor(client, "code", "refactor"), timeout=2
            )
            executed.assert_not_awaited()
        finally:
            m.orchestration_lock.release()

    @pytest.mark.asyncio
    async def test_unload_still_runs_after_timeout(self, monkeypatch):  # TC-RT-005
        """Regression: the original `finally: agent_service.unload()` must survive the rewrite."""
        async def slow_single(*args, **kwargs):
            await asyncio.sleep(5)

        monkeypatch.setattr(m.orchestrator, "run_single_refactor", slow_single)
        unload = AsyncMock()
        monkeypatch.setattr(m.agent_service, "unload", unload)

        client = _StubClient()
        await run_single_refactor(client, "code", "refactor")
        unload.assert_awaited_once()
