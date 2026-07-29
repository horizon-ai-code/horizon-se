import { create } from 'zustand';
import { API_URL } from '@/lib/env';

// ── Import types from dedicated modules ───────────────────────────────────────
import type { AppState, SessionData, TerminalEntry, OrchestrationResult } from '@/types/session';
import type { InsightMetric } from '@/types/insights';
import type {
  ConnectionIdMessage,
  StatusMessage,
  ResultMessage,
  PydanticError,
  ValidationErrorMessage,
  MalformedJsonErrorMessage,
  ErrorMessage,
  ServerMessage,
  ExitStatus,
} from '@/types/websocket';

// ── Typed API response interfaces ──────────────────────────────────────────────

interface HistoryItemResponse {
  id?: string;
  title?: string;
  created_at?: string;
}

interface SessionDetailResponse {
  id?: string;
  user_instruction?: string;
  title?: string;
  original_code?: string;
  refactored_code?: string;
  status?: string;
  exit_status?: string;
  total_outer_loops?: number;
  logs?: Array<{
    id?: string;
    role?: string;
    status?: string;
    content?: string | null;
    phase?: number;
    outer_loop?: number;
    inner_loop?: number;
    created_at?: string;
  }>;
  phase_states?: string;
  insights?: string;
  original_complexity?: number;
  refactored_complexity?: number;
  planner_model?: string;
  generator_model?: string;
  judge_model?: string;
  avg_gpu_utilization?: number;
  avg_gpu_memory?: number;
  avg_gpu_memory_used?: number;
  peak_gpu_utilization?: number;
  peak_gpu_memory_used?: number;
  inference_time?: number;
  created_at?: string;
}

// ── Import constants ──────────────────────────────────────────────────────────
import { INITIAL_SOURCE, EMPTY_ORCHESTRATION_RESULT, ROLE_VISUALS, DEFAULT_ROLE_VISUALS } from '@/lib/constants';
import { buildMetrics } from '@/lib/utils/buildMetrics';

// ── Internal Helpers ──────────────────────────────────────────────────────────

const DEFAULT_SESSION: Omit<SessionData, "id"> = {
  title: "New Session",
  createdAt: 0,
  updatedAt: 0,
  sourceCode: INITIAL_SOURCE,
  refactoredOutput: "",
  activeStep: 0,
  inputInstruction: "Extract deeply nested conditionals into well-named methods like isEligibleForProcessing()",
  terminalEntries: [],
  isTerminalCollapsed: false,
  appState: "idle",
  showFlowchartModal: false,
  isMonolith: false,
  orchestrationResult: EMPTY_ORCHESTRATION_RESULT,
};

const generateSessionId = () => Math.random().toString(36).slice(2, 10);

const getSessionTitleFromPrompt = (prompt: string) => {
  const trimmed = prompt.trim();
  if (!trimmed) return "New Session";
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}...` : trimmed;
};

// ── Store Interface ───────────────────────────────────────────────────────────

type OrchestratorStatus = "connected" | "connecting" | "disconnected" | "error";

interface ChatStore {
  orchestratorStatus: OrchestratorStatus;
  setOrchestratorStatus: (status: OrchestratorStatus) => void;
  hasInitialLoaded: boolean;
  setHasInitialLoaded: (loaded: boolean) => void;
  historyLoadError: boolean;
  tourMode: boolean;
  setTourMode: (val: boolean) => void;
  currentTourStep: number;
  setCurrentTourStep: (val: number) => void;
  sessions: Record<string, SessionData>;
  draftSession: Omit<SessionData, "id">;
  updateDraftSession: (
    data:
      | Partial<Omit<SessionData, "id">>
      | ((prev: Omit<SessionData, "id">) => Partial<Omit<SessionData, "id">>)
  ) => void;
  resetDraftSession: () => void;
  updateSession: (id: string, data: Partial<SessionData> | ((prev: SessionData) => Partial<SessionData>)) => void;
  createSession: (id: string, initialData?: Partial<SessionData>) => void;
  createSessionWithInitialPrompt: (prompt: string, initialData?: Partial<SessionData>) => string;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => Promise<void>;
  clearAllHistory: () => Promise<void>;
  migrateSessionId: (oldId: string, newId: string) => void;
  fetchHistory: () => Promise<void>;
  fetchSessionDetails: (id: string) => Promise<boolean>;
}

// ── Zustand Store ─────────────────────────────────────────────────────────────

export const useChatStore = create<ChatStore>((set, get) => ({
  orchestratorStatus: "connected",
  setOrchestratorStatus: (status) => set({ orchestratorStatus: status }),
  hasInitialLoaded: false,
  setHasInitialLoaded: (loaded) => set({ hasInitialLoaded: loaded }),
  historyLoadError: false,
  tourMode: false,
  setTourMode: (val) => set({ tourMode: val }),
  currentTourStep: 0,
  setCurrentTourStep: (val) => set({ currentTourStep: val }),
  sessions: {},
  draftSession: DEFAULT_SESSION,

  updateDraftSession: (arg) =>
    set((state) => {
      const data = typeof arg === "function" ? arg(state.draftSession) : arg;
      return {
        ...state,
        draftSession: { ...state.draftSession, ...data },
      };
    }),

  resetDraftSession: () => set((state) => ({ ...state, draftSession: DEFAULT_SESSION })),

  updateSession: (id, arg) =>
    set((state) => {
      const now = Date.now();
      
      if (id === "draft" || !id) {
        const data = typeof arg === "function" ? arg({ ...state.draftSession, id: "draft" } as SessionData) : arg;
        return {
          ...state,
          draftSession: { ...state.draftSession, ...data, updatedAt: now },
        };
      }

      const existing = state.sessions[id] || { ...DEFAULT_SESSION, id, createdAt: now, updatedAt: now };
      const data = typeof arg === "function" ? arg(existing) : arg;
      const updated = {
        ...existing,
        ...data,
        updatedAt: now,
      };

      if (typeof window !== "undefined") {
        localStorage.setItem(`session_${id}`, JSON.stringify(updated));
        const sessionIdsStr = localStorage.getItem("session_ids");
        const ids: string[] = sessionIdsStr ? JSON.parse(sessionIdsStr) : [];
        if (!ids.includes(id)) {
          ids.push(id);
          localStorage.setItem("session_ids", JSON.stringify(ids));
        }
      }

      return {
        ...state,
        sessions: {
          ...state.sessions,
          [id]: updated,
        },
      };
    }),

  createSession: (id, initialData) =>
    set((state) => {
      if (state.sessions[id]) return state;

      const now = Date.now();
      const instruction = initialData?.inputInstruction || "";
      const derivedTitle = instruction ? getSessionTitleFromPrompt(instruction) : "New Session";
      const newSession: SessionData = { 
        ...DEFAULT_SESSION, 
        id, 
        createdAt: now, 
        updatedAt: now, 
        ...initialData, 
        title: derivedTitle,
        isLoaded: true 
      };

      if (typeof window !== "undefined") {
        localStorage.setItem(`session_${id}`, JSON.stringify(newSession));
        const sessionIdsStr = localStorage.getItem("session_ids");
        const ids: string[] = sessionIdsStr ? JSON.parse(sessionIdsStr) : [];
        if (!ids.includes(id)) {
          ids.push(id);
          localStorage.setItem("session_ids", JSON.stringify(ids));
        }
      }

      return {
        ...state,
        sessions: {
          ...state.sessions,
          [id]: newSession,
        },
      };
    }),

  createSessionWithInitialPrompt: (prompt, initialData) => {
    const id = generateSessionId();
    const now = Date.now();
    const title = getSessionTitleFromPrompt(prompt);
    const newSession: SessionData = {
      ...DEFAULT_SESSION,
      id,
      title,
      createdAt: now,
      updatedAt: now,
      ...initialData,
    };

    if (typeof window !== "undefined") {
      localStorage.setItem(`session_${id}`, JSON.stringify(newSession));
      const sessionIdsStr = localStorage.getItem("session_ids");
      const ids: string[] = sessionIdsStr ? JSON.parse(sessionIdsStr) : [];
      if (!ids.includes(id)) {
        ids.push(id);
        localStorage.setItem("session_ids", JSON.stringify(ids));
      }
    }

    set((state) => ({
      ...state,
      sessions: {
        ...state.sessions,
        [id]: newSession,
      },
    }));

    return id;
  },

  renameSession: async (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;

    set((state) => {
      const session = state.sessions[id];
      if (!session) return state;
      const updated = {
        ...session,
        title: trimmed,
        updatedAt: Date.now(),
      };
      if (typeof window !== "undefined") {
        localStorage.setItem(`session_${id}`, JSON.stringify(updated));
      }
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [id]: updated,
        },
      };
    });
  },

  deleteSession: async (id) => {
    set((state) => {
      if (!state.sessions[id]) return state;

      const remaining = { ...state.sessions };
      delete remaining[id];
      
      if (typeof window !== "undefined") {
        localStorage.removeItem(`session_${id}`);
        const sessionIdsStr = localStorage.getItem("session_ids");
        const ids: string[] = sessionIdsStr ? JSON.parse(sessionIdsStr) : [];
        const newIds = ids.filter(x => x !== id);
        localStorage.setItem("session_ids", JSON.stringify(newIds));
      }
      
      return { ...state, sessions: remaining };
    });
  },

  clearAllHistory: async () => {
    set((state) => {
      if (typeof window !== "undefined") {
        const sessionIdsStr = localStorage.getItem("session_ids");
        const ids: string[] = sessionIdsStr ? JSON.parse(sessionIdsStr) : [];
        ids.forEach(id => localStorage.removeItem(`session_${id}`));
        localStorage.removeItem("session_ids");
      }
      return { ...state, sessions: {} };
    });
  },

  migrateSessionId: (oldId, newId) =>
    set((state) => {
      if (oldId === newId) return state;
      const oldSession = state.sessions[oldId];
      if (!oldSession) return state;

      const remaining = { ...state.sessions };
      delete remaining[oldId];
      
      const updated = {
        ...oldSession,
        id: newId,
      };

      if (typeof window !== "undefined") {
        localStorage.removeItem(`session_${oldId}`);
        localStorage.setItem(`session_${newId}`, JSON.stringify(updated));
        const sessionIdsStr = localStorage.getItem("session_ids");
        const ids: string[] = sessionIdsStr ? JSON.parse(sessionIdsStr) : [];
        const newIds = ids.map(x => x === oldId ? newId : x);
        localStorage.setItem("session_ids", JSON.stringify(newIds));
      }

      return {
        ...state,
        sessions: {
          ...remaining,
          [newId]: updated,
        },
      };
    }),

  fetchHistory: async () => {
    try {
      const sessionIdsStr = typeof window !== "undefined" ? localStorage.getItem("session_ids") : null;
      const ids: string[] = sessionIdsStr ? JSON.parse(sessionIdsStr) : [];
      
      set((state) => {
        const newSessions = { ...state.sessions };
        ids.forEach((id) => {
          const stored = typeof window !== "undefined" ? localStorage.getItem(`session_${id}`) : null;
          if (stored) {
            try {
              const sessionData: SessionData = JSON.parse(stored);
              newSessions[id] = {
                ...sessionData,
                isLoaded: false
              };
            } catch {}
          }
        });
        return {
          ...state,
          sessions: newSessions,
          hasInitialLoaded: true,
          historyLoadError: false,
        };
      });
    } catch (e) {
      console.error("[ChatStore] Error fetching history:", e);
      set((state) => ({ ...state, historyLoadError: false, hasInitialLoaded: true }));
    }
  },

  fetchSessionDetails: async (id) => {
    try {
      const stored = typeof window !== "undefined" ? localStorage.getItem(`session_${id}`) : null;
      if (stored) {
        const sessionData: SessionData = JSON.parse(stored);
        set((state) => ({
          sessions: {
            ...state.sessions,
            [id]: {
              ...sessionData,
              isLoaded: true
            }
          }
        }));
        return true;
      }
      return false;
    } catch (e) {
      console.error("[ChatStore] Error fetching session details:", e);
      return false;
    }
  },
}));
