/**
 * Regression tests for issue #138 — "Open Claude Here" sometimes silently
 * does nothing: no new terminal opens, no session tab appears, and no error
 * is shown.
 *
 * These tests pin the observable contract at the `SessionManager.launchSession`
 * layer, which is the signal `extension.ts`'s `openClaudeHere` trusts to decide
 * whether to show an error (it only calls `showErrorMessage` when
 * `result.ok === false` — see extension.ts:231-262). They do not assume or
 * exercise any particular fix location (e.g. a liveness check inside the
 * reuse branch vs. more robust close-event bookkeeping) — only that a
 * tracked session whose terminal has actually gone away must not be reused
 * as if it were live with nothing to show for it.
 *
 * Fixture note: `Terminal.exitStatus` is a real, documented VS Code API
 * (`readonly exitStatus: TerminalExitStatus | undefined`, set once the
 * terminal's process has exited) used here to represent "this tracked
 * terminal is actually dead" without presuming how (or whether) the
 * implementation currently inspects it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";

// Must use vi.mock("fs") — same pattern as sessionManager.launchResult.test.ts —
// because ESM module namespaces are not reconfigurable via vi.spyOn.
vi.mock("fs");

vi.mock("vscode", async () => {
  const m = await import("./mocks/vscode");
  return m;
});

import { SessionManager } from "../src/sessionManager";
import * as vscodeMock from "./mocks/vscode";

function makeTerminal(folderPath: string, processId: number): import("vscode").Terminal {
  return {
    name: "claude · stale-project",
    show: vi.fn(),
    sendText: vi.fn(),
    dispose: vi.fn(),
    processId: Promise.resolve(processId),
    shellIntegration: undefined,
    creationOptions: { cwd: folderPath },
    exitStatus: undefined,
  } as unknown as import("vscode").Terminal;
}

describe("SessionManager reuse path — dead tracked terminal (issue #138)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vscodeMock.window.terminals = [];
    vi.mocked(vscodeMock.window.createTerminal).mockClear();
  });

  it("does not silently report success for a tracked session whose terminal has already exited but the close event has not (yet) removed it", async () => {
    // Capture the open/close listeners the same way
    // sessionManager.closeDetection.test.ts does, so a session can be
    // registered without reading any private tracking internals.
    let openCallback: ((terminal: import("vscode").Terminal) => void) | undefined;
    vi.spyOn(vscodeMock.window, "onDidOpenTerminal").mockImplementation((callback) => {
      openCallback = callback;
      return new vscodeMock.Disposable(() => {});
    });
    vi.spyOn(vscodeMock.window, "onDidCloseTerminal").mockImplementation(() => {
      return new vscodeMock.Disposable(() => {});
    });

    const manager = new SessionManager();
    const folderPath = "/repo/stale-project";
    const terminal = makeTerminal(folderPath, 101);

    expect(openCallback).toBeDefined();
    openCallback!(terminal);

    // The terminal's underlying process has exited — real VS Code sets
    // exitStatus and onDidCloseTerminal *should* fire, but this models the
    // exact race the reporter could not pin down a reliable trigger for
    // (issue #138: "no clear pattern"): the process is gone, yet the
    // close callback has not run (or did not match) before the user
    // right-clicks "Open Claude Here" again.
    Object.defineProperty(terminal, "exitStatus", {
      value: { code: 0, reason: 1 },
      configurable: true,
    });

    const result = await manager.launchSession(folderPath);

    const createdNewTerminal = vi.mocked(vscodeMock.window.createTerminal).mock.calls.length > 0;

    expect(
      result.ok === false || createdNewTerminal,
      "launchSession reused a tracked session whose terminal had already exited, but reported success " +
        "({ok:true}) without creating a new terminal — this is exactly the shape of issue #138's silent " +
        "no-op: extension.ts only shows an error when result.ok === false, so a false-positive {ok:true} " +
        "here means the command returns having visibly done nothing"
    ).toBe(true);

    manager.dispose();
  });
});
