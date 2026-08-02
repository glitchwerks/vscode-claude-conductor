import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Memento } from "vscode";
import * as vscodeMock from "./mocks/vscode";
import { FavoritesStore, MAX_FAVORITES } from "../src/favoritesStore";

function makeMemento(initial?: unknown): Memento & { _data: Record<string, unknown>; updateCalls: unknown[] } {
  const data: Record<string, unknown> = {};
  if (initial !== undefined) data["claudeConductor.favorites"] = initial;
  const calls: unknown[] = [];
  const m = {
    _data: data,
    updateCalls: calls,
    keys: () => Object.keys(data),
    get: <T>(key: string) => data[key] as T | undefined,
    update: vi.fn(async (key: string, value: unknown) => {
      calls.push({ key, value });
      data[key] = value;
    }),
  };
  return m as unknown as Memento & { _data: Record<string, unknown>; updateCalls: unknown[] };
}

describe("FavoritesStore", () => {
  it("isFavorited returns false for empty store", () => {
    const s = new FavoritesStore(makeMemento());
    expect(s.isFavorited("C:/x")).toBe(false);
  });

  it("add, then isFavorited returns true (synchronous read after async add)", async () => {
    const s = new FavoritesStore(makeMemento());
    await s.add("C:/proj");
    expect(s.isFavorited("C:/proj")).toBe(true);
  });

  it("canonical-key dedup: two case-different paths collapse to one entry", async () => {
    const s = new FavoritesStore(makeMemento());
    await s.add("C:\\Foo");
    await s.add("c:/foo/");
    expect(s.list()).toEqual([{ path: "C:\\Foo" }]);
  });

  it("rejects worktree paths", async () => {
    const s = new FavoritesStore(makeMemento());
    const r = await s.add("C:/proj/.worktrees/fix");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/worktree/i);
    expect(s.list()).toEqual([]);
  });

  it("rejects past 25-entry cap", async () => {
    const s = new FavoritesStore(makeMemento());
    for (let i = 0; i < MAX_FAVORITES; i++) await s.add(`C:/p${i}`);
    const r = await s.add(`C:/over`);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cap/i);
    expect(s.list()).toHaveLength(MAX_FAVORITES);
  });

  it("relocate to canonical-equal path is a no-op with reason 'same-path'", async () => {
    const s = new FavoritesStore(makeMemento());
    await s.add("C:/Foo");
    const r = await s.relocate("C:/Foo", "c:\\foo\\");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/same/i);
    expect(s.list()).toEqual([{ path: "C:/Foo" }]);
  });

  it("relocate to a different existing entry drops the old, fires broad event", async () => {
    const s = new FavoritesStore(makeMemento());
    await s.add("C:/A");
    await s.add("C:/B");

    const events: unknown[] = [];
    s.onDidChange(e => events.push(e));

    const r = await s.relocate("C:/A", "C:/B");
    expect(r.ok).toBe(true);
    expect(s.list()).toEqual([{ path: "C:/B" }]);
    expect(events).toContainEqual({ kind: "broad" });
  });

  it("relocate to a brand-new path replaces entry path; fires single-path event", async () => {
    const s = new FavoritesStore(makeMemento());
    await s.add("C:/Old");

    const events: unknown[] = [];
    s.onDidChange(e => events.push(e));

    const r = await s.relocate("C:/Old", "C:/New");
    expect(r.ok).toBe(true);
    expect(s.list()).toEqual([{ path: "C:/New" }]);
    expect(events.some(e => (e as { kind: string }).kind === "single")).toBe(true);
  });

  it("v1 string[] storage is read but not written until first mutation (deferred migration)", async () => {
    const m = makeMemento(["C:/legacy1", "C:/legacy2"]);
    const s = new FavoritesStore(m);
    expect(s.list()).toEqual([{ path: "C:/legacy1" }, { path: "C:/legacy2" }]);
    expect(m.updateCalls).toEqual([]);

    await s.add("C:/new");
    expect(m.updateCalls).toHaveLength(1);
    const written = (m.updateCalls[0] as { value: unknown }).value as { version: number; entries: unknown[] };
    expect(written.version).toBe(2);
    expect(written.entries).toHaveLength(3);
  });

  it("future-version envelope renders best-effort, blocks writes", async () => {
    const m = makeMemento({ version: 99, entries: [{ path: "C:/futureA" }] });
    const s = new FavoritesStore(m);
    expect(s.list()).toEqual([{ path: "C:/futureA" }]);

    const r = await s.add("C:/blocked");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/version/i);
    expect(s.list()).toEqual([{ path: "C:/futureA" }]);
  });

  it("persist failure rolls back exactly one mutation (await-prior contract)", async () => {
    const m = makeMemento();
    let callCount = 0;
    m.update = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("simulated persist failure");
    });

    const s = new FavoritesStore(m);

    await s.add("C:/A").catch(() => undefined);
    await s.waitForIdle();
    expect(s.list()).toEqual([]);

    await s.add("C:/B");
    expect(s.list()).toEqual([{ path: "C:/B" }]);
  });

  it("apply throw is contained: state unchanged, no event fired", async () => {
    const s = new FavoritesStore(makeMemento());
    await s.add("C:/seed");
    const eventsBefore: unknown[] = [];
    s.onDidChange(e => eventsBefore.push(e));

    await expect(
      s._enqueueMutationForTest(() => { throw new Error("boom"); }, { kind: "broad" })
    ).rejects.toThrow("boom");

    expect(s.list()).toEqual([{ path: "C:/seed" }]);
    expect(eventsBefore).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // Cluster D — validation & concurrency (PR #77 CodeRabbit findings 10-12, 20)
  // ---------------------------------------------------------------------

  describe("malformed persisted data (finding 10)", () => {
    it("v2 envelope with a null entry does not crash rebuildIndex — invalid entries are filtered out", () => {
      const m = makeMemento({
        version: 2,
        entries: [null, { path: "C:/ok" }, "not-an-object", { path: 123 }],
      });

      let s: FavoritesStore | undefined;
      expect(() => {
        s = new FavoritesStore(m);
      }, "constructing FavoritesStore over malformed entries must not throw").not.toThrow();

      expect(s!.list()).toEqual([{ path: "C:/ok" }]);
    });

    it("legacy mixed-type v1 array does not crash and filters non-string entries", () => {
      const m = makeMemento(["C:/legacy-good", null, 42]);

      let s: FavoritesStore | undefined;
      expect(() => {
        s = new FavoritesStore(m);
      }, "constructing FavoritesStore over a mixed-type legacy array must not throw").not.toThrow();

      expect(s!.list()).toEqual([{ path: "C:/legacy-good" }]);
    });
  });

  describe("unsupported storage version warning (finding 11)", () => {
    it("shows a user-visible warning when the persisted envelope has an unsupported future version", () => {
      const warnSpy = vi.spyOn(vscodeMock.window, "showWarningMessage");
      const m = makeMemento({ version: 99, entries: [{ path: "C:/futureA" }] });

      new FavoritesStore(m);

      expect(
        warnSpy,
        "loading a storage envelope with an unsupported future version must surface a user-visible warning, not just block writes silently"
      ).toHaveBeenCalled();
    });
  });

  describe("concurrent mutation race (finding 12, test gap finding 20)", () => {
    it("concurrent add() calls do not push the store past MAX_FAVORITES (cap-check race)", async () => {
      const seedEntries = Array.from({ length: MAX_FAVORITES - 1 }, (_, i) => ({
        path: `C:/seed${i}`,
      }));
      const m = makeMemento({ version: 2, entries: seedEntries });
      const s = new FavoritesStore(m);
      expect(s.list()).toHaveLength(MAX_FAVORITES - 1);

      // Both calls run their synchronous cap-check (entries.length >= MAX_FAVORITES)
      // against the SAME pre-mutation snapshot before either awaits — validation
      // happens before enqueueMutation, so both currently pass.
      const p1 = s.add("C:/raceA");
      const p2 = s.add("C:/raceB");
      await Promise.all([p1, p2]);
      await s.waitForIdle();

      expect(
        s.list().length,
        "two concurrent add() calls must not both pass a stale cap check and exceed MAX_FAVORITES"
      ).toBeLessThanOrEqual(MAX_FAVORITES);
    });

    it("concurrent add() calls for the same canonical path do not create a duplicate entry (dedup race)", async () => {
      const m = makeMemento();
      const s = new FavoritesStore(m);

      // Both calls run their synchronous isFavorited() dedup-check against the
      // same pre-mutation snapshot (empty) before either awaits, so both
      // currently pass validation.
      const p1 = s.add("C:/Proj");
      const p2 = s.add("c:/proj");
      await Promise.all([p1, p2]);
      await s.waitForIdle();

      const matches = s.list().filter((e) => e.path.toLowerCase() === "c:/proj");
      expect(
        matches,
        "two concurrent add() calls for the same canonical path must not both persist a duplicate"
      ).toHaveLength(1);
    });
  });
});
