/**
 * Tests for the "Open Claude Here" Explorer context-menu command pair
 * (issue #107, spec: docs/specs/2026-08-07-explorer-open-claude-here.md).
 *
 * Two new commands are registered, both delegating to one shared
 * implementation:
 *   - claudeConductor.openHere         (folder target, FR-1/FR-3)
 *   - claudeConductor.openHereFromFile (file target, FR-1/FR-4)
 *
 * Coverage map (spec section references):
 *   - FR-1        both commands are registered
 *   - FR-3        openHere launches sessionManager.launchSession(uri.fsPath)
 *   - FR-4        openHereFromFile launches launchSession(path.dirname(uri.fsPath))
 *   - FR-5/Risk 1 both commands read uri.fsPath, never uri.path (Windows
 *                 .fsPath-vs-.path divergence regression)
 *   - FR-6/Risk 2 vscode.workspace.fs.stat(uri) is used as a staleness/
 *                 validity check before launching: a rejected stat, or a
 *                 stat whose FileType contradicts the invoked command's
 *                 folder-vs-file assumption, surfaces an error and skips
 *                 launchSession entirely
 *   - FR-7/Risk 3 multi-select: only the first/clicked uri arg is acted on;
 *                 an additional uris[] array argument is accepted and
 *                 ignored (documented VS Code convention — see Risk 3,
 *                 unverified against this repo's exact engine version)
 *
 * package.json contribution coverage (separate describe block below, using
 * a real (unmocked) fs read of package.json — see § package.json below):
 *   - FR-1/FR-2   contributes.commands has both command IDs, titled
 *                 "Open Claude Here"; contributes.menus["explorer/context"]
 *                 wires claudeConductor.openHere to
 *                 "explorerResourceIsFolder" and claudeConductor.openHereFromFile
 *                 to "!explorerResourceIsFolder"
 *   - FR-9        contributes.menus.commandPalette suppresses both command
 *                 IDs via "when": "false"
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Must use vi.mock("fs") — same pattern as extension.existenceCache.test.ts —
// because ESM module namespaces are not reconfigurable via vi.spyOn.
vi.mock("fs");

vi.mock("vscode", async () => {
  const m = await import("./mocks/vscode");
  return m;
});

import * as vscodeMock from "./mocks/vscode";
import { activate } from "../src/extension";
import { SessionManager } from "../src/sessionManager";

// ---------------------------------------------------------------------------
// ExtensionContext stub
// ---------------------------------------------------------------------------

interface FakeMemento {
  get: <T>(key: string, defaultValue?: T) => T | undefined;
  update: (key: string, value: unknown) => Promise<void>;
  keys: () => string[];
}

function makeMemento(initial: Record<string, unknown> = {}): FakeMemento {
  const data: Record<string, unknown> = { ...initial };
  return {
    get: <T>(key: string, defaultValue?: T) =>
      (key in data ? data[key] : defaultValue) as T | undefined,
    update: vi.fn(async (key: string, value: unknown) => {
      data[key] = value;
    }),
    keys: () => Object.keys(data),
  };
}

function makeContext(): import("vscode").ExtensionContext {
  const subscriptions: { dispose(): void }[] = [];
  return {
    subscriptions,
    globalState: makeMemento(),
  } as unknown as import("vscode").ExtensionContext;
}

/** Finds the most recently registered handler for the given command id. */
function capturedCommand(name: string): (...args: unknown[]) => unknown {
  const calls = vi.mocked(vscodeMock.commands.registerCommand).mock.calls;
  const matches = calls.filter((c) => c[0] === name);
  const last = matches[matches.length - 1];
  if (!last) throw new Error(`command not registered: ${name}`);
  return last[1] as (...args: unknown[]) => unknown;
}

/**
 * A minimal vscode.Uri-shaped fixture: `fsPath` and `path` set independently.
 *
 * `path` defaults to a value that is *always* distinct from `fsPath` (never
 * equal, unlike a real same-encoding case) so that every test in this file —
 * not just the two dedicated divergence tests — fails if an implementation
 * accidentally reads `.path` instead of `.fsPath` (FR-5/Risk 1). Tests that
 * want to assert on a specific, realistic `.path` encoding pass it explicitly.
 */
function makeUri(
  fsPath: string,
  encodedPath: string = `/DO-NOT-READ-THIS-PATH${fsPath}`
): import("vscode").Uri {
  return { fsPath, path: encodedPath } as unknown as import("vscode").Uri;
}

function mockStat(type: number): void {
  vi.mocked(vscodeMock.workspace.fs.stat).mockResolvedValue({
    type,
    ctime: 0,
    mtime: 0,
    size: 0,
  } as unknown as import("vscode").FileStat);
}

function mockStatRejects(): void {
  vi.mocked(vscodeMock.workspace.fs.stat).mockRejectedValue(new Error("ENOENT"));
}

describe("claudeConductor.openHere / openHereFromFile (issue #107)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as unknown as string);
    (vscodeMock.window as unknown as { terminals: unknown[] }).terminals = [];
    (vscodeMock.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders =
      undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers both claudeConductor.openHere and claudeConductor.openHereFromFile commands", () => {
    const context = makeContext();
    activate(context);

    expect(() => capturedCommand("claudeConductor.openHere")).not.toThrow();
    expect(() => capturedCommand("claudeConductor.openHereFromFile")).not.toThrow();
  });

  describe("claudeConductor.openHere — folder target (FR-3)", () => {
    it("launches sessionManager.launchSession with the right-clicked folder's uri.fsPath", async () => {
      const launchSpy = vi
        .spyOn(SessionManager.prototype, "launchSession")
        .mockResolvedValue({ ok: true, reused: false });
      mockStat(vscodeMock.FileType.Directory);

      const context = makeContext();
      activate(context);

      const uri = makeUri("C:/Users/chris/my-project");
      const handler = capturedCommand("claudeConductor.openHere");
      await handler(uri);

      expect(
        launchSpy,
        "claudeConductor.openHere must call sessionManager.launchSession(folderPath) with the right-clicked folder's path — the same call claudeConductor.openSession already uses (FR-3)"
      ).toHaveBeenCalledWith("C:/Users/chris/my-project");
    });

    it("reads uri.fsPath, not uri.path, when the two diverge (Windows regression, FR-5/Risk 1)", async () => {
      const launchSpy = vi
        .spyOn(SessionManager.prototype, "launchSession")
        .mockResolvedValue({ ok: true, reused: false });
      mockStat(vscodeMock.FileType.Directory);

      const context = makeContext();
      activate(context);

      // Real vscode.Uri.fsPath on Windows is the OS filesystem path
      // (drive-letter case as typed, native separators); .path is the
      // URI-encoded POSIX-style form. resolvePathArg()'s .path fallback
      // would read the wrong one here — this command must not go through
      // resolvePathArg() at all (FR-5).
      const fsPath = "C:/Users/chris/My Project";
      const encodedPosixPath = "/c%3A/users/chris/My%20Project";
      const uri = makeUri(fsPath, encodedPosixPath);

      const handler = capturedCommand("claudeConductor.openHere");
      await handler(uri);

      expect(
        launchSpy,
        "claudeConductor.openHere must launch using uri.fsPath, never uri.path — reading .path here would silently break on Windows (spec Risk 1)"
      ).toHaveBeenCalledWith(fsPath);
    });
  });

  describe("claudeConductor.openHereFromFile — file target (FR-4)", () => {
    it("launches sessionManager.launchSession with path.dirname(uri.fsPath), the file's parent folder", async () => {
      const launchSpy = vi
        .spyOn(SessionManager.prototype, "launchSession")
        .mockResolvedValue({ ok: true, reused: false });
      mockStat(vscodeMock.FileType.File);

      const context = makeContext();
      activate(context);

      const fsPath = "/home/chris/my-project/src/file.ts";
      const uri = makeUri(fsPath);
      const handler = capturedCommand("claudeConductor.openHereFromFile");
      await handler(uri);

      expect(
        launchSpy,
        "claudeConductor.openHereFromFile must call launchSession(path.dirname(uri.fsPath)) — the file's parent folder, not the file itself (FR-4)"
      ).toHaveBeenCalledWith(path.dirname(fsPath));
    });

    it("reads uri.fsPath, not uri.path, before computing the parent folder (Windows regression, FR-5/Risk 1)", async () => {
      const launchSpy = vi
        .spyOn(SessionManager.prototype, "launchSession")
        .mockResolvedValue({ ok: true, reused: false });
      mockStat(vscodeMock.FileType.File);

      const context = makeContext();
      activate(context);

      const fsPath = "C:/Users/chris/My Project/file.ts";
      const encodedPosixPath = "/c%3A/users/chris/My%20Project/file.ts";
      const uri = makeUri(fsPath, encodedPosixPath);

      const handler = capturedCommand("claudeConductor.openHereFromFile");
      await handler(uri);

      expect(
        launchSpy,
        "claudeConductor.openHereFromFile must derive the parent folder from uri.fsPath, never uri.path (spec Risk 1)"
      ).toHaveBeenCalledWith(path.dirname(fsPath));
    });
  });

  describe("stale-target guard via vscode.workspace.fs.stat(uri) (FR-6/Risk 2)", () => {
    it("claudeConductor.openHere shows an error and does not launch when stat(uri) rejects", async () => {
      const launchSpy = vi
        .spyOn(SessionManager.prototype, "launchSession")
        .mockResolvedValue({ ok: true, reused: false });
      mockStatRejects();

      const context = makeContext();
      activate(context);

      const uri = makeUri("C:/Users/chris/gone");
      const handler = capturedCommand("claudeConductor.openHere");
      await handler(uri);

      expect(
        vscodeMock.window.showErrorMessage,
        "a rejected stat() means the target may have been deleted/become inaccessible between right-click and invocation — must surface an error, not silently proceed (Risk 2)"
      ).toHaveBeenCalled();
      expect(
        launchSpy,
        "launchSession must not be called when stat(uri) rejects (Risk 2)"
      ).not.toHaveBeenCalled();
    });

    it("claudeConductor.openHereFromFile shows an error and does not launch when stat(uri) rejects", async () => {
      const launchSpy = vi
        .spyOn(SessionManager.prototype, "launchSession")
        .mockResolvedValue({ ok: true, reused: false });
      mockStatRejects();

      const context = makeContext();
      activate(context);

      const uri = makeUri("C:/Users/chris/gone/file.ts");
      const handler = capturedCommand("claudeConductor.openHereFromFile");
      await handler(uri);

      expect(vscodeMock.window.showErrorMessage).toHaveBeenCalled();
      expect(launchSpy).not.toHaveBeenCalled();
    });

    it("claudeConductor.openHere shows an error and does not launch when stat(uri) reports a file, not a folder", async () => {
      const launchSpy = vi
        .spyOn(SessionManager.prototype, "launchSession")
        .mockResolvedValue({ ok: true, reused: false });
      // The folder command fired, but the target now stat()s as a File —
      // it was deleted and replaced with a file in the interval between
      // right-click and invocation.
      mockStat(vscodeMock.FileType.File);

      const context = makeContext();
      activate(context);

      const uri = makeUri("C:/Users/chris/was-a-folder");
      const handler = capturedCommand("claudeConductor.openHere");
      await handler(uri);

      expect(
        vscodeMock.window.showErrorMessage,
        "claudeConductor.openHere fired but stat(uri) reports FileType.File — the target no longer matches the invoked command's folder assumption; must error instead of launching on stale info (FR-6)"
      ).toHaveBeenCalled();
      expect(launchSpy).not.toHaveBeenCalled();
    });

    it("claudeConductor.openHereFromFile shows an error and does not launch when stat(uri) reports a folder, not a file", async () => {
      const launchSpy = vi
        .spyOn(SessionManager.prototype, "launchSession")
        .mockResolvedValue({ ok: true, reused: false });
      mockStat(vscodeMock.FileType.Directory);

      const context = makeContext();
      activate(context);

      const uri = makeUri("C:/Users/chris/was-a-file");
      const handler = capturedCommand("claudeConductor.openHereFromFile");
      await handler(uri);

      expect(
        vscodeMock.window.showErrorMessage,
        "claudeConductor.openHereFromFile fired but stat(uri) reports FileType.Directory — the target no longer matches the invoked command's file assumption; must error instead of launching on stale info (FR-6)"
      ).toHaveBeenCalled();
      expect(launchSpy).not.toHaveBeenCalled();
    });

    it("stats the invoked resource itself (uri.fsPath), so the validity check targets what was actually clicked", async () => {
      vi.spyOn(SessionManager.prototype, "launchSession").mockResolvedValue({
        ok: true,
        reused: false,
      });
      mockStat(vscodeMock.FileType.Directory);

      const context = makeContext();
      activate(context);

      const uri = makeUri("C:/Users/chris/my-project");
      const handler = capturedCommand("claudeConductor.openHere");
      await handler(uri);

      const statCalls = vi.mocked(vscodeMock.workspace.fs.stat).mock.calls;
      expect(statCalls.length).toBeGreaterThan(0);
      const statArg = statCalls[0][0] as unknown as { fsPath: string };
      expect(statArg.fsPath).toBe("C:/Users/chris/my-project");
    });
  });

  describe("multi-select: acts on the first/clicked item only (FR-7/Risk 3)", () => {
    it("claudeConductor.openHere ignores an additional uris[] array argument, launching only the clicked folder", async () => {
      const launchSpy = vi
        .spyOn(SessionManager.prototype, "launchSession")
        .mockResolvedValue({ ok: true, reused: false });
      mockStat(vscodeMock.FileType.Directory);

      const context = makeContext();
      activate(context);

      const clickedUri = makeUri("C:/Users/chris/clicked-folder");
      const otherSelectedUris = [
        clickedUri,
        makeUri("C:/Users/chris/also-selected-1"),
        makeUri("C:/Users/chris/also-selected-2"),
      ];

      // Documented VS Code convention for a multi-select context-menu
      // invocation: (clickedResource, allSelectedResources[]). This exact
      // argument shape is unverified for this repo's engine version — see
      // spec § 4 Risk 3 — so this test targets the documented convention,
      // not an empirically-confirmed one.
      const handler = capturedCommand("claudeConductor.openHere");
      await handler(clickedUri, otherSelectedUris);

      expect(
        launchSpy,
        "must launch exactly once, for the clicked item only — no per-item fan-out over the rest of the selection (FR-7)"
      ).toHaveBeenCalledTimes(1);
      expect(launchSpy).toHaveBeenCalledWith("C:/Users/chris/clicked-folder");
    });

    it("claudeConductor.openHereFromFile ignores an additional uris[] array argument, launching only the clicked file's parent", async () => {
      const launchSpy = vi
        .spyOn(SessionManager.prototype, "launchSession")
        .mockResolvedValue({ ok: true, reused: false });
      mockStat(vscodeMock.FileType.File);

      const context = makeContext();
      activate(context);

      const clickedUri = makeUri("/home/chris/project/src/clicked.ts");
      const otherSelectedUris = [
        clickedUri,
        makeUri("/home/chris/project/src/also-selected-1.ts"),
        makeUri("/home/chris/project/src/also-selected-2.ts"),
      ];

      const handler = capturedCommand("claudeConductor.openHereFromFile");
      await handler(clickedUri, otherSelectedUris);

      expect(launchSpy).toHaveBeenCalledTimes(1);
      expect(launchSpy).toHaveBeenCalledWith(path.dirname("/home/chris/project/src/clicked.ts"));
    });
  });
});

// ---------------------------------------------------------------------------
// package.json contributions (FR-1, FR-2, FR-9)
//
// Reads the real package.json via vi.importActual("fs") — the top-level
// vi.mock("fs") above is for the activate()-based tests; this block needs
// the genuine file contents, not the mocked fs.
// ---------------------------------------------------------------------------

interface PkgCommand {
  command: string;
  title: string;
}

interface PkgMenuEntry {
  command: string;
  when?: string;
  group?: string;
}

interface PkgShape {
  contributes?: {
    commands?: PkgCommand[];
    menus?: {
      "explorer/context"?: PkgMenuEntry[];
      commandPalette?: PkgMenuEntry[];
    };
  };
}

describe("package.json contributions — Open Claude Here (issue #107)", () => {
  let pkg: PkgShape;

  beforeAll(async () => {
    const realFs = await vi.importActual<typeof import("fs")>("fs");
    const pkgPath = path.join(__dirname, "..", "package.json");
    pkg = JSON.parse(realFs.readFileSync(pkgPath, "utf8")) as PkgShape;
  });

  it("declares claudeConductor.openHere and claudeConductor.openHereFromFile, both titled 'Open Claude Here'", () => {
    const commandsList = pkg.contributes?.commands ?? [];
    for (const id of ["claudeConductor.openHere", "claudeConductor.openHereFromFile"]) {
      const entry = commandsList.find((c) => c.command === id);
      expect(
        entry,
        `contributes.commands is missing a '${id}' entry (FR-1)`
      ).toBeDefined();
      expect(
        entry?.title,
        `contributes.commands entry for '${id}' must be titled "Open Claude Here" (FR-1)`
      ).toBe("Open Claude Here");
    }
  });

  it("wires claudeConductor.openHere into explorer/context gated by explorerResourceIsFolder", () => {
    const menu = pkg.contributes?.menus?.["explorer/context"] ?? [];
    const entry = menu.find((m) => m.command === "claudeConductor.openHere");
    expect(
      entry,
      "contributes.menus['explorer/context'] is missing a claudeConductor.openHere entry (FR-1/FR-2)"
    ).toBeDefined();
    expect(
      entry?.when,
      "claudeConductor.openHere's explorer/context entry must gate on \"explorerResourceIsFolder\" (FR-2, OQ-2)"
    ).toBe("explorerResourceIsFolder");
    expect(
      entry?.group,
      "claudeConductor.openHere's explorer/context entry must render below \"Open in Integrated Terminal\" (order 30) in VS Code's built-in navigation group — see issue #116"
    ).toBe("navigation@32");
  });

  it("wires claudeConductor.openHereFromFile into explorer/context gated by !explorerResourceIsFolder", () => {
    const menu = pkg.contributes?.menus?.["explorer/context"] ?? [];
    const entry = menu.find((m) => m.command === "claudeConductor.openHereFromFile");
    expect(
      entry,
      "contributes.menus['explorer/context'] is missing a claudeConductor.openHereFromFile entry (FR-1/FR-2)"
    ).toBeDefined();
    expect(
      entry?.when,
      "claudeConductor.openHereFromFile's explorer/context entry must gate on \"!explorerResourceIsFolder\" (FR-2, OQ-2)"
    ).toBe("!explorerResourceIsFolder");
    expect(
      entry?.group,
      "claudeConductor.openHereFromFile's explorer/context entry must render below \"Open in Integrated Terminal\" (order 30) in VS Code's built-in navigation group — see issue #116"
    ).toBe("navigation@32");
  });

  it("suppresses both openHere* commands from the Command Palette via a commandPalette when:false clause (FR-9)", () => {
    const palette = pkg.contributes?.menus?.commandPalette ?? [];
    for (const id of ["claudeConductor.openHere", "claudeConductor.openHereFromFile"]) {
      const entry = palette.find((m) => m.command === id);
      expect(
        entry,
        `contributes.menus.commandPalette is missing a 'when: false' entry for '${id}' — missing either one would leave a bare, argument-less entry visible in the Palette (FR-9)`
      ).toBeDefined();
      expect(entry?.when).toBe("false");
    }
  });
});
