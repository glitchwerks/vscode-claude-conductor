/**
 * Tests for the grouped tree-view providers (src/treeView.ts).
 *
 * These tests exercise:
 *  - ActiveSessionsProvider: getChildren(undefined) returns group items;
 *    getChildren(group) returns leaf sessions.
 *  - RecentProjectsProvider: same two-level pattern.
 *  - Child-count in description for both phantom and non-phantom roots.
 *  - Phantom root: dimmed icon + "(not in recents)" suffix.
 *  - Dedup filter removed: active-session folders still appear in Recent Projects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ActiveSession } from "../src/sessionManager";
import type { FolderEntry } from "../src/folderSource";
import type { FavoritesStore as FavoritesStoreType } from "../src/favoritesStore";
import { FavoritesStore } from "../src/favoritesStore";
import type { PathExistenceCache as PathExistenceCacheType } from "../src/pathExistenceCache";
import { PathExistenceCache } from "../src/pathExistenceCache";

// ---------------------------------------------------------------------------
// Minimal stubs — keep them local so this test file is self-contained.
// ---------------------------------------------------------------------------

function makeSession(folderPath: string): ActiveSession {
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

function makeFolder(folderPath: string): FolderEntry {
  const parts = folderPath.split(/[\\/]/);
  return {
    folderPath,
    name: parts[parts.length - 1] ?? "",
    parentDir: parts.slice(0, -1).join("/"),
    source: "recent" as const,
  };
}

// ---------------------------------------------------------------------------
// Minimal SessionManager stub
// ---------------------------------------------------------------------------

function makeSessionManager(sessions: ActiveSession[]) {
  const listeners: Array<() => void> = [];
  return {
    get activeSessions() { return sessions; },
    onDidChangeSessions: (cb: () => void) => {
      listeners.push(cb);
      return { dispose: () => {} };
    },
  };
}

// ---------------------------------------------------------------------------
// Minimal FavoritesStore and PathExistenceCache stubs
// ---------------------------------------------------------------------------

function makeFakeFavoritesStore(): FavoritesStoreType {
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
  } as unknown as FavoritesStore;
}

function makeFakeExistenceCache(): PathExistenceCacheType {
  return {
    peek: () => ({ kind: "unknown" } as const),
    markPresent: () => {},
    markMissing: () => {},
    evict: () => {},
    refresh: async () => {},
    onDidChange: () => ({ dispose: () => {} }),
    dispose: () => {},
  } as unknown as PathExistenceCache;
}

// ---------------------------------------------------------------------------
// Import providers under test (after vi.mock declarations)
// ---------------------------------------------------------------------------

// We need getAllFolders to be mockable. Do this before the import.
vi.mock("../src/folderSource", () => ({
  getAllFolders: vi.fn(),
}));

// FR-3: alias-aware label rendering reads getFolderAlias() at render time.
// Mock the whole config module so each site's alias lookup is controllable
// per test; a bare vi.fn() (returning undefined by default) preserves every
// pre-existing test's basename-fallback behavior unchanged.
vi.mock("../src/config", () => ({
  getFolderAliases: vi.fn(),
  getFolderAlias: vi.fn(),
  setFolderAlias: vi.fn(),
  removeFolderAlias: vi.fn(),
  removeExtraFolder: vi.fn(),
  getClaudeCommand: vi.fn(),
  getReuseTerminal: vi.fn(),
  getEnableNotifications: vi.fn(),
  getExtraFolders: vi.fn(),
  getLaunchDelayMs: vi.fn(),
  getDebugLogging: vi.fn(),
}));

import {
  ActiveSessionsProvider,
  RecentProjectsProvider,
  WorkspaceFoldersProvider,
  FavoritesProvider,
  VIEW_ITEM,
} from "../src/treeView";
import { getAllFolders } from "../src/folderSource";
import { getFolderAlias } from "../src/config";
import {
  TreeItemCollapsibleState,
  ThemeIcon,
  ThemeColor,
  workspace,
} from "./mocks/vscode";

// ---------------------------------------------------------------------------
// ActiveSessionsProvider
// ---------------------------------------------------------------------------

describe("ActiveSessionsProvider — grouped tree", () => {
  const root = "/home/user/my-project";
  const wt1 = "/home/user/my-project/.worktrees/feature-a";
  const wt2 = "/home/user/my-project/.worktrees/fix-b";

  it("getChildren(undefined) returns group-level items (not flat sessions)", () => {
    const sessions = [makeSession(root), makeSession(wt1), makeSession(wt2)];
    const mgr = makeSessionManager(sessions);
    const provider = new ActiveSessionsProvider(mgr as never, makeFakeFavoritesStore());

    const topLevel = provider.getChildren(undefined);

    // Should return 1 group item, not 3 flat items
    expect(topLevel).toHaveLength(1);
    // Group item must be collapsible (Collapsed by default)
    expect(topLevel[0].collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
  });

  it("getChildren(groupItem) returns the group's session leaf items", () => {
    const sessions = [makeSession(root), makeSession(wt1), makeSession(wt2)];
    const mgr = makeSessionManager(sessions);
    const provider = new ActiveSessionsProvider(mgr as never, makeFakeFavoritesStore());

    const topLevel = provider.getChildren(undefined);
    const children = provider.getChildren(topLevel[0]);

    // 3 sessions under one root → group has 3 children
    expect(children).toHaveLength(3);
    // Each child should be a leaf (None collapsible state)
    for (const child of children) {
      expect(child.collapsibleState).toBe(TreeItemCollapsibleState.None);
    }
  });

  it("child count N appears in the group row description", () => {
    const sessions = [makeSession(root), makeSession(wt1)];
    const mgr = makeSessionManager(sessions);
    const provider = new ActiveSessionsProvider(mgr as never, makeFakeFavoritesStore());

    const topLevel = provider.getChildren(undefined);

    expect(topLevel[0].description).toContain("2");
  });

  it("worktree leaf description shows branch name, not parent directory", () => {
    const sessions = [makeSession(root), makeSession(wt1)];
    const mgr = makeSessionManager(sessions);
    const provider = new ActiveSessionsProvider(mgr as never, makeFakeFavoritesStore());

    const [group] = provider.getChildren(undefined);
    const children = provider.getChildren(group);

    const wtChild = children.find((c) => c.label === "feature-a" || String(c.description ?? "").includes("feature-a"));
    // The worktree leaf should reference the branch name somehow (label or description)
    const wtSession = sessions.find((s) => s.folderPath === wt1)!;
    const wtLeaf = children.find(
      (c) => c.label === "feature-a" || c.label === wtSession.folderName
    );
    expect(wtLeaf).toBeDefined();
    // Its description should be the branch name, NOT the full parent path
    expect(wtLeaf!.description).not.toContain("/home/user/my-project/.worktrees");
  });

  it("two different project roots → two group items at top level", () => {
    const rootB = "/home/user/project-b";
    const sessions = [makeSession(root), makeSession(rootB)];
    const mgr = makeSessionManager(sessions);
    const provider = new ActiveSessionsProvider(mgr as never, makeFakeFavoritesStore());

    const topLevel = provider.getChildren(undefined);
    expect(topLevel).toHaveLength(2);
  });

  it("single session with no worktrees still returns a group with 1 child", () => {
    const sessions = [makeSession(root)];
    const mgr = makeSessionManager(sessions);
    const provider = new ActiveSessionsProvider(mgr as never, makeFakeFavoritesStore());

    const topLevel = provider.getChildren(undefined);
    expect(topLevel).toHaveLength(1);
    expect(topLevel[0].collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);

    const children = provider.getChildren(topLevel[0]);
    expect(children).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// RecentProjectsProvider
// ---------------------------------------------------------------------------

describe("RecentProjectsProvider — grouped tree", () => {
  const root = "/home/user/my-project";
  const wt1 = "/home/user/my-project/.worktrees/feature-a";

  beforeEach(() => {
    vi.mocked(getAllFolders).mockResolvedValue([]);
  });

  it("getChildren(undefined) returns group items when folders include worktrees", async () => {
    vi.mocked(getAllFolders).mockResolvedValue([makeFolder(root), makeFolder(wt1)]);
    const mgr = makeSessionManager([]);
    const provider = new RecentProjectsProvider(mgr as never, makeFakeFavoritesStore(), makeFakeExistenceCache());

    const topLevel = await provider.getChildren(undefined);

    expect(topLevel).toHaveLength(1);
    expect(topLevel[0].collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
  });

  it("getChildren(groupItem) returns the group's folder leaf items", async () => {
    vi.mocked(getAllFolders).mockResolvedValue([makeFolder(root), makeFolder(wt1)]);
    const mgr = makeSessionManager([]);
    const provider = new RecentProjectsProvider(mgr as never, makeFakeFavoritesStore(), makeFakeExistenceCache());

    const topLevel = await provider.getChildren(undefined);
    const children = await provider.getChildren(topLevel[0]);

    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.collapsibleState).toBe(TreeItemCollapsibleState.None);
    }
  });

  it("child count appears in group description for non-phantom root", async () => {
    vi.mocked(getAllFolders).mockResolvedValue([makeFolder(root), makeFolder(wt1)]);
    const mgr = makeSessionManager([]);
    const provider = new RecentProjectsProvider(mgr as never, makeFakeFavoritesStore(), makeFakeExistenceCache());

    const topLevel = await provider.getChildren(undefined);

    expect(topLevel[0].description).toContain("2");
  });

  it("phantom root has (not in recents) suffix in description", async () => {
    // Only the worktree is in recents — the root itself is absent
    vi.mocked(getAllFolders).mockResolvedValue([makeFolder(wt1)]);
    const mgr = makeSessionManager([]);
    const provider = new RecentProjectsProvider(mgr as never, makeFakeFavoritesStore(), makeFakeExistenceCache());

    const topLevel = await provider.getChildren(undefined);

    expect(topLevel).toHaveLength(1);
    expect(topLevel[0].description).toContain("not in recents");
  });

  it("phantom root has a dimmed icon", async () => {
    vi.mocked(getAllFolders).mockResolvedValue([makeFolder(wt1)]);
    const mgr = makeSessionManager([]);
    const provider = new RecentProjectsProvider(mgr as never, makeFakeFavoritesStore(), makeFakeExistenceCache());

    const topLevel = await provider.getChildren(undefined);
    const icon = topLevel[0].iconPath as ThemeIcon;

    // Must be a ThemeIcon with a muted color token
    expect(icon).toBeInstanceOf(ThemeIcon);
    expect(icon.color).toBeInstanceOf(ThemeColor);
    expect(icon.color!.id).toContain("disabled");
  });

  it("active-session folders are NOT filtered out of Recent Projects (dedup removed)", async () => {
    // Previously the dedup filter excluded active-session paths from recents.
    // After this change, the same path may appear in both panels.
    vi.mocked(getAllFolders).mockResolvedValue([makeFolder(root)]);
    const mgr = makeSessionManager([makeSession(root)]);
    const provider = new RecentProjectsProvider(mgr as never, makeFakeFavoritesStore(), makeFakeExistenceCache());

    const topLevel = await provider.getChildren(undefined);

    // root should appear in Recent Projects even though it has an active session
    expect(topLevel).toHaveLength(1);
    const allItems = [...topLevel, ...(await provider.getChildren(topLevel[0]))];
    const hasFolderPath = allItems.some(
      (item) => (item as { folderPath?: string }).folderPath === root ||
                item.label === "my-project"
    );
    expect(hasFolderPath).toBe(true);
  });

  it("two project roots → two group items at top level", async () => {
    const rootB = "/home/user/project-b";
    vi.mocked(getAllFolders).mockResolvedValue([makeFolder(root), makeFolder(rootB)]);
    const mgr = makeSessionManager([]);
    const provider = new RecentProjectsProvider(mgr as never, makeFakeFavoritesStore(), makeFakeExistenceCache());

    const topLevel = await provider.getChildren(undefined);
    expect(topLevel).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Recent Projects leaf contextValue (issue #79)
//
// PR #77 moved the projectRoot.favorited|unfavorited|missing contextValue to
// the group row so the favorites star lives there. That left the group row
// as the only thing carrying a projectRoot.* contextValue, which the
// openSession inline-menu clause matches — so the Launch Session play button
// now shows on the always-visible group row instead of the leaf row it used
// to live on. The fix (issue #79, "Option A") is a distinct contextValue for
// non-worktree leaf rows, separate from the group row's projectRoot.* token.
// ---------------------------------------------------------------------------

describe("RecentProjectsProvider — leaf contextValue for Launch Session (issue #79, split by source per FR-9/FR-10)", () => {
  const root = "/home/user/my-project";

  beforeEach(() => {
    vi.mocked(getAllFolders).mockResolvedValue([]);
  });

  it("a 'recent'-source non-worktree leaf row gets RECENT_PROJECT_LEAF_RECENT, distinct from the group row's projectRoot.* token (FR-9)", async () => {
    // makeFolder() hardcodes source: "recent".
    vi.mocked(getAllFolders).mockResolvedValue([makeFolder(root)]);
    const mgr = makeSessionManager([]);
    const provider = new RecentProjectsProvider(mgr as never, makeFakeFavoritesStore(), makeFakeExistenceCache());

    const topLevel = await provider.getChildren(undefined);
    const leaves = await provider.getChildren(topLevel[0]);

    expect(leaves).toHaveLength(1);
    expect(leaves[0].contextValue).toBe(VIEW_ITEM.RECENT_PROJECT_LEAF_RECENT);
    // And it must never collide with the group row's own contextValue —
    // otherwise a menu clause aimed at the leaf would also hit the group.
    expect(leaves[0].contextValue).not.toBe(topLevel[0].contextValue);
  });

  it("a 'configured'-source non-worktree leaf row gets RECENT_PROJECT_LEAF_CONFIGURED (FR-9)", async () => {
    const configuredEntry: FolderEntry = {
      folderPath: root,
      name: "my-project",
      parentDir: "/home/user",
      source: "configured",
    };
    vi.mocked(getAllFolders).mockResolvedValue([configuredEntry]);
    const mgr = makeSessionManager([]);
    const provider = new RecentProjectsProvider(mgr as never, makeFakeFavoritesStore(), makeFakeExistenceCache());

    const topLevel = await provider.getChildren(undefined);
    const leaves = await provider.getChildren(topLevel[0]);

    expect(leaves).toHaveLength(1);
    expect(leaves[0].contextValue).toBe(VIEW_ITEM.RECENT_PROJECT_LEAF_CONFIGURED);
    expect(leaves[0].contextValue).not.toBe(VIEW_ITEM.RECENT_PROJECT_LEAF_RECENT);
  });

  it("non-worktree leaf contextValue does not vary with the group's favorited state", async () => {
    // The leaf's Launch Session identity must not be entangled with the
    // group row's favorite/unfavorite/missing state — that state lives on
    // the group row only.
    vi.mocked(getAllFolders).mockResolvedValue([makeFolder(root)]);
    const mgr = makeSessionManager([]);
    const favoritesStore = {
      isFavorited: () => true,
      list: () => [],
      isOverCap: () => false,
      onDidChange: () => ({ dispose: () => {} }),
      add: async () => ({ ok: true }),
      remove: async () => undefined,
      relocate: async () => ({ ok: true }),
      waitForIdle: async () => undefined,
      dispose: () => {},
    } as unknown as FavoritesStoreType;
    const provider = new RecentProjectsProvider(mgr as never, favoritesStore, makeFakeExistenceCache());

    const topLevel = await provider.getChildren(undefined);
    expect(topLevel[0].contextValue).toBe(VIEW_ITEM.PROJECT_ROOT_FAVORITED);

    const leaves = await provider.getChildren(topLevel[0]);
    expect(leaves[0].contextValue).toBe(VIEW_ITEM.RECENT_PROJECT_LEAF_RECENT);
  });
});

// ---------------------------------------------------------------------------
// VIEW_ITEM constants
// ---------------------------------------------------------------------------

describe("VIEW_ITEM constants", () => {
  it("has all required tokens", () => {
    expect(VIEW_ITEM.PROJECT_ROOT_FAVORITED).toBe("projectRoot.favorited");
    expect(VIEW_ITEM.PROJECT_ROOT_UNFAVORITED).toBe("projectRoot.unfavorited");
    expect(VIEW_ITEM.PROJECT_ROOT_MISSING).toBe("projectRoot.missing");
    expect(VIEW_ITEM.WORKTREE_CHILD).toBe("worktreeChild");
    expect(VIEW_ITEM.ACTIVE_SESSION).toBe("activeSession");
  });

  // Issue #103, FR-4: new leaf-only token for Workspace Folders rows,
  // mirroring the (now-split, see below) Recent-Projects leaf token
  // precedent.
  it("has the WORKSPACE_FOLDER_LEAF token for Workspace Folders rows (issue #103, FR-4)", () => {
    expect(VIEW_ITEM.WORKSPACE_FOLDER_LEAF).toBe("workspaceFolderLeaf");
  });

  // FR-9/FR-10 (2026-08-16 sidebar-rename-delete-bulk-select spec): the
  // single RECENT_PROJECT_LEAF token issue #79 introduced is replaced by two
  // mutually exclusive sibling tokens, one per FolderEntry.source variant —
  // see the "RecentProjectsProvider — leaf contextValue" describe block
  // above for the per-source construction tests.
  it("has the two split RECENT_PROJECT_LEAF_CONFIGURED / RECENT_PROJECT_LEAF_RECENT tokens, and no longer the old combined token (FR-9/FR-10)", () => {
    expect(VIEW_ITEM.RECENT_PROJECT_LEAF_CONFIGURED).toBe("recentProjectLeaf.configured");
    expect(VIEW_ITEM.RECENT_PROJECT_LEAF_RECENT).toBe("recentProjectLeaf.recent");
    expect(
      Object.values(VIEW_ITEM),
      "the old un-split 'recentProjectLeaf' token must no longer be present"
    ).not.toContain("recentProjectLeaf");
  });
});

// ---------------------------------------------------------------------------
// WorkspaceFoldersProvider / WorkspaceFolderItem (issue #103)
//
// A 4th tree section, structurally similar to ActiveSessionsProvider /
// RecentProjectsProvider but flat (no group/leaf split) — exactly one row
// per vscode.workspace.workspaceFolders entry (FR-2). Each row's icon
// reflects active-session state by reusing ActiveSessionItem's exact
// icon-selection logic (FR-3): bell/editorWarning.foreground when the
// matched session is idle, terminal/testing.iconPassed otherwise, folder
// as the default when no session matches.
// ---------------------------------------------------------------------------

describe("WorkspaceFoldersProvider — one row per native workspace folder (issue #103)", () => {
  const folderA = "/home/user/workspace-a";
  const folderB = "/home/user/workspace-b";

  function makeWorkspaceFolder(
    folderPath: string,
    name?: string,
    index = 0
  ): import("vscode").WorkspaceFolder {
    const parts = folderPath.split(/[\\/]/);
    return {
      uri: { fsPath: folderPath },
      name: name ?? parts[parts.length - 1] ?? folderPath,
      index,
    } as unknown as import("vscode").WorkspaceFolder;
  }

  afterEach(() => {
    (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = undefined;
  });

  it("getChildren() returns exactly one row per vscode.workspace.workspaceFolders entry (FR-2, NFR-12b)", () => {
    (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
      makeWorkspaceFolder(folderA),
      makeWorkspaceFolder(folderB),
    ];
    const provider = new WorkspaceFoldersProvider(makeSessionManager([]) as never);

    const rows = provider.getChildren();

    expect(rows).toHaveLength(2);
  });

  it("row label is the folder basename and description is the full path (FR-2)", () => {
    (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
      makeWorkspaceFolder(folderA, "workspace-a"),
    ];
    const provider = new WorkspaceFoldersProvider(makeSessionManager([]) as never);

    const [row] = provider.getChildren();

    expect(row.label).toBe("workspace-a");
    expect(row.description).toBe(folderA);
  });

  it("row contextValue is VIEW_ITEM.WORKSPACE_FOLDER_LEAF (FR-4)", () => {
    (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
      makeWorkspaceFolder(folderA),
    ];
    const provider = new WorkspaceFoldersProvider(makeSessionManager([]) as never);

    const [row] = provider.getChildren();

    expect(row.contextValue).toBe(VIEW_ITEM.WORKSPACE_FOLDER_LEAF);
  });

  it("returns an empty array when vscode.workspace.workspaceFolders is undefined (NFR-13, undefined-safe)", () => {
    (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = undefined;
    const provider = new WorkspaceFoldersProvider(makeSessionManager([]) as never);

    expect(provider.getChildren()).toEqual([]);
  });

  describe("active-session icon selection (FR-3, reuses ActiveSessionItem's exact icon logic)", () => {
    it("no active session for the folder → default 'folder' ThemeIcon", () => {
      (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
        makeWorkspaceFolder(folderA),
      ];
      const provider = new WorkspaceFoldersProvider(makeSessionManager([]) as never);

      const [row] = provider.getChildren();
      const icon = row.iconPath as ThemeIcon;

      expect(icon).toBeInstanceOf(ThemeIcon);
      expect(icon.id).toBe("folder");
    });

    it("matching active session with isIdle=true → 'bell' icon, editorWarning.foreground color", () => {
      (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
        makeWorkspaceFolder(folderA),
      ];
      const session = makeSession(folderA);
      session.isIdle = true;
      const provider = new WorkspaceFoldersProvider(makeSessionManager([session]) as never);

      const [row] = provider.getChildren();
      const icon = row.iconPath as ThemeIcon;

      expect(icon).toBeInstanceOf(ThemeIcon);
      expect(icon.id).toBe("bell");
      expect(icon.color).toBeInstanceOf(ThemeColor);
      expect(icon.color!.id).toBe("editorWarning.foreground");
    });

    it("matching active session with isIdle=false → 'terminal' icon, testing.iconPassed color", () => {
      (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
        makeWorkspaceFolder(folderA),
      ];
      const session = makeSession(folderA);
      session.isIdle = false;
      const provider = new WorkspaceFoldersProvider(makeSessionManager([session]) as never);

      const [row] = provider.getChildren();
      const icon = row.iconPath as ThemeIcon;

      expect(icon).toBeInstanceOf(ThemeIcon);
      expect(icon.id).toBe("terminal");
      expect(icon.color).toBeInstanceOf(ThemeColor);
      expect(icon.color!.id).toBe("testing.iconPassed");
    });

    it("a session for a different folder does not affect this row's icon", () => {
      (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
        makeWorkspaceFolder(folderA),
      ];
      const otherSession = makeSession(folderB);
      const provider = new WorkspaceFoldersProvider(makeSessionManager([otherSession]) as never);

      const [row] = provider.getChildren();
      const icon = row.iconPath as ThemeIcon;

      expect(icon.id).toBe("folder");
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-panel star coupling + race regression
// ---------------------------------------------------------------------------

describe("Cross-panel star coupling", () => {
  function makeRealMemento(): import("vscode").Memento {
    const data: Record<string, unknown> = {};
    return {
      keys: () => Object.keys(data),
      get: <T>(k: string) => data[k] as T | undefined,
      update: async (k: string, v: unknown) => { data[k] = v; },
    } as unknown as import("vscode").Memento;
  }

  it("Recent Projects group row reflects favorited state immediately after store.add", async () => {
    const store = new FavoritesStore(makeRealMemento());
    const cache = new PathExistenceCache();
    const sm = makeSessionManager([]);

    vi.mocked(getAllFolders).mockResolvedValue([
      { folderPath: "C:/proj", name: "proj", parentDir: "C:", source: "recent" as const },
    ]);

    const provider = new RecentProjectsProvider(sm as never, store, cache);

    // Before add: group row contextValue should be unfavorited
    const groupsBefore = await provider.getChildren();
    expect(groupsBefore[0].contextValue).toBe(VIEW_ITEM.PROJECT_ROOT_UNFAVORITED);

    await store.add("C:/proj");

    // After add: group row contextValue is favorited
    const groupsAfter = await provider.getChildren();
    expect(groupsAfter[0].contextValue).toBe(VIEW_ITEM.PROJECT_ROOT_FAVORITED);
  });

  it("regression: group rows reflect live store state, not a stale snapshot", async () => {
    // Simulates the v1-blocker race: provider's getChildren(undefined) is called
    // AFTER getAllFolders() resolved, so the group-item construction reads the
    // store synchronously at construction time. If a mutation lands between
    // getAllFolders() resolving and a second getChildren() call, the new state
    // must be reflected.
    const store = new FavoritesStore(makeRealMemento());
    const cache = new PathExistenceCache();
    const sm = makeSessionManager([]);

    vi.mocked(getAllFolders).mockResolvedValue([
      { folderPath: "C:/proj", name: "proj", parentDir: "C:", source: "recent" as const },
    ]);

    const provider = new RecentProjectsProvider(sm as never, store, cache);

    // Step 1: fetch top-level groups (this is where getAllFolders is awaited)
    const groups = await provider.getChildren();
    expect(groups).toHaveLength(1);

    // Step 2: mutate the store.
    await store.add("C:/proj");

    // Step 3: re-fetch groups — they MUST reflect the latest store state.
    const groupsAfter = await provider.getChildren();
    expect(groupsAfter[0].contextValue).toBe(VIEW_ITEM.PROJECT_ROOT_FAVORITED);
  });
});

// ---------------------------------------------------------------------------
// ActiveSessionsProvider favorited contextValue
// ---------------------------------------------------------------------------

describe("ActiveSessionsProvider favorited contextValue", () => {
  it("group row reflects favorited state synchronously after store.add", async () => {
    const data: Record<string, unknown> = {};
    const memento = {
      keys: () => Object.keys(data),
      get: <T>(k: string) => data[k] as T | undefined,
      update: async (k: string, v: unknown) => { data[k] = v; },
    } as unknown as import("vscode").Memento;

    const store = new FavoritesStore(memento);
    const sm = makeSessionManager([
      makeSession("C:/proj"),
    ]);

    const provider = new ActiveSessionsProvider(sm as never, store);

    const groupsBefore = provider.getChildren();
    expect(groupsBefore[0].contextValue).toBe(VIEW_ITEM.PROJECT_ROOT_UNFAVORITED);

    await store.add("C:/proj");

    const groupsAfter = provider.getChildren();
    expect(groupsAfter[0].contextValue).toBe(VIEW_ITEM.PROJECT_ROOT_FAVORITED);
  });
});

// ---------------------------------------------------------------------------
// Alias-aware label rendering (FR-3)
//
// Every render site that currently computes a folder's display name from
// path.basename(...) must look up getFolderAlias(folderPath) first and fall
// back to the existing basename when unset. Covers the five FR-3 sites that
// live in this file: ActiveGroupItem, ActiveSessionItem, RecentGroupItem,
// RecentProjectItem, FavoriteLeafItem. (The other two FR-3 sites —
// quickPick.ts's active-session and folder quick-pick item labels — are out
// of scope for this file.)
// ---------------------------------------------------------------------------

describe("Alias-aware label rendering (FR-3)", () => {
  const root = "/home/user/my-project";

  beforeEach(() => {
    vi.mocked(getFolderAlias).mockReset();
    vi.mocked(getAllFolders).mockResolvedValue([]);
  });

  function makeRealMemento(): import("vscode").Memento {
    const data: Record<string, unknown> = {};
    return {
      keys: () => Object.keys(data),
      get: <T>(k: string) => data[k] as T | undefined,
      update: async (k: string, v: unknown) => { data[k] = v; },
    } as unknown as import("vscode").Memento;
  }

  describe("ActiveGroupItem", () => {
    it("uses the configured alias for the group root instead of the basename", () => {
      vi.mocked(getFolderAlias).mockImplementation((p: string) => (p === root ? "My Alias" : undefined));
      const provider = new ActiveSessionsProvider(
        makeSessionManager([makeSession(root)]) as never,
        makeFakeFavoritesStore()
      );

      const [group] = provider.getChildren(undefined);

      expect(group.label).toBe("My Alias");
    });

    it("falls back to the basename when no alias is configured for the group root", () => {
      vi.mocked(getFolderAlias).mockReturnValue(undefined);
      const provider = new ActiveSessionsProvider(
        makeSessionManager([makeSession(root)]) as never,
        makeFakeFavoritesStore()
      );

      const [group] = provider.getChildren(undefined);

      expect(group.label).toBe("my-project");
    });
  });

  describe("ActiveSessionItem", () => {
    it("uses the configured alias for the session's folder instead of session.folderName", () => {
      vi.mocked(getFolderAlias).mockImplementation((p: string) => (p === root ? "Session Alias" : undefined));
      const provider = new ActiveSessionsProvider(
        makeSessionManager([makeSession(root)]) as never,
        makeFakeFavoritesStore()
      );

      const [group] = provider.getChildren(undefined);
      const [leaf] = provider.getChildren(group);

      expect(leaf.label).toBe("Session Alias");
    });

    it("falls back to session.folderName (the basename) when no alias is configured", () => {
      vi.mocked(getFolderAlias).mockReturnValue(undefined);
      const provider = new ActiveSessionsProvider(
        makeSessionManager([makeSession(root)]) as never,
        makeFakeFavoritesStore()
      );

      const [group] = provider.getChildren(undefined);
      const [leaf] = provider.getChildren(group);

      expect(leaf.label).toBe("my-project");
    });
  });

  describe("RecentGroupItem", () => {
    it("uses the configured alias for the group root instead of the basename", async () => {
      vi.mocked(getFolderAlias).mockImplementation((p: string) => (p === root ? "Recent Alias" : undefined));
      vi.mocked(getAllFolders).mockResolvedValue([makeFolder(root)]);
      const provider = new RecentProjectsProvider(
        makeSessionManager([]) as never,
        makeFakeFavoritesStore(),
        makeFakeExistenceCache()
      );

      const [group] = await provider.getChildren(undefined);

      expect(group.label).toBe("Recent Alias");
    });

    it("falls back to the basename when no alias is configured for the group root", async () => {
      vi.mocked(getFolderAlias).mockReturnValue(undefined);
      vi.mocked(getAllFolders).mockResolvedValue([makeFolder(root)]);
      const provider = new RecentProjectsProvider(
        makeSessionManager([]) as never,
        makeFakeFavoritesStore(),
        makeFakeExistenceCache()
      );

      const [group] = await provider.getChildren(undefined);

      expect(group.label).toBe("my-project");
    });
  });

  describe("RecentProjectItem", () => {
    it("uses the configured alias for the folder instead of entry.name", async () => {
      vi.mocked(getFolderAlias).mockImplementation((p: string) => (p === root ? "Leaf Alias" : undefined));
      vi.mocked(getAllFolders).mockResolvedValue([makeFolder(root)]);
      const provider = new RecentProjectsProvider(
        makeSessionManager([]) as never,
        makeFakeFavoritesStore(),
        makeFakeExistenceCache()
      );

      const [group] = await provider.getChildren(undefined);
      const [leaf] = await provider.getChildren(group);

      expect(leaf.label).toBe("Leaf Alias");
    });

    it("falls back to entry.name (the basename) when no alias is configured", async () => {
      vi.mocked(getFolderAlias).mockReturnValue(undefined);
      vi.mocked(getAllFolders).mockResolvedValue([makeFolder(root)]);
      const provider = new RecentProjectsProvider(
        makeSessionManager([]) as never,
        makeFakeFavoritesStore(),
        makeFakeExistenceCache()
      );

      const [group] = await provider.getChildren(undefined);
      const [leaf] = await provider.getChildren(group);

      expect(leaf.label).toBe("my-project");
    });
  });

  describe("FavoriteLeafItem", () => {
    const folderPath = "C:/proj";

    it("uses the configured alias instead of the basename", async () => {
      vi.mocked(getFolderAlias).mockImplementation((p: string) => (p === folderPath ? "Fav Alias" : undefined));
      const store = new FavoritesStore(makeRealMemento());
      await store.add(folderPath);
      const cache = new PathExistenceCache();
      cache.markPresent(folderPath);
      const provider = new FavoritesProvider(store, cache);

      const [row] = await provider.getChildren();

      expect(row.label).toBe("Fav Alias");
    });

    it("falls back to the basename when no alias is configured", async () => {
      vi.mocked(getFolderAlias).mockReturnValue(undefined);
      const store = new FavoritesStore(makeRealMemento());
      await store.add(folderPath);
      const cache = new PathExistenceCache();
      cache.markPresent(folderPath);
      const provider = new FavoritesProvider(store, cache);

      const [row] = await provider.getChildren();

      expect(row.label).toBe("proj");
    });
  });
});

// ---------------------------------------------------------------------------
// Reactive re-render on claudeConductor.folderAliases config change (FR-5)
//
// ActiveSessionsProvider and RecentProjectsProvider additionally subscribe
// to vscode.workspace.onDidChangeConfiguration, firing _onDidChangeTreeData
// when e.affectsConfiguration("claudeConductor.folderAliases") is true — no
// existing test in this file exercised that event before this change (only
// sessionManager.onDidChangeSessions / favoritesStore.onDidChange /
// existenceCache.onDidChange were covered).
// ---------------------------------------------------------------------------

describe("Reactive re-render on claudeConductor.folderAliases config change (FR-5)", () => {
  beforeEach(() => {
    vi.mocked(workspace.onDidChangeConfiguration).mockClear();
  });

  /** Returns the listener registered by the most recently constructed provider. */
  function lastConfigChangeListener(): (e: { affectsConfiguration: (section: string) => boolean }) => void {
    const calls = vi.mocked(workspace.onDidChangeConfiguration).mock.calls;
    const last = calls[calls.length - 1];
    if (!last) throw new Error("onDidChangeConfiguration listener was not registered");
    return last[0] as (e: { affectsConfiguration: (section: string) => boolean }) => void;
  }

  it("ActiveSessionsProvider subscribes to onDidChangeConfiguration and fires its tree-data event when claudeConductor.folderAliases changes", () => {
    const provider = new ActiveSessionsProvider(makeSessionManager([]) as never, makeFakeFavoritesStore());
    let fired = 0;
    provider.onDidChangeTreeData(() => fired++);

    lastConfigChangeListener()({
      affectsConfiguration: (section) => section === "claudeConductor.folderAliases",
    });

    expect(fired).toBe(1);
  });

  it("ActiveSessionsProvider does NOT fire its tree-data event for an unrelated configuration change", () => {
    const provider = new ActiveSessionsProvider(makeSessionManager([]) as never, makeFakeFavoritesStore());
    let fired = 0;
    provider.onDidChangeTreeData(() => fired++);

    lastConfigChangeListener()({
      affectsConfiguration: (section) => section === "claudeConductor.claudeCommand",
    });

    expect(fired).toBe(0);
  });

  it("RecentProjectsProvider subscribes to onDidChangeConfiguration and fires its tree-data event when claudeConductor.folderAliases changes", () => {
    const provider = new RecentProjectsProvider(
      makeSessionManager([]) as never,
      makeFakeFavoritesStore(),
      makeFakeExistenceCache()
    );
    let fired = 0;
    provider.onDidChangeTreeData(() => fired++);

    lastConfigChangeListener()({
      affectsConfiguration: (section) => section === "claudeConductor.folderAliases",
    });

    expect(fired).toBe(1);
  });

  it("RecentProjectsProvider does NOT fire its tree-data event for an unrelated configuration change", () => {
    const provider = new RecentProjectsProvider(
      makeSessionManager([]) as never,
      makeFakeFavoritesStore(),
      makeFakeExistenceCache()
    );
    let fired = 0;
    provider.onDidChangeTreeData(() => fired++);

    lastConfigChangeListener()({
      affectsConfiguration: (section) => section === "claudeConductor.claudeCommand",
    });

    expect(fired).toBe(0);
  });
});
