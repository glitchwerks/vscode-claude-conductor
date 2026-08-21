import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";

vi.mock("fs");

vi.mock("vscode", async () => {
  const m = await import("./mocks/vscode");
  return m;
});

import { SessionManager, SESSION_NAME_PREFIX } from "../src/sessionManager";
import * as vscodeMock from "./mocks/vscode";

function makeTerminal(folderPath: string): import("vscode").Terminal {
  return {
    name: `${SESSION_NAME_PREFIX}missed-close`,
    show: vi.fn(),
    sendText: vi.fn(),
    dispose: vi.fn(),
    processId: Promise.resolve(138),
    shellIntegration: undefined,
    creationOptions: { cwd: folderPath },
    exitStatus: undefined,
  } as unknown as import("vscode").Terminal;
}

describe("SessionManager reuse path — terminal missing from VS Code's live list", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vscodeMock.window.terminals = [];
    vi.mocked(vscodeMock.window.createTerminal).mockClear();
  });

  it("replaces a tracked terminal removed from window.terminals before reconcile runs", async () => {
    const folderPath = "/repo/missed-close";
    const staleTerminal = makeTerminal(folderPath);
    vscodeMock.window.terminals = [staleTerminal];

    const manager = new SessionManager();

    // Model the reconcile()-documented missed-close window: VS Code has
    // removed the terminal, but the poll tick has not evicted _sessions yet
    // and the orphaned terminal reference has no exitStatus.
    vscodeMock.window.terminals = [];

    const replacement = {
      ...makeTerminal(folderPath),
      shellIntegration: { executeCommand: vi.fn() },
    } as unknown as import("vscode").Terminal;
    vi.mocked(vscodeMock.window.createTerminal).mockReturnValue(replacement);

    const result = await manager.launchSession(folderPath);

    expect(result).toEqual({ ok: true, reused: false });
    expect(staleTerminal.show).not.toHaveBeenCalled();
    expect(vscodeMock.window.createTerminal).toHaveBeenCalledTimes(1);

    manager.dispose();
  });
});
