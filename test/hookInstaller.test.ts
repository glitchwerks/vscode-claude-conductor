/**
 * Tests for hook path reconciliation (issue #64).
 *
 * When the extension updates, VS Code installs it to a new directory. The
 * hook entries in ~/.claude/settings.json embed an absolute path to
 * hooks/session-state.js inside the OLD extension directory. These tests
 * verify that:
 *  - hooksUpToDate() correctly detects stale vs current paths
 *  - reconcileHookPaths() rewrites every stale command preserving the action arg
 *  - ensureHooksInstalled() silently reconciles without prompting if paths are stale
 *  - No spurious write happens when paths are already current
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import { execSync } from "child_process";

// We mock fs so we don't touch the real ~/.claude/settings.json
vi.mock("fs");
// We mock child_process so tests never shell out to a real `where`/`which`
// process. resolveNodeBinary()'s PATH-lookup behavior is exercised via
// dependency injection in its own describe block below; this module mock
// exists only to back the getHookScriptPath integration tests, where DI
// isn't available (getHookScriptPath calls resolveNodeBinary() internally
// with its default, un-injected dependencies).
vi.mock("child_process");

// Unix-style paths used in unit tests for hooksUpToDate / reconcileHookPaths
// (those functions are purely string-based and platform-agnostic).
const OLD_PATH = "/c/Users/chris/.vscode/extensions/conductor-0.1.0";
const NEW_PATH = "/c/Users/chris/.vscode/extensions/conductor-0.2.0";

const OLD_SCRIPT_BASE_WIN = `/c/PROGRA~1/nodejs/node.exe ${OLD_PATH}/hooks/session-state.js`;
const NEW_SCRIPT_BASE_WIN = `/c/PROGRA~1/nodejs/node.exe ${NEW_PATH}/hooks/session-state.js`;

const OLD_SCRIPT_BASE_POSIX = `node ${OLD_PATH}/hooks/session-state.js`;
const NEW_SCRIPT_BASE_POSIX = `node ${NEW_PATH}/hooks/session-state.js`;

// Integration tests need platform-native extension paths so that path.join()
// inside getHookScriptPath() resolves correctly on the current OS.
// On Windows use backslash-separated "C:\Users\..." style; on POSIX use the
// forward-slash paths directly.
const OLD_EXT_PATH =
  process.platform === "win32"
    ? "C:\\Users\\chris\\.vscode\\extensions\\conductor-0.1.0"
    : "/c/Users/chris/.vscode/extensions/conductor-0.1.0";
const NEW_EXT_PATH =
  process.platform === "win32"
    ? "C:\\Users\\chris\\.vscode\\extensions\\conductor-0.2.0"
    : "/c/Users/chris/.vscode/extensions/conductor-0.2.0";

function makeSettingsWithHooks(scriptBase: string): Record<string, unknown> {
  return {
    hooks: {
      Notification: [
        {
          matcher: "idle_prompt",
          hooks: [{ type: "command", command: `${scriptBase} idle` }],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [{ type: "command", command: `${scriptBase} active` }],
        },
      ],
      Stop: [
        {
          hooks: [{ type: "command", command: `${scriptBase} stop` }],
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Import helpers under test AFTER setting up the vi.mock above
// ---------------------------------------------------------------------------
import {
  hooksUpToDate,
  reconcileHookPaths,
  getHookScriptPath,
  resolveNodeBinary,
} from "../src/hookInstaller.js";

describe("hooksUpToDate", () => {
  it("returns true when all hook commands match the expected script base", () => {
    const settings = makeSettingsWithHooks(NEW_SCRIPT_BASE_WIN);
    expect(hooksUpToDate(settings, NEW_SCRIPT_BASE_WIN)).toBe(true);
  });

  it("returns false when hook commands contain the marker but point at a different path", () => {
    const settings = makeSettingsWithHooks(OLD_SCRIPT_BASE_WIN);
    expect(hooksUpToDate(settings, NEW_SCRIPT_BASE_WIN)).toBe(false);
  });

  it("returns true for POSIX paths when they match", () => {
    const settings = makeSettingsWithHooks(NEW_SCRIPT_BASE_POSIX);
    expect(hooksUpToDate(settings, NEW_SCRIPT_BASE_POSIX)).toBe(true);
  });

  it("returns false for POSIX paths when stale", () => {
    const settings = makeSettingsWithHooks(OLD_SCRIPT_BASE_POSIX);
    expect(hooksUpToDate(settings, NEW_SCRIPT_BASE_POSIX)).toBe(false);
  });

  it("returns true when no hooks are installed at all (nothing to be stale)", () => {
    expect(hooksUpToDate({}, NEW_SCRIPT_BASE_WIN)).toBe(true);
  });
});

describe("reconcileHookPaths", () => {
  it("rewrites stale Windows-style paths to the new script base", () => {
    const settings = makeSettingsWithHooks(OLD_SCRIPT_BASE_WIN);
    reconcileHookPaths(settings, NEW_SCRIPT_BASE_WIN);

    const hooks = settings.hooks as Record<string, unknown[]>;
    const notifCmd = (
      (hooks.Notification[0] as Record<string, unknown[]>).hooks[0] as Record<
        string,
        string
      >
    ).command;
    expect(notifCmd).toBe(`${NEW_SCRIPT_BASE_WIN} idle`);

    const submitCmd = (
      (hooks.UserPromptSubmit[0] as Record<string, unknown[]>).hooks[0] as Record<
        string,
        string
      >
    ).command;
    expect(submitCmd).toBe(`${NEW_SCRIPT_BASE_WIN} active`);

    const stopCmd = (
      (hooks.Stop[0] as Record<string, unknown[]>).hooks[0] as Record<
        string,
        string
      >
    ).command;
    expect(stopCmd).toBe(`${NEW_SCRIPT_BASE_WIN} stop`);
  });

  it("rewrites stale POSIX-style paths to the new script base", () => {
    const settings = makeSettingsWithHooks(OLD_SCRIPT_BASE_POSIX);
    reconcileHookPaths(settings, NEW_SCRIPT_BASE_POSIX);

    const hooks = settings.hooks as Record<string, unknown[]>;
    const notifCmd = (
      (hooks.Notification[0] as Record<string, unknown[]>).hooks[0] as Record<
        string,
        string
      >
    ).command;
    expect(notifCmd).toBe(`${NEW_SCRIPT_BASE_POSIX} idle`);
  });

  it("preserves the trailing action arg after rewriting", () => {
    const settings = makeSettingsWithHooks(OLD_SCRIPT_BASE_WIN);
    reconcileHookPaths(settings, NEW_SCRIPT_BASE_WIN);

    const hooks = settings.hooks as Record<string, unknown[]>;
    const stopCmd = (
      (hooks.Stop[0] as Record<string, unknown[]>).hooks[0] as Record<
        string,
        string
      >
    ).command;
    // Must end with " stop", not " idle" or " active"
    expect(stopCmd.endsWith(" stop")).toBe(true);
  });

  it("does not modify hooks that do not contain session-state.js", () => {
    const settings: Record<string, unknown> = {
      hooks: {
        Notification: [
          {
            hooks: [{ type: "command", command: "some-other-tool notify" }],
          },
        ],
      },
    };
    reconcileHookPaths(settings, NEW_SCRIPT_BASE_WIN);
    const hooks = settings.hooks as Record<string, unknown[]>;
    const cmd = (
      (hooks.Notification[0] as Record<string, unknown[]>).hooks[0] as Record<
        string,
        string
      >
    ).command;
    expect(cmd).toBe("some-other-tool notify");
  });
});

// ---------------------------------------------------------------------------
// Integration: ensureHooksInstalled reconciles stale paths silently
// ---------------------------------------------------------------------------

import { ensureHooksInstalled } from "../src/hookInstaller.js";

// Minimal ExtensionContext stub
function makeContext(extensionPath: string) {
  return {
    extensionPath,
    globalState: {
      get: vi.fn().mockReturnValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    },
    subscriptions: [],
  } as unknown as import("vscode").ExtensionContext;
}

describe("ensureHooksInstalled — path reconciliation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // getHookScriptPath() calls resolveNodeBinary() internally on win32,
    // which by default shells out via child_process.execSync. Force it to
    // throw so these tests never depend on (or shell out to) whatever node
    // install happens to exist on the machine running the suite — combined
    // with fs.existsSync being reset to an unconfigured (falsy) mock above,
    // this deterministically drives resolveNodeBinary to its final
    // hardcoded fallback on every call, on every machine.
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("node: command not found");
    });
  });

  it("silently rewrites stale paths and returns true without prompting the user", async () => {
    // Build platform-correct script bases from the actual helper so the fixture
    // always matches the platform under test (Windows or Linux CI).
    const oldContext = makeContext(OLD_EXT_PATH);
    const newContext = makeContext(NEW_EXT_PATH);
    const oldScriptBase = getHookScriptPath(oldContext);
    const newScriptBase = getHookScriptPath(newContext);

    // Arrange: settings on disk have hooks pointing at OLD_PATH
    const oldSettings = makeSettingsWithHooks(oldScriptBase);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify(oldSettings)
    );
    const writeMock = fs.writeFileSync as ReturnType<typeof vi.fn>;
    writeMock.mockImplementation(() => {});

    // Sanity: old and new script bases must differ — otherwise the test is vacuous
    expect(oldScriptBase).not.toBe(newScriptBase);

    const { window } = await import("../test/mocks/vscode.js");
    const showInfoSpy = vi.spyOn(window, "showInformationMessage");

    const result = await ensureHooksInstalled(newContext);

    expect(result).toBe(true);
    // writeFileSync should have been called (settings were rewritten)
    expect(writeMock).toHaveBeenCalled();
    // showInformationMessage must NOT have been called with the consent prompt
    const consentCallArgs = showInfoSpy.mock.calls.find((args) =>
      String(args[0]).includes("requires adding hooks")
    );
    expect(consentCallArgs).toBeUndefined();
    // But a subtle info message about the update must have been shown
    const updateCallArgs = showInfoSpy.mock.calls.find((args) =>
      String(args[0]).includes("updated for new extension version")
    );
    expect(updateCallArgs).toBeDefined();
  });

  it("does not write settings when paths are already up to date", async () => {
    // Build the fixture from the same helper the implementation uses so the
    // expected script base matches on any platform (Windows or Linux CI).
    const context = makeContext(NEW_EXT_PATH);
    const currentScriptBase = getHookScriptPath(context);
    const currentSettings = makeSettingsWithHooks(currentScriptBase);

    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify(currentSettings)
    );
    const writeMock = fs.writeFileSync as ReturnType<typeof vi.fn>;
    writeMock.mockImplementation(() => {});

    const result = await ensureHooksInstalled(context);

    expect(result).toBe(true);
    expect(writeMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveNodeBinary (issue #104)
//
// getHookScriptPath() used to hardcode /c/PROGRA~1/nodejs/node.exe for every
// win32 hook command, which doesn't exist on a machine where node is only
// installed via a version manager (nvm4w, nvm-windows, volta) and there's no
// Program Files node install. resolveNodeBinary() replaces that hardcode
// with a PATH lookup, falling back to a short list of well-known install
// locations, and only falling back to the old hardcoded literal as a last
// resort so behavior never regresses to a crash.
//
// These tests use dependency injection (the deps?: { execSync, existsSync }
// param) rather than the module-level child_process/fs mocks above, so each
// case is self-contained and never depends on — or shells out to — whatever
// node install (if any) exists on the machine running the suite.
// ---------------------------------------------------------------------------

describe("resolveNodeBinary", () => {
  const isWin32 = process.platform === "win32";

  const PATH_LOOKUP_CMD = isWin32 ? "where node" : "which node";

  const FOUND_NODE_PATH = isWin32
    ? "C:\\Users\\dev\\AppData\\Roaming\\nvm\\v20.11.0\\node.exe"
    : "/home/dev/.nvm/versions/node/v20.11.0/bin/node";

  const OTHER_PATH_LINE = isWin32
    ? "C:\\Users\\dev\\AppData\\Roaming\\nvm\\v18.20.0\\node.exe"
    : "/home/dev/.nvm/versions/node/v18.20.0/bin/node";

  const STALE_PATH_ENTRY = isWin32
    ? "C:\\Users\\dev\\old-node-install\\node.exe"
    : "/opt/old-node-install/bin/node";

  // Common-path fallback candidates, in the order resolveNodeBinary should
  // try them.
  const FIRST_COMMON_PATH = isWin32 ? "C:\\Program Files\\nodejs\\node.exe" : "/usr/local/bin/node";
  const SECOND_COMMON_PATH = isWin32 ? "C:\\nvm4w\\nodejs\\node.exe" : "/usr/bin/node";

  // Last-resort literal — never throws, matches today's behavior so nothing
  // regresses to a crash.
  const FINAL_DEFAULT = isWin32 ? "C:\\Program Files\\nodejs\\node.exe" : "node";

  function makeDeps(
    execSyncImpl: () => string,
    existsSyncImpl: (path: string) => boolean
  ): { execSync: typeof execSync; existsSync: typeof fs.existsSync } {
    return {
      execSync: vi.fn(execSyncImpl) as unknown as typeof execSync,
      existsSync: vi.fn(existsSyncImpl) as unknown as typeof fs.existsSync,
    };
  }

  it("returns the first line of the PATH lookup result when it exists on disk", () => {
    const stdout = `${FOUND_NODE_PATH}\r\n${OTHER_PATH_LINE}\r\n`;
    const deps = makeDeps(
      () => stdout,
      (candidate) => candidate === FOUND_NODE_PATH
    );

    const result = resolveNodeBinary(deps);

    expect(result).toBe(FOUND_NODE_PATH);
    expect(deps.execSync).toHaveBeenCalledWith(PATH_LOOKUP_CMD, { encoding: "utf8" });
  });

  it("falls through to common-path probing when the PATH lookup command throws", () => {
    const deps = makeDeps(
      () => {
        throw new Error("command not found");
      },
      (candidate) => candidate === FIRST_COMMON_PATH
    );

    expect(resolveNodeBinary(deps)).toBe(FIRST_COMMON_PATH);
  });

  it("falls through to common-path probing when the resolved PATH entry does not exist on disk (stale PATH)", () => {
    const deps = makeDeps(
      () => `${STALE_PATH_ENTRY}\n`,
      (candidate) => candidate === FIRST_COMMON_PATH
    );

    expect(resolveNodeBinary(deps)).toBe(FIRST_COMMON_PATH);
  });

  it("picks the second common path when the first common path is absent", () => {
    const deps = makeDeps(
      () => {
        throw new Error("command not found");
      },
      (candidate) => candidate === SECOND_COMMON_PATH
    );

    expect(resolveNodeBinary(deps)).toBe(SECOND_COMMON_PATH);
  });

  it("returns the hardcoded default when nothing resolves", () => {
    const deps = makeDeps(
      () => {
        throw new Error("command not found");
      },
      () => false
    );

    expect(resolveNodeBinary(deps)).toBe(FINAL_DEFAULT);
  });

  describe("default dependencies", () => {
    beforeEach(() => {
      vi.mocked(execSync).mockReset();
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReset();
    });

    it("uses child_process.execSync and fs.existsSync when no deps object is passed", () => {
      vi.mocked(execSync).mockReturnValue(`${FOUND_NODE_PATH}\n`);
      (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
        (candidate: string) => candidate === FOUND_NODE_PATH
      );

      const result = resolveNodeBinary();

      expect(result).toBe(FOUND_NODE_PATH);
      expect(execSync).toHaveBeenCalledWith(PATH_LOOKUP_CMD, { encoding: "utf8" });
    });
  });
});

// ---------------------------------------------------------------------------
// getHookScriptPath — node binary quoting (issue #104)
//
// getHookScriptPath() delegates node-binary resolution to resolveNodeBinary()
// on win32. Whatever path comes back gets converted to git-bash form; if that
// path contains a space (e.g. a version-manager install under a user profile
// with a space in it, "C:\Users\John Doe\...") it must be wrapped in double
// quotes so Claude Code's hook command parsing doesn't split on the space.
// Only the node-binary segment is pinned below — the extension-path tail
// format isn't specified by the fix and is left to the implementer, so it's
// asserted loosely (via endsWith) rather than as an exact string match.
//
// Only meaningful on win32 — the git-bash conversion/quoting step is a
// win32-only concern (POSIX keeps the existing bare "node" literal
// unaffected by this fix), so these are gated to run only on win32. This
// project's CI "test" job runs on ubuntu-latest only, so these two cases are
// skipped there; a local `npx vitest run` on Windows is the verification of
// record for this behavior, consistent with the git-bash path-conversion
// logic elsewhere in getHookScriptPath already only being exercised when the
// suite itself runs on Windows.
//
// Assumption: each case here reconfigures execSync/existsSync and calls
// getHookScriptPath() independently, which assumes resolveNodeBinary() is
// NOT memoized at module scope across calls within a single process. If the
// implementation adds such caching (e.g. to avoid re-shelling-out on every
// hook install/reconcile), these two tests would need a cache-reset hook.
// ---------------------------------------------------------------------------

function toGitBashPath(winPath: string): string {
  return winPath
    .replace(/^([A-Za-z]):\\/, (_match, drive: string) => `/${drive.toLowerCase()}/`)
    .replace(/\\/g, "/");
}

describe("getHookScriptPath — node binary quoting", () => {
  const SPACED_NODE_PATH = "C:\\Users\\John Doe\\AppData\\Roaming\\nvm\\v20.11.0\\node.exe";
  const NVM4W_NODE_PATH = "C:\\nvm4w\\nodejs\\node.exe";

  beforeEach(() => {
    vi.mocked(execSync).mockReset();
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReset();
  });

  it.runIf(process.platform === "win32")(
    "quotes the resolved node binary segment when its path contains a space",
    () => {
      vi.mocked(execSync).mockReturnValue(`${SPACED_NODE_PATH}\r\n`);
      (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
        (candidate: string) => candidate === SPACED_NODE_PATH
      );

      const context = makeContext(NEW_EXT_PATH);
      const scriptBase = getHookScriptPath(context);

      const expectedNodeSegment = `"${toGitBashPath(SPACED_NODE_PATH)}"`;
      expect(scriptBase.startsWith(`${expectedNodeSegment} `)).toBe(true);
      expect(scriptBase.endsWith("/hooks/session-state.js")).toBe(true);
    }
  );

  it.runIf(process.platform === "win32")(
    "does not quote the resolved node binary segment when its path has no space",
    () => {
      // PATH lookup fails; Program Files is absent but nvm4w is present —
      // resolves via the second common-path candidate, which has no space.
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("command not found");
      });
      (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
        (candidate: string) => candidate === NVM4W_NODE_PATH
      );

      const context = makeContext(NEW_EXT_PATH);
      const scriptBase = getHookScriptPath(context);

      const expectedNodeSegment = toGitBashPath(NVM4W_NODE_PATH);
      expect(scriptBase.startsWith(`${expectedNodeSegment} `)).toBe(true);
      expect(scriptBase.endsWith("/hooks/session-state.js")).toBe(true);
      expect(scriptBase.startsWith('"')).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// getHookScriptPath — hook-script (extensionPath) quoting (issue #106)
//
// getHookScriptPath() quote-guards the resolved node-binary segment when it
// contains a space, but currently returns the hook-script segment — built
// from context.extensionPath via toGitBashPath() — completely unquoted. When
// the extension is installed under a path containing a space (a spaced
// username, a spaced VS Code extensions directory), the unquoted segment
// gets split into multiple shell arguments and the hook fails to start.
//
// These tests pin the fix: the hook-script segment must be independently
// quote-wrapped whenever context.extensionPath contains a space, regardless
// of whether the node-binary segment also needs quoting — and neither
// segment should be quoted when neither contains a space, so the fix doesn't
// over-quote.
//
// process.platform is stubbed to "win32" for the duration of this block
// (rather than gated with it.runIf) so these tests actually execute — and
// actually gate the merge — on this project's ubuntu-latest CI runner, not
// just on a contributor's Windows machine. This is safe: getHookScriptPath()
// branches on process.platform at call time, and the git-bash string
// conversion (toGitBashPath, both the implementation's and this file's
// mirror of it at module scope) is pure regex/string manipulation with no
// dependency on the actual host OS's path.join separator — any separator
// path.join happens to choose is normalized away by the global "\\" -> "/"
// replace, so the expected strings below are identical on Windows and Linux.
// ---------------------------------------------------------------------------

describe("getHookScriptPath — hook-script (extensionPath) quoting", () => {
  const SPACED_NODE_PATH = "C:\\Users\\John Doe\\AppData\\Roaming\\nvm\\v20.11.0\\node.exe";
  const NVM4W_NODE_PATH = "C:\\nvm4w\\nodejs\\node.exe";

  // Extension install path containing a space — e.g. a spaced Windows
  // username, or VS Code's default extensions directory when the user
  // profile itself has a space in it.
  const SPACED_EXT_PATH = "C:\\Users\\Some User\\extension";
  const UNSPACED_EXT_PATH = NEW_EXT_PATH; // already unspaced per the block above

  function expectedHookSegment(extensionPath: string): string {
    // Mirrors path.join(context.extensionPath, "hooks", "session-state.js")
    // on win32, followed by the same git-bash conversion applied elsewhere
    // in this file (toGitBashPath), so the expectation is independent of how
    // the implementation is written.
    return toGitBashPath(`${extensionPath}\\hooks\\session-state.js`);
  }

  function mockUnspacedNodeResolution(): void {
    // PATH lookup fails; Program Files is absent but nvm4w is present —
    // resolves via the second common-path candidate, which has no space.
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("command not found");
    });
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
      (candidate: string) => candidate === NVM4W_NODE_PATH
    );
  }

  function mockSpacedNodeResolution(): void {
    vi.mocked(execSync).mockReturnValue(`${SPACED_NODE_PATH}\r\n`);
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
      (candidate: string) => candidate === SPACED_NODE_PATH
    );
  }

  let realPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.mocked(execSync).mockReset();
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReset();
    realPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  });

  afterEach(() => {
    if (realPlatform) {
      Object.defineProperty(process, "platform", realPlatform);
    }
  });

  it("quotes the hook-script segment when extensionPath contains a space, independently of node-binary quoting", () => {
    mockUnspacedNodeResolution();

    const context = makeContext(SPACED_EXT_PATH);
    const scriptBase = getHookScriptPath(context);

    const hookSegment = expectedHookSegment(SPACED_EXT_PATH);
    const nodeSegment = toGitBashPath(NVM4W_NODE_PATH);

    // Hook-script segment must be quote-wrapped.
    expect(scriptBase).toContain(`"${hookSegment}"`);
    // Node-binary segment has no space, so it must remain unquoted.
    expect(scriptBase).not.toContain(`"${nodeSegment}"`);
    expect(scriptBase).toContain(nodeSegment);
  });

  it("quotes both segments independently when both the node path and extensionPath contain spaces", () => {
    mockSpacedNodeResolution();

    const context = makeContext(SPACED_EXT_PATH);
    const scriptBase = getHookScriptPath(context);

    const hookSegment = expectedHookSegment(SPACED_EXT_PATH);
    const nodeSegment = toGitBashPath(SPACED_NODE_PATH);

    // This is the case the current code gets wrong: it only quotes the
    // node-binary segment and leaves the hook-script segment bare.
    expect(scriptBase).toContain(`"${nodeSegment}"`);
    expect(scriptBase).toContain(`"${hookSegment}"`);
  });

  it("quotes neither segment when neither the node path nor extensionPath contains a space", () => {
    mockUnspacedNodeResolution();

    const context = makeContext(UNSPACED_EXT_PATH);
    const scriptBase = getHookScriptPath(context);

    const hookSegment = expectedHookSegment(UNSPACED_EXT_PATH);
    const nodeSegment = toGitBashPath(NVM4W_NODE_PATH);

    // Regression guard: the fix must not over-quote when there's nothing
    // to protect.
    expect(scriptBase).not.toContain('"');
    expect(scriptBase).toBe(`${nodeSegment} ${hookSegment}`);
  });
});

// ---------------------------------------------------------------------------
// reconcileHookPaths / hooksUpToDate — quoted script base round-trip
// (issue #106 regression guard)
//
// Quoting the hook-script segment in getHookScriptPath() changes the exact
// string written into, and compared against, ~/.claude/settings.json. This
// guard exercises hooksUpToDate/reconcileHookPaths against script bases
// built from spaced extension paths (via the real getHookScriptPath(), not
// hardcoded fixtures) so that if a future quoting fix breaks the
// stale/current comparison or the trailing-action-arg split, this test goes
// red alongside it. It is expected to pass both before and after the
// extensionPath-quoting fix lands — its job is to catch collateral damage,
// not to pin the fix itself.
// ---------------------------------------------------------------------------

describe("reconcileHookPaths — quoted script base round-trip (issue #106 regression guard)", () => {
  const OLD_SPACED_EXT_PATH =
    "C:\\Users\\Some User\\.vscode\\extensions\\conductor-0.1.0";
  const NEW_SPACED_EXT_PATH =
    "C:\\Users\\Some User\\.vscode\\extensions\\conductor-0.2.0";

  let realPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.mocked(execSync).mockReset();
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReset();
    // Deterministic node-binary resolution: PATH lookup fails and no
    // common-path candidate exists, so resolveNodeBinary falls through to
    // its hardcoded last-resort default for both old and new contexts —
    // isolating the variable under test to the extensionPath tail only.
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("command not found");
    });
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    realPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  });

  afterEach(() => {
    if (realPlatform) {
      Object.defineProperty(process, "platform", realPlatform);
    }
  });

  it("detects stale vs current script bases built from spaced extension paths", () => {
    const oldScriptBase = getHookScriptPath(makeContext(OLD_SPACED_EXT_PATH));
    const newScriptBase = getHookScriptPath(makeContext(NEW_SPACED_EXT_PATH));

    // Sanity: old and new script bases must differ, or the assertions below
    // are vacuous.
    expect(oldScriptBase).not.toBe(newScriptBase);

    const oldSettings = makeSettingsWithHooks(oldScriptBase);
    const newSettings = makeSettingsWithHooks(newScriptBase);

    expect(hooksUpToDate(oldSettings, newScriptBase)).toBe(false);
    expect(hooksUpToDate(newSettings, newScriptBase)).toBe(true);
  });

  it("preserves the trailing action arg when reconciling a quoted script base", () => {
    const oldScriptBase = getHookScriptPath(makeContext(OLD_SPACED_EXT_PATH));
    const newScriptBase = getHookScriptPath(makeContext(NEW_SPACED_EXT_PATH));

    const settings = makeSettingsWithHooks(oldScriptBase);
    reconcileHookPaths(settings, newScriptBase);

    const hooks = settings.hooks as Record<string, unknown[]>;
    const notifCmd = (
      (hooks.Notification[0] as Record<string, unknown[]>).hooks[0] as Record<
        string,
        string
      >
    ).command;
    const submitCmd = (
      (hooks.UserPromptSubmit[0] as Record<string, unknown[]>).hooks[0] as Record<
        string,
        string
      >
    ).command;
    const stopCmd = (
      (hooks.Stop[0] as Record<string, unknown[]>).hooks[0] as Record<
        string,
        string
      >
    ).command;

    expect(notifCmd).toBe(`${newScriptBase} idle`);
    expect(submitCmd).toBe(`${newScriptBase} active`);
    expect(stopCmd).toBe(`${newScriptBase} stop`);
  });
});
