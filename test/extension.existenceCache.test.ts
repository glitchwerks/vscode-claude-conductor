/**
 * Regression tests for PR #77 CodeRabbit findings 7, 8, 9, 16, 19.
 *
 * Cluster A — LaunchResult / existenceCache consistency:
 *   SessionUriHandler.handleUri (src/extension.ts) launches a session via
 *   SessionManager.launchSession() but currently does not call
 *   existenceCache.markPresent()/markMissing() on the result, unlike the
 *   claudeConductor.openSession command handler (which is already correct).
 *   This produces stale "(missing)" indicators after a cross-window launch.
 *
 * Cluster B — startup cache population:
 *   PathExistenceCache.refresh() has no production call site. It must be
 *   invoked with the favorited paths at activation time, before the
 *   Favorites tree view first renders.
 *
 * Both bugs live in `activate()`, so both are exercised here by calling the
 * real `activate()` with a mocked `vscode` + `fs` and asserting on spies
 * attached to `PathExistenceCache.prototype` (activate() constructs its own
 * PathExistenceCache internally — it isn't injectable).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

// Must use vi.mock("fs") — same pattern as addFolderPrompt.stale.test.ts —
// because ESM module namespaces are not reconfigurable via vi.spyOn.
vi.mock("fs");

vi.mock("vscode", async () => {
  const m = await import("./mocks/vscode");
  return m;
});

import * as vscodeMock from "./mocks/vscode";
import { activate } from "../src/extension";
import { PathExistenceCache } from "../src/pathExistenceCache";

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

function makeContext(globalStateData: Record<string, unknown> = {}) {
  const subscriptions: { dispose(): void }[] = [];
  return {
    subscriptions,
    globalState: makeMemento(globalStateData),
  } as unknown as import("vscode").ExtensionContext;
}

/** Extracts the SessionUriHandler instance activate() registered. */
function capturedUriHandler(): { handleUri(uri: import("vscode").Uri): Promise<void> } {
  const calls = vi.mocked(vscodeMock.window.registerUriHandler).mock.calls;
  const last = calls[calls.length - 1];
  return last[0] as unknown as { handleUri(uri: import("vscode").Uri): Promise<void> };
}

describe("activate() — existenceCache consistency & startup population", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // Default fs: paths exist, no session-state files, mkdir is a no-op.
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as unknown as string);

    (vscodeMock.window as unknown as { terminals: unknown[] }).terminals = [];
    (vscodeMock.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders =
      undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Cluster A — SessionUriHandler.handleUri", () => {
    it("marks the folder present in existenceCache after a successful cross-window launch", async () => {
      const markPresentSpy = vi.spyOn(PathExistenceCache.prototype, "markPresent");
      const folderPath = "C:/proj";

      // The folder is already the open workspace, so handleUri takes the
      // "launch directly" branch instead of the "open a new window" branch.
      (vscodeMock.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
        { uri: { fsPath: folderPath } },
      ];
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const context = makeContext();
      activate(context);

      const handler = capturedUriHandler();
      const uri = new vscodeMock.Uri(
        "vscode",
        "cbeaulieu-gt.claude-conductor",
        "/launch",
        `folder=${encodeURIComponent(folderPath)}`,
        ""
      );

      await handler.handleUri(uri as unknown as import("vscode").Uri);

      expect(
        markPresentSpy,
        "existenceCache.markPresent must be called after handleUri launches successfully — mirrors the openSession command handler"
      ).toHaveBeenCalledWith(folderPath);
    }, 10_000);

    it("marks the folder missing in existenceCache when handleUri's launch reports 'missing'", async () => {
      const markMissingSpy = vi.spyOn(PathExistenceCache.prototype, "markMissing");
      const folderPath = "C:/does/not/exist";

      (vscodeMock.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
        { uri: { fsPath: folderPath } },
      ];
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const context = makeContext();
      activate(context);

      const handler = capturedUriHandler();
      const uri = new vscodeMock.Uri(
        "vscode",
        "cbeaulieu-gt.claude-conductor",
        "/launch",
        `folder=${encodeURIComponent(folderPath)}`,
        ""
      );

      await handler.handleUri(uri as unknown as import("vscode").Uri);

      expect(
        markMissingSpy,
        "existenceCache.markMissing must be called after handleUri's launchSession reports 'missing' — mirrors the openSession command handler"
      ).toHaveBeenCalledWith(folderPath);
    });
  });

  describe("Cluster B — startup cache population", () => {
    it("calls existenceCache.refresh() with the favorited paths at activation time", () => {
      const refreshSpy = vi.spyOn(PathExistenceCache.prototype, "refresh").mockResolvedValue(undefined);

      const favoritePaths = ["C:/favA", "C:/favB"];
      const context = makeContext({
        "claudeConductor.favorites": {
          version: 2,
          entries: favoritePaths.map((path) => ({ path })),
        },
      });

      activate(context);

      // Deliberately NOT asserting call order relative to createTreeView():
      // activate() is void-returning and can't await refresh(), and
      // FavoritesProvider already re-renders on cache.onDidChange("broad")
      // (treeView.ts), so firing the refresh right after createTreeView (or
      // inside a .then()) is equally correct — the visible data just arrives
      // via the change-event re-render instead of the first paint. Only the
      // "it was called, with the right paths" contract is load-bearing here.
      expect(
        refreshSpy,
        "existenceCache.refresh() must be called at activation time with the favorited paths — otherwise the Favorites view has no existence data until the first individual mark"
      ).toHaveBeenCalledWith(expect.arrayContaining(favoritePaths));
    });
  });
});
