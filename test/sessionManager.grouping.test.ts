/**
 * Session-tab default grouping (#127) — the D4 Option A launch-path
 * replacement: `moveToEditor` two-step out, direct `location: {viewColumn}`
 * placement in.
 *
 * Spec: docs/specs/2026-08-15-session-tab-default-grouping.md § 5.2. Test
 * numbering and FR references below track that section directly so the two
 * stay traceable to each other.
 *
 * These tests assert only what Conductor *passes* to `createTerminal` given
 * a seeded `tabGroups.all` topology — they cannot and do not verify that a
 * real VS Code host honours a requested `viewColumn` (P-PLACE), resolves
 * `Beside` as claimed (P6), or reports `Tab.label` as `Terminal.name`
 * (P-LABEL). Those were settled empirically by the § 2.5 probe session
 * (spec § 5.3, § 2.5.1); this file is the "decision given a topology" half
 * only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";

vi.mock("fs");

import { SessionManager, SESSION_NAME_PREFIX } from "../src/sessionManager";
import * as vscodeMock from "./mocks/vscode";

// ---------------------------------------------------------------------------
// Fixture builders (spec § 5.1: "A shared tab-fixture builder belongs in the
// grouping test file rather than the mock")
// ---------------------------------------------------------------------------

/** A terminal tab (TabInputTerminal input) carrying the given label. */
function terminalTab(label: string): vscodeMock.Tab {
  return {
    label,
    group: undefined as unknown as vscodeMock.TabGroup, // wired by group() below
    input: new vscodeMock.TabInputTerminal(),
    isActive: false,
    isDirty: false,
    isPinned: false,
    isPreview: false,
  };
}

/** A non-terminal tab (e.g. a text editor) — never a Conductor tab, regardless of label. */
function textTab(label: string): vscodeMock.Tab {
  return {
    label,
    group: undefined as unknown as vscodeMock.TabGroup,
    input: {}, // deliberately not a TabInputTerminal instance
    isActive: false,
    isDirty: false,
    isPinned: false,
    isPreview: false,
  };
}

/** A Conductor session tab: a terminal tab whose label carries the real prefix. */
function conductorTab(name: string): vscodeMock.Tab {
  return terminalTab(`${SESSION_NAME_PREFIX}${name}`);
}

/**
 * Build a TabGroup at `viewColumn` holding `tabs`, wiring each tab's `group`
 * back-reference (`Tab.group` is non-optional on the real API,
 * index.d.ts:L19301-L19304 — § 2.4.1 never reads it, but the fixture stays
 * shape-faithful for a future change that does).
 */
function group(viewColumn: number, ...tabs: vscodeMock.Tab[]): vscodeMock.TabGroup {
  const g: vscodeMock.TabGroup = {
    isActive: false,
    viewColumn,
    activeTab: tabs[0],
    tabs,
  };
  for (const t of tabs) {
    t.group = g;
  }
  return g;
}

/** Seed `window.tabGroups.all` with the given groups (replaces, not appends). */
function setTopology(...groups: vscodeMock.TabGroup[]): void {
  vscodeMock.window.tabGroups.all = groups;
}

/** The `location` option passed to the Nth `createTerminal` call. */
function locationOf(callIndex = 0): { viewColumn?: number; preserveFocus?: boolean } | undefined {
  const calls = vi.mocked(vscodeMock.window.createTerminal).mock.calls;
  const opts = calls[callIndex]?.[0] as
    | { location?: { viewColumn?: number; preserveFocus?: boolean } }
    | undefined;
  return opts?.location;
}

/**
 * Make `createTerminal`'s returned stub carry a working `shellIntegration`
 * so `_dispatchClaudeCommand`'s fast path (src/sessionManager.ts:L151-L155)
 * resolves synchronously — no test in this file needs timer control
 * (spec § 5.1 item 5).
 */
function installFastDispatchStub(): void {
  vi.mocked(vscodeMock.window.createTerminal).mockImplementation(() => ({
    name: "mock-session-terminal",
    show: vi.fn(),
    sendText: vi.fn(),
    dispose: vi.fn(),
    processId: Promise.resolve(4242),
    shellIntegration: { executeCommand: vi.fn() },
    creationOptions: {},
  }));
}

describe("SessionManager — session-tab default grouping (#127)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // vi.restoreAllMocks() only restores vi.spyOn()-created spies to their
    // originals — it does not clear call history on the plain module-level
    // vi.fn()s this mock exports (test/mocks/vscode.ts), which are shared
    // across every test in the process. Clear the ones this file asserts on
    // explicitly, or call-index-based assertions (locationOf, "not called")
    // read stale calls from earlier tests.
    vi.mocked(vscodeMock.window.createTerminal).mockClear();
    vi.mocked(vscodeMock.commands.executeCommand).mockClear();
    vi.mocked(vscodeMock.window.tabGroups.onDidChangeTabs).mockClear();
    vi.mocked(vscodeMock.window.tabGroups.onDidChangeTabGroups).mockClear();
    vscodeMock.window.terminals = [];
    vscodeMock.resetTabGroups();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    installFastDispatchStub();
  });

  // -------------------------------------------------------------------------
  // Placement (spec § 5.2, tests 1-9)
  // -------------------------------------------------------------------------

  it("1. FR2/NFR5 — no groups at all places Beside with preserveFocus", async () => {
    setTopology();
    const manager = new SessionManager();
    await manager.launchSession("/repo/alpha");
    expect(locationOf()).toEqual({ viewColumn: vscodeMock.ViewColumn.Beside, preserveFocus: true });
    manager.dispose();
  });

  it("2. FR2/FR3 — groups exist but none holds a Conductor-labelled tab places Beside (the user's own terminal must not attract sessions)", async () => {
    setTopology(
      group(1, textTab("readme.md"), textTab("index.ts")),
      group(2, terminalTab("bash"))
    );
    const manager = new SessionManager();
    await manager.launchSession("/repo/beta");
    expect(locationOf()?.viewColumn).toBe(vscodeMock.ViewColumn.Beside);
    manager.dispose();
  });

  it("3. FR1 — exactly one group holds Conductor tabs, and it is chosen", async () => {
    setTopology(group(3, conductorTab("existing")));
    const manager = new SessionManager();
    await manager.launchSession("/repo/gamma");
    expect(locationOf()?.viewColumn).toBe(3);
    manager.dispose();
  });

  it("4. FR1 property 1 — majority wins over first-found (the dragged-out-tab case)", async () => {
    setTopology(
      group(1, conductorTab("solo")),
      group(3, conductorTab("a"), conductorTab("b"), conductorTab("c"))
    );
    const manager = new SessionManager();
    await manager.launchSession("/repo/delta");
    expect(locationOf()?.viewColumn).toBe(3);
    manager.dispose();
  });

  it("5. FR3 best-effort — foreign tabs in the winning group do not disqualify it (no containment check, § 2.4.3)", async () => {
    setTopology(
      group(3, conductorTab("solo")),
      group(2, conductorTab("a"), conductorTab("b"), textTab("notes.md"))
    );
    const manager = new SessionManager();
    await manager.launchSession("/repo/epsilon");
    expect(locationOf()?.viewColumn).toBe(2);
    manager.dispose();
  });

  it("6. § 2.4.2 — a non-terminal tab whose label carries the prefix is not counted", async () => {
    setTopology(
      group(2, conductorTab("real")),
      group(3, textTab(`${SESSION_NAME_PREFIX}notes`), textTab(`${SESSION_NAME_PREFIX}notes2`))
    );
    const manager = new SessionManager();
    await manager.launchSession("/repo/zeta");
    expect(locationOf()?.viewColumn).toBe(2);
    manager.dispose();
  });

  it("7. § 2.4.2 — a terminal tab whose label lacks the prefix is not counted", async () => {
    setTopology(
      group(2, conductorTab("real")),
      group(3, terminalTab("bash"), terminalTab("zsh"))
    );
    const manager = new SessionManager();
    await manager.launchSession("/repo/eta");
    expect(locationOf()?.viewColumn).toBe(2);
    manager.dispose();
  });

  it("8. FR1 tie-break — equal counts resolve to the lowest viewColumn, independent of tabGroups.all order", async () => {
    setTopology(
      group(2, conductorTab("a"), conductorTab("b")),
      group(4, conductorTab("c"), conductorTab("d"))
    );
    const manager1 = new SessionManager();
    await manager1.launchSession("/repo/theta-1");
    expect(locationOf(0)?.viewColumn).toBe(2);
    manager1.dispose();

    // Re-seed with the groups in reverse array order — same answer expected.
    setTopology(
      group(4, conductorTab("c"), conductorTab("d")),
      group(2, conductorTab("a"), conductorTab("b"))
    );
    const manager2 = new SessionManager();
    await manager2.launchSession("/repo/theta-2");
    expect(locationOf(1)?.viewColumn).toBe(2);
    manager2.dispose();
  });

  it("9. § 2.4.1 property 4 — a group with no tabs is skipped, never chosen", async () => {
    setTopology(group(1), group(2, conductorTab("a")));
    const manager = new SessionManager();
    await manager.launchSession("/repo/iota");
    expect(locationOf()?.viewColumn).toBe(2);
    manager.dispose();
  });

  // -------------------------------------------------------------------------
  // Focus / launch-path shape (spec § 5.2, tests 10-13)
  // -------------------------------------------------------------------------

  it("10. NFR5 — preserveFocus is true for both the Beside and numeric-column cases", async () => {
    setTopology();
    const manager = new SessionManager();
    await manager.launchSession("/repo/kappa");
    expect(locationOf(0)?.preserveFocus).toBe(true);

    setTopology(group(2, conductorTab("a")));
    await manager.launchSession("/repo/lambda");
    expect(locationOf(1)?.preserveFocus).toBe(true);
    manager.dispose();
  });

  it("11. FR10 — the launch path never calls terminal.show(true)", async () => {
    setTopology();
    const manager = new SessionManager();
    await manager.launchSession("/repo/mu");
    const created = vi.mocked(vscodeMock.window.createTerminal).mock.results[0]
      .value as { show: ReturnType<typeof vi.fn> };
    expect(created.show).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("12. FR10 — the launch path never invokes workbench.action.terminal.moveToEditor", async () => {
    setTopology();
    const manager = new SessionManager();
    await manager.launchSession("/repo/nu");
    expect(vscodeMock.commands.executeCommand).not.toHaveBeenCalledWith(
      "workbench.action.terminal.moveToEditor"
    );
    manager.dispose();
  });

  it("13. FR9 — the reuse branch runs no grouping logic: createTerminal is not called at all", async () => {
    const folderPath = "/repo/xi";
    vscodeMock.window.terminals = [
      {
        name: `${SESSION_NAME_PREFIX}xi`,
        show: vi.fn(),
        sendText: vi.fn(),
        dispose: vi.fn(),
        processId: Promise.resolve(1),
        shellIntegration: undefined,
        creationOptions: { cwd: folderPath },
      },
    ];
    // A non-empty topology that must never be read by the reuse branch.
    setTopology(group(5, conductorTab("xi")));
    const manager = new SessionManager();
    const result = await manager.launchSession(folderPath);
    expect(result).toEqual({ ok: true, reused: true });
    expect(vscodeMock.window.createTerminal).not.toHaveBeenCalled();
    manager.dispose();
  });

  // -------------------------------------------------------------------------
  // Statelessness and repeatability (spec § 5.2, tests 14-16)
  // -------------------------------------------------------------------------

  it("14. FR11 — two sequential launches against an unchanged topology place identically", async () => {
    setTopology(group(4, conductorTab("a"), conductorTab("b")));
    const manager = new SessionManager();
    await manager.launchSession("/repo/omicron-1");
    await manager.launchSession("/repo/omicron-2");
    expect(locationOf(0)?.viewColumn).toBe(4);
    expect(locationOf(1)?.viewColumn).toBe(4);
    manager.dispose();
  });

  it("15. FR5/FR3 — a topology change between launches changes the answer with no invalidation step (group moved, then closed)", async () => {
    setTopology(group(2, conductorTab("moved-a"), conductorTab("moved-b")));
    const manager = new SessionManager();
    await manager.launchSession("/repo/pi-1");
    expect(locationOf(0)?.viewColumn).toBe(2);

    // Simulate the user dragging the Conductor tabs to a new column.
    setTopology(group(5, conductorTab("moved-a"), conductorTab("moved-b")));
    await manager.launchSession("/repo/pi-2");
    expect(locationOf(1)?.viewColumn).toBe(5);

    // Simulate the group closing entirely — no cached column to go stale.
    setTopology();
    await manager.launchSession("/repo/pi-3");
    expect(locationOf(2)?.viewColumn).toBe(vscodeMock.ViewColumn.Beside);

    manager.dispose();
  });

  it("16. FR11/NFR8 — placement registers no tabGroups listener and no new subscription", async () => {
    setTopology(group(2, conductorTab("a")));
    const manager = new SessionManager();
    await manager.launchSession("/repo/rho");
    expect(vscodeMock.window.tabGroups.onDidChangeTabs).not.toHaveBeenCalled();
    expect(vscodeMock.window.tabGroups.onDidChangeTabGroups).not.toHaveBeenCalled();
    manager.dispose();
  });

  // -------------------------------------------------------------------------
  // Concurrency — both synchronous, no timers (spec § 5.2, tests 17-18)
  // -------------------------------------------------------------------------

  it("17. FR8/§ 2.4.4 case 2 — two overlapping warm launches agree on the same column", async () => {
    setTopology(group(3, conductorTab("a")));
    const manager = new SessionManager();
    const p1 = manager.launchSession("/repo/sigma-1");
    const p2 = manager.launchSession("/repo/sigma-2");
    await Promise.all([p1, p2]);
    expect(locationOf(0)?.viewColumn).toBe(3);
    expect(locationOf(1)?.viewColumn).toBe(3);
    manager.dispose();
  });

  it("18. FR8/§ 2.4.4 case 3 — two overlapping cold launches both request Beside without blocking", async () => {
    setTopology();
    const manager = new SessionManager();
    const p1 = manager.launchSession("/repo/tau-1");
    const p2 = manager.launchSession("/repo/tau-2");
    // Both createTerminal calls already happened synchronously before either
    // promise is awaited — this is the assertion that no timer advance is
    // needed for the placement decision itself.
    expect(vscodeMock.window.createTerminal).toHaveBeenCalledTimes(2);
    expect(locationOf(0)?.viewColumn).toBe(vscodeMock.ViewColumn.Beside);
    expect(locationOf(1)?.viewColumn).toBe(vscodeMock.ViewColumn.Beside);
    await Promise.all([p1, p2]);
    manager.dispose();
  });
});
