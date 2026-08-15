/**
 * Tests for the hook self-heal reliability work (issue #128,
 * docs/specs/2026-08-15-hook-self-heal-reliability.md).
 *
 * Covers the extension.ts-level requirements:
 *  - FR-1: the setTimeout(...ensureHooksInstalled...) call site awaits the
 *    call and catches/logs/surfaces failures instead of producing a silent
 *    unhandled rejection.
 *  - FR-3: a vscode.window.onDidChangeWindowState listener re-runs the same
 *    check on the false->true focus edge only, is pushed onto
 *    context.subscriptions, and is retriable (no one-shot latch).
 *  - Resolution 1 (notification dedup): FR-1's showErrorMessage popup fires
 *    at most once per distinct error signature per running session.
 *
 * ensureHooksInstalled() itself is fully mocked here -- its own behavior
 * (FR-2/FR-2a/FR-4/FR-5/FR-6) is covered in test/hookInstaller.test.ts. This
 * file only exercises how extension.ts's activate() calls it and reacts to
 * its resolution/rejection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

// Same rationale as test/extension.existenceCache.test.ts: vi.mock("fs") is
// required because ESM module namespaces aren't reconfigurable via vi.spyOn.
vi.mock("fs");

vi.mock("vscode", async () => {
  const m = await import("./mocks/vscode");
  return m;
});

vi.mock("../src/hookInstaller", () => ({
  ensureHooksInstalled: vi.fn(),
  setupHooksCommand: vi.fn(),
  uninstallHooks: vi.fn(),
}));

import * as vscodeMock from "./mocks/vscode";
import { activate } from "../src/extension";
import { ensureHooksInstalled } from "../src/hookInstaller";
import { getOutputChannel } from "../src/output";

// Force output-channel creation once so createOutputChannel.mock.results[0]
// is populated -- mirrors test/debugLog.test.ts's established pattern for
// observing what log() writes without depending on extension.ts's own
// (not-yet-written) import of src/output.
getOutputChannel();
const outputChannel = (
  vscodeMock.window.createOutputChannel as ReturnType<typeof vi.fn>
).mock.results[0]?.value as {
  appendLine: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

interface FakeMemento {
  get: <T>(key: string, defaultValue?: T) => T | undefined;
  update: (key: string, value: unknown) => Promise<void>;
}

function makeMemento(): FakeMemento {
  const data: Record<string, unknown> = {};
  return {
    get: <T>(key: string, defaultValue?: T) =>
      (key in data ? data[key] : defaultValue) as T | undefined,
    update: vi.fn(async (key: string, value: unknown) => {
      data[key] = value;
    }),
  };
}

function makeContext(): import("vscode").ExtensionContext {
  const subscriptions: { dispose(): void }[] = [];
  return {
    subscriptions,
    extensionPath: "C:/fake/extension/path",
    globalState: makeMemento(),
  } as unknown as import("vscode").ExtensionContext;
}

/** Extracts the listener activate() registered via onDidChangeWindowState. */
function capturedWindowStateListener(): (state: { focused: boolean }) => unknown {
  const calls = vi.mocked(vscodeMock.window.onDidChangeWindowState).mock.calls;
  const last = calls[calls.length - 1];
  return last[0] as (state: { focused: boolean }) => unknown;
}

describe("activate() — hook self-heal (issue #128)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(ensureHooksInstalled).mockReset();
    vi.mocked(ensureHooksInstalled).mockResolvedValue(true);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as unknown as string);

    (vscodeMock.window as unknown as { terminals: unknown[] }).terminals = [];
    (vscodeMock.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders =
      undefined;

    vi.mocked(vscodeMock.window.showErrorMessage).mockClear();
    vi.mocked(vscodeMock.window.showInformationMessage).mockClear();
    vi.mocked(vscodeMock.window.onDidChangeWindowState).mockClear();
    outputChannel.appendLine.mockClear();

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // FR-1 — await, catch, and surface reconciliation failures
  // -------------------------------------------------------------------
  describe("FR-1: await/catch/surface failures from the delayed self-heal check", () => {
    it("logs the error and shows an actionable error message pointing at the output channel when ensureHooksInstalled rejects", async () => {
      vi.mocked(ensureHooksInstalled).mockRejectedValueOnce(
        new Error("EPERM: operation not permitted, open 'settings.json'")
      );

      activate(makeContext());
      await vi.advanceTimersByTimeAsync(3000);

      expect(
        outputChannel.appendLine,
        "the failure must be logged via src/output.ts's log(), not silently dropped"
      ).toHaveBeenCalled();
      const logged = outputChannel.appendLine.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("EPERM");

      expect(
        vscodeMock.window.showErrorMessage,
        "a silently swallowed rejection must not survive -- the user needs an actionable popup"
      ).toHaveBeenCalled();
      const shown = String(vi.mocked(vscodeMock.window.showErrorMessage).mock.calls[0][0]);
      expect(shown, "the error message must point the user at the output channel").toMatch(
        /output/i
      );
    });

    it("does not show an error or log a failure when ensureHooksInstalled resolves normally", async () => {
      vi.mocked(ensureHooksInstalled).mockResolvedValueOnce(true);

      activate(makeContext());
      await vi.advanceTimersByTimeAsync(3000);

      expect(vscodeMock.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it("still awaits ensureHooksInstalled even though it is not the last statement in the timer callback's surrounding code", async () => {
      // Regression guard for the "fire and forget" bug: if the callback
      // does not await ensureHooksInstalled(), a rejection becomes an
      // unhandled promise rejection instead of reaching the catch block --
      // this only shows up as a logged/surfaced error, so its presence is
      // the observable proof the await landed.
      vi.mocked(ensureHooksInstalled).mockRejectedValueOnce(new Error("EBUSY: locked"));

      activate(makeContext());
      await vi.advanceTimersByTimeAsync(3000);

      expect(vscodeMock.window.showErrorMessage).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // Resolution 1 — per-signature notification dedup for FR-1's error popup
  // -------------------------------------------------------------------
  describe("Resolution 1: FR-1 error popup is deduplicated per distinct signature per session", () => {
    it("shows the error popup only once when the same underlying failure repeats across a focus-triggered retry", async () => {
      vi.mocked(ensureHooksInstalled).mockRejectedValue(
        new Error("EPERM: dedup-signature-A persistent failure")
      );

      activate(makeContext());
      await vi.advanceTimersByTimeAsync(3000);

      const listener = capturedWindowStateListener();
      await listener({ focused: false });
      await listener({ focused: true }); // false->true edge: retries the check

      expect(
        vi.mocked(vscodeMock.window.showErrorMessage).mock.calls.length,
        "Resolution 1: repeated failures with an identical signature must produce at most one popup per session"
      ).toBe(1);
    });

    it("shows the error popup again for a genuinely different failure signature (not a one-shot latch)", async () => {
      vi.mocked(ensureHooksInstalled)
        .mockRejectedValueOnce(new Error("EPERM: dedup-signature-B first failure"))
        .mockRejectedValueOnce(new Error("EBUSY: dedup-signature-C second, different failure"));

      activate(makeContext());
      await vi.advanceTimersByTimeAsync(3000);

      const listener = capturedWindowStateListener();
      await listener({ focused: false });
      await listener({ focused: true });

      expect(
        vi.mocked(vscodeMock.window.showErrorMessage).mock.calls.length,
        "dedup must be keyed on the failure signature, not a single ever-notified latch -- a genuinely new signature must still surface"
      ).toBe(2);
    });
  });

  // -------------------------------------------------------------------
  // FR-3 — retry on window focus, not just on activate()
  // -------------------------------------------------------------------
  describe("FR-3: window-focus retry", () => {
    it("registers exactly one onDidChangeWindowState listener, pushed onto context.subscriptions for cleanup", () => {
      const context = makeContext();
      activate(context);

      expect(vscodeMock.window.onDidChangeWindowState).toHaveBeenCalledTimes(1);
      const returned = vi.mocked(vscodeMock.window.onDidChangeWindowState).mock.results[0]
        .value;
      expect(
        context.subscriptions,
        "the listener's disposable must be pushed onto context.subscriptions, matching every other disposable registration in activate()"
      ).toContain(returned);
    });

    it("re-runs the self-heal check only on the false->true focus edge, ignoring activity-only true events and already-focused state", async () => {
      const context = makeContext();
      activate(context);
      // Do not advance the initial 3s timer -- isolate call counts to the
      // focus-listener-triggered invocations only.
      vi.mocked(ensureHooksInstalled).mockClear();

      const listener = capturedWindowStateListener();

      await listener({ focused: false });
      expect(
        ensureHooksInstalled,
        "a transition to unfocused is not a rising edge and must not trigger a re-check"
      ).not.toHaveBeenCalled();

      await listener({ focused: true }); // genuine false->true edge
      expect(ensureHooksInstalled).toHaveBeenCalledTimes(1);

      await listener({ focused: true }); // activity-only change while already focused
      expect(
        ensureHooksInstalled,
        "onDidChangeWindowState also fires on activity-only changes while already focused -- must not re-trigger"
      ).toHaveBeenCalledTimes(1);
    });

    it("is retriable across multiple focus edges (no one-shot latch)", async () => {
      const context = makeContext();
      activate(context);
      vi.mocked(ensureHooksInstalled).mockClear();

      const listener = capturedWindowStateListener();

      await listener({ focused: false });
      await listener({ focused: true }); // 1st edge
      await listener({ focused: false });
      await listener({ focused: true }); // 2nd edge

      expect(
        ensureHooksInstalled,
        "a transient failure on one focus event must be retried on a later one -- no 'already attempted' latch"
      ).toHaveBeenCalledTimes(2);
    });
  });
});
