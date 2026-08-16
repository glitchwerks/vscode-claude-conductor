/**
 * Minimal vscode module mock for unit tests.
 *
 * Covers only the symbols imported by src/** today. Extend as new tests need
 * additional surface area — this is intentionally not exhaustive.
 */
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Disposable
// ---------------------------------------------------------------------------

export class Disposable {
  static from(...disposables: { dispose(): void }[]): Disposable {
    return new Disposable(() => disposables.forEach((d) => d.dispose()));
  }

  constructor(private readonly _callOnDispose: () => void) {}

  dispose(): void {
    this._callOnDispose();
  }
}

// ---------------------------------------------------------------------------
// EventEmitter
// ---------------------------------------------------------------------------

export class EventEmitter<T> {
  private readonly _listeners: Array<(e: T) => void> = [];

  readonly event = (listener: (e: T) => void): Disposable => {
    this._listeners.push(listener);
    return new Disposable(() => {
      const idx = this._listeners.indexOf(listener);
      if (idx !== -1) {
        this._listeners.splice(idx, 1);
      }
    });
  };

  fire(data: T): void {
    for (const l of this._listeners) {
      l(data);
    }
  }

  dispose(): void {
    this._listeners.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Uri
// ---------------------------------------------------------------------------

export class Uri {
  static file(path: string): Uri {
    return new Uri("file", "", path, "", "");
  }

  static parse(value: string): Uri {
    return new Uri("vscode", "", value, "", "");
  }

  readonly fsPath: string;

  constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
    readonly query: string,
    readonly fragment: string
  ) {
    this.fsPath = path;
  }
}

// ---------------------------------------------------------------------------
// TreeItem / enums
// ---------------------------------------------------------------------------

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label?: string;
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;
  collapsibleState?: TreeItemCollapsibleState;

  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class ThemeIcon {
  constructor(
    readonly id: string,
    readonly color?: ThemeColor
  ) {}
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

// ---------------------------------------------------------------------------
// Enums used by src/
// ---------------------------------------------------------------------------

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export enum TerminalLocation {
  Panel = 1,
  Editor = 2,
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

// mirrors node_modules/@types/vscode/index.d.ts:L7343-L7392
export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
  Four = 4,
  Five = 5,
  Six = 6,
  Seven = 7,
  Eight = 8,
  Nine = 9,
}

// ---------------------------------------------------------------------------
// Tabs / tab groups (session-tab-default-grouping, #127)
// ---------------------------------------------------------------------------

/**
 * Bare marker class — mirrors the real `TabInputTerminal`
 * (node_modules/@types/vscode/index.d.ts:L19282-L19287), which has a
 * zero-argument constructor and no fields. `instanceof` against this class
 * is the narrowing half of `_isConductorTab` (spec § 2.4.2).
 */
export class TabInputTerminal {
  constructor() {}
}

/** Mirrors the field set of the real `Tab` (index.d.ts:L19294-L19332). */
export interface Tab {
  label: string;
  group: TabGroup;
  input: unknown;
  isActive: boolean;
  isDirty: boolean;
  isPinned: boolean;
  isPreview: boolean;
}

/** Mirrors the field set of the real `TabGroup` (index.d.ts:L19375-L19404). */
export interface TabGroup {
  isActive: boolean;
  viewColumn: number;
  activeTab: Tab | undefined;
  tabs: Tab[];
}

// ---------------------------------------------------------------------------
// RelativePattern
// ---------------------------------------------------------------------------

export class RelativePattern {
  constructor(
    readonly base: Uri | string,
    readonly pattern: string
  ) {}
}

// ---------------------------------------------------------------------------
// WorkspaceConfiguration stub
// ---------------------------------------------------------------------------

class WorkspaceConfigurationStub {
  get<T>(section: string, defaultValue: T): T {
    return defaultValue;
  }

  update = vi.fn().mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// OutputChannel stub
// ---------------------------------------------------------------------------

class OutputChannelStub {
  appendLine = vi.fn();
  dispose = vi.fn();
}

// ---------------------------------------------------------------------------
// FileSystemWatcher stub
// ---------------------------------------------------------------------------

class FileSystemWatcherStub {
  onDidCreate = vi.fn().mockReturnValue(new Disposable(() => {}));
  onDidChange = vi.fn().mockReturnValue(new Disposable(() => {}));
  onDidDelete = vi.fn().mockReturnValue(new Disposable(() => {}));
  dispose = vi.fn();
}

// ---------------------------------------------------------------------------
// StatusBarItem stub
// ---------------------------------------------------------------------------

class StatusBarItemStub {
  text = "";
  command: string | undefined = undefined;
  tooltip: string | undefined = undefined;
  show = vi.fn();
  hide = vi.fn();
  dispose = vi.fn();
}

// ---------------------------------------------------------------------------
// TreeView stub
// ---------------------------------------------------------------------------

class TreeViewStub {
  message: string | undefined = undefined;
  visible = true;
  dispose = vi.fn();
}

// ---------------------------------------------------------------------------
// window namespace
// ---------------------------------------------------------------------------

export const window = {
  terminals: [] as unknown[],
  activeTerminal: undefined as unknown,

  // A distinct stub per call (rather than a fixed mockReturnValue) so two
  // launches in the same test are distinguishable in assertions — required
  // by the session-tab-default-grouping mock work (spec § 5.1 item 4).
  createTerminal: vi.fn().mockImplementation(() => ({
    name: "mock-terminal",
    show: vi.fn(),
    sendText: vi.fn(),
    dispose: vi.fn(),
    processId: Promise.resolve(undefined),
    shellIntegration: undefined,
    creationOptions: {},
  })),

  // Live editor tab-group model (session-tab-default-grouping, #127). `all`
  // is a plain mutable array — tests assign it directly to seed a topology
  // (spec § 5.1 item 3); neither event is driven, since Rev 3's mechanism
  // subscribes to neither (§ 2.4.5).
  tabGroups: {
    all: [] as TabGroup[],
    activeTabGroup: undefined as TabGroup | undefined,
    onDidChangeTabGroups: vi.fn().mockReturnValue(new Disposable(() => {})),
    onDidChangeTabs: vi.fn().mockReturnValue(new Disposable(() => {})),
    close: vi.fn(),
  },

  onDidOpenTerminal: vi.fn().mockReturnValue(new Disposable(() => {})),
  onDidCloseTerminal: vi.fn().mockReturnValue(new Disposable(() => {})),
  onDidChangeTerminalShellIntegration: vi.fn().mockReturnValue(new Disposable(() => {})),
  // Issue #128 (hook self-heal): activate() registers a listener here to
  // retry the hook self-heal check on the window's false->true focus edge.
  // Tests capture the registered listener via this mock's .mock.calls and
  // invoke it directly with a { focused: boolean } payload — there is no
  // real event-firing plumbing here, matching this file's existing style
  // for onDidOpenTerminal/onDidCloseTerminal above.
  onDidChangeWindowState: vi.fn().mockReturnValue(new Disposable(() => {})),

  createOutputChannel: vi.fn().mockImplementation(() => new OutputChannelStub()),

  showInformationMessage: vi.fn().mockResolvedValue(undefined),
  showWarningMessage: vi.fn().mockResolvedValue(undefined),
  showErrorMessage: vi.fn().mockResolvedValue(undefined),
  showQuickPick: vi.fn().mockResolvedValue(undefined),
  showInputBox: vi.fn().mockResolvedValue(undefined),

  registerTreeDataProvider: vi.fn().mockReturnValue(new Disposable(() => {})),
  registerUriHandler: vi.fn().mockReturnValue(new Disposable(() => {})),
  registerTerminalLinkProvider: vi.fn().mockReturnValue(new Disposable(() => {})),

  createStatusBarItem: vi.fn().mockImplementation(() => new StatusBarItemStub()),
  createTreeView: vi.fn().mockImplementation(() => new TreeViewStub()),
  showOpenDialog: vi.fn().mockResolvedValue(undefined),
};

/**
 * Reset `window.tabGroups.all` between tests, mirroring the existing
 * `vscodeMock.window.terminals.length = 0` reset pattern
 * (test/sessionManager.closeDetection.test.ts:L23) for this module-level
 * singleton (spec § 5.1 item 6).
 */
export function resetTabGroups(): void {
  window.tabGroups.all = [];
  window.tabGroups.activeTabGroup = undefined;
}

// ---------------------------------------------------------------------------
// workspace namespace
// ---------------------------------------------------------------------------

export const workspace = {
  workspaceFolders: undefined as unknown,

  onDidChangeWorkspaceFolders: vi.fn().mockReturnValue(new Disposable(() => {})),

  getConfiguration: vi.fn().mockImplementation(() => new WorkspaceConfigurationStub()),

  onDidChangeConfiguration: vi.fn().mockReturnValue(new Disposable(() => {})),

  createFileSystemWatcher: vi.fn().mockImplementation(() => new FileSystemWatcherStub()),

  openTextDocument: vi.fn().mockResolvedValue({}),

  fs: {
    stat: vi.fn(),
  },
};

// ---------------------------------------------------------------------------
// commands namespace
// ---------------------------------------------------------------------------

export const commands = {
  registerCommand: vi.fn().mockReturnValue(new Disposable(() => {})),
  executeCommand: vi.fn().mockResolvedValue(undefined),
};

// ---------------------------------------------------------------------------
// env namespace
// ---------------------------------------------------------------------------

export const env = {
  openExternal: vi.fn().mockResolvedValue(true),
};
