import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, waitFor } from "@testing-library/react";
import RefactoredOutput from "@/components/features/output/RefactoredOutput";
import { EMPTY_ORCHESTRATION_RESULT } from "@/lib/constants";
import { DEFAULT_GLASSBOX_STATE } from "@/lib/orchestrationDefaults";

beforeAll(() => {
  // jsdom does not implement scrollIntoView (FlowGrid auto-scroll).
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }),
}));

vi.mock("@/store/useChatStore", () => {
  const state = { tourMode: false };
  const fn = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  fn.getState = () => state;
  return { useChatStore: fn };
});

const baseProps = {
  refactoredOutput: "",
  setRefactoredOutput: vi.fn(),
  sourceCode: "class A {}",
  activeStep: 0,
  isTerminalCollapsed: false,
  orchestrationResult: EMPTY_ORCHESTRATION_RESULT,
  glassboxState: DEFAULT_GLASSBOX_STATE,
  isMonolith: false,
};

const selectedTab = () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";

describe("RefactoredOutput panel transitions (FR-011)", () => {
  it("shows Flow while analyzing", async () => {
    render(
      <RefactoredOutput {...baseProps} appState="analyzing" />
    );
    await waitFor(() => expect(selectedTab()).toContain("Flow"));
  });

  it("auto-switches to Output when a run completes (analyzing → done)", async () => {
    const { rerender } = render(
      <RefactoredOutput {...baseProps} appState="analyzing" />
    );
    await waitFor(() => expect(selectedTab()).toContain("Flow"));

    rerender(
      <RefactoredOutput
        {...baseProps}
        appState="done"
        refactoredOutput="class B {}"
        orchestrationResult={{
          ...EMPTY_ORCHESTRATION_RESULT,
          exit_status: "SUCCESS" as const,
        }}
      />
    );
    await waitFor(() => expect(selectedTab()).toContain("Refactored Output"));
  });

  it("switches to Output when replay lands under idle (idle → done)", async () => {
    const { rerender } = render(
      <RefactoredOutput {...baseProps} appState="idle" />
    );
    await waitFor(() => expect(selectedTab()).toContain("Output"));

    rerender(
      <RefactoredOutput
        {...baseProps}
        appState="done"
        refactoredOutput="class C {}"
      />
    );
    await waitFor(() => expect(selectedTab()).toContain("Refactored Output"));
  });

  it("defaults to Output when mounted already done", async () => {
    render(
      <RefactoredOutput
        {...baseProps}
        appState="done"
        refactoredOutput="class D {}"
      />
    );
    await waitFor(() => expect(selectedTab()).toContain("Refactored Output"));
  });
});
