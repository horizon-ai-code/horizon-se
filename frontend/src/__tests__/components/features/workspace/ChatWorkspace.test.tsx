import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import ChatWorkspace from '@/components/features/workspace/ChatWorkspace';

const reattachMock = vi.fn().mockResolvedValue(true);
const fetchSessionDetailsMock = vi.fn(async (id: string) => {
  // Simulate hydration recording the backend lifecycle status on the session.
  const status = (fetchSessionDetailsMock as unknown as { nextStatus?: string }).nextStatus ?? 'Completed';
  storeState.sessions[id] = {
    ...storeState.draftSession,
    id,
    isLoaded: true,
    serverStatus: status,
  };
  return true;
});

// Mutable backing object shared by the mocked store's getState()/selector.
interface MockStoreState {
  sessions: Record<string, Record<string, unknown>>;
  fetchSessionDetails: (id: string) => Promise<boolean>;
  draftSession: Record<string, unknown>;
  [key: string]: unknown;
}
const storeState: MockStoreState = {
  sessions: {},
  fetchSessionDetails: fetchSessionDetailsMock,
  draftSession: {
    sourceCode: '', refactoredOutput: '', activeStep: 0, inputInstruction: '',
    terminalEntries: [], isTerminalCollapsed: false, appState: 'idle',
    showFlowchartModal: false, isMonolith: false, title: '', createdAt: 0, updatedAt: 0,
    orchestrationResult: { metrics: [], summary: '', diffHighlights: { added: [], removed: [] } },
  },
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => '/',
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', setTheme: vi.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/hooks/useOrchestrationSocket', () => ({
  useOrchestrationSocket: () => ({
    connectionStatus: 'connected', connect: vi.fn(), disconnect: vi.fn(),
    sendRefactorRequest: vi.fn(), sendHaltRequest: vi.fn(),
    reattach: reattachMock,
    setTargetSessionId: vi.fn(), glassboxState: null, waitForOpen: vi.fn(),
  }),
  OrchestrationProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/store/useChatStore', () => {
  const fn = (selector?: (s: typeof storeState) => unknown) => selector ? selector(storeState) : storeState;
  fn.getState = () => storeState;
  return { useChatStore: fn, INITIAL_SOURCE: '', EMPTY_ORCHESTRATION_RESULT: { metrics: [], summary: '', diffHighlights: { added: [], removed: [] } } };
});

describe('ChatWorkspace', () => {
  beforeEach(() => {
    storeState.sessions = {};
    reattachMock.mockClear();
    (fetchSessionDetailsMock as unknown as { nextStatus?: string }).nextStatus = undefined;
  });

  it('renders without crashing', () => {  // TC-FI-004a
    render(<ChatWorkspace sessionId="test-session" />);
    expect(document.body).toBeTruthy();
  });

  it('renders with null sessionId', () => {  // TC-FI-004b
    render(<ChatWorkspace sessionId={null} />);
    expect(document.body).toBeTruthy();
  });

  it('auto-reattaches live (Processing) sessions on load', async () => {  // TC-FR-011c-a
    (fetchSessionDetailsMock as unknown as { nextStatus?: string }).nextStatus = 'Processing';
    render(<ChatWorkspace sessionId="live-session" />);
    await vi.waitFor(() => expect(reattachMock).toHaveBeenCalledWith('live-session'));
  });

  it('does NOT auto-reattach completed sessions on load', async () => {  // TC-FR-011c-b
    (fetchSessionDetailsMock as unknown as { nextStatus?: string }).nextStatus = 'Completed';
    render(<ChatWorkspace sessionId="done-session" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(reattachMock).not.toHaveBeenCalled();
  });
});
