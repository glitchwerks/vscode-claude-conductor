# External landscape survey — VS Code, Claude Code CLI, and competing extensions

## Idea

Survey what has changed in the external landscape (VS Code extension API, Claude Code CLI, and the VS Code marketplace) since vscode-claude-conductor was last actively developed, to flag opportunities and risks against its open pain points: issue #68 (close-detection unreliable on long-running sessions), issue #33 (adopting externally-launched sessions from the official Claude Code extension), issue #44 (spike on a custom pty/process-wrapper), and issue #76 (suppressing VS Code terminal restore).

## Requirements

1. Candidate must be a verifiable, dated source (GitHub repo + commit/push date, PR/issue with milestone, or docs page fetched with a date) — no uncited claims.
2. For VS Code API findings: must bear directly on terminal lifecycle/state detection, editor tabs, `TreeDataProvider`, or terminal-restore suppression — not general VS Code feature news. Primary sources (release-notes markdown from `microsoft/vscode-docs`, PRs/issues on `microsoft/vscode`) take priority over web-search summaries of those same pages.
3. For Claude Code CLI findings: must bear on the hook system (`hookInstaller.ts` installs `Notification`/`UserPromptSubmit`/`Stop`) or on session/state file formats Conductor could read.
4. For competing extensions: must actually manage Claude Code (or a generic AI-CLI) sessions as tabs/sidebar entries across projects — not general chat-panel AI assistants.
5. Deal-breaker for "worth borrowing" candidates: no license file / unclear license is a flag, not an automatic drop, but must be reported.
6. Every finding states an explicit **Assessment: opportunity | risk | neutral** — not left implicit in the maturity/lift fields.

## Search axes used

- **Direct synonyms** — "VS Code terminal API changes 2026", "Claude Code hooks changelog", "Claude Code VS Code extension sessions"
- **Problem-shape synonyms** — "terminal close detection reliability", "onDidCloseTerminal unreliable", "process liveness check", "session lifecycle tracking", "agent CLI shell type detection"
- **Adjacent domains** — pty/process-wrapper prior art (`Pseudoterminal`, `isTransient`), PID-file liveness patterns used by other session managers, OSC terminal title-sequence conventions used by AI CLIs generally
- **Vendor-specific phrasing** — `code.visualstudio.com/updates` + primary `microsoft/vscode-docs` release-notes markdown, `code.claude.com/docs/en/hooks` reference, `microsoft/vscode` issue/PR tracker, VS Code Marketplace listings
- **Negative axes** — chat-panel-only AI assistants with no tab/sidebar session model; generic "AI pair programmer" extensions unrelated to CLI session orchestration; Anthropic roadmap items about chat UX rather than terminal/session management

## Shortlist (ranked by expected value)

### 1. VS Code core now natively detects Claude Code (and other agent CLIs) inside a terminal via OSC title sequences — `terminal.integrated.tabs.allowAgentCliTitle`

- **URL:** primary sources: `https://github.com/microsoft/vscode/issues/311191` "TPI) AI CLI as Shell Type and Terminal Title" (test-plan item, milestone `1.117.0`, closed 2026-04-20 — fetched 2026-07-29); `https://github.com/microsoft/vscode/pull/324417` "Detect Command Code as an agent CLI for terminal tab titles" (merged 2026-07-14, milestone `1.130.0` — fetched 2026-07-29, contains implementation detail below); `https://github.com/microsoft/vscode/issues/311046` "Add more AI CLIs as shell type" (open backlog item, fetched 2026-07-29); `https://github.com/microsoft/vscode/issues/311324` and `#311326` (test-plan bug reports naming Claude Code and Codex explicitly, fetched 2026-07-29)
- **Relevance:** addresses #33 directly. Since ~VS Code 1.117 (April 2026), VS Code's own terminal core recognizes known agent CLIs — **explicitly including Claude Code by name** ("like Claude Code, the CLI runs as `node` on POSIX, so the title sequence is the cross-platform detection signal" — PR #324417) — via a `GeneralShellType` enum, OSC 0/2 title-sequence pattern matching in `terminalInstance.ts`, a POSIX process-name map in `terminalProcess.ts`, and a Windows `node.exe` command-line pattern in `windowsShellHelper.ts`. This is a fundamentally more robust detection mechanism than Conductor's current approach of string-matching the terminal name it assigned itself (`SESSION_NAME_PREFIX = "claude · "`, `sessionManager.ts:6`) — VS Code core now knows "this terminal is running Claude Code" **regardless of who launched it**, which is exactly issue #33's blocker (detecting Claude Code terminals opened by the official Anthropic extension's "Open in Terminal", which Conductor didn't create and can't name-match).
- **Maturity:** shipped, stable, actively extended — the CLI allowlist keeps growing (Command Code added July 2026 via #324417; Claude Code, Codex CLI, GitHub Copilot CLI, and Gemini CLI were the original four per the #311191 test matrix). `#311046` (open) shows Microsoft wants more CLIs added, and would likely accept a PR adding recognition for anything Conductor itself might want detected.
- **Worth borrowing:** none of the detection code itself needs to be borrowed — the open question is whether this internal `GeneralShellType` classification is exposed to extensions at all (see Open Questions). If it is not exposed via a public API, the *pattern* (matching Claude Code's own OSC 0/2 title-sequence emissions, which Conductor's own launched terminals already produce since Claude Code sets its own title) is reimplementable directly by having Conductor read terminal title changes itself, without needing VS Code's internal enum.
- **What to avoid:** an open, unresolved reliability bug exists in this exact subsystem — `https://github.com/microsoft/vscode/issues/327279` "Terminal tab actions become unresponsive during frequent OSC title updates" (opened 2026-07-24, fetched 2026-07-29, still open): frequent OSC-title updates from an active agent CLI (reproduced with Codex CLI, but the mechanism is CLI-agnostic) make terminal-tab trash/split/rename actions freeze while the CLI is actively working. This is circumstantial but plausible adjacent evidence for issue #68's "why does closing an active/long-running Claude session sometimes not register" — if VS Code's own tab-action dispatch can stall under frequent title churn, a close event könnte plausibly be affected too, though the linked bug is about explicit UI actions, not the `onDidCloseTerminal` event.
- **Assessment: opportunity (primary) / risk (secondary, via #327279).** This is the strongest single finding in the whole survey for #33, and a plausible contributing-cause lead for #68 worth checking against the diagnostic logging #68 already plans to add.
- **Lift effort:** study-only until the extension-API-exposure question is resolved; likely adapt-pattern (re-detect via title-sequence matching in Conductor's own code) if no public API exists.

### 2. Claude Code's native `~/.claude/sessions/<pid>.json` liveness files — addresses #68

- **URL:** `https://github.com/anthropics/claude-code/issues/34210` "Bug: Claude Code silently deletes user files from ~/.claude/sessions/ — DATA LOSS" (fetched directly via `mcp__github__get_issue`, 2026-07-29; closed 2026-03-26 as fixed). The issue body quotes Claude Code's own (de-minified) cleanup function directly: `getSessionsDir()` returns `~/.claude/sessions/`; on every session start the CLI registers its own `<pid>.json`, then runs a `concurrentSessionCleanup()` pass that `process.kill`-probes every other numeric-prefixed file and deletes ones whose PID is dead. Independently corroborated by `https://github.com/borball/claude-session-manager/blob/main/src/services/SessionDiscovery.ts` (commit `c01b5173bc0f776233e390f8de1fb2c65798b0b1`, pushed 2026-03-31), a third-party extension that *reads* (never writes) that same directory to cross-check JSONL-derived sessions against live PIDs.
- **Relevance:** addresses #68. Gives a process-liveness signal (`process.kill(pid, 0)`) that is independent of `vscode.window.terminals` / `onDidCloseTerminal` and therefore immune to the terminal-identity-drift and stale-PID-index hypotheses in #68's own investigation plan.
- **Maturity:** confirmed CLI-native behavior (not third-party-invented), but the directory's own cleanup logic had a real, high-priority data-loss bug (labels `bug`, `high-priority`, `data-loss` on #34210) that was fixed by the time of this survey — meaning the mechanism is real but Anthropic's own code has previously mishandled edge cases in this exact directory. Confirmed **not WSL-affected** per the bug report (WSL is explicitly excluded from the delete branch), and confirmed to run on "every session start... every autocompact... [and] periodically via the tips system" — i.e., frequently, which is reassuring for freshness but is exactly the "silent side effect nobody documented" pattern worth treating cautiously.
- **Worth borrowing:** the technique — cross-check terminal-derived session state against `~/.claude/sessions/*.json` PID liveness as a second, independent signal, mirroring `SessionDiscovery.discoverAllSessions()`'s active-session merge logic.
- **What to avoid:** treating the directory/format as a stable public contract — it is undocumented by Anthropic (found only via a bug report and a third-party extension's reverse-engineering), and its own cleanup code has already shipped one destructive bug in this area. Do not write to this directory.
- **Assessment: opportunity.** A genuinely useful root-cause-independent liveness signal for #68, with the caveat that it's unofficial and its format could change without notice.
- **Lift effort:** adapt-pattern — reimplement the liveness check directly in `sessionManager.ts`.

### 3. `SessionEnd` hook event — CLI-native session-termination signal, complements #68

- **URL:** `https://code.claude.com/docs/en/hooks` (fetched 2026-07-29, via `WebFetch`)
- **Relevance:** addresses #68. `SessionEnd` fires with matchers `clear | resume | logout | prompt_input_exit | bypass_permissions_disabled | other` when a Claude Code session terminates — a CLI-originated "this session is over" signal that `hookInstaller.ts` does not currently install (it installs `Notification[idle_prompt]`, `UserPromptSubmit`, and `Stop` only). `Stop` fires per-turn, not per-session-end, so it cannot substitute.
- **Maturity:** documented, current as of fetch date; hooks were broadly expanded (secondary sources describe growth from ~14 to 25+ events including `SessionEnd`, `PostCompact`, `ConfigChange`, `WorktreeCreate`/`Remove` — `https://www.morphllm.com/claude-code-hooks`, fetched 2026-07-29, unverified: exact version number where the expansion landed) but `SessionEnd` itself is confirmed present and documented at the primary source.
- **Worth borrowing:** installing a `SessionEnd` hook (same `command`-type pattern already used in `installHooks()`, `hookInstaller.ts:139-170`) that writes a terminal state-file marker Conductor's `stateWatcher.ts` can read as a fourth, CLI-authoritative closure signal.
- **What to avoid:** relying on `SessionEnd` alone for the #68 X-close-tab case — unverified whether the CLI process gets a chance to run its hook chain when VS Code kills the terminal process on tab close (SIGHUP/SIGTERM) vs. a graceful CLI exit (`/exit`, ctrl+D). This is the single most decision-relevant open question from this survey (see Open Questions) and needs an empirical check, not a documentation read.
- **Assessment: opportunity, contingent on the SIGTERM open question.** If `SessionEnd` doesn't fire on abrupt kill, its value narrows to the graceful-exit case only, which is a smaller slice of #68's reported symptom (X-ing the tab).
- **Lift effort:** adapt-pattern — small, additive change to `hookInstaller.ts` plus a state-watcher read path.

### 4. `ShahadIshraq/claude-session-vs-code-extension` ("Claude Sessions Explorer") — closest actively-maintained competitor

- **URL:** `https://github.com/ShahadIshraq/claude-session-vs-code-extension` (default branch `master`, pushed 2026-07-18 — 11 days before this survey)
- **Relevance:** addresses a subset of the requirements space Conductor covers — browsing/resuming Claude Code sessions from a sidebar, launching `claude --resume <id>` in a terminal. Does **not** address Conductor's editor-tab-promotion model, multi-workspace folder grouping, or idle-notification hooks; it is JSONL-session-browser-shaped, not live-terminal-management-shaped.
- **Maturity:** actively maintained (CI badge, `mocha`+`c8` test suite with a 60% coverage gate, marketplace + Open VSX listings, semantic versioning at v0.3.1), MIT license, `engines.vscode ^1.90.0`.
- **Worth borrowing:** its `Rename Session` / `Delete Session` / bulk-selection UX is a feature Conductor doesn't have; its virtual-tab prompt preview avoids "unsaved changes" prompts by using a `WebviewPanel` instead of a real file — a pattern worth knowing about if Conductor ever adds a read-only content view.
- **What to avoid:** none observed — codebase and README read as good-faith, narrowly-scoped, non-overlapping in core mechanism.
- **Assessment: neutral.** Not an obsolescence risk (different core mechanism) and not directly reusable (different problem), but worth knowing it exists and is actively maintained in case scope ever converges.
- **Lift effort:** study-only.

### 5. `kevin-ghfr/vscode-claude-sessions` — JSONL `end_turn` detection, hook-free idle signal

- **URL:** `https://github.com/kevin-ghfr/vscode-claude-sessions` (single push 2026-03-26, no activity since; **no `LICENSE` file found** — `mcp__github__get_file_contents` returned 404 for `LICENSE`)
- **Relevance:** demonstrates an alternative to Conductor's hook-installation model for idle detection: a `vscode.workspace.createFileSystemWatcher` on `~/.claude/projects/**/*` (`src/claude-watcher.ts:12-40`) that reads Claude's own JSONL transcript files and looks for `end_turn` / `stop_sequence` / `ExitPlanMode` / `AskUserQuestion` markers to infer completion — no hook installation into `~/.claude/settings.json` required at all. This is a materially different architecture from Conductor's `hookInstaller.ts` + `stateWatcher.ts` pair.
- **Maturity:** effectively abandoned (one commit, no updates in 4+ months as of this survey), and **unlicensed**.
- **Worth borrowing:** the idea of watching `~/.claude/projects/<encoded-path>/*.jsonl` directly as a hook-free idle/completion signal — a genuine architectural alternative worth surfacing for any future rethink of Conductor's notification pipeline, though a bigger change than adding `SessionEnd` (finding #3).
- **What to avoid:** copying source code verbatim given the missing license; the technique still requires the same cwd→encoded-path mapping problem that #33 already has to solve.
- **Assessment: opportunity (architecture idea only), risk if copied verbatim (no license).**
- **Lift effort:** study-only, not adapt-pattern, given the license gap.

### 6. `borball/claude-session-manager` — PID-liveness + file-snapshot diff technique (stale project, live technique)

- **URL:** `https://github.com/borball/claude-session-manager` (commit `c01b5173bc0f776233e390f8de1fb2c65798b0b1`, pushed once on 2026-03-31, no activity since)
- **Relevance:** the source of finding #2's PID-liveness technique; also demonstrates a file-snapshot diff technique for tracking Claude's file changes without git, orthogonal to Conductor's current scope.
- **Maturity:** effectively abandoned — single push, no commits since April 2026, MIT license per README, no CI badge, no releases visible.
- **Worth borrowing:** the PID-liveness cross-check pattern in `SessionDiscovery.discoverAllSessions()` (`src/services/SessionDiscovery.ts:34-46`) and the `SnapshotService` file-snapshot-at-session-start pattern.
- **What to avoid:** the project itself is not a dependency candidate (abandoned, no visible test suite), only the pattern.
- **Assessment: opportunity (pattern only).**
- **Lift effort:** adapt-pattern.

### 7. `Notification` hook matcher expansion — `agent_needs_input` / `agent_completed`

- **URL:** `https://code.claude.com/docs/en/hooks` (fetched 2026-07-29)
- **Relevance:** `hookInstaller.ts:165` currently installs only the `idle_prompt` matcher for the `Notification` event. The documented matcher list now also includes `agent_needs_input` and `agent_completed`, more precisely named for the "session needs attention" signal Conductor's idle-bell UX approximates.
- **Maturity:** documented, current as of fetch.
- **Worth borrowing:** the `agent_needs_input` / `agent_completed` matchers as a more explicit alternative or supplement to `idle_prompt`.
- **What to avoid:** don't assume `idle_prompt` is deprecated — no source found says so; this is additive, not a forced migration.
- **Assessment: opportunity, low effort.**
- **Lift effort:** drop-in (one more `appendHook` call, same pattern already in the file).

### 8. Anthropic's official Claude Code VS Code extension — no roadmap commitment to tabbed/multi-session UI (informs #33)

- **URL:** `https://github.com/anthropics/claude-code/issues/37354` "Tabbed conversations in VS Code extension panel" (fetched 2026-07-29) — closed with labels `area:ide`, `enhancement`, `platform:vscode`, `stale`; no maintainer roadmap statement recorded on the issue.
- **Relevance:** informs #33's obsolescence-risk question. The official extension's chat panel remains single-active-conversation-plus-history-dropdown; a request for tab-bar-style multi-conversation UI in the *panel* was closed as "not planned." This doesn't touch #33's actual mechanism (adopting terminals opened via "Open in Terminal") — it's evidence about a *different* surface not converging toward Conductor's terminal-tab model.
- **Maturity:** n/a (issue-tracker signal).
- **Worth borrowing:** none — risk-assessment data point, not a pattern.
- **What to avoid:** don't read "closed as not planned" as a permanent commitment — several related requests (#10747, #24377, #26135, #11145) were also filed, suggesting real demand in this space.
- **Assessment: neutral-to-opportunity (reduces, doesn't eliminate, obsolescence risk).**
- **Lift effort:** n/a — informational only.

### 9. `es6kr/claude-code-sessions` monorepo — actively maintained, adjacent but different niche

- **URL:** `https://github.com/es6kr/claude-code-sessions` (pushed 2026-07-27, two days before this survey — most recently active of all repos found)
- **Relevance:** ships an MCP server, web UI, and VS Code extension for browsing/renaming/splitting/cleaning up Claude Code session *transcripts* (JSONL data management), not live-terminal orchestration. Overlaps with Conductor only at the edges (both read `~/.claude/projects`).
- **Maturity:** actively maintained, MIT license, npm-published packages, versioned `@latest`/`@beta` releases.
- **Worth borrowing:** confirms `~/.claude/projects/<encoded-path>/*.jsonl` is a stable enough surface that multiple independent projects build on it; `split_session` / `delete_message` operations are a different problem than Conductor solves.
- **What to avoid:** n/a — low overlap risk.
- **Assessment: neutral.**
- **Lift effort:** study-only.

## Circumstantial leads (excluded from ranked shortlist)

The finding below is sourced from dated primary documents, but its own hedging language ("circumstantial," "weak circumstantial support," "no direct causal link found") signals a speculative connection rather than a scored candidate — it carries `Worth borrowing: none` and `Lift effort: n/a`, so it does not belong in a list ranked by expected value. It is excluded from the ranked shortlist above on relevance-strength grounds and kept here as a lead worth revisiting, not because its citations are unverified.

### 10. Adjacent VS Code terminal-service reliability changes (1.130/1.131) — circumstantial context for #68

- **URL:** `https://github.com/microsoft/vscode-docs/blob/main/release-notes/v1_131.md` (fetched via `mcp__github__get_file_contents`, 2026-07-29) lists three merged memory-leak fixes touching terminal internals specifically in that release: `terminalProcessManager` (PR #326930), `terminalService` (PR #327156), `mainThreadTerminalService` (PR #327155). The same release-notes page also credits fixes to `abstractTaskService` and `debugModel` in the same memory-leak cleanup pass — noted here for completeness only, since they touch task-execution and debug-session internals, not the terminal service, and are **not** evidence for this finding's #68 hypothesis. `https://github.com/microsoft/vscode-docs/blob/main/release-notes/v1_120.md` separately credits PR #306955 "guarantee that return of `TreeDataProvider.getChildren()` is not mutated by vscode" (merged, milestone 1.120, May 2026) — likewise unrelated to the terminal service; it is retained here only because the "No prior art found" section below cross-references it as finding #10, not as support for the terminal-service hypothesis.
- **Relevance:** the three terminal-specific fixes above (`terminalProcessManager`, `terminalService`, `mainThreadTerminalService`) are not new terminal-close-detection APIs, but they are real, recent (April–July 2026), primary-sourced evidence that VS Code's terminal service internals have had multiple memory-leak-class bugs fixed in the exact window Conductor has been dormant — circumstantial support for #68's working hypothesis that "state that drifts over the session's lifetime" could originate in VS Code's own terminal service rather than in Conductor's code. The `abstractTaskService`, `debugModel`, and `TreeDataProvider` items noted above carry no such support — they are unrelated subsystems included only for citation completeness, not additional evidence for this finding.
- **Maturity:** all merged/shipped as of the versions cited.
- **Worth borrowing:** none — informational only, supports #68's existing diagnostic-logging plan rather than replacing it.
- **What to avoid:** don't over-read this as "the bug is now fixed" — none of the three terminal-specific leak fixes is described as terminal-close-event-related; they're general internal leak fixes. Don't cite the `abstractTaskService`/`debugModel`/`TreeDataProvider` items as broader terminal-service support — they are unrelated fixes, not part of this finding's evidence base.
- **Assessment: neutral-to-opportunity** (weak circumstantial support that upgrading Conductor's `engines.vscode` floor past 1.93 might incidentally help #68, but no direct causal link found). **Excluded from the ranked shortlist** — its own hedging language marks it as a lead, not a scored candidate; see the section intro above.
- **Lift effort:** n/a — informational; if pursued, would mean raising `engines.vscode` in `package.json:9`, a compatibility decision outside this survey's scope.

## Confirmations — mechanisms that already existed and remain unchanged (not "changes," but resolve open questions in #76/#44)

These are not landscape *changes* in the surveyed window; they're included because they directly answer acceptance-criteria questions in the open issues and were confirmed, not assumed.

- **`isTransient: true` on `createTerminal`** — stable since VS Code 1.65 (2022; corroborated via `https://github.com/microsoft/vscode-js-debug/issues/1196`, fetched 2026-07-29, which describes VS Code's own JS debugger using it for the same "don't restore this terminal" purpose). This directly answers issue #76's acceptance criterion "verify via current VS Code API docs that this is the correct mechanism for 'do not restore'" — confirmed still current as of the v1.131 (July 29, 2026) release notes reviewed, with no open issue found describing it failing to suppress restore. **Assessment: opportunity (resolves a stated open question in #76 with no counter-evidence).**
- **`TerminalShellIntegration` / `window.onDidEndTerminalShellExecution`** — stable since VS Code 1.93 (August 2024, `https://code.visualstudio.com/updates/v1_93`, fetched 2026-07-29) — already Conductor's own `engines.vscode` floor, so no version bump needed to use it. Reliability caveats are real and open: `https://github.com/microsoft/vscode/issues/242897` "Improve reliability of TerminalShellIntegration.executeCommand" (fetched 2026-07-29, open) documents that `HasRichCommandDetection` is not always accurate and "Basic" shell-integration quality doesn't support full exit-status detection. Partially relevant to #44's question about in-process stdout parsing, but this detects command start/end within a still-open terminal, not terminal *closure* — it cannot replace #68's close-detection need. **Assessment: opportunity for #44 (with caveats), not applicable to #68.**

## No prior art found

- **Editor tab groups API changes affecting the "terminal promoted to editor tab" mechanism** — read four full release-notes files (`v1_115`, `v1_120`, `v1_125`, `v1_130`, `v1_131`) directly from `microsoft/vscode-docs` (primary source, not the rendered/summarized page) plus a GitHub issue search on `microsoft/vscode` for terminal-API additions; no changes surfaced that alter how a `vscode.Terminal` is moved into the editor area. Conductor's `moveToEditor` mechanism in `sessionManager.ts` appears to rest on unchanged ground.
- **`TreeDataProvider` API changes affecting `treeView.ts` / `projectGrouping.ts`** — one incidental bugfix found (finding #10, PR #306955, "guarantee `getChildren()` return is not mutated," 1.120/May 2026) but no contract or signature changes.
- **A validated reference implementation for issue #44's core question** ("what does Claude Code itself do internally for its own PTY management, and is there prior art to crib from") — no public writeup or reference implementation describing Claude Code's internal pty/process architecture in reusable terms. The `~/.claude/sessions/*.json` liveness mechanism (finding #2) is the closest adjacent artifact, but it's a side effect of Claude Code's own telemetry, not a documented API, and doesn't answer #44's packaging/native-dependency questions (node-pty, ConPTY, VSIX size). This remains original spike work.
- **A first-party VS Code API change specifically improving `onDidCloseTerminal` reliability for long-running terminals** — none found in the four release-notes files read directly, nor in the `microsoft/vscode` issue search. The one open reliability issue found in this area (`#327279`, terminal-tab-action freezing under frequent OSC title updates) is adjacent but distinct from the close-event path #68 investigates.

## Recommended handoff

- `user` — decide whether VS Code's built-in agent-CLI terminal detection (finding #1) changes the shape of issue #33's spike: rather than (or in addition to) sampling the official extension's terminal-naming pattern, the spike could investigate whether `GeneralShellType`/agent-CLI classification is exposed to extensions at all, since if it is, it's a materially more robust detection primitive than name-matching.
- `user` — decide whether the `~/.claude/sessions/*.json` PID-liveness cross-check (finding #2) and/or a `SessionEnd` hook (finding #3) should be folded into issue #68's still-open diagnostic investigation, alongside checking whether the open VS Code terminal-tab-freeze bug (`#327279`, finding #1's "what to avoid") is a contributing factor.
- `project-planner` — for issue #76, the Confirmations section resolves the stated acceptance-criterion question (`isTransient` is the correct, currently-stable mechanism, no counter-evidence found); the planner can treat that as resolved and move directly to the removal/cleanup work already scoped in the issue body.
- `user` — the license gap on `kevin-ghfr/vscode-claude-sessions` (finding #5) means its JSONL-watching *pattern* is fine to reimplement from scratch but its code should not be copied.

## Open questions

- **Is VS Code's internal `GeneralShellType` / agent-CLI classification (finding #1) exposed to extensions via any public API** (e.g., on `Terminal` or `TerminalState`), or is it purely an internal rendering detail driving the tab-title label? This determines whether Conductor could consume it directly or would need to reimplement OSC-title-sequence matching itself. Not resolved by any source found in this survey — the PRs describe internal `terminalInstance.ts`/`terminalProcess.ts`/`windowsShellHelper.ts` changes, not `vscode.d.ts` additions, which is weak evidence it's internal-only, but this wasn't confirmed against the extension API type definitions directly.
- Whether Claude Code's `SessionEnd` hook actually fires when VS Code kills a terminal process abruptly (tab X-close → SIGHUP/SIGTERM) versus only on graceful CLI exit — the single most decision-relevant unknown for issue #68, not resolved by any source found; needs an empirical check (the same kind of diagnostic logging #68 already proposes), not a documentation read.
- Exact Claude Code CLI version where the hook-event expansion (roughly 14 → 25+ events, including `SessionEnd`) landed — secondary sources gave conflicting version-number framing and no single authoritative changelog entry was found pinning the introduction date; the primary docs page confirms current behavior but not history.
- Whether `~/.claude/sessions/*.json` is written for *every* Claude Code session or only under certain invocation modes (e.g., background/daemon sessions, per an unrelated `claude daemon status` reference surfaced during search) — the borball extension's read-only usage assumes it's universal, but this wasn't independently verified against Claude Code's source beyond the #34210 bug report's description of "every session start."
- Whether the terminal-tab-action freeze bug (`#327279`) has any interaction with Conductor's poll-driven `reconcile()` (`stateWatcher.ts`) — plausible but not tested; flagged only as a lead for #68's own diagnostic work, not a confirmed cause.
