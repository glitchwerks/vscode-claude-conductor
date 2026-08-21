/**
 * Regression tests for issue #138 — "Open Claude Here" sometimes silently
 * does nothing: no new terminal opens, no session tab appears, and no error
 * is shown.
 *
 * `openClaudeHere` (extension.ts:231-262) only calls `showErrorMessage` when
 * `sessionManager.launchSession(...)` resolves `{ ok: false }`. It does not
 * appear to guard against `launchSession` rejecting outright. If the
 * underlying launch throws instead of resolving a result object — as can
 * happen when the reuse path's `focusSession` call touches a terminal that
 * is no longer usable (see sessionManager.staleReuse.test.ts for that
 * layer's contract) — the rejection has nowhere documented to go, matching
 * the reported symptom exactly: nothing opens, and no error is shown.
 *
 * These tests are blind to the actual root cause: they exercise the command
 * handler's observable contract only (does a launch failure that arrives as
 * a rejection ever surface to the user?), using the same
 * spyOn(SessionManager.prototype, "launchSession") mocking convention as
 * extension.openHere.test.ts (issue #107).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

// Must use vi.mock("fs") — same pattern as extension.openHere.test.ts —
// because ESM module namespaces are not reconfigurable via vi.spyOn.
vi.mock("fs");

vi.mock("vscode", async () => {
  const m = await import("./mocks/vscode");
  return m;
});

import * as vscodeMock from "./mocks/vscode";
import { activate } from "../src/extension";
import { SessionManager } from "../src/sessionManager";

interface FakeMemento {
  get: <T>(key: string, defaultValue?: T) => T | undefined;
  update: (key: string, value: unknown) => Promise<void>;
  keys: () => string[];
}

function makeMemento(initial: Record<string, unknown> = {}): FakeMemento {
  const data: Record<string, unknown> = { ...initial };
  return {
    get: <T>(key: string, defaultValue?: T) =>
      (key in data ? data[key] : defaultValue) as T | undefined,
    update: vi.fn(async (key: string, value: unknown) => {
      data[key] = value;
    }),
    keys: () => Object.keys(data),
  };
}

function makeContext(): import("vscode").ExtensionContext {
  const subscriptions: { dispose(): void }[] = [];
  return {
    subscriptions,
    globalState: makeMemento(),
  } as unknown as import("vscode").ExtensionContext;
}

/** Finds the most recently registered handler for the given command id. */
function capturedCommand(name: string): (...args: unknown[]) => unknown {
  const calls = vi.mocked(vscodeMock.commands.registerCommand).mock.calls;
  const matches = calls.filter((c) => c[0] === name);
  const last = matches[matches.length - 1];
  if (!last) throw new Error(`command not registered: ${name}`);
  return last[1] as (...args: unknown[]) => unknown;
}

function makeUri(fsPath: string): import("vscode").Uri {
  return { fsPath, path: `/DO-NOT-READ-THIS-PATH${fsPath}` } as unknown as import("vscode").Uri;
}

function mockStat(type: number): void {
  vi.mocked(vscodeMock.workspace.fs.stat).mockResolvedValue({
    type,
    ctime: 0,
    mtime: 0,
    size: 0,
  } as unknown as import("vscode").FileStat);
}

describe("claudeConductor.openHere / openHereFromFile — silent no-op on launch failure (issue #138)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as unknown as string);
    (vscodeMock.window as unknown as { terminals: unknown[] }).terminals = [];
    (vscodeMock.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders =
      undefined;
    // vi.restoreAllMocks() only restores vi.spyOn()-created spies to their
    // originals — it does not clear call history on the plain module-level
    // vi.fn()s test/mocks/vscode.ts exports (shared across every test in the
    // process, per the note in sessionManager.grouping.test.ts). Without
    // this, the second test in this file could pass vacuously off the first
    // test's showErrorMessage call.
    vi.mocked(vscodeMock.window.showErrorMessage).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("claudeConductor.openHere shows a user-visible error rather than letting a launchSession rejection escape silently", async () => {
    vi.spyOn(SessionManager.prototype, "launchSession").mockRejectedValue(
      new Error("Terminal has already been disposed")
    );
    mockStat(vscodeMock.FileType.Directory);

    const context = makeContext();
    activate(context);

    const uri = makeUri("C:/Users/chris/flaky-project");
    const handler = capturedCommand("claudeConductor.openHere");

    // The handler's own promise may or may not reject depending on whether
    // it currently catches launchSession's rejection — either way, the
    // assertion below is what actually matters: did the user ever see an
    // error? Swallow here so a missing catch doesn't fail the test for the
    // wrong reason (an escaping/unhandled rejection) instead of the right
    // one (no visible error).
    try {
      await handler(uri);
    } catch {
      // intentionally ignored — see comment above
    }

    expect(
      vscodeMock.window.showErrorMessage,
      "openClaudeHere must not let a launchSession rejection pass through unnoticed — issue #138's " +
        "reported symptom is exactly this: no new terminal, no session tab, and no error shown"
    ).toHaveBeenCalled();
  });

  it("claudeConductor.openHereFromFile shows a user-visible error rather than letting a launchSession rejection escape silently", async () => {
    vi.spyOn(SessionManager.prototype, "launchSession").mockRejectedValue(
      new Error("Terminal has already been disposed")
    );
    mockStat(vscodeMock.FileType.File);

    const context = makeContext();
    activate(context);

    const uri = makeUri("C:/Users/chris/flaky-project/file.ts");
    const handler = capturedCommand("claudeConductor.openHereFromFile");

    try {
      await handler(uri);
    } catch {
      // intentionally ignored — see the openHere test above
    }

    expect(
      vscodeMock.window.showErrorMessage,
      "openClaudeHereFromFile must not let a launchSession rejection pass through unnoticed — issue #138"
    ).toHaveBeenCalled();
  });
});
