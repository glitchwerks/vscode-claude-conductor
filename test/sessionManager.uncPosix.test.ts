/**
 * Regression test for PR #77 CodeRabbit findings 13, 17, 18, 22 (Cluster C —
 * CRITICAL).
 *
 * `isLikelyNetworkPath()` in src/sessionManager.ts only recognizes UNC paths
 * that literally start with "\\\\" or "//". launchSession() normalizes the
 * path via `path.normalize()` BEFORE running that check. On POSIX,
 * `path.normalize("//server/share/foo")` collapses the leading "//" down to
 * a single "/" (`"/server/share/foo"`), so the network-path check is
 * defeated post-normalize and the code falls through to a synchronous
 * `fs.existsSync()` call against a network path — exactly the hang the
 * check exists to avoid.
 *
 * `test/sessionManager.launchResult.test.ts` already covers the backslash
 * UNC form (`\\server\share\foo`), which — because path.normalize preserves
 * backslash-UNC form on both win32 and (moot) posix — never exercises the
 * defeated branch. This file forces posix path semantics via `vi.mock("path")`
 * so the forward-slash form's normalize-then-check defeat reproduces
 * deterministically regardless of the host OS running the test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

vi.mock("fs");

// Force POSIX path semantics for this file so the regression reproduces on
// any host OS (including this Windows dev machine, where the real
// win32 path.normalize does NOT collapse "//server/share/foo" and would
// mask the bug). CI runs on ubuntu-latest, where this matches real behavior.
vi.mock("path", async () => {
  const actual = await vi.importActual<typeof import("path")>("path");
  return { ...actual.posix, default: actual.posix };
});

vi.mock("vscode", async () => {
  const m = await import("./mocks/vscode");
  return m;
});

import { SessionManager } from "../src/sessionManager";
import * as vscodeMock from "./mocks/vscode";

describe("launchSession — UNC forward-slash form survives normalize() (Cluster C, critical)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the raw (un-normalized) network path as the terminal cwd, not path.normalize()'s output", async () => {
    // path.normalize("//server/share/foo") collapses the leading "//" down to
    // a single "/" under the posix semantics this file forces (see the
    // vi.mock("path") block above) — "/server/share/foo". If launchSession
    // hands that normalized string to vscode.window.createTerminal as `cwd`,
    // the terminal opens in the wrong (or a nonexistent) directory for UNC
    // targets. The raw, un-normalized folderPath must survive through to
    // `cwd` for any path isLikelyNetworkPath() recognizes.
    const rawNetworkPath = "//server/share/foo";

    const sm = new SessionManager();
    const r = await sm.launchSession(rawNetworkPath);
    expect(r.ok).toBe(true);

    const createTerminalMock = vi.mocked(vscodeMock.window.createTerminal);
    expect(
      createTerminalMock,
      "createTerminal must be called exactly once for a fresh launch"
    ).toHaveBeenCalledTimes(1);

    const options = createTerminalMock.mock.calls[0][0] as { cwd?: unknown };
    expect(
      options.cwd,
      `cwd passed to createTerminal must equal the raw network path ${JSON.stringify(rawNetworkPath)}, not a path.normalize()'d form — got ${JSON.stringify(options.cwd)}`
    ).toBe(rawNetworkPath);

    sm.dispose();
  }, 10_000);

  it("skips the fs.existsSync pre-flight for a forward-slash UNC path, even after path.normalize", async () => {
    // If the network-path check is defeated by normalize(), launchSession
    // falls through to fs.existsSync() against the (still-network) path.
    // Force it to report "missing" so a defeated check is unambiguously
    // observable via the returned LaunchResult, not just the call count.
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const sm = new SessionManager();
    const r = await sm.launchSession("//server/share/foo");

    // The pre-flight existsSync check must never run for a network path —
    // this is the actual behavior contract (mirrors the existing backslash
    // UNC test in sessionManager.launchResult.test.ts).
    expect(
      vi.mocked(fs.existsSync),
      "fs.existsSync must not be called for a forward-slash UNC path — the network-path check must fire on the raw path, not the post-normalize path"
    ).not.toHaveBeenCalled();

    expect(
      r.ok,
      "a forward-slash UNC path must skip the existence pre-flight and proceed to launch, just like the backslash UNC form"
    ).toBe(true);

    sm.dispose();
  }, 10_000);
});
