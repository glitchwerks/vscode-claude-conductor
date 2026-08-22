import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as child_process from "child_process";
import { debugLog, log } from "./output";

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const LOCK_PATH = `${SETTINGS_PATH}.lock`;
const STALE_LOCK_THRESHOLD_MS = 5000;
const STATE_DIR = path.join(os.homedir(), ".claude", "session-state");
const HOOK_MARKER = "session-state.js";
const SETUP_DECLINED_KEY = "claudeConductor.hookSetupDeclined";
const notifiedReloadSignatures = new Set<string>();
let inFlight: Promise<boolean> | undefined;

/**
 * Resolve the Node.js binary from PATH, then fall back to common install locations.
 */
export function resolveNodeBinary(deps?: {
  execSync?: typeof child_process.execSync;
  existsSync?: typeof fs.existsSync;
}): string {
  const execSync = deps?.execSync ?? child_process.execSync;
  const existsSync = deps?.existsSync ?? fs.existsSync;
  const isWin32 = process.platform === "win32";

  try {
    const stdout = execSync(isWin32 ? "where node" : "which node", {
      encoding: "utf8",
    });
    const resolvedPath = stdout.split(/\r\n|\n|\r/)[0].trim();
    if (resolvedPath && existsSync(resolvedPath)) {
      return resolvedPath;
    }
  } catch {
    // Fall through to common install locations.
  }

  const commonPaths = isWin32
    ? ["C:\\Program Files\\nodejs\\node.exe", "C:\\nvm4w\\nodejs\\node.exe"]
    : ["/usr/local/bin/node", "/usr/bin/node"];

  for (const candidate of commonPaths) {
    try {
      if (existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Continue probing so resolution always reaches a safe fallback.
    }
  }

  return isWin32 ? "C:\\Program Files\\nodejs\\node.exe" : "node";
}

/** Returns the absolute filesystem path to the bundled hook script. */
function getHookScriptFilePath(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "hooks", HOOK_MARKER);
}

/**
 * Get the path to our hook script, using Unix-style paths for git bash compatibility.
 * Claude Code on Windows uses git bash paths like /c/Users/...
 *
 * Exported so tests can build platform-correct fixtures without hardcoding
 * OS-specific command strings.
 */
export function getHookScriptPath(context: vscode.ExtensionContext): string {
  const hookPath = getHookScriptFilePath(context);

  if (process.platform === "win32") {
    const toGitBashPath = (windowsPath: string): string => {
      // Convert Windows path to git bash style: C:\Users\... → /c/Users/...
      const drive = windowsPath[0].toLowerCase();
      const rest = windowsPath.slice(2).replace(/\\/g, "/");
      return `/${drive}${rest}`;
    };

    const nodePath = toGitBashPath(resolveNodeBinary());
    const nodeSegment = nodePath.includes(" ") ? `"${nodePath}"` : nodePath;
    const hookScriptPath = toGitBashPath(hookPath);
    const hookScriptSegment = hookScriptPath.includes(" ")
      ? `"${hookScriptPath}"`
      : hookScriptPath;
    return `${nodeSegment} ${hookScriptSegment}`;
  }

  return `node ${hookPath}`;
}

/**
 * Read and parse ~/.claude/settings.json.
 */
function readSettings(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Write settings back to ~/.claude/settings.json.
 */
function writeSettings(settings: Record<string, unknown>): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
}

/**
 * Check if our hooks are already installed by looking for session-state.js in hook commands.
 */
function hooksInstalled(settings: Record<string, unknown>): boolean {
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) {
    return false;
  }

  const json = JSON.stringify(hooks);
  return json.includes(HOOK_MARKER);
}

/** Find the first recorded hook script path and convert it to a native path. */
function getRecordedHookScriptPath(
  settings: Record<string, unknown>
): string | undefined {
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) {
    return undefined;
  }

  for (const entries of Object.values(hooks)) {
    for (const entry of entries as Array<Record<string, unknown>>) {
      const innerHooks = entry.hooks as Array<Record<string, unknown>> | undefined;
      if (!innerHooks) {
        continue;
      }
      for (const hook of innerHooks) {
        const command = hook.command as string | undefined;
        if (!command?.includes(HOOK_MARKER)) {
          continue;
        }

        const tokenPattern = /"([^"]*)"|(\S+)/g;
        for (const match of command.matchAll(tokenPattern)) {
          const token = match[1] ?? match[2];
          if (!token.includes(HOOK_MARKER)) {
            continue;
          }
          if (process.platform !== "win32") {
            return token;
          }

          const gitBashPath = token.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
          if (!gitBashPath) {
            return token;
          }
          const rest = gitBashPath[2]?.replace(/\//g, "\\") ?? "";
          return `${gitBashPath[1].toUpperCase()}:\\${rest}`;
        }
      }
    }
  }

  return undefined;
}

/** Returns whether an installed hook records a script path that no longer exists. */
function recordedHookScriptIsMissing(settings: Record<string, unknown>): boolean {
  const recordedPath = getRecordedHookScriptPath(settings);
  return recordedPath === undefined ? false : !fs.existsSync(recordedPath);
}

/** Acquire the narrow settings-reconciliation lock, stealing it if stale. */
function acquireReconcileLock(): boolean {
  const lockContents = (): string =>
    JSON.stringify({ pid: process.pid, timestamp: Date.now() });

  try {
    fs.writeFileSync(LOCK_PATH, lockContents(), { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw err;
    }
  }

  try {
    const existing = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")) as {
      pid?: unknown;
      timestamp?: unknown;
    };
    if (
      typeof existing.timestamp === "number" &&
      Date.now() - existing.timestamp > STALE_LOCK_THRESHOLD_MS
    ) {
      try {
        fs.unlinkSync(LOCK_PATH);
      } catch {
        // Another process removed it first; the create below decides the winner.
      }
      try {
        fs.writeFileSync(LOCK_PATH, lockContents(), { flag: "wx" });
        return true;
      } catch {
        // Another process won the steal; treat this cycle as contended.
      }
    }
  } catch {
    // An unreadable lock is treated as live contention for this cycle.
  }

  try {
    debugLog("Hook path reconciliation skipped due to lock contention.");
  } catch {
    // Diagnostics must not turn expected lock contention into a failure.
  }
  return false;
}

/** Releases the reconciliation lock on a best-effort basis. */
function releaseReconcileLock(): void {
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {
    // Best effort: stale-lock recovery handles abandoned lock files.
  }
}

/**
 * Return true only when every hook entry containing the session-state.js marker
 * has a command string that starts with expectedScriptBase.
 *
 * If no hooks containing the marker exist, there is nothing stale — returns true.
 */
export function hooksUpToDate(
  settings: Record<string, unknown>,
  expectedScriptBase: string
): boolean {
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) {
    return true;
  }

  for (const entries of Object.values(hooks)) {
    for (const entry of entries as Array<Record<string, unknown>>) {
      const innerHooks = entry.hooks as Array<Record<string, unknown>> | undefined;
      if (!innerHooks) {
        continue;
      }
      for (const h of innerHooks) {
        const cmd = h.command as string | undefined;
        if (cmd && cmd.includes(HOOK_MARKER)) {
          if (!cmd.startsWith(expectedScriptBase)) {
            return false;
          }
        }
      }
    }
  }

  return true;
}

/**
 * Identify the "logical hook" a Conductor-owned entry represents, independent
 * of which absolute script path its command currently embeds.
 *
 * Two entries are the same logical hook when they share a matcher and an
 * action argument (idle / active / stop) — the action is always the last
 * whitespace-delimited token of the command, appended by installHooks()'s
 * `${scriptBase} ${action}` shape. The command's path prefix is deliberately
 * excluded from the signature: comparing full command strings is exactly why
 * duplicate entries were never recognized as duplicates before this fix — an
 * extension-installed path and a dev-repo-installed path are different
 * strings but the same logical hook once the marker + matcher + action all
 * match.
 *
 * Returns undefined for entries that are not (wholly) Conductor-owned. An
 * entry's `hooks` array can hold more than one command — e.g. a settings.json
 * hand-edited so a Conductor command and an unrelated tool's command share
 * one entry. Only entries where EVERY inner hook references HOOK_MARKER are
 * eligible for dedup; a mixed entry still gets its path rewritten by the
 * caller's separate rewrite loop, but must never be a candidate for removal
 * — removing it would silently delete the other tool's command too.
 */
function hookEntrySignature(entry: Record<string, unknown>): string | undefined {
  const innerHooks = entry.hooks as Array<Record<string, unknown>> | undefined;
  if (!innerHooks || innerHooks.length === 0) {
    return undefined;
  }

  const commands = innerHooks.map((h) =>
    typeof h.command === "string" ? h.command : ""
  );
  if (!commands.every((cmd) => cmd.includes(HOOK_MARKER))) {
    return undefined;
  }

  const cmd = commands[0];
  const lastSpace = cmd.lastIndexOf(" ");
  const action = lastSpace !== -1 ? cmd.slice(lastSpace + 1) : "";
  const matcher = typeof entry.matcher === "string" ? entry.matcher : "";
  return `${matcher}::${action}`;
}

/**
 * Returns true when any hook event has more than one Conductor-owned entry
 * for the same logical hook (same matcher + action — see hookEntrySignature),
 * regardless of whether their command paths currently match each other.
 *
 * This is deliberately independent of hooksUpToDate(): duplicate entries can
 * exist even when every one of them already points at the same, current
 * expectedScriptBase (e.g. after a prior reconcile ran before this fix landed
 * and rewrote both duplicates' paths without collapsing them) — a check
 * scoped to path staleness alone would never notice.
 */
export function hooksHaveDuplicateEntries(settings: Record<string, unknown>): boolean {
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) {
    return false;
  }

  for (const entries of Object.values(hooks)) {
    const seen = new Set<string>();
    for (const entry of entries as Array<Record<string, unknown>>) {
      const signature = hookEntrySignature(entry);
      if (signature === undefined) {
        continue;
      }
      if (seen.has(signature)) {
        return true;
      }
      seen.add(signature);
    }
  }

  return false;
}

/**
 * Rewrite every hook command that contains the session-state.js marker so
 * its leading path portion is replaced with expectedScriptBase, preserving
 * the trailing action argument (idle / active / stop) — then collapse any
 * remaining duplicate Conductor-owned entries (same matcher + action, see
 * hookEntrySignature) down to a single entry per event, keeping the first
 * occurrence and dropping the rest.
 *
 * Both Windows git-bash form (`/c/PROGRA~1/nodejs/node.exe /c/Users/...`) and
 * POSIX form (`node /path/to/...`) round-trip correctly because we split on
 * the last space before the action arg to isolate the action, then reconstruct.
 *
 * Entries that don't contain the marker (other tools' hooks) are never
 * touched or counted — dedup only ever removes Conductor-owned entries.
 */
export function reconcileHookPaths(
  settings: Record<string, unknown>,
  expectedScriptBase: string
): void {
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) {
    return;
  }

  for (const eventType of Object.keys(hooks)) {
    const entries = hooks[eventType] as Array<Record<string, unknown>>;

    for (const entry of entries) {
      const innerHooks = entry.hooks as Array<Record<string, unknown>> | undefined;
      if (!innerHooks) {
        continue;
      }
      for (const h of innerHooks) {
        const cmd = h.command as string | undefined;
        if (cmd && cmd.includes(HOOK_MARKER)) {
          // The command is "<scriptBase> <action>" — extract the action from
          // the last whitespace-delimited token.
          const lastSpace = cmd.lastIndexOf(" ");
          const action = lastSpace !== -1 ? cmd.slice(lastSpace + 1) : "";
          h.command = `${expectedScriptBase} ${action}`;
        }
      }
    }

    // Now that every Conductor-owned command in this event has been rewritten
    // to the same expectedScriptBase, any remaining entries that still share
    // a signature are true duplicates — collapse to the first occurrence.
    const seen = new Set<string>();
    hooks[eventType] = entries.filter((entry) => {
      const signature = hookEntrySignature(entry);
      if (signature === undefined) {
        return true; // not ours; never removed by dedup
      }
      if (seen.has(signature)) {
        return false;
      }
      seen.add(signature);
      return true;
    });
  }
}

/**
 * Install our hooks into the existing settings, preserving all existing hooks.
 */
function installHooks(settings: Record<string, unknown>, scriptBase: string): void {
  const hooks = (settings.hooks || {}) as Record<string, unknown[]>;

  // Helper to append a hook entry to an event type's array
  const appendHook = (
    eventType: string,
    matcher: string | undefined,
    action: string
  ): void => {
    if (!hooks[eventType]) {
      hooks[eventType] = [];
    }
    const entry: Record<string, unknown> = {
      hooks: [
        {
          type: "command",
          command: `${scriptBase} ${action}`,
        },
      ],
    };
    if (matcher) {
      entry.matcher = matcher;
    }
    (hooks[eventType] as unknown[]).push(entry);
  };

  appendHook("Notification", "idle_prompt", "idle");
  appendHook("UserPromptSubmit", undefined, "active");
  appendHook("Stop", undefined, "stop");

  settings.hooks = hooks;
}

/**
 * Remove our hooks from settings, identified by session-state.js in the command string.
 */
function removeHooks(settings: Record<string, unknown>): void {
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) {
    return;
  }

  for (const eventType of Object.keys(hooks)) {
    const entries = hooks[eventType] as Array<Record<string, unknown>>;
    hooks[eventType] = entries.filter((entry) => {
      const entryJson = JSON.stringify(entry);
      return !entryJson.includes(HOOK_MARKER);
    });
    // Clean up empty arrays
    if ((hooks[eventType] as unknown[]).length === 0) {
      delete hooks[eventType];
    }
  }

  // Clean up empty hooks object
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }
}

/**
 * Clean up stale state files.
 */
function cleanupStateDir(): void {
  try {
    if (fs.existsSync(STATE_DIR)) {
      const files = fs.readdirSync(STATE_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(STATE_DIR, file));
      }
      fs.rmdirSync(STATE_DIR);
    }
  } catch {
    // Best effort cleanup
  }
}

/**
 * Check and prompt for hook installation on activation.
 * Returns true if hooks are installed (or were just installed).
 */
async function doEnsureHooksInstalled(
  context: vscode.ExtensionContext
): Promise<boolean> {
  const settings = readSettings();

  if (hooksInstalled(settings)) {
    const scriptBase = getHookScriptPath(context);
    const needsReconcile =
      !hooksUpToDate(settings, scriptBase) ||
      recordedHookScriptIsMissing(settings) ||
      hooksHaveDuplicateEntries(settings);
    if (needsReconcile) {
      // Paths are stale (extension updated to a new directory). Silently
      // reconcile — consent was already granted at initial install.
      const hostHookPath = getHookScriptFilePath(context);
      if (!fs.existsSync(hostHookPath)) {
        try {
          log(
            `Running extension host hook script is missing at ${hostHookPath}; skipping reconciliation.`
          );
        } catch {
          // The reload prompt remains actionable if the output channel is unavailable.
        }
        if (!notifiedReloadSignatures.has(hostHookPath)) {
          notifiedReloadSignatures.add(hostHookPath);
          void vscode.window.showInformationMessage(
            "Reload the window to finish updating Claude session hooks."
          );
        }
        return true;
      }

      if (!acquireReconcileLock()) {
        return true;
      }

      try {
        const freshSettings = readSettings();
        reconcileHookPaths(freshSettings, scriptBase);
        writeSettings(freshSettings);
        void vscode.window.showInformationMessage(
          "Claude session hook paths updated for new extension version."
        );
      } finally {
        releaseReconcileLock();
      }
    }
    return true;
  }

  // Check if user previously declined
  if (context.globalState.get<boolean>(SETUP_DECLINED_KEY)) {
    return false;
  }

  const choice = await vscode.window.showInformationMessage(
    "Claude Session Manager can notify you when a session needs attention. " +
      "This requires adding hooks to your Claude Code settings.",
    "Allow",
    "Not Now",
    "Don't Ask Again"
  );

  if (choice === "Allow") {
    try {
      const freshSettings = readSettings();
      const scriptBase = getHookScriptPath(context);
      installHooks(freshSettings, scriptBase);
      writeSettings(freshSettings);
      vscode.window.showInformationMessage("Claude session hooks installed.");
      return true;
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to install hooks: ${err instanceof Error ? err.message : err}`
      );
      return false;
    }
  }

  if (choice === "Don't Ask Again") {
    await context.globalState.update(SETUP_DECLINED_KEY, true);
  }

  return false;
}

/**
 * Ensures hooks are installed and current, coalescing concurrent callers onto
 * the same module-level in-flight reconciliation run.
 */
export function ensureHooksInstalled(
  context: vscode.ExtensionContext
): Promise<boolean> {
  if (inFlight) {
    return inFlight;
  }

  const promise = doEnsureHooksInstalled(context).finally(() => {
    inFlight = undefined;
  });
  inFlight = promise;
  return promise;
}

/**
 * Manual setup command — always installs regardless of previous decline.
 */
export async function setupHooksCommand(
  context: vscode.ExtensionContext
): Promise<void> {
  const settings = readSettings();

  if (hooksInstalled(settings)) {
    vscode.window.showInformationMessage("Hooks are already installed.");
    return;
  }

  try {
    const scriptBase = getHookScriptPath(context);
    installHooks(settings, scriptBase);
    writeSettings(settings);
    await context.globalState.update(SETUP_DECLINED_KEY, undefined);
    vscode.window.showInformationMessage("Claude session hooks installed.");
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to install hooks: ${err instanceof Error ? err.message : err}`
    );
  }
}

/**
 * Remove our hooks and clean up state files. Called on deactivate().
 */
export function uninstallHooks(): void {
  try {
    const settings = readSettings();
    if (hooksInstalled(settings)) {
      removeHooks(settings);
      writeSettings(settings);
    }
  } catch {
    // Best effort on deactivate
  }

  cleanupStateDir();
}
