/**
 * Regression test for issue #111 — disposal-ownership after dedup.
 *
 * Companion to outputChannel.singleOwner.outputFirst.test.ts and
 * outputChannel.singleOwner.stateWatcherFirst.test.ts — see the former's
 * header for full context on the duplicate-channel bug.
 *
 * Before the fix, StateWatcher registered its own channel in its
 * disposables and disposed it — clearing its own private channel
 * singleton — from `dispose()`. The fix moves disposal ownership fully to
 * output.ts, so StateWatcher.dispose() must not touch any "Claude
 * Conductor" channel at all.
 *
 * This is the regression test for the specific failure mode a naive fix
 * could introduce (fixing the *creation* duplication but leaving disposal
 * wired to StateWatcher, which would tear the shared channel down out from
 * under other consumers such as sessionManager.ts's debugLog calls the
 * moment StateWatcher itself is disposed) — and it was *also* red against
 * the pre-fix code: StateWatcher used to own and dispose its own
 * "Claude Conductor" channel instance, so the assertion below ("no
 * Claude-Conductor channel instance was disposed by StateWatcher.dispose()")
 * failed pre-fix because that instance existed and got disposed.
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
import { getOutputChannel, log } from "../src/output";
import { StateWatcher } from "../src/stateWatcher";
import { SessionManager } from "../src/sessionManager";

type ChannelStub = {
  appendLine: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

/**
 * Every OutputChannelStub instance ever returned for a "Claude Conductor"
 * createOutputChannel call, in call order. Deliberately does not assume
 * there is exactly one — that invariant is covered separately by
 * outputChannel.singleOwner.outputFirst.test.ts / .stateWatcherFirst.test.ts;
 * this test only cares that whichever instance(s) exist are never disposed
 * by StateWatcher.
 */
function allClaudeConductorChannelStubs(): ChannelStub[] {
  const mockFn = vi.mocked(vscodeMock.window.createOutputChannel);
  return mockFn.mock.calls
    .map((call, i) => (call[0] === "Claude Conductor" ? mockFn.mock.results[i]?.value : undefined))
    .filter((v): v is ChannelStub => v !== undefined);
}

describe("output channel disposal ownership (issue #111)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as unknown as string);
    (vscodeMock.window as unknown as { terminals: unknown[] }).terminals = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("StateWatcher.dispose() does not dispose any \"Claude Conductor\" channel, and log() keeps working through output.ts's channel afterward", () => {
    getOutputChannel(); // ensure output.ts's shared channel exists before StateWatcher touches anything

    const sm = new SessionManager();
    const watcher = new StateWatcher(sm);

    watcher.dispose();

    for (const channel of allClaudeConductorChannelStubs()) {
      expect(
        channel.dispose,
        'StateWatcher.dispose() must not dispose a "Claude Conductor" output channel — ' +
          "disposal ownership belongs solely to output.ts"
      ).not.toHaveBeenCalled();
    }

    // debugLog()'s underlying log() must still route to output.ts's channel
    // and succeed after StateWatcher has been disposed.
    const sharedChannel = allClaudeConductorChannelStubs()[0];
    sharedChannel.appendLine.mockClear();

    expect(() => log("still alive after stateWatcher disposal")).not.toThrow();
    expect(sharedChannel.appendLine).toHaveBeenCalledOnce();
    expect(sharedChannel.appendLine.mock.calls[0][0]).toContain(
      "still alive after stateWatcher disposal"
    );

    sm.dispose();
  });
});
