---
title: Claude Conductor — foundational project spec (problem statement + feature list)
touches:
  - docs/superpowers/specs/2026-07-29-foundational-project-spec.md
  - README.md
  - package.json
  - src/hookInstaller.ts
  - src/stateWatcher.ts
skills_relevant:
  - hook-authoring
  - simplicity-first
---

# Claude Conductor — Foundational Project Spec

**Tracking issue:** [#82 "Author foundational project spec (problem statement + feature list) for Spec-Driven Development"](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/82) — verified **open**, label `documentation`, no milestone; body fetched 2026-07-29.

**Status:** DRAFT — awaiting user review.

## Scope of this document

This is the **seed** of the project spec, not the whole spec. Issue #82 scopes it to exactly two content sections — the problem statement (§1) and the feature list / desired functionality (§2) — and explicitly places out of scope *"Requirements/acceptance-criteria-level spec detail for individual features (follow-on work per feature, not this issue)"* and *"Implementation of any feature listed"* (#82 body, fetched 2026-07-29).

Accordingly, §2 inventories **what exists and what is wanted**. It deliberately does not state acceptance criteria, testable requirements, or designs. Each feature is a future spec's subject, not this one's.

Two housekeeping subsections are folded into §2 rather than raised as new top-level sections: §2.6 (documentation discrepancies, required by #82 acceptance criterion 4) and §2.7 (roadmap). §3 lists open questions per this project's planning convention.

**Citation convention.** Every claim below cites a verifiable source per `CLAUDE.md § Cite Sources in Planning Artifacts`. Repo claims cite `path:Lx-Ly` and were read at the cited lines on 2026-07-29 at commit `baacee0`. GitHub state was fetched 2026-07-29. Anything not verified is prefixed `unverified:`.

---

## 1. Problem Statement

### 1.1 The pain

Running Claude Code against several projects at the same time is unmanageable in a plain terminal. The extension's own framing is that this *"is painful in a plain terminal"* and that the goal is to *"work across multiple codebases without losing track of which session needs your attention"* (`README.md:L13`).

Decomposing that into the specific failures a plain terminal produces:

1. **No durable per-session identity.** Terminal tabs in the bottom panel are small, similarly-labelled, and ordered by creation. With five Claude sessions open against five repos, identifying "the one working on the API repo" is a scanning problem that recurs every few minutes.
2. **Attention is invisible.** Claude Code alternates between working (nothing needed from you) and waiting for input. In a plain terminal, the only way to learn a session is waiting is to look at it. With N sessions, the user polls N terminals — the cost of which scales with exactly the thing the tool is supposed to make cheap, namely running more sessions at once.
3. **Launching is high-friction.** Starting a session against another project means opening a terminal, navigating to the right directory, and typing the command — repeated per project, and repeated again after every window reload.
4. **Sessions are second-class relative to code.** A terminal in the panel cannot be tiled beside a file, pinned, or arranged in a split the way an editor tab can, so the session and the code it is editing cannot be viewed together in the layouts VS Code already supports for files.

### 1.2 Who experiences it

The user is a **developer running two or more concurrent Claude Code CLI sessions across different project folders inside a single VS Code window**. This is inferable from the product's own positioning — *"Orchestrate multiple Claude Code sessions across different projects as editor tabs in a single VS Code window"* (`README.md:L3`, matching `package.json:L4`).

Two structural details sharpen the audience:

- **Git worktree users are a first-class case, not an edge case.** The extension carries a dedicated pure module for worktree-aware grouping that buckets `.worktrees/<branch>` children under a synthesised project root (`docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md:L67`, citing `src/projectGrouping.ts:89-135`), and the sidebar surfaces this to the user directly (`README.md:L24`).
- **The prerequisite is the CLI, not the official extension.** Getting started requires only that *"the `claude` CLI is on your PATH"* (`README.md:L65`), and `package.json` declares no extension dependency on Anthropic's own VS Code extension (`package.json:L1-222` contains no `extensionDependencies` key).

### 1.3 Why a plain terminal is not enough — the design commitment

The project's answer is to **promote each Claude session from a panel terminal to a first-class editor tab**, so sessions inherit the window-management affordances VS Code already gives code files: *"you can tile them, pin them, and glance at multiple sessions at once like you would with code files"* (`README.md:L32`).

This was a deliberate v1 design decision, not an accident of implementation. The v1 design spec records it as *"Promote terminals to editor tabs... This gives each session visual parity with code files and supports the tab-per-project mental model"* (`docs/superpowers/specs/2026-04-14-session-manager-v1-design.md:L16`), implemented via `workbench.action.terminal.moveToEditor` (`src/sessionManager.ts:L108`).

The same spec records **why launching must go through a terminal at all**, which is the constraint that gives this project a reason to exist separate from Anthropic's own extension: *"The Claude Code VS Code extension commands (`claude-vscode.editor.open` etc.) don't accept a folder argument — they always scope to the current workspace. Terminal with `cwd` is the only way to target a different folder without switching workspaces"* (`docs/superpowers/specs/2026-04-14-session-manager-v1-design.md:L15`).

That single sentence is the project's foundation. **The official tooling is single-workspace-scoped; the problem is inherently multi-project.** Conductor exists to close that gap.

### 1.4 The attention problem, stated separately

Problem 2 above is the one the extension solves with machinery rather than layout, so it warrants its own statement.

A user running N sessions needs a **push** signal that a specific session is waiting, not a **poll** loop across N terminals. Conductor obtains this from Claude Code's own hook system: it installs three hooks into `~/.claude/settings.json` — `Notification` with matcher `idle_prompt`, `UserPromptSubmit`, and `Stop` (`src/hookInstaller.ts:L165-167`) — which write state files that the extension watches to drive a sidebar bell icon and a notification with a "Focus" button (`README.md:L36-43`).

Two properties of this approach are load-bearing and belong in the problem statement because they constrain every future feature:

- **It is local-only.** *"Only your VS Code extension reads these files — no data leaves your machine"* (`README.md:L107`).
- **It requires mutating a file the extension does not own.** The hooks live in the user's global `~/.claude/settings.json` (`src/hookInstaller.ts:L6`), so installation is gated behind an explicit consent prompt offering "Allow" / "Not Now" / "Don't Ask Again" (`src/hookInstaller.ts:L244-250`). Consent is a permanent requirement of this design, not a first-run nicety.

### 1.5 Acknowledged boundaries of the problem being solved

The problem statement is bounded. These are stated limitations of the current product, not unsolved bugs:

- **Single-window scope.** *"Session tracking only works within a single VS Code window (sessions in other windows aren't visible in the sidebar)"* (`README.md:L120`); the v1 spec placed "Multi-window session tracking" out of scope from the start (`docs/superpowers/specs/2026-04-14-session-manager-v1-design.md:L171`).
- **Idle threshold is not tunable.** The notification fires on *"Claude Code's built-in ~60-second idle threshold — not tunable from the extension"* (`README.md:L121`).
- **No tab-level attention indicator.** *"VS Code terminal tabs cannot change color or flash after creation"*, so attention is signalled via sidebar icons and notifications instead (`README.md:L122`).
- **No programmatic interaction with sessions.** Sending prompts, or reading conversation history, was placed out of scope in v1 (`docs/superpowers/specs/2026-04-14-session-manager-v1-design.md:L168-169`). Conductor orchestrates sessions; it does not talk to them.

---

## 2. Feature List / Desired Functionality

Inventory only. No acceptance criteria — see § Scope of this document.

### 2.1 Commands (10)

All ten are declared at `package.json:L39-84` and registered at `src/extension.ts:L128-202`.

| Command ID | Title | Behaviour | Source |
|---|---|---|---|
| `claudeConductor.openSession` | Launch Session | With a `folderPath` string argument, launches directly; with no argument, opens the quick-pick | `src/extension.ts:L129-135` |
| `claudeConductor.addFolder` | Add Folder | Prompts for a folder path to add to `extraFolders` | `src/extension.ts:L137-139` |
| `claudeConductor.nextSession` | Next Session | Cycles focus forward through active sessions, wrapping at the end | `src/extension.ts:L195-197`, `L209-230` |
| `claudeConductor.prevSession` | Previous Session | Cycles focus backward, wrapping | `src/extension.ts:L199-201`, `L209-230` |
| `claudeConductor.focusSession` | Focus Session | Focuses a session's editor tab | `src/extension.ts:L141-146` |
| `claudeConductor.closeSession` | Close Session | Disposes the session's terminal | `src/extension.ts:L148-153` |
| `claudeConductor.openInNewWindow` | Open in New Window | Opens a dedicated window via a self-referential `vscode://` URI; if the folder is already the current workspace, shows a toast and focuses the existing session instead | `src/extension.ts:L155-179` |
| `claudeConductor.setupHooks` | Setup Notification Hooks | Force-installs hooks, clearing any prior "Don't Ask Again" | `src/extension.ts:L181-183`, `src/hookInstaller.ts:L278-299` |
| `claudeConductor.removeHooks` | Remove Notification Hooks | Removes hooks and cleans the state directory | `src/extension.ts:L185-188`, `src/hookInstaller.ts:L304-316` |
| `claudeConductor.refreshTreeView` | Refresh | Refreshes both tree providers | `src/extension.ts:L190-193` |

Cycling behaviour detail: when no Claude session currently holds focus, cycling jumps to the first session rather than doing nothing (`src/extension.ts:L223-227`).

### 2.2 Settings (6)

All six declared at `package.json:L148-185`.

| Setting | Type / default | Purpose | Source |
|---|---|---|---|
| `claudeConductor.claudeCommand` | string, `"claude"` | The CLI command dispatched into the terminal | `package.json:L151-155` |
| `claudeConductor.reuseExistingTerminal` | boolean, `true` | Focus an existing session instead of opening a duplicate | `package.json:L156-160`, honoured at `src/sessionManager.ts:L88-94` |
| `claudeConductor.enableNotifications` | boolean, `true` | Show notifications when a session is waiting | `package.json:L161-165` |
| `claudeConductor.extraFolders` | string[], `[]` | Extra folder paths for the launcher; `~` is expanded | `package.json:L166-173`; expansion per `docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md:L199` citing `src/config.ts:22-26` |
| `claudeConductor.launchDelayMs` | number, `500`, min `0` | Delay before `sendText` when shell integration is unavailable | `package.json:L174-179`, consumed at `src/sessionManager.ts:L162-165` |
| `claudeConductor.debugLogging` | boolean, `false` | Verbose session-lifecycle diagnostics to the output channel | `package.json:L180-184` |

### 2.3 UI surfaces

**Activity-bar container** — id `claudeConductor`, sparkle icon (`package.json:L86-94`), hosting two tree views (`package.json:L95-106`).

- **Active Sessions view** (`claudeConductor.activeSessions`) — running sessions grouped two-level by project root; green terminal icon means working, orange bell means waiting for input; click a leaf to focus (`README.md:L21`). Inline row actions: focus, open-in-new-window, close, all gated on `viewItem == activeSession` (`package.json:L126-140`).
- **Recent Projects view** (`claudeConductor.recentProjects`) — VS Code recents plus `extraFolders`, same grouping; click a folder leaf to launch (`README.md:L22`). Project roots collapse by default with a child count; a worktree whose parent root is absent from recents renders dimmed with a "(not in recents)" label (`README.md:L24`). View-title actions: launch, add-folder, refresh (`package.json:L108-124`).

**Status bar** — left-aligned item reading `$(sparkle) N session` / `N sessions` (singular-aware), hidden when the count is zero, bound to `claudeConductor.openSession` with tooltip "Claude Conductor — click to launch or switch"; updates reactively on `onDidChangeSessions` (`src/statusBar.ts:L9-30`; registered at `src/extension.ts:L120`).

**Quick-pick launcher** — `Ctrl+Shift+Alt+C` (`README.md:L28`). Active sessions are listed first with a `$(terminal)` label and "Active session" detail (`src/quickPick.ts:L23-31`), then folders labelled `recent` or `configured`, excluding any folder that already has an active session (`src/quickPick.ts:L33-45`). Selecting an active session focuses it; selecting a folder launches there (`src/quickPick.ts:L74-81`). When no items exist at all, a warning offers "Add Folder" and "Open Settings" instead (`src/quickPick.ts:L47-62`).

**Idle-session picker** — a second, distinct quick-pick shown from the consolidated multi-session idle toast to choose which waiting session to focus (`README.md:L41`).

**Add-folder input box** — accepts an absolute path with `~` supported, and validates on each keystroke: rejects empty input, rejects a path that is not a directory, and rejects one that does not exist (`src/quickPick.ts:L84-103`). Duplicates are detected case-insensitively and rejected with a toast (`src/quickPick.ts:L113-116`); accepted paths are appended to `extraFolders` at `ConfigurationTarget.Global` (`src/quickPick.ts:L118`).

**Terminal link provider** — makes file paths in Claude's terminal output clickable, opening them in the editor (`README.md:L53`; registered at `src/extension.ts:L123-125`).

**URI handler / deep link** — `vscode://cbeaulieu-gt.claude-conductor/launch?folder=<encoded-path>` (`src/extension.ts:L41`, `L155-179`). If the target folder is not the current workspace, the handler stores an auto-launch flag in `globalState` and opens the folder in a new window; the flag is consumed on next activation to launch the session (`src/extension.ts:L46`, `L54-79`, `L93-98`). Activation includes `onUri` for this path (`package.json:L33-36`).

**Notification toasts** — hook-install consent with Allow / Not Now / Don't Ask Again (`src/hookInstaller.ts:L244-250`); hook-path migration info toast (`src/hookInstaller.ts:L232-234`); single and consolidated idle toasts (`README.md:L36-41`); "already in this project's window" (`src/extension.ts:L167-169`); "No active Claude sessions" on cycling with none open (`src/extension.ts:L211-213`).

**Output channel** — named "Claude Conductor", carrying `log` and `debugLog` lines; `debugLogging` emits structured `key=value` lines for every terminal open, terminal close (including which fallback tier matched), reconcile tick, and PID index write/delete (`README.md:L79-85`).

### 2.4 Keybindings (3)

`Ctrl+Shift+Alt+C` → `openSession`; `Ctrl+Alt+]` → `nextSession`; `Ctrl+Alt+[` → `prevSession`; each with a `cmd`-prefixed Mac variant (`package.json:L187-203`).

### 2.5 Core architecture

Thirteen TypeScript modules under `src/` plus one standalone hook script.

| Module | Role |
|---|---|
| `extension.ts` | Activation, wiring, command registration, URI handler (`src/extension.ts:L82-203`) |
| `sessionManager.ts` | Terminal registry and session lifecycle — see below |
| `hookInstaller.ts` | Install / detect / reconcile / remove Claude Code hooks — see below |
| `stateWatcher.ts` | Watches `~/.claude/session-state/*.json`, drives idle notifications, and calls `reconcile()` each poll tick (`src/sessionManager.ts:L203-210`) |
| `folderSource.ts` | Merges VS Code recents with `extraFolders` into a flat `FolderEntry[]` (`docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md:L66` citing `src/folderSource.ts:52-92`) |
| `projectGrouping.ts` | Pure, display-time-only worktree-aware grouping; persists nothing (`docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md:L67` citing `src/projectGrouping.ts:89-135`) |
| `workspaceMatch.ts` | Pure case-insensitive path equality against the current workspace folder (`docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md:L68` citing `src/workspaceMatch.ts:16-24`) |
| `terminalLinks.ts` | Terminal link provider |
| `treeView.ts` | `ActiveSessionsProvider` and `RecentProjectsProvider` (`src/extension.ts:L111-117`) |
| `statusBar.ts` | Status-bar item (`src/extension.ts:L120`) |
| `quickPick.ts` | Quick-pick launcher and add-folder prompt (`src/extension.ts:L3`) |
| `config.ts` | One getter per setting (`src/sessionManager.ts:L5`) |
| `output.ts` | Output channel, `log` / `debugLog` (`src/output.ts:L11`) |
| `hooks/session-state.js` | Standalone Node script the Claude Code hooks actually invoke (`src/hookInstaller.ts:L8`, `L19`) |

**Session identity and launch.** Sessions are named `claude · <folder>` (`src/sessionManager.ts:L9`), and a terminal is recognised as a Claude session purely by that name prefix (`src/sessionManager.ts:L235-237`). Launch refuses a `cwd` that no longer exists on disk (`src/sessionManager.ts:L83-86`), creates the terminal, shows it, moves it to the editor area, then dispatches the command (`src/sessionManager.ts:L97-111`).

**Three-tier command dispatch** (`src/sessionManager.ts:L114-166`): (1) fast path when shell integration is already active (`L126-130`); (2) slow path waiting up to 2000 ms for shell integration to activate (`L132-155`); (3) delay fallback sleeping `launchDelayMs` then `sendText` (`L161-165`).

**Three-tier close detection** (`src/sessionManager.ts:L289-339`): (1) identity match; (2) name match, skipped when the name is empty; (3) PID match via a secondary `processId → terminal` index (`src/sessionManager.ts:L32-39`). Independently corroborated by `README.md:L83` ("including which of the three fallback tiers matched").

**Poll-reconcile self-heal** (`src/sessionManager.ts:L202-232`): each `StateWatcher` tick, any tracked session whose terminal is absent from `vscode.window.terminals` is evicted and its state file deleted, covering missed `onDidCloseTerminal` events. State-file cleanup is a best-effort fallback for when the `Stop` hook did not run (`src/sessionManager.ts:L370-376`).

**Hook installation** is additive and preserves existing user hooks (`src/hookInstaller.ts:L139-170`), and uses a **single hardcoded marker** `"session-state.js"` (`src/hookInstaller.ts:L8`) for detection (`L53-61`), staleness checks (`L69-96`), path reconciliation (`L107-134`), and removal (`L175-197`). Stale paths after an extension update are silently reconciled because consent was already granted (`src/hookInstaller.ts:L227-235`). The single-marker design is a known constraint on adding any second hook script — see §2.7.

### 2.6 Known documentation discrepancies

Required by #82 acceptance criterion 4. Each is verified, not asserted. These are documentation defects; correcting them is follow-on work, not part of this spec.

| # | Discrepancy | Evidence |
|---|---|---|
| D-1 | **VS Code version floor disagrees.** README states the requirement as *"VS Code 1.85 or newer"* (`README.md:L115`), but the manifest declares `"vscode": "^1.93.0"` (`package.json:L9`) and `@types/vscode` is pinned `^1.93.0` (`package.json:L217`). The manifest is what VS Code enforces, so the README understates the true floor. |
| D-2 | **`launchDelayMs` is undocumented.** The setting exists (`package.json:L174-179`) but the README configuration table lists only the other five settings (`README.md:L71-77`). |
| D-3 | **Two independent output channels share one name.** `vscode.window.createOutputChannel("Claude Conductor")` is called at two separate sites — `src/stateWatcher.ts:L22` and `src/output.ts:L11` — so `stateWatcher` does not reuse the shared channel from `output.ts`. Two distinct channel instances carry the same display name. *unverified:* which user-visible symptom this produces (a duplicated entry in the Output dropdown versus one instance shadowing the other) — not tested. |
| D-4 | **Stale docstring on `uninstallHooks`.** Its comment reads *"Called on deactivate()"* (`src/hookInstaller.ts:L302-303`), but `deactivate()` deliberately does not call it and says so: *"Hooks are intentionally left in `~/.claude/settings.json` on deactivate. VS Code calls `deactivate()` on every window close, not just uninstall"* (`src/extension.ts:L232-236`). The only caller is the `removeHooks` command (`src/extension.ts:L185-188`). The behaviour is correct; the docstring is wrong. |

D-4 was found while verifying this inventory and is not among the two discrepancies #82 anticipated. D-3 likewise goes beyond #82's list. Both are offered for the user to accept or reject as in-scope for the correction follow-up.

**Why this spec's `touches:` names source files.** Correcting these discrepancies edits code and docs, not just this document: D-1 and D-2 touch `README.md` (and D-1 potentially `package.json:L9`, pending open question 3); D-3 touches `src/stateWatcher.ts:L22`; D-4 touches the stale docstring at `src/hookInstaller.ts:L302-303`. The frontmatter declares the files a follow-up would edit **if** the user accepts all four. Should the user reject D-3 and D-4 (open question 2), `src/hookInstaller.ts` and `src/stateWatcher.ts` drop out of scope.

### 2.7 Desired functionality — in-flight and candidate work

**Not shipped.** Everything below is an open issue or an unmerged PR as of 2026-07-29. Listed as desired functionality per #82 acceptance criterion 3; none is current behaviour.

#### 2.7.1 Session-tracking architecture rework — #68 / #33 / #44

The current model identifies sessions by a name prefix the extension itself assigned (`src/sessionManager.ts:L9`, `L235-237`) and detects closure through a three-tier fallback plus poll-reconcile (§2.5). The desired end state replaces this with a Conductor-issued stable session ID, a PID-liveness cross-check, and an additional `SessionEnd` hook.

- **[#68](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/68)** (open) — spike into why long-running session tabs fail close-detection when X'd. Phase A diagnostic logging has already landed: `debugLog` calls instrument every close tier, reconcile tick, and PID index write/delete throughout `src/sessionManager.ts:L213-360`, and the `debugLogging` setting that gates them ships in `package.json:L180-184`. Acceptance criteria are logging plus documented findings plus a follow-up issue — explicitly not the fix (`docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md:L229`). *unverified:* the commit commonly cited for this work is `960c33b` ("feat: add debug logging for session close-detection diagnostics (#68 phase A)"); this dispatch had no `git` access to confirm the SHA is reachable from `main`, so the shipped code above — not the SHA — is the evidence.
- **[#33](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/33)** (open, milestone v1.4.0) — adopt externally-launched sessions from the official Claude extension's "Open in Terminal". Proposes an `ActiveSession.source: "owned" | "adopted"` field (`docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md:L230`). Name-prefix matching structurally cannot see terminals Conductor did not create and name.
- **[#44](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/44)** (open) — spike a custom pty / process-wrapper with full lifecycle ownership and in-tab restart (`docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md:L231`). This is the highest-leverage and highest-risk item: a "go" removes the shell from the launch path entirely.

Three externally-sourced leads bear directly on this cluster, each verified in the landscape survey:

- VS Code core has natively detected agent CLIs (Claude Code named explicitly) via OSC title sequences since ~1.117, exposed as `terminal.integrated.tabs.allowAgentCliTitle` — a detection primitive independent of who launched the terminal, which is exactly #33's blocker (`docs/research/2026-07-29-vscode-claude-conductor-landscape-survey.md:L24-L32`). Whether it is reachable from extension API is unresolved (`:L147`).
- Claude Code writes `~/.claude/sessions/<pid>.json` liveness files, giving a `process.kill(pid, 0)` signal independent of `onDidCloseTerminal` — useful for #68, but undocumented and previously the site of a data-loss bug; do not write to that directory (`docs/research/2026-07-29-vscode-claude-conductor-landscape-survey.md:L34-L42`).
- A `SessionEnd` hook event exists and is not currently installed; `Stop` fires per-turn, not per-session-end, so it cannot substitute (`docs/research/2026-07-29-vscode-claude-conductor-landscape-survey.md:L44-L52`). Whether it fires on abrupt SIGTERM from a tab X-close is the survey's single most decision-relevant open question (`:L148`).

#### 2.7.2 Shared workspace-level config injection — #81

A single shared `CLAUDE.md`-equivalent reaching every Conductor-launched session in a workspace, layered on top of each folder's own `CLAUDE.md` (`docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md:L30`).

Currently a **decision document, not an implementation plan**, with seven decision points D1–D7 and a three-probe empirical Phase 0 gate (P1/P2/P3) that must return before any mechanism is recommended as final (`docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md:L20`, `L88-L112`, `L144-L221`). #81's own body scopes implementation out (`:L18`).

Two findings from that document constrain future work regardless of route:

- A POSIX `VAR=value cmd` prefix fails silently on PowerShell, the project's primary shell; the env half must go through `createTerminal({ env })` (`docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md:L58-L62`).
- The single-marker `HOOK_MARKER` design (§2.5) breaks if a second hook script is installed globally — partial installs become undetectable, the second script's paths go stale, and it is orphaned on removal (`docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md:L72-L80`). This couples any hook-based route to the #68 rework, which is also expected to add a `SessionEnd` hook to the same file (`:L239`).

*unverified:* a prior `project-reviewer` pass over this plan is reported to have returned 2 BLOCKING, 3 CONCERN, and 3 NIT findings. No such findings are recorded in the plan file and I had no GitHub-read tooling to confirm them; treat the counts as unconfirmed and re-check before relying on them.

#### 2.7.3 Favorites sidebar section — #75 / PR #77 (unmerged)

A third tree view between Active Sessions and Recent Projects, with star-toggle persistence, missing-folder relocation via a folder picker, and a soft cap of 25 with an over-cap banner. **[PR #77](https://github.com/cbeaulieu-gt/vscode-claude-conductor/pull/77)** is **open and not merged** (verified 2026-07-29), stating `Closes #75`. **[#75](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/75)** remains open.

Two open bugs sit on this same surface and presuppose the Favorites work:

- **[#78](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/78)** (open) — "Add to Favorites does nothing on group row (inline star + right-click)".
- **[#79](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/79)** (open) — "Launch (play) button should be on child leaf, not group row". Root cause is visible in the manifest: `openSession` is bound inline to `viewItem == recentProject` (`package.json:L142-145`), which is the row type the group renders as.

#### 2.7.4 Other open desired functionality

These were not in the original inventory but are open issues verified on 2026-07-29 and belong in a foundational feature list.

- **[#76](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/76)** (open) — "Treat Conductor sessions as ephemeral; suppress VS Code terminal restore". **Ready to move:** the landscape survey resolves its stated acceptance-criterion question, confirming `isTransient: true` is the correct and still-current mechanism with no counter-evidence, and explicitly hands off to planning (`docs/research/2026-07-29-vscode-claude-conductor-landscape-survey.md:L128`, `L142`).
- **[#80](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/80)** (open) — rename (alias), delete, and bulk-select for sidebar sessions and folders. Prompted by competitor research: the closest actively-maintained competitor ships rename/delete/bulk-selection UX that Conductor lacks (`docs/research/2026-07-29-vscode-claude-conductor-landscape-survey.md:L59`).
- **[#72](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/72)** (open) — auto-launch a Claude session after Add Folder.
- **[#46](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/46)** (open) — surface active-session count on grouped project rows, and explore a broader structural shift.

---

## 3. Open questions

1. **Is the audience definition in §1.2 right?** It is inferred from README positioning and code structure, never stated by the user. Specifically: is the **git-worktree** user a primary target (which the dedicated grouping module suggests) or an incidental beneficiary? This shapes how future features are prioritised.
2. **Which discrepancies are in scope for correction?** #82 named two (D-1, D-2). Verification surfaced two more (D-3, D-4). Should the follow-up cover all four?
3. **How should D-1 be resolved — in which direction?** Lowering the manifest floor to 1.85 and raising the README to 1.93 are both "fixes," but they are opposite product decisions. The `1.93` floor is what makes the shell-integration fast path available (`src/sessionManager.ts:L126-130`; shell integration is stable since 1.93 per `docs/research/2026-07-29-vscode-claude-conductor-landscape-survey.md:L129`), which argues for correcting the README rather than the manifest. **⚠️ Confirmation needed** — this is a compatibility decision, not a doc typo.
4. **Should the roadmap in §2.7 be ranked?** It is currently grouped by theme, not priority. #82 does not ask for sequencing, but every item there eventually needs an order, and #44's outcome dominates the sequencing of §2.7.1 and §2.7.2 both.
5. **Is PR #77 intended to merge as-is, or be superseded?** It is open and unmerged while #78 and #79 describe defects on the surface it introduces. Whether those are fixed inside #77 or after it changes what §2.7.3 should say.
6. **Does "Spec-Driven Development" here mean a spec per feature, or one living spec?** This document is written as a durable foundation that per-feature specs reference. If the intent is instead a single growing document, §2 should be restructured before follow-on specs are written against it.
7. **Should the unverified `project-reviewer` findings on #81 (§2.7.2) be re-obtained** before the shared-config work resumes?

---

## Verification note

Repo claims were read at the cited lines on 2026-07-29 at commit `baacee0`. GitHub issue and PR state was fetched from public github.com pages on 2026-07-29; this dispatch had no `mcp__github__*` or `Bash` tooling, so state was not confirmed through the GitHub API. Issue #82's acceptance-criteria checkboxes have **not** been ticked and no comment was posted, for the same reason — both require the router or user.
