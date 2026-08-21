import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

// Must use vi.mock("fs") — the same pattern as addFolderPrompt.stale.test.ts —
// because ESM module namespaces are not reconfigurable via vi.spyOn.
vi.mock("fs");

vi.mock("vscode", async () => {
  const m = await import("./mocks/vscode");
  return m;
});

import * as vscodeMock from "./mocks/vscode";
import { SessionManager, SESSION_NAME_PREFIX } from "../src/sessionManager";
import { canonicalKey } from "../src/pathCanonical";

describe("launchSession LaunchResult", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // Default: fs.existsSync returns true (path exists), readdirSync returns
    // empty array (no session-state files to process during cleanup).
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns {ok:false, reason:'missing'} for a non-UNC path that doesn't exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const sm = new SessionManager();
    const r = await sm.launchSession("C:/no/such/path");
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: "missing" }));
    sm.dispose();
  });

  it("returns {ok:true} for a path that exists", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const sm = new SessionManager();
    const r = await sm.launchSession("C:/exists");
    expect(r.ok).toBe(true);
    sm.dispose();
  });

  it("skips fs.existsSync pre-flight for UNC paths", async () => {
    // existsSync returns false — but for UNC paths we should skip the check
    // and still succeed.
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const sm = new SessionManager();
    const r = await sm.launchSession("\\\\server\\share\\foo");
    // existsSync should not have been called for the UNC path itself
    expect(vi.mocked(fs.existsSync)).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\\\\server/)
    );
    expect(r.ok).toBe(true);
    sm.dispose();
  });
});

// ---------------------------------------------------------------------------
// FR-4: launch-time terminal-name substitution from claudeConductor.folderAliases.
// ---------------------------------------------------------------------------

describe("launchSession terminal name — folder alias substitution (FR-4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(vscodeMock.window.createTerminal).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Config stub: only "folderAliases" is meaningful; everything else keeps
   * launchSession's other config reads at their existing defaults so this
   * suite isolates the FR-4 substitution from unrelated config behavior. */
  function installConfig(folderAliases: Record<string, string>): void {
    vi.spyOn(vscodeMock.workspace, "getConfiguration").mockReturnValue({
      get: <T>(key: string, defaultValue: T): T => {
        if (key === "folderAliases") return folderAliases as unknown as T;
        if (key === "reuseExistingTerminal") return true as unknown as T;
        if (key === "claudeCommand") return "claude" as unknown as T;
        if (key === "launchDelayMs") return 0 as unknown as T;
        if (key === "debugLogging") return false as unknown as T;
        if (key === "extraFolders") return [] as unknown as T;
        return defaultValue;
      },
      update: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("vscode").WorkspaceConfiguration);
  }

  it("uses the configured alias in the terminal name when claudeConductor.folderAliases has an entry for the launched path", async () => {
    installConfig({ [canonicalKey("C:/exists")]: "My Alias" });
    const sm = new SessionManager();

    const r = await sm.launchSession("C:/exists");

    expect(r.ok).toBe(true);
    expect(vscodeMock.window.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ name: `${SESSION_NAME_PREFIX}My Alias` })
    );
    sm.dispose();
  });

  it("falls back to the basename in the terminal name when no folderAliases entry exists for the launched path (unchanged behavior)", async () => {
    installConfig({});
    const sm = new SessionManager();

    const r = await sm.launchSession("C:/exists");

    expect(r.ok).toBe(true);
    expect(vscodeMock.window.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ name: `${SESSION_NAME_PREFIX}exists` })
    );
    sm.dispose();
  });
});
