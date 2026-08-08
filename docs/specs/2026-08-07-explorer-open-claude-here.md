---
title: "Open Claude Here" Explorer context menu command — feature spec (Issue #107)
touches:
  - package.json
  - src/extension.ts
  - test/extension.openHere.test.ts
  - README.md
  - CHANGELOG.md
skills_relevant:
  - simplicity-first
---

# "Open Claude Here" Explorer Context Menu Command

**Tracking issue:** [#107 "feat: \"Open Claude Here\" context menu item in Explorer pane"](https://github.com/glitchwerks/vscode-claude-conductor/issues/107) — verified open, body fetched 2026-08-07.

**Type:** feature-spec

**Status:** ACCEPTED

## 1. Problem

Launching a Claude Conductor session today requires going through the sidebar
(Active Sessions / Favorites / Recent Projects, via `claudeConductor.openSession`)
or the Quick Pick (`claudeConductor.addFolder`) (`#107`, open, fetched
2026-08-07, § Context). Neither path starts from a folder or file the user
is already looking at in VS Code's built-in Explorer pane. VS Code's own
"Open in Integrated Terminal" Explorer context-menu item is the closest
existing convention this feature mirrors (`#107`, open, fetched 2026-08-07,
§ Context).

This is a new user-visible context-menu surface, which this repo's
`CLAUDE.md:L16-L18` requires a spec for even when the change itself is
small — hence this document, per the Acceptance Criteria of `#107` (open,
fetched 2026-08-07), item "Spec written and reviewed ... before
implementation begins."

## 2. Requirements

**FR-1.** Two commands are registered — `claudeConductor.openHere` (folder
targets) and `claudeConductor.openHereFromFile` (file targets) — both
titled "Open Claude Here" and both contributed to
`contributes.menus["explorer/context"]` in `package.json` (see FR-2 for the
`when`-clause split that keeps exactly one visible per right-click). Both
`vscode.commands.registerCommand` call sites delegate to one shared
implementation function, differing only in the `isFolder` boolean each
registration passes in (see FR-6) — this is not duplicated logic, just two
thin entry points. `explorer/context` is a new menu group in this repo's
`package.json` — the existing groups are `view/title` and
`view/item/context` only (`package.json:L128-L208`), both scoped to the
Claude Conductor sidebar's own tree views, not the Explorer.

**FR-2.** The menu contribution shows on both files and folders — per the
Acceptance Criteria of `#107` (open, fetched 2026-08-07), both a
folder-invoked and a file-invoked behavior are required, so the clause must
not restrict to one or the other. **Resolved (OQ-2, 2026-08-07; PR #108,
open, fetched 2026-08-07, § Key decisions):**
`contributes.menus["explorer/context"]` gets two entries, each invoking a
**different command ID** (FR-1) — `"command":
"claudeConductor.openHere"` with `"when": "explorerResourceIsFolder"`, and
`"command": "claudeConductor.openHereFromFile"` with `"when":
"!explorerResourceIsFolder"`. Both entries share the same title ("Open
Claude Here") and group, so exactly one item renders per right-click, but
the distinct command IDs are what carry the file-vs-folder distinction into
the handler (FR-6) — a shared `when` clause on a single command ID could
not do this, because `contributes.menus` entries have no field for passing
extra data to the invoked command
(https://code.visualstudio.com/api/references/contribution-points, fetched
2026-08-07, § Menus — command, when, group, alt, and submenu are the only
supported per-entry fields). VS Code exposes `explorerResourceIsFolder` as
a when-clause context key that is true when a folder is selected
(https://code.visualstudio.com/api/references/when-clause-contexts, fetched
2026-08-07); it governs which entry renders, nothing more.

**FR-3.** Invoking `claudeConductor.openHere` (the folder-targeted command,
FR-1/FR-2) launches or focuses a session rooted at that folder, by calling
`sessionManager.launchSession(folderPath)` — the same call already used by
`claudeConductor.openSession` (`src/extension.ts:L182`) and documented on
`SessionManager.launchSession` itself (`src/sessionManager.ts:L82-L90`).
This means the new command automatically respects
`claudeConductor.reuseExistingTerminal` (`src/sessionManager.ts:L111-L117`)
and the existing missing-folder guard (`src/sessionManager.ts:L100-L109`)
without any new logic.

**FR-4.** Invoking `claudeConductor.openHereFromFile` (the file-targeted
command, FR-1/FR-2) launches or focuses a session rooted at the file's
**parent** folder — `path.dirname(uri.fsPath)` — then proceeds as FR-3's
`launchSession` call. This matches the Acceptance Criteria of `#107` (open,
fetched 2026-08-07): "Invoked on a file → launches/focuses a session
rooted at the file's parent folder".

**FR-5.** Both commands read `uri.fsPath` directly from the `vscode.Uri`
argument VS Code passes for Explorer context-menu invocations. Neither
routes through the existing `resolvePathArg()` helper
(`src/extension.ts:L49-L61`), whose `obj.path` fallback would read
`vscode.Uri.path` — the URI-encoded POSIX-style path, not the real
filesystem path. On Windows this can diverge from `.fsPath` (drive-letter
casing, separators), per `#107` (open, fetched 2026-08-07) § Technical
Notes, which calls this out explicitly as the reason a naive reuse of
`resolvePathArg()` would be wrong for this command. `resolvePathArg()` itself is left unmodified; the new
commands get their own small, shared arg-resolution path.

**FR-6.** File-vs-folder branching is determined primarily by **which
command fired** — `claudeConductor.openHere` (folder, FR-3) or
`claudeConductor.openHereFromFile` (file, FR-4) — each registration passing
its `isFolder` boolean into the one shared implementation (FR-1). **Resolved
(OQ-2, 2026-08-07; PR #108, open, fetched 2026-08-07, § Key decisions):**
this is what makes the FR-2 menu split load-bearing rather than cosmetic —
the command ID is the only menu-contribution-level channel available for
handing that context to the handler (FR-2's citation).
`vscode.workspace.fs.stat(uri)`, per `#107` (open, fetched 2026-08-07)
§ Technical Notes, is retained but demoted from primary type-detection to a
staleness/validity check per Risk 2: it confirms the target still exists
and, incidentally,
that its `FileType` (`FileType.Directory` vs `FileType.File`) still matches
what the invoked command assumed. If `stat` rejects (target deleted or
became inaccessible between right-click and invocation), or its result
contradicts the invoked command's assumption (e.g. `claudeConductor.openHere`
fired but the target is now a file — the resource was deleted and replaced
in the interval), the command surfaces a `vscode.window.showErrorMessage`
and does not call `launchSession`, rather than silently proceeding on stale
information — see § 4 Risks.

**FR-7.** When VS Code invokes the command with multiple Explorer items
selected, it acts on the **first/clicked item only** — no per-item fan-out
— per the Acceptance Criteria of `#107` (open, fetched 2026-08-07). The
command implementation must accept and ignore any additional argument VS
Code passes for the rest of the selection (see § 4 Risk 3 for the
unverified argument-shape detail this depends on).

**FR-8.** `README.md` § Commands is updated to list the new command, per
the Acceptance Criteria of `#107` (open, fetched 2026-08-07): "`README.md`
updated if this changes documented usage/commands". The current § Commands
section (`README.md:L98-L106`) only lists Command-Palette-invokable
commands; this entry should be listed separately since FR-9 excludes both
`openHere*` commands from the Command Palette entirely (`"when": "false"`).

**FR-9 (NFR).** Both commands are discoverable only from the Explorer
right-click context menu, not the Command Palette. **Resolved (OQ-1,
2026-08-07; PR #108, open, fetched 2026-08-07, § Key decisions):**
`package.json`'s `contributes.commands` entries for
**both** `claudeConductor.openHere` and `claudeConductor.openHereFromFile`
(FR-1) are each paired with an explicit `commandPalette` `"when": "false"`
menu clause:

```json
"commandPalette": [
  { "command": "claudeConductor.openHere", "when": "false" },
  { "command": "claudeConductor.openHereFromFile", "when": "false" }
]
```

This is VS Code's standard idiom for suppressing a context-menu-only
command from the Palette, applied to both command IDs — missing either one
would leave a bare, argument-less "Open Claude Here" entry visible in the
Palette, defeating the point. This is a deliberate departure from the
existing (arguably accidental) pattern of `claudeConductor.focusSession`,
`claudeConductor.closeSession`, and `claudeConductor.openInNewWindow`
(`package.json:L58-L71`), which remain technically Palette-listed today
because `package.json` has no `commandPalette` menu section suppressing
them (`package.json:L128-L208` — only `view/title` and `view/item/context`
exist) and instead rely on their `resolveSession(undefined) →
undefined` no-op guard (`src/extension.ts:L25-L39`, `L198-L210`). This spec
does not require retrofitting the suppression clause onto those three
existing commands — only the two new `openHere*` commands get the airtight
treatment; tightening the others is a separate, optional follow-up outside
this spec's scope.

## 3. Scope boundaries

**In scope:**
- New `claudeConductor.openHere` / `claudeConductor.openHereFromFile`
  command pair (FR-1), both wired to `explorer/context`, right-click only,
  both delegating to one shared implementation.
- Folder target (`claudeConductor.openHere`) → session rooted at that
  folder.
- File target (`claudeConductor.openHereFromFile`) → session rooted at the
  file's parent folder.
- Reuse of the existing `sessionManager.launchSession()` path, including
  `claudeConductor.reuseExistingTerminal` behavior.
- First-item-only handling when multiple Explorer items are selected.
- Tests for: folder target, file target (parent-folder resolution), Windows
  `.fsPath`-vs-`.path` divergence, multi-select ignoring the trailing
  selection argument, menu registration (including the
  `explorerResourceIsFolder` / `!explorerResourceIsFolder` when-clause
  split resolving to the correct command ID, FR-2/FR-6), the stat()-vs-
  invoked-command type-mismatch guard (FR-6), and Command Palette
  suppression for **both** command IDs (`commandPalette` `"when": "false"`,
  FR-9).
- `README.md` and `CHANGELOG.md` updates.

**Out of scope** (per `#107` (open, fetched 2026-08-07) § Out of Scope,
verbatim categories):
- Left-click-to-launch behavior on folders — right-click context menu only.
- Launching a session per item when multiple files/folders are
  multi-selected (no fan-out; see FR-7).
- Editor tab context menu entry.
- Command Palette entry as a *promoted, documented* entry point — FR-9
  additionally suppresses both `openHere*` commands from appearing there at
  all, via a `commandPalette` `"when": "false"` clause per command ID
  (OQ-1, resolved).

Not decided by this spec, deferred to implementation: exact `group` value
(e.g. `navigation` vs a custom group) and its ordering position within
`explorer/context`, and whether an icon is attached to the menu item.
Neither is called out in the Acceptance Criteria of `#107` (open, fetched
2026-08-07), and neither changes
observable command behavior — both are cosmetic menu-placement choices,
low-risk to leave to the implementer to decide against the shipped VS Code
menu at the time.

## 4. Risks

**Risk 1 — Windows `.fsPath` vs `.path` divergence.** The single most
concrete gotcha this spec's requirements are built around (FR-5). Risk: a
future edit accidentally routes this command's arg through
`resolvePathArg()` or otherwise reads `.path` instead of `.fsPath`,
silently reintroducing a Windows-only path bug. **Mitigation:** FR-5 keeps
the new command's arg resolution separate from `resolvePathArg()`, and § 2
Requirements calls for an explicit regression test asserting `.fsPath` is
read (not `.path`).

**Risk 2 — Stale target between right-click and invocation.** The file or
folder could be deleted, renamed, or made inaccessible in the interval
between the user right-clicking and VS Code firing the command (e.g. a slow
network share). `vscode.workspace.fs.stat(uri)` may reject. **Mitigation:**
FR-6 requires an error message and no `launchSession` call in that case,
rather than passing a stale or malformed path through to
`sessionManager.launchSession`, which has its own separate missing-path
guard (`src/sessionManager.ts:L100-L109`) for the case where `stat`
succeeds but the path later turns out to be gone.

**Risk 3 — Multi-select argument shape.** unverified: VS Code passes the
clicked resource as the first argument and the rest of the selection as a
second array argument for a multi-selected `explorer/context` invocation.
This convention is widely observed in third-party extensions but is not
pinned down by an authoritative VS Code doc page checked for this spec
(§ Verification note), and is not confirmed against this repo's VS Code
engine version (`^1.93.0`, `package.json:L8-L10`). An implementation that
assumes the wrong shape could throw on an unexpected argument or, worse,
silently iterate it and violate FR-7's "no per-item fan-out" requirement.
**Mitigation:** the implementation step (not this spec) should confirm the
actual argument shape empirically — e.g. logging `arguments` from a real
multi-select invocation — before relying on it.

## 5. Open questions

1. **Resolved** (OQ-1, 2026-08-07; PR #108, open, fetched 2026-08-07,
   § Key decisions): both `claudeConductor.openHere` and
   `claudeConductor.openHereFromFile` (FR-1) are explicitly excluded from
   the Command Palette via a `commandPalette` `"when": "false"` clause per
   command ID (see FR-9). The Out-of-Scope list of `#107` (open, fetched
   2026-08-07) named "command palette entry" as excluded, which was
   ambiguous between "don't promote/document it there" (satisfied by the
   existing sibling commands' no-op pattern) and "don't let it appear
   there at all" (needs the explicit `when: "false"` clause). Decided
   explicitly by the feature owner in favor of the stricter reading, to
   make the "Explorer pane only" scope airtight rather than rely on an
   accidental precedent set by other commands.
2. **Resolved** (OQ-2, 2026-08-07; PR #108, open, fetched 2026-08-07,
   § Key decisions): the `explorer/context` `when` clause
   uses `explorerResourceIsFolder` to select between **two different
   command IDs** (FR-1/FR-2) — `claudeConductor.openHere`
   (`"when": "explorerResourceIsFolder"`) and
   `claudeConductor.openHereFromFile` (`"when": "!explorerResourceIsFolder"`)
   — rather than one command ID with all file-vs-folder logic resolved
   purely inside a shared handler at runtime. This is load-bearing, not
   cosmetic: `contributes.menus` entries carry no field for passing extra
   context to the invoked command
   (https://code.visualstudio.com/api/references/contribution-points,
   fetched 2026-08-07, § Menus), so a distinct command ID per branch is the
   only way for the menu-render-time decision to reach the command handler
   at all — a single shared command ID with two complementary `when`
   entries would render correctly but tell the handler nothing about which
   branch fired. `vscode.workspace.fs.stat(uri)` (FR-6) is retained
   alongside this, demoted from primary type-detection to Risk 2's
   staleness/validity check, since the target can still be deleted, moved,
   or replaced between menu-render and command-invocation regardless of
   which command ID fired.
3. What `group` (and ordering) should the `explorer/context` menu clause
   use? Not blocking — deferred to implementation per § 3 Scope boundaries.

## Verification note

Repo claims in this document were read at commit `7fee18b`
(`git -C . rev-parse HEAD`, 2026-08-07) on `main`, including
`CLAUDE.md:L16-L18` — unchanged between `7fee18b` and this document's own
commit (`git -C . diff 7fee18b d446b9f -- CLAUDE.md`, empty, 2026-08-07).
`#107` was fetched via
`gh issue view 107 --repo glitchwerks/vscode-claude-conductor` on
2026-08-07 and is open. PR #108 (this pull request) was fetched via
`gh pr view 108 --repo glitchwerks/vscode-claude-conductor` on 2026-08-07
and is open; its "Key decisions" section in the PR body is the source
cited above (FR-2, FR-6, FR-9, § 5) for the OQ-1/OQ-2 resolutions.
`explorerResourceIsFolder` (FR-2) was confirmed via
https://code.visualstudio.com/api/references/when-clause-contexts (fetched
2026-08-07). The claim that `contributes.menus` entries carry no field for
passing extra data to the invoked command (FR-2, FR-6, OQ-2) was confirmed
via https://code.visualstudio.com/api/references/contribution-points
(fetched 2026-08-07, § Menus) during the OQ-1/OQ-2 resolution pass below.
The Risk 3 multi-select argument-shape claim remains `unverified:` — see
§ 4 Risk 3 for what was and wasn't checked. No repo tooling was
unavailable; `gh`, `git`, `Read`, and `Grep` were sufficient for every
other claim.

OQ-1 and OQ-2 were resolved on 2026-08-07 by explicit direction from the
feature owner as to which reading to take (Command Palette suppression;
when-clause-driven disambiguation) — recorded in PR #108 (open, fetched
2026-08-07) § Key decisions — and the concrete two-command-ID design for
OQ-2 was derived from the contribution-points citation above rather than
asserted without checking. unverified: the spec's status moved from DRAFT
to ACCEPTED at the same time; no intermediate DRAFT-status commit of this
file exists in this branch's history to verify the transition against.
