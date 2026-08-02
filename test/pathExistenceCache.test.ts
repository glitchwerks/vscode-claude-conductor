import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

// Needed for the statWithTimeout error-type-distinction tests (finding 14),
// which exercise the real (non-injected) stat path via `fs.stat`. Every other
// test in this file uses the `_statForTest` DI seam and never touches `fs`,
// so mocking it here is a no-op for them.
vi.mock("fs");

import { PathExistenceCache } from "../src/pathExistenceCache";

describe("PathExistenceCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("peek returns unknown for an unseen path", () => {
    const cache = new PathExistenceCache();
    expect(cache.peek("C:/x")).toEqual({ kind: "unknown" });
  });

  it("markPresent flips state and fires single-path event", () => {
    const cache = new PathExistenceCache();
    const events: unknown[] = [];
    cache.onDidChange(e => events.push(e));

    cache.markPresent("C:/x");

    expect(cache.peek("C:/x")).toEqual({ kind: "exists" });
    expect(events).toEqual([{ kind: "single", path: "C:/x" }]);
  });

  it("markMissing flips state and fires single-path event", () => {
    const cache = new PathExistenceCache();
    cache.markMissing("C:/x");
    expect(cache.peek("C:/x")).toEqual({ kind: "missing", stale: false });
  });

  it("missing entries report stale=true after TTL but never collapse to unknown (v2 flicker regression)", () => {
    const cache = new PathExistenceCache();
    cache.markMissing("C:/x");
    vi.advanceTimersByTime(31_000);  // > 30s TTL
    expect(cache.peek("C:/x")).toEqual({ kind: "missing", stale: true });
  });

  it("exists entries collapse to unknown after TTL", () => {
    const cache = new PathExistenceCache();
    cache.markPresent("C:/x");
    vi.advanceTimersByTime(31_000);
    expect(cache.peek("C:/x")).toEqual({ kind: "unknown" });
  });

  it("markPresent after markMissing unsticks the entry (v3 stuck-missing regression)", () => {
    const cache = new PathExistenceCache();
    cache.markMissing("C:/x");
    expect(cache.peek("C:/x")).toEqual({ kind: "missing", stale: false });
    cache.markPresent("C:/x");
    expect(cache.peek("C:/x")).toEqual({ kind: "exists" });
  });

  it("evict removes the entry", () => {
    const cache = new PathExistenceCache();
    cache.markPresent("C:/x");
    cache.evict("C:/x");
    expect(cache.peek("C:/x")).toEqual({ kind: "unknown" });
  });

  it("canonical-key matching: case and separator insensitive", () => {
    const cache = new PathExistenceCache();
    cache.markPresent("C:\\Foo");
    expect(cache.peek("c:/foo")).toEqual({ kind: "exists" });
    expect(cache.peek("C:\\Foo\\")).toEqual({ kind: "exists" });
  });

  it("refresh skips UNC paths (\\\\server\\share style)", async () => {
    const cache = new PathExistenceCache();
    const statSpy = vi.fn();
    // Inject stat for testability:
    (cache as unknown as { _statForTest: typeof statSpy })._statForTest = statSpy;

    await cache.refresh(["\\\\server\\share\\foo", "//server/share/bar"]);

    expect(statSpy).not.toHaveBeenCalled();
    expect(cache.peek("\\\\server\\share\\foo")).toEqual({ kind: "unknown" });
  });

  // ---------------------------------------------------------------------
  // Cluster E — refresh() robustness (PR #77 CodeRabbit findings 14, 15, 21)
  // ---------------------------------------------------------------------

  describe("refresh() primary non-UNC path (test gap, finding 21)", () => {
    it("calls the injected stat function, updates the cache to exists, and fires a single broad event", async () => {
      const cache = new PathExistenceCache();
      const statFn = vi.fn().mockResolvedValue(true);
      (cache as unknown as { _statForTest: typeof statFn })._statForTest = statFn;

      const events: unknown[] = [];
      cache.onDidChange((e) => events.push(e));

      await cache.refresh(["C:/x"]);

      expect(statFn).toHaveBeenCalledWith("C:/x");
      expect(cache.peek("C:/x")).toEqual({ kind: "exists" });
      expect(events).toEqual([{ kind: "broad" }]);
    });

    it("calls the injected stat function and updates the cache to missing", async () => {
      const cache = new PathExistenceCache();
      const statFn = vi.fn().mockResolvedValue(false);
      (cache as unknown as { _statForTest: typeof statFn })._statForTest = statFn;

      await cache.refresh(["C:/y"]);

      expect(cache.peek("C:/y")).toEqual({ kind: "missing", stale: false });
    });

    it("a timed-out stat (resolves null) leaves the cache entry unchanged and fires no event", async () => {
      const cache = new PathExistenceCache();
      cache.markPresent("C:/z"); // known-exists baseline

      const statFn = vi.fn().mockResolvedValue(null);
      (cache as unknown as { _statForTest: typeof statFn })._statForTest = statFn;

      const events: unknown[] = [];
      cache.onDidChange((e) => events.push(e));

      await cache.refresh(["C:/z"]);

      expect(cache.peek("C:/z")).toEqual({ kind: "exists" });
      expect(events).toEqual([]);
    });
  });

  describe("statWithTimeout error-type distinction (finding 14)", () => {
    beforeEach(() => {
      vi.mocked(fs.stat).mockReset();
    });

    it("ENOENT is recorded as missing", async () => {
      vi.mocked(fs.stat).mockImplementation(((p: unknown, cb: (err: NodeJS.ErrnoException | null) => void) => {
        cb(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      }) as unknown as typeof fs.stat);

      const cache = new PathExistenceCache();
      await cache.refresh(["C:/gone"]);

      expect(cache.peek("C:/gone")).toEqual({ kind: "missing", stale: false });
    });

    it("EACCES does not silently collapse to 'missing' the same way ENOENT does", async () => {
      const cache = new PathExistenceCache();

      // Establish a known-exists baseline first.
      vi.mocked(fs.stat).mockImplementation(((p: unknown, cb: (err: NodeJS.ErrnoException | null) => void) => {
        cb(null);
      }) as unknown as typeof fs.stat);
      await cache.refresh(["C:/locked"]);
      expect(cache.peek("C:/locked")).toEqual({ kind: "exists" });

      // A permission error occurs on the next refresh.
      vi.mocked(fs.stat).mockImplementation(((p: unknown, cb: (err: NodeJS.ErrnoException | null) => void) => {
        cb(Object.assign(new Error("EACCES"), { code: "EACCES" }));
      }) as unknown as typeof fs.stat);
      await cache.refresh(["C:/locked"]);

      expect(
        cache.peek("C:/locked"),
        "a permission-denied stat error must not flip a known-exists path to the same 'missing' state ENOENT produces — either a distinct status or the prior known state should be preserved"
      ).not.toEqual({ kind: "missing", stale: false });
    });
  });
});
