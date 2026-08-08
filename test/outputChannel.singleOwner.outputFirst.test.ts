/**
 * Regression test for issue #111 — duplicate "Claude Conductor" output channel.
 *
 * Before the fix, two independent call sites created a
 * `vscode.window.createOutputChannel("Claude Conductor")` channel:
 *   - src/output.ts        (the intended sole owner — creation + disposal)
 *   - src/stateWatcher.ts  (a second, disposal-owning copy)
 *
 * That produced two "Claude Conductor" entries in the Output panel dropdown
 * where there should be one. The fix makes src/output.ts the sole owner;
 * src/stateWatcher.ts no longer creates its own channel and instead imports
 * output.ts's shared `log` function (src/stateWatcher.ts:7).
 *
 * This test exercises the "output.ts initializes first" ordering. The
 * complementary "StateWatcher initializes first" ordering lives in
 * outputChannel.singleOwner.stateWatcherFirst.test.ts — kept in a SEPARATE
 * file rather than a second `it()` here because output.ts's `_channel` is a
 * module-level singleton that persists across every `it()` within one file
 * (see the note in test/debugLog.test.ts about not using vi.resetModules()
 * with the aliased vscode mock); only a fresh per-file module registry gives
 * each ordering a clean, unambiguous "channel not yet created" starting
 * state.
 *
 * This closes the blind spot in test/debugLog.test.ts:23 and
 * test/sessionManager.debugLog.test.ts:9, which index
 * `createOutputChannel.mock.results[0]` — an index that stays valid (and so
 * passes) even when a second, unwanted channel exists at index 1. This test
 * asserts an explicit call *count* instead, so a second call site is caught.
 * Those two files are deliberately left untouched: neither imports
 * src/stateWatcher.ts, and vitest gives each test file its own module
 * registry, so a count assertion added there would read exactly 1 today
 * (green, not red) and prove nothing about the duplicate call site. Now that
 * the real fix has landed, their existing `.mock.results[0]` index also
 * stays correct (only one channel will ever exist), so no edit to those
 * files is needed.
 *
 * vi.mock("fs") follows the same pattern as extension.openHere.test.ts —
 * StateWatcher touches the real filesystem (~/.claude/session-state) in its
 * constructor and poll loop, so fs must be mocked for a hermetic unit test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

vi.mock("fs");

vi.mock("vscode", async () => {
  const m = await import("./mocks/vscode");
  return m;
});

import * as vscodeMock from "./mocks/vscode";
import { getOutputChannel } from "../src/output";
import { StateWatcher } from "../src/stateWatcher";
import { SessionManager } from "../src/sessionManager";

function claudeConductorCallCount(): number {
  return vi
    .mocked(vscodeMock.window.createOutputChannel)
    .mock.calls.filter((c) => c[0] === "Claude Conductor").length;
}

describe("output channel single ownership (issue #111) — output.ts initializes first", () => {
  let sm: SessionManager | undefined;
  let watcher: StateWatcher | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as unknown as string);
    (vscodeMock.window as unknown as { terminals: unknown[] }).terminals = [];
    sm = undefined;
    watcher = undefined;
  });

  afterEach(() => {
    // Always tear down, even when the assertion below throws — otherwise
    // StateWatcher's real 2s setInterval poll timer outlives the test and
    // fires against mocks that restoreAllMocks() has already reset.
    watcher?.dispose();
    sm?.dispose();
    vi.restoreAllMocks();
  });

  it('creates exactly one "Claude Conductor" output channel when output.ts initializes before StateWatcher', () => {
    getOutputChannel(); // force output.ts's lazy singleton into existence

    sm = new SessionManager();
    watcher = new StateWatcher(sm);

    expect(
      claudeConductorCallCount(),
      'vscode.window.createOutputChannel("Claude Conductor") must be called exactly once ' +
        "total across the extension, not once per module that wants to log — two " +
        "independent call sites currently produce two Output-panel entries"
    ).toBe(1);
  });
});
