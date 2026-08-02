import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Memento } from "vscode";

// getAllFolders must be mockable so Cluster G (below) can prove favorited
// rows stay flat even when getAllFolders() reports worktree children for
// them. Every pre-existing test in this file gets an empty default via the
// beforeEach below, so their flat rendering is unaffected.
vi.mock("../src/folderSource", () => ({
  getAllFolders: vi.fn(),
}));

import { FavoritesStore } from "../src/favoritesStore";
import { PathExistenceCache } from "../src/pathExistenceCache";
import { FavoritesProvider, VIEW_ITEM } from "../src/treeView";
import { getAllFolders } from "../src/folderSource";
import { TreeItemCollapsibleState } from "./mocks/vscode";

function makeMemento(): Memento {
  const data: Record<string, unknown> = {};
  return {
    keys: () => Object.keys(data),
    get: <T>(k: string) => data[k] as T | undefined,
    update: async (k: string, v: unknown) => { data[k] = v; },
  } as unknown as Memento;
}

describe("FavoritesProvider", () => {
  beforeEach(() => {
    vi.mocked(getAllFolders).mockResolvedValue([]);
  });

  it("returns empty children when store has no entries", async () => {
    const store = new FavoritesStore(makeMemento());
    const cache = new PathExistenceCache();
    const provider = new FavoritesProvider(store, cache);
    expect(await provider.getChildren()).toEqual([]);
  });

  it("renders a single favorite as a top-level row with projectRoot.favorited contextValue", async () => {
    const store = new FavoritesStore(makeMemento());
    await store.add("C:/proj");
    const cache = new PathExistenceCache();
    cache.markPresent("C:/proj");

    const provider = new FavoritesProvider(store, cache);
    const top = await provider.getChildren();
    expect(top).toHaveLength(1);
    expect(top[0].contextValue).toBe(VIEW_ITEM.PROJECT_ROOT_FAVORITED);
  });

  it("renders alphabetically (basename, full-path tiebreak)", async () => {
    const store = new FavoritesStore(makeMemento());
    await store.add("C:/zzz");
    await store.add("C:/aaa");
    await store.add("C:/mmm");
    const cache = new PathExistenceCache();
    const provider = new FavoritesProvider(store, cache);

    const top = await provider.getChildren();
    expect(top.map(n => n.label)).toEqual(["aaa", "mmm", "zzz"]);
  });

  it("alphabetical sort tiebreak: identical basenames sort by full path", async () => {
    const store = new FavoritesStore(makeMemento());
    await store.add("D:/zebra/aaa");
    await store.add("C:/alpha/aaa");
    const cache = new PathExistenceCache();
    const provider = new FavoritesProvider(store, cache);

    const top = await provider.getChildren();
    expect(top).toHaveLength(2);
    // Both rows have label "aaa"; their order is determined by the full-path tiebreak.
    // Lowercased full-path comparison: "c:/alpha/aaa" < "d:/zebra/aaa".
    expect((top[0] as { folderPath: string }).folderPath).toBe("C:/alpha/aaa");
    expect((top[1] as { folderPath: string }).folderPath).toBe("D:/zebra/aaa");
  });

  it("renders missing folder with (missing) description, dimmed icon, and locate command", async () => {
    const store = new FavoritesStore(makeMemento());
    await store.add("C:/missing");
    const cache = new PathExistenceCache();
    cache.markMissing("C:/missing");

    const provider = new FavoritesProvider(store, cache);
    const [row] = await provider.getChildren();

    expect(row.description).toBe("(missing)");
    expect(row.contextValue).toBe(VIEW_ITEM.PROJECT_ROOT_MISSING);
    expect(row.command).toEqual({
      command: "claudeConductor.locateFavorite",
      title: "Relocate Folder",
      arguments: ["C:/missing"],
    });
  });

  it("stale-missing renders identical to fresh-missing (no flicker regression)", async () => {
    vi.useFakeTimers();
    try {
      const store = new FavoritesStore(makeMemento());
      await store.add("C:/missing");
      const cache = new PathExistenceCache();
      cache.markMissing("C:/missing");
      vi.advanceTimersByTime(31_000);

      const provider = new FavoritesProvider(store, cache);
      const [row] = await provider.getChildren();
      expect(row.description).toBe("(missing)");
      expect(row.contextValue).toBe(VIEW_ITEM.PROJECT_ROOT_MISSING);
    } finally {
      vi.useRealTimers();
    }
  });

  it("optimistic-present on UNC paths (cache returns unknown)", async () => {
    const store = new FavoritesStore(makeMemento());
    await store.add("\\\\server\\share\\foo");
    const cache = new PathExistenceCache();

    const provider = new FavoritesProvider(store, cache);
    const [row] = await provider.getChildren();
    expect(row.description).not.toBe("(missing)");
    expect(row.contextValue).toBe(VIEW_ITEM.PROJECT_ROOT_FAVORITED);
  });

  it("renders all entries when storage drifts >25; getOverCapBanner returns banner string", async () => {
    const m = makeMemento();
    const seed = Array.from({ length: 30 }, (_, i) => ({ path: `C:/p${String(i).padStart(2, "0")}` }));
    await m.update("claudeConductor.favorites", { version: 2, entries: seed });

    const store = new FavoritesStore(m);
    const cache = new PathExistenceCache();
    const provider = new FavoritesProvider(store, cache);

    const top = await provider.getChildren();
    expect(top).toHaveLength(30);
    expect(provider.getOverCapBanner()).toMatch(/over the 25 cap.*consider removing/i);
  });

  it("addFavorite past cap: store rejects, provider state unchanged", async () => {
    const store = new FavoritesStore(makeMemento());
    for (let i = 0; i < 25; i++) await store.add(`C:/p${i}`);
    const cache = new PathExistenceCache();
    const provider = new FavoritesProvider(store, cache);

    const r = await store.add("C:/over");
    expect(r.ok).toBe(false);

    const top = await provider.getChildren();
    expect(top).toHaveLength(25);
  });

  // ---------------------------------------------------------------------
  // Cluster G — worktree paths are not represented under a favorited root.
  //
  // History: this cluster originally asserted the opposite — that a
  // favorited root with associated worktrees must render as a collapsible
  // GROUP row, mirroring RecentProjectsProvider's grouping contract
  // (test/treeView.test.ts). That assertion was adjudicated and reversed:
  // docs/specs/2026-04-28-75-favorites-design.md was revised to v5
  // (2026-08-02) as a *retroactive spec correction*, not a design change —
  // PR #77's CodeRabbit review (finding #3, .tmp/2026-08-01-pr77-triage.md)
  // flagged that the original spec text described two-level nesting that
  // was never implemented. `FavoritesStore.add()`/`.relocate()` reject
  // worktree paths outright, so a favorite is always a project root and
  // there is never a worktree child to nest (spec § Summary, § Missing-
  // Folder Behavior item 5: "Worktree children — none (worktrees aren't in
  // storage)"). The shipped flat implementation was kept; the spec text was
  // corrected to match it.
  // ---------------------------------------------------------------------
  describe("worktree paths are not represented under a favorited root", () => {
    it("a favorited root stays a flat leaf even when getAllFolders() reports worktree children for it", async () => {
      const root = "C:/proj";
      const wt1 = "C:/proj/.worktrees/feature-a";

      vi.mocked(getAllFolders).mockResolvedValue([
        { folderPath: root, name: "proj", parentDir: "C:/", source: "recent" },
        {
          folderPath: wt1,
          name: "feature-a",
          parentDir: "C:/proj/.worktrees",
          source: "recent",
        },
      ]);

      const store = new FavoritesStore(makeMemento());
      await store.add(root);
      const cache = new PathExistenceCache();
      cache.markPresent(root);

      const provider = new FavoritesProvider(store, cache);
      const top = await provider.getChildren();

      expect(top).toHaveLength(1);
      expect(
        top[0].collapsibleState,
        "a favorited root must stay a flat (None-collapsible) leaf even when getAllFolders() reports worktree children for it — FavoritesStore never stores worktree paths, so there is nothing to nest"
      ).toBe(TreeItemCollapsibleState.None);
      expect(top[0].contextValue).toBe(VIEW_ITEM.PROJECT_ROOT_FAVORITED);
    });

    // Companion case: same flat-leaf outcome when getAllFolders() reports no
    // worktrees at all. Together with the test above, this shows Favorites
    // rendering is invariant to getAllFolders() output — worktrees are
    // simply never represented, regardless of what that source returns.
    it("a favorited root with no worktrees stays a flat leaf row (no group wrapper)", async () => {
      vi.mocked(getAllFolders).mockResolvedValue([]);

      const store = new FavoritesStore(makeMemento());
      await store.add("C:/solo");
      const cache = new PathExistenceCache();
      cache.markPresent("C:/solo");

      const provider = new FavoritesProvider(store, cache);
      const top = await provider.getChildren();

      expect(top).toHaveLength(1);
      expect(
        top[0].collapsibleState,
        "a favorited root with no worktree children must stay a flat (None-collapsible) leaf, not a group"
      ).toBe(TreeItemCollapsibleState.None);
    });
  });
});
