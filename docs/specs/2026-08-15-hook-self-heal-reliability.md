---
title: Hook self-heal reliability — await, path-existence check, and window-focus retry (Issue #128)
touches:
  - src/extension.ts
  - src/hookInstaller.ts
  - test/hookInstaller.test.ts
  - test/extension.hookSelfHeal.test.ts
  - README.md
  - CHANGELOG.md
skills_relevant:
  - simplicity-first
  - test-driven-development
  - hook-authoring
---

# Hook Self-Heal Reliability

**Tracking issue:** [#128 "bug: hook self-heal doesn't fire on extension version bump — stale session-state.js path breaks Stop hook"](https://github.com/glitchwerks/vscode-claude-conductor/issues/128) — verified open, body fetched 2026-08-15.

**Type:** feature-spec

**Status:** DRAFT

## 1. Problem

Claude Conductor installs three Claude Code CLI hooks (`Notification`/idle,
`UserPromptSubmit`/active, `Stop`) into `~/.claude/settings.json`, each
pointing at `hooks/session-state.js` inside the extension's own install
directory (`README.md:110-116`). Because a marketplace update moves that
install directory (VS Code deletes the old versioned folder), the extension
already carries a self-heal path: `ensureHooksInstalled()` compares the
installed hook commands' path prefix against the currently-running
extension's path and rewrites them if stale (`src/hookInstaller.ts:271-288`,
documented to the user at `README.md:120`: "Claude Conductor detects this
automatically on activation and silently updates the paths ... no user
action required").

This self-heal did not fire for a real `1.3.1` → `1.4.1` update (`#128`,
open, fetched 2026-08-15, § Summary): all three hook commands in
`~/.claude/settings.json` kept pointing at the deleted
`...-1.3.1-...\hooks\session-state.js`, and the `Stop` hook failed with
`MODULE_NOT_FOUND` on every session. `#128`'s own investigation
(§ "Code path that should have caught this") narrows this to activation
timing versus a silent failure inside the reconcile path, and asks that the
root cause be confirmed rather than assumed.

Reading the current code confirms a concrete defect that would produce
exactly this symptom regardless of which of those two mechanisms dominates:

- `src/extension.ts:139-141` calls `ensureHooksInstalled(context)` — an
  `async` function (`src/hookInstaller.ts:271-273`) — inside a bare
  `setTimeout`, with no `await` and no `.catch()`. Any exception thrown
  inside that call becomes an unhandled promise rejection: nothing is
  logged, nothing is surfaced to the user, and there is no retry.
- Inside `ensureHooksInstalled`'s reconciliation branch
  (`src/hookInstaller.ts:276-288`), `reconcileHookPaths()`
  (`src/hookInstaller.ts:158-185`) and `writeSettings()`
  (`src/hookInstaller.ts:97-99`, the throwing call is
  `fs.writeFileSync` at `:98`) run with no `try`/`catch` around them. If
  `writeFileSync` throws — plausible from `EPERM`/`EBUSY` if another VS
  Code window is writing the same `settings.json` at close to the same
  moment, since nothing in this file coordinates concurrent writers across
  processes — the rejection produced above is the *only* signal, and
  `extension.ts:139-141` discards it.
- The check that decides whether to reconcile at all,
  `hooksUpToDate()` (`src/hookInstaller.ts:120-147`), is purely a
  version-string-prefix comparison against the hook commands already
  recorded in `settings.json`. It has no independent way to notice that the
  file the recorded command points at no longer exists on disk — if the
  comparison itself is ever wrong, or if reconciliation ran once but the
  write didn't durably land (the race described above), there is no backstop.
- The whole check runs exactly once, 3 seconds after `activate()`
  (`src/extension.ts:139-141`). A transient failure on that single attempt
  — the concurrent-write race above, or any other transient I/O error —
  gets no second chance until the window's extension host restarts.

unverified: prior investigation in this conversation (not present in
`#128`'s comment thread, which has no comments as of 2026-08-15, and not a
file this document can re-verify) reported that exthost logs showed six
legitimate `activate()` calls after the real `1.3.1`→`1.4.1` update, yet
`settings.json` still pointed at the deleted `-1.3.1-` path afterward. If
accurate, this would mean activation-timing alone does not explain the
symptom — `activate()` did rerun, and the reconcile logic still failed to
land a fix — which is consistent with, though not proof of, the
concurrent-write / silently-swallowed-exception theory above. This document
does not rely on that claim: FR-1 through FR-3 below close the gap
regardless of which mechanism (or combination) actually produced this
specific incident, per `#128`'s own § "Suggested directions": "Regardless
of root cause, consider a startup self-check independent of the update
path."

This changes how the extension interacts with `~/.claude/` — hook
installation and the user's global `settings.json` — which this repo's
`CLAUDE.md` § Spec-Driven Development requires a spec for even though #128
is a bug fix with an existing issue, per the explicit override: "That third
case looks small and isn't ... Changes on that surface get a spec even when
the diff is three lines."

## 2. Requirements

**FR-1 — await, catch, and surface reconciliation failures.** The
`setTimeout` callback at `src/extension.ts:139-141` must `await` the
`ensureHooksInstalled(context)` call and wrap it in `try`/`catch`. On
catch, log the error (message and the resolved hook script path) via the
existing output channel (`src/output.ts:17-20`, `log()`) and call
`vscode.window.showErrorMessage` with an actionable message pointing at
that output channel — no more silent unhandled rejection. This does not
change the return value or control flow of `ensureHooksInstalled` itself,
only how its caller handles success and failure.

**FR-2 — path-existence check as an independent self-heal trigger.**
`ensureHooksInstalled`'s reconciliation branch (`src/hookInstaller.ts:276-288`)
must reconcile whenever the hook script file referenced by the installed
commands does not exist on disk, independent of what `hooksUpToDate()`'s
version-string comparison reports. Concretely: after confirming
`hooksInstalled(settings)` is true, resolve the **native filesystem path**
of the current hook script and check it with `fs.existsSync()`; if that
check fails, treat it identically to `hooksUpToDate() === false` (call
`reconcileHookPaths()` + `writeSettings()`). This needs a new export
distinct from the existing `getHookScriptPath()`
(`src/hookInstaller.ts:59-80`): that function returns the **composed shell
command string** (on Windows, git-bash-converted — `toGitBashPath()` at
`hookInstaller.ts:63-68` turns `C:\Users\...` into `/c/Users/...`, which
`fs.existsSync` cannot resolve on Windows), not the raw `hookPath` computed
internally at `hookInstaller.ts:60`. Expose that raw, native-OS path
separately (e.g. a second exported function, or a return-shape change) so
FR-2's existence check has something `fs.existsSync` can actually use.

**FR-3 — retry on window focus, not just on `activate()`.** In addition to
the existing single 3-second-after-`activate()` check
(`src/extension.ts:139-141`), register a
`vscode.window.onDidChangeWindowState` listener in `activate()`
(confirmed API: "An Event\<WindowState\> which fires when the focus or
activity state of the current window changes",
https://code.visualstudio.com/api/references/vscode-api, fetched
2026-08-15) that re-runs the same FR-1-wrapped self-heal check whenever
`state.focused` becomes `true`. This listener must be pushed onto
`context.subscriptions` for cleanup, matching every other disposable
registration already in `activate()` (e.g. `src/extension.ts:120-124`,
`:135`). The check must be naturally retriable — no "already attempted,
don't try again" latch is introduced — so a transient failure (a
concurrent-write race, a momentary file lock) on one focus event gets
retried on a later one instead of persisting until the window's extension
host restarts.

**FR-4 (NFR) — reconciliation is unaffected by the consent flag.** FR-2's
and FR-3's triggers both live inside `ensureHooksInstalled`'s
already-installed branch (`hooksInstalled(settings) === true`,
`src/hookInstaller.ts:276`), which today runs unconditionally — the
existing code comment there ("consent was already granted at initial
install", `hookInstaller.ts:279-280`) already documents why this branch
does not consult `SETUP_DECLINED_KEY`
(`src/hookInstaller.ts:10`, checked only in the *not-installed* branch at
`hookInstaller.ts:290-293`). Neither new trigger may change that: the
"Allow / Not Now / Don't Ask Again" prompt and its `SETUP_DECLINED_KEY`
gating (`hookInstaller.ts:290-323`) stay exactly as they are. This directly
answers `#128`'s Acceptance Criteria item "No regression to the existing
'ask before first install' consent flow."

**FR-5 (NFR) — re-entrancy guard.** Because FR-3 can fire the same check
repeatedly within one running window (fast focus/blur cycling), add a
simple in-flight guard (e.g. a module-level boolean or a held Promise) so
that an `ensureHooksInstalled` call already in progress is not started a
second time by an overlapping `activate()`-timer or window-focus trigger
within the same process. This guards only against re-entrancy *within one
VS Code window's extension host* — see Risk 3 for the cross-window case
this does not solve.

## 3. Scope boundaries

**In scope:**
- `src/extension.ts`: awaiting/catching the existing `ensureHooksInstalled`
  call (FR-1), the new `onDidChangeWindowState` listener (FR-3), and
  routing failures through the existing output channel and
  `showErrorMessage`.
- `src/hookInstaller.ts`: the native hook-script-path export and
  `fs.existsSync` check (FR-2), the branch merge with the existing
  `hooksUpToDate()` check, and the in-flight guard (FR-5).
- Tests for: the awaited/caught failure path surfacing an error (FR-1), the
  path-existence trigger firing reconciliation independent of a
  version-string match (FR-2), the window-focus listener re-invoking the
  check and being registered as a disposable (FR-3), the consent-flow
  no-regression guarantee (FR-4), and the in-flight guard preventing a
  double-run (FR-5).
- `README.md:120` — update to describe both the version-string trigger and
  the path-existence/window-focus triggers, so the documented behavior
  matches what actually runs.
- `CHANGELOG.md` — an `## [Unreleased]` entry.

**Out of scope** (per `#128`, open, fetched 2026-08-15, and this document's
own risk analysis):
- A real cross-process lock or mutex for concurrent writes to
  `~/.claude/settings.json` from multiple VS Code windows. FR-3's retry
  loop makes a transient loss *eventually* self-correcting within a running
  window, but does not add interprocess coordination — see Risk 3.
- Rate-limiting or backoff scheduling for repeated failure notifications
  beyond FR-3's "retry on next focus event" — see Open Question 1.
- Any change to `hooks/session-state.js` itself, or to the
  `Notification`/`UserPromptSubmit`/`Stop` hook wiring it implements
  (`README.md:112-116`).
- Changing `hooksUpToDate()`'s version-string comparison algorithm — FR-2
  adds a second, independent trigger alongside it rather than replacing it.

## 4. Risks

**Risk 1 — `getHookScriptPath()` conflates the shell-command string with
the native path.** FR-2 depends on a path `fs.existsSync` can resolve;
`getHookScriptPath()` (`hookInstaller.ts:59-80`) currently returns only the
composed, git-bash-converted command string on Windows. **Mitigation:**
FR-2 explicitly requires exposing the raw `hookPath`
(`hookInstaller.ts:60`) separately, verified by reading the function before
writing this requirement rather than assumed.

**Risk 2 — window-focus events can fire in rapid bursts** (alt-tabbing,
multi-monitor setups moving focus quickly). Without FR-5's guard, this
could produce redundant `fs`/`readSettings`/`writeSettings` work in the
best case, or overlapping writes to `settings.json` from the *same*
process racing each other in the worst case. **Mitigation:** FR-5's
in-flight guard.

**Risk 3 — the residual cross-window race is not fully solved.** The
concurrent-write theory in § 1 — two separate VS Code windows both writing
`~/.claude/settings.json` near-simultaneously — is not something a
single-process in-flight guard (FR-5) or a same-process retry loop (FR-3)
can fully prevent; a write from window A can still be clobbered by a write
from window B in the narrow interval between A's read and A's write.
FR-1–FR-3 make a lost write *visible* (FR-1) and *eventually
self-correcting* (FR-3, since the next focus event re-checks from scratch)
rather than *impossible*. Whether that residual risk needs real
interprocess locking is Open Question 2 — flagged, not resolved, by this
spec.

**Risk 4 — repeated failure notifications could be noisy.** If the
underlying cause is persistent rather than transient (e.g. a real
permissions problem on `~/.claude/settings.json`, not a momentary lock),
FR-1's `showErrorMessage` could fire on every focus event FR-3 triggers,
which is intrusive rather than helpful. **Mitigation:** deferred to Open
Question 1 — not resolved by this spec.

## 5. Open questions

1. Should FR-1's `showErrorMessage` be rate-limited (e.g. once per VS Code
   session, or once per distinct error message/path) so a persistent
   failure doesn't produce a popup on every window-focus retry (FR-3, Risk
   4)? ⚠️ **Confirmation needed.**
2. Should real interprocess coordination (a lock file, or a
   compare-and-swap write pattern) for `~/.claude/settings.json` be scoped
   as a follow-up issue, given FR-1–FR-3 only make the residual
   cross-window race (Risk 3) visible and eventually self-correcting, not
   eliminated? ⚠️ **Confirmation needed.**
3. FR-5's in-flight guard is described as "a module-level boolean or a held
   Promise" — implementation detail, not blocking, left to the
   implementation step.

## Verification note

Repo claims in this document were read at commit `a767789`
(`git -C I:/ai/claude/vscode-claude-conductor rev-parse HEAD`, 2026-08-15)
on `main`: `src/extension.ts:1-180` (activation, disposables, the
`ensureHooksInstalled` call site), `src/hookInstaller.ts:1-368` (full file
— `getHookScriptPath`, `readSettings`, `writeSettings`, `hooksUpToDate`,
`reconcileHookPaths`, `ensureHooksInstalled`, `setupHooksCommand`),
`src/output.ts:1-33` (the existing `log()` output-channel helper),
`README.md:100-124` (documented hook behavior, including the existing
self-heal description this document updates), `package.json:1-36`
(`activationEvents`: `onStartupFinished`, `onUri` — confirms `activate()`
runs once per window at startup rather than needing an additional
"workspace open" trigger, which is why FR-3 is scoped to window-focus
rather than workspace-folder-open), and `test/hookInstaller.test.ts:1-60`
(existing test conventions this document's proposed tests should follow).
`#128` was fetched via `gh issue view 128 --repo
glitchwerks/vscode-claude-conductor` on 2026-08-15 and is open, with zero
comments — the "six `activate()` calls" claim in § 1 could not be verified
against the issue thread and is marked `unverified:` accordingly, sourced
only from prior investigation earlier in this conversation. The
`onDidChangeWindowState` API claim (FR-3) was confirmed via
https://code.visualstudio.com/api/references/vscode-api (fetched
2026-08-15); the `WindowState.focused` field itself was not directly
quoted from that fetch and is treated as VS Code's standard documented
shape rather than independently re-verified in this pass. No repo tooling
was unavailable; `gh`, `git`, `Read`, `Grep`, and `WebFetch` were
sufficient for every claim above.
