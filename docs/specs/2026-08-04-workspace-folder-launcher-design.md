---
title: Multi-root workspace folder launcher
touches:
  - src/treeView.ts
  - src/extension.ts
  - package.json
  - test/treeView.test.ts
  - test/packageJsonContextKeys.test.ts
  - test/extension.commandArgs.test.ts
  - README.md
  - CHANGELOG.md
skills_relevant:
  - simplicity-first
---

# Multi-root workspace folder launcher

**Tracking issue:** [#103 "feat: launch session in a specific VS Code multi-root workspace folder"](https://github.com/glitchwerks/vscode-claude-conductor/issues/103) — verified open, body fetched 2026-08-04 (America/New_York — see Verification note for the UTC reconciliation).

**Type:** feature-spec

**Status:** ACCEPTED — scope matches issue #103's acceptance criteria (fetched
2026-08-04): the tree section, the command, active-session indication, and
the four test categories in NFR-12 below are each named there.
unverified: the design was also approved section-by-section in an
interactive brainstorming session; that source is not independently
verifiable from the repo or from GitHub.

## 1. Problem

When VS Code has a multi-root workspace open (a `.code-workspace` file with
several folder roots), Claude Conductor has no way to target a session launch
at a specific root. Three call sites hard-code
`vscode.workspace.workspaceFolders?.[0]` — first root only:

- `src/extension.ts:93` — inside `SessionUriHandler.handleUri`, the
  cross-window URI launch handler (`const currentFolder =
  vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;`).
- `src/extension.ts:222` — inside the `claudeConductor.openInNewWindow`
  command, the same `?.[0]` read used to detect whether the target folder is
  already the current workspace.
- `src/terminalLinks.ts:68` — inside `ClaudeTerminalLinkProvider.handleTerminalLink`,
  used to resolve a relative file path from a terminal link.

This is explicitly distinct from Conductor's own project/folder tracking —
`getAllFolders()` (`src/folderSource.ts:52-92`), consumed by `showQuickPick()`
(`src/quickPick.ts:14-92`) and the Recent Projects / Favorites tree sections
(`src/treeView.ts:214-357`). That system manages an arbitrary, user-curated
list of folders (VS Code's recently-opened list plus a configured
`extraFolders` setting) independent of VS Code's native workspace concept —
confirmed by reading `getAllFolders()`, which sources from
`_workbench.getRecentlyOpened` and `getExtraFolders()`, never from
`vscode.workspace.workspaceFolders`. This spec is specifically about VS
Code's native multi-root `workspaceFolders` array, not that system.

## 2. Requirements

Numbered and testable. FR-n for functional, NFR-n for non-functional.

**FR-1.** A new sidebar tree section "Workspace Folders" exists in
`src/treeView.ts`, structurally a 4th `TreeDataProvider` alongside the three
existing ones: `ActiveSessionsProvider` (`src/treeView.ts:80-126`),
`RecentProjectsProvider` (`src/treeView.ts:214-265`), and `FavoritesProvider`
(`src/treeView.ts:316-357`). It is registered the same way — a `views`
contribution entry (`package.json:112-127` lists the three existing entries)
plus `vscode.window.registerTreeDataProvider` / `createTreeView` in
`src/extension.ts` (mirroring the existing wiring at
`src/extension.ts:145-167`). The three existing sidebar sections and the
current command list are both enumerated in `README.md` (the sections at
`README.md:21-23`, the command list at `README.md:98-106`, the settings
table at `README.md:82-88`) — adding a fourth section and a new
command-palette command (FR-7) means `README.md` needs a corresponding
update, and `CHANGELOG.md` needs a new entry per this repo's release
process: `docs/release-strategy.md:151-155` requires moving `[Unreleased]`
entries into a new versioned `## [X.Y.Z] — YYYY-MM-DD` section on every
release, and `docs/release-strategy.md:172-178` states the publish workflow
uses that matching CHANGELOG entry as the GitHub Release notes. The heading
shape that entry must follow — `## [<version>]` — is read from `CHANGELOG.md`
by the CLI entrypoint at `scripts/extract-changelog.js:93-105`, via the regex
at `scripts/extract-changelog.js:49-64`; `test/extract-changelog.test.ts:5-28`
covers that heading shape, but against a hardcoded fixture string, not the
real `CHANGELOG.md` — it is coverage of the parsing function, not a reader of
the file itself.

**FR-2.** The new section shows exactly one row per entry in the normalized
`folders` value defined in NFR-13 (sourced from
`vscode.workspace.workspaceFolders`) — a new `WorkspaceFolderItem extends
vscode.TreeItem` class, following the same shape as the existing leaf-item
classes in `treeView.ts`: `RecentProjectItem` (`src/treeView.ts:189-210`) and
`FavoriteLeafItem` (`src/treeView.ts:280-312`). Label = folder basename,
description = full path.

**FR-3.** Each row's icon reflects active-session state:
- Default: `folder` `ThemeIcon` (mirrors `RecentProjectItem`/`FavoriteLeafItem`'s
  present-state icon, e.g. `src/treeView.ts:199`, `:304`).
- When `SessionManager.activeSessions` (`src/sessionManager.ts:73-75`)
  contains an `ActiveSession` whose `folderPath` matches the row's folder:
  reuse `ActiveSessionItem`'s exact icon-selection logic
  (`src/treeView.ts:66-68`) — `bell`/`editorWarning.foreground` when that
  session's `isIdle` is true, `terminal`/`testing.iconPassed` otherwise. The
  matched `ActiveSession` object already carries `isIdle`, so this is a direct
  reuse, not a new mapping.

**FR-4.** Each row's `contextValue` is a new leaf-only token added to the
`VIEW_ITEM` const object in `treeView.ts` (`src/treeView.ts:13-20`),
following the precedent set by `RECENT_PROJECT_LEAF` (`"recentProjectLeaf"`,
`src/treeView.ts:17`) — e.g. `WORKSPACE_FOLDER_LEAF: "workspaceFolderLeaf"`.
Wire it into `package.json`'s `view/item/context` menu contribution for the
`claudeConductor.openSession` command's inline launch button, mirroring the
existing per-section clauses at `package.json:162-176` (the `openSession`
inline-launch entries scoped to `favorites`, `recentProjectLeaf`, and
`worktreeChild` respectively).

**FR-5.** Clicking a row invokes the existing `claudeConductor.openSession`
command with the folder path as argument — the same command every other
row-click uses (`RecentProjectItem.command` at `src/treeView.ts:204-208`,
`FavoriteLeafItem.command` at `src/treeView.ts:305-309`). No new command is
needed for row-click. `SessionManager.launchSession()`'s existing
reuse-and-focus guard (`src/sessionManager.ts:111-117`) is reused as-is.

**FR-6.** The "Workspace Folders" view is visible only when
`folders.length > 1` (the normalized value from NFR-13); hidden entirely at 0
or 1 root. Implemented via a VS Code `when`-clause context key (e.g.
`claudeConductor.hasMultiRootWorkspace`) set with
`vscode.commands.executeCommand('setContext', ...)` at extension activation
and on `vscode.workspace.onDidChangeWorkspaceFolders`. No `setContext` call
exists anywhere in `src/` today (verified via `git grep -n "setContext" --
src/`, zero matches, checked 2026-08-04) — this is new plumbing, not reuse of
an existing pattern.

**FR-7.** A new command `claudeConductor.launchInWorkspaceFolder` is
registered (title: "Claude Conductor: Launch Session in Workspace Folder..."),
shown in the command palette. It shows a `vscode.window.showQuickPick`
populated from the normalized `folders` value from NFR-13 (name + path per
item, sourced from `vscode.workspace.workspaceFolders`), then calls
`sessionManager.launchSession(picked.uri.fsPath)` on selection. Structurally
mirrors `showQuickPick()` in `src/quickPick.ts:14-92`, but sources items from
that normalized `folders` value instead of `getAllFolders()`
(`src/folderSource.ts:52-92`). Implemented in
`src/extension.ts` alongside the other command registrations
(`src/extension.ts:178-300`), not in `src/quickPick.ts` — `quickPick.ts` is
read as a structural model, not modified.

**NFR-8.** The new command is registered unconditionally (no `when` gate) —
with ≤1 root the QuickPick just shows 1 item; harmless, and simpler than
gating command registration itself.

**NFR-9.** The 0-workspace-folders empty state in the new command's QuickPick
reuses the existing warning-message pattern in `src/quickPick.ts:51-66`,
minus the "Add Folder" action — that action is specific to Conductor's own
folder list and not relevant to native VS Code workspace folders.

**NFR-10.** A folder removed from the workspace while a session is active for
it: the row disappears on the next `onDidChangeWorkspaceFolders` re-render,
but the running terminal itself is untouched. This matches existing behavior
elsewhere — verified-absent: `git grep -n "onDidChangeWorkspaceFolders" --
src/` returns no matches, and `git grep -n "closeSession(" -- src/` returns
exactly two matches (both checked 2026-08-04): the method definition
(`src/sessionManager.ts:199`) and its sole call site inside the explicit
`claudeConductor.closeSession` command handler (`src/extension.ts:205-210`).
No code path closes or kills a session in response to a folder-list change;
`closeSession` requires an explicit user action to invoke.

**NFR-11.** The missing-folder-on-disk guard in
`SessionManager.launchSession()` (`src/sessionManager.ts:100-109`) is reused
as-is for this feature — no new missing-folder handling needed, since
`launchSession()` already returns `{ ok: false, reason: "missing" }` and
existing callers already know how to surface that. See the existing
`markMissing` + `showErrorMessage` caller in the `claudeConductor.openSession`
command handler (`src/extension.ts:181-188`) as the pattern to follow.

**NFR-12 — test coverage.** This repo uses a test-first split (tests before
implementation). Tests needed:

(a) `WorkspaceFolderItem` icon/`contextValue` selection by active-session
state — unit test in `test/treeView.test.ts`, matching the existing
per-class test structure used for `ActiveSessionsProvider`
(`test/treeView.test.ts:119-161`).

(b) `WorkspaceFoldersProvider.getChildren()` returns one row per
`workspaceFolders` entry.

(c) `package.json` `when`-clause wiring, in two parts with two different
existing harnesses:
  - The leaf-launch inline-button context menu entry (FR-4) extends
    `test/packageJsonContextKeys.test.ts`, which already enforces a
    bidirectional bijection between `package.json`'s `view/item/context`
    clauses and `VIEW_ITEM` (`test/packageJsonContextKeys.test.ts:55-84`) and
    carries a negative-fixture list to guard against loose regex anchoring
    (`test/packageJsonContextKeys.test.ts:45-53`); the new
    `WORKSPACE_FOLDER_LEAF` token must satisfy the same bijection.
  - The new view's visibility `when`-clause (FR-6, on `contributes.views`,
    not `view/item/context`) is outside what that harness parses — it reads
    only `contributes.menus["view/item/context"]`
    (`test/packageJsonContextKeys.test.ts:12-17`). This needs new,
    purpose-built test coverage (e.g. asserting the
    `claudeConductor.hasMultiRootWorkspace` `when` clause is present on the
    new view entry), not an extension of the existing bijection test.

(d) The new command's QuickPick → `launchSession()` call flow — this belongs
in `test/extension.commandArgs.test.ts`, which already exercises
`src/extension.ts` command registrations and their argument resolution
(e.g. the `resolvePathArg`/group-row regression coverage described in that
file's header comment, `test/extension.commandArgs.test.ts:1-17`), rather
than a new test file.

**NFR-13 — undefined-safe `workspaceFolders` access.**
`vscode.workspace.workspaceFolders` is typed `readonly WorkspaceFolder[] |
undefined`, and its doc comment states it is `undefined` when no workspace
has been opened, not an empty array (`"List of workspace folders (0-N) that
are open in the editor. undefined when no workspace has been opened."` —
`https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts`,
fetched 2026-08-04). None of FR-2's tree provider, FR-6's visibility
context-key logic, or FR-7's QuickPick population may read
`vscode.workspace.workspaceFolders` directly — all three read one shared,
normalized value, declared once: `const folders =
vscode.workspace.workspaceFolders ?? []`. This guarantees `.length` and
iteration in FR-2/FR-6/FR-7 never dereference `undefined`, and keeps the
three call sites consistent with each other and with NFR-9's empty-state
handling. Testable: a reviewer can confirm no call site outside that single
normalization point reads `vscode.workspace.workspaceFolders` directly.

## 3. Scope boundaries

**In scope:** everything in Requirements above — the new tree section, the
new command, active-session icon indication, the `setContext` visibility
gate.

**Explicitly out of scope:**

- Changing the existing single-folder-defaulting behavior at the three
  `workspaceFolders?.[0]` call sites named in § 1 (`src/extension.ts:93`
  cross-window URI launch, `src/extension.ts:222` new-window detection,
  `src/terminalLinks.ts:68` terminal link resolution) — unrelated existing
  behaviors, staying as-is. Not planned as part of this feature; issue #103's
  own "Out of scope" section names the same three call sites (verified,
  fetched 2026-08-04).
- Any change to Conductor's own project/folder list (`getAllFolders()`,
  Recent Projects, Favorites, `quickPick.ts`'s existing folder-based
  QuickPick) — unrelated system, not touched.
- Multi-window / cross-workspace-window session movement — out of scope, not
  discussed.

## 4. Risks

- **New `setContext` plumbing is untested territory in this codebase**
  (verified via `git grep -n "setContext" -- src/`, zero matches, checked
  2026-08-04 — see FR-6). A mis-wired `when` clause could either always-hide
  or always-show the section. Mitigated by the new, purpose-built visibility
  `when`-clause test described in NFR-12(c) — note this is separate coverage
  from the existing `packageJsonContextKeys.test.ts` bijection, which does
  not parse `contributes.views`.
- **`onDidChangeWorkspaceFolders` firing frequency/timing during workspace
  reload.** If the `claudeConductor.hasMultiRootWorkspace` context key isn't
  updated before the tree view re-renders, the section could flash or lag on
  state changes. This is a risk to verify empirically during implementation
  (manual multi-root reload testing), not something this spec can resolve
  statically.

## 5. Open questions

None. Issue #103's acceptance criteria (fetched 2026-08-04) enumerate the
tree section, the command, active-session indication, and the four test
categories in NFR-12; every one is captured in Requirements above. The
active-state icon question in particular resolves cleanly by reusing
`ActiveSessionItem`'s existing icon-selection logic verbatim (FR-3), since
the matched `ActiveSession` object already carries the `isIdle` flag that
logic depends on — no separate design decision was needed there.

## Verification note

Read at commit `7fee18b` (`git rev-parse HEAD` on the `main` branch, 2026-08-04;
`git log -1 --oneline` confirms `7fee18b chore: bump to 1.3.1 (#102)`). All
line-number citations above were read directly from the current working tree
at that commit, not assumed from any brief. Issue #103 was fetched via `gh
issue view 103 --repo glitchwerks/vscode-claude-conductor` (the `gh` CLI) —
the `mcp__github__get_issue` MCP tool was not available in this session's
toolset, so the CLI fallback documented for GitHub URLs was used instead; its
JSON output was read directly, so this is not a degraded-confidence citation.
No other tooling was unavailable.

**Date convention.** Every `fetched YYYY-MM-DD` date in this document is in
`America/New_York`, matching this repo's commit-timestamp convention — `git
log --date=iso-strict` on this branch shows `-04:00` offsets throughout, e.g.
commit `1f1208e` at `2026-08-04T20:53:18-04:00`. Issue #103's GitHub
`createdAt` is `2026-08-05T00:44:37Z` (UTC), which is
`2026-08-04T20:44:37-04:00` in this convention — nine minutes before this
spec's own commit `1f1208e` (`docs: add spec for multi-root workspace folder
launcher (#103)`, `2026-08-04T20:53:18-04:00`). The issue-body fetch
underlying this document's `2026-08-04` citations therefore postdates the
issue's creation in both UTC and local time; `2026-08-04` is correct under
this repo's local-time convention, not an off-by-one error.

**Re-verification pass (CodeRabbit review, PR #105, 2026-08-04).** This
document was re-checked against the working tree at worktree `HEAD`
`1f1208e`, one commit ahead of the `7fee18b` base above. `git diff --stat
7fee18b..HEAD` shows only `docs/README.md` and this spec file changed between
the two commits — no cited source file (`src/**`, `test/**`, `package.json`,
`README.md`, `docs/release-strategy.md`, `scripts/extract-changelog.js`)
moved, so every line-number citation above remains valid at `1f1208e`. The
`setContext`, `onDidChangeWorkspaceFolders`, and `closeSession(` claims in
FR-6, NFR-10, and § 4 Risks were re-run as `git grep -n "<pattern>" -- src/`
on this date, and their citations were rewritten to name the exact command
and result rather than "repo-wide grep." The `vscode.workspace.workspaceFolders`
type claim in NFR-13 was verified by fetching
`https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts`
on 2026-08-04 and reading the property's declaration and doc comment
directly. As before, no MCP GitHub tool was available in this session; `gh`
and `git` were used directly throughout.
