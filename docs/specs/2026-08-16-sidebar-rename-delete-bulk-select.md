---
title: Sidebar rename (alias), delete, and bulk-select for sessions/folders
touches:
  - src/treeView.ts
  - src/extension.ts
  - src/config.ts
  - src/sessionManager.ts
  - src/quickPick.ts
  - package.json
  - test/treeView.test.ts
  - test/extension.commandArgs.test.ts
  - test/packageJsonContextKeys.test.ts
  - test/sessionManager.launchResult.test.ts
  - test/config.test.ts
  - README.md
  - CHANGELOG.md
skills_relevant:
  - simplicity-first
---

# Sidebar rename (alias), delete, and bulk-select for sessions/folders

**Tracking issue:** [#80 "feat: rename (alias), delete, and bulk-select for sidebar sessions/folders"](https://github.com/glitchwerks/vscode-claude-conductor/issues/80) — verified open, body fetched 2026-08-16 (`gh issue view 80 --repo glitchwerks/vscode-claude-conductor --json number,title,state,url`).

**Type:** feature-spec

**Status:** DRAFT — not yet reviewed by a human.

**Prior inputs consumed (not re-derived):**
- `docs/research/2026-07-29-vscode-claude-conductor-landscape-survey.md` § finding 4 (`ShahadIshraq/claude-session-vs-code-extension`) — the competing-extension motivation cited in issue #80's own Context section, re-verified below rather than re-derived.

## 1. Problem

The sidebar (`src/treeView.ts`) has three sections in scope for this issue —
**Active Sessions**, **Recent Projects**, and **Favorites** — each rendering a
folder as its own basename with no way to relabel it, and no way to remove a
row from Recent Projects or bulk-act on several rows at once. A fourth
section, **Workspace Folders**, shipped after this issue was filed (#103,
merged via PR #135, 2026-08-16) and is explicitly out of scope — see § 3.

Issue #80's Context section cites
`docs/research/2026-07-29-vscode-claude-conductor-landscape-survey.md` finding
4 (`docs/research/2026-07-29-vscode-claude-conductor-landscape-survey.md:56-61`,
re-read directly): the actively-maintained competing extension
`ShahadIshraq/claude-session-vs-code-extension` (pushed 2026-07-18, per that
finding) offers `Rename Session` / `Delete Session` / bulk-selection that
Conductor lacks. Conductor's model differs — a live terminal keyed by folder
path, not a persisted named session record — so these actions are adapted
rather than copied, per the same finding's framing.

Three concrete gaps, restated from issue #80's Acceptance Criteria (fetched
2026-08-16):

1. **No relabeling.** A folder's tree label, terminal tab title, and
   quick-pick entry are always `path.basename(folderPath)` — there is no way
   to give a folder a friendlier display name without renaming it on disk.
2. **No delete for Recent Projects.** `claudeConductor.extraFolders`
   (`src/config.ts:22-26`) entries can only be added (`src/quickPick.ts:94-130`,
   `addFolderPrompt`); there is no command to remove one.
3. **No bulk-select.** `claudeConductor.activeSessions` and
   `claudeConductor.recentProjects` are registered with
   `vscode.window.registerTreeDataProvider` (`src/extension.ts:215-216`),
   which has no options parameter and therefore no way to opt into
   `canSelectMany` — confirmed by reading the exported signatures in
   `vscode.d.ts` (`export function registerTreeDataProvider<T>(viewId: string,
   treeDataProvider: TreeDataProvider<T>): Disposable;` vs. `export function
   createTreeView<T>(viewId: string, options: TreeViewOptions<T>):
   TreeView<T>;` —
   `https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.d.ts`,
   fetched 2026-08-16). `claudeConductor.favorites` already uses
   `createTreeView` (`src/extension.ts:202-205`) but without `canSelectMany`,
   and Favorites is not in scope for bulk-select per issue #80's Acceptance
   Criteria (only Active Sessions and Recent Projects are named).

**Status-since-filing correction.** Issue #80's own Technical Notes section
names a "coordinate/sequence after #77" concern and cites config keys under a
`claudeSessions.*` namespace. Both are stale relative to the current repo:
- #77 (Favorites), #78, and #79 are all closed — #77 and #79 merged via PR
  #101 (`gh issue view 77/78/79 --repo glitchwerks/vscode-claude-conductor
  --json state,closedAt`, checked 2026-08-16: #77 closed 2026-08-02, #78
  closed 2026-08-02, #79 closed 2026-08-04). The sequencing note is moot;
  Favorites has been stable in `main` since.
- `claudeSessions.*` was the extension's *pre-rename* configuration
  namespace. `CHANGELOG.md:56-90` documents a breaking rename to
  `claudeConductor.*` with no compatibility aliases, including
  `claudeSessions.extraFolders` → `claudeConductor.extraFolders`
  (`CHANGELOG.md:83`). The current source confirms only `claudeConductor.*`
  exists (`src/config.ts:4`, `package.json:271`; `git grep claudeSessions`
  over `src/` and `package.json` returns no matches, checked 2026-08-16).
  Every config-key reference below uses `claudeConductor.*`, not the issue
  body's stale `claudeSessions.*` spelling.
- Issue #103 (multi-root workspace folder launcher) shipped after #80 was
  filed — merged via PR #135, 2026-08-16
  (`gh pr view 135 --repo glitchwerks/vscode-claude-conductor --json
  state,mergedAt`, checked 2026-08-16). Its `WorkspaceFolderItem` /
  `WorkspaceFoldersProvider` pair (`src/treeView.ts:137-183`) is read below as
  a structural precedent, but the Workspace Folders section itself is not
  touched by this spec — see § 3.

## 2. Requirements

Numbered and testable. FR-n for functional, NFR-n for non-functional.

### Rename (display alias)

**FR-1.** A new command `claudeConductor.renameFolder` (title `"Rename..."`,
category `"Claude Conductor"`, mirroring the `addFavorite`/`removeFavorite`/
`locateFavorite` command-contribution shape at `package.json:89-105`) opens a
`vscode.window.showInputBox` pre-filled with the row's current display name
(alias if set, else basename) and a `validateInput` that rejects only an
empty/whitespace value — mirroring the existing input-box pattern in
`addFolderPrompt` (`src/quickPick.ts:95-113`), minus that function's
directory-existence check (an alias is a free-text label, not a path). On
submit, the result is written via `setFolderAlias` (FR-2); on cancel
(`undefined` return), nothing changes.

**FR-2 — storage.** A new setting `claudeConductor.folderAliases` (type
`object`, default `{}`) stores `{ [canonicalPathKey: string]: string }`,
declared in `package.json`'s `configuration.properties` alongside
`claudeConductor.extraFolders` (`package.json:271-278`), and read/written
through new functions in `src/config.ts` alongside `getExtraFolders`
(`src/config.ts:22-26`):

```ts
export function getFolderAliases(): Record<string, string>;
export function getFolderAlias(folderPath: string): string | undefined;
export async function setFolderAlias(folderPath: string, alias: string): Promise<void>;
export async function removeFolderAlias(folderPath: string): Promise<void>;
```

Map keys are `canonicalKey(folderPath)` (`src/pathCanonical.ts:9-11` —
separator-normalize, trim trailing separator, lowercase), **not** a raw
`path.normalize()`d path. This is a deliberate choice (Decision 2, below):
the codebase produces folder-path strings from at least two different
normalization pipelines that disagree on case and separator handling —
`path.normalize()` in `src/sessionManager.ts:91,321` (Windows-style
backslashes, case preserved) and `path.normalize()` again in
`src/folderSource.ts:60` (same) — and `canonicalKey` is the one helper this
repo already uses specifically to make cross-pipeline path comparison
consistent, per its own doc comment: *"Canonical path key for case/separator-
insensitive lookups across the favorites and existence-cache systems"*
(`src/pathCanonical.ts:1-7`). Writes go through
`vscode.WorkspaceConfiguration.update(key, value,
vscode.ConfigurationTarget.Global)`, matching `addFolderPrompt`'s existing
write to `extraFolders` at `src/quickPick.ts:128` — `Global` scope (not
per-workspace) so an alias persists across whichever workspace the folder is
opened from, consistent with `FavoritesStore` also being global
(`src/favoritesStore.ts:79`, backed by `vscode.Memento` /
`context.globalState`, not workspace state).

**FR-3 — display surfaces.** Every render site that currently computes a
folder's display name from `path.basename(...)` looks up
`getFolderAlias(folderPath)` first and falls back to the existing basename
when unset. This is a live, per-render lookup (not baked into any stored
object), matching the existing pattern of `favoritesStore.isFavorited(...)`
and `existenceCache.peek(...)` being read fresh inside `getChildren()` rather
than cached on construction (`src/treeView.ts:118-125` for
`ActiveSessionsProvider.getChildren`, `src/treeView.ts:310-316` for
`RecentProjectsProvider.getChildren`). Seven sites, by file:line (current
tree, commit `1602bea`):

- `src/treeView.ts:39` — `ActiveGroupItem` label (`path.basename(group.root)`).
- `src/treeView.ts:62` — `ActiveSessionItem` label (`session.folderName`,
  itself `path.basename(folderPath)` per `src/sessionManager.ts:322` — this
  is a *render-time* lookup on the live `ActiveSession` object, separate from
  the launch-time terminal-name substitution in FR-4, which cannot be
  updated after the fact — see FR-4).
- `src/treeView.ts:205` — `RecentGroupItem` label.
- `src/treeView.ts:250` — `RecentProjectItem` label (`entry.name`).
- `src/treeView.ts:341` — `FavoriteLeafItem` label
  (`path.basename(folderPath) || folderPath`) — Favorites is not in scope for
  Rename/Delete/bulk-select *commands* (§ 3), but its label reads the same
  alias map for display consistency: the alternative — a folder showing its
  alias in Recent Projects but its raw basename in Favorites — reads as a
  bug, not a feature boundary, and the change is a single-line label lookup
  with no new command surface.
- `src/quickPick.ts:29` — active-session quick-pick item label
  (`session.folderName`).
- `src/quickPick.ts:43` — folder quick-pick item label (`folder.name`).

`WorkspaceFolderItem` (`src/treeView.ts:137-154`, label = `folder.name`) is
explicitly **not** included — see § 3.

**FR-4 — launch-time tab title (normative; see § 4 for why it is
launch-time-only).** `SessionManager.launchSession()`
(`src/sessionManager.ts:90-133`) looks up `getFolderAlias(normalized)` before
building the terminal's `name` string and, when an alias is set, uses it in
place of `path.basename(normalized)`:

```ts
const folderName = getFolderAlias(normalized) ?? path.basename(normalized);
// ...
const terminal = vscode.window.createTerminal({
  name: `${SESSION_NAME_PREFIX}${folderName}`,
  // ...
});
```

(`src/sessionManager.ts:119,122` are the two lines this replaces.)
`SESSION_NAME_PREFIX` itself is untouched by this substitution, so the
tab-grouping heuristic that depends on that exact prefix — `_isConductorTab`,
`tab.label.startsWith(SESSION_NAME_PREFIX)` (`src/sessionManager.ts:168-171`,
accepted by `docs/specs/2026-08-15-session-tab-default-grouping.md`) — keeps
working unchanged, since only the suffix after the prefix changes. This is a
launch-time snapshot, not a live binding: a session already running when its
folder is renamed keeps its original tab title until closed and relaunched
(`Terminal.name` is `readonly` — see § 4 Risks for the citation and the
Acceptance-Criteria narrowing this implies). `ActiveSession.folderName`
itself (`src/sessionManager.ts:322`, set inside `_trackIfClaudeSession`) is
**not** changed by this FR — it continues to store the raw basename that
matches the real terminal's name suffix, matching what actually launched;
FR-3's `ActiveSessionItem` display lookup (`src/treeView.ts:62`) is a
separate, independent, render-time overlay on top of it, which is exactly
why that lookup stays live while the terminal's own title does not.

**FR-5 — reactive updates.** `ActiveSessionsProvider` and
`RecentProjectsProvider` additionally subscribe to
`vscode.workspace.onDidChangeConfiguration`, firing `_onDidChangeTreeData`
when `e.affectsConfiguration("claudeConductor.folderAliases")` is true —
mirroring the existing `favoritesStore.onDidChange(...)` /
`existenceCache.onDidChange(...)` subscriptions already wired into both
providers' constructors (`src/treeView.ts:91-97` for `ActiveSessionsProvider`,
`src/treeView.ts:277-285` for `RecentProjectsProvider`). This is what makes
FR-3's live lookup pattern actually repaint the tree when an alias changes,
rather than only updating on the next unrelated refresh. Choosing
configuration (FR-2) over a bespoke `EventEmitter`-backed store (the
`FavoritesStore` shape, `src/favoritesStore.ts:67-253`) is what makes this
free: `onDidChangeConfiguration` is a built-in signal, so no new event
plumbing is needed the way `FavoritesStore` needed its own
`_onDidChange`/`onDidChange` pair.

**FR-6 — command wiring and scope.** `claudeConductor.renameFolder` is added
to `package.json`'s `view/item/context` (`package.json:163-229`) with:

```json
{
  "command": "claudeConductor.renameFolder",
  "when": "!listMultiSelection && (viewItem == activeSession || viewItem =~ /^recentProjectLeaf\\.(configured|recent)$/ || viewItem == worktreeChild)",
  "group": "rename@1"
}
```

`viewItem == activeSession` covers every Active Sessions row, including
worktree children — `ActiveSessionItem` sets `contextValue = "activeSession"`
unconditionally regardless of `isWorktreeChild` (`src/treeView.ts:74`).
`worktreeChild` covers Recent Projects' worktree-child rows
(`VIEW_ITEM.WORKTREE_CHILD`, `src/treeView.ts:19`, set at
`src/treeView.ts:257-259`). The `recentProjectLeaf.(configured|recent)`
alternation is the split introduced by FR-10 (Decision 1, below); both
variants get Rename (the source restriction in FR-10 applies to *delete*
only — the issue's Rename bullet carries no source-restriction language,
unlike its Delete bullet).

`!listMultiSelection` hides Rename entirely when more than one row is
selected — a documented VS Code `when`-clause context key, *"A list has a
selection of multiple elements"*
(`https://code.visualstudio.com/api/references/when-clause-contexts`, fetched
2026-08-16), matching the built-in Explorer's convention of hiding
single-target actions from multi-selections rather than having the command
silently act on only the first of several selected rows. Group `rename@1` is
a new group prefix, following the existing `favorites@1`/`missing@2`
custom-group convention already used for non-inline sections of this same
menu contribution (`package.json:214-227`) — Rename is deliberately **not**
`inline` (no hover icon): the inline row for Active Sessions is already three
icons wide (`focusSession`, `openInNewWindow`, `closeSession`,
`package.json:164-178`), and Rename/Remove are secondary, not primary,
actions.

Aliasing worktree children is a scope decision this spec is making, not
deferred: the alias map is keyed by normalized path (issue #80's own
Technical Notes wording), and a worktree child is exactly as much "a folder
entry" as a project root — its basename is frequently an unreadable branch
hash, arguably the row that benefits most from a friendly label.

### Delete (Recent Projects) — Decision 1

**FR-7 — Active Sessions delete.** No new command. Per issue #80's own
Acceptance Criteria, `claudeConductor.closeSession` already exists
(`src/sessionManager.ts:233-243`, registered at `src/extension.ts:335-340`)
and is already wired to the `activeSession` inline group
(`package.json:174-178`); this spec only needs it reachable from a
multi-selection (FR-11).

**Decision 1 — recents-sourced rows.** Issue #80 leaves open whether a
`source: "recent"` row (VS Code's own recently-opened list, not Conductor's
`extraFolders`) should have its Remove action hidden/disabled, or the row
itself hidden from Conductor's view. **Resolved: hide/disable the Remove
action; do not hide the row.** Rationale:

- Hiding the row would require a new, separate persisted "hidden folders"
  list — `getAllFolders()` (`src/folderSource.ts:52-92`) recomputes fresh on
  every `RecentProjectsProvider.getChildren()` call with no caching layer
  (`src/treeView.ts:308`), so nothing about the current architecture
  remembers "the user dismissed this row" across a re-render; that state
  would have to live somewhere new. Issue #80's own Out of Scope section
  already excludes "deleting from VS Code's own recently-opened list (not
  Conductor's to manage)" — introducing a parallel exclude-list to *simulate*
  deletion contradicts that boundary in spirit, and is unrequested scope for
  what the Acceptance Criteria frames as a source-availability question, not
  a curation feature.
- Disabling the action keeps the row's presence fully derived (today's
  architecture) and keeps the semantics legible: a `source: "recent"` row's
  Remove action is absent because Conductor doesn't own that data, not
  because the user asked to hide it.

**FR-8 — dedup caveat (documented, not solved).** `getAllFolders()`
deduplicates by processing `recentPaths` before `extraPaths`
(`src/folderSource.ts:84-89`) — a path present in *both* VS Code's recents
and `claudeConductor.extraFolders` is tagged `source: "recent"` only, because
the `seen` set (`src/folderSource.ts:56,62-65`) blocks the later
`extraPaths` add. This means such a row's Remove action is hidden by FR-10's
contextValue split even though the path *is* also in `extraFolders` and
could, in principle, be removed from config. This is a pre-existing
architectural property of `getAllFolders()`, not something this feature
introduces or can cleanly fix without changing that function's dedup
priority (out of scope — `getAllFolders()` is unmodified by this spec).
Document it in `README.md`'s "Known Limits" section (mirroring the existing
Favorites Known Limits at `README.md:137-141`).

**FR-9.** `RecentProjectItem`'s constructor (`src/treeView.ts:246-267`) sets a
per-source `contextValue`, replacing the current single
`VIEW_ITEM.RECENT_PROJECT_LEAF` token for non-worktree-child leaves:

```ts
this.contextValue = isWorktreeChild
  ? VIEW_ITEM.WORKTREE_CHILD
  : entry.source === "configured"
    ? VIEW_ITEM.RECENT_PROJECT_LEAF_CONFIGURED
    : VIEW_ITEM.RECENT_PROJECT_LEAF_RECENT;
```

**FR-10 — `VIEW_ITEM` and `package.json` migration (Decision 1's
mechanism).** `VIEW_ITEM.RECENT_PROJECT_LEAF` (`"recentProjectLeaf"`,
`src/treeView.ts:17`) is replaced by two mutually exclusive sibling tokens —
`RECENT_PROJECT_LEAF_CONFIGURED: "recentProjectLeaf.configured"` and
`RECENT_PROJECT_LEAF_RECENT: "recentProjectLeaf.recent"` — following the
precedent of the group row's own three mutually-exclusive tokens
(`PROJECT_ROOT_FAVORITED`/`PROJECT_ROOT_UNFAVORITED`/`PROJECT_ROOT_MISSING`,
`src/treeView.ts:14-16`, assigned at `src/treeView.ts:226-238`). Splitting the
token is unavoidable, not a stylistic preference: `contextValue` is a single
string per `TreeItem`, and the two source variants need to diverge on Remove
availability while continuing to converge on the existing Launch Session
inline button — so the existing `openSession` `when`-clause
(`package.json:184-188`, currently `viewItem == recentProjectLeaf`) must
widen to a regex matching both new tokens, following this file's own
established `=~` regex-in-`when` convention (`package.json:201,206,221,226`):

```json
{
  "command": "claudeConductor.openSession",
  "when": "view == claudeConductor.recentProjects && viewItem =~ /^recentProjectLeaf\\.(configured|recent)$/",
  "group": "inline"
}
```

A new command `claudeConductor.removeFolder` (title `"Remove from Recent
Projects"`, category `"Claude Conductor"`) is added to
`view/item/context`:

```json
{
  "command": "claudeConductor.removeFolder",
  "when": "view == claudeConductor.recentProjects && viewItem == recentProjectLeaf.configured",
  "group": "danger@1"
}
```

Its handler removes the folder from `claudeConductor.extraFolders` via a new
`removeExtraFolder(folderPath)` helper in `src/config.ts`, matching
`getExtraFolders`'s tilde-expansion (`src/config.ts:22-26`) and using
`canonicalKey()` for the equality check (rather than the ad hoc
`path.normalize(f).toLowerCase()` comparison in `src/quickPick.ts:123`,
which predates `pathCanonical.ts` and is not touched by this spec).

**Test-migration note and full blast radius.** This rename is a **breaking
change to an existing, tested contract**, not purely additive. A repo-wide
`git grep recentProjectLeaf` (run against commit `1602bea`, 2026-08-16) finds
every occurrence; each is classified below rather than left as an
unconfirmed hedge:

- `src/treeView.ts:17,259` — the definition and its one usage site; both
  replaced by FR-9/FR-10 above.
- `package.json:186` — the `openSession` `when`-clause literal; widened by
  FR-10 above.
- `test/treeView.test.ts:345,374` — two `.toBe("recentProjectLeaf")`
  assertions inside the "issue #79" describe block
  (`test/treeView.test.ts:327-381`); must be updated to the two new tokens.
  `test/treeView.test.ts:392` is a comment (inside the "VIEW_ITEM constants"
  describe block, `:382-`) referencing `recentProjectLeaf` as precedent for
  `WORKSPACE_FOLDER_LEAF` — prose only, no assertion, but stale after this
  change and worth updating in the same pass.
- `test/packageJsonContextKeys.test.ts:142` — `const RECENT_PROJECT_LEAF =
  "recentProjectLeaf";`, and the assertions built on it in the "issue #79"
  describe block (`:141-229`); must be updated. Lines 134 and 235 are
  comments; line 265 is a human-readable assertion-failure message (inside
  the *unrelated* issue-#103 `WORKSPACE_FOLDER_LEAF` describe block,
  `:239-268`) that itself already cites a stale `package.json:162-176` line
  range — pre-existing drift in that message, not something this spec
  introduces or is required to fix, but not touched by FR-9/FR-10 either
  since it asserts on `WORKSPACE_FOLDER_LEAF`, not `RECENT_PROJECT_LEAF`.
- `CHANGELOG.md:48` — a historical entry describing PR #101/issue #79's fix,
  naming `recentProjectLeaf` as the contextValue introduced at the time.
  CHANGELOG entries describe repo state as of their own release and are not
  retroactively rewritten for later renames (no other entry in this file is
  updated when the code it describes later changes) — left as-is.
- `docs/specs/2026-08-04-workspace-folder-launcher-design.md:106,111` — an
  **ACCEPTED** spec's FR-4 names `RECENT_PROJECT_LEAF` as illustrative
  precedent for introducing `WORKSPACE_FOLDER_LEAF`'s own contextValue. That
  FR was fully implemented by #103/PR #135 before this rename; its normative
  content (introduce a leaf-only token, wire it into the `openSession`
  clause) is unaffected, but its prose becomes a stale cross-reference once
  `RECENT_PROJECT_LEAF` no longer exists under that name. This spec is not
  authorized to edit that file (out of scope, § 3) — flagged here so a
  reviewer can decide whether a follow-up touch-up is worth it; ACCEPTED
  specs in this repo are treated as point-in-time design records rather than
  living documentation (see `docs/sdd-workflow.md` § "Historical content
  folded into the foundational spec" for the general precedent that old spec
  prose is allowed to age rather than be kept current).

### Bulk-select

**FR-11.** `claudeConductor.activeSessions` and `claudeConductor.recentProjects`
convert from `vscode.window.registerTreeDataProvider` to
`vscode.window.createTreeView(..., { treeDataProvider, canSelectMany: true })`
(`src/extension.ts:215-216`), mirroring `claudeConductor.favorites`'s existing
`createTreeView` call (`src/extension.ts:202-205`) — `showCollapseAll` is
omitted from both new calls (as it already effectively defaults away for the
two `registerTreeDataProvider` views today), so no collapse-all button
appears as an unplanned side effect. The two returned `TreeView` handles are
pushed to `context.subscriptions` the same way `favoritesView` already is
(`src/extension.ts:214-221`).

**FR-12 — the two-argument multi-select contract.** Per
`vscode.d.ts`'s `TreeViewOptions.canSelectMany` doc comment: *"Whether the
tree supports multi-select. When the tree supports multi-select and a command
is executed from the tree, the first argument to the command is the tree item
that the command was executed on and the second argument is an array
containing all selected tree items."*
(`https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.d.ts`,
`TreeViewOptions` interface, fetched 2026-08-16). This is the same
two-argument shape this codebase already handles for Explorer multi-select
(`openClaudeHere(uri, uris, isFolder)`, `src/extension.ts:231-262`, where
`uris` is `readonly vscode.Uri[] | undefined`) — so extending existing
handlers to read an optional second array argument is a known pattern here,
not new plumbing.

**FR-13 — multi-close.** `claudeConductor.closeSession`'s handler
(`src/extension.ts:335-340`) gains an optional second parameter — the
selected-items array — and, when present with length > 1, resolves each
element via the existing `resolveSession` helper (`src/extension.ts:53-67`)
and calls `sessionManager.closeSession(...)` for each resolved session,
falling back to today's single-argument behavior otherwise. No new command:
issue #80's own Acceptance Criteria states the existing command "already
covers this — no new behavior needed, just ensure it's reachable."

**FR-14 — multi-remove.** `claudeConductor.removeFolder`'s handler (FR-10)
takes the same optional second-argument shape as FR-13 and iterates,
resolving each selected item's path via `resolvePathArg`
(`src/extension.ts:77-89`). It **defensively filters to items whose
`contextValue` is `VIEW_ITEM.RECENT_PROJECT_LEAF_CONFIGURED`** when iterating
a multi-selection — i.e., re-checks the discriminator per item rather than
trusting that every item in the array satisfies the same `when`-clause that
made the menu entry visible. This is `contextValue`, not `entry.source`:
`RecentProjectItem` (`src/treeView.ts:246-267`) retains only `readonly
folderPath: string` as public state (`src/treeView.ts:247`) — the
`FolderEntry.source` value that produced it (FR-9) is consumed at
construction time to pick a `contextValue` and is not itself carried onto
the `TreeItem`, so `contextValue` is the only discriminator available to a
command handler working from the tree item, and it is already exactly the
one FR-9/FR-10 introduce for this purpose. VS Code's `view/item/context`
visibility is evaluated against the item that was right-clicked, not
necessarily every item in a heterogeneous multi-selection (a user can
ctrl-click a `recent`-sourced row into a selection anchored on a
`configured`-sourced row); this spec does not assert a precise claim about
VS Code's exact multi-selection menu-visibility algorithm, since that
behavior isn't documented at the level of specificity this citation
discipline requires — the filter is required regardless of what that
algorithm turns out to do, because it costs nothing and closes the gap
either way.

**NFR-15 — test coverage.** This repo uses a test-first split (tests before
implementation, per this repo's standard workflow). Coverage needed, mapped
to the five test files in this document's `touches:` list:

**(a) `test/config.test.ts` (new file).** `getFolderAliases` /
`getFolderAlias` / `setFolderAlias` / `removeFolderAlias` (FR-2) and
`removeExtraFolder` (FR-10) round-trip through a mocked
`vscode.workspace.getConfiguration` the same way `src/config.ts`'s existing
functions are exercised indirectly today (no dedicated `config.test.ts`
exists yet — `ls test/ | grep -i config` returns no matches, checked
2026-08-16, hence "new file"). Cover: `canonicalKey`-based case/separator
insensitivity on both read and write (FR-2's Decision 2 rationale), and that
`setFolderAlias`/`removeExtraFolder` preserve unrelated existing entries in
the same map/array on write.

**(b) `test/treeView.test.ts`.** Alias-aware label rendering at each of
FR-3's seven sites that live in this file (`ActiveGroupItem`,
`ActiveSessionItem`, `RecentGroupItem`, `RecentProjectItem`,
`FavoriteLeafItem`), following this file's existing per-class test structure
(e.g. `test/treeView.test.ts:125-215` for `ActiveSessionsProvider`). The
`RECENT_PROJECT_LEAF_CONFIGURED`/`RECENT_PROJECT_LEAF_RECENT` contextValue
split (FR-9/FR-10) replaces the two assertions at
`test/treeView.test.ts:345,374` (see FR-10's blast-radius note) rather than
adding new ones alongside them. Reactive re-render on
`onDidChangeConfiguration` (FR-5) needs new coverage — no existing test in
this file exercises that event today (only `sessionManager.onDidChangeSessions`,
`favoritesStore.onDidChange`, `existenceCache.onDidChange` are covered,
matching the constructors at `src/treeView.ts:91-97,277-285`).

**(c) `test/packageJsonContextKeys.test.ts`.** Extends the existing
bijection harness (`test/packageJsonContextKeys.test.ts:55-84`) for the two
new `VIEW_ITEM` tokens and the widened `openSession` regex (FR-10), following
the same shape the #103 additions already used for `WORKSPACE_FOLDER_LEAF`
(`test/packageJsonContextKeys.test.ts:239-268`). New, purpose-built coverage
for the `renameFolder` (FR-6) and `removeFolder` (FR-10) `when`-clauses,
including the `!listMultiSelection` gate on `renameFolder` — outside what the
bijection harness itself parses, matching how the `#103`
`contributes.views`-visibility coverage
(`test/packageJsonContextKeys.test.ts:291-305`) was added as a separate,
purpose-built block rather than folded into the bijection harness. The
`const RECENT_PROJECT_LEAF = "recentProjectLeaf";` constant and its
dependent assertions (`test/packageJsonContextKeys.test.ts:141-229`) are
updated to the two new tokens as part of the same change (FR-10's blast-radius
note).

**(d) `test/extension.commandArgs.test.ts`.** The two-argument multi-select
contract (FR-12) for `closeSession` (FR-13) and `removeFolder` (FR-14,
including the defensive `contextValue`-based filter), following this file's
existing `resolveSession`/`resolvePathArg` coverage pattern and stated
purpose (`test/extension.commandArgs.test.ts:1-17`) — no VS Code UI selection
state needs to be simulated for this, since `TreeViewStub`
(`test/mocks/vscode.ts:250-254`) does not model live selection and none of
this repo's existing multi-arg tests do either; a constructed two-argument
call is sufficient, matching how `openClaudeHere(uri, uris, isFolder)`'s
`uris` argument is already tested.

**(e) `test/sessionManager.launchResult.test.ts`.** New coverage for FR-4:
when a `claudeConductor.folderAliases` entry exists for the launched path,
the terminal's `name` option passed to `vscode.window.createTerminal` carries
`${SESSION_NAME_PREFIX}${alias}`, not `${SESSION_NAME_PREFIX}${basename}`;
when no entry exists, today's basename behavior is unchanged. This file
already exercises `launchSession()`'s `LaunchResult` branches
(`test/sessionManager.launchResult.test.ts:15-30`) and is the natural home
for a `createTerminal` call-argument assertion, rather than a new file.

## 3. Scope boundaries

**In scope:** everything in § 2 — the alias map and its seven display sites,
the launch-time terminal-name substitution, the `renameFolder` command, the
`removeFolder` command and its recents-vs-configured contextValue split,
bulk-select on Active Sessions and Recent Projects, and the two multi-select
command extensions.

**Explicitly out of scope:**

- **Renaming or deleting the actual folder on disk.** Display alias only —
  issue #80's own Out of Scope section states this identically.
- **Deleting from VS Code's own recently-opened list.** Not Conductor's to
  manage — issue #80's own Out of Scope section states this identically; see
  also Decision 1 (§ 2) for why the Remove action is hidden rather than
  simulated via a second exclude-list.
- **Any change to `closeSession`'s existing single-item behavior** beyond
  accepting the optional multi-select array (FR-13) — issue #80's own Out of
  Scope section states this identically.
- **The Favorites panel's command surface.** Issue #80's Acceptance Criteria
  names only Active Sessions and Recent Projects for bulk-select, and only
  those two plus Active Sessions for delete. Favorites gets the alias
  *display* (FR-3) for consistency, but no new Rename/Remove commands, no
  `canSelectMany`, and no multi-select handler changes.
- **The Workspace Folders panel** (`src/treeView.ts:137-183`, shipped via
  #103/PR #135 after issue #80 was filed). Not named in issue #80's
  Acceptance Criteria. `WorkspaceFolderItem.label` is `folder.name`, VS
  Code's own workspace-folder name (independently settable inside the
  `.code-workspace` file itself) — a different, pre-existing renaming
  mechanism that a Conductor-side alias would either duplicate or shadow
  confusingly. Left for a future issue if wanted.
- **A cap on the number of aliases.** `FavoritesStore`'s 25-entry cap
  (`src/favoritesStore.ts:19`) exists because Favorites is a UI list a user
  actively curates and views as a whole; `claudeConductor.folderAliases` is
  inert metadata with no dedicated list view of its own, so the same
  curation-pressure argument doesn't apply. No cap is enforced.
- **Retroactively updating an already-open terminal's tab title.** FR-4
  substitutes the alias only at launch time; see § 4 Risks and § 5 Open
  Question 1 for the constraint this follows from and the confirmation this
  spec is requesting on it.

## 4. Risks

- **Terminal tab titles cannot be renamed after creation.** `vscode.d.ts`
  declares `Terminal.name` as `readonly` (`export interface Terminal { ...
  readonly name: string; ... }`,
  `https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.d.ts`,
  fetched 2026-08-16) — there is no supported API to change a live
  `Terminal`'s name once `vscode.window.createTerminal(...)` has run
  (`src/sessionManager.ts:121-127`). This means issue #80's Acceptance
  Criteria promise that an alias is "shown ... in tab title" can only be
  honored **at launch time**, which is what FR-4 implements. A session
  already running when its folder is renamed keeps its original tab title
  until closed and relaunched; the tree label and quick-pick entry (FR-3,
  FR-5) update live regardless, since those are computed fresh on every
  render rather than baked in at launch. This is a resolved technical
  constraint (backed by the `vscode.d.ts` citation above) — but it narrows
  one clause of issue #80's literal Acceptance Criteria wording, which is
  exactly why it is also raised as § 5 Open Question 1 rather than resolved
  silently: the *fact* is not in question, but whether launch-time-only
  fulfillment is an acceptable reading of that Acceptance Criteria bullet is
  a judgment call for the issue author, not this spec, to confirm.
- **`recentProjectLeaf` token rename touches accepted, tested behavior.**
  FR-10's contextValue split changes a token introduced and tested for issue
  #79 (closed, merged via PR #101). The full blast radius — every repo-wide
  occurrence, individually classified — is enumerated in FR-10's
  "Test-migration note and full blast radius" above, including the one
  ACCEPTED spec (`docs/specs/2026-08-04-workspace-folder-launcher-design.md`)
  whose prose goes stale without being incorrect.
- **The dedup caveat in FR-8** is a real, if narrow, correctness gap
  (a folder present in both VS Code's recents and `extraFolders` cannot be
  removed via the sidebar, only via Settings) — documented, not fixed, per
  FR-8's rationale.

## 5. Open questions

1. ⚠️ **Confirmation needed — is launch-time-only tab-title aliasing an
   acceptable reading of issue #80's Acceptance Criteria?** FR-4 substitutes
   the alias into a session's terminal name only at the moment
   `launchSession()` creates it; VS Code gives no API to rename a `Terminal`
   after creation (`Terminal.name` is `readonly` — § 4 Risks). This means a
   session already running when a folder is renamed keeps its old tab title
   until the user closes and relaunches it — a real, user-visible gap
   against the Acceptance Criteria's literal "shown ... in tab title"
   wording. This spec's recommendation is to accept that gap (there is no
   alternative that doesn't require an unsupported VS Code capability), but
   the issue author should explicitly confirm before implementation starts,
   since it is their Acceptance Criteria being narrowed.

Decision 1 (recents-sourced delete behavior, FR-7/FR-8) and Decision 2
(alias-storage location, FR-2) — the two decision points issue #80 itself
left open — are both resolved in § 2 with a stated rationale, not deferred
here.

## Verification note

Read against the working tree at commit `1602bea` (`Add Workspace Folders
sidebar section and launch command (#135)`, `git rev-parse HEAD` on `main`,
2026-08-16) — `main` was fast-forwarded from `3b24082` to `1602bea` at the
start of this session after confirming `git rev-list --left-right --count
main...origin/main` showed local strictly behind (`0	1`), per this repo's
own CLAUDE.md pull discipline. All `src/`, `package.json`, `README.md`, and
`CHANGELOG.md` line-number citations above were read directly from that
commit's working tree, not assumed from the issue body or from prior specs;
every `src/treeView.ts` citation in particular was re-verified against a
fresh read or `grep` after an initial drafting pass produced several
off-by-several-lines errors there (caught before this spec was finalized,
not left in it) — a reminder that this repo's own citation-fragility lesson,
stated in `docs/sdd-workflow.md` § "Historical content folded into the
foundational spec" ("when a document is cited by line number, edits to it
must be same-line substitutions"), applies just as much to a document being
*written* as to one being *cited*.
Issue #80 and issues/PRs #77, #78, #79, #101, #103, #135 were fetched live via
`gh issue view` / `gh pr view` (the `gh` CLI), each with `--json` field
selection quoted inline at its citation site; no MCP GitHub tool was invoked
in this session. The two `vscode.d.ts` API citations (`TreeViewOptions.
canSelectMany`, `Terminal.name`) and the `registerTreeDataProvider`/
`createTreeView` signatures were read directly from
`https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.d.ts`,
fetched 2026-08-16, via `curl` into a scratch file outside the repo, read with
`grep`/`sed`, and deleted at the end of this drafting session (it was
re-created for a follow-up check partway through and not removed again until
a final cleanup pass — not committed, not left on disk in the finished
state). The `listMultiSelection` when-clause-context citation was fetched
from `https://code.visualstudio.com/api/references/when-clause-contexts` the
same day. No tooling was unavailable during this pass.
