"""Tests for MessageRouter — WebSocket message dispatch."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.connection.router import MessageRouter


@pytest.mark.asyncio
class TestMessageRouter:
    @pytest.fixture
    def router(self):
        agent = AsyncMock()
        return MessageRouter(agent)

    async def test_dispatch_pong(self, router):  # TC-MR-001
        client = AsyncMock()
        data = {"type": "pong"}
        await router.dispatch(data, client, set(), None, None, None)
        client.handle_pong.assert_called_once()

    async def test_dispatch_reconnect(self, router):  # TC-MR-002
        client = AsyncMock()
        reconnect = AsyncMock()
        data = {"type": "reconnect", "session_id": "s1"}
        await router.dispatch(data, client, set(), None, None, reconnect)
        reconnect.assert_awaited_once_with("s1", client)

    async def test_dispatch_single(self, router):  # TC-MR-003
        client = AsyncMock()
        client.send_status = AsyncMock()
        data = {"type": "single", "code": "class A {}", "user_instruction": "refactor"}
        result = await router.dispatch(data, client, set(), AsyncMock(), None, None)
        assert result is True

    async def test_dispatch_multi(self, router):  # TC-MR-004
        client = AsyncMock()
        client.send_status = AsyncMock()
        data = {"type": "multi", "code": "class A {}", "user_instruction": "refactor"}
        result = await router.dispatch(data, client, set(), None, AsyncMock(), None)
        assert result is True

    async def test_dispatch_halt(self, router):  # TC-MR-005
        client = AsyncMock()
        data = {"type": "halt"}
        await router.dispatch(data, client, set(), None, None, None)
        router._agent_service.stop.assert_called_once()

    async def test_dispatch_malformed_json_rejected(self, router):  # TC-MR-007
        client = AsyncMock()
        client._safe_send = AsyncMock()
        data = {"type": None}
        result = await router.dispatch(data, client, set(), None, None, None)
        assert result is False

    async def test_dispatch_invalid_request_sends_error(self, router):  # TC-MR-006
        client = AsyncMock()
        data = {"type": "multi", "code": ""}
        result = await router.dispatch(data, client, set(), None, None, None)
        assert result is True

    async def test_dispatch_unknown_type_ignored(self, router):  # TC-MR-008
        client = AsyncMock()
        data = {"type": "unknown"}
        result = await router.dispatch(data, client, set(), None, None, None)
        assert result is False


class _StubConn:
    """Minimal ClientConnection stand-in for reconnect-handler tests."""

    def __init__(self):
        self.websocket = MagicMock()
        self.websocket.send_json = AsyncMock()
        self.send_status = AsyncMock()
        self.send_result = AsyncMock()
        self.send_insights = AsyncMock()
        self.id = "conn-1"


@pytest.fixture
def stub_main():
    """Import app.main with external seams monkeypatched."""
    import app.main as m
    with patch.object(m.connection, "get_history_by_id", new=AsyncMock(return_value=None)) as g:
        yield m, g


@pytest.mark.asyncio
class TestHandleReconnect:
    async def test_missing_session_id(self, stub_main):  # TC-RN-001a
        m, _ = stub_main
        conn = _StubConn()
        await m._handle_reconnect("", conn)
        conn.websocket.send_json.assert_awaited_once_with(
            {"type": "error", "code": "MISSING_SESSION_ID", "message": "Missing session_id"}
        )

    async def test_invalid_session_id(self, stub_main):  # TC-RN-001b
        m, _ = stub_main
        conn = _StubConn()
        await m._handle_reconnect("not-a-uuid", conn)
        payload = conn.websocket.send_json.await_args.args[0]
        assert payload["code"] == "INVALID_SESSION_ID"

    async def test_unknown_session(self, stub_main):  # TC-RN-001c
        m, get = stub_main
        get.return_value = None
        sid = str(uuid.uuid4())
        conn = _StubConn()
        await m._handle_reconnect(sid, conn)
        assert conn.websocket.send_json.await_args.args[0]["code"] == "SESSION_NOT_FOUND"

    async def test_processing_identity_match_reattaches_in_place(self, stub_main):  # TC-RN-002
        m, get = stub_main
        sid = str(uuid.uuid4())
        get.return_value = {"status": "Processing"}
        active = _StubConn(); active.id = sid
        m.orchestrator.current_client = active

        conn = _StubConn()
        await m._handle_reconnect(sid, conn)

        # In-place promotion: the SAME object this socket already feeds pongs to.
        assert m.orchestrator.current_client is conn
        assert conn.id == sid
        sent = conn.send_status.await_args
        assert "Reconnected" in sent.kwargs.get("content", "") or "Reconnected" in str(sent)

    async def test_processing_different_active_session_no_swap(self, stub_main):  # TC-RN-003
        m, get = stub_main
        sid = str(uuid.uuid4())
        get.return_value = {"status": "Processing"}
        other = _StubConn(); other.id = str(uuid.uuid4())
        m.orchestrator.current_client = other

        conn = _StubConn()
        await m._handle_reconnect(sid, conn)

        assert m.orchestrator.current_client is other  # untouched — no hijack
        assert conn.send_status.await_count == 1
        assert "not active" in str(conn.send_status.await_args)

    async def test_processing_no_active_client(self, stub_main):  # TC-RN-004
        m, get = stub_main
        sid = str(uuid.uuid4())
        get.return_value = {"status": "Processing"}
        m.orchestrator.current_client = None

        conn = _StubConn()
        await m._handle_reconnect(sid, conn)
        assert "not active" in str(conn.send_status.await_args)

    async def test_halted_session_notice_no_swap(self, stub_main):  # TC-RN-005
        m, get = stub_main
        sid = str(uuid.uuid4())
        get.return_value = {"status": "Halted", "exit_status": "ABORTED"}
        m.orchestrator.current_client = None

        conn = _StubConn()
        await m._handle_reconnect(sid, conn)
        assert "halted" in str(conn.send_status.await_args).lower()

    async def test_halted_with_code_replays_result(self, stub_main):  # TC-RN-008
        """Halted sessions that produced output replay it — no reload needed."""
        m, get = stub_main
        sid = str(uuid.uuid4())
        get.return_value = {
            "status": "Halted",
            "exit_status": "ABORTED",
            "refactored_code": "class Partial {}",
            "original_complexity": 5,
            "refactored_complexity": None,
        }
        conn = _StubConn()
        await m._handle_reconnect(sid, conn)

        assert conn.send_result.await_args.kwargs["final_code"] == "class Partial {}"
        assert "halted" in str(conn.send_status.await_args).lower()

    async def test_processing_finished_after_hydrate_replays(self, stub_main):  # TC-RN-009
        """Row said Processing at hydrate-time but run already finished with
        output (no active run) → replay instead of dead-end notice."""
        m, get = stub_main
        sid = str(uuid.uuid4())
        get.return_value = {
            "status": "Processing",
            "exit_status": "SUCCESS",
            "refactored_code": "class Done {}",
            "insights": "- done",
        }
        m.orchestrator.current_client = None

        conn = _StubConn()
        await m._handle_reconnect(sid, conn)

        assert conn.send_result.await_args.kwargs["final_code"] == "class Done {}"
        conn.send_insights.assert_awaited_once_with("- done")
        assert "restored" in str(conn.send_status.await_args).lower()

    async def test_completed_replays_result_with_models_and_insights(self, stub_main):  # TC-RN-006
        m, get = stub_main
        sid = str(uuid.uuid4())
        get.return_value = {
            "status": "Completed",
            "exit_status": "SUCCESS",
            "refactored_code": "class B {}",
            "original_complexity": 7,
            "refactored_complexity": 3,
            "planner_model": "qwen-coder",
            "generator_model": "qwen-coder",
            "judge_model": "llama-engine",
            "insights": "- did a thing",
        }
        conn = _StubConn()
        await m._handle_reconnect(sid, conn)

        kwargs = conn.send_result.await_args.kwargs
        assert kwargs["final_code"] == "class B {}"
        assert kwargs["planner_model"] == "qwen-coder"
        assert kwargs["judge_model"] == "llama-engine"
        conn.send_insights.assert_awaited_once_with("- did a thing")

    def test_reattach_keeps_pong_target_identity(self, stub_main):  # TC-RN-007
        """Regression guard: promoted object must be the one pongs reach."""
        from app.modules.connection import ClientConnection
        m, _ = stub_main
        sid = str(uuid.uuid4())
        conn = ClientConnection(AsyncMock(), MagicMock())  # real heartbeat logic
        conn.id = sid
        m.orchestrator.current_client = conn
        # entrypoint routes pongs to client_conn (same object) → counter resets.
        conn._missed_pongs = 2
        assert conn.is_stale is True
        ClientConnection.handle_pong(conn)
        assert conn.is_stale is False and m.orchestrator.current_client is conn
