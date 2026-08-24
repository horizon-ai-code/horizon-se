import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ReactNode } from "react";

import {
  OrchestrationProvider,
  useOrchestrationSocket,
} from "@/hooks/useOrchestrationSocket";
import { MockWebSocket } from "@/test-utils/mocks/websocket";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => "/",
}));

const instances: MockWebSocket[] = [];

class RecordingWebSocket extends MockWebSocket {
  constructor(url: string) {
    super(url);
    instances.push(this);
  }
}

const flushTimers = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const renderSocket = () =>
  renderHook(() => useOrchestrationSocket(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <OrchestrationProvider>{children}</OrchestrationProvider>
    ),
  });

describe("useOrchestrationSocket reconnect (FR-011)", () => {
  beforeEach(() => {
    instances.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", RecordingWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reattach connects and emits a reconnect frame", async () => {
    const { result } = renderSocket();

    let ok = false;
    await act(async () => {
      const p = result.current.reattach("session-abc");
      await flushTimers(60);
      ok = await p;
    });

    expect(ok).toBe(true);
    const frames = instances[0].sentMessages.map((m) => JSON.parse(m));
    expect(frames).toContainEqual({ type: "reconnect", session_id: "session-abc" });
  });

  it("resends reconnect on unexpected drop while a run is active", async () => {
    const { result } = renderSocket();

    await act(async () => {
      const p = result.current.reattach("session-abc");
      await flushTimers(60);
      await p;
    });
    expect(instances[0].sentMessages.some((m) => m.includes('"reconnect"'))).toBe(true);

    // Unexpected drop -> backoff reopen -> auto-resume for the active run.
    await act(async () => {
      instances[0].close();
      await flushTimers(1100);
    });

    expect(instances.length).toBeGreaterThanOrEqual(2);
    const reopened = instances[instances.length - 1];
    const frames = reopened.sentMessages.map((m) => JSON.parse(m));
    expect(frames).toContainEqual({ type: "reconnect", session_id: "session-abc" });
  });

  it("does NOT send reconnect on plain fresh connect (no run started)", async () => {
    const { result } = renderSocket();

    await act(async () => {
      result.current.connect("some-session");
      await flushTimers(60);
    });

    const frames = instances[0].sentMessages.map((m) => JSON.parse(m));
    expect(frames).not.toContainEqual(
      expect.objectContaining({ type: "reconnect" })
    );
  });
});
