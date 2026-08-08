/**
 * Regression test for issue #111 — duplicate "Claude Conductor" output channel.
 *
 * Companion to outputChannel.singleOwner.outputFirst.test.ts — see that
 * file's header for full context. This test exercises the "StateWatcher
 * initializes first" ordering, kept in its own file so both output.ts's
 * `_channel` and stateWatcher.ts's `_outputChannel` module singletons start
 * fresh (undefined) here, independent of the other ordering's test run.
 *
 * This is also the direct test for "src/stateWatcher.ts no longer owns a
 * channel": StateWatcher's constructor must not call
 * vscode.window.createOutputChannel itself at all — it must consume
 * output.ts's exported channel/log function instead. If StateWatcher were
 * still creating its own channel (src/stateWatcher.ts:22, current buggy
 * behavior), constructing it before output.ts's getOutputChannel() runs
 * would produce two calls total once output.ts creates its own.
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

describe("output channel single ownership (issue #111) — StateWatcher initializes first", () => {
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

  it('creates exactly one "Claude Conductor" output channel when StateWatcher initializes before output.ts (StateWatcher does not own a second channel)', () => {
    sm = new SessionManager();
    watcher = new StateWatcher(sm);

    getOutputChannel(); // output.ts's lazy singleton, forced *after* StateWatcher already exists

    expect(
      claudeConductorCallCount(),
      "StateWatcher's constructor must not call vscode.window.createOutputChannel " +
        "itself — it must consume output.ts's shared channel instead, regardless of " +
        "which module initializes first"
    ).toBe(1);
  });
});
