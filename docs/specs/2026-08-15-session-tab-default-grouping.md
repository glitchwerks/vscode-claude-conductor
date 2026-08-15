---
title: Session-tab default grouping — replace the moveToEditor two-step
touches:
  - src/sessionManager.ts
  - test/mocks/vscode.ts
  - test/sessionManager.grouping.test.ts
  - test/sessionManager.closeDetection.test.ts
  - test/sessionManager.debugLog.test.ts
  - test/sessionManager.uncPosix.test.ts
  - test/sessionManager.launchResult.test.ts
  - docs/README.md
  - docs/plans/2026-08-08-session-pane-grouping.md
skills_relevant:
  - simplicity-first
  - test-driven-development
---

# Session-tab default grouping — replace the moveToEditor two-step

**Tracking issue:** [#127 "Implement session-tab default grouping (D4 Option A) — replace moveToEditor two-step"](https://github.com/glitchwerks/vscode-claude-conductor/issues/127) — verified open, body fetched 2026-08-15.
**Type:** feature-spec
**Status:** DRAFT — Rev 4; all design questions resolved, blocked only on the owner running the § 2.5 probe session (**P-LABEL**, P6, P-PLACE, P-REVEAL) per the § 2.5.1 runbook before implementation starts.

**Revision history** *(this block and § 5 are additions to the spec template at `docs/sdd-workflow.md:L156-L182`, which lists Problem / Requirements / Scope boundaries / Risks / Open questions / Verification note. Both are surfaced as **OQ-10** rather than adopted silently; § 5 was introduced by Rev 1 and is retained here for continuity, not re-justified.)*

| Rev | Date | What changed |
|---|---|---|
| 1 | 2026-08-15 | First draft. Validation predicate was "every tab in the group is a `TabInputTerminal`". |
| 2 | 2026-08-15 | Two review passes (`project-reviewer`, `codex-reviewer`) found the Rev 1 predicate does not enforce FR3. The validation predicate was replaced with a **provenance ledger** of `Tab` objects fed by timed `onDidChangeTabs` arrival windows; FR3 was split into a strict half and a best-effort half; a three-probe gate (P6–P8) was added. |
| 3 | 2026-08-15 | **The ownership mechanism is removed, not repaired.** A second `codex-reviewer` pass broke Rev 2 on the same root cause that broke Rev 1: the stable Tab API exposes no creator identity, so a foreign terminal arriving inside an armed window is misattributed and then reads as permanently safe (CRITICAL); slot starvation does not self-heal in one bootstrap under longer late-arrival chains (HIGH); `Beside` containment can re-contaminate the same user group on every subsequent cold launch, not once (HIGH); 5 of 26 tests were unreachable or contradicted the pseudocode (HIGH). Rev 3 abandons ownership *proof* for a **stateless best-effort placement heuristic** — on every launch, count Conductor-labelled tabs per group and join the group with the most (§ 2.4.1). Consequences: FR3 is restated as an honest best-effort placement rule (§ 2.3); D1 and D7 are **superseded**, not amended (§ 2.1, OQ-2, OQ-3); the ledger, arrival windows, slot accounting, `BOOTSTRAP_TIMEOUT_MS`, `ARRIVAL_WINDOW_MS`, the `onDidChangeTabs` subscription and every added instance field are deleted; the three-probe gate collapses to **one** (§ 2.5); the risk profile in § 4 and the test plan in § 5 are rewritten. |
| 4 | 2026-08-15 | **Decisions closed; no mechanism change.** The repo owner answered OQ-1 – OQ-9 directly in conversation on 2026-08-15 (§ 6): the mechanism stands as Rev 3 wrote it, D1 and D7 stay superseded, D4's redefined gate is accepted, **OQ-4 resolves to always-on with no setting** (so `src/config.ts` and `package.json` drop out of `touches:` and out of § 3, per OQ-4 option (b)'s own stated consequence), and **OQ-5 resolves to (a)+(c)** — keep `Beside` unconditionally, defer any fallback to a follow-up gated on P6 *and* a real user report. A `project-reviewer` pass over Rev 3 returned 0 BLOCKING / 2 CONCERN / 3 NIT; the two CONCERNs were empirical gaps, not design defects, and are folded into the same probe session as **P-PLACE** (the warm-case *write* side: does `location: {viewColumn: N}` land the tab in group N?) and **P-REVEAL** (does `focusSession` still reveal an editor-born tab?). Both are informative — **P-LABEL remains the sole hard gate.** § 2.5.1 is new: a step-by-step probe runbook the owner can execute unassisted. Two Rev 3 characterisations are corrected against the now-verbatim #110 Phase 0 comment (§ 2.2, § 2.2.1, § 4, Verification note). |

**Prior inputs consumed (not re-derived):**
- `docs/plans/2026-08-08-session-pane-grouping.md` — the #110 scoping decision. Its decision points D2–D6 are confirmed and carried; **D1 and D7 are superseded by this revision and are flagged as confirmation-needed** (§ 2.1). **Its `src/` and `test/` line citations are stale** (e.g. it cites the `createTerminal` mock at `test/mocks/vscode.ts:L212-L220`; the actual range read for this document is `L216-L224`). Every file:line citation below was re-read for this revision.
- `docs/research/2026-08-08-session-pane-grouping.md` — external prior art on `TerminalLocation` / `ViewColumn` / `tabGroups`. Cited explicitly where relied on, per `docs/sdd-workflow.md:L39-L41`.
- Two `codex-reviewer` passes over Rev 1 and Rev 2, and one `project-reviewer` pass over Rev 1. Their findings are recorded where they changed the design, not summarised as a block.
- The design in § 2.4.1 was proposed by the repo owner in direct conversation on 2026-08-15, together with the reasoning in § 2.3 for why strict enforcement is unachievable. That reasoning is reproduced at the requirement rather than attributed and hidden.

---

## 1. Problem

Conductor exercises no control over which editor group a spawned session tab lands in, and Phase 0 probe **P4** established what that actually costs the user.

Today `launchSession` creates the session terminal with no `location` option (`src/sessionManager.ts:L120-L125`), so it is born in the terminal *panel*, and is then relocated by a two-step — `terminal.show(true)` (`src/sessionManager.ts:L128`) followed by `vscode.commands.executeCommand("workbench.action.terminal.moveToEditor")` (`src/sessionManager.ts:L131`). That stock command accepts no column or group argument.

**P4 resolved the two competing readings** the scoping plan left open (`docs/plans/2026-08-08-session-pane-grouping.md:L32-L37`). Reported on #110 (comment [`5274827716`](https://github.com/glitchwerks/vscode-claude-conductor/issues/110#issuecomment-5274827716), 2026-08-13, fetched 2026-08-15): `tabGroups.all.length` stayed at `1` across sequential launches — `moveToEditor` does **not** split off a new group per session; it lands the terminal in the **active** editor group, interleaving session tabs with whatever the user had open.

So the defect is *"my Claude tabs are mixed in with my code"*, not *"my window fills with panes."*

**What success can and cannot mean here.** Rev 1 and Rev 2 both turned that defect into a *safety guarantee* — "a session tab must never land in a group holding tabs Conductor did not create" — and both failed to enforce it, for the same structural reason (§ 2.2). Rev 3 does not restate the goal as a guarantee. The achievable target is: **session tabs congregate.** Wherever the user's Conductor tabs already are, the next one joins them; if the user moves them, the next one follows the move. That is weaker than "never mixed with your code" and it is honest about the one case it cannot prevent — a first-ever launch into an occupied side group — which the user can then correct once, by dragging, after which the heuristic follows them (§ 2.3, § 2.4.3). A reviewer can check that rule against the pseudocode in § 2.4.1 and the tests in § 5.2; nobody can check a guarantee the API cannot support.

The project premise (sessions as first-class editor tabs) lives in the foundational spec, `docs/specs/2026-07-29-foundational-project-spec.md` § 1.3, and is not restated here.

---

## 2. Requirements

### 2.1 Decisions carried in from #110, and the two this revision supersedes

Five of the seven scoping decisions are confirmed and carried. **D1 and D7 are superseded by § 2.4** — not amended, not reinterpreted: Rev 3 removed their premise. Both were originally confirmed by the user on #110, so neither could be overturned by this document alone; **Rev 4 records that the repo owner confirmed both supersessions directly on 2026-08-15** (OQ-2, OQ-3), so they are now settled rather than pending.

| # | Decision | Confirmed | Disposition (Rev 3 mechanism, Rev 4 confirmations) |
|---|---|---|---|
| D1 | Cache the **resolved `viewColumn` as a plain number**; validate by group **content**, never by mere existence; never hold a `TabGroup` object. | [#110 comment `5247626767`](https://github.com/glitchwerks/vscode-claude-conductor/issues/110#issuecomment-5247626767), 2026-08-11 (fetched 2026-08-15) | **SUPERSEDED — settled.** Confirmed by the repo owner on 2026-08-15 (OQ-2, answered): no caching, no validation, the stateless per-launch query stands, and D1 does not come back. Rev 3 caches nothing. There is no `_conductorViewColumn`, so there is nothing to validate and nothing to invalidate; the column is recomputed from `tabGroups.all` on each launch (§ 2.4.1). D1's *spirit* — never hold a `TabGroup` reference, never trust a stale number — is satisfied more completely by holding no state at all than by validating held state. |
| D2 | First launch of a window (cold cache) uses **`ViewColumn.Beside`**. | [#110 comment `5300114215`](https://github.com/glitchwerks/vscode-claude-conductor/issues/110#issuecomment-5300114215), 2026-08-15 | **Carried**, for the empty-state case only (FR2). The hazard Rev 2 surfaced is unchanged and unresolved — see § 2.4.3 and OQ-5. |
| D3 | **Lazy validation at launch** is the mechanism. `onDidChangeTabGroups` is an optional eager-invalidation layer only, never the sole path. `globalState` persistence rejected. | [#110 comment `5302105363`](https://github.com/glitchwerks/vscode-claude-conductor/issues/110#issuecomment-5302105363), 2026-08-15 | **Carried, and satisfied by construction.** "Lazy, at launch" is now the *whole* mechanism: a fresh synchronous query at launch time with nothing cached between launches. No event subscription of any kind is required (§ 2.4.5). |
| D4 | **Option A** — replace the create-then-`moveToEditor` two-step with a single `createTerminal({..., location: {viewColumn, preserveFocus: true}})` call. | [#110 comment `5302164531`](https://github.com/glitchwerks/vscode-claude-conductor/issues/110#issuecomment-5302164531), 2026-08-15 | **Carried, unchanged — gate redefinition now accepted.** Its empirical gate was **redefined, not met as written** (§ 2.2.1). The redefinition — `processId` resolving is necessary *and* sufficient; `shellIntegration` timing is a monitored risk, not a gate — was confirmed by the repo owner on 2026-08-15 (OQ-6, answered). **No longer-window `shellIntegration` retest is required before implementation.** |
| D5 | **Explicit non-change**: `_pidToTerminal` and the three-tier close detection stay exactly as they are. | `docs/plans/2026-08-08-session-pane-grouping.md:L229-L239` | **Carried, unchanged.** Its role in § 4 remains: regression containment, not a mitigation for D6's baseline loss. The same-commit comment corrections in § 2.7 still apply. |
| D6 | **Ship now**, not sequenced after #68. | Same comment as D4, [`5302164531`](https://github.com/glitchwerks/vscode-claude-conductor/issues/110#issuecomment-5302164531), 2026-08-15; cross-linked on #68 at [comment `5302165123`](https://github.com/glitchwerks/vscode-claude-conductor/issues/68#issuecomment-5302165123) | **Carried, unchanged.** § 4 states its cost honestly (baseline loss is accepted, not offset). |
| D7 | **In-flight promise guard** (option (c)) for concurrent cold launches. | Resolved by probe P5, [#110 comment `5274827716`](https://github.com/glitchwerks/vscode-claude-conductor/issues/110#issuecomment-5274827716), 2026-08-13 | **SUPERSEDED — settled.** Confirmed by the repo owner on 2026-08-15 (OQ-3, answered): the guard stays dropped, and the § 2.4.4 re-derivation is accepted as sufficient. The race D7 guarded is a property of the *asynchronous bootstrap* Rev 3 deletes. Under synchronous querying the warm case has no race at all, and the only residual (two truly-simultaneous launches from a fully cold window) can only be closed by re-adding the async machinery this revision exists to remove. Derivation in § 2.4.4 — this is a re-derivation, not an assumption that the guard became unnecessary. |

**D6 is a third route, not one of the plan's two.** The plan offered Route 1 (Option A, sequenced after #68) and Route 2 (Option B, ship now) — `docs/plans/2026-08-08-session-pane-grouping.md:L247-L250`. The confirmed decision is **Option A, ship now**, which appears on neither line of that menu. This is deliberate and is recorded as a risk in § 4, not an oversight.

### 2.2 Why two ownership mechanisms failed, and what Rev 3 does instead

**The stable Tab API exposes no creator or owner identity, and that is the whole story.** `Tab` carries `label`, `group`, `input`, `isActive`, `isDirty`, `isPinned`, `isPreview` and nothing else (`node_modules/@types/vscode/index.d.ts:L19294-L19332`). `TabInputTerminal` is a bare marker class with a zero-argument constructor and no fields (`index.d.ts:L19282-L19287`), so tab *kind* carries zero identity. There is no `Terminal` → `Tab` mapping anywhere in the namespace. Both were re-read for this revision.

Two mechanisms have now been tried against that constraint and both broke on it:

- **Rev 1 — tab-kind matching** ("every tab in the group is a `TabInputTerminal`"). Broken: any terminal passes, so a user's own editor terminal made the group validate forever. `docs/plans/2026-08-08-session-pane-grouping.md:L165` had already rejected this option in those words.
- **Rev 2 — a temporal-arrival provenance ledger.** Broken on the same root cause one level down: with no identity field, "arrived while we were expecting one" is the only available proxy for "is ours", and a foreign terminal that opens inside an armed window satisfies it. Once adopted, the ledger reports that group as permanently ours (CRITICAL, second review pass). The dependent findings — slot starvation not self-healing under longer late-arrival chains, repeat `Beside` contamination of the same user group, five untestable test cases — all descend from the same attempt to synthesise identity out of timing.

**Rev 3 stops trying to prove ownership.** The reasoning that makes this the right call rather than a retreat is in § 2.3 and belongs to the requirement, not to the mechanism: *even a perfect ownership signal cannot deliver a strict placement guarantee, because nothing prevents the user from dragging a session tab into a code group afterwards.* A mechanism that proves ownership at creation time buys nothing that survives the next drag. So the target changes from proof to **best-effort placement, re-evaluated fresh on every launch** (§ 2.4.1).

**What Phase 0 still constrains, and what it no longer constrains.** Both figures below are from [#110 comment `5274827716`](https://github.com/glitchwerks/vscode-claude-conductor/issues/110#issuecomment-5274827716) (2026-08-13, fetched 2026-08-15):

- **P5 — the new tab is not in `tabGroups.all` synchronously** (~777 ms, via `onDidChangeTabs`). Under Rev 2 this was load-bearing and forced the whole async bootstrap. **Under Rev 3 it is inert.** The placement decision never reads the tab being created; it reads only tabs that settled during earlier launches. A tab that is invisible for 777 ms is simply not counted for 777 ms, and the only case where that matters is two launches issued inside the same window (§ 2.4.4).
- **P2 — `Tab.label` read at launch time came back empty** (`activeTab.label === ""` on 3 of 3 launches sampled, while `terminal.name` reliably read `claude · <folder>`). Rev 3 **sidesteps the timing half of this entirely** — it never reads a tab's label at the instant that tab is created — but it does **not** sidestep the existence half, and § 2.5 is about exactly that.

  **Rev 4 correction — the same comment already answers P2's own follow-up question, for one creation path.** P2 asked, and left open, *"does the label populate a tick later, or stay empty indefinitely?"* The **P4** block in that same comment answers it in its raw log, which Rev 3 read only for `tabGroups.all.length` and did not mine for labels. P4's per-launch dumps enumerate the group's tab labels, and the tabs created by *earlier* launches in that same window read back with the exact expected string — after launch 3 the group reads `tabs=["powershell","llm_job_parser.py (Working Tree)","claude · job-matcher-pr","claude · career-ops",""]`, where the trailing `""` is the just-created tab and the two `claude · <folder>` entries are settled tabs from launches 1 and 2. So `Tab.label` **does** settle to exactly `Terminal.name`, and `startsWith(SESSION_NAME_PREFIX)` would have matched both. This is a substantial de-risking of the mechanism-killing risk in § 4.

  **It does not dissolve the P-LABEL gate, and the reason is precise:** every tab in that sample was **`moveToEditor`-born** — created in the panel and relocated by the two-step this spec deletes (§ 2.4.6). D4 makes tabs **editor-born**, via `location: {viewColumn}`, on a creation path that produced no label sample in Phase 0. **That creation-path delta is the entire residual P-LABEL case (a) still has to close** — not "do labels populate at all", which is now answered, but "do they populate the same way for a tab that was never in the panel." The gate is narrower than Rev 3 stated it, and still load-bearing.

#### 2.2.1 D4's empirical gate was redefined, not passed — stated plainly, and the redefinition is now accepted

*(Carried from Rev 2; the mechanism swap does not touch it. **Rev 4 adds the owner's acceptance of the redefinition (OQ-6) and one detail the verbatim P1 block supplies that Rev 3 under-used.**)*

`docs/plans/2026-08-08-session-pane-grouping.md:L227` gates Option A on "**P1 and P3 both passing**." Against the reported results:

- **P1** showed tier-1 (identity) match on 4 of 4 sampled closes. **Of those four, two were already editor-born** — created with `location: {viewColumn}` and no `moveToEditor`, on P3's path — and both still hit tier 1, with zero fallthrough to tier 2/3 and zero reference swaps observed. That is a directly relevant sample for D4 rather than an inference from the panel path, and Rev 3 cited only the aggregate. It is still not the proof the plan asked for — the plan itself says proving "always" needs the hours-long reproduction that #68 is open to obtain (`docs/plans/2026-08-08-session-pane-grouping.md:L233-L234`) — and it does not change D5, which stays an explicit non-change.
- **P3** had three sub-checks (`docs/plans/2026-08-08-session-pane-grouping.md:L139-L144`). `processId` resolved — the sub-check that would have been fatal, since it is what populates `_pidToTerminal` (`src/sessionManager.ts:L299-L309`). `shellIntegration` timing was **inconsistent across the two runs sampled**, so that sub-check neither passed nor failed.

**This spec proceeds on a redefined gate:** `processId` resolving is treated as the necessary and sufficient condition for D4 Option A, with `shellIntegration` degradation reclassified from a gate to a monitored risk covered by the existing dispatch ladder (`src/sessionManager.ts:L151-L155` fast path, `L157-L180` slow path, `L186-L190` delay fallback). The ladder exists precisely for shells where integration never activates. This was a redefinition of a confirmed gate rather than a passed one, so it was raised as OQ-6 — **and the repo owner accepted it explicitly on 2026-08-15**. `processId` resolved immediately in both P3 runs with no `show()` call, which is the sub-check that would have been fatal; `shellIntegration` timing is now tracked as a § 4 risk and a § 5.3 post-ship signal (`[dispatch] delay fallback` firing more often than before), **not** as a retest that blocks implementation. **No longer-window P3 retest is required before this ships.**

### 2.3 Functional requirements

- **FR1 — placement rule.** On each launch, Conductor counts, for every group in `vscode.window.tabGroups.all`, how many of its tabs are Conductor-labelled (§ 2.4.2), and creates the session terminal in the group with the **most** such tabs. Ties resolve to the **lowest `viewColumn`**. The count is taken synchronously at launch time from the live tab model; nothing is cached between launches.
- **FR2 — empty state.** When no group holds any Conductor-labelled tab, the session is created with `ViewColumn.Beside` (D2), producing no empty editor group.
- **FR3 — the honest form of "don't mix my sessions with my code."** *(best-effort, not a guarantee)* On each launch, place the session tab in the editor group containing the most Conductor-owned tabs (by label prefix), falling back to a new group if none qualifies. **This is evaluated fresh per launch and is not sticky against manual tab moves** — a user who drags tabs around changes what "most Conductor-owned" means for the *next* launch, which is the intended and only achievable behaviour, not a bug.

  > **Why best-effort is the target, not a compromise.** Rev 1 and Rev 2 both stated FR3 as a safety property — "must never land in a group holding foreign tabs" — and neither could enforce it (§ 2.2). But the deeper reason to stop trying is not implementation difficulty: **even a perfect ownership signal cannot deliver the strict form, because nothing stops the user from dragging a session tab into a code group after it lands.** Any association tracked at creation time is invalidated by the next drag, so a strict guarantee is unachievable on the stable API regardless of implementation cleverness. Given that, the right target is the achievable one — and it has a property the strict form does not: **it is user-correctable.** If a session ever lands somewhere unwanted, the user drags the session tabs where they want them, and from the next launch on the heuristic follows them. A strict mechanism, had one existed, would have fought that.

- **FR4** — Native drag-out of a session tab into its own area, and drag-back-in, continue to work unmodified. No group locking (NFR2).
- **FR5 — staleness is structurally impossible.** A group that has been closed, emptied, renumbered, or repopulated is simply enumerated as it currently is on the next launch. There is no cached column to go stale, no invalidation path to get wrong, and positional renumbering (closing group One renumbers the survivors) cannot produce a wrong answer because every column used is read off a live group in the same synchronous pass.
- **FR6 — after a window reload, sessions re-congregate if — and only if — surviving tabs still carry the label.** Conductor holds no state across a reload, so behaviour is decided entirely by what the tab model reports: if editor-hosted terminal tabs survive the reload and their labels still read `claude · …`, the first post-reload launch joins them with no special handling. If they do not survive, or their labels do not read back, the first launch bootstraps a fresh group. **This is a strict improvement over Rev 2**, which guaranteed a second group after every reload because its ledger was empty; but it is conditional on § 2.5 P-LABEL case (b), and it is not asserted here as fact.
- **FR7** — No regression in session tracking: `_sessions` population (`src/sessionManager.ts:L287-L293`), the PID index (`L299-L309`), `focusSession` (`L194-L196`), `closeSession` (`L199-L211`), three-tier close detection (`L320-L389`), and `reconcile()` (`L236-L257`) behave exactly as they do today.
- **FR8 — concurrent launches.** Two launches issued in quick succession place identically whenever any Conductor-labelled tab already exists, because both read the same pre-existing counts and the ~777 ms invisibility of the in-flight tab cannot change them. From a **fully cold** window the two may produce two groups; this is accepted, converges on subsequent launches, and is derived rather than assumed in § 2.4.4.
- **FR9** — The reuse branch is untouched: when `claudeConductor.reuseExistingTerminal` is on (default `true`, `package.json:L247-L251`) and a session for the folder already exists, `launchSession` returns via `focusSession` (`src/sessionManager.ts:L111-L117`) and runs **no** grouping logic at all — in particular it does not read `tabGroups`.
- **FR10** — `terminal.show(true)` and the `workbench.action.terminal.moveToEditor` command call are removed from the launch path (`src/sessionManager.ts:L127-L131`). `focusSession`'s `show(false)` (`L195`) is retained unmodified — see § 5.3 for the caveat about what changes underneath it.
- **FR11 — the decision is a pure function of the live tab model.** `SessionManager` gains **no** new instance fields, **no** timers, and **no** new event subscriptions. Given the same `tabGroups.all` contents, `_resolveTargetColumn()` returns the same column on every call, in any order, at any time. This is a checkable requirement: a reviewer can confirm it by reading the diff, and § 5.2 test 16 asserts it directly.

### 2.4 Design — the whole mechanism

Everything below is two private methods on `SessionManager` (`src/sessionManager.ts`) plus four lines in `launchSession`. There is no state to place anywhere, which makes D3's "no `globalState` persistence" (`docs/plans/2026-08-08-session-pane-grouping.md:L205`) and the per-window scoping question both moot.

#### 2.4.1 The placement algorithm

```ts
/**
 * Best-effort placement (FR1/FR3): the editor group holding the most
 * Conductor-labelled tabs. Ties resolve to the lowest viewColumn so that
 * repeated launches against an unchanged topology are deterministic.
 * Returns undefined when no group holds any — the caller requests Beside.
 */
private _resolveTargetColumn(): number | undefined {
  let bestColumn: number | undefined;
  let bestCount = 0;

  for (const group of vscode.window.tabGroups.all) {          // index.d.ts:L19409-L19413
    let count = 0;
    for (const tab of group.tabs) {                           // index.d.ts:L19399-L19403
      if (this._isConductorTab(tab)) count++;
    }
    if (count === 0) continue;
    if (bestColumn === undefined
        || count > bestCount
        || (count === bestCount && group.viewColumn < bestColumn)) {   // index.d.ts:L19386-L19389
      bestCount = count;
      bestColumn = group.viewColumn;
    }
  }

  debugLog(`[group:resolve] column=${bestColumn ?? "beside"} count=${bestCount} groups=${vscode.window.tabGroups.all.length}`);
  return bestColumn;
}
```

Four properties of this that are requirements, not incidental:

1. **Majority, not first-found.** "The first group containing a Conductor tab" would let one dragged-out tab in a low-numbered group capture every future session. Counting makes a single stray tab lose to the group where the sessions actually live.
2. **The tie-break is specified.** With equal counts, `tabGroups.all` iteration order decides — and nothing documents that order as stable across reads (`index.d.ts:L19409-L19413` says only "All the groups within the group container"). An unspecified tie-break is a real thrash risk: alternating placements would split the sessions further with every launch, worsening the tie. `viewColumn` is a total order over live groups, so lowest-column-wins is deterministic and self-stabilising — the winner gains a tab, the tie breaks, and subsequent launches follow it.
3. **The count is a `number` read off a live group.** Never `Active`, never `Beside`: resolved `viewColumn` values are always `One`–`Nine` or `undefined` (`index.d.ts:L7344-L7355` — *"the resolved viewColumn-value of editors will always be `One`, `Two`, `Three`,… or `undefined` but never `Beside`"*). This satisfies NFR3 **by construction** rather than by discipline.
4. **Groups with zero Conductor tabs are skipped, never chosen.** Conductor never proposes a column it has no positive reason to pick.

**Cost.** One pass over `tabGroups.all`, one `startsWith` per tab, once per non-reuse launch — a user-gesture-frequency operation over a collection bounded by the tabs a human has open. No polling, no subscription, no allocation beyond the loop. This is called out because "query cost with many groups/tabs" was raised as a candidate risk; at this frequency and this bound it is not one, and § 4 says so rather than carrying a risk row that reads as real.

#### 2.4.2 The discriminator — and what it is not

```ts
/**
 * Heuristic (§ 2.3): a tab is treated as Conductor's when it is a terminal tab
 * in the editor area whose label carries the session-name prefix. This is the
 * only signal the stable Tab API offers — see the spec for what it does not prove.
 */
private _isConductorTab(tab: vscode.Tab): boolean {
  return tab.input instanceof vscode.TabInputTerminal            // index.d.ts:L19282-L19287
      && tab.label.startsWith(SESSION_NAME_PREFIX);              // src/sessionManager.ts:L10
}
```

`SESSION_NAME_PREFIX` is `"claude · "` (`src/sessionManager.ts:L10`). It is already the discriminator Conductor uses for terminals — `_isClaudeSession` is `terminal.name.startsWith(SESSION_NAME_PREFIX)` (`src/sessionManager.ts:L260-L262`) — so this is the same identification rule applied to a different object, not a new invention.

**The `TabInputTerminal` conjunct is a narrowing filter, not a discriminator.** It excludes a text file literally named `claude · something` from being counted, which is worth having for free. **It does not substitute for the label check, and must never be allowed to** — a predicate that tests kind alone is exactly the Rev 1 defect, and a reader skimming this pseudocode is one deletion away from reintroducing it. The label is doing all of the identification work here.

**What this predicate does not prove.** It does not prove the tab is Conductor's. A user who names their own terminal `claude · foo` will have it counted. That is a fail-open failure mode, and Rev 3 accepts it deliberately, on two grounds: (a) the requirement it feeds is best-effort by design (FR3), so a false positive costs a placement, not a violated guarantee; (b) D1 proposed this same label conjunct in the first place, so the fail-open direction is already an accepted tradeoff on this feature. The Rev 2 objection — "fail-open cannot enforce a safety property" — was correct *about a safety property*, and no longer applies, because FR3 is no longer one.

#### 2.4.3 Cold start, `Beside`, and group capture

`TerminalEditorLocationOptions.viewColumn`'s doc comment says only: *"Use `ViewColumn.Beside` to open the editor to the side of the currently active one"* (`index.d.ts:L7776-L7777`). It does **not** say a new group is created.

`unverified:` VS Code's `Beside` / `SIDE_GROUP` placement is generally understood to *reuse* an existing group to the side of the active one and to create one only when none exists. No source was fetched to confirm or refute this during this pass, and the type declarations do not settle it. § 2.5 **P6** is the probe.

**If `Beside` reuses, the empty state can land the first session in the user's group** — user's code in group 1 (active), user's own terminal in group 2, session 1 lands in group 2. From then on group 2 holds the majority of Conductor tabs and subsequent sessions join it there. This is the one case FR3 cannot prevent, and it is stated in FR3 rather than mitigated behind it.

**How this compares to Rev 2, precisely — because "Rev 3 removed the containment check" is the wrong reading.** Rev 2 met this case with `_bootstrapColumnFor`, which refused to *cache* a contaminated landing. The second review pass found what that actually bought: the column was not cached, so **every subsequent cold launch requested `Beside` again and re-contaminated the same user group** — one bad landing per cold launch, indefinitely (HIGH finding). Rev 3's behaviour is one bad landing, after which the sessions accumulate in a single predictable place. Neither is good; Rev 3's is bounded where Rev 2's repeated, and Rev 3's has a repair the user can actually perform: drag the session tabs into a group of their own once, and every later launch follows them (FR3's rationale). No code change can deliver that under Rev 2's model, because there the cached column, not the user's arrangement, decided.

**No containment check is specified.** Adding "refuse the majority group if it also holds foreign tabs" would re-enter the strict-purity design that FR3 abandons, and would break the user-correctability that makes best-effort acceptable — a user who deliberately keeps one notes file beside their sessions would find Conductor refusing to use that group forever.

#### 2.4.4 Concurrency — re-derived, not inherited

D7's in-flight promise guard existed to stop two cold launches from each starting their own asynchronous bootstrap. Rev 3 has no bootstrap, so the question must be re-asked from scratch. Three cases:

1. **Warm, sequential.** Launch 2 runs after launch 1's tab has materialised. It counts the higher total in that group and joins it. No race.
2. **Warm, concurrent (both launches inside the ~777 ms window).** Both call `_resolveTargetColumn()` before either new tab is visible, so both read the same pre-existing counts and both return the same column. They agree, and they are both **right** — the group they pick is the group the sessions live in. **P5's delay is harmless here specifically because the decision never reads the tab being created.** The only way two concurrent warm launches can disagree is if a tab *closes* between the two calls and flips the majority; the cost is one session in a neighbouring Conductor group, and the next launch re-converges on whichever is now larger.
3. **Fully cold, concurrent.** Both return `undefined`, both request `Beside`. Whether that yields one group or two is exactly P6's question: if `Beside` reuses a side group, the second lands beside the first and there is **one** group; if it always creates, there are **two**, each holding one tab.

Case 3 is the entire residual, and it is bounded and self-correcting: with counts 1 and 1, FR1's tie-break sends launch 3 to the lower column, making it 2–1, and every launch after that reinforces it. The steady state is one growing group plus one stranded tab, which the user can drag in.

**Would a guard help?** Only in case 3, and only by making launch 2 wait for launch 1's tab to become visible — which requires an `onDidChangeTabs` subscription, an arrival window, a timeout constant, and a settle path: precisely the async machinery whose failure modes produced Rev 2's CRITICAL and two HIGH findings. **Spending that complexity to prevent a cosmetic, self-converging, double-gesture-only outcome is a bad trade**, and it would reintroduce a code path with no synchronous test story. D7 is therefore superseded (OQ-3). If P6 shows `Beside` reuses, case 3 disappears entirely and the question is moot.

#### 2.4.5 What Rev 2 required and Rev 3 deletes

Listed explicitly so a reviewer comparing revisions can confirm nothing was quietly retained: `_conductorViewColumn`; `_ownedTabs` (the provenance ledger); `_arrivalDeadlines` and all slot accounting; `_bootstrapInFlight` / `_bootstrapResolve` / `_settleBootstrap`; `BOOTSTRAP_TIMEOUT_MS`; `ARRIVAL_WINDOW_MS`; `_validateColumn`; `_isOwnedTab`; `_bootstrapColumnFor`; the `vscode.window.tabGroups.onDidChangeTabs` subscription and its disposable; the `LABEL_MATCH_ENABLED` flag; and FR11/NFR8's ledger-pruning obligation (nothing to prune). `_resolveTargetColumn` survives in name only — it is now synchronous and returns `number | undefined` with no `Promise`.

#### 2.4.6 The launch-path replacement (D4 Option A)

In `launchSession` (`src/sessionManager.ts:L90-L137`), after the existing network-path guard (`L100-L109`) and reuse branch (`L111-L117`), which are unchanged:

```ts
const targetColumn = this._resolveTargetColumn();              // synchronous — § 2.4.1
const terminal = vscode.window.createTerminal({
  name: `${SESSION_NAME_PREFIX}${folderName}`,
  cwd: isLikelyNetworkPath(folderPath) ? folderPath : normalized,
  iconPath: new vscode.ThemeIcon("sparkle"),
  color: new vscode.ThemeColor("terminal.ansiGreen"),
  location: { viewColumn: targetColumn ?? vscode.ViewColumn.Beside, preserveFocus: true },
});
await this._dispatchClaudeCommand(terminal);
return { ok: true, reused: false };
```

`terminal.show(true)` and the `moveToEditor` `executeCommand` (`src/sessionManager.ts:L127-L131`) are **deleted** (FR10). `name`, `cwd`, `iconPath`, and `color` keep their current values verbatim, including the raw-network-path `cwd` behaviour that `test/sessionManager.uncPosix.test.ts:L75-L79` locks in.

`TerminalEditorLocationOptions` is stable API and its `viewColumn` is required, not optional (`index.d.ts:L7771-L7784`), and `TerminalOptions.location` accepts it — so no engine bump is needed beyond the declared `"vscode": "^1.93.0"` (`package.json:L9`, `@types/vscode ^1.93.0` at `package.json:L308`). `preserveFocus: true` is set **explicitly** because it is optional (`index.d.ts:L7780-L7783`) and omitting it would silently change launch focus behaviour away from today's `show(true)` semantics (*"When `true` the terminal will not take focus"*, `index.d.ts:L7738`; `Terminal.show`'s own contract is `index.d.ts:L7735-L7740`).

`launchSession` remains `async` (it awaits `_dispatchClaudeCommand`), but the **grouping decision is now entirely synchronous** — there is nothing to await before `createTerminal`.

### 2.5 Pre-implementation gate — one hard gate plus three informative checks, all in one session

Rev 2 gated on three unobserved behaviours (P6 `Beside` reuse, P7 label population, P8 `Tab` identity stability). **P8 is moot**: Rev 3 never retains a `Tab` object, never keys a `Set` by one, and never compares two `Tab` references. That entire class of undocumented-lifetime risk is gone with the ledger.

**Exactly one gate remains, and it is load-bearing for the whole feature.** Three further checks ride along in the same sitting because the setup cost is shared and the marginal cost of each is a few minutes: **P6** (carried from Rev 3) and, new in Rev 4, **P-PLACE** and **P-REVEAL**, which close the two empirical gaps a `project-reviewer` pass over Rev 3 raised as CONCERNs. **None of the three can block implementation** — that distinction is deliberate and is stated per-row below. § 2.5.1 is the executable runbook for all four.

*(Naming: `P-PLACE` was `P6b` in the Rev 3 review handoff; it is renamed here because it tests the **write** side of placement rather than a variant of P6's `Beside` question.)*

| Probe | Question | Gating? | If it fails |
|---|---|---|---|
| **P-LABEL** | For an editor-hosted terminal tab, **is `Tab.label` equal to the `Terminal.name` Conductor set** — i.e. does `tab.label` read back exactly `claude · <folder>`? Record the **exact string**, not a non-empty check. Sample three cases: **(a)** a freshly settled Conductor session tab (read at ~1 s and ~5 s after creation, not at the creation instant); **(b)** the same tab after a window reload — which also answers OQ-8; **(c)** a user-created editor terminal, for contrast. **The gate turns on case (a) alone**, and § 2.2's Rev 4 correction narrows what case (a) is really testing: labels are already known to settle to exactly `Terminal.name` for `moveToEditor`-born tabs, so the open residual is specifically whether an **editor-born** tab — `location: {viewColumn}`, never in the panel — behaves the same. (b) and (c) are informative and **cannot fail it**: a null result on (b) means editor terminal tabs do not survive a reload, so FR6's re-congregation simply does not apply and OQ-8 answers "no" — no design branch either way; (c) only characterises the false-positive surface already accepted in § 2.4.2. | **YES — hard gate, on case (a).** | There is **no discriminator on the stable API**. `Tab` exposes nothing else usable (`index.d.ts:L19294-L19332`) and `TabInputTerminal` is a bare marker (`index.d.ts:L19282-L19287`), so tab kind cannot stand in. FR1's value collapses: every launch counts zero, every launch requests `Beside`, and the user gets N panes — Reading A (`docs/plans/2026-08-08-session-pane-grouping.md:L34`), the outcome P4 says they do not want. D4 and D2 would have to be reconsidered from scratch. |
| **P6** | Does `location: {viewColumn: Beside}` **reuse** an existing side group, or always create a new one? Set up group 1 = source files (active), group 2 = a user-owned terminal; launch; record `tabGroups.all.length`, each group's `viewColumn`, and where the new tab landed. | **No — informative.** Run it in the same session; it changes the *risk profile* (§ 2.4.3) and answers OQ-5 and § 2.4.4 case 3, but no branch of the mechanism depends on the answer. | FR3's cold-start caveat stands as written. **OQ-5 is already resolved to (a)+(c)**, so a "reuses" answer does not change the design — it only decides whether a follow-up issue is worth opening, and then only if users also report the case in practice (§ 6.2). |
| **P-PLACE** *(new in Rev 4 — the warm-case **write** side)* | Does `createTerminal({location: {viewColumn: N}})` actually land the new tab in group **N**? P-LABEL and § 5.2's whole test suite verify only the **read** side — that Conductor computes the right column from the tab model. **Nothing anywhere verifies that VS Code honours the column it is handed**, which is the other half of FR1 and the half no unit test can reach (§ 5.3). Set up group 1 = a source file, active; group 2 = an existing Conductor-labelled session tab; keep focus in group 1; launch with the probe patch targeting column 2. Record which group the new tab landed in, and `tabGroups.all.length` before and after. **The target group must already exist and must not be the active group** — `viewColumn: N` *creates* column N when absent (`index.d.ts:L7772-L7778`), so probing into a missing group passes trivially, and probing into the active group proves nothing about targeting. | **No — informative.** Raised as a `project-reviewer` CONCERN over Rev 3, not a design defect. Placement into a non-active existing group is the ordinary reading of the API, so this confirms rather than decides. | D4 Option A does not deliver FR1 as § 2.4.6 writes it, and § 2.4.6 would be revisited. **This still does not gate the spec** — but nobody should write § 5.2's suite against a `location` call VS Code ignores, which is exactly why it is worth five minutes now rather than after the tests exist. |
| **P-REVEAL** *(new in Rev 4 — the `focusSession` path)* | After a D4-path launch, does clicking the session in the **Active Sessions** panel still reveal its tab? `focusSession` calls `terminal.show(false)` (`src/sessionManager.ts:L194-L196`) and FR7/FR10 assert it is unchanged — but its *input* changes: post-D4 the reference was created directly in the editor area rather than moved there. `Terminal.show`'s contract says only *"Show the terminal panel and reveal this terminal in the UI"* (`index.d.ts:L7735-L7740`) and says nothing about editor-located terminals. **Pass criterion is reveal only:** the tab becomes active in its group and that group is brought forward. **Focus landing in the terminal is the expected, correct behaviour, not a failure** — `show(false)` passes `preserveFocus: false`, and *"When `true` the terminal will not take focus"* (`index.d.ts:L7738`), so taking focus is what a "Focus Session" action is supposed to do. Do not record focus-taking as a defect; record it and move on. (NFR5's no-focus-stealing requirement is a different path — it governs `preserveFocus: true` at **launch**, § 2.4.6.) | **No — informative.** Raised as a `project-reviewer` CONCERN over Rev 3, carried from Rev 2 where § 5.3 flagged it as unverifiable. It is a real UX path, not a cosmetic one, but a failure is repairable post-hoc. | § 5.3's stated post-ship watch item becomes a known defect instead of a speculative one, and a `tabGroups`-side explicit reveal moves from "out of scope, watch for reports" to a scoped follow-up issue. It still does not gate this spec. |

**Why P-LABEL is an identity assumption, not a "does it populate" question.** Rev 3 assumes that two fields on two different objects agree: the `name` Conductor passes to `createTerminal` (`src/sessionManager.ts:L121`) and the `label` VS Code reports on the resulting `Tab`. Nothing in the API states that relationship. `index.d.ts:L19299` documents `Tab.label` only as *"The text displayed on the tab"* — a UI string VS Code is free to decorate, truncate, or derive differently. A label of `""` (P2's launch-instant sample) and a label of, say, `"Claude · foo"` or `"1: claude · foo"` break `startsWith` equally thoroughly, which is why the probe must capture the literal string rather than assert a predicate. **Note the asymmetry a decorated label creates:** a *suffix* decoration such as `"claude · foo (task)"` still passes, because the predicate is `startsWith` and not equality (§ 2.4.2); a *prefix* decoration or a case change does not. Only the literal string distinguishes the two, which is why § 2.5.1 dumps labels through `JSON.stringify`. If the label turns out to be derived-but-correctly-prefixed consistently, the predicate still holds and the gate passes.

Going from a three-probe gate to a one-probe gate is the mechanism swap's largest practical win; recording the surviving probe honestly is not a regression against that. **Rev 4 adds two checks to that session but does not add a gate** — the count that matters, gates that block implementation, is still one.

#### 2.5.1 Probe runbook — how to actually run this session

**Who runs it:** the repo owner, personally, in the VS Code Extension Development Host (OQ-9, answered 2026-08-15). **One sitting, roughly 30–45 minutes.** Everything below is written to be executed without further research or design judgement; if a step requires you to decide something, that is a defect in this runbook, not a decision for you to make on the spot.

**Order matters once:** run **P-LABEL first**. It is the only hard gate, and its answer determines whether the feature exists. If case (a) comes back empty, or decorated in a way that breaks the `claude · ` prefix, *still finish the session* — the setup cost is already paid and the remaining data is useful for whatever design replaces this one — but you already know the verdict.

##### Step 0 — What you need before you start

- This repo at `I:/ai/claude/vscode-claude-conductor`, `npm install` already run (`CLAUDE.md` § Build and test).
- **Two different folder paths on disk** to launch sessions against. They must be *different folders*: `claudeConductor.reuseExistingTerminal` defaults to `true` (`package.json:L247-L251`), so a second launch against the **same** folder hits the reuse branch (`src/sessionManager.ts:L111-L117`), calls `focusSession`, and **creates no terminal at all** (FR9). This is the single easiest way to waste the sitting. Either use two distinct folders, or set `claudeConductor.reuseExistingTerminal` to `false` in the Extension Development Host window's settings.
- Nothing else. No Claude API access is needed — the sessions only have to *open*; whether `claude` itself starts is irrelevant to every probe here.

##### Step 1 — Create a throwaway branch

None of the probe code is shipped. Precedent: commit `77477de` ("diag: Phase 0 probe instrumentation for #110 (#122)") did exactly this for Phase 0.

```bash
git -C I:/ai/claude/vscode-claude-conductor switch -c 127-probe-session main
```

The three patches below are deleted at Step 7. **They are not a `touches:` under-declaration** — `touches:` describes the shipped change, and none of this ships.

##### Step 2 — Apply the probe patch (four edits, A–D)

**Patch A — `src/sessionManager.ts`: a settable probe column.** Insert immediately after `SESSION_NAME_PREFIX` (`src/sessionManager.ts:L10`):

```ts
// ---- PROBE PATCH (#127, throwaway — do not commit) ----
let PROBE_COLUMN: number | undefined = undefined;
export function setProbeColumn(column: number | undefined): void {
  PROBE_COLUMN = column;
  log(`[probe:column] next launch targets ${column ?? "Beside"}`);
}
// ---- end PROBE PATCH ----
```

**Patch B — `src/sessionManager.ts`: the D4 Option A launch path.** Replace the `createTerminal` call and the two-step that follows it (`src/sessionManager.ts:L120-L131`, i.e. everything from `const terminal = vscode.window.createTerminal({` down to and including the `moveToEditor` `executeCommand` line, leaving the `await this._dispatchClaudeCommand(terminal);` line below it untouched) with:

```ts
    // ---- PROBE PATCH (#127, throwaway): § 2.4.6 launch path ----
    const terminal = vscode.window.createTerminal({
      name: `${SESSION_NAME_PREFIX}${folderName}`,
      cwd: isLikelyNetworkPath(folderPath) ? folderPath : normalized,
      iconPath: new vscode.ThemeIcon("sparkle"),
      color: new vscode.ThemeColor("terminal.ansiGreen"),
      location: {
        // Cast is deliberate — see the note below.
        viewColumn: (PROBE_COLUMN ?? vscode.ViewColumn.Beside) as vscode.ViewColumn,
        preserveFocus: true,
      },
    });
    log(`[probe:launch] name=${JSON.stringify(`${SESSION_NAME_PREFIX}${folderName}`)} requestedColumn=${PROBE_COLUMN ?? "Beside"}`);
    // terminal.show(true) and workbench.action.terminal.moveToEditor are
    // deliberately absent here — that is the whole point of D4 Option A (FR10).
    // ---- end PROBE PATCH ----
```

> **Note on the `as vscode.ViewColumn` cast — and a flag for § 2.4.6.** `TerminalEditorLocationOptions.viewColumn` is typed `ViewColumn` (`index.d.ts:L7771-L7784`), a numeric enum, while both `PROBE_COLUMN` here and `_resolveTargetColumn()`'s declared return type in § 2.4.1 / § 2.4.5 are plain `number | undefined`. **Whether TypeScript 5.3 (`package.json:L310`) accepts a plain `number` where a numeric enum is expected was not verified by this pass — no compiler was available (see Verification note).** The cast makes the probe patch compile either way at zero cost. **Implementation should not simply copy the cast**: if `npm run lint` rejects § 2.4.6's `viewColumn: targetColumn ?? vscode.ViewColumn.Beside`, the correct fix is to declare `_resolveTargetColumn()` as returning **`vscode.ViewColumn | undefined`** rather than `number | undefined` — `group.viewColumn` is already a `ViewColumn` (`index.d.ts:L19386-L19389`), so that is a type-level tightening that strengthens NFR3 by construction rather than a cast that hides it. Flagged here rather than silently rewritten into § 2.4.1, because it is a real question about the pseudocode and the owner should see it.

**Patch C — `src/extension.ts`: two temporary commands.** Add `log` and `setProbeColumn` to the existing imports:

```ts
import { log } from "./output";
import { SessionManager, ActiveSession, setProbeColumn } from "./sessionManager";
```

then insert these two registrations inside the `context.subscriptions.push(` block that begins at `src/extension.ts:L212`, e.g. directly after the `claudeConductor.openSession` registration ends at `L226`:

```ts
    // ---- PROBE PATCH (#127, throwaway — do not commit) ----
    // Deliberately parameterless and synchronous — no input prompt. See the note below.
    vscode.commands.registerCommand("claudeConductor.probeDump", () => {
      log(`===== PROBE DUMP =====`);
      log(`tabGroups.all.length=${vscode.window.tabGroups.all.length}`);
      for (const [i, g] of vscode.window.tabGroups.all.entries()) {
        const labels = g.tabs.map((t) => JSON.stringify(t.label)).join(",");
        const kinds = g.tabs
          .map((t) => (t.input instanceof vscode.TabInputTerminal ? "term" : "other"))
          .join(",");
        log(`group[${i}] viewColumn=${g.viewColumn} isActive=${g.isActive} tabs=[${labels}] kinds=[${kinds}]`);
      }
      for (const t of vscode.window.terminals) {
        log(`terminal name=${JSON.stringify(t.name)}`);
      }
      log(`===== END DUMP =====`);
    }),

    vscode.commands.registerCommand("claudeConductor.probeSetColumn", async () => {
      const raw = await vscode.window.showInputBox({
        prompt: "viewColumn for the NEXT launch — a single digit 1-9, or blank for Beside",
      });
      const trimmed = (raw ?? "").trim();
      if (trimmed === "") {
        setProbeColumn(undefined);
        return;
      }
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1 || n > 9) {
        log(`[probe:column] REJECTED ${JSON.stringify(trimmed)} — target unchanged`);
        return;
      }
      setProbeColumn(n);
    }),
    // ---- end PROBE PATCH ----
```

> **Why `probeDump` takes no input.** An earlier draft prompted for a tag before dumping. That is unusable for **P-LABEL's ~1 s reading**: nobody can open the palette, type a tag, and press Enter inside one second, so the "1 s" sample would actually be taken at whatever moment the typing finished — and that sample is precisely the one distinguishing "empty at 1 s, correct at 5 s" (a **pass**, and expected) from "correct at both". **You do not need tags.** `log()` prepends an ISO timestamp to every line (`src/output.ts:L17-L20`), and the `[probe:launch]` line from Patch B is timestamped too, so the deltas in the Output channel *are* the timing record — more accurate than a hand-typed one. Invoke the command and read the clock. The validation on `probeSetColumn` exists for a different reason: `Number("s")` is `NaN`, and `viewColumn: NaN` would fail silently rather than loudly.

**Patch D — `package.json`: make the two commands visible in the Command Palette.** A `registerCommand` with no `contributes.commands` entry does not appear in the palette. **Insert these two lines immediately after `"commands": [` (`package.json:L39`)** — at the *head* of the array, not the tail. The trailing commas below are only valid there; appended after the last element they make `package.json` invalid JSON, and **`npm: compile` will not catch that** (`tsc` never reads `contributes`), so it would surface mid-session as the extension silently failing to activate.

```json
      { "command": "claudeConductor.probeDump", "title": "Probe: Dump Tabs" },
      { "command": "claudeConductor.probeSetColumn", "title": "Probe: Set Target Column" },
```

**Why a dump command rather than inline timed logging.** Three reasons, all practical: it makes every probe step below "invoke one palette command and read the output", with no timing-sensitive code to get wrong; it uses `log()` (`src/output.ts:L17-L20`) rather than `debugLog()`, which **silently no-ops unless `claudeConductor.debugLogging` is `true`** (`src/output.ts:L27-L31`, default `false` at `package.json:L271-L275`) — a second easy way to waste the sitting; and it works after a window reload for **P-LABEL case (b)**, where there is no launch to trigger inline logging and the extension activates on its own via `onStartupFinished` (`package.json:L33-L36`).

`JSON.stringify(t.label)` is deliberate and matches the convention used throughout `src/sessionManager.ts` (e.g. `L285`, `L325`). It is what makes `""` distinguishable from a decorated label such as `"claude · foo (task)"` — **the entire point of P-LABEL** (§ 2.5, "record the exact string, not a non-empty check").

##### Step 3 — Launch the Extension Development Host

1. Open this repo in VS Code.
2. Press **F5**, choosing the **"Run Extension (watch)"** configuration (`.vscode/launch.json:L18-L31`) rather than **"Run Extension"**. Both work, but `watch` recompiles on save (`preLaunchTask: npm: watch`, `.vscode/tasks.json:L17-L27`), so a mid-session patch tweak only needs **Developer: Reload Window** in the Development Host instead of a full restart. **"Run Extension" runs `npm: compile` once** (`.vscode/launch.json:L16`); with it, any edit you make after launching runs against a stale `out/` and you will be reading results from unpatched code.
3. A second VS Code window opens, titled **[Extension Development Host]**. Note that it launches with `--disable-extension cbeaulieu-gt.claude-conductor` (`.vscode/launch.json:L10-L11`) — your *installed* Conductor is intentionally off in that window so it cannot be confused with the one under test. This is expected, not a fault.
4. **In the Development Host window, open a folder** (File → Open Folder). It starts with no folder open, and P6 needs a source file open in a real editor group. Open a source file from it so group 1 is not empty.
5. Open the output log: **View → Output**, then select **"Claude Conductor"** in the channel dropdown (`src/output.ts:L4`). Every probe result lands here. Leave it open, but note it lives in the panel and does not participate in editor-group layout.

Everything from here on happens **in the Extension Development Host window**. Launch sessions with **Claude Conductor: Launch Session** from the Command Palette (`package.json:L41-L44`), or `Ctrl+Shift+Alt+C` (`package.json:L279-L283`).

##### Step 4 — P-LABEL (the hard gate)

**Case (a) — a freshly settled, editor-born session tab.** This is the case the gate turns on.

1. Command Palette → **Probe: Set Target Column** → leave blank, press Enter. (Confirms `Beside`; the log line `[probe:column] next launch targets Beside` tells you the patch is live. If you don't see it, your `out/` is stale — go back to Step 3.2.)
2. Launch a session against **folder 1**.
3. Wait about **1 second**, then Command Palette → **Probe: Dump Tabs**. It takes no input — it dumps immediately, which is why the 1 s reading is achievable at all.
4. Wait until about **5 seconds** after the launch, then run **Probe: Dump Tabs** again.
5. In the Output panel, copy **both** dumps verbatim, **including the `[probe:launch]` line above them**. Every line carries an ISO timestamp (`src/output.ts:L17-L20`), so the gap between `[probe:launch]` and each `PROBE DUMP` block is your actual elapsed time — you do not need to have hit 1 s and 5 s precisely, only to record two readings and know when each was taken. What matters is the `tabs=[...]` entry for the new session: does it read `"claude · <folder1>"`, `""`, or something else?

> **Pass** = at 5 s, the new session's tab label is a string that `startsWith("claude · ")`. A *decorated but correctly prefixed* label (e.g. `"claude · foo (task)"`) is still a **pass** — `_isConductorTab` uses `startsWith`, not equality (§ 2.4.2). A `""` at 5 s is a **fail**. A `""` at 1 s and a correct label at 5 s is a **pass**, and worth recording as such, because § 2.4.1 never reads a tab at its creation instant.

**Case (b) — reload survival** *(informative; also answers OQ-8)*

6. With that session tab still open, run **Developer: Reload Window** in the Development Host.
7. After the window comes back, run **Probe: Dump Tabs**. (The extension re-activates on its own via `onStartupFinished`, `package.json:L33-L36`, so the command is available without launching anything.)
8. Record whether an editor-hosted terminal tab exists at all, and if so what its label reads. **A "no such tab" result is a legitimate answer, not a failure** — it means FR6's re-congregation simply does not apply and OQ-8 answers "no". Neither answer changes the design.

**Case (c) — a user-created editor terminal, for contrast** *(informative)*

9. Open a plain terminal and move it into the editor area: Command Palette → **Terminal: Create New Terminal in Editor Area**.
10. **Probe: Dump Tabs**. Record its label (expected: something like `"pwsh"` or `"bash"`). This only characterises the false-positive surface already accepted in § 2.4.2; it cannot fail the gate.

##### Step 5 — P6 (`Beside` reuse) *(informative)*

Start from a **fresh** Development Host window (close it and press F5 again) so the state is genuinely cold.

1. Open a folder; open a **source file** — it lands in group 1, which is active.
2. Create a **user-owned terminal in a second group**: Command Palette → **Terminal: Create New Terminal in Editor Area**, then drag that terminal tab to the right until it forms its own group, or use **View: Split Editor Right** first and create it there. You now want: group 1 = source file (active), group 2 = a non-Conductor terminal tab.
3. Click the source file in group 1 so **group 1 is the active group**.
4. **Probe: Dump Tabs** — this is your "before" reading. Confirm `tabGroups.all.length=2` and that the group holding the source file shows `isActive=true`.
5. **Probe: Set Target Column** → blank (Beside). Launch a session against **folder 1**.
6. Wait ~5 s. **Probe: Dump Tabs** — the "after" reading.
7. Record `tabGroups.all.length` before and after, and which group the new `claude · …` tab appears in.

> **"Reuses"** = length stays `2` and the session tab appears in group 2 alongside the user's terminal — this is § 2.4.3's stated cold-start capture case, and it makes § 2.4.4 case 3 disappear. **"Always creates"** = length becomes `3`. **Neither answer changes the design** (OQ-5 is resolved to (a)+(c)); "reuses" only means a follow-up issue *may* be worth opening later, and only if users also report the case in practice.

##### Step 6 — P-PLACE and P-REVEAL *(informative)*

**P-PLACE — does `viewColumn: N` land the tab in group N?** Continue directly from Step 5's window, which already has ≥2 groups and at least one Conductor tab.

**Read `viewColumn`, never the array index.** The dump prints `group[i] viewColumn=N`, and after the drags and closes in Step 5 those two numbers can diverge. Every instruction below means the **`viewColumn` value**, not `group[i]`'s `i`.

1. Arrange so that a **Conductor-labelled session tab sits in the group whose `viewColumn=2`**, and a source file sits in the group whose `viewColumn=1`. If Step 5 landed the session elsewhere, drag its tab across by hand — the arrangement is what matters, not how it got there.
2. **Click the source file**, so the `viewColumn=1` group is the active one. This is the discriminating detail: `viewColumn: N` *creates* column N when it does not exist (`index.d.ts:L7772-L7778`), so targeting a missing group passes trivially, and targeting the group that is already active proves nothing about targeting.
3. **Probe: Dump Tabs** — the "before" reading. Confirm two things in it: a group with `viewColumn=2` exists, **and** the group showing `isActive=true` is *not* that one. If either is untrue, fix the arrangement and re-dump before continuing — the probe is worthless otherwise.
4. **Probe: Set Target Column** → type `2` → Enter. Confirm the log reads `[probe:column] next launch targets 2`.
5. Launch a session against **folder 2** (a *different* folder — see Step 0).
6. Wait ~5 s. **Probe: Dump Tabs** — the "after" reading.

> **Pass** = the new `claude · <folder2>` tab appears in the group whose `viewColumn=2`, and `tabGroups.all.length` is unchanged. **Fail** = it landed in the active (`viewColumn=1`) group, or a new group was created. A fail means D4 Option A does not deliver FR1 as § 2.4.6 writes it. **It is still not a gate** — it does not, on its own, stop the feature — but nobody should write § 5.2's test suite against a `location` call VS Code ignores, so § 2.4.6 would be revisited first.

**P-REVEAL — does `focusSession` still reveal an editor-born tab?** Continue in the same window.

7. Click the **source file in group 1** so the session tab from step 5 is visible but not active — if group 2 has more than one tab, click a different tab in group 2 as well, so the session tab is not the active tab of its own group either.
8. Open the **Claude Conductor** view in the Activity Bar (`package.json:L113-L116`) and find the session under **Active Sessions**.
9. **Click the session row.** That fires `claudeConductor.focusSession` (`src/treeView.ts:L70-L74` → `src/extension.ts:L242-L247` → `SessionManager.focusSession`, `src/sessionManager.ts:L194-L196`).
10. Record two things, separately: **(i)** did the session's tab become the active tab, with its group brought forward? **(ii)** where did keyboard focus land?

> **Pass = (i) only.** The tab is revealed. **(ii) is informational and (ii)-taking-focus is the correct behaviour, not a defect** — `focusSession` calls `show(false)`, and `preserveFocus: false` means the terminal *does* take focus (*"When `true` the terminal will not take focus"*, `index.d.ts:L7738`). A "Focus Session" action taking focus is what it is named for. Record where focus landed; do not score it. (NFR5's no-focus-stealing rule is a different path entirely — it governs `preserveFocus: true` at **launch**, § 2.4.6.) **Fail = the tab is not revealed** — the group stays where it was, or nothing visibly happens.

##### Step 7 — Tear down

Close the Development Host. Then discard everything:

```bash
git -C I:/ai/claude/vscode-claude-conductor restore .
git -C I:/ai/claude/vscode-claude-conductor switch main
git -C I:/ai/claude/vscode-claude-conductor branch -D 127-probe-session
```

Nothing from Step 2 is committed. The results live on #127 (Step 8), which is the durable record.

##### Step 8 — Where to post the results

**One comment on [#127](https://github.com/glitchwerks/vscode-claude-conductor/issues/127)**, mirroring the shape of the Phase 0 results comment on #110 ([`5274827716`](https://github.com/glitchwerks/vscode-claude-conductor/issues/110#issuecomment-5274827716), 2026-08-13, fetched 2026-08-15): one `##` heading per probe, a **bold one-line verdict**, a short impact paragraph naming which spec section it settles, and a fenced code block holding the **literal captured output**. Paste the dumps verbatim — a summarised label is not evidence, and Rev 3 was already burned once by working from a summarised copy of the #110 comment (see Verification note).

````markdown
# #127 Probe Session Results

## P-LABEL — does an editor-born session tab's `Tab.label` read back as `claude · <folder>`?
**PASS / FAIL** (case (a) — the hard gate)
<one paragraph: what it means for § 2.4.2 and § 4's mechanism-killing risk>
```
<paste the t=1s and t=5s dumps verbatim>
```
Case (b) reload: <survived with label X / no editor terminal tab survived> — answers OQ-8.
Case (c) user terminal label: <literal string>

## P6 — does `Beside` reuse an existing side group?
**REUSES / ALWAYS CREATES** (informative)
...

## P-PLACE — does `viewColumn: N` land the tab in group N?
**PASS / FAIL** (informative)
...

## P-REVEAL — does `focusSession` reveal an editor-born tab?
**PASS / FAIL** on reveal (informative). Focus landed in: <where> (recorded, not scored).
...

## Net effect
- P-LABEL: <the spec is unblocked for implementation / the mechanism has no discriminator and § 2.4 must be redesigned>
- <one line per informative probe, naming the section it touches>

---

🤖 _Generated by Claude Code on behalf of @cbeaulieu-gt_
````

Then update this spec: if **P-LABEL case (a) passes**, the Status line flips to ACCEPTED and § 2.8's document-state updates run. If it fails, the spec does **not** flip — § 2.5's "if it fails" column applies and D2/D4 are reconsidered from scratch.

### 2.6 Non-functional requirements

- **NFR1** — Stable public API only. No proposed API, no engine bump (`package.json:L9`).
- **NFR2** — `workbench.action.lockEditorGroup` must not be introduced. Locking breaks native drag/drop for the user's unrelated files — sourced from `docs/research/2026-08-08-session-pane-grouping.md:L104-L105` and `:L160-L162`, which fetched `anthropics/claude-code#18337` on 2026-08-08. This document did not fetch that issue.
- **NFR3** — No `ViewColumn` value may be passed to `createTerminal` unless it is symbolic (`Beside`) or was read back from a group live in `tabGroups.all`. Rationale is type-level: `index.d.ts:L7772-L7778` states *"Columns that do not exist will be created as needed up to the maximum of `ViewColumn.Nine`"*, so computing an absolute column can conjure empty panes. **Rev 3 satisfies this by construction** — the only non-symbolic value the design can produce is `group.viewColumn`, read in the same synchronous pass that uses it. OQ-5 option (b) would relax it; NFR3 stands as written unless that is answered yes.
- **NFR4** — No existing tab of the user's is moved, closed, or reordered. Conductor calls no `TabGroups` mutator; the only two are the `close()` overloads (`index.d.ts:L19430-L19448`) and neither is used.
- **NFR5** — Launch focus behaviour is unchanged: the session tab appears without stealing focus. Achieved by `preserveFocus: true` (§ 2.4.6).
- **NFR6** — Covered by the existing mocked-`vscode` unit harness; no VS Code instance required (`CLAUDE.md` § Build and test). Requires the mock additions in § 5.1, which are smaller than Rev 2's — no drivable emitter, no fake timers.
- **NFR7** — The #110 plan's `Status` line and its `docs/README.md:L53` row are updated on acceptance (§ 2.8). The `docs/README.md` Specs-table row for *this* document is kept current with its state, per `CLAUDE.md` § Where documents live.
- **NFR8** — Placement adds no background work: no timers, no subscriptions, no polling, and no state that outlives a `launchSession` call (FR11). The per-launch cost is one pass over the live tab model (§ 2.4.1).

### 2.7 Source comments that go stale on the same commit

*(Unchanged from Rev 2 — D4/D5 are untouched by the mechanism swap, so all three corrections still apply.)*

Three doc comments state, as fact, that `moveToEditor` swaps terminal references. Option A removes that call, so all three become factually wrong the moment this lands and must be updated **in the same commit**:

- `src/sessionManager.ts:L42-L49` — `_pidToTerminal`'s comment: *"When moveToEditor causes VS Code to swap terminal references, the new onDidCloseTerminal fires with a reference that isn't in `_sessions` by identity."* Rewrite to describe the index as a retained safety net whose original trigger is gone but whose removal is evidence-gated on #68 (D5), **not** to delete it.
- `src/sessionManager.ts:L200-L206` — `closeSession`'s comment: *"The terminal reference on the passed session may be the pre-moveToEditor panel terminal…"* The re-resolve-by-folder behaviour itself stays (D5, FR7); only the stated cause changes.
- `src/sessionManager.ts:L315-L318` — `_handleTerminalClose`'s three-tier doc comment: *"1. Identity match (the common case for **panel terminals**). 2. Name match, disambiguated by folder (handles some reference swaps **after moveToEditor**)."* Both clauses are wrong post-D4 — there are no panel terminals on the launch path any more, and there is no `moveToEditor` to swap references. The tiers stay (D5); the comment must say why they are retained (evidence-gated on #68) rather than describing a mechanism that no longer exists.

The tier-match `debugLog` markers the plan proposed as new work (`docs/plans/2026-08-08-session-pane-grouping.md:L235`) **already exist** — `src/sessionManager.ts:L325` (`[close:tier1] hit`), `L338` (`[close:tier2] hit`), `L380` (`[close:tier3]`), all re-read 2026-08-15. No work item.

### 2.8 Document-state updates on acceptance

When this spec flips to ACCEPTED:

- `docs/plans/2026-08-08-session-pane-grouping.md`'s `**Status:**` line (`L17`) currently reads `UNDER REVIEW — … D6 and the confirmation-needed questions in § 8 remain open … No code should be written from this document yet.` Flip it to `SUPERSEDED BY docs/specs/2026-08-15-session-tab-default-grouping.md`. The flip must not read as though the plan's open items were all resolved: its D4 retest clause is this spec's § 2.2.1 / OQ-6, and **its D1 and D7 are superseded rather than implemented** (§ 2.1).
- `docs/README.md:L53`'s plan row says *"7 decision points and a 5-probe empirical gate unanswered; **no code should be written from it yet**"* — same correction.
- The Specs-table row for this document (`docs/README.md:L32`) is updated with each revision and flips to ACCEPTED on acceptance.

Precedent for **retaining rather than deleting** the plan is `docs/README.md:L55-L69`: the shared-workspace plan was flipped to SUPERSEDED and kept because its § 2 is cited by line number elsewhere. This spec cites the #110 plan by line number in several places above, so the same retain-decision applies. Whoever closes #110 should run the stem sweep `CLAUDE.md` § Lifecycle requires before any deletion is even considered.

---

## 3. Scope boundaries

### In scope

- The two private helpers and the launch-path replacement (§ 2.4.1, § 2.4.2, § 2.4.6).
- The **P-LABEL** pre-implementation gate, and P6 / P-PLACE / P-REVEAL alongside it as informative probes in the same session (§ 2.5), executed per the § 2.5.1 runbook. The runbook's throwaway probe patch touches `src/extension.ts` and `package.json`; **that is not a `touches:` declaration**, because none of it is committed (§ 2.5.1 Step 7).
- The `test/mocks/vscode.ts` additions in § 5.1 and the test plan in § 5.2.
- The same-commit comment corrections in § 2.7 and the document-state updates in § 2.8.

### Explicitly out of scope

- **Any ownership or provenance tracking.** Removed by this revision, with the reasoning in § 2.2 and § 2.3. Not deferred to a follow-up — the API constraint that defeated it does not change with more effort.
- **Any `onDidChangeTabs` / `onDidChangeTabGroups` subscription.** D3 made the eager layer optional; Rev 3 makes it unnecessary, since nothing is cached for an event to invalidate.
- **A containment check that refuses "impure" groups** (§ 2.4.3). Re-enters the strict design FR3 abandons and breaks user-correctability.
- **Removing `_pidToTerminal` or the three-tier close detection.** D5 is an explicit non-change. Deferred to a follow-up gated on #68's diagnosis.
- **Any post-hoc relocation of already-open session tabs.** No stable API exists to move an existing tab between groups (`index.d.ts:L19406-L19449` has no such member; its only mutators are the two `close()` overloads at `L19430-L19448`). Existing tabs stay put; only new tabs are steered. This is why FR3 cannot be retroactive and why FR8's cold-concurrent residual is not repairable in code.
- **Sidebar tree grouping.** `groupByProjectRoot` and the tree providers are a different mechanism; #110 excluded them.
- **Webview-hosted sessions and `contributes.viewsContainers`** (including `secondarySidebar`). Ruled out in the scoping plan's § 6 with research-doc sourcing; not reopened.
- **A user-facing setting. Resolved, not conditional: placement is always-on.** OQ-4 was answered **(b)** by the repo owner on 2026-08-15 — no `claudeConductor.groupSessionTabs`, no second launch path, rollback via the marketplace pre-release channel (`docs/release-strategy.md`) if it goes wrong. `src/config.ts` and `package.json` are therefore **removed from `touches:` and from this spec's scope entirely**, which is option (b)'s own stated consequence (§ 6.2). Not deferred to a follow-up: the post-gate residuals are cosmetic and user-correctable by dragging (§ 2.3), which is a finer instrument than a boolean.
- **A cold-start `Beside` fallback** (pre-flight column computation). OQ-5 was answered **(a)+(c)** by the repo owner on 2026-08-15: keep `Beside` unconditionally, no pre-flight, no computed column, NFR3 unrelaxed. A follow-up issue is opened **only if** P6 shows `Beside` reuses **and** users actually report the cold-start-lands-in-my-group case in practice — both conditions, not either.

---

## 4. Risks

The risk profile is **not** an edit of Rev 2's — the arrival-window race, slot starvation, provenance false-positive, ledger growth, `Tab`-identity, and bootstrap-timeout rows are all deleted because the mechanisms that generated them are gone. What follows is derived from Rev 3's mechanism.

| Risk | What would have to be true |
|---|---|
| **`Tab.label` does not read back as the terminal name, so nothing is ever counted and every launch opens a new pane.** This is the mechanism-killing risk and it has no in-code mitigation. | `Tab.label` is documented only as *"The text displayed on the tab"* (`index.d.ts:L19299`) with no stated relationship to `Terminal.name`. **Rev 4 narrows this risk materially.** Rev 3 described the repo's evidence as "P2 read `""`", which was an incomplete reading of the repo's own data: the **P4** raw log in the same #110 comment shows settled session tabs reading back as exactly `"claude · job-matcher-pr"` and `"claude · career-ops"`, so labels *do* populate and `startsWith` *would* have matched (§ 2.2). What remains open is narrower and specific — every one of those samples was `moveToEditor`-born, and D4 makes tabs editor-born via `location:`, a creation path with no label sample at all. **§ 2.5 P-LABEL is a hard gate for exactly that residual**, and it must still capture the literal string, because an empty label and a decorated label break `startsWith` differently. If it fails, the feature has no discriminator on the stable API. |
| **The label predicate is a false positive: a user names their own terminal `claude · …` and it is counted.** | The user does that deliberately. Accepted, fail-open, and bounded by FR3 being best-effort — the cost is one placement, not a violated guarantee (§ 2.4.2). D1 proposed this same conjunct, so the direction is already an accepted tradeoff on this feature. |
| **First-ever launch lands in the user's group (`Beside` reuse), and every later session then joins it there.** | `unverified:` `Beside` reuses an occupied side group (§ 2.4.3); **P6** settles it. FR3 states this case rather than hiding it. Compared with Rev 2, this is one bad landing instead of one *per cold launch*, and the user can repair it once by dragging — after which the heuristic follows them. **OQ-5 is resolved (a)+(c) as of 2026-08-15: this risk is accepted as-is, with no fallback built.** A follow-up is opened only if P6 shows reuse *and* users report it (§ 3). |
| **Placement thrashes between two groups across launches.** Sessions split further with each launch instead of converging. | The tie-break is left unspecified and `tabGroups.all` iteration order varies between reads — nothing documents that order (`index.d.ts:L19409-L19413`). **FR1's lowest-`viewColumn` tie-break is the guard, and it is a requirement, not an implementation detail**; § 5.2 test 8 locks it. With the tie-break in place, a tie resolves permanently on the next launch (1–1 → 2–1). |
| **A dragged-out session tab captures future placement.** The user pulls one session into its own pane for side-by-side work; the next launch joins the wrong group. | The predicate is first-found rather than majority — the exact reason FR1 counts (§ 2.4.1 property 1). With counting, one stray tab loses to the group holding the rest; it only wins once it *is* the majority, which is the intended reading of the user's arrangement. |
| **Two truly simultaneous cold launches produce two groups.** | `Beside` creates rather than reuses (P6), *and* both launches are issued inside the ~777 ms tab-materialisation window. Accepted under FR8: cosmetic, double-gesture-only, and self-converging via the tie-break. The only guard that would close it re-adds the async machinery whose failure modes produced Rev 2's CRITICAL finding (§ 2.4.4). |
| **`SESSION_NAME_PREFIX` is changed later and grouping silently stops working.** | Someone edits `src/sessionManager.ts:L10` for a naming reason and does not realise placement now depends on it as well as `_isClaudeSession` (`L260-L262`). Guard: § 5.2 test 15 derives its fixture labels from the exported constant rather than hard-coding `"claude · "`, so a rename breaks a test rather than the feature. |
| **#68 loses its reproduction baseline.** #68 (open, labels `bug` + `pathfinding`, fetched 2026-08-15) hypothesises *"`_pidToTerminal` index drift"* and *"identity drift over time"* — both consequences of the `moveToEditor` swap this change removes. | Nothing — this is the accepted, deliberate cost of **D6**. **D5 does not offset it.** D5 keeps the close-detection machinery unchanged, which contains *regression* risk; it does nothing to preserve #68's diagnostic baseline. If #68 stops reproducing after this ships, that is **not a diagnosis** — the root cause may simply be masked. The tier markers at `src/sessionManager.ts:L325`/`L338`/`L380` keep accumulating evidence, but against a changed launch path. |
| **P3's `shellIntegration` inconsistency degrades dispatch.** `processId` resolves on an editor-born terminal without `show()` — the sub-check that would have been fatal — but `shellIntegration` timing was inconsistent across the two runs sampled. | The existing dispatch ladder fails to cover it: `_dispatchClaudeCommand`'s fast path (`src/sessionManager.ts:L151-L155`), 2000 ms shell-integration wait (`L157-L180`), then the `claudeConductor.launchDelayMs` fallback (`L186-L190`, default 500, `package.json:L265-L270`). **This was a gate sub-check and is now a monitored risk — see § 2.2.1 and OQ-6, which the repo owner accepted on 2026-08-15. No longer-window retest gates implementation.** |
| **Tests pass while real behaviour is broken.** | The mock's `tabGroups` stub encodes the author's model of VS Code's tab model rather than observed behaviour. Unit tests verify **Conductor's decision given a tab topology** — which, unlike Rev 2, is now the entire feature — but they cannot verify that the topology VS Code actually reports matches the fixtures. P-LABEL and P6 are the only empirical evidence, and the Phase 0 sample behind § 2.2 was small (P2 n=3 launches, P3 n=2 runs, P4/P5 one session). |

**Not a risk, recorded so it is not re-raised:** query cost. § 2.4.1 runs one pass over `tabGroups.all` per non-reuse launch, at user-gesture frequency, over a collection bounded by open tabs. There is no polling and no per-tab allocation.

---

## 5. Test plan and mock work

Rev 3's test surface is **substantially smaller than Rev 2's** and, more importantly, different in kind: the decision under test is a pure synchronous function of a seeded tab topology (FR11). No fake timers, no drivable event emitter, no microtask-flush convention, no async ordering assertions. Rev 2's tests 9–23 exercised bootstrap arming, arrival attribution, slot accounting, and timeout settling — all of which are gone.

### 5.1 `test/mocks/vscode.ts` — required additions

The mock currently has `TerminalLocation` (`test/mocks/vscode.ts:L130-L133`) but **no** `ViewColumn`, **no** `TabInputTerminal`, and **no** `window.tabGroups` (`test/mocks/vscode.ts:L212-L245`).

1. **`export enum ViewColumn`** — `Active = -1`, `Beside = -2`, `One = 1` … `Nine = 9`, mirroring `index.d.ts:L7343-L7392`.
2. **`export class TabInputTerminal { constructor() {} }`** — mirroring `index.d.ts:L19282-L19287`. Tests build terminal tabs as `{ label, group, input: new TabInputTerminal() }` and non-terminal tabs with some other sentinel input, so `instanceof` behaves as it does in the real host.
3. **`window.tabGroups`** with a mutable `all: TabGroup[]` (default `[]`), plus `activeTabGroup`, `onDidChangeTabGroups`, `onDidChangeTabs`, and `close: vi.fn()` for shape fidelity. **The two events may stay inert `vi.fn().mockReturnValue(new Disposable(...))` stubs** in the existing style (`test/mocks/vscode.ts:L226-L228`) — Rev 3 subscribes to neither, and a test that needs a different topology assigns `tabGroups.all` directly. *(Rev 2 required a drivable emitter here; that requirement is withdrawn.)*
4. **`window.createTerminal` must record its argument and return a distinct stub per call.** It is currently a fixed `mockReturnValue` (`test/mocks/vscode.ts:L216-L224`), so two launches are indistinguishable in assertions. Switch to `mockImplementation(() => ({...fresh stub}))`. Verified safe for existing tests: `test/sessionManager.uncPosix.test.ts:L75` reads `mock.calls[0][0]` (the argument, not the return value).
5. **The returned terminal stub must offer a working `shellIntegration` fast path in grouping tests.** The current stub sets `shellIntegration: undefined` (`test/mocks/vscode.ts:L222`), which sends `_dispatchClaudeCommand` down the 2000 ms slow path (`src/sessionManager.ts:L157-L180`) and then the delay fallback (`L186-L190`). Grouping tests that `await launchSession` must set `shellIntegration: { executeCommand: vi.fn() }` so the fast path (`src/sessionManager.ts:L151-L155`) returns synchronously and no test needs timer control at all.
6. **A reset helper** for `tabGroups.all`, since the mock is a module-level singleton — mirroring the existing `vscodeMock.window.terminals.length = 0` pattern at `test/sessionManager.closeDetection.test.ts:L23`.

**A shared tab-fixture builder** belongs in the grouping test file rather than the mock: `group(column, ...labels)` producing a `TabGroup`-shaped object whose `tabs` carry `input: new TabInputTerminal()` and whose `group` back-reference points at the containing group (`Tab.group` is non-optional, `index.d.ts:L19301-L19304`, and § 2.4.1 does not read it — but the fixture should be shape-faithful so a future change that does read it is not silently unsupported).

### 5.2 Test cases a `test/sessionManager.grouping.test.ts` must cover

Placement (each seeds `tabGroups.all`, calls `launchSession`, and asserts the `location` passed to `createTerminal`):

1. **No groups at all** (`all: []`) → `location: { viewColumn: ViewColumn.Beside, preserveFocus: true }`. *(FR2, NFR5)*
2. **Groups exist but none holds a Conductor-labelled tab** — e.g. group 1 with two text tabs, group 2 with one user terminal tab labelled `bash` → `Beside`. *(FR2, FR3 — the user's own editor terminal must not attract sessions; this is the Rev 1 defect restated for the new mechanism.)*
3. **Exactly one group holds Conductor tabs** → that group's `viewColumn`. *(FR1)*
4. **Majority wins over first-found.** Group 1 holds one Conductor tab; group 3 holds three → `viewColumn === 3`, **not** `1`. *(FR1 property 1 — the dragged-out-tab case. Assert the number, not merely "not Beside".)*
5. **Foreign tabs in the winning group do not disqualify it.** Group 2 holds two Conductor tabs plus one text tab; group 3 holds one Conductor tab → `viewColumn === 2`. *(FR3's best-effort form and § 2.4.3's "no containment check" — this test exists to stop a future reviewer reintroducing purity filtering without changing the spec.)*
6. **A non-terminal tab whose label starts with the prefix is not counted.** Group 2 holds one Conductor terminal tab; group 3 holds two tabs with `label: "claude · notes"` but a non-`TabInputTerminal` input → `viewColumn === 2`. *(§ 2.4.2's narrowing conjunct)*
7. **A terminal tab whose label lacks the prefix is not counted.** Mirror of test 6 with the input/label roles swapped → the group of unlabelled terminals loses. *(§ 2.4.2 — the label is doing the identification work.)*
8. **Ties resolve to the lowest `viewColumn`.** Groups 2 and 4 each hold two Conductor tabs → `viewColumn === 2`. Then re-seed with the groups in the reverse array order and assert the same answer, proving the result does not depend on `tabGroups.all` ordering. *(FR1's tie-break; the § 4 thrash guard.)*
9. **Empty groups are skipped, not chosen.** A group with `tabs: []` present alongside a Conductor group → the Conductor group's column. *(§ 2.4.1 property 4, `index.d.ts:L19399-L19403`)*
10. **`preserveFocus: true` on every `createTerminal` call**, in both the `Beside` and numeric-column cases. *(NFR5)*
11. **No `show(true)` on the launch path** — the returned terminal stub's `show` is never called during `launchSession`. *(FR10)*
12. **No `moveToEditor`** — `commands.executeCommand` is never called with `"workbench.action.terminal.moveToEditor"` (`test/mocks/vscode.ts:L271-L274`). *(FR10)*
13. **The reuse branch runs no grouping logic.** With `reuseExistingTerminal` on and an existing session for the folder, `createTerminal` is not called at all. *(FR9. Deliberately asserted via `createTerminal`, not via a read-spy on `tabGroups.all`: § 5.1 item 3 specifies `all` as a plain mutable property, which cannot be spied for reads, and `createTerminal` not being called is sufficient — the reuse branch returns before the launch path. Do not "strengthen" this into an access assertion without first changing § 5.1.)*

Statelessness and repeatability — the properties that replace Rev 2's entire async suite:

14. **Two sequential launches against an unchanged topology place identically.** Launch, assert column N; without mutating `tabGroups.all`, launch again and assert column N again. *(FR11 — a cache would make the second call diverge if the first mis-cached.)*
15. **A topology change between launches changes the answer, with no invalidation step.** Launch → column 2. Move the Conductor tabs into a group at column 5 in the fixture (simulating the user dragging them) and launch again → column 5. Then delete the group entirely and launch again → `Beside`. **This single test covers what Rev 2 needed four invalidation tests for** (group closed, group emptied, group renumbered, group contaminated) — all are the same case here. *(FR5, FR3's "not sticky against manual moves")*
    - Build both fixtures' labels from the exported `SESSION_NAME_PREFIX` (`src/sessionManager.ts:L10`), not the literal `"claude · "`, so a prefix rename fails this test rather than silently disabling placement (§ 4's `SESSION_NAME_PREFIX` row).
16. **No new subscriptions or fields.** Constructing a `SessionManager` and running a launch registers no `tabGroups` listener: assert `window.tabGroups.onDidChangeTabs` and `onDidChangeTabGroups` were never called. *(FR11, NFR8 — the cheapest available check that the deleted machinery stayed deleted.)*

Concurrency (both synchronous; no timers):

17. **Two overlapping launches from a warm window agree.** Seed a Conductor group at column 3; call `launchSession` twice without awaiting the first; assert **both** `createTerminal` calls carry `viewColumn === 3`, with **no** fixture mutation between them (the in-flight tab's ~777 ms invisibility is exactly this). *(FR8 warm case, § 2.4.4 case 2)*
18. **Two overlapping launches from a cold window both request `Beside`** and neither blocks — assert both `createTerminal` calls happen without any timer advance. *(FR8 cold case, § 2.4.4 case 3. This asserts the accepted residual, not a guarantee of one group; do not write it as though one group were promised.)*

Regression:

19. `test/sessionManager.closeDetection.test.ts` and `test/sessionManager.debugLog.test.ts` pass **unmodified**. Rev 3 adds nothing to the constructor, so unlike Rev 2 these should not require even a mock-driven adjustment; if either breaks, the implementation added state or a subscription it should not have. *(FR7, D5, FR11)*
20. `test/sessionManager.uncPosix.test.ts:L55-L82` still passes: the raw network path survives to `cwd` with `location` now present in the same options object. It calls `launchSession`, so `window.tabGroups.all` must exist (defaulting to `[]` → `Beside`). Extending it to assert `location` alongside `cwd` is optional; do not weaken the existing `cwd` assertion.
21. `test/sessionManager.launchResult.test.ts` — `LaunchResult` shape unchanged for both the missing-folder refusal and the successful launch.

### 5.3 What these tests cannot prove

The mock encodes the author's model of VS Code's tab model. These tests lock Conductor's *decision given a topology*; they cannot show that a real editor-born terminal starts its process, that a real session tab's `label` reads back as `claude · <folder>` (**P-LABEL**, and the feature's value rests entirely on it), that VS Code honours a requested `viewColumn` (**P-PLACE** — the tests assert only what Conductor *passes* to `createTerminal`, never what VS Code *does* with it), or that `Beside` resolves where expected (**P6**). § 2.5 is the only route to that evidence.

**`focusSession` needed a stated caveat; Rev 4 gives it a probe instead.** `focusSession` calls `session.terminal.show(false)` (`src/sessionManager.ts:L194-L196`) and FR7/FR10 assert it is unchanged. Strictly, the *code* is unchanged but its *input* is not: today `show(false)` runs against a reference that has been through `moveToEditor`; post-D4 it runs against a reference created directly in the editor area. `Terminal.show`'s contract (`index.d.ts:L7735-L7740`) says only *"Show the terminal panel and reveal this terminal in the UI"* and says nothing about editor-located terminals. **It remains unverifiable *here*** — the mocked harness cannot observe reveal behaviour — but it is no longer unverified *anywhere*: **§ 2.5 P-REVEAL covers it** in the probe session, so the answer arrives before implementation rather than as a field report. It is informative, not gating: a failure makes the `tabGroups`-side explicit reveal a scoped follow-up issue rather than a speculative one. The post-ship watch item stands regardless — if reports surface that clicking a session in the Active Sessions panel no longer reveals its tab, that fix is out of scope for this spec. *(Raised as a `project-reviewer` CONCERN over Rev 2 and again over Rev 3; Rev 4 converts it from a caveat into a check.)*

Other post-ship signals to watch: the existing `[dispatch] delay fallback` log line (`src/sessionManager.ts:L188`) firing more often than before (P3's `shellIntegration` risk); the tier markers at `L325`/`L338`/`L380` starting to miss tier 1 (#68's surface); and the new `[group:resolve]` line (§ 2.4.1) reporting `column=beside count=0` on launches where the user expects an existing group — the single clearest field signal that P-LABEL's assumption has broken on some platform or VS Code version.

---

## 6. Open questions

**Status as of Rev 4: none are open.** OQ-1 through OQ-9 were answered by the repo owner directly in conversation on **2026-08-15**; OQ-10 was already resolved in Rev 3. Each is retained below with its answer rather than deleted, because several answers are *decisions not to build something* (OQ-4's setting, OQ-5's fallback, OQ-3's guard) and a deleted question reads later as a question nobody asked. **What still blocks implementation is empirical, not a decision:** § 2.5's **P-LABEL**, run per the § 2.5.1 runbook.

### 6.1 The mechanism swap and the two superseded decisions

1. ✅ **ANSWERED — OQ-1: the mechanism itself.** *(Repo owner, 2026-08-15.)* Rev 3 replaces ownership *proof* with a stateless best-effort placement heuristic (§ 2.4.1) and restates FR3 accordingly (§ 2.3). **All three sub-questions confirmed as written:** (a) best-effort placement is the accepted target, with § 2.4.1's cold-start capture case stated rather than mitigated; (b) no containment or purity filter is wanted (§ 2.4.3); (c) the fail-open label predicate is acceptable given (a) (§ 2.4.2). The design and its reasoning were the owner's own, proposed in conversation at Rev 3's origin; this confirmation closes the loop rather than introducing anything new. Nothing in § 2.4 changes as a result.
2. ✅ **ANSWERED — OQ-2: D1 is superseded, and stays superseded.** *(Repo owner, 2026-08-15.)* D1 ([#110 comment `5247626767`](https://github.com/glitchwerks/vscode-claude-conductor/issues/110#issuecomment-5247626767), 2026-08-11) says to cache the resolved `viewColumn` as a plain number and validate it by group content. **Confirmed: no caching, no validation, the stateless per-launch query stands, and D1 does not come back.** The § 2.1 argument — that holding no state honours D1's intent (never trust a stale number) more completely than caching-plus-validation — is accepted. § 2.1's D1 row records this.
3. ✅ **ANSWERED — OQ-3: D7 is superseded; the guard stays dropped.** *(Repo owner, 2026-08-15.)* **§ 2.4.4's re-derivation is accepted as sufficient**: warm-concurrent launches agree by construction, and the fully-cold-concurrent case is a bounded, self-converging residual. **No guard is being re-added**, and the async machinery that would be required to close the residual is not revisited. § 2.1's D7 row records this.

### 6.2 Placement and rollback

4. ✅ **ANSWERED — OQ-4: always-on, no setting. Option (b).** *(Repo owner, 2026-08-15.)* **Consequence, applied throughout Rev 4:** `src/config.ts` and `package.json` are removed from the frontmatter `touches:` list and from § 3's scope — this is option (b)'s own stated consequence, not an inference. There is one launch path, not two; rollback is the marketplace pre-release channel (`docs/release-strategy.md`), not a toggle. Options (a) and (c) are recorded below as the rejected alternatives, unedited.

   **Original question and options, for the record.** **Re-derived under Rev 3's risk profile, not carried from Rev 2.** Rev 2 recommended a setting because three unobserved behaviours sat behind a hard gate and two requirements had been downgraded. That premise changed: there is now one gate, no async machinery, and no state — and the dominant failure mode (P-LABEL) is caught *before* implementation rather than in the field, because if labels do not read back the feature is not built at all.
   - **(a) `claudeConductor.groupSessionTabs: boolean`, default `true`.** The "off" path does not need the legacy two-step retained — `location: { viewColumn: vscode.ViewColumn.Active, preserveFocus: true }` approximates today's `moveToEditor`-into-the-active-group behaviour (P4's finding, § 1) while keeping FR10 and D4 intact. Cost: one config property, one `src/config.ts` getter, one branch.
   - **(b) No setting; rely on marketplace version rollback. — Recommended under Rev 3.** The post-gate residuals are all cosmetic and, uniquely to this mechanism, **user-correctable by dragging** (§ 2.3): a user who dislikes where sessions land moves them and the heuristic follows. A boolean that turns placement off is a blunter instrument than the drag they already have, and it adds a second launch path to test forever. The odd/even pre-release channel (`docs/release-strategy.md`) already provides a staged-exposure route without a permanent setting.
   - **(c) Ship behind the setting defaulting `false` for one pre-release, then flip.** Worth taking only if P-LABEL passes inconsistently — e.g. the label reads back on Windows but not on another platform — in which case (a) is the right landing place, not (c).

   ~~`package.json` and `src/config.ts` stay declared in `touches:` while this is open; they drop out under (b).~~ **(b) was chosen — they have dropped out.**
5. ✅ **ANSWERED — OQ-5: no fallback. Options (a) + (c).** *(Repo owner, 2026-08-15.)* **Keep `Beside` unconditionally, and defer any fallback.** No pre-flight, no computed column, NFR3 stays unrelaxed as written. A follow-up issue is opened **only if both** conditions hold: P6 shows `Beside` reuses, **and** users actually report the cold-start-lands-in-my-group case in practice. P6 alone is not sufficient to open it — this is the point of (c), and § 2.5's P6 row and § 3 both record it. Option (b) is rejected, not deferred: its NFR3 tension rests on an empirical claim about column contiguity that this document declined to make.

   **Original question and options, for the record.** Sequenced after **P6**. Rev 3 lowers the stakes — one bad landing, then stable accumulation, user-correctable — but does not remove the case.
   - **(a) Keep `Beside` unconditionally.** FR3's caveat stands. No NFR3 tension. Simplest. Also makes § 2.4.4's cold-concurrent residual disappear if `Beside` reuses.
   - **(b) Pre-flight and fall back.** `tabGroups.activeTabGroup.viewColumn` is readable synchronously (`index.d.ts:L19418`), so Conductor could check whether a group exists to the side and whether it holds foreign tabs, requesting `min(max(existingColumns) + 1, 9)` instead. **The NFR3 tension is real:** the documented footgun is *skipping* columns (*"Columns that do not exist will be created as needed up to the maximum of `Nine`"*, `index.d.ts:L7774-L7775`); appending exactly one past the current maximum creates exactly one group, but that depends on `tabGroups.all`'s columns being contiguous — an empirical claim about VS Code, not a type-level guarantee — and on handling the `min(…, 9)` cap. A genuine relaxation of NFR3, and not a call this document should make.
   - **(c) Defer.** Ship (a); open a follow-up if P6 shows reuse and users report it.

### 6.3 Gates, monitoring, and conventions

6. ✅ **ANSWERED — OQ-6: D4's redefined empirical gate is accepted.** *(Repo owner, 2026-08-15.)* § 2.2.1 records that the plan's "P1 and P3 both pass" gate (`docs/plans/2026-08-08-session-pane-grouping.md:L227`) was not met as written and that this spec proceeds on a narrower one. **The redefinition is confirmed: `processId` resolving is treated as necessary *and* sufficient for D4 Option A, and `shellIntegration` timing inconsistency is a monitored risk (§ 2.2.1, § 4, § 5.3), not a blocking retest.** The longer-window `shellIntegration` retest option was explicitly declined — **no P3 retest is required before implementation.**
7. ✅ **ANSWERED — OQ-7: the majority wins after a drag-out, and that is the wanted answer.** *(Repo owner, 2026-08-15.)* Carried from `docs/plans/2026-08-08-session-pane-grouping.md:L326`, where it was left open as a product call. Under FR1 the mechanism already decides it — one tab dragged out does not redirect future launches; a *majority* dragged out does (§ 2.4.1 property 1). **Confirmed as the intended reading; nothing changes.** § 5.2 test 4 locks it.
8. ✅ **ANSWERED (empirically deferred by design) — OQ-8: do editor-area terminal tabs survive a window reload, and do their labels survive with them?** Folded into **P-LABEL case (b)** (§ 2.5, § 2.5.1 Step 4 items 6–8) — the same probe session answers it. **This needs no separate decision**: FR6 already branches correctly on either answer, and a "no such tab survived" result is a legitimate outcome that simply makes FR6's re-congregation inapplicable. Confirmed 2026-08-15 that no design work is pending on it.
9. ⚠️ **PARTIALLY ANSWERED — OQ-9.** The question had two halves and only one is settled.
   - ✅ **Who runs the § 2.5 probes:** the **repo owner, personally**, in the Extension Development Host (2026-08-15). **§ 2.5.1 is the runbook written for that**, and it is the main deliverable of Rev 4.
   - ⚠️ **Still open: who watches the § 5.3 post-ship signals, and for how long,** before the D5 close-detection simplification is reconsidered. **This does not block this spec.** That simplification is blocked on #68's diagnosis regardless (D5, § 3), so the watch-duration question can be answered when #68 is picked up rather than now. Recording it as open rather than silently closing it, because "nobody decided who watches" is exactly how a monitored risk becomes an unmonitored one.
10. **OQ-10: two deviations from the spec template.** `docs/sdd-workflow.md:L156-L182` defines the section set as Problem / Requirements / Scope boundaries / Risks / Open questions / Verification note. This document adds (a) a **Revision history** table after the header lines and (b) a **§ 5 Test plan and mock work** section, which pushes Open questions to § 6. Both are surfaced rather than adopted silently, per the rule against inventing sections. If either is unwanted, (a) folds into § 2.1 as prose and (b) folds into § 2 as NFR6's expansion — neither removal loses content. Nothing in the repo cites this document by section or line number (re-checked 2026-08-15 by `Grep` for the document's basename, **and re-run for the Rev 4 pass before restructuring**: the only hit outside the document itself is the `docs/README.md:L32` index row, which links by path). That re-check is what makes Rev 4's substantial in-place edits safe under `CLAUDE.md` § Citing sources' same-line-substitution rule.

    **Rev 4 adds no third deviation.** § 2.5.1 (the probe runbook) is a **subsection nested inside § 2.5**, not a new top-level section, so the section set the template defines is unchanged. It is placed here rather than in a separate `docs/` file deliberately: `docs/plans/` requires a `**Type:**` drawn from a closed taxonomy (`docs/sdd-workflow.md:L45-L51`) and a probe runbook is neither a `scoping-decision` nor an `implementation-plan` — inventing a sixth type would be a **larger** deviation than a subsection, and `docs/sdd-workflow.md:L57-L73` records that this repo already considered and rejected adding a type value without the full header/frontmatter contract behind it. The runbook also dies with the probe session, so a standing process document (`docs/<name>.md`) is the wrong shape too.

---

## Verification note

- **Repo claims read during this Rev 4 pass**, on 2026-08-15 from the `main` checkout at `I:/ai/claude/vscode-claude-conductor` (clean, at commit `4bfaff2` per the session-start log). Rev 4 changes no requirement and no mechanism, so it re-read only what its own new claims depend on — chiefly § 2.5.1's runbook: `.vscode/launch.json` (in full, 33 lines), `.vscode/tasks.json` (in full, 29 lines), `src/output.ts` (in full), `src/extension.ts:L1-L40` and `L205-L254`, `src/sessionManager.ts:L1-L215`, `src/treeView.ts:L55-L84`, `tsconfig.json` (in full), `package.json:L33-L46`, `L110-L123`, `L236-L295`, `docs/README.md` (in full), `docs/sdd-workflow.md` (in full), `docs/plans/2026-08-08-session-pane-grouping.md:L125-L169`, and `node_modules/@types/vscode/index.d.ts:L19294-L19335` and `L19374-L19415`. Every `.vscode/`, `src/output.ts`, `src/extension.ts`, `src/treeView.ts`, and `package.json` line citation introduced by § 2.5.1 was confirmed in that read. **Rev 3's own citations were not re-read this pass** — see the bullet below for what Rev 3 read and when. **`Bash` and the `mcp__github__*` tools were both unavailable**, so no commit SHA was captured by direct query and no GitHub write or read was performed through the MCP layer.
- **Repo claims re-read during the Rev 3 pass**, on 2026-08-15 from the `main` checkout at `I:/ai/claude/vscode-claude-conductor`: `src/sessionManager.ts:L1-L140`, `L140-L192`, `L185-L324`, and `L320-L389`; `test/mocks/vscode.ts:L120-L283`; `test/sessionManager.uncPosix.test.ts:L50-L89`; `docs/README.md` (in full); `docs/sdd-workflow.md` (in full); and the prior revision of this document (in full). Every `src/sessionManager.ts` line number cited above — `L10`, `L42-L49`, `L90-L137`, `L100-L109`, `L111-L117`, `L120-L125`, `L127-L131`, `L151-L155`, `L157-L180`, `L186-L190`, `L194-L196`, `L199-L211`, `L200-L206`, `L236-L257`, `L260-L262`, `L287-L293`, `L299-L309`, `L315-L318`, `L320-L389`, `L325`, `L338`, `L380` — was confirmed in that read. **No commit SHA was captured**: the `Bash` tool is unavailable in this session. Re-check line numbers after any commit touching these files.
- **Citations carried forward, not re-read this pass:** `package.json:L9`, `L247-L251`, `L265-L270`, `L308`; `test/sessionManager.closeDetection.test.ts:L23`; `test/mocks/vscode.ts:L271-L274` (the `commands` namespace was read at `L271-L274` and confirmed); `docs/plans/2026-08-08-session-pane-grouping.md` line citations; `docs/research/2026-08-08-session-pane-grouping.md:L104-L105`/`:L160-L162`. All were read by Rev 1 or Rev 2 on 2026-08-15.
- **VS Code API claims** — read from `node_modules/@types/vscode/index.d.ts`, resolved from `@types/vscode ^1.93.0`. Re-read verbatim **during this Rev 3 pass**: `L7336-L7360` (`ViewColumn`, including the `Beside` resolution note at `L7350-L7355`), `L7728-L7747` (`Terminal.sendText`/`show`), `L7760-L7789` (`TerminalLocation`, `TerminalEditorLocationOptions`), and `L19270-L19449` (`TabInputTerminal`, `Tab`, `TabChangeEvent`, `TabGroupChangeEvent`, `TabGroup`, `TabGroups`). Line numbers are stable for that installed version and must be re-checked after a dependency bump.
- **The central API fact of this revision, verified directly:** `Tab` (`index.d.ts:L19294-L19332`) exposes `label`, `group`, `input`, `isActive`, `isDirty`, `isPinned`, `isPreview` — no icon, no creator, no owner, no extension id. `TabInputTerminal` (`index.d.ts:L19282-L19287`) is a bare marker class with a zero-argument constructor and no fields. `Tab.label` is documented only as *"The text displayed on the tab"* (`L19299`), with no stated relationship to `Terminal.name`. **The label prefix is therefore the only available discriminator, and § 2.5 P-LABEL is the probe that tells us whether even that one works.**
- **`Beside` resolution semantics are not documented.** `index.d.ts:L7776-L7777` says only *"Use `ViewColumn.Beside` to open the editor to the side of the currently active one."* Whether that reuses an existing side group is `unverified:` here and is § 2.5 P6.
- **`tabGroups.all` iteration order is not documented** (`index.d.ts:L19409-L19413` says only *"All the groups within the group container"*). FR1's tie-break exists so the design does not depend on it; § 5.2 test 8 asserts order-independence.
- **GitHub claims** — the `mcp__github__*` tools and a shell were both unavailable to the Rev 1 pass, so #127, #68, and #110's comment list were fetched via `WebFetch` against `github.com` and the public `api.github.com` REST endpoint on **2026-08-15**. #127 and #68 were confirmed open with their titles and labels read; the five #110 comment IDs, dates, and subjects were read from `/issues/110/comments`. **Neither Rev 2 nor Rev 3 re-fetched any of these** — no GitHub tool was reachable to either pass. **Rev 4 re-fetched exactly one item**, #110 comment `5274827716`, via the `api.github.com` comments endpoint (see the Phase 0 bullet below); it did **not** re-fetch #127's or #68's state, so **the "verified open" claim in this document's `**Tracking issue:**` header line and the #68 state cited in § 4 both remain as of the Rev 1 fetch on 2026-08-15** and should be re-confirmed before the spec is flipped to ACCEPTED.
- **Rev 4 resolved the Phase 0 fetch limitation.** Rev 2 and Rev 3 both recorded that the body of #110 comment `5274827716` came back **summarised by the fetch tool rather than verbatim**, and Rev 3 instructed a future pass to "re-read that comment directly before implementation." **That was done during this Rev 4 pass**: the comment was fetched on **2026-08-15** from the `api.github.com` REST comments endpoint (`/repos/glitchwerks/vscode-claude-conductor/issues/comments/5274827716`) rather than the rendered HTML page, and came back with its markdown headings and **fenced raw-log blocks intact**. Every Phase 0 figure this spec relies on was re-read against those raw logs: ~777 ms tab-arrival with `foundSynchronously=false` (P5), `activeTab.label=""` with `equal=false` on 3 of 3 launches (P2), tier 1 on 4 of 4 closes — **2 of them on the editor-born path** (P1), `processId` resolving immediately in both runs with `shellIntegration` `available` in run 1 and `unavailable` in run 2 (P3), and `tabGroups.all.length=1` across 3 sequential launches (P4). All five confirmed as previously stated. **The raw logs also supplied one fact the summary had dropped** — P4's per-launch `tabs=[...]` dumps, which show settled session tabs reading back as exactly `"claude · job-matcher-pr"` and `"claude · career-ops"`. That is what § 2.2's Rev 4 correction and § 4's narrowed risk row rest on. *(Caveat on the mechanism, stated rather than glossed: the endpoint returns the stored comment body and the fetch tool renders it, so "verbatim" here means "raw log blocks preserved and re-read", not a database-level guarantee.)*
- **Probe instrumentation was written fresh, not recovered.** Rev 3 noted that commit `77477de` ("diag: Phase 0 probe instrumentation for #110 (#122)") is in the log but its code is not in the working tree. **`Bash` was unavailable to this pass as well**, so that commit's contents were still not read. § 2.5.1's patch is therefore written from scratch against the current `main` working tree rather than adapted from `77477de`; the commit is cited only as **precedent for the throwaway-diagnostic-branch pattern**, not as a source of code.
- **§ 2.5.1's patch code was not compiled, run, or type-checked.** No build was run by this pass. It was written against `tsconfig.json`'s `"strict": true` / `"target": "ES2020"` settings and the installed `@types/vscode`, and it deliberately avoids `Tab.input`'s `unknown`-collapsing union (`index.d.ts:L19310`) by testing `instanceof vscode.TabInputTerminal` rather than reading `.constructor.name`. **If `npm: compile` rejects it during Step 3, that is a defect in this runbook** — fix it in the throwaway branch and note the correction on #127.
- **Not verified — requires a running VS Code instance:** P-LABEL, P6, **P-PLACE**, and **P-REVEAL** (§ 2.5), and OQ-8. No VS Code instance was available to any revision pass, which is why § 2.5.1 exists.
- **Not verified:** no tests were run, nothing was compiled, and no code was written by this pass.
