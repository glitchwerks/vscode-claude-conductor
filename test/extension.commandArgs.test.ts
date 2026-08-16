/**
 * Regression tests for a PR #77 CodeRabbit finding: `resolvePathArg`
 * (src/extension.ts) does not read the `.group.root` property exposed by
 * `ActiveGroupItem` / `RecentGroupItem` (src/treeView.ts), so favorite-toggle
 * and `openSession` commands silently no-op when invoked on a group row
 * (inline action button or context menu) instead of a leaf/session row.
 *
 * VS Code passes the raw `TreeItem` — not `command.arguments` — for inline
 * action buttons and context-menu entries. `ActiveGroupItem`/`RecentGroupItem`
 * expose their folder path only via `.group.root`; they have no top-level
 * `.folderPath` or `.path`, so `resolvePathArg` currently returns `undefined`
 * for them.
 *
 * CodeRabbit's exact ask: "Extend `resolvePathArg` to read `.group.root`,
 * route `openSession` through it, and add command-level regression tests
 * with actual tree items."
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

// Must use vi.mock("fs") — same pattern as extension.existenceCache.test.ts —
// because ESM module namespaces are not reconfigurable via vi.spyOn.
vi.mock("fs");

vi.mock("vscode", async () => {
  const m = await import("./mocks/vscode");
  return m;
});

// Isolate the openSession fallback branch from quickPick's real implementation.
// This suite only cares whether a group-row arg reaches launchSession, not
// what the quick-pick fallback itself does when no path is resolved.
vi.mock("../src/quickPick", () => ({
  showQuickPick: vi.fn(),
  addFolderPrompt: vi.fn(),
}));

vi.mock("../src/folderSource", () => ({
  getAllFolders: vi.fn(),
}));

import * as vscodeMock from "./mocks/vscode";
import { activate } from "../src/extension";
import { FavoritesStore } from "../src/favoritesStore";
import type { FavoritesStore as FavoritesStoreType } from "../src/favoritesStore";
import { SessionManager } from "../src/sessionManager";
import type { ActiveSession } from "../src/sessionManager";
import { ActiveSessionsProvider, RecentProjectsProvider } from "../src/treeView";
import { getAllFolders } from "../src/folderSource";
import type { FolderEntry } from "../src/folderSource";
import { PathExistenceCache } from "../src/pathExistenceCache";
import type { PathExistenceCache as PathExistenceCacheType } from "../src/pathExistenceCache";

// ---------------------------------------------------------------------------
// Memento / ExtensionContext stubs (mirrors extension.existenceCache.test.ts)
// ---------------------------------------------------------------------------

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
function capturedCommand(name: string): (arg?: unknown) => unknown {
  const calls = vi.mocked(vscodeMock.commands.registerCommand).mock.calls;
  const matches = calls.filter((c) => c[0] === name);
  const last = matches[matches.length - 1];
  if (!last) throw new Error(`command not registered: ${name}`);
  return last[1] as (arg?: unknown) => unknown;
}

// ---------------------------------------------------------------------------
// Realistic tree-item construction.
//
// Neither ActiveGroupItem nor RecentGroupItem is exported from treeView.ts,
// so the only way to get a *real* instance (not a hand-shaped stub) is to go
// through the exported providers exactly as VS Code's tree view does.
// ---------------------------------------------------------------------------

function makeActiveSession(folderPath: string): ActiveSession {
  return {
    terminal: {
      name: `claude · ${folderPath.split(/[\\/]/).pop()}`,
      show: vi.fn(),
      sendText: vi.fn(),
      dispose: vi.fn(),
      processId: Promise.resolve(undefined),
      shellIntegration: undefined,
      creationOptions: { cwd: folderPath },
    } as unknown as import("vscode").Terminal,
    folderPath,
    folderName: folderPath.split(/[\\/]/).pop() ?? "",
    startedAt: new Date(),
    isIdle: false,
  };
}

function makeSessionManagerStub(sessions: ActiveSession[]) {
  return {
    get activeSessions() {
      return sessions;
    },
    onDidChangeSessions: () => ({ dispose: () => {} }),
  };
}

function makeInertFavoritesStore(): FavoritesStoreType {
  return {
    isFavorited: () => false,
    list: () => [],
    isOverCap: () => false,
    onDidChange: () => ({ dispose: () => {} }),
    add: async () => ({ ok: true }),
    remove: async () => undefined,
    relocate: async () => ({ ok: true }),
    waitForIdle: async () => undefined,
    dispose: () => {},
  } as unknown as FavoritesStoreType;
}

function makeInertExistenceCache(): PathExistenceCacheType {
  return {
    peek: () => ({ kind: "unknown" }) as const,
    markPresent: () => {},
    markMissing: () => {},
    evict: () => {},
    refresh: async () => {},
    onDidChange: () => ({ dispose: () => {} }),
    dispose: () => {},
  } as unknown as PathExistenceCacheType;
}

/** Builds a real ActiveGroupItem for `folderPath` via ActiveSessionsProvider. */
function makeActiveGroupItem(
  folderPath: string
): import("vscode").TreeItem & { group: { root: string } } {
  const provider = new ActiveSessionsProvider(
    makeSessionManagerStub([makeActiveSession(folderPath)]) as never,
    makeInertFavoritesStore()
  );
  const [group] = provider.getChildren(undefined);
  return group as unknown as import("vscode").TreeItem & { group: { root: string } };
}

/** Builds a real RecentGroupItem for `folderPath` via RecentProjectsProvider. */
async function makeRecentGroupItem(
  folderPath: string
): Promise<import("vscode").TreeItem & { group: { root: string } }> {
  const name = folderPath.split(/[\\/]/).pop() ?? folderPath;
  const entry: FolderEntry = { folderPath, name, parentDir: "C:/", source: "recent" };
  vi.mocked(getAllFolders).mockResolvedValue([entry]);

  const provider = new RecentProjectsProvider(
    makeSessionManagerStub([]) as never,
    makeInertFavoritesStore(),
    makeInertExistenceCache()
  );
  const [group] = await provider.getChildren(undefined);
  return group as unknown as import("vscode").TreeItem & { group: { root: string } };
}

describe("extension.ts command wiring — group-row tree-item args (PR #77 CodeRabbit)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it("claudeConductor.addFavorite acts on an ActiveGroupItem's .group.root", async () => {
    const addSpy = vi.spyOn(FavoritesStore.prototype, "add");
    const context = makeContext();
    activate(context);

    const groupItem = makeActiveGroupItem("C:/proj-active");
    const handler = capturedCommand("claudeConductor.addFavorite");

    await handler(groupItem);

    expect(
      addSpy,
      "addFavorite must resolve the path from an ActiveGroupItem's .group.root — VS Code passes the raw TreeItem (not command.arguments) for inline/context-menu invocations on group rows, and resolvePathArg only reads .folderPath/.path today"
    ).toHaveBeenCalledWith("C:/proj-active");
  });

  it("claudeConductor.removeFavorite acts on a RecentGroupItem's .group.root", async () => {
    const removeSpy = vi.spyOn(FavoritesStore.prototype, "remove");
    const context = makeContext();
    activate(context);

    const groupItem = await makeRecentGroupItem("C:/proj-recent");
    const handler = capturedCommand("claudeConductor.removeFavorite");

    await handler(groupItem);

    expect(
      removeSpy,
      "removeFavorite must resolve the path from a RecentGroupItem's .group.root — VS Code passes the raw TreeItem (not command.arguments) for inline/context-menu invocations on group rows, and resolvePathArg only reads .folderPath/.path today"
    ).toHaveBeenCalledWith("C:/proj-recent");
  });

  it("claudeConductor.openSession launches a RecentGroupItem's .group.root instead of falling back to the quick pick", async () => {
    const launchSpy = vi
      .spyOn(SessionManager.prototype, "launchSession")
      .mockResolvedValue({ ok: true, reused: false });
    const context = makeContext();
    activate(context);

    const groupItem = await makeRecentGroupItem("C:/proj-open");
    const handler = capturedCommand("claudeConductor.openSession");

    await handler(groupItem);

    expect(
      launchSpy,
      "openSession must route a group-row TreeItem argument through resolvePathArg (reading .group.root) and launch that folder, instead of treating any non-string arg as 'no folder' and falling back to the quick pick"
    ).toHaveBeenCalledWith("C:/proj-open");
  }, 10_000);
});

// ---------------------------------------------------------------------------
// claudeConductor.launchInWorkspaceFolder — QuickPick → launchSession flow
// (issue #103, FR-7, NFR-12d).
//
// The command shows a vscode.window.showQuickPick populated from
// vscode.workspace.workspaceFolders (name + path per item), then on
// selection calls sessionManager.launchSession(picked.uri.fsPath). It must
// reuse claudeConductor.openSession's existing result handling verbatim
// (src/extension.ts:181-188): on { ok: true } call
// existenceCache.markPresent(folderPath); on { ok: false, reason: "missing" }
// call existenceCache.markMissing(folderPath) AND
// vscode.window.showErrorMessage(result.message).
// ---------------------------------------------------------------------------

type LaunchSessionResult = Awaited<
  ReturnType<InstanceType<typeof SessionManager>["launchSession"]>
>;

describe("claudeConductor.launchInWorkspaceFolder — QuickPick → launchSession flow (issue #103, FR-7)", () => {
  const folderA = "C:/workspace-a";
  const folderB = "C:/workspace-b";

  function makeWorkspaceFolder(folderPath: string, index: number) {
    const name = folderPath.split(/[\\/]/).pop() ?? folderPath;
    return { uri: { fsPath: folderPath }, name, index };
  }

  /**
   * Resolves showQuickPick with whichever item the handler itself built at
   * `index` in the array it passed to showQuickPick — mirroring what a real
   * QuickPick returns (one of the items it was given), instead of assuming
   * a specific item shape (e.g. a `.uri` field) that the spec does not fix.
   * Only FR-7's `picked.uri.fsPath` read on the *resolved value* is a fixed
   * contract; the QuickPickItem shape the handler builds internally is not.
   */
  function mockPickIndex(index: number): void {
    vi.mocked(vscodeMock.window.showQuickPick).mockImplementationOnce(async (items) => {
      const arr = (Array.isArray(items) ? items : await items) as unknown[];
      return arr[index] as never;
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as unknown as string);
    (vscodeMock.window as unknown as { terminals: unknown[] }).terminals = [];
    (vscodeMock.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
      makeWorkspaceFolder(folderA, 0),
      makeWorkspaceFolder(folderB, 1),
    ];
    // vi.restoreAllMocks() restores vi.spyOn spies but does not clear call
    // history on the module-level vi.fn()s in mocks/vscode.ts — same reason
    // extension.hookSelfHeal.test.ts:102 mockClear()s showErrorMessage.
    vi.mocked(vscodeMock.window.showQuickPick).mockClear();
    vi.mocked(vscodeMock.window.showErrorMessage).mockClear();
    vi.mocked(vscodeMock.window.showWarningMessage).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("populates showQuickPick from vscode.workspace.workspaceFolders, one item per folder in order (FR-2, FR-7)", async () => {
    vi.mocked(vscodeMock.window.showQuickPick).mockResolvedValueOnce(undefined);
    const context = makeContext();
    activate(context);

    const handler = capturedCommand("claudeConductor.launchInWorkspaceFolder");
    await handler();

    expect(vscodeMock.window.showQuickPick).toHaveBeenCalledTimes(1);
    const itemsArg = vi.mocked(vscodeMock.window.showQuickPick).mock.calls[0][0];
    const items = (Array.isArray(itemsArg) ? itemsArg : await itemsArg) as Array<{
      label?: string;
      description?: string;
      uri?: { fsPath: string };
    }>;

    expect(items).toHaveLength(2);
    // Order matches vscode.workspace.workspaceFolders (FR-2's one-row-per-entry).
    expect(items[0].label).toBe("workspace-a");
    expect(items[1].label).toBe("workspace-b");

    // Each item must surface the full path somewhere (description and/or uri.fsPath).
    for (const item of items) {
      const pathSomewhere = item.description ?? item.uri?.fsPath ?? "";
      expect(pathSomewhere === folderA || pathSomewhere === folderB).toBe(true);
    }
  });

  it("on selection, calls sessionManager.launchSession(picked.uri.fsPath) (FR-7)", async () => {
    const launchSpy = vi
      .spyOn(SessionManager.prototype, "launchSession")
      .mockResolvedValue({ ok: true, reused: false } as LaunchSessionResult);
    mockPickIndex(1); // folderB, per the order asserted above

    const context = makeContext();
    activate(context);
    const handler = capturedCommand("claudeConductor.launchInWorkspaceFolder");

    await handler();

    expect(launchSpy).toHaveBeenCalledWith(folderB);
  }, 10_000);

  it("no selection (QuickPick dismissed) does not call launchSession", async () => {
    const launchSpy = vi.spyOn(SessionManager.prototype, "launchSession");
    vi.mocked(vscodeMock.window.showQuickPick).mockResolvedValueOnce(undefined);

    const context = makeContext();
    activate(context);
    const handler = capturedCommand("claudeConductor.launchInWorkspaceFolder");

    await handler();

    expect(launchSpy).not.toHaveBeenCalled();
  });

  it("on { ok: true } result, marks the folder present in existenceCache (FR-7, NFR-11)", async () => {
    vi.spyOn(SessionManager.prototype, "launchSession").mockResolvedValue({
      ok: true,
      reused: false,
    } as LaunchSessionResult);
    const markPresentSpy = vi.spyOn(PathExistenceCache.prototype, "markPresent");
    mockPickIndex(1); // folderB

    const context = makeContext();
    activate(context);
    const handler = capturedCommand("claudeConductor.launchInWorkspaceFolder");

    await handler();

    expect(markPresentSpy).toHaveBeenCalledWith(folderB);
  }, 10_000);

  it("on { ok: false, reason: 'missing' } result, marks the folder missing AND shows the error message (FR-7, NFR-11)", async () => {
    const missingMessage = `Folder no longer exists: ${folderB}`;
    vi.spyOn(SessionManager.prototype, "launchSession").mockResolvedValue({
      ok: false,
      reason: "missing",
      message: missingMessage,
    } as LaunchSessionResult);
    const markMissingSpy = vi.spyOn(PathExistenceCache.prototype, "markMissing");
    mockPickIndex(1); // folderB

    const context = makeContext();
    activate(context);
    const handler = capturedCommand("claudeConductor.launchInWorkspaceFolder");

    await handler();

    expect(
      markMissingSpy,
      "existenceCache.markMissing must be called on { ok: false, reason: 'missing' } — mirrors the openSession command handler (src/extension.ts:181-188)"
    ).toHaveBeenCalledWith(folderB);
    expect(
      vscodeMock.window.showErrorMessage,
      "vscode.window.showErrorMessage(result.message) must be called on the missing-folder branch — mirrors the openSession command handler (src/extension.ts:181-188)"
    ).toHaveBeenCalledWith(missingMessage);
  }, 10_000);

  // NFR-9: the 0-workspace-folders empty state reuses the existing
  // warning-message pattern (src/quickPick.ts:51-66), minus the "Add Folder"
  // action. Only "warns instead of launching" is asserted — the exact
  // message text and action list are not spelled out in the spec.
  it("with no workspace folders open, warns instead of showing the QuickPick or launching (NFR-9)", async () => {
    (vscodeMock.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders =
      undefined;
    const launchSpy = vi.spyOn(SessionManager.prototype, "launchSession");

    const context = makeContext();
    activate(context);
    // Clear post-activation: activation itself can surface user-facing
    // messages depending on fs mocks (see extension.hookSelfHeal.test.ts),
    // so the warning assertion below must be attributable to the command
    // handler, not to activate().
    vi.mocked(vscodeMock.window.showWarningMessage).mockClear();
    const handler = capturedCommand("claudeConductor.launchInWorkspaceFolder");

    await handler();

    expect(
      vscodeMock.window.showWarningMessage,
      "with zero workspace folders open, the command must warn (reusing quickPick.ts's empty-state pattern minus 'Add Folder') rather than show an empty QuickPick (NFR-9)"
    ).toHaveBeenCalled();
    expect(vscodeMock.window.showQuickPick).not.toHaveBeenCalled();
    expect(launchSpy).not.toHaveBeenCalled();
  });
});
