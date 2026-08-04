import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../src/sessionManager";
import * as vscodeMock from "./mocks/vscode";

function makeTerminal(
  folderPath: string,
  processId: number
): import("vscode").Terminal {
  return {
    name: "claude · foo",
    show: vi.fn(),
    sendText: vi.fn(),
    dispose: vi.fn(),
    processId: Promise.resolve(processId),
    shellIntegration: undefined,
    creationOptions: { cwd: folderPath },
  } as unknown as import("vscode").Terminal;
}

describe("SessionManager close detection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vscodeMock.window.terminals.length = 0;
  });

  it("removes the matching folder when same-named terminal references differ", () => {
    let openCallback: ((terminal: import("vscode").Terminal) => void) | undefined;
    let closeCallback: ((terminal: import("vscode").Terminal) => void) | undefined;

    vi.spyOn(vscodeMock.window, "onDidOpenTerminal").mockImplementation((callback) => {
      openCallback = callback;
      return new vscodeMock.Disposable(() => {});
    });
    vi.spyOn(vscodeMock.window, "onDidCloseTerminal").mockImplementation((callback) => {
      closeCallback = callback;
      return new vscodeMock.Disposable(() => {});
    });

    const manager = new SessionManager();
    const sessionBTerminal = makeTerminal("/repo2/foo", 202);
    const sessionATerminal = makeTerminal("/repo1/foo", 101);

    expect(openCallback).toBeDefined();
    openCallback!(sessionBTerminal);
    openCallback!(sessionATerminal);

    const sessionB = manager.findSessionByFolder("/repo2/foo");
    expect(sessionB).toBeDefined();

    const swappedSessionAReference = makeTerminal("/repo1/foo", 999);
    expect(closeCallback).toBeDefined();
    closeCallback!(swappedSessionAReference);

    expect(manager.findSessionByFolder("/repo1/foo")).toBeUndefined();
    expect(manager.findSessionByFolder("/repo2/foo")).toBe(sessionB);
    expect(manager.count).toBe(1);

    manager.dispose();
  });

  it("falls back to PID when same-named terminals cannot be disambiguated by folder", async () => {
    let openCallback: ((terminal: import("vscode").Terminal) => void) | undefined;
    let closeCallback: ((terminal: import("vscode").Terminal) => void) | undefined;

    vi.spyOn(vscodeMock.window, "onDidOpenTerminal").mockImplementation((callback) => {
      openCallback = callback;
      return new vscodeMock.Disposable(() => {});
    });
    vi.spyOn(vscodeMock.window, "onDidCloseTerminal").mockImplementation((callback) => {
      closeCallback = callback;
      return new vscodeMock.Disposable(() => {});
    });

    const manager = new SessionManager();
    openCallback!(makeTerminal("/repo2/foo", 202));
    openCallback!(makeTerminal("/repo1/foo", 101));
    await Promise.resolve();

    const ambiguousClosedTerminal = {
      ...makeTerminal("/unused/foo", 101),
      creationOptions: {},
    } as import("vscode").Terminal;
    closeCallback!(ambiguousClosedTerminal);
    await Promise.resolve();

    expect(manager.findSessionByFolder("/repo1/foo")).toBeUndefined();
    expect(manager.findSessionByFolder("/repo2/foo")).toBeDefined();
    expect(manager.count).toBe(1);

    manager.dispose();
  });
});
