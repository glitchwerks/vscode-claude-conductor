/**
 * Regression test for PR #77 CodeRabbit findings 7, 8, 16 (Cluster A).
 *
 * showQuickPick's launch path (src/quickPick.ts, ~L84) calls
 * sessionManager.launchSession() but currently does not call
 * existenceCache.markPresent()/markMissing() on the result — unlike the
 * claudeConductor.openSession command handler (src/extension.ts), which is
 * already correct and is the reference behavior mirrored here.
 *
 * Contract: showQuickPick takes the existenceCache as a second parameter
 * (mirroring the existing positional-DI convention used by
 * RecentProjectsProvider(sessionManager, favoritesStore, existenceCache) in
 * src/treeView.ts) and updates it exactly like the openSession handler does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

vi.mock("fs");

vi.mock("vscode", async () => {
  const m = await import("./mocks/vscode");
  return m;
});

// getAllFolders must be mockable so the quick-pick item list is deterministic.
vi.mock("../src/folderSource", () => ({
  getAllFolders: vi.fn(),
}));

import * as vscodeMock from "./mocks/vscode";
import { showQuickPick } from "../src/quickPick";
import { SessionManager } from "../src/sessionManager";
import { PathExistenceCache } from "../src/pathExistenceCache";
import { getAllFolders } from "../src/folderSource";

describe("showQuickPick — existenceCache consistency (Cluster A)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    (vscodeMock.window as unknown as { terminals: unknown[] }).terminals = [];

    vi.mocked(getAllFolders).mockResolvedValue([
      { folderPath: "C:/proj", name: "proj", parentDir: "C:/", source: "recent" },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks the folder present in existenceCache after a successful quick-pick launch", async () => {
    const markPresentSpy = vi.spyOn(PathExistenceCache.prototype, "markPresent");
    const folderPath = "C:/proj";

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.spyOn(vscodeMock.window, "showQuickPick").mockResolvedValue({
      folderPath,
      isActiveSession: false,
      label: "proj",
    } as unknown as import("vscode").QuickPickItem);

    const sessionManager = new SessionManager();
    const existenceCache = new PathExistenceCache();

    await showQuickPick(sessionManager, existenceCache);

    expect(
      markPresentSpy,
      "existenceCache.markPresent must be called after showQuickPick launches successfully — mirrors the openSession command handler"
    ).toHaveBeenCalledWith(folderPath);

    sessionManager.dispose();
  }, 10_000);

  it("marks the folder missing in existenceCache when showQuickPick's launch reports 'missing'", async () => {
    const markMissingSpy = vi.spyOn(PathExistenceCache.prototype, "markMissing");
    const folderPath = "C:/proj";

    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.spyOn(vscodeMock.window, "showQuickPick").mockResolvedValue({
      folderPath,
      isActiveSession: false,
      label: "proj",
    } as unknown as import("vscode").QuickPickItem);

    const sessionManager = new SessionManager();
    const existenceCache = new PathExistenceCache();

    await showQuickPick(sessionManager, existenceCache);

    expect(
      markMissingSpy,
      "existenceCache.markMissing must be called after showQuickPick's launchSession reports 'missing' — mirrors the openSession command handler"
    ).toHaveBeenCalledWith(folderPath);

    sessionManager.dispose();
  });
});
