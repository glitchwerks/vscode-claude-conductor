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

// ---------------------------------------------------------------------------
// Shared helpers for issue #128 (hook self-heal reliability) tests below.
//
// FR-6 adds a lockfile write (`~/.claude/settings.json.lock`) around the same
// readSettings()/writeSettings() sequence, going through the SAME
// fs.writeFileSync mock every other test in this file already uses to assert
// on settings.json writes. Without filtering it out, `writeMock.toHaveBeenCalled()`
// becomes vacuously true (a lock write satisfies it) and
// `writeMock.not.toHaveBeenCalled()` becomes a false negative the moment a
// lock is legitimately acquired-and-released around a no-op cycle. Every
// settings.json write assertion below (including the two pre-existing
// integration tests immediately following this block) routes through this
// helper instead of asserting on the raw writeFileSync mock.
// ---------------------------------------------------------------------------

function settingsWrites(mock: ReturnType<typeof vi.fn>): unknown[][] {
  return mock.mock.calls.filter((args) => {
    const p = String(args[0]);
    return p.includes("settings.json") && !p.endsWith(".lock");
  });
}

/**
 * Configures fs.readFileSync/fs.existsSync so FR-6's lockfile is always
 * reported absent (no contention) -- for tests that are not specifically
 * exercising FR-6's lock mechanics. Without this, an unconfigured
 * fs.existsSync auto-mock defaults to falsy for the lock path too, which is
 * harmless, but leaving fs.readFileSync unconfigured for a ".lock" read
 * would return `undefined` and could throw deep inside a stale-lock JSON
 * parse the test never intended to exercise.
 *
 * `extraExistsSync` lets a test differentiate specific non-lock paths (e.g.
 * "this recorded hook script path is missing") by returning a boolean, or
 * `undefined` to fall through to the default (present).
 */
function mockNoLockContention(
  settingsForRead: Record<string, unknown>,
  extraExistsSync?: (nativePath: string) => boolean | undefined
): void {
  (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
    const s = String(p);
    if (s.endsWith(".lock")) {
      throw Object.assign(new Error("ENOENT: no such file or directory"), {
        code: "ENOENT",
      });
    }
    return JSON.stringify(settingsForRead);
  });
  (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
    const s = String(p);
    if (s.endsWith(".lock")) {
      return false;
    }
    const override = extraExistsSync?.(s);
    if (override !== undefined) {
      return override;
    }
    return true;
  });
}

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

    // Arrange: settings on disk have hooks pointing at OLD_PATH. FR-2/FR-2a
    // (issue #128) add an fs.existsSync-gated check on top of the plain
    // string comparison this test originally exercised alone -- explicitly
    // report every non-lock path as present so this regression test keeps
    // exercising "paths differ, host is healthy, reconcile succeeds" rather
    // than accidentally tripping FR-2a's stale-host guard via an
    // unconfigured (falsy) existsSync auto-mock.
    mockNoLockContention(makeSettingsWithHooks(oldScriptBase));
    const writeMock = fs.writeFileSync as ReturnType<typeof vi.fn>;

    // Sanity: old and new script bases must differ — otherwise the test is vacuous
    expect(oldScriptBase).not.toBe(newScriptBase);

    const { window } = await import("../test/mocks/vscode.js");
    const showInfoSpy = vi.spyOn(window, "showInformationMessage");

    const result = await ensureHooksInstalled(newContext);

    expect(result).toBe(true);
    // writeFileSync should have been called against settings.json (settings
    // were rewritten) -- filtered via settingsWrites() so FR-6's lockfile
    // write, which goes through this same mock, doesn't make this vacuous.
    expect(settingsWrites(writeMock).length).toBeGreaterThanOrEqual(1);
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

    // FR-2/FR-2a (issue #128): explicitly report the recorded (== freshly
    // derived, since paths already match) script path as present on disk.
    // Without this, an unconfigured existsSync auto-mock defaults to falsy,
    // which would make FR-2a's stale-host guard fire a spurious reload
    // prompt on a genuinely healthy, already-up-to-date install.
    mockNoLockContention(currentSettings);
    const writeMock = fs.writeFileSync as ReturnType<typeof vi.fn>;

    const { window } = await import("../test/mocks/vscode.js");
    const showInfoSpy = vi.spyOn(window, "showInformationMessage");

    const result = await ensureHooksInstalled(context);

    expect(result).toBe(true);
    expect(settingsWrites(writeMock)).toHaveLength(0);
    const reloadCallArgs = showInfoSpy.mock.calls.find((args) =>
      /reload/i.test(String(args[0]))
    );
    expect(
      reloadCallArgs,
      "a healthy, already-up-to-date install must not trigger FR-2a's reload prompt"
    ).toBeUndefined();
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
  // A plain win32-style literal, independent of NEW_EXT_PATH (which
  // branches on the REAL process.platform at module-load time — on
  // ubuntu-latest CI that's "linux", so NEW_EXT_PATH resolves to an
  // already-POSIX-style path, and running that through toGitBashPath()
  // under this block's win32 stub mangles it). This block stubs
  // process.platform for its own duration, so its fixtures must be
  // self-contained win32 literals, matching SPACED_EXT_PATH above.
  const UNSPACED_EXT_PATH = "C:\\Users\\chris\\.vscode\\extensions\\conductor-0.2.0";

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

// ---------------------------------------------------------------------------
// Issue #128 — hook self-heal reliability
// (docs/specs/2026-08-15-hook-self-heal-reliability.md)
//
// FR-2 / FR-2a / FR-4 / FR-5 / FR-6 all live inside ensureHooksInstalled's
// already-installed branch. None of the requirements mandate a new exported
// helper function name for the recorded-path extraction or the lockfile
// mechanics, so every test below asserts on ensureHooksInstalled's
// OBSERVABLE behavior (whether settings.json gets written, whether a
// reload/error popup is shown) rather than on any particular internal helper
// shape -- consistent with leaving the implementer free to choose how the
// extraction and locking are structured internally.
// ---------------------------------------------------------------------------

describe("ensureHooksInstalled — FR-2: recorded-path existence check, independent of hooksUpToDate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("node: command not found");
    });
  });

  it("attempts reconciliation even when hooksUpToDate() reports true, because the recorded path is missing on disk -- but FR-2a blocks the write and surfaces a reload prompt instead, since the freshly-derived target is the same (also missing) path", async () => {
    // Recorded === freshly-derived script base, so hooksUpToDate() is
    // trivially true by string comparison alone. Old code (no FR-2) would
    // return true in total silence here. FR-2 must still notice the
    // recorded script file itself is gone and attempt to react -- and
    // because the freshly-derived target is the identical (missing) file,
    // FR-2a's guard is what determines the final, safe outcome (reload
    // prompt, no write) rather than an unbounded rewrite loop (Risk 5).
    const context = makeContext(NEW_EXT_PATH);
    const scriptBase = getHookScriptPath(context);
    const settings = makeSettingsWithHooks(scriptBase);

    // Sanity: hooksUpToDate() genuinely reports "up to date" for this
    // fixture -- otherwise this test wouldn't be isolating FR-2 at all.
    expect(hooksUpToDate(settings, scriptBase)).toBe(true);

    mockNoLockContention(settings, (p) => (p.includes("0.2.0") ? false : undefined));
    const writeMock = fs.writeFileSync as ReturnType<typeof vi.fn>;

    const { window } = await import("../test/mocks/vscode.js");
    const showInfoSpy = vi.spyOn(window, "showInformationMessage");

    const result = await ensureHooksInstalled(context);

    expect(result).toBe(true);
    expect(
      settingsWrites(writeMock),
      "FR-2a must block the write when the freshly-derived target is also missing"
    ).toHaveLength(0);

    const reloadCallArgs = showInfoSpy.mock.calls.find((args) =>
      /reload/i.test(String(args[0]))
    );
    expect(
      reloadCallArgs,
      "FR-2 must have noticed the recorded path was missing and attempted to react, even though hooksUpToDate() alone reported everything was fine"
    ).toBeDefined();
  });
});

describe("ensureHooksInstalled — FR-2a: does not block a legitimate reconcile when the freshly-derived target exists", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("node: command not found");
    });
  });

  it("writes the reconciled paths when the recorded path is missing but the currently-running host's own path exists", async () => {
    const oldContext = makeContext(OLD_EXT_PATH);
    const newContext = makeContext(NEW_EXT_PATH);
    const oldScriptBase = getHookScriptPath(oldContext);
    const newScriptBase = getHookScriptPath(newContext);
    const oldSettings = makeSettingsWithHooks(oldScriptBase);

    expect(oldScriptBase).not.toBe(newScriptBase);

    mockNoLockContention(oldSettings, (p) => {
      if (p.includes("0.1.0")) return false; // recorded (OLD) path missing
      if (p.includes("0.2.0")) return true; // freshly-derived (NEW) path healthy
      return undefined;
    });
    const writeMock = fs.writeFileSync as ReturnType<typeof vi.fn>;

    const result = await ensureHooksInstalled(newContext);

    expect(result).toBe(true);
    expect(settingsWrites(writeMock).length).toBeGreaterThanOrEqual(1);
  });
});

describe("ensureHooksInstalled — FR-2a reload prompt dedup (Resolution 1)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("node: command not found");
    });
  });

  it("shows the reload-window prompt only once per session for a persistent stale-host signature", async () => {
    // Uses a dedicated extension-path marker not reused by any other test in
    // this file, so this test's dedup count can't be polluted by a reload
    // prompt some other test already triggered against the module-level
    // dedup Set earlier in the same test run.
    const DEDUP_EXT_PATH =
      process.platform === "win32"
        ? "C:\\Users\\chris\\.vscode\\extensions\\conductor-dedup-signature-marker"
        : "/c/Users/chris/.vscode/extensions/conductor-dedup-signature-marker";

    const context = makeContext(DEDUP_EXT_PATH);
    const scriptBase = getHookScriptPath(context);
    const settings = makeSettingsWithHooks(scriptBase);

    mockNoLockContention(settings, (p) =>
      p.includes("conductor-dedup-signature-marker") ? false : undefined
    );

    const { window } = await import("../test/mocks/vscode.js");
    const showInfoSpy = vi.spyOn(window, "showInformationMessage");

    await ensureHooksInstalled(context);
    await ensureHooksInstalled(context); // simulates a second FR-3-triggered retry, same broken state

    const reloadCalls = showInfoSpy.mock.calls.filter((args) =>
      /reload/i.test(String(args[0]))
    );
    expect(
      reloadCalls,
      "Resolution 1: a persistent stale-host signature must produce at most one reload prompt per session"
    ).toHaveLength(1);
  });
});

describe("ensureHooksInstalled — Risk 6: recorded-path extraction across quoting and platform forms", () => {
  let realPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("node: command not found");
    });
    realPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  });

  afterEach(() => {
    if (realPlatform) {
      Object.defineProperty(process, "platform", realPlatform);
    }
  });

  it("correctly isolates the script segment when the Windows git-bash command has a quoted (spaced) script path", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    const staleContext = makeContext(
      "C:\\Users\\Some User\\.vscode\\extensions\\conductor-risk6-quoted-stale"
    );
    const healthyContext = makeContext(
      "C:\\Users\\chris\\.vscode\\extensions\\conductor-risk6-quoted-healthy"
    );
    const staleScriptBase = getHookScriptPath(staleContext);
    const healthyScriptBase = getHookScriptPath(healthyContext);

    // Sanity: this case is only meaningful if the recorded command actually
    // ends up quoted (a space forces quoting per src/hookInstaller.ts's
    // getHookScriptPath).
    expect(staleScriptBase).toContain('"');
    expect(staleScriptBase).not.toBe(healthyScriptBase);

    const settings = makeSettingsWithHooks(staleScriptBase);
    mockNoLockContention(settings, (p) =>
      p.includes("conductor-risk6-quoted-stale")
        ? false
        : p.includes("conductor-risk6-quoted-healthy")
          ? true
          : undefined
    );
    const writeMock = fs.writeFileSync as ReturnType<typeof vi.fn>;

    const result = await ensureHooksInstalled(healthyContext);

    expect(result).toBe(true);
    expect(
      settingsWrites(writeMock).length,
      "extraction must correctly strip the surrounding quotes to find the real script path, not misparse the quoted, spaced segment"
    ).toBeGreaterThanOrEqual(1);
  });

  it("correctly isolates the script segment when the Windows git-bash command is unquoted", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    // resolveNodeBinary()'s hardcoded last-resort default
    // ("C:\Program Files\nodejs\node.exe") itself contains a space, which
    // would quote the node segment regardless of the extensionPath under
    // test -- route node resolution to the second, unspaced common-path
    // candidate (nvm4w) throughout this whole test (including
    // ensureHooksInstalled's own internal getHookScriptPath call), so only
    // the script segment's quoting is under test here (mirrors this file's
    // existing "does not quote the resolved node binary segment" case
    // above). This test builds its own fs.existsSync implementation
    // (rather than mockNoLockContention's generic default-true fallback)
    // specifically so node-path resolution stays identical before and
    // during the ensureHooksInstalled() call below.
    const NVM4W_NODE_PATH = "C:\\nvm4w\\nodejs\\node.exe";
    const STALE_MARKER = "conductor-risk6-unquoted-stale";
    const HEALTHY_MARKER = "conductor-risk6-unquoted-healthy";
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith(".lock")) return false;
      if (s.includes(STALE_MARKER)) return false;
      if (s === NVM4W_NODE_PATH || s.includes(HEALTHY_MARKER)) return true;
      return false; // in particular: the spaced "Program Files" node candidate
    });

    const staleContext = makeContext(
      `C:\\Users\\chris\\.vscode\\extensions\\${STALE_MARKER}`
    );
    const healthyContext = makeContext(
      `C:\\Users\\chris\\.vscode\\extensions\\${HEALTHY_MARKER}`
    );
    const staleScriptBase = getHookScriptPath(staleContext);
    const healthyScriptBase = getHookScriptPath(healthyContext);

    expect(staleScriptBase).not.toContain('"');
    expect(staleScriptBase).not.toBe(healthyScriptBase);

    const settings = makeSettingsWithHooks(staleScriptBase);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith(".lock")) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return JSON.stringify(settings);
    });
    const writeMock = fs.writeFileSync as ReturnType<typeof vi.fn>;

    const result = await ensureHooksInstalled(healthyContext);

    expect(result).toBe(true);
    expect(settingsWrites(writeMock).length).toBeGreaterThanOrEqual(1);
  });

  it("correctly isolates the script segment when the command is POSIX form (`node /path/to/session-state.js action`)", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    const staleContext = makeContext("/home/dev/.vscode/extensions/conductor-risk6-posix-stale");
    const healthyContext = makeContext(
      "/home/dev/.vscode/extensions/conductor-risk6-posix-healthy"
    );
    const staleScriptBase = getHookScriptPath(staleContext);
    const healthyScriptBase = getHookScriptPath(healthyContext);

    expect(staleScriptBase.startsWith("node ")).toBe(true);
    expect(staleScriptBase).not.toBe(healthyScriptBase);

    const settings = makeSettingsWithHooks(staleScriptBase);
    mockNoLockContention(settings, (p) =>
      p.includes("conductor-risk6-posix-stale")
        ? false
        : p.includes("conductor-risk6-posix-healthy")
          ? true
          : undefined
    );
    const writeMock = fs.writeFileSync as ReturnType<typeof vi.fn>;

    const result = await ensureHooksInstalled(healthyContext);

    expect(result).toBe(true);
    expect(settingsWrites(writeMock).length).toBeGreaterThanOrEqual(1);
  });
});

describe("ensureHooksInstalled — FR-4: reconciliation is unaffected by SETUP_DECLINED_KEY", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("node: command not found");
    });
  });

  it("still reconciles stale paths even when the user previously declined hook setup", async () => {
    const oldContext = makeContext(OLD_EXT_PATH);
    const newContext = makeContext(NEW_EXT_PATH);
    // "claudeConductor.hookSetupDeclined" -- src/hookInstaller.ts:L10's
    // SETUP_DECLINED_KEY -- simulate a user who previously chose
    // "Don't Ask Again".
    (newContext.globalState.get as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const oldScriptBase = getHookScriptPath(oldContext);
    const oldSettings = makeSettingsWithHooks(oldScriptBase);

    mockNoLockContention(oldSettings);
    const writeMock = fs.writeFileSync as ReturnType<typeof vi.fn>;

    const { window } = await import("../test/mocks/vscode.js");
    const showInfoSpy = vi.spyOn(window, "showInformationMessage");

    const result = await ensureHooksInstalled(newContext);

    expect(result).toBe(true);
    expect(settingsWrites(writeMock).length).toBeGreaterThanOrEqual(1);
    // The already-installed branch must never consult the decline flag --
    // src/hookInstaller.ts:L279-L280's existing comment already documents
    // why, and FR-2/FR-2a/FR-6 must not change that.
    expect(newContext.globalState.get).not.toHaveBeenCalledWith(
      "claudeConductor.hookSetupDeclined"
    );
    // Nor must the "Allow / Not Now / Don't Ask Again" consent prompt appear.
    const consentCallArgs = showInfoSpy.mock.calls.find((args) =>
      String(args[0]).includes("requires adding hooks")
    );
    expect(consentCallArgs).toBeUndefined();
  });
});

describe("ensureHooksInstalled — FR-5: in-flight guard against overlapping runs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("node: command not found");
    });
  });

  it("does not perform the reconcile+write sequence twice when called again before the first call has resolved", async () => {
    // Assumption (recorded in this test-implementer's return to the router):
    // this test proves the guard via two back-to-back, unawaited calls
    // (`const p1 = ensureHooksInstalled(...); const p2 = ensureHooksInstalled(...);`).
    // This reliably detects a guard implemented as a held Promise (its
    // .finally()/await-based reset is deferred by at least one microtask,
    // so p2's synchronous entry check still sees the in-flight state) --
    // Resolution 2 (§5) explicitly names this as one of the two sanctioned
    // shapes ("a module-level boolean or a held Promise"). A guard
    // implemented as a plain boolean reset synchronously within a
    // zero-internal-await function body would not have a genuine overlap
    // window for this test to observe in the first place, so there is
    // nothing for such a guard to protect against in that specific shape.
    const oldContext = makeContext(OLD_EXT_PATH);
    const newContext = makeContext(NEW_EXT_PATH);
    const oldScriptBase = getHookScriptPath(oldContext);
    const oldSettings = makeSettingsWithHooks(oldScriptBase);

    mockNoLockContention(oldSettings);
    const writeMock = fs.writeFileSync as ReturnType<typeof vi.fn>;

    const p1 = ensureHooksInstalled(newContext);
    const p2 = ensureHooksInstalled(newContext);
    await Promise.all([p1, p2]);

    expect(
      settingsWrites(writeMock),
      "FR-5: two overlapping calls within the same process must not each independently reconcile+write"
    ).toHaveLength(1);
  });
});

describe("ensureHooksInstalled — FR-6: lockfile guard around the settings.json read-modify-write", () => {
  function eexist(): NodeJS.ErrnoException {
    return Object.assign(new Error("EEXIST: file already exists"), { code: "EEXIST" });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("node: command not found");
    });
  });

  it("fails fast without a user-facing error when the lock is already held and not yet stale, leaving settings.json untouched", async () => {
    const oldContext = makeContext(OLD_EXT_PATH);
    const newContext = makeContext(NEW_EXT_PATH);
    const oldScriptBase = getHookScriptPath(oldContext);
    const oldSettings = makeSettingsWithHooks(oldScriptBase);

    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith(".lock")) {
        return JSON.stringify({ pid: 99999, timestamp: Date.now() });
      }
      return JSON.stringify(oldSettings);
    });
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith(".lock")) return true; // a lock file is present
      return true; // every hook script path itself is healthy -- isolate the lock as the only blocker
    });
    (fs.statSync as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      mtimeMs: Date.now(),
      mtime: new Date(),
    }));
    const eexistErr = eexist();
    // Support both plausible exclusive-create APIs -- whichever one the
    // implementation actually calls will throw EEXIST for the lock path.
    (fs.writeFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      if (String(p).endsWith(".lock")) throw eexistErr;
    });
    (fs.openSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      if (String(p).endsWith(".lock")) throw eexistErr;
      return 0;
    });

    const { window } = await import("../test/mocks/vscode.js");
    const showErrorSpy = vi.spyOn(window, "showErrorMessage");
    const showInfoSpy = vi.spyOn(window, "showInformationMessage");

    const result = await ensureHooksInstalled(newContext);

    expect(result).toBe(true);
    expect(
      settingsWrites(fs.writeFileSync as ReturnType<typeof vi.fn>),
      "a held, non-stale lock must skip the write for this cycle rather than blocking or erroring"
    ).toHaveLength(0);
    expect(showErrorSpy, "lock contention is expected multi-window behavior, not a defect").not.toHaveBeenCalled();
    expect(showInfoSpy).not.toHaveBeenCalledWith(expect.stringMatching(/reload/i));
  });

  it("detects a stale lock, steals it, and proceeds with the reconcile+write", async () => {
    const oldContext = makeContext(OLD_EXT_PATH);
    const newContext = makeContext(NEW_EXT_PATH);
    const oldScriptBase = getHookScriptPath(oldContext);
    const oldSettings = makeSettingsWithHooks(oldScriptBase);
    const staleTimestamp = Date.now() - 60_000; // well past a "few seconds" threshold

    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith(".lock")) {
        return JSON.stringify({ pid: 12345, timestamp: staleTimestamp });
      }
      return JSON.stringify(oldSettings);
    });
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith(".lock")) return true;
      return true;
    });
    (fs.statSync as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      mtimeMs: staleTimestamp,
      mtime: new Date(staleTimestamp),
    }));

    let lockWriteAttempts = 0;
    const eexistErr = eexist();
    (fs.writeFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      if (String(p).endsWith(".lock")) {
        lockWriteAttempts += 1;
        if (lockWriteAttempts === 1) throw eexistErr;
      }
    });
    let lockOpenAttempts = 0;
    (fs.openSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      if (String(p).endsWith(".lock")) {
        lockOpenAttempts += 1;
        if (lockOpenAttempts === 1) throw eexistErr;
        return 0;
      }
      return 0;
    });

    const result = await ensureHooksInstalled(newContext);

    expect(result).toBe(true);
    // A settings write alone isn't sufficient proof here: the current
    // (pre-FR-6) implementation has no lock awareness at all, so it would
    // also produce exactly one settings write regardless of this fixture's
    // "held lock" simulation -- that would make this test pass for the
    // wrong reason. Require positive evidence that the lockfile was
    // actually touched (an exclusive-create attempt against the ".lock"
    // path) before trusting the write-count assertion below.
    expect(
      lockWriteAttempts + lockOpenAttempts,
      "the implementation must actually attempt to exclusively-create the lockfile, not skip locking entirely"
    ).toBeGreaterThanOrEqual(1);
    expect(
      settingsWrites(fs.writeFileSync as ReturnType<typeof vi.fn>),
      "a stale lock must be stolen (not left blocking forever) so the RMW proceeds exactly once"
    ).toHaveLength(1);
  });

  it("acquires and releases the lock around a successful RMW cycle", async () => {
    const oldContext = makeContext(OLD_EXT_PATH);
    const newContext = makeContext(NEW_EXT_PATH);
    const oldScriptBase = getHookScriptPath(oldContext);
    const oldSettings = makeSettingsWithHooks(oldScriptBase);

    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith(".lock")) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return JSON.stringify(oldSettings);
    });
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith(".lock")) return false; // no lock currently held
      return true;
    });
    (fs.writeFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {});
    (fs.openSync as ReturnType<typeof vi.fn>).mockImplementation(() => 0);

    const result = await ensureHooksInstalled(newContext);

    expect(result).toBe(true);
    expect(settingsWrites(fs.writeFileSync as ReturnType<typeof vi.fn>)).toHaveLength(1);

    const releaseCalled =
      (fs.unlinkSync as ReturnType<typeof vi.fn>).mock.calls.some((c) =>
        String(c[0]).endsWith(".lock")
      ) ||
      (fs.rmSync as ReturnType<typeof vi.fn>).mock.calls.some((c) =>
        String(c[0]).endsWith(".lock")
      );
    expect(
      releaseCalled,
      "the lock must be removed once the RMW sequence completes (via unlinkSync or rmSync)"
    ).toBe(true);
  });

  it("leaves settings.json untouched on a failed acquisition, then succeeds on a later retry once the lock is free (FR-3 retry)", async () => {
    const oldContext = makeContext(OLD_EXT_PATH);
    const newContext = makeContext(NEW_EXT_PATH);
    const oldScriptBase = getHookScriptPath(oldContext);
    const oldSettings = makeSettingsWithHooks(oldScriptBase);

    let lockHeld = true;
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith(".lock")) {
        if (!lockHeld) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return JSON.stringify({ pid: 99999, timestamp: Date.now() });
      }
      return JSON.stringify(oldSettings);
    });
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith(".lock")) return lockHeld;
      return true;
    });
    (fs.statSync as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      mtimeMs: Date.now(),
      mtime: new Date(),
    }));
    const eexistErr = eexist();
    (fs.writeFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      if (String(p).endsWith(".lock") && lockHeld) throw eexistErr;
    });
    (fs.openSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      if (String(p).endsWith(".lock") && lockHeld) throw eexistErr;
      return 0;
    });

    const writeMock = fs.writeFileSync as ReturnType<typeof vi.fn>;

    // First cycle: lock is held by another (live) process -- skip the write.
    const firstResult = await ensureHooksInstalled(newContext);
    expect(firstResult).toBe(true);
    expect(settingsWrites(writeMock)).toHaveLength(0);

    // Simulate the other window releasing the lock before FR-3's next
    // window-focus-triggered retry.
    lockHeld = false;

    const secondResult = await ensureHooksInstalled(newContext);
    expect(secondResult).toBe(true);
    expect(
      settingsWrites(writeMock),
      "once the lock is free, a subsequent retry (e.g. FR-3's focus-triggered re-check) must succeed"
    ).toHaveLength(1);
  });
});
