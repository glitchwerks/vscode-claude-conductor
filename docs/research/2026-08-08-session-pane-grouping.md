---
title: Grouping spawned Claude session tabs into one dedicated pane by default
status: complete
date: 2026-08-08
---

## Idea

Make spawned Claude Code session tabs (currently `vscode.window.createTerminal`
instances, some moved to editor tabs) collect into one dedicated tab group by
default — mirroring how VS Code's built-in Terminal panel groups all terminal
tabs together — while still letting a user drag an individual session tab out
into its own separate editor group, exactly as the built-in Terminal panel
already allows.

## Requirements

1. An extension must be able to make its own spawned tabs open into **one
   shared, pre-existing tab group by default**, not always split into a new
   group beside the previous one.
2. The grouping must not prevent the user from doing VS Code's native
   drag-tab-out-of-group / drag-tab-back-in gesture on an individual session
   tab — that native gesture must keep working, unmodified, for the target
   content type (terminal or webview).
3. The solution must use **public, stable Extension API** — not a proposed
   API that can't ship to the Marketplace, and not an internal/first-party-only
   capability.
4. Applies to both of Conductor's current/likely tab kinds: terminals
   (`vscode.window.createTerminal` with `location: TerminalLocation.Editor`)
   and, if considered, webview panels (`vscode.window.createWebviewPanel`).
5. Must not silently break unrelated user tabs/groups (a documented failure
   mode — see Anthropic's own Claude Code extension, ranked #1 below) — a
   candidate that "solves" grouping by locking the editor group or by
   computing an absolute `ViewColumn` is a deal-breaker if it does so with
   side effects on the user's other files.

## Search axes used

- **Direct synonyms** — `TerminalLocation`, `TerminalEditorLocationOptions`,
  `ViewColumn`, `vscode.window.tabGroups`, `TabGroup`/`Tab` API.
- **Problem-shape synonyms** — "open editor in existing group not beside",
  "editor group locking", "move tab to existing group", "determine view
  location via API".
- **Adjacent domains** — extensions that manage many concurrent
  webview/terminal instances of their own content (AI chat/agent extensions,
  terminal-loader extensions, GitLab's dual webview/panel split).
- **Vendor-specific phrasing** — `microsoft/vscode` issue tracker and
  `code.visualstudio.com/api` contribution-points / vscode-api reference
  pages; the `vscode.d.ts` / `vscode.proposed.*.d.ts` type definitions.
- **Negative axes** — declarative `contributes.viewsContainers` /
  `contributes.views` (fixed, package.json-declared view sets — a
  structurally different mechanism from a dynamic, arbitrary-count tab strip)
  and first-party-only internal grouping (the Terminal panel's own
  implementation, which is not built on any API surface exposed to
  extensions).

## Shortlist (ranked by expected value)

### 1. Anthropic's own Claude Code VS Code extension — `tabGroups.all.find()` + reused `ViewColumn`, with a documented footgun

- **URL:** https://github.com/anthropics/claude-code/issues/83333 (opened, open as of fetch; fetched 2026-08-08); related: https://github.com/anthropics/claude-code/issues/18337 (fetched 2026-08-08)
- **Relevance:** addresses requirement 1 directly and requirement 4 (webview panels) — this is the closest possible prior art, because it is the *same* problem (many Claude session panels, group them) solved by a sibling Anthropic extension, on public API only. Does not fully address requirement 5 — see below.
- **Maturity:** issue #83333 filed against extension "v2.1.220"; unresolved as of the fetch date; no merged fix referenced in the issue body.
- **Worth borrowing:** the pattern extracted from the minified `extension.js` in the issue body (quoted verbatim in the issue) is:
  ```js
  createPanel(e, t, r) {
    let n = false, i;
    if (r !== undefined) { i = r; }
    else {
      i = vscode.ViewColumn.Beside;                       // default: relative split
      let a = vscode.window.tabGroups.all.find(/* match own webview group */);
      if (a && a.viewColumn) i = a.viewColumn;             // reuse existing group's column
      else { i = this.findUnusedColumn(); n = true; }      // BUG lives here
    }
  }
  ```
  The reusable idea: call `vscode.window.tabGroups.all` (stable API), find a
  group whose tabs are your own tab kind (a `Tab` whose `input` is a
  `TabInputWebview` with a matching `viewType`, or a `TabInputTerminal` for
  terminal-editor tabs — `from training, not checked`: the issue's minified
  code does not expose the exact matcher predicate), and reuse that group's
  `viewColumn` instead of always requesting `ViewColumn.Beside`. Because
  `viewColumn` here is a real resolved column (`One`/`Two`/`Three`…, not the
  symbolic `Beside`), a fresh tab opened with that column lands as a **new
  tab inside the same group** rather than splitting — which is exactly the
  "group by default" behavior requested. Native drag-out/drag-back-in is
  unaffected because nothing about VS Code's own tab-group mechanics is
  overridden; the extension is only choosing where a *new* tab lands.
- **What to avoid:** two documented failure modes, both worth avoiding
  explicitly:
  1. The bug in #83333 — falling back to `findUnusedColumn()` (which returns
     an *absolute* column number) instead of the *symbolic* `ViewColumn.Beside`
     when no existing group is found yet. Mixing absolute and symbolic
     column semantics is what produces the reported stray empty editor
     group.
  2. The separate, confirmed pattern in #18337 — using
     `workbench.action.lockEditorGroup` (a built-in *command*, invoked via
     `vscode.commands.executeCommand`, not a typed API) to keep the group
     "theirs." Locking a group is global to that group: it also blocks the
     **user's own** subsequently-opened files from landing there, forcing
     unwanted splits for unrelated work. This directly violates requirement
     5 and is the reason a "just lock the group" implementation is a
     deal-breaker, not a shortcut.
- **Lift effort:** adapt-pattern — the `tabGroups.all.find()` + reuse-existing-`viewColumn` idea is a small, self-contained pattern to reimplement (with the absolute-column bug fixed), not a dependency to pull in (the extension is closed-source; only the pattern is visible via the issue's quoted minified snippet).

### 2. `vscode.window.tabGroups` stable API (groups discovery) + `ViewColumn` reuse — the underlying primitive, documented directly by Microsoft

- **URL:** https://code.visualstudio.com/api/references/vscode-api (fetched 2026-08-08, `TabGroups`/`TabGroup`/`Tab` section); type source: `microsoft/vscode` `src/vscode-dts/vscode.d.ts` on `main` (fetched 2026-08-08, exact line range not resolved — the file exceeded the fetch tool's summarization window; see Open questions)
- **Relevance:** addresses requirement 1 (read/enumerate existing groups) and requirement 3 (this surface is stable, not proposed — confirmed by its presence in `vscode.d.ts` on `main` rather than any `vscode.proposed.*.d.ts` file, and by its use in shipped, Marketplace-published extensions). Does not address requirement 2 on its own — see the gap noted in the "No prior art found" section: the stable API has no `move`-into-a-specific-group primitive for cross-group placement; `tabGroups` is read-oriented (`groups`, `activeTabGroup`, `onDidChangeTabGroups`, `close()`), confirmed by https://github.com/microsoft/vscode/issues/145830 (fetched 2026-08-08) discussing (and closing `wont-fix`) a request to extend the *existing* `move` capability to accept multiple tabs at once — implying today's `move`-adjacent surface is narrow and was deliberately not broadened.
- **Maturity:** `tabGroups` shipped stable years ago (referenced fixes as far back as `microsoft/vscode#131595`, closed 2021, milestone September 2021); actively maintained repo, Microsoft-owned, MIT license.
- **Worth borrowing:** the read-side API (`tabGroups.all`, `Tab.input` discrimination via `TabInputWebview`/`TabInputTerminal`/`TabInputText`, `Tab.group.viewColumn`) is the correct, stable building block for "does a Conductor group already exist, and what's its viewColumn" — this is the same primitive candidate #1 uses.
- **What to avoid:** don't rely on `TabGroups` for *moving* an already-open tab into a target group after the fact — that direction of the API is either absent or, per `microsoft/vscode#133532` ("Tab model API", fetched 2026-08-08), was proposed with `move()` on `Tab` but the issue thread does not confirm this shipped as described; treat any tab-to-tab-group move capability as `unverified:` until confirmed against the current `vscode.d.ts`.
- **Lift effort:** drop-in (it's a stable API surface, not a library) — but the "join an existing group" trick still requires writing the same `find`-and-reuse-`viewColumn` logic as candidate #1; there is no single call that does it.

### 3. `moveActiveEditor` built-in command — positional group targeting via `executeCommand`, not a typed API

- **URL:** https://code.visualstudio.com/api/references/commands (fetched 2026-08-08)
- **Relevance:** partially addresses requirement 1 as a fallback/repair mechanism (move the *currently active* editor to a specific group by index/direction after it has already opened in the wrong place) — `commands.executeCommand('moveActiveEditor', { to: 'position', by: 'group', value: N })`. Does not address requirement 2/5 cleanly: it targets groups by *positional index*, which is not a stable identifier if the user has rearranged panes, and it operates on "the active editor," requiring you to first `reveal()`/focus the tab you want moved.
- **Maturity:** long-standing built-in command, part of core VS Code, not extension-contributed; stable.
- **Worth borrowing:** as a corrective nudge (move a just-opened tab that landed in the wrong group into the Conductor group by group index) if the `viewColumn`-reuse approach in candidates #1/#2 ever mis-targets — a fallback, not a primary mechanism.
- **What to avoid:** don't use positional group index as the *primary* way to find "the Conductor group" — it's fragile versus the `tabGroups.all` + tab-kind-matching approach in candidate #1/#2.
- **Lift effort:** drop-in (single `executeCommand` call) as a supplementary repair step only.

### 4. Declarative `contributes.viewsContainers` (panel location) — structurally the wrong mechanism, included to close off a plausible-looking alternative

- **URL:** https://code.visualstudio.com/api/references/contribution-points (fetched 2026-08-08, `contributes.viewsContainers` / `contributes.views` sections)
- **Relevance:** does not address requirement 1 as the user likely imagines it. `viewsContainers` targeting `panel` lets an extension add a container *next to* the built-in Terminal/Output/Problems panel tabs, but the views inside it are a **fixed, package.json-declared set** (each with a stable `id`), populated dynamically only in *content* (via `TreeDataProvider` or `WebviewViewProvider`) — not a free-form, arbitrarily-growing, individually-closable, drag-reorderable tab strip the way the Terminal panel's per-terminal tabs work. Confirmed by the contribution-points doc's phrasing that view containers "into which views can be contributed" are declared statically; there is no documented API to register a new view *instance* at runtime the way `createTerminal`/`createWebviewPanel` register a new *tab* at runtime.
- **Maturity:** stable, long-standing contribution point (tracked from `microsoft/vscode#43645`, fetched 2026-08-08, "Ability to contribute views containers").
- **Worth borrowing:** nothing directly — flagged so the implementer doesn't spend time prototyping a views-container approach expecting Terminal-panel-like dynamic tabs and discover the mismatch late.
- **What to avoid:** treating "panel view container" as equivalent to "a pane that hosts N dynamically-created, independently draggable tabs." It is not; that specific multi-instance, drag-reorderable tab-strip behavior is what the Terminal panel does internally and is not exposed as a general-purpose contribution mechanism.
- **Lift effort:** study-only (rule it out, don't build on it).

## No prior art found

- **A stable API to move an already-open tab into a specific pre-existing tab group by group identity (not positional index, not "the active editor").** Searched axes: direct (`TabGroups.move`, `Tab.move`), problem-shape (`microsoft/vscode#145830`, `#133532`, `#188572`), vendor (`vscode.d.ts` on `main`). No candidate provides this; every real-world implementation found (candidate #1) works around the gap by influencing *where a new tab opens* (via `viewColumn` reuse) rather than moving an existing tab after the fact. The implementer should expect to rely exclusively on "choose the right `viewColumn`/`location` at creation time," not "create then relocate."
- **A documented, extension-facing equivalent of the Terminal panel's own internal tab-group management.** Searched: `microsoft/vscode#142909` (determine view location via API, closed `not planned`), `#131196` (locked editor groups test), Extension API guidelines wiki. No issue or doc confirms the Terminal panel's grouping/drag behavior is built on any surface available to third-party extensions; it appears to be first-party/internal. Implementer should not expect to literally reuse the Terminal panel's mechanism — only to approximate its effect via `ViewColumn` reuse (candidate #1/#2).

## Verdict

**Partially achievable via public API — with a known gap and a known footgun, both already hit by a sibling Anthropic extension solving the identical problem.**

- The "collect new tabs into one shared pane by default" half is achievable
  today, on stable API, by tracking the Conductor group's `viewColumn` (found
  via `vscode.window.tabGroups.all` and matching on tab kind/`viewType`) and
  passing that resolved `viewColumn` — not the symbolic `ViewColumn.Beside`
  — into subsequent `createTerminal({ location: { viewColumn } })` or
  `createWebviewPanel(..., viewColumn, ...)` calls. This is exactly what
  Anthropic's own Claude Code VS Code extension does today (candidate #1).
- The "user can still drag one out, and drag it back in" half requires **no
  extra work** — it is native VS Code tab-group behavior, unaffected by
  choosing a `viewColumn` at creation time, as long as the implementation
  does **not** reach for `workbench.action.lockEditorGroup` to defend the
  group (candidate #1's second footgun, `microsoft/vscode` issue referenced
  via `anthropics/claude-code#18337`) — locking breaks native drag/drop
  expectations for the user's *other* files, not just Conductor's own tabs.
- The gap: there is no stable API to *relocate* an already-open tab into a
  specific existing group after the fact by group identity — only to
  influence where a *new* tab opens. If Conductor ever needs to correct a
  mis-placed tab post-hoc (e.g., the "no existing group yet" fallback path),
  it has to use either `ViewColumn.Beside` (symbolic, safe) or the
  `moveActiveEditor` command with a positional group index (fragile, but
  functional) — never an absolute `ViewColumn` number computed independently
  of `tabGroups.all`, which is precisely the bug in `anthropics/claude-code#83333`.

## Recommended handoff

- `project-planner` — candidate #1's pattern (`tabGroups.all.find()` on tab
  kind/`viewType`, reuse the found group's `viewColumn`, fall back to
  `ViewColumn.Beside` — never an independently-computed absolute column) is
  the concrete mechanism to design Conductor's default-grouping behavior
  around, whether Conductor's sessions stay as `TerminalLocation.Editor`
  terminals or move to `createWebviewPanel`. The planner should also decide
  whether editor-group locking is ever appropriate (this report's finding is
  that it is not, given requirement 5, but that is a design call for the
  planner/spec, not this report).
- `user` — for the "no prior art found" gap (no stable move-into-existing-group
  API): confirm whether Conductor needs post-hoc relocation at all, or
  whether "choose the right `viewColumn` at creation time" fully covers the
  intended UX. If post-hoc correction is required, that's original design
  work layered on the `moveActiveEditor` command fallback (candidate #3).

## Open questions

- The exact predicate Anthropic's Claude Code extension uses inside
  `tabGroups.all.find(...)` to recognize "a group that already contains one
  of my own tabs" was not visible — the issue #83333 body quotes the
  surrounding logic but elides the `find()` callback itself. `from training,
  not checked`: the natural implementation is matching `tab.input instanceof
  vscode.TabInputWebview && tab.input.viewType === <own viewType>` (or
  `TabInputTerminal` for editor-located terminals), but this specific
  callback body was not confirmed against source — the extension is closed-
  source and only the minified snippet in the issue is public.
- The full stable `vscode.d.ts` `TabGroups`/`TabGroup`/`Tab` interface text
  could not be fetched verbatim in this session — the file is large enough
  that the fetch tool's summarization pass did not reach the tabs section
  before truncating (attempted against `raw.githubusercontent.com/microsoft/
  vscode/main/src/vscode-dts/vscode.d.ts`, fetched 2026-08-08, truncated
  before the relevant interfaces). The properties/methods cited above
  (`groups`, `activeTabGroup`, `onDidChangeTabGroups`, `close()`) are
  corroborated across the official vscode-api reference page and multiple
  GitHub issues discussing the same surface, but a verbatim source-of-truth
  read of the current type definitions is still worth doing before
  implementation starts.
- Whether `TabInputTerminal` (as opposed to `TabInputWebview`/`TabInputText`)
  is part of the *stable* `vscode.d.ts` today, versus only `vscode.proposed.
  *.d.ts`, was not conclusively confirmed in this session (see candidate #2).
  Since Conductor's current tabs are terminals moved to editor location, this
  should be checked directly against the installed `@types/vscode` version's
  `.d.ts` before relying on `TabInputTerminal` for tab-kind matching.

## Addendum (2026-08-08) — Secondary Side Bar contribution point supersedes part of candidate #4

A follow-up check (issue #110 scoping) asked specifically about the
Secondary Side Bar / auxiliary bar, not just `activitybar`/`panel`. This
updates candidate #4's "negative axis" framing above: **a third `viewsContainers`
location, `secondarySidebar`, does exist and is unguarded (stable, not behind
`enabledApiProposals`)** — the public docs page had not caught up as of this
fetch, so this addendum exists to correct that gap for this repo's records.

- **Schema is live on `main`.** `src/vs/workbench/api/browser/viewsExtensionPoint.ts`
  (fetched 2026-08-08 via `mcp__github__get_file_contents`,
  `owner=microsoft repo=vscode path=src/vs/workbench/api/browser/viewsExtensionPoint.ts ref=main`,
  blob sha `833787070f347cb64a12b781b6a27eb0f63da94c`) defines
  `viewsContainersContribution` with three sibling properties —
  `activitybar`, `panel`, `secondarySidebar` — each `{id, title, icon}[]`,
  and `ViewsExtensionHandler.addCustomViewContainers()` switches
  `case 'secondarySidebar':` to `this.registerCustomViewContainers(..., ViewContainerLocation.AuxiliaryBar)`.
  Unlike the `remote` and `agentSessions` *view* keys in the same file (which
  are gated behind `isProposedApiEnabled(extension.description, 'contribViewsRemote' | 'chatSessionsProvider')`),
  the `secondarySidebar` *container* key has no such gate — it is reachable
  by any extension's `package.json` today, no proposed-API opt-in required.
- **Shipped, not merely proposed.** PR https://github.com/microsoft/vscode/pull/261619
  (fetched 2026-08-08) closes issue https://github.com/microsoft/vscode/issues/151681
  (opened 2022-06-10 by Eric Amodio requesting exactly this for GitLens; fetched
  2026-08-08) and merged to `main` 2025-08-25 (commit `03baef1`, August 2025
  milestone) — renaming `auxiliaryBar` to `secondarySidebar` in the schema per
  reviewer feedback on naming. Test-plan issue
  https://github.com/microsoft/vscode/issues/264346 (opened 2025-09-01,
  fetched 2026-08-08) covers verifying multi-container registration, hide/
  unhide, drag-to-primary-sidebar, and the default active container — framed
  there as validating a feature already merged, not as an open proposal.
  The official docs page `code.visualstudio.com/api/references/contribution-points`
  (fetched 2026-08-08) still describes only `activitybar` and `panel` — the
  docs lag the shipped schema; do not treat that page as authoritative for
  this specific question.
- **Same structural shape as candidate #4, not a different mechanism.** A
  `secondarySidebar` container is exactly as fixed/declarative as `panel`:
  `contributes.viewsContainers.secondarySidebar` in `package.json` declares
  the container at extension-load time; `contributes.views.<containerId>`
  then declares a **fixed set** of views inside it, each backed by a
  `TreeDataProvider` or a single `WebviewViewProvider`
  (`viewsExtensionPoint.ts`, `viewDescriptor.type` enum `tree`/`webview`).
  There is no runtime API to spawn a new, arbitrary-count, individually-
  draggable tab into that container the way `createTerminal`/
  `createWebviewPanel` spawn a new editor tab — the same limitation already
  identified for `panel` in candidate #4 above applies unchanged to
  `secondarySidebar`.
- **No API places content there without a package.json declaration.**
  `createWebviewPanel`/`ViewColumn` targets editor groups only; there is no
  API to programmatically default a webview into the Secondary Side Bar at
  runtime the way `TerminalLocation`/`ViewColumn` picks an editor placement.
  The container must be declared in `package.json` up front.
- **GitHub Copilot Chat's own right-side presence is privileged, not
  extension-facing.** `src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts`
  (`mcp__github__search_code`, fetched 2026-08-08) registers Chat's view
  container directly against the internal `IViewContainersRegistry` with
  `ViewContainerLocation.AuxiliaryBar` — the same internal call the
  `secondarySidebar` extension-point handler makes on an extension's behalf,
  but invoked directly in first-party workbench source rather than through
  the declarative `contributes.viewsContainers` JSON contribution point.
  Ordinary (marketplace) extensions cannot call `IViewContainersRegistry`
  directly; `contributes.viewsContainers.secondarySidebar` is the equivalent
  surface actually exposed to them, and per the point above it now reaches
  the identical internal registration call.

**Verdict for the follow-up question:** achievable, not merely
user-relocatable — an ordinary extension can default a view container into
the Secondary Side Bar via `contributes.viewsContainers.secondarySidebar` +
`contributes.views`, on stable (non-proposed) API, without the user dragging
anything there first. It does **not** unlock a dynamically-created,
individually-draggable multi-tab strip inside that container — that
capability gap from candidate #4 (declarative, fixed view set; no
runtime-spawn API) is unchanged by this addendum.
