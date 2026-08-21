/**
 * Tests for src/config.ts's alias-storage helpers and removeExtraFolder
 * (FR-2, FR-10 of docs/specs/2026-08-16-sidebar-rename-delete-bulk-select.md).
 *
 * New file — no dedicated config.test.ts existed before this change
 * (NFR-15(a): `ls test/ | grep -i config` returned no matches).
 *
 * Mocking convention: `vscode.workspace.getConfiguration()` is stubbed to
 * return an object backed by a real in-memory record, and `.update()`
 * mutates that same record — the same pattern used in
 * test/addFolderPrompt.stale.test.ts for round-tripping config reads/writes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";

import * as vscodeMock from "./mocks/vscode";
import { canonicalKey } from "../src/pathCanonical";
import {
  getFolderAliases,
  getFolderAlias,
  setFolderAlias,
  removeFolderAlias,
  removeExtraFolder,
} from "../src/config";

// ---------------------------------------------------------------------------
// Config-store test double
// ---------------------------------------------------------------------------

function installConfigStore(initial: Record<string, unknown> = {}): {
  store: Record<string, unknown>;
  updateMock: ReturnType<typeof vi.fn>;
} {
  const store: Record<string, unknown> = { ...initial };
  const updateMock = vi.fn(async (key: string, value: unknown) => {
    store[key] = value;
  });
  vi.spyOn(vscodeMock.workspace, "getConfiguration").mockReturnValue({
    get: <T>(key: string, defaultValue: T): T =>
      (key in store ? (store[key] as T) : defaultValue),
    update: updateMock,
  } as unknown as import("vscode").WorkspaceConfiguration);
  return { store, updateMock };
}

// ---------------------------------------------------------------------------
// getFolderAliases / getFolderAlias
// ---------------------------------------------------------------------------

describe("getFolderAliases / getFolderAlias (FR-2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getFolderAliases() returns {} when no folderAliases setting is present", () => {
    installConfigStore({});

    expect(getFolderAliases()).toEqual({});
  });

  it("getFolderAliases() returns the stored map as-is", () => {
    const key = canonicalKey("C:/proj-a");
    installConfigStore({ folderAliases: { [key]: "Project A" } });

    expect(getFolderAliases()).toEqual({ [key]: "Project A" });
  });

  it("getFolderAlias() returns undefined when no entry matches the folder", () => {
    installConfigStore({ folderAliases: {} });

    expect(getFolderAlias("C:/proj-a")).toBeUndefined();
  });

  it("getFolderAlias() returns the alias for an exact canonicalKey match", () => {
    const key = canonicalKey("C:/proj-a");
    installConfigStore({ folderAliases: { [key]: "Project A" } });

    expect(getFolderAlias("C:/proj-a")).toBe("Project A");
  });

  it("getFolderAlias() is case-insensitive on read (FR-2 Decision 2 — canonicalKey lookup, not path.normalize)", () => {
    const key = canonicalKey("C:/Proj-A");
    installConfigStore({ folderAliases: { [key]: "Project A" } });

    expect(getFolderAlias("c:/PROJ-a")).toBe("Project A");
  });

  it("getFolderAlias() is separator-insensitive on read (backslash vs. forward slash)", () => {
    const key = canonicalKey("C:/proj-a");
    installConfigStore({ folderAliases: { [key]: "Project A" } });

    expect(getFolderAlias("C:\\proj-a")).toBe("Project A");
  });

  it("getFolderAlias() ignores a trailing-separator difference on read", () => {
    const key = canonicalKey("C:/proj-a");
    installConfigStore({ folderAliases: { [key]: "Project A" } });

    expect(getFolderAlias("C:/proj-a/")).toBe("Project A");
  });
});

// ---------------------------------------------------------------------------
// setFolderAlias
// ---------------------------------------------------------------------------

describe("setFolderAlias (FR-2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the alias under the folder's canonicalKey via config.update, Global scope", async () => {
    const { updateMock } = installConfigStore({ folderAliases: {} });

    await setFolderAlias("C:/proj-a", "Project A");

    expect(updateMock).toHaveBeenCalledWith(
      "folderAliases",
      { [canonicalKey("C:/proj-a")]: "Project A" },
      vscodeMock.ConfigurationTarget.Global
    );
  });

  it("preserves unrelated existing entries in the map on write", async () => {
    const existingKey = canonicalKey("C:/proj-existing");
    const { updateMock } = installConfigStore({
      folderAliases: { [existingKey]: "Existing" },
    });

    await setFolderAlias("C:/proj-a", "Project A");

    expect(updateMock).toHaveBeenCalledWith(
      "folderAliases",
      {
        [existingKey]: "Existing",
        [canonicalKey("C:/proj-a")]: "Project A",
      },
      vscodeMock.ConfigurationTarget.Global
    );
  });

  it("overwrites an existing entry for the same canonicalKey rather than duplicating it", async () => {
    const key = canonicalKey("C:/proj-a");
    const { updateMock } = installConfigStore({
      folderAliases: { [key]: "Old Name" },
    });

    // Different raw case/separator, same canonicalKey.
    await setFolderAlias("c:\\PROJ-a\\", "New Name");

    expect(updateMock).toHaveBeenCalledWith(
      "folderAliases",
      { [key]: "New Name" },
      vscodeMock.ConfigurationTarget.Global
    );
  });
});

// ---------------------------------------------------------------------------
// removeFolderAlias
// ---------------------------------------------------------------------------

describe("removeFolderAlias (FR-2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes the entry matching the folder's canonicalKey, preserving unrelated entries", async () => {
    const keyA = canonicalKey("C:/proj-a");
    const keyB = canonicalKey("C:/proj-b");
    const { updateMock } = installConfigStore({
      folderAliases: { [keyA]: "Project A", [keyB]: "Project B" },
    });

    await removeFolderAlias("C:/proj-a");

    expect(updateMock).toHaveBeenCalledWith(
      "folderAliases",
      { [keyB]: "Project B" },
      vscodeMock.ConfigurationTarget.Global
    );
  });

  it("is case/separator-insensitive when matching the entry to remove", async () => {
    const key = canonicalKey("C:/proj-a");
    const { updateMock } = installConfigStore({
      folderAliases: { [key]: "Project A" },
    });

    await removeFolderAlias("c:\\PROJ-a\\");

    expect(updateMock).toHaveBeenCalledWith(
      "folderAliases",
      {},
      vscodeMock.ConfigurationTarget.Global
    );
  });
});

// ---------------------------------------------------------------------------
// removeExtraFolder
// ---------------------------------------------------------------------------

describe("removeExtraFolder (FR-10)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes the matching raw entry from claudeConductor.extraFolders, preserving unrelated entries and order", async () => {
    const { updateMock } = installConfigStore({
      extraFolders: ["C:/proj-a", "C:/proj-b", "C:/proj-c"],
    });

    await removeExtraFolder("C:/proj-b");

    expect(updateMock).toHaveBeenCalledWith(
      "extraFolders",
      ["C:/proj-a", "C:/proj-c"],
      vscodeMock.ConfigurationTarget.Global
    );
  });

  it("matches case/separator-insensitively via canonicalKey (not the ad hoc path.normalize().toLowerCase() comparison in quickPick.ts)", async () => {
    const { updateMock } = installConfigStore({
      extraFolders: ["C:/proj-a"],
    });

    await removeExtraFolder("c:\\PROJ-A\\");

    expect(updateMock).toHaveBeenCalledWith(
      "extraFolders",
      [],
      vscodeMock.ConfigurationTarget.Global
    );
  });

  it("expands a '~'-prefixed entry the same way getExtraFolders does before comparing, and preserves other raw entries unexpanded (FR-10)", async () => {
    const home = os.homedir();
    const { updateMock } = installConfigStore({
      extraFolders: ["~/proj-tilde", "C:/proj-other"],
    });

    await removeExtraFolder(`${home}/proj-tilde`);

    expect(updateMock).toHaveBeenCalledWith(
      "extraFolders",
      ["C:/proj-other"],
      vscodeMock.ConfigurationTarget.Global
    );
  });

  it("is a no-op (does not rewrite the array) when the folder is not present in extraFolders", async () => {
    const { updateMock, store } = installConfigStore({
      extraFolders: ["C:/proj-a", "C:/proj-b"],
    });

    await removeExtraFolder("C:/not-in-list");

    expect(store.extraFolders).toEqual(["C:/proj-a", "C:/proj-b"]);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
