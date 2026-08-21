import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  getClaudeCommand,
  getReuseTerminal,
  getLaunchDelayMs,
  getFolderAlias,
} from "./config";
import { log, debugLog } from "./output";
import { isLikelyNetworkPath } from "./networkPath";

/** Prefix used for all Claude session terminal names */
export const SESSION_NAME_PREFIX = "claude · ";

/**
 * Result returned by {@link SessionManager.launchSession}.
 * - `ok: true` — session was created or reused successfully
 * - `ok: false` — launch was refused; inspect `reason` and `message` for details
 */
export type LaunchResult =
  | { ok: true; reused: boolean }
  | { ok: false; reason: "missing" | "other"; message: string };

const STATE_DIR = path.join(os.homedir(), ".claude", "session-state");

interface SessionState {
  state: "idle" | "active";
  cwd: string;
  sessionId: string;
  timestamp: number;
}

export interface ActiveSession {
  terminal: vscode.Terminal;
  folderPath: string;
  folderName: string;
  startedAt: Date;
  isIdle: boolean;
}

export class SessionManager implements vscode.Disposable {
  private readonly _sessions = new Map<vscode.Terminal, ActiveSession>();
  private readonly _disposables: vscode.Disposable[] = [];

  /**
   * Secondary index: processId → terminal map entry key.
   * Retained as a safety net when onDidCloseTerminal supplies a reference
   * that isn't in _sessions by identity. The original moveToEditor reference-
   * swap trigger is gone from the launch path; removing this index remains a
   * separate, evidence-gated decision tracked by #68.
   */
  private readonly _pidToTerminal = new Map<number, vscode.Terminal>();

  private readonly _onDidChangeSessions = new vscode.EventEmitter<void>();
  /** Fires whenever the active session list changes (open or close). */
  readonly onDidChangeSessions = this._onDidChangeSessions.event;

  constructor() {
    // Pick up any Claude terminals that already exist (e.g., extension reloaded)
    for (const terminal of vscode.window.terminals) {
      this._trackIfClaudeSession(terminal);
    }

    this._disposables.push(
      vscode.window.onDidOpenTerminal((terminal) => {
        this._trackIfClaudeSession(terminal);
      }),
      vscode.window.onDidCloseTerminal((terminal) => {
        this._handleTerminalClose(terminal);
      }),
      this._onDidChangeSessions
    );
  }

  /** All currently active Claude sessions. */
  get activeSessions(): ActiveSession[] {
    return Array.from(this._sessions.values());
  }

  /** Number of active sessions. */
  get count(): number {
    return this._sessions.size;
  }

  /**
   * Launch a new Claude session in the given folder, or focus an existing one
   * if reuseExistingTerminal is enabled.
   *
   * Returns a {@link LaunchResult} describing the outcome. Callers that
   * previously ignored the `void` return can continue to ignore `ok: true`;
   * inspect `ok: false` to surface errors to the user.
   */
  async launchSession(folderPath: string): Promise<LaunchResult> {
    const normalized = path.normalize(folderPath);

    // Guard: refuse to create a terminal for a cwd that no longer exists on
    // disk.  This prevents VS Code from emitting "Starting directory does not
    // exist" errors when a stale _sessions entry (whose directory has since
    // been deleted or moved) is somehow passed here.
    //
    // Skip the pre-flight for UNC paths — sync existsSync can hang on SMB
    // timeouts for \\server\share paths, making the guard counterproductive.
    if (!isLikelyNetworkPath(folderPath)) {
      if (!fs.existsSync(normalized)) {
        log(`[launch] skipping — cwd does not exist: ${normalized}`);
        return {
          ok: false,
          reason: "missing",
          message: `Folder does not exist: ${normalized}`,
        };
      }
    }

    if (getReuseTerminal()) {
      const existing = this._findSessionByFolder(normalized);
      if (existing) {
        const isLiveTerminal = vscode.window.terminals.includes(existing.terminal);
        if (isLiveTerminal && existing.terminal.exitStatus === undefined) {
          this.focusSession(existing);
          return { ok: true, reused: true };
        }

        log(`[launch] replacing stale terminal for cwd: ${normalized}`);
        this._removeByKey(existing.terminal);
      }
    }

    const folderName = getFolderAlias(normalized) ?? path.basename(normalized);
    const targetColumn = this._resolveTargetColumn();
    const terminal = vscode.window.createTerminal({
      name: `${SESSION_NAME_PREFIX}${folderName}`,
      cwd: isLikelyNetworkPath(folderPath) ? folderPath : normalized,
      iconPath: new vscode.ThemeIcon("sparkle"),
      color: new vscode.ThemeColor("terminal.ansiGreen"),
      location: { viewColumn: targetColumn ?? vscode.ViewColumn.Beside, preserveFocus: true },
    });

    // Dispatch the claude command only after the shell prompt is ready
    await this._dispatchClaudeCommand(terminal);

    return { ok: true, reused: false };
  }

  /**
   * Best-effort placement (FR1/FR3): the editor group holding the most
   * Conductor-labelled tabs. Ties resolve to the lowest viewColumn so that
   * repeated launches against an unchanged topology are deterministic.
   * Returns undefined when no group holds any — the caller requests Beside.
   */
  private _resolveTargetColumn(): vscode.ViewColumn | undefined {
    let bestColumn: vscode.ViewColumn | undefined;
    let bestCount = 0;

    for (const group of vscode.window.tabGroups.all) {
      let count = 0;
      for (const tab of group.tabs) {
        if (this._isConductorTab(tab)) count++;
      }
      if (count === 0) continue;
      if (bestColumn === undefined
          || count > bestCount
          || (count === bestCount && group.viewColumn < bestColumn)) {
        bestCount = count;
        bestColumn = group.viewColumn;
      }
    }

    debugLog(`[group:resolve] column=${bestColumn ?? "beside"} count=${bestCount} groups=${vscode.window.tabGroups.all.length}`);
    return bestColumn;
  }

  /**
   * Heuristic (§ 2.3): a tab is treated as Conductor's when it is a terminal tab
   * in the editor area whose label carries the session-name prefix. This is the
   * only signal the stable Tab API offers — see the spec for what it does not prove.
   */
  private _isConductorTab(tab: vscode.Tab): boolean {
    return tab.input instanceof vscode.TabInputTerminal
        && tab.label.startsWith(SESSION_NAME_PREFIX);
  }

  /**
   * Dispatch `claude` to the terminal using the best available mechanism:
   *
   * 1. Fast path — shell integration already active at call time.
   * 2. Slow path — wait up to 2 s for shell integration to activate.
   * 3. Delay fallback — sleep `claudeConductor.launchDelayMs` ms then sendText.
   *    Covers VS Code < 1.93 and setups where shell integration never activates.
   */
  private async _dispatchClaudeCommand(terminal: vscode.Terminal): Promise<void> {
    const cmd = getClaudeCommand();

    // Fast path: shell integration already active
    if (terminal.shellIntegration) {
      log(`[dispatch] fast path — shell integration already active`);
      terminal.shellIntegration.executeCommand(cmd);
      return;
    }

    // Slow path: wait for shell integration to activate (up to 2000 ms)
    const shellIntegrationAvailable = await new Promise<boolean>((resolve) => {
      let disposed = false;

      const timeoutHandle = setTimeout(() => {
        if (!disposed) {
          disposed = true;
          listener.dispose();
          log(`[dispatch] slow path timed out — falling back to delay sendText`);
          resolve(false);
        }
      }, 2000);

      const listener = vscode.window.onDidChangeTerminalShellIntegration((e) => {
        if (e.terminal === terminal && !disposed) {
          disposed = true;
          clearTimeout(timeoutHandle);
          listener.dispose();
          log(`[dispatch] slow path — shell integration activated`);
          e.shellIntegration.executeCommand(cmd);
          resolve(true);
        }
      });
    });

    if (shellIntegrationAvailable) {
      return;
    }

    // Delay fallback: sendText after a configurable delay
    const delayMs = getLaunchDelayMs();
    log(`[dispatch] delay fallback — waiting ${delayMs} ms then sendText`);
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    terminal.sendText(cmd);
  }

  /** Focus an existing session's editor tab. */
  focusSession(session: ActiveSession): void {
    session.terminal.show(false);
  }

  /** Close a session's terminal. */
  closeSession(session: ActiveSession): void {
    // The terminal reference on the passed session may no longer be the live
    // entry tracked in _sessions. Re-resolve by folderPath so we dispose the
    // current terminal reference; retaining this safety net is evidence-gated
    // on #68. Falls back to session.terminal when the entry has already been
    // evicted (e.g. a rapid double-close), in which case ?. makes it a no-op.
    const live = this._findSessionByFolder(session.folderPath);
    const terminal = live?.terminal ?? session.terminal;
    terminal?.dispose();
    // onDidCloseTerminal listener handles cleanup and event firing
  }

  /** Set the idle state for a session by folder path. */
  setSessionIdle(folderPath: string, idle: boolean): void {
    const session = this._findSessionByFolder(path.normalize(folderPath));
    if (session && session.isIdle !== idle) {
      session.isIdle = idle;
      this._onDidChangeSessions.fire();
    }
  }

  /** Find a session by its folder path (case-insensitive). */
  findSessionByFolder(folderPath: string): ActiveSession | undefined {
    return this._findSessionByFolder(path.normalize(folderPath));
  }

  /**
   * Reconcile _sessions against vscode.window.terminals.
   *
   * Called each poll tick by StateWatcher. Any session whose terminal is no
   * longer present in the live terminal list is treated as closed (the
   * onDidCloseTerminal event was missed, e.g. editor-tab X on Windows).
   * The corresponding state file in ~/.claude/session-state/ is also deleted
   * so the Stop hook gap doesn't leave orphaned idle files on disk.
   */
  reconcile(): void {
    const liveTerminals = new Set(vscode.window.terminals);
    debugLog(`[reconcile] sessions=${this._sessions.size} liveTerminals=${vscode.window.terminals.length}`);
    let changed = false;

    for (const [terminal, session] of this._sessions) {
      if (!liveTerminals.has(terminal)) {
        debugLog(`[reconcile:evict] name=${JSON.stringify(terminal.name)} folderPath=${JSON.stringify(session.folderPath)}`);
        this._sessions.delete(terminal);
        this._cleanupStateFile(session.folderPath);
        changed = true;
      }
    }

    if (!changed) {
      debugLog(`[reconcile:clean] no evictions`);
    }

    if (changed) {
      this._onDidChangeSessions.fire();
    }
  }

  /** Check if a terminal is a Claude session by name pattern. */
  private _isClaudeSession(terminal: vscode.Terminal): boolean {
    return terminal.name.startsWith(SESSION_NAME_PREFIX);
  }

  /** Extract folder path from a Claude session terminal. */
  private _extractFolderPath(terminal: vscode.Terminal): string | undefined {
    const opts = terminal.creationOptions as vscode.TerminalOptions;
    if (opts.cwd) {
      return typeof opts.cwd === "string" ? opts.cwd : opts.cwd.fsPath;
    }
    return undefined;
  }

  /** Track a terminal if it's a Claude session. */
  private _trackIfClaudeSession(terminal: vscode.Terminal): void {
    if (!this._isClaudeSession(terminal)) {
      debugLog(`[track] skip name=${JSON.stringify(terminal.name)} reason=not-claude sessions=${this._sessions.size} pids=${this._pidToTerminal.size}`);
      return;
    }
    const folderPath = this._extractFolderPath(terminal);
    if (!folderPath) {
      debugLog(`[track] skip name=${JSON.stringify(terminal.name)} reason=no-cwd sessions=${this._sessions.size} pids=${this._pidToTerminal.size}`);
      return;
    }

    debugLog(`[track] tracking name=${JSON.stringify(terminal.name)} folderPath=${JSON.stringify(folderPath)} sessions=${this._sessions.size} pids=${this._pidToTerminal.size}`);

    this._sessions.set(terminal, {
      terminal,
      folderPath: path.normalize(folderPath),
      folderName: path.basename(folderPath),
      startedAt: new Date(),
      isIdle: false,
    });

    // Register PID as a secondary lookup key once it resolves.
    // processId is a Thenable<number | undefined> — we don't await here to
    // avoid blocking the synchronous tracking path.
    // Use two-argument .then() because PromiseLike lacks .catch().
    terminal.processId.then(
      (pid) => {
        if (pid !== undefined) {
          this._pidToTerminal.set(pid, terminal);
          debugLog(`[track:pid] resolved pid=${pid} name=${JSON.stringify(terminal.name)} pids=${this._pidToTerminal.size}`);
        } else {
          debugLog(`[track:pid] pid=undefined name=${JSON.stringify(terminal.name)} — not indexed`);
        }
      },
      () => { debugLog(`[track:pid] processId rejected name=${JSON.stringify(terminal.name)}`); }
    );

    this._onDidChangeSessions.fire();
  }

  /**
   * Handle a terminal-close event with retained three-tier fallback:
   * 1. Identity match against the tracked terminal reference.
   * 2. Name match, disambiguated by folder when identity is unavailable.
   * 3. PID match when the close event carries no usable name.
   * The fallback tiers remain as a safety net pending evidence from #68.
   */
  private _handleTerminalClose(terminal: vscode.Terminal): void {
    debugLog(`[close] event name=${JSON.stringify(terminal.name)} sessionsBefore=${this._sessions.size} pids=${this._pidToTerminal.size}`);

    // Tier 1 — identity
    if (this._removeByKey(terminal)) {
      debugLog(`[close:tier1] hit name=${JSON.stringify(terminal.name)}`);
      return;
    }
    debugLog(`[close:tier1] miss name=${JSON.stringify(terminal.name)}`);

    // Tier 2 — name match (only when name is non-empty)
    if (terminal.name) {
      const nameMatches = Array.from(this._sessions.entries()).filter(
        ([, session]) => session.terminal.name === terminal.name
      );

      if (nameMatches.length === 1) {
        const [[key, session]] = nameMatches;
        debugLog(`[close:tier2] hit name=${JSON.stringify(terminal.name)} matchedSession=${JSON.stringify(session.folderPath)}`);
        this._removeByKey(key);
        return;
      }

      if (nameMatches.length > 1) {
        const closedFolderPath = this._extractFolderPath(terminal);
        const normalizedClosedFolderPath = closedFolderPath
          ? path.normalize(closedFolderPath).toLowerCase()
          : undefined;
        const folderMatches = normalizedClosedFolderPath
          ? nameMatches.filter(([, session]) =>
              session.folderPath.toLowerCase() === normalizedClosedFolderPath
            )
          : [];

        if (folderMatches.length === 1) {
          const [[key, session]] = folderMatches;
          debugLog(`[close:tier2:disambiguated] hit name=${JSON.stringify(terminal.name)} closedFolderPath=${JSON.stringify(closedFolderPath)} matchedSession=${JSON.stringify(session.folderPath)}`);
          this._removeByKey(key);
          return;
        }

        debugLog(`[close:tier2:ambiguous] name=${JSON.stringify(terminal.name)} candidates=${nameMatches.length} closedFolderPath=${JSON.stringify(closedFolderPath)} folderMatches=${folderMatches.length} — deferring to tier 3`);
      } else {
        debugLog(`[close:tier2] miss name=${JSON.stringify(terminal.name)} checkedSessions=${this._sessions.size}`);
      }
    } else {
      debugLog(`[close:tier2] skip name="" (empty — cannot match by name)`);
    }

    // Tier 3 — PID match. processId is a Thenable; we must handle it async.
    // Use two-argument .then() because PromiseLike lacks .catch().
    // Falls back to reconcile() on the next poll tick if this also misses.
    terminal.processId.then(
      (pid) => {
        if (pid === undefined) {
          debugLog(`[close:tier3:no-pid] processId=undefined name=${JSON.stringify(terminal.name)} — deferring to reconcile()`);
          return;
        }
        const trackedTerminal = this._pidToTerminal.get(pid);
        const sessionStillExists = trackedTerminal ? this._sessions.has(trackedTerminal) : false;
        debugLog(`[close:tier3] pid=${pid} name=${JSON.stringify(terminal.name)} inPidIndex=${trackedTerminal !== undefined} sessionStillExists=${sessionStillExists}`);
        if (trackedTerminal && sessionStillExists) {
          this._removeByKey(trackedTerminal);
        }
      },
      () => {
        debugLog(`[close:tier3:no-pid] processId rejected name=${JSON.stringify(terminal.name)} — deferring to reconcile()`);
      }
    );
  }

  /**
   * Remove a session keyed by terminal, clean up the PID index and state
   * file, and fire the change event. Returns true if a session was removed.
   */
  private _removeByKey(terminal: vscode.Terminal): boolean {
    const session = this._sessions.get(terminal);
    if (!session) {
      debugLog(`[remove] miss name=${JSON.stringify(terminal.name)} — key already gone (possible double-fire)`);
      return false;
    }
    this._sessions.delete(terminal);
    debugLog(`[remove] success folderPath=${JSON.stringify(session.folderPath)} sessionsAfter=${this._sessions.size}`);

    // Remove from PID index (two-argument .then() because PromiseLike lacks .catch())
    terminal.processId.then(
      (pid) => {
        if (pid !== undefined) {
          this._pidToTerminal.delete(pid);
          debugLog(`[pid:delete] pid=${pid} pidsAfter=${this._pidToTerminal.size}`);
        }
      },
      () => { /* ignore */ }
    );

    this._cleanupStateFile(session.folderPath);
    this._onDidChangeSessions.fire();
    return true;
  }

  /**
   * Delete the ~/.claude/session-state/*.json file whose `cwd` matches
   * folderPath. This is a best-effort extension-side fallback for the case
   * where the Claude Code Stop hook didn't run (e.g. terminal killed via
   * editor-tab X). Without this, StateWatcher keeps re-marking the session
   * idle on every poll tick even after the terminal is gone.
   */
  private _cleanupStateFile(folderPath: string): void {
    try {
      if (!fs.existsSync(STATE_DIR)) {
        return;
      }
      const files = fs.readdirSync(STATE_DIR);
      for (const file of files) {
        if (!file.endsWith(".json")) {
          continue;
        }
        const filePath = path.join(STATE_DIR, file);
        try {
          const raw = fs.readFileSync(filePath, "utf8");
          const parsed = JSON.parse(raw) as Partial<SessionState>;
          if (
            parsed.cwd &&
            path.normalize(parsed.cwd).toLowerCase() === folderPath.toLowerCase()
          ) {
            fs.unlinkSync(filePath);
          }
        } catch {
          // File may be partially written, already deleted, or unreadable
        }
      }
    } catch {
      // STATE_DIR may not exist yet or may be unreadable
    }
  }

  /** Find session by normalized folder path. */
  private _findSessionByFolder(normalizedPath: string): ActiveSession | undefined {
    const key = normalizedPath.toLowerCase();
    for (const session of this._sessions.values()) {
      if (session.folderPath.toLowerCase() === key) {
        return session;
      }
    }
    return undefined;
  }

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._sessions.clear();
    this._pidToTerminal.clear();
  }
}
