---
title: Default-grouping spawned session tabs into one dedicated pane
touches:
  - src/sessionManager.ts
  - test/mocks/vscode.ts
  - test/sessionManager.launchResult.test.ts
  - docs/README.md
skills_relevant:
  - simplicity-first
  - test-driven-development
---

# Default-grouping spawned session tabs into one dedicated pane

**Tracking issue:** [#110 "Spike: dedicated pane for spawned session tabs (default-group like Terminal panel)"](https://github.com/glitchwerks/vscode-claude-conductor/issues/110) — verified open, body fetched 2026-08-08. Issue #110 states its own boundary: *"Out of Scope: Implementing the fix — this issue is scoping/planning only."*
**Type:** scoping-decision
**Status:** UNDER REVIEW — not an implementation plan. Seven decision points (D1–D7) need user/expert answers, and a five-probe empirical gate (Phase 0) must return before D2/D4/D7 can be treated as final. **No code should be written from this document yet.** P4 in particular can change the problem statement, not just the mechanism.

**Prior inputs consumed (not re-derived):**
- `docs/research/2026-08-08-session-pane-grouping.md` — external prior art on `TerminalLocation`/`ViewColumn`/`tabGroups` and Anthropic's own Claude Code extension, including its 2026-08-08 addendum on `contributes.viewsContainers.secondarySidebar` (see § 6, ruled-out alternatives).
- An `Explore` map of this repo supplied in the planning brief; every claim it carried has been re-verified against the files cited below.

---

## 1. Problem

Conductor exercises **zero control** over which editor group a spawned session tab lands in. That much is verified from the code, and it is the durable statement of the defect:

- `launchSession` creates every session terminal with `vscode.window.createTerminal({name, cwd, iconPath, color})` and passes **no** `location` option (`src/sessionManager.ts:L120-L125`), so the terminal is born in the terminal *panel*.
- It is then unconditionally relocated with `terminal.show(true)` followed by `vscode.commands.executeCommand("workbench.action.terminal.moveToEditor")` (`src/sessionManager.ts:L127-L131`). That is a stock VS Code command, not Conductor code, and it accepts **no** column or group argument.

What #110 (open, body fetched 2026-08-08) asserts as the *observed* result is: *"each session lands as its own separate tab, never grouped."* **This document does not restate that as verified.** Reading the code cannot distinguish two very different readings of it:

- **Reading A** — `moveToEditor` splits, so each session gets its own editor *group*, and the window fills with N side-by-side panes.
- **Reading B** — `moveToEditor` lands the terminal in the *active* editor group, so session tabs interleave with whatever the user had focused: sometimes co-grouped with a previous session, sometimes dropped in among the user's source-file tabs, depending purely on where focus happened to be.

Reading B is the more likely one on the mechanics (`moveToEditor` acts on the active terminal and the active editor group), and it is a materially different complaint — "my Claude tabs are mixed in with my code" rather than "my window is full of panes." The recommended mechanism below is unchanged either way, but the success criterion is not, so this is resolved by **P4** before the spec is written, not assumed here.

The foundational spec (`docs/specs/2026-07-29-foundational-project-spec.md`
§ 1.3 "Why a plain terminal is not enough — the design commitment", `L61`:
*"The project's answer is to promote each Claude session from a panel
terminal to a first-class editor tab..."*) carries the project premise —
sessions as editor tabs — and is not restated.

---

## 2. Verified facts (foundation — checked, not recalled)

The VS Code API claims below were read from `node_modules/@types/vscode/index.d.ts`, which resolves from the `@types/vscode` `^1.93.0` devDependency (`package.json:L308`) against the declared engine `"vscode": "^1.93.0"` (`package.json:L8-L10`). All of it is **stable** API — the file is `@types/vscode`, not a `vscode.proposed.*.d.ts`.

### 2.1 `TerminalEditorLocationOptions` exists, is stable, and its `viewColumn` is required

`node_modules/@types/vscode/index.d.ts:L7767-L7784` defines:

```ts
export interface TerminalEditorLocationOptions {
	viewColumn: ViewColumn;
	preserveFocus?: boolean;
}
```

`viewColumn` is **not** optional. `TerminalOptions.location` accepts it (`index.d.ts:L12532-L12534`), so `createTerminal({..., location: {viewColumn}})` is available today and needs no engine bump.

### 2.2 The absolute-column footgun has a documented mechanism, not just an anecdote

The same doc comment (`index.d.ts:L7772-L7778`) states: *"The default is the {@link ViewColumn.Active active}. **Columns that do not exist will be created as needed up to the maximum of {@linkcode ViewColumn.Nine}.** Use {@linkcode ViewColumn.Beside} to open the editor to the side of the currently active one."*

That sentence *is* the bug reported in `anthropics/claude-code#83333`: computing an absolute column independently of what actually exists conjures the missing groups, producing stray empty panes. This document therefore has an API-level reason to forbid computed absolute columns (NFR3), not only a second-hand bug report. (The `#83333` report — https://github.com/anthropics/claude-code/issues/83333
— itself was not fetched by this document; it is sourced from
`docs/research/2026-08-08-session-pane-grouping.md:L63-L112` (§ Shortlist ›
candidate 1), which fetched it 2026-08-08.)

### 2.3 `ViewColumn` distinguishes symbolic from resolved values

`index.d.ts:L7343-L7392`: `Active = -1` and `Beside = -2` are *symbolic* and, per the doc comments at `L7345-L7355`, *"the resolved viewColumn-value of editors will always be `One`, `Two`, `Three`,... or `undefined` but never `Active`"* / *"never `Beside`"*. `One`–`Nine` are `1`–`9`. Symbolic values are safe to request; resolved values are safe only when read back from a group that exists.

### 2.4 `TabGroup` has **no identity** — only a positional `viewColumn`

`index.d.ts:L19372-L19404`: `TabGroup` exposes `isActive`, `viewColumn: ViewColumn`, `activeTab`, and `tabs: readonly Tab[]`. There is no `id`. `TabGroups` (`index.d.ts:L19406-L19449`) exposes `all`, `activeTabGroup`, `onDidChangeTabGroups`, `onDidChangeTabs`, and two `close()` overloads — and **nothing that moves an existing tab into a chosen group**, matching the gap the research doc found (`docs/research/2026-08-08-session-pane-grouping.md` § No prior art found, `L141-L144`).

Two consequences that drive D1 and D3:

1. Holding a `TabGroup` object across turns and diffing it against `onDidChangeTabGroups.closed` is the same reference-fragility class that already forced the `_pidToTerminal` workaround (`src/sessionManager.ts:L42-L49`). Don't hold the object.
2. `viewColumn` is **positional**: closing group One renumbers the survivors. So "a group still exists at my cached column N" is *not* evidence that group N is still Conductor's group — it may now be the user's code group. Validating by existence alone would silently start dropping session tabs into the user's files, which is exactly requirement 5 of the research brief (`docs/research/2026-08-08-session-pane-grouping.md:L35-L39`).

Also note `tabs` *"can be empty if the group has no tabs open"* (`index.d.ts:L19399-L19403`) — present-but-empty is a real state.

### 2.5 `TabInputTerminal` is stable but carries **no discriminating field**

This resolves open question 3 of the research doc, which originally flagged
it as unconfirmed and has since been updated in place to record this
resolution (`docs/research/2026-08-08-session-pane-grouping.md:L212-L226`).
`index.d.ts:L19279-L19287`:

```ts
export class TabInputTerminal {
	constructor();
}
```

A bare constructor. No `viewType`, no `uri`, nothing. Unlike `TabInputWebview` (`index.d.ts:L19222`), which Anthropic's extension can match on `viewType`, **an editor-area terminal tab cannot be attributed to Conductor from `Tab.input` alone** — the user's own manually-moved terminal and any other extension's editor terminal look identical.

The only other per-tab discriminator on the stable `Tab` interface (`index.d.ts:L19289-L19332`) is `label: string`. Conductor already owns a namespace there: `SESSION_NAME_PREFIX = "claude · "` (`src/sessionManager.ts:L10`), which `_isClaudeSession` already uses as its identity test (`src/sessionManager.ts:L260-L262`). Whether an editor-area terminal tab's `label` equals its `terminal.name` is **unverified** — that is P2.

### 2.6 `show(true)` today means "do not take focus"

`index.d.ts:L7735-L7740`: `Terminal.show(preserveFocus?: boolean)` — *"When `true` the terminal will not take focus."* So the launch path at `src/sessionManager.ts:L128` deliberately does **not** steal focus, while `focusSession` uses `show(false)` to take it (`src/sessionManager.ts:L193-L196`). `TerminalEditorLocationOptions.preserveFocus` is optional (`index.d.ts:L7780-L7783`); omitting it would silently change launch focus behaviour, so D4 must set it explicitly.

### 2.7 The reference-swap workaround is caused by the move, and is load-bearing today

`src/sessionManager.ts:L42-L49` documents the `_pidToTerminal` secondary index verbatim: *"When moveToEditor causes VS Code to swap terminal references, the new onDidCloseTerminal fires with a reference that isn't in `_sessions` by identity."* That swap is why `_handleTerminalClose` needs three tiers (`src/sessionManager.ts:L314-L389`), why `closeSession` re-resolves the live terminal by folder path before disposing (`src/sessionManager.ts:L198-L211`), and why `reconcile()` exists as a poll-based backstop for missed close events (`src/sessionManager.ts:L236-L257`).

### 2.8 No code path launches sessions in a loop — but concurrent launches are still reachable

Every `launchSession` call site launches exactly one folder per invocation: `src/quickPick.ts:L84`, `src/extension.ts:L104`, `src/extension.ts:L130` (fire-and-forget auto-launch after a window reload), `src/extension.ts:L202` (Explorer "Open Claude Here", #107), and `src/extension.ts:L216`. There is no fan-out over workspace folders.

However, `launchSession` awaits `_dispatchClaudeCommand`, which can take up to 2 s waiting for shell integration (`src/sessionManager.ts:L157-L180`) plus a configurable delay fallback (`src/sessionManager.ts:L186-L190`). VS Code does not serialize command invocations, so two quick user gestures produce two overlapping `launchSession` calls. That is the whole of D7's blast radius — narrow, but real.

### 2.9 The unit-test mock lacks both API surfaces this change needs

`test/mocks/vscode.ts` defines `TerminalLocation` (`test/mocks/vscode.ts:L130-L133`) and a `window.createTerminal` returning a fixed stub object (`test/mocks/vscode.ts:L212-L220`) with `commands.executeCommand` mocked (`test/mocks/vscode.ts:L271-L274`). It has **no** `ViewColumn` enum and **no** `window.tabGroups`. Both must be added before any of this is testable under the existing mocked harness (unit tests only, no VS Code instance — `CLAUDE.md § Build and test`).

---

## 3. Phase 0 — empirical gate

None of these are answerable by reading. They require a real VS Code instance with the extension loaded, and the existing `debugLog` plumbing (`src/sessionManager.ts:L276-L285`, `src/sessionManager.ts:L321`) is the instrument. **P4 gates the problem statement; P1 and P3 gate D4; P2 gates D1's fallback tier; P5 gates D7's mechanism.**

### P4 — What does `moveToEditor` actually do to editor groups today? **(gates § 1)**

Launch three sessions from a window that already has source files open in one group. Record, after each launch, `vscode.window.tabGroups.all.length`, each group's `viewColumn`, and each group's tab labels. Distinguishes Reading A from Reading B in § 1. If Reading B holds, the spec's success criterion becomes "session tabs never land in a group containing non-session tabs," which is a stronger and more testable statement than "sessions are grouped."

### P1 — Does an editor-born terminal still suffer the reference swap? **(gates D4, D5)**

Create a session via `createTerminal({..., location: {viewColumn: vscode.ViewColumn.Beside}})` and log whether `onDidCloseTerminal` fires with a reference that hits tier 1 (identity) in `_handleTerminalClose`, or falls through to tier 2/3 (`src/sessionManager.ts:L314-L389`). If tier 1 always hits, the swap documented at `src/sessionManager.ts:L42-L49` is an artefact of the move, not of editor-located terminals.

### P3 — Does an editor-born terminal actually *start*? **(gates D4 — highest risk to the recommendation)**

`unverified:` VS Code starts a terminal's process lazily on first render — no authoritative source found in `node_modules/@types/vscode/index.d.ts` (checked the `Terminal`, `TerminalOptions`, and `TerminalEditorLocationOptions` doc comments) or the public API reference during this pass; this premise is exactly what P3 exists to confirm empirically, not a settled fact this document asserts. For a terminal created with `location: {viewColumn}` **and no explicit `show()`**, verify all three:

1. Does `terminal.processId` resolve to a number? (If not, `_pidToTerminal` never populates — `src/sessionManager.ts:L295-L309`.)
2. Does `terminal.shellIntegration` become available via the fast or slow path (`src/sessionManager.ts:L151-L180`), or does the delay fallback (`src/sessionManager.ts:L186-L190`) fire on every launch?
3. Is an explicit `show()` still required to make either happen?

A failure here does not sink the feature — it sinks D4's option A, and the design falls back to D4 option B.

### P2 — Is `Tab.label` usable as Conductor's tab discriminator? **(gates D1 tier b)**

For a live editor-area session tab, does `Tab.label` equal the terminal name `claude · <folder>` (`src/sessionManager.ts:L10`)? Check it while the tab is open — the empty-name observation in the close path (`src/sessionManager.ts:L318-L319`) is a *close-time* phenomenon and says nothing about live labels. Also check what a user rename does to it.

### P5 — When does a newly created terminal's tab appear in `tabGroups.all`? **(gates D7)**

Immediately after `createTerminal({location:{viewColumn: Beside}})` returns, is the new tab already visible in `vscode.window.tabGroups.all` (so the resolved column can be cached synchronously, before the first `await`), or does it only appear after an `onDidChangeTabs` event? Determines whether D7 needs a promise-based in-flight guard or a one-line synchronous cache write.

---

## 4. Decision points

### D1 — How does Conductor recognise "its" editor group? ⚠️ **Confirmation needed**

**Options**

| Option | Consequence |
|---|---|
| (a) Tab-kind match on `TabInputTerminal` alone | **Broken.** Per § 2.5 the class has no discriminating field, so this also matches the user's own moved terminals and other extensions' editor terminals — it would route sessions into a group Conductor does not own. |
| (b) Marker / sentinel tab | Requires a tab the user must not close, and there is no stable API to make a tab unclosable. Trades one footgun for a new one. |
| (c) First-session-wins by remembered column number, validated by existence | Fails on group renumbering (§ 2.4 consequence 2) — silently redirects sessions into the user's code group. |
| (d) **Cache the resolved column number; validate by group *content* at every launch** | Recommended. See below. |

**Recommendation — (d), two tiers:**

- **Tier a (authoritative).** Cache a plain `number` (`_conductorViewColumn: number | undefined`) resolved from a group Conductor itself just created a session in. Never cache the `TabGroup` object (§ 2.4 consequence 1).
- **Tier b (re-derivation, on cache miss).** Scan `vscode.window.tabGroups.all` for a group containing a tab where `tab.input instanceof vscode.TabInputTerminal && tab.label.startsWith(SESSION_NAME_PREFIX)` (`src/sessionManager.ts:L10`). Needed because Conductor already reattaches to pre-existing session terminals on activation with no cache (`src/sessionManager.ts:L55-L59`).

**Then the single rule that makes this safe:** at *every* launch, before reusing the cached column, confirm that the group currently at that column still contains at least one tab matching tier b's predicate. Do not check mere existence.

That one rule subsumes three things that would otherwise be separate mechanisms: D3's "did the tracked group disappear" detection, the present-but-empty group state (`index.d.ts:L19399-L19403`), and the renumbering hazard. It is worth stating as a simplification, not three checks.

**If P2 fails** (labels unusable), tier b is dropped and the design degrades gracefully: the first session after a reload bootstraps a fresh group via D2, and subsequent sessions in that window group correctly off tier a. The feature still works; it just does not reattach to a pre-reload group.

### D2 — What happens when no Conductor group exists yet (first session of the window)? ⚠️ **Confirmation needed**

**Options**

| Option | Consequence |
|---|---|
| (a) `ViewColumn.Active` | This is the documented default (`index.d.ts:L7774`). It lands the first session tab **in the group the user's code is in** — i.e. it reproduces Reading B, the very complaint. |
| (b) **`ViewColumn.Beside`** | Symbolic, resolved by VS Code relative to the active group (`index.d.ts:L7351-L7355`), so it can never conjure an empty pane. Creates a fresh group beside the user's work, which is the requested UX. |
| (c) A computed absolute column | Forbidden by § 2.2 / NFR3. This is the `anthropics/claude-code#83333` bug. |

**Recommendation — (b) `ViewColumn.Beside`.** Matches the research doc's verdict (`docs/research/2026-08-08-session-pane-grouping.md` § Verdict, `L146-L171`) and, per § 2.2, has a type-level guarantee against the empty-pane failure.

**Known imperfection, accepted:** if tier a's cache is cold *and* tier b's re-derivation misses while a Conductor group really does exist, `Beside` produces a spurious extra group. That is a cosmetic degradation (an extra pane the user can drag-merge), never a stray *empty* pane and never a session dropped into the user's files. Compare option (c), whose failure mode is the empty pane. This asymmetry is the reason to prefer symbolic values even at the cost of an occasional redundant split.

### D3 — What happens when the tracked group disappears? ⚠️ **Confirmation needed**

**Options:** (a) subscribe to `onDidChangeTabGroups` and invalidate on close; (b) validate lazily at launch time; (c) persist the column across sessions in `globalState`.

**Recommendation — (b) as the mechanism, (a) as an optional optimisation, (c) rejected.**

- (b) is D1's content-validation rule, already required for the renumbering hazard. It is cheap (a synchronous `tabGroups.all` read), needs no event subscription, and is immune to a missed event. That last property matters here specifically: `reconcile()` exists (`src/sessionManager.ts:L236-L257`) *because* Conductor already got burned by a missed VS Code terminal event, and #68 (https://github.com/glitchwerks/vscode-claude-conductor/issues/68, open, body fetched 2026-08-08) is the still-open spike into that class of failure. Building the new feature on lazy validation rather than event correctness is learning from that, not ignoring it.
- (a) `onDidChangeTabGroups` / `onDidChangeTabs` (`index.d.ts:L19420-L19428`) can invalidate the cache eagerly, but must not be the *only* path. If added, invalidate by re-running validation, not by identity-comparing `TabGroup` objects (§ 2.4).
- (c) rejected: a column number is meaningless across window layouts, and persisting it recreates the "stale index" failure shape that `_pidToTerminal` and #68 already demonstrate.

Behaviour on invalidation: fall through to D1 tier b, then to D2. Same code path as a cold start.

### D4 — Replace the create-then-`moveToEditor` two-step, or layer on top of it? ⚠️ **Confirmation needed** — **the structural decision in this document**

**Option A — replace entirely.** `createTerminal({name, cwd, iconPath, color, location: {viewColumn: <resolved-or-Beside>, preserveFocus: true}})`, and delete both `terminal.show(true)` and the `moveToEditor` command call (`src/sessionManager.ts:L127-L131`).

Arguments for:
1. **It removes a real race.** `moveToEditor` operates on whatever terminal is *active*, not on a handle. `show(true)` then `executeCommand` (`src/sessionManager.ts:L127-L131`) is an await boundary during which the user or another extension can make a different terminal active — and the wrong terminal gets moved. Creating in the editor area addresses the terminal by construction.
2. **It is the only option that gives column control at all.** `moveToEditor` takes no argument. Layering means create → move → *repair* with `moveActiveEditor` by positional group index, which the research doc explicitly designates a fallback only (`docs/research/2026-08-08-session-pane-grouping.md` § Shortlist › candidate 3, `L123-L130`).
3. **It may remove the reference swap** documented at `src/sessionManager.ts:L42-L49` — **may**, pending P1.
4. `preserveFocus: true` reproduces today's non-focus-stealing behaviour exactly (§ 2.6).

**Option B — layer.** Keep `show(true)` + `moveToEditor`, then correct placement with `commands.executeCommand('moveActiveEditor', {to:'position', by:'group', value:N})`.

Arguments for: leaves the fragile close-detection surface untouched, so it does not perturb #68's reproduction baseline (see D6); it is the required fallback if P1 or P3 fails.

Arguments against: positional group index is fragile if the user has rearranged panes; it is a create-then-relocate flow, which is exactly the direction the research doc says has no stable support (`docs/research/2026-08-08-session-pane-grouping.md` § No prior art found, `L141-L144`); and it keeps the wrong-terminal race.

**Recommendation — Option A, gated on P1 and P3 both passing.** If P3 shows an editor-born terminal does not start its process (no `processId`, no shell integration) without an explicit `show()`, first try Option A **plus** a retained `show(true)` — that keeps the column control while restoring the render trigger. Only if that also fails does the design fall back to Option B.

### D5 — What happens to `_pidToTerminal` and the three-tier close detection? ⚠️ **Confirmation needed**

**Recommendation — change nothing about it in this work.**

If D4 Option A lands and P1 shows tier 1 (identity) always hits, then `_pidToTerminal` (`src/sessionManager.ts:L42-L49`) and tiers 2–3 (`src/sessionManager.ts:L314-L389`) become dead weight. But proving "always" requires the same hours-long reproduction that #68 is open to obtain, and deleting a safety net on the strength of a hypothesis is how #68 comes back in a harder-to-diagnose form. Concretely:

- **Do** add a `debugLog` marker recording which tier matched, so evidence accumulates in real use. The plumbing exists (`src/sessionManager.ts:L321-L328`).
- **Do not** remove `_pidToTerminal`, tiers 2–3, or `reconcile()`.
- **Do** record the possible simplification in the follow-up issue (§ 9) so it is not lost.

So the honest answer to "does this reduce or complicate the machinery": it plausibly makes it *removable*, and does not complicate it — but the removal is a separate, evidence-gated change, not part of this one.

### D6 — Sequencing against #68 ⚠️ **Confirmation needed**

Issue #68 (https://github.com/glitchwerks/vscode-claude-conductor/issues/68, open, labels `bug` + `pathfinding`, body fetched 2026-08-08) is a spike into why editor-tab-X close detection fails on long-running sessions. Its hypothesis 1 is *"`_pidToTerminal` index drift: PID recorded once but terminal reference can be swapped"* and hypothesis 3 is *"identity drift over time."* Both are consequences of the very `moveToEditor` reference swap that D4 Option A removes. Its acceptance criteria require a written diagnosis and *"note if root cause invalidates PR #47/#48 design assumptions."*

**Two routes, and this is a call for the user, not a gate this document imposes:**

- **Route 1 — replace, sequenced after #68.** Land #68's diagnostic logging and its written diagnosis first, then implement #110 (D4 Option A), then re-run #68's reproduction as a regression check. Preserves #68's baseline and avoids "accidentally fixing" #68 without ever learning the root cause. Cost: #68 needs hours-long reproductions, so this could be weeks of calendar time.
- **Route 2 — layer, ship now.** Take D4 Option B. It leaves `moveToEditor` and the swap intact, so #110 and #68 are genuinely decoupled and can proceed in parallel. Cost: accepts the positional-index fragility and keeps the wrong-terminal race.

**Recommendation — Route 1.** The two issues touch the same seam, and #110's own out-of-scope line already gives the schedule room ("scoping/planning only"). But if #68's reproduction stalls, Route 2 is a legitimate way to ship the user-visible improvement without waiting.

### D7 — Concurrent launches racing the bootstrap ⚠️ **Confirmation needed** — *added by this document; not among #110's listed criteria*

Per § 2.8, two quick user gestures produce overlapping `launchSession` calls. Both can find a cold cache, both pass `ViewColumn.Beside`, and two groups appear instead of one.

**Options:** (a) do nothing and accept it; (b) cache the resolved column synchronously immediately after `createTerminal` returns, before the first `await`; (c) an in-flight promise guard — the first cold launch stores a pending promise for the resolved column; a second cold launch awaits it instead of bootstrapping.

**Recommendation — (b) if P5 shows the tab is in `tabGroups.all` synchronously; otherwise (c).** (c) is correct regardless of P5's answer, so it is the safe default if P5 is inconclusive. Not (a): the failure is user-visible (two panes) and the fix is small.

---

## 5. Requirements (draft — needs user confirmation)

### Functional

- **FR1** — When a Conductor session group already exists in the window, a newly launched session's tab lands in **that** group, as an additional tab, not as a new split.
- **FR2** — When no Conductor session group exists, the new session's tab lands in a group that contains no non-session tabs, created without producing any empty editor group.
- **FR3** — A session tab must never land in an editor group that contains tabs Conductor did not create. *(Testability of this depends on P4's reading; under Reading B it is the primary success criterion.)*
- **FR4** — Native drag-out of a session tab into its own area, and drag-back-in, continue to work unmodified. No group locking.
- **FR5** — When the tracked group is closed, emptied of session tabs, or renumbered, the next launch re-detects or re-bootstraps per D1/D3 rather than reusing a stale column.
- **FR6** — Behaviour is correct after a window reload or extension reactivation, where Conductor reattaches to pre-existing session terminals with no in-memory cache (`src/sessionManager.ts:L55-L59`).
- **FR7** — No regression in session tracking: `_sessions` population, sidebar rows, `focusSession` (`src/sessionManager.ts:L193-L196`), `closeSession` (`src/sessionManager.ts:L198-L211`), close detection (`src/sessionManager.ts:L314-L389`), and `reconcile()` (`src/sessionManager.ts:L236-L257`) all behave as they do today.
- **FR8** — Two launches issued in quick succession from a cold cache produce one group, not two (D7).

### Non-functional

- **NFR1** — Stable public API only. No proposed API; no engine bump beyond `"vscode": "^1.93.0"` (`package.json:L8-L10`).
- **NFR2** — `workbench.action.lockEditorGroup` must not be used. It breaks native drag/drop for the user's *unrelated* files — reported at `anthropics/claude-code#18337` (https://github.com/anthropics/claude-code/issues/18337, state CLOSED, re-confirmed via `gh issue view` fetched 2026-08-14); not fetched by this document, sourced from `docs/research/2026-08-08-session-pane-grouping.md:L104-L111` (fetched 2026-08-08).
- **NFR3** — No `ViewColumn` value may be requested unless it was either symbolic (`Active`/`Beside`) or read back from a group present in `tabGroups.all`. Rationale is type-level, not anecdotal: § 2.2.
- **NFR4** — No existing tab of the user's is moved, closed, or reordered by this feature.
- **NFR5** — Launch focus behaviour is unchanged: the session tab appears without stealing focus, matching `show(true)` today (§ 2.6). Achieved via `preserveFocus: true`.
- **NFR6** — Covered by the existing mocked-`vscode` unit harness. Requires adding a `ViewColumn` enum and a `window.tabGroups` stub (with `all`, `activeTabGroup`, `onDidChangeTabGroups`, `onDidChangeTabs`) plus a `TabInputTerminal` class to `test/mocks/vscode.ts` (§ 2.9), and making `window.createTerminal` record the `location` argument it was passed (`test/mocks/vscode.ts:L212-L220`).

---

## 6. Scope boundaries

**In scope**

- Choosing the group-identification, bootstrap, and invalidation strategy (D1–D3).
- Deciding whether to replace or layer the create-then-move two-step (D4).
- Deciding the interaction with the close-detection machinery (D5) and the #68 sequencing (D6).
- The concurrency decision this document surfaced (D7).
- The Phase 0 probe list (§ 3).

**Out of scope**

- **Implementing any of it.** #110 is scoping only, by its own statement. Implementation needs a `feature-spec` in `docs/specs/` first (per `CLAUDE.md § Spec-Driven Development`, `L11`, `L18`: *"adds or removes a user-visible feature, command, setting, keybinding, or UI surface"* requires a spec — this is a user-visible behaviour change) and a follow-up issue (§ 9).
- **Any change to sidebar tree grouping.** `groupByProjectRoot` (`src/projectGrouping.ts:L99`) and the three `TreeDataProvider` implementations that consume it — `ActiveSessionsProvider` (`src/treeView.ts:L80-L81`), `RecentProjectsProvider` (`src/treeView.ts:L214-L215`), `FavoritesProvider` (`src/treeView.ts:L316`) — are sidebar-list grouping, a different mechanism from editor-group placement. #110 lists this out of scope explicitly and this document does not touch it.
- **Removing `_pidToTerminal` or the three-tier close detection.** Deferred to a follow-up gated on #68's diagnosis (D5).
- **Migrating sessions from terminals to webview panels.** The research doc covers webviews (`docs/research/2026-08-08-session-pane-grouping.md` § Shortlist › candidate 4, `L132-L139`) because the survey was written before the tab kind was settled; Conductor's sessions are terminals and stay terminals here.
- **A declarative `contributes.viewsContainers` panel.** Ruled out by the research doc (`docs/research/2026-08-08-session-pane-grouping.md` § Shortlist › candidate 4, `L132-L139`): a panel container hosts a fixed, `package.json`-declared view set, not a dynamically growing draggable tab strip. Conductor contributes exactly one Activity Bar container with three declared views (`package.json:L111-L134`); nothing in that mechanism produces Terminal-panel-like per-instance tabs.
- **A declarative `contributes.viewsContainers.secondarySidebar` container.** A follow-up check for #110's scoping found a third `viewsContainers` location, `secondarySidebar`, targeting the Secondary Side Bar / auxiliary bar (where GitHub Copilot Chat lives) — it is stable, shipped (`microsoft/vscode` PR https://github.com/microsoft/vscode/pull/261619 `#261619`, state MERGED, merged 2025-08-25, re-confirmed via `gh pr view` fetched 2026-08-14), and unguarded by any proposed-API check, so an extension can default a view container there at install time with no user drag needed. Recorded as the same structural dead end as the panel bullet above, not a live option: it is exactly as fixed/declarative as `panel` — a `package.json`-declared view set, not a runtime API to spawn a new, individually-draggable tab. It does not change the D1–D4 recommendation. Full sourcing (PR #261619, the `viewsExtensionPoint.ts` blob sha, fetch date) is in `docs/research/2026-08-08-session-pane-grouping.md`, "Addendum (2026-08-08)" section; not re-derived here.
- **Any post-hoc relocation of already-open session tabs.** No stable API exists (§ 2.4). Existing tabs stay where they are; only new tabs are steered. If the user wants existing tabs gathered, that is separate design work on the `moveActiveEditor` fallback.

---

## 7. Risks

| Risk | What would have to be true |
|---|---|
| Editor-born terminals never start their process, so `processId` never resolves and shell integration never activates — breaking both the PID index and the fast dispatch path. | `unverified:` VS Code defers terminal process start until first render, and `unverified:` `location: {viewColumn}` without `show()` does not render — no authoritative source found in the installed `@types/vscode` declarations or the public API reference during this pass. **This is the single largest threat to D4 Option A.** P3 answers it; the escape hatch is Option A + retained `show()`, then Option B. |
| Sessions get routed into the user's code group after a pane reshuffle. | Validation checks column existence instead of group *content* (§ 2.4). D1's content rule is what prevents this; it must not be simplified away during implementation. |
| Stray empty editor groups appear. | An absolute column is computed rather than read from `tabGroups.all` (§ 2.2 / NFR3). |
| Native drag-out silently stops working. | `lockEditorGroup` gets introduced later as a "defence" for the group (NFR2). |
| Changing the launch path reopens or masks #68. | D4 Option A alters the exact surface #68's hypotheses 1 and 3 name. Mitigated by D6 Route 1 sequencing and by not touching the close-detection tiers (D5). |
| The problem statement is wrong, so the feature ships without fixing the user's actual complaint. | Reading A vs Reading B (§ 1) is never resolved. P4 exists for this and should run first. |
| Tests pass while real behaviour is broken. | The mock's `tabGroups` stub encodes the author's mental model of VS Code's grouping rather than observed behaviour. Phase 0's probes are the only real evidence; unit tests verify Conductor's *decision logic* given a group topology, not VS Code's response to it. State this limit in the follow-up spec. |

---

## 8. Open questions requiring user or expert input

1. ⚠️ **Confirmation needed** — D6: Route 1 (replace, after #68) or Route 2 (layer, ship now)? This is the scheduling question with the largest consequence.
2. ⚠️ **Confirmation needed** — D4: Option A or Option B, assuming P1/P3 pass?
3. ⚠️ **Confirmation needed** — Under Reading B (§ 1), is the desired behaviour "one dedicated group for all sessions" or the weaker "sessions never share a group with non-session tabs"? These differ when the user has deliberately dragged one session out: does the *next* launch join the remaining group, or the dragged-out one?
4. ⚠️ **Confirmation needed** — Should the Conductor group be reused across *window reloads* if P2 shows labels are usable, or is a fresh group per window acceptable (dropping D1 tier b entirely, which is meaningfully simpler)?
5. ⚠️ **Confirmation needed** — Is a user-facing setting wanted (e.g. `claudeConductor.groupSessionTabs`), or is the new behaviour unconditional? Unconditional is simpler; a setting is the conventional escape hatch for a placement change users may have adapted to. This affects `package.json`'s configuration block and is not currently in `touches:`.
6. Who runs Phase 0? The probes need a live VS Code instance with the extension loaded, which this planning pass could not do (§ Verification note).

---

## 9. Proposed follow-up issues

Not created — `CLAUDE.md § Issue Tracking` requires explicit confirmation before work begins, and this document is a recommendation.

1. **Phase 0 probes P1–P5** (`pathfinding`) — run the five probes in § 3 and post the results as a comment on #110. Blocks everything else. Suggest running P4 first and reporting it separately, since it can change the spec's problem statement.
2. **Feature spec for session-tab default grouping** — a `docs/specs/2026-XX-XX-session-tab-default-grouping.md` `feature-spec`, written once D1–D7 are answered and Phase 0 has returned. Required by `CLAUDE.md § Spec-Driven Development`: this is a user-visible behaviour change.
3. **Implement default grouping** — gated on 1 and 2, and on D6's answer.
4. **Evidence-gated simplification of close detection** (`tech-debt`) — if P1 and post-ship telemetry show tier 1 always hits, remove `_pidToTerminal` and tiers 2–3. Explicitly blocked on #68's diagnosis (D5).

A milestone grouping 1–3 would be appropriate; 4 belongs with #68's follow-ups instead.

---

## Verification note

- **Repo claims** were read at commit `c65db06` (`main`, the checkout's `HEAD` at planning time), from `src/sessionManager.ts`, `src/extension.ts`, `src/quickPick.ts`, `package.json`, `test/mocks/vscode.ts`, `docs/README.md`, and `docs/sdd-workflow.md`.
- **VS Code API claims** were read from `node_modules/@types/vscode/index.d.ts`, resolved from `@types/vscode` `^1.93.0` (`package.json:L308`). Line numbers are stable for that installed version and should be re-checked after a dependency bump. This resolved the research doc's open question 3, which originally flagged it as unconfirmed and has since been updated in place to record the resolution (`docs/research/2026-08-08-session-pane-grouping.md:L212-L226`): `TabInputTerminal` **is** stable — and, more usefully, carries no discriminating field (§ 2.5).
- **GitHub claims**: #110 and #68 (https://github.com/glitchwerks/vscode-claude-conductor/issues/68) were fetched via `WebFetch` on 2026-08-08 and their titles, states, and bodies read directly. The `mcp__github__*` tools and a shell were not available to this planning pass, so `gh`-based verification (labels via API, cross-referencing PRs #47/#48) was not performed; #68's labels and milestone come from the fetched issue page.
- **External claims not independently fetched**: `anthropics/claude-code#83333` (https://github.com/anthropics/claude-code/issues/83333, state OPEN as re-confirmed via `gh issue view` fetched 2026-08-14), `anthropics/claude-code#18337` (https://github.com/anthropics/claude-code/issues/18337, state CLOSED as re-confirmed via `gh issue view` fetched 2026-08-14), and `microsoft/vscode#145830` (https://github.com/microsoft/vscode/issues/145830) were not fetched by this document. They are cited via `docs/research/2026-08-08-session-pane-grouping.md`, which fetched all three on 2026-08-08. Where possible the underlying claim was re-grounded in the type definitions instead — see § 2.2, which replaces the `#83333` anecdote with the `TerminalEditorLocationOptions` doc comment as the authority for NFR3.
- **Not verified — requires a running VS Code instance:** everything in § 3. In particular the § 1 problem statement is deliberately left as two readings rather than asserted, because P4 was not runnable here.
- **Not verified:** no tests were run and no code was compiled; this pass wrote no code.
