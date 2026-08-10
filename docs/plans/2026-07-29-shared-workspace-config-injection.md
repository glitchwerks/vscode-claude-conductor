---
title: Shared workspace-level config injection into every Conductor-launched Claude session
touches:
  - src/sessionManager.ts
  - src/config.ts
  - package.json
  - README.md
  - test/**
  - src/hookInstaller.ts
  - hooks/**
skills_relevant:
  - hook-authoring
  - simplicity-first
---

# Shared workspace-level config injection — scoping plan

**Tracking issue:** [#81 "Spike: shared workspace-level config (CLAUDE.md-equivalent) injected into every session"](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/81) — verified open, body fetched 2026-07-29. Issue #81 states its own boundary: *"Out of Scope: Implementation (scoping/planning only)."*
**Type:** scoping-decision
**Status:** SUPERSEDED BY `docs/specs/2026-08-09-shared-workspace-config-injection.md` (ACCEPTED 2026-08-09) — that spec resolves D1–D7, dissolves the Phase 0 gate, selects route R1, and is the only document to implement from. This plan is retained, not deleted: its §2 verified facts are cited by line number from `docs/specs/2026-07-29-foundational-project-spec.md`, and its §12 records the `unverified:` provenance behind the spec's §2.5 path-resolution table. Its own `src/` citations are stale (see the spec's Verification note) — do not reuse them.

**Prior inputs consumed (not re-derived):**
- Prior-art research: `docs/research/2026-07-29-shared-workspace-config-injection.md`
- Pre-run in-repo Explore map (embedded in the dispatch brief; every claim below re-verified against source with file:line citations)

---

## 1. The idea, restated

A single shared config — a `CLAUDE.md`-equivalent body of project conventions — should reach **every** Claude Code session that Conductor launches from one VS Code workspace, layered **on top of** (not replacing) whatever `CLAUDE.md` each session's own directory already provides. The intent is that a VS Code workspace becomes a coherent collection of Claude sessions working on different parts of a codebase — different folders, different worktrees, possibly entirely different repos — all sharing one set of conventions. (Restated from issue #81's own description — verified open, body fetched 2026-07-29 — and captured verbatim in `docs/research/2026-07-29-shared-workspace-config-injection.md` § Idea.)

Confirming my understanding of the shape: Conductor launches one terminal per folder, each with its own `cwd`, each running an independent `claude` invocation (`src/sessionManager.ts:97-111`). There is no shared process and no shared Claude session to attach config to. Any "shared config" must therefore be applied **N times, once per launched session** — there is no single place to put it once. That is the core constraint the whole design follows from.

---

## 2. Verified facts (foundation — every claim below is checked, not recalled)

### 2.1 There is no native workspace-scoped `CLAUDE.md` tier

Claude Code's documented precedence model has exactly four tiers — managed policy, user (`~/.claude/CLAUDE.md`), project (`./CLAUDE.md`), local (`./CLAUDE.local.md`) — and no workspace tier (`docs/research/2026-07-29-shared-workspace-config-injection.md:L23-L32`). A request for exactly this behaviour in Anthropic's own VS Code extension (`anthropics/claude-code#57243`) was closed `not_planned` on 2026-06-21 (`docs/research/2026-07-29-shared-workspace-config-injection.md:L99-L106`). "Workspace" is a VS Code-side concept only; Claude Code has no awareness of it. Any workspace-identity awareness must come from Conductor's own bookkeeping.

### 2.2 The dispatch site is a single, well-isolated seam

`_dispatchClaudeCommand()` resolves `const cmd = getClaudeCommand()` at `src/sessionManager.ts:123` and sends that one string down all three paths — shell-integration fast path (`:128`), shell-integration slow path (`:151`), delay-fallback `sendText` (`:165`). `getClaudeCommand()` has exactly one call site (`src/config.ts:10-12`, called only at `src/sessionManager.ts:123`) and `vscode.window.createTerminal` has exactly one call site (`src/sessionManager.ts:97`) — verified by repo-wide grep. Blast radius for the injection itself is one function.

`createTerminal()` currently passes only `name`, `cwd`, `iconPath`, `color` (`src/sessionManager.ts:97-102`) — **no `env` field**. `vscode.TerminalOptions` does support `env?: { [key: string]: string | null | undefined }` (`node_modules/@types/vscode/index.d.ts:12492`, `@types/vscode@1.115.0` per `package-lock.json:579`, satisfying the `^1.93.0` range at `package.json:216-217`), so env injection is available but not currently used.

### 2.3 The shell-integration API has an args overload; the fallback path does not

`TerminalShellIntegration` exposes two overloads: `executeCommand(commandLine: string)` (`node_modules/@types/vscode/index.d.ts:7887`) and `executeCommand(executable: string, args: string[])` (`:7943`). The code currently uses the first. The `sendText` delay-fallback path (`src/sessionManager.ts:165`) has **no args-array equivalent** — it can only send a shell-quoted string. Consequence: any argument-based mechanism must still solve shell quoting for the fallback path, even if the fast path could avoid it.

### 2.4 `claudeCommand` is a free-form user string — appending flags to it is structurally fragile

`claudeConductor.claudeCommand` is declared `"type": "string", "default": "claude"` with description "The Claude Code CLI command to run" (`package.json:151-155`). Nothing constrains it to a bare executable — a user may legitimately have set it to `claude --model opus`, a wrapper script, or a command with a positional argument. Two consequences:
- Blindly appending `--add-dir <path>` produces an argument order the user did not design, and its validity is unverified for non-default values.
- The `executeCommand(executable, args)` overload (§2.3) is **incompatible** with a user-set `claudeCommand` containing arguments, because using it would require parsing the user's string into executable + args — a shell-parsing problem, not a string-split problem.

### 2.5 Bash-style env-var prefixes will not work on PowerShell, VS Code's documented Windows default shell

The research doc's headline mechanism is written as `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude --add-dir ../shared-config` (`docs/research/2026-07-29-shared-workspace-config-injection.md:L39`). That `VAR=value cmd` prefix is POSIX-shell syntax (Bash, Zsh, `sh`); the PowerShell equivalent is the assignment statement `$Env:NAME = 'value'`, not a command prefix (`https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables`, fetched 2026-07-31). Conductor sends its command string into **whatever shell the user's VS Code terminal profile launched**, and VS Code's own documentation states the Windows default terminal profile is PowerShell — *"The default terminal profile shell defaults to `$SHELL` on Linux and macOS and PowerShell on Windows"* (`https://code.visualstudio.com/docs/terminal/profiles`, fetched 2026-07-31) — so any user who has not overridden that default hits this failure; `unverified:` whether this project's own contributors have overridden their default profile away from PowerShell.

**This is the single most important implementation finding in this document.** The env-var half of the `--add-dir` mechanism must be delivered via `createTerminal({ env })` (§2.2), **not** as a command-string prefix. A command-string prefix would work on Bash/Zsh terminals and silently fail on PowerShell — a cross-platform correctness bug that would present as "the shared config just doesn't apply," with no error.

### 2.6 There is no persisted "workspace" concept anywhere in the data model

- `src/folderSource.ts:52-92` produces a flat `FolderEntry[]` (`{folderPath, name, parentDir, source}`) from VS Code recents plus `extraFolders` — no grouping.
- `src/projectGrouping.ts:89-135` `groupByProjectRoot()` is a pure function that buckets `.worktrees/<branch>` children under a synthesised project root. It is display-time only and persists nothing; the file's own header calls it a grouping helper for the two tree providers (`src/projectGrouping.ts:1-13`).
- `src/workspaceMatch.ts:16-24` `isSameWorkspaceFolder()` only does a case-insensitive equality check against a single current workspace folder path.

So "what counts as one shared-config scope" has no existing entity to hang off. This is decision **D2** below, and it is a genuine design question, not a lookup.

### 2.7 `hookInstaller.ts` has a single-marker design that a second hook script would break

`HOOK_MARKER = "session-state.js"` is a single hardcoded string (`src/hookInstaller.ts:8`). `hooksInstalled()` returns true if `JSON.stringify(hooks)` contains that one marker anywhere (`src/hookInstaller.ts:53-61`). Three consequences if a second hook script (e.g. a `SessionStart` injector) is added under the same global-install pattern:

1. **Partial installs become undetectable.** `ensureHooksInstalled()` early-returns `true` as soon as `hooksInstalled()` is true (`src/hookInstaller.ts:225-237`), so a user with the old three hooks but not the new one would be reported as fully installed and never prompted.
2. **`hooksUpToDate()` / `reconcileHookPaths()` only reconcile paths for commands containing the one marker** (`src/hookInstaller.ts:86`, `:124`), so a second script's paths would go stale across extension updates without being fixed.
3. **`uninstallHooks()` removes by the same single marker** (`src/hookInstaller.ts:175-197`, called from `:304-316`), so the second script would be orphaned in `~/.claude/settings.json` on deactivate.

Any hook-route decision must therefore either generalize `HOOK_MARKER` to a list first, or avoid mutating global settings altogether (see D6).

### 2.8 The hooks Conductor installs today are **global**, not per-project

`installHooks()` writes to `~/.claude/settings.json` (`src/hookInstaller.ts:6`, `:139-170`). Its hooks fire for every Claude Code session on the machine, Conductor-launched or not. A `SessionStart` injector installed the same way would leak one workspace's shared config into unrelated sessions unless gated (corroborated at `docs/research/2026-07-29-shared-workspace-config-injection.md:L69`).

---

## 3. Phase 0 — hard empirical gate (blocks all mechanism selection)

Three facts are load-bearing for scope and none is resolved by documentation. **No mechanism may be marked "recommended-final" and no implementation issue should be opened until these return.** Each probe is cheap and mechanism-independent.

### P1 — Does Claude Code's upward `CLAUDE.md` walk cross a git worktree boundary?

**Why this is the gate.** The research doc claims the sibling-worktree case is already free: *"Since Conductor's worktrees live at `.worktrees/<branch>` … a `CLAUDE.md` placed at the repo root is already picked up automatically by every worktree session's native directory walk"* (`docs/research/2026-07-29-shared-workspace-config-injection.md:L48`). Read carefully, that sentence is the researcher's **inference** from the documented walk behaviour, not a quoted doc guarantee. The narrower discriminating question: a git worktree at `<root>/.worktrees/<branch>` contains its own `.git` **file** and is a distinct working tree. If Claude Code's walk terminates at the first git boundary it encounters, the "free" case **does not exist**, and the injection mechanism is needed for worktrees too — not only for unrelated repos.

**Probe.** Put a distinctive nonce string (e.g. `PHASE0-NONCE-7Q4K`) in `<repo-root>/CLAUDE.md`. Launch a Conductor session with `cwd = <repo-root>/.worktrees/<some-branch>`. Ask the session to repeat the nonce verbatim.

**Branches:**
- **Nonce present** → the worktree case is free with zero extension code. D1 becomes live: a first cut could be pure documentation (place a `CLAUDE.md` at the repo root) and the extension work narrows strictly to the cross-repo case.
- **Nonce absent** → the free case is a myth. Every case needs injection; D1 collapses to "build it," and the scope estimate roughly doubles.

### P2 — Does a new `--add-dir` target trigger a per-session approval prompt?

Flagged unresolved by the research pass (`docs/research/2026-07-29-shared-workspace-config-injection.md:L158`). Conductor can launch several folders in quick succession, so N sessions could mean N approval dialogs — which would make route R1 (below) unacceptable UX regardless of its tier advantages.

**Probe.** Launch two sessions in different folders, both with `--add-dir <shared-dir>` pointing at a directory neither has seen before. Count approval prompts and note whether an approval granted in session A suppresses the prompt in session B.

### P3 — Where does the shared content actually land, and does it conflict with per-folder `CLAUDE.md`?

Two research open questions collapse into one probe: whether `--append-system-prompt-file` content composes cleanly with a project `CLAUDE.md` when both are present (`docs/research/2026-07-29-shared-workspace-config-injection.md:L159`), and whether `SessionStart` `additionalContext` carries comparable adherence weight to real `CLAUDE.md` content (`:L160`).

**Probe.** For the finalist route(s) only: place a deliberately conflicting instruction in the shared config and in the folder's own `CLAUDE.md` (e.g. shared says "always answer in bullet points," folder says "always answer in prose"). Observe which wins, and whether the session acknowledges both. This measures **effective precedence**, which is what actually matters — the documented "tier" is a proxy for it.

---

## 4. Requirements (draft — needs user confirmation)

Requirements FR1–FR5 restate the research doc's own five requirements (`docs/research/2026-07-29-shared-workspace-config-injection.md:L7-L11`), which were derived from the original idea statement; NFR1–NFR6 are new and derived from the verified facts in §2.

### Functional

| # | Requirement | Testable as |
| --- | --- | --- |
| FR1 | Applies to every session Conductor launches from one workspace, regardless of whether the folder is a nested worktree, sibling worktree, or unrelated repo with no common ancestor | Launch one session per category; each must surface a nonce from the shared config |
| FR2 | Layers additively on top of each folder's own `CLAUDE.md` — does not replace or suppress it | Launch in a folder with its own `CLAUDE.md`; both that file's nonce and the shared nonce must be present |
| FR3 | Uses a documented Claude Code mechanism, no undocumented file formats or CLI patching | Review: the chosen route cites a `code.claude.com/docs` URL |
| FR4 | Does not break, or claim exclusive ownership of, Conductor's existing `Notification`/`UserPromptSubmit`/`Stop` hook install | Existing `test/hookInstaller.test.ts` suite passes unchanged; idle notifications still fire |
| FR5 | Scoped to one workspace — must not behave as a machine-global config | With a shared config configured in workspace A, a session launched from a Conductor instance in workspace B must **not** receive it |
| FR6 | When no shared config is configured, behaviour is byte-identical to today | Two assertions with the setting unset: (a) the dispatched string is identical to the configured `claudeCommand` value, (b) the object passed to `createTerminal` has no `env` key. Both are expressible against the existing mock at `test/mocks/vscode.ts:199` |

### Non-functional

| # | Requirement | Rationale / source |
| --- | --- | --- |
| NFR1 | Correct on PowerShell, `cmd.exe`, Bash, and Zsh terminals | §2.5 — a POSIX-only mechanism fails silently on the project's primary platform |
| NFR2 | Correct across all three dispatch paths (shell-integration fast, slow, delay-fallback) | §2.2 — all three are live code paths (`src/sessionManager.ts:126-165`) |
| NFR3 | Tolerant of a non-default, argument-bearing `claudeCommand` — or explicitly documented as unsupported in that case | §2.4 |
| NFR4 | Paths containing spaces are handled correctly, quoted per the target shell | §2.5 + NFR1; Windows user paths routinely contain spaces |
| NFR5 | Failure is visible, never silent — a missing, unreadable, or wrongly-scoped shared config logs to the extension output channel (`src/output.ts`) | A silently-skipped injection is indistinguishable from a working one from the user's side |
| NFR6 | No net-new grant of Claude filesystem access beyond what the chosen route inherently requires, and any such grant is disclosed to the user before first use | §5 R1 tradeoff; the existing hook-install consent prompt (`src/hookInstaller.ts:244-250`) is the precedent for disclosure |

---

## 5. Decision points

### D1 — Is the "free" native-walk case sufficient for a first cut? **(gated by P1)**

| Option | Consequence |
| --- | --- |
| **(a)** Document-only first cut: recommend a `CLAUDE.md` at the repo root; ship no extension code | Zero code, zero risk. Covers nested/sibling worktrees **only if P1 passes**. Does nothing for unrelated repos — the case the idea statement explicitly names. |
| **(b)** Build injection for the cross-repo case only; document the root-`CLAUDE.md` convention for worktrees | Smaller build than (c). Two mechanisms for users to understand. |
| **(c)** Build injection uniformly for all cases; ignore the free path | One mechanism, one mental model, one code path to test. Larger build; leaves a free win on the table. |

**Recommendation: deferred to P1.** If P1 passes, my leaning is **(c) with (a) documented as the zero-config option** — a single uniform mechanism is cheaper to reason about and test than a two-mode explanation, and NFR2's three dispatch paths already make per-mode branching expensive. If P1 fails, (a) and (b) are both eliminated and (c) is forced.

### D2 — What defines "one workspace"?

There is no persisted workspace entity to key off (§2.6). Options:

| Option | Assessment |
| --- | --- |
| **(a)** The host VS Code window's workspace, resolved through VS Code's own settings-scope machinery | **Recommended.** Answers the question with zero new data model — see below. |
| **(b)** The project-root group from `projectGrouping.ts` | Rejected: display-only, non-persisted (§2.6), and structurally cannot express "unrelated repos" — its only grouping rule is the `.worktrees/<branch>` path pattern (`src/projectGrouping.ts:52-75`). Fails FR1. |
| **(c)** A new explicit user-defined grouping setting (e.g. named groups of folder paths) | Most flexible and the only option that supports several independent scopes inside one VS Code window. Also the largest build: a new persisted data model, new UI to manage it, and a new failure mode (a folder in two groups). Premature until a user actually wants two scopes in one window. |

**Recommended: (a).** Declare one new setting, `claudeConductor.sharedConfigPath`. VS Code already provides per-workspace scoping for settings — a `.code-workspace` file or `.vscode/settings.json` supplies a workspace-scoped value, and `vscode.workspace.getConfiguration()` resolves it. "What counts as one workspace" is then answered by VS Code itself, and Conductor persists nothing new.

**Critical caveat that must be designed for, not assumed away.** `WorkspaceConfiguration.get()` resolves an **effective** value by overriding in the order `defaultValue` → `globalValue` → `workspaceValue` → `workspaceFolderValue` (`node_modules/@types/vscode/index.d.ts:6772-6781`). So a value set only in **user (global) settings** is returned by `get()` indistinguishably from a workspace-scoped one — which would produce exactly the machine-global behaviour FR5 forbids, with no signal that it happened.

The resolution: `inspect<T>(section)` returns `{ key, defaultValue?, globalValue?, workspaceValue?, workspaceFolderValue?, … }` (`node_modules/@types/vscode/index.d.ts:6867-6891`), giving the needed scope discrimination. The plan therefore specifies:

- Inject **only** when `inspect()` reports a `workspaceValue` (or `workspaceFolderValue`).
- When only `globalValue` is present, **do not inject**, and log the reason to the output channel (NFR5). This is the FR5 guard, and it needs an explicit test.
- When no workspace/folder is open at all — reachable, since the extension activates on `onStartupFinished` (`package.json:33-36`) and an empty VS Code window has no workspace — there is no workspace scope to read, so no injection. Log and continue.
- Declare `"scope": "window"` **explicitly** on the new `package.json` property rather than inheriting it. `window` is documented as the default when `scope` is omitted, meaning "windows (instance) specific settings which can be configured in user, workspace, or remote settings" (`https://code.visualstudio.com/api/references/contribution-points`, fetched 2026-07-29). The existing six properties declare no `scope` (`package.json:151-184`); being explicit here documents intent for a setting whose scope semantics are load-bearing.
- **Accepted consequence:** under `window` scope, per-folder overrides in a multi-root workspace do not apply — one shared config per window, not per root. That matches the stated intent ("one workspace = one shared config") and should be documented as deliberate. If per-root shared configs are later wanted, that is `"scope": "resource"` plus a redesign, not a tweak.

⚠️ **Technical decision required (D2):** the `inspect()`-based workspace-scope gate is the mechanism I can verify from the API surface, but whether refusing to honour a user-scope value is the *right product behaviour* — versus honouring it with a warning — is a UX call. Input needed from the user. My recommendation is to refuse (FR5 is stated as a hard requirement), but a user may reasonably prefer "one config for all my workspaces" as a convenience default.

### D3 — Which injection mechanism, and at which effective precedence tier?

Four routes. **None is recommended-final before Phase 0.**

| | Route | Effective tier | Key advantage | Key cost |
| --- | --- | --- | --- | --- |
| **R1** | `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` (via terminal `env`) + `--add-dir <shared-dir>` | Real `CLAUDE.md` / `.claude/rules/` tier (`research:L39`) | Only route that loads genuine `CLAUDE.md`-tier content — closest to the literal ask | Grants Claude read/edit access to the shared directory (`research:L42`, violates NFR6 unless disclosed); needs a CLI flag appended to the user string (§2.4); **P2 may kill it on approval-prompt UX** |
| **R2** | `--append-system-prompt-file <path>` | System-prompt tier, *not* `CLAUDE.md` tier (`research:L60`) | Anthropic explicitly endorses this shape for scripted invocation: *"This must be passed every invocation, so it's better suited to scripts and automation than interactive use"* (`research:L57`); no extra file-access grant | Different precedence tier than a `CLAUDE.md`; interaction with per-folder `CLAUDE.md` undocumented (P3); still an appended CLI flag (§2.4) |
| **R3** | Global `SessionStart` hook returning `additionalContext`, env-var-gated to the workspace | System-reminder tier (`research:L66`) | Composes with the existing additive `appendHook` pattern (`src/hookInstaller.ts:143-163`) | Triggers the §2.7 single-marker defect; global by default so needs env gating or it leaks (§2.8, `research:L69`); adherence weight unverified (P3) |
| **R4** | `--settings <inline-JSON>` overlay carrying a per-invocation `SessionStart` hook | Same as R3 | Per-invocation, so it **never mutates global `~/.claude/settings.json`** — sidesteps §2.7 entirely and satisfies FR5/FR4 by construction (`research:L75`) | Most moving parts; `claudeMd` cannot be set this way (`research:L78`), so the payload must be a hook definition, not literal memory text; also an appended CLI flag |

**Leaning, explicitly provisional:** **R1** if P2 shows no per-session prompt storm and the user accepts the NFR6 file-access grant, because it is the only route that satisfies the literal request ("a `CLAUDE.md`-equivalent") at the actual `CLAUDE.md` tier. **R2** is the fallback: lowest complexity, no access grant, first-party-endorsed for exactly Conductor's invocation shape — at the cost of a different tier, which P3 must characterise. **R4 over R3** if a hook route is chosen at all, per D6.

⚠️ **Technical decision required (D3):** tier-vs-access-grant is a genuine tradeoff that prior art does not pre-solve (`docs/research/2026-07-29-shared-workspace-config-injection.md:L147`). Needs the user's call on whether granting Claude file access to the shared-config directory is acceptable.

### D4 — What does the user configure: a directory, a file, or inline text?

R1 needs a **directory** (`--add-dir`). R2 needs a **file** (`--append-system-prompt-file`). R3/R4 could take either, or inline text. This is not a free choice — it is largely determined by D3, and the setting's shape should not be designed before D3 lands.

Recommended shape once D3 is known: a single string setting holding a path, with `~` expansion consistent with the existing `getExtraFolders()` precedent (`src/config.ts:22-26` already does `f.replace(/^~/, os.homedir())`), and relative paths resolved against the workspace base directory (the exact per-scenario definition — saved multi-root, single-folder, and untitled multi-root workspaces, plus the no-workspace skip-and-log case — is worked out in full in § 12 Addendum below, added for issue #86 finding 5) so a `.code-workspace` can be portable where one exists. Do **not** support inline text in the setting body: it makes the config unreviewable in git and unshareable, which defeats the "shared conventions" purpose.

### D5 — Where is the mechanism applied: terminal environment + arguments, or string append?

**Recommendation: express the design as "environment and arguments supplied at spawn time," not "a string appended inside `_dispatchClaudeCommand`."**

Concretely:
- The env-var half goes in `createTerminal({ env })` (`src/sessionManager.ts:97-102`, `@types/vscode` `TerminalOptions.env` at `node_modules/@types/vscode/index.d.ts:12492`) — **mandatory**, per §2.5. A `VAR=1 cmd` command prefix is a silent cross-platform failure on PowerShell and must not be used.
- The argument half must be appended to the `claudeCommand` string, because the `executeCommand(executable, args)` overload (`node_modules/@types/vscode/index.d.ts:7943`) cannot be used with an argument-bearing user string (§2.4), and the `sendText` fallback path has no args form at all (§2.3). Quoting must therefore be correct for the user's shell (NFR1, NFR4).

**Two reasons this framing matters beyond style.** First, it names the asymmetry honestly: R1 is *not* clean — half of it is a well-behaved structured API call and half is string concatenation onto a user-editable field. That asymmetry is a real argument in favour of R4, whose payload is a single self-contained `--settings` argument. Second, it is the strongest **sequencing** argument in this document: if issue [#44](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/44) (custom pty / process-wrapper spike, open, `pathfinding`) returns "go," the shell disappears entirely — the string-append path becomes moot and the env path becomes *easier* (direct `spawn` env). A design expressed as env + args survives that transition; a design expressed as "the string we append at line 123" does not.

### D6 — If a hook route is chosen: per-invocation overlay, or global install?

**Recommendation: R4 (per-invocation `--settings` overlay) over R3 (global install).** R3 forces confronting the §2.7 single-marker defect — generalizing `HOOK_MARKER` to a list across `hooksInstalled`, `hooksUpToDate`, `reconcileHookPaths`, and `removeHooks` (`src/hookInstaller.ts:53-197`), plus a migration story for users who already have the three v1.3.0 hooks installed. R4 never touches `~/.claude/settings.json`, so FR4 and FR5 hold by construction.

If R3 is chosen anyway, the marker generalization is a **prerequisite**, not a follow-up — and it should be sequenced with the session-tracking rework (§6), because that rework is also expected to add a `SessionEnd` hook to the same file.

### D7 — Failure behaviour when the shared config cannot be applied

Options: silent no-op / one-time warning notification / output-channel log only / refuse to launch.

**Recommendation: output-channel log always (NFR5), plus a single non-modal notification the first time per workspace, and never refuse to launch.** Refusing to launch would make a convenience feature into a hard dependency; a silent no-op is indistinguishable from success. The distinct cases to log: setting unset (normal, `debugLog` only); set at global scope only (FR5 refusal — log at `log` level with the reason); path missing or unreadable (warn); no workspace open (`debugLog`).

---

## 6. Interaction and sequencing with the session-tracking rework (#68, #33, #44)

Verified state of the three related issues (all fetched 2026-07-29):

- **[#68](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/68)** — open, labels `bug` + `pathfinding`, no milestone. Spike into why long-running session tabs fail close-detection; acceptance criteria are diagnostic logging + documented findings + a follow-up issue, explicitly **not** the fix. The diagnostic logging has landed (commit `960c33b` "feat: add debug logging for session close-detection diagnostics (#68 phase A)"; `debugLog` calls throughout `src/sessionManager.ts:213-360`).
- **[#33](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/33)** — open, `enhancement`, milestone **v1.4.0**. Adopt externally-launched Claude sessions. Proposes an `ActiveSession.source: "owned" | "adopted"` field.
- **[#44](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/44)** — open, `enhancement` + `pathfinding`, no milestone. Spike a custom pty / process-wrapper approach with full lifecycle ownership.

Four concrete interactions:

1. **#44 is the dominant sequencing risk, and D5's framing is the mitigation.** If #44 returns "go," `createTerminal` + shell-string dispatch is replaced by a directly-spawned process. An injection designed as "env + args at spawn time" (D5) ports directly; one designed as "append to the dispatch string" is rewritten. **Do not build a string-append-shaped design while #44 is unresolved.**

2. **#33 bounds the feature's reach, and this should be stated up front.** Adopted sessions are created by Anthropic's extension, not by Conductor, so Conductor cannot set their env or arguments. Shared-config injection is therefore **structurally impossible for adopted sessions** — it applies to `source: "owned"` only. That is a permanent capability gap to document in the README alongside #33's own gaps, not a bug to fix later.

3. **The hook routes (R3/R4) collide with #68's expected outcome in `hookInstaller.ts`.** The rework under discussion adds a `SessionEnd` hook and a Conductor-issued stable session ID. That means two independent additions to a file whose install/detect/reconcile/remove logic is hardcoded to one marker (§2.7). If a hook route is chosen for #81, the marker generalization and the state-file schema should be designed **once, together** with the #68 follow-up — not as two uncoordinated patches. **Choosing R1 or R2 avoids this coupling entirely,** which is a genuine (if secondary) argument for them.

4. **No conflict at the `createTerminal` call site itself.** #33 touches tracking (`_isClaudeSession`, `_trackIfClaudeSession`), not launching. #81 touches launching (`createTerminal` options + dispatch), not tracking. Both can proceed in parallel provided #81 stays out of `ActiveSession`'s shape.

**Recommended sequencing:** run Phase 0 now (it is independent of all three issues). Answer D1–D5 and D7 (D7 is required for every route per NFR5). If the answer is R1 or R2 — no hook involvement — #81 can be implemented in parallel with #33 without coordination, and D6 stays moot. If the answer is R3 or R4, D6 must also be answered, and the design should **wait for the #68 follow-up design** so `hookInstaller.ts` is reworked once. Regardless of route, prefer the env+args framing so a later #44 "go" does not invalidate the work.

---

## 7. Scope boundaries

**In scope for #81 (this document):** the Phase 0 probe results; answers to D1–D7; a written recommendation. Nothing else — #81's body states "Out of Scope: Implementation (scoping/planning only)."

**Note on this document's `touches:` frontmatter.** `src/sessionManager.ts`, `src/config.ts`, `package.json`, `README.md`, and `test/**` are unconditional — every route touches all five (a new setting always reaches `config.ts` + `package.json` + `README.md`, and this project's testing rule means tests ship with whichever route is chosen). `src/hookInstaller.ts` and `hooks/**` are **route-conditional**: they are touched only if decision D3 selects R3 (global `SessionStart` hook install). If D3 selects R1, R2, or R4, those two entries drop out of scope entirely. Stated here rather than as a YAML comment because comments do not survive frontmatter parsing.

**In scope for the implementation issue(s) that follow:** one new `claudeConductor.*` setting (`src/config.ts` getter + `package.json` property, following the existing one-getter-per-setting pattern at `src/config.ts:10-35`); the injection at the single `createTerminal` / dispatch seam (`src/sessionManager.ts:97-165`); the workspace-scope gate via `inspect()`; output-channel logging; tests; README update.

**Explicitly out of scope:**
- Adopted / externally-launched sessions (§6.2 — structurally impossible; #33's territory).
- Sessions launched outside Conductor entirely (manual `claude` in a terminal).
- Any change to `ActiveSession`, the three-tier close-detection logic, or the session-state file schema (#68's territory).
- Per-folder shared configs within one multi-root workspace (D2's accepted `window`-scope consequence).
- Editing or generating the shared config's *content* — Conductor points at a file the user authors; it does not author or template it.
- Syncing the shared config across machines (it is a path in a settings file; git or the user handles the rest).
- Option D2(c), an explicit user-defined grouping model — deferred until a concrete need for two scopes in one window exists.

---

## 8. Risks

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| K1 | P1 fails and the "free worktree case" does not exist, roughly doubling scope | High | Phase 0 runs first, before any commitment — this is exactly what the gate is for |
| K2 | Bash-syntax env prefix ships and fails silently on PowerShell | High | §2.5 / D5 — mandate `createTerminal({ env })`; add a test asserting no `VAR=` prefix appears in the dispatched string |
| K3 | A global-scope setting value silently produces machine-global behaviour, violating FR5 with no signal | High | D2's `inspect()` gate plus a dedicated test for the global-only case |
| K4 | Flags appended to a non-default `claudeCommand` produce an invalid invocation | Medium | NFR3 — either handle it or document it as unsupported; needs a probe with a non-default value before shipping |
| K5 | #44 returns "go" and invalidates a string-append-shaped implementation | Medium | D5's env+args framing; sequencing in §6 |
| K6 | R1's `--add-dir` grants Claude edit access to the shared directory, and if that directory sits inside one repo, cross-repo file access follows | Medium | NFR6 disclosure; consider recommending a standalone shared-config directory outside any repo |
| K7 | A hook route lands uncoordinated with the #68 rework, leaving `hookInstaller.ts` with two half-generalized marker schemes | Medium | §6.3 sequencing; prefer R1/R2/R4 |
| K8 | Effective precedence turns out to disadvantage shared content so much that the feature does not achieve its purpose even though it "works" | Medium | P3 measures effective precedence directly, not the documented tier |

---

## 9. Open questions requiring user or expert input

1. **D2 UX call** — refuse a user-scope (global) `sharedConfigPath` value per FR5, or honour it with a warning? (My recommendation: refuse.)
2. **D3 tradeoff call** — is granting Claude read/edit access to the shared-config directory (R1's cost) acceptable in exchange for true `CLAUDE.md`-tier loading? If not, R2 becomes the recommendation by elimination.
3. **D1 scope call** — pending P1: if the worktree case is free, ship documentation-only first, or build the uniform mechanism immediately?
4. **Non-default `claudeCommand` (NFR3)** — does the user actually run a non-default value? If not, K4 drops from Medium to Low and the appended-flag fragility is largely theoretical.
5. **Shared-config location convention** — should the recommended location be inside one of the repos (git-tracked, shareable with teammates) or outside all of them (avoids K6's cross-repo access)? These pull in opposite directions.
6. **Multi-scope need** — is one shared config per VS Code window sufficient, or is there a real near-term need for several independent scopes in one window (which would revive D2(c))?
7. **Canonical upstream thread** — `anthropics/claude-code#45643` was closed as a duplicate and the canonical thread it deferred to was never identified (`docs/research/2026-07-29-shared-workspace-config-injection.md:L161`). Worth a look before treating "no built-in `.claude-workspace`" as final, though #57243's `not_planned` close (§2.1) already makes upstream rescue unlikely.

---

## 10. Proposed follow-up issues

**None of these has been created by this document** — they are proposals only, for the router or the user to file. Recommend grouping them under a new milestone (e.g. `v1.5.0` / "Shared workspace config") per the Issue Tracking convention of creating the milestone at planning time.

1. **"Phase 0: empirically verify CLAUDE.md walk, --add-dir prompting, and effective precedence"** — probes P1/P2/P3 from §3. Label `pathfinding`. **Blocks everything else.** Closes with findings recorded on #81.
2. **"Implement shared workspace config injection via <route chosen in D3>"** — the build. Blocked by (1) and by answers to D1–D5 and D7 (required for every route per NFR5), plus D6 if D3 selected a hook route (R3/R4). `touches` as declared in this document's frontmatter.
3. **"Generalize hookInstaller HOOK_MARKER to support multiple hook scripts"** — §2.7. **Only needed if D3 selects R3.** Should be co-designed with the #68 follow-up rather than filed standalone.
4. **"Document shared-config capability gap for adopted sessions"** — §6.2. A README note; could fold into #33 rather than standing alone.

---

## 11. Quality-check notes and honesty ledger

- **Unverified by design, deliberately not asserted:** whether Claude Code's `CLAUDE.md` walk crosses a git worktree boundary (P1); whether `--add-dir` prompts per session (P2); the effective precedence of each route's content relative to a per-folder `CLAUDE.md` (P3). Each is a Phase 0 probe rather than an assumption baked into a recommendation.
- **`unverified:`** the claim that a non-default `claudeCommand` value accepts appended flags in any position. Not probed; K4 and NFR3 exist because of it.
- **Citation note:** `node_modules/@types/vscode/index.d.ts` citations reference the version actually resolved by the lockfile, `@types/vscode@1.115.0` (`package-lock.json:579`, satisfying the `^1.93.0` range declared at `package.json:216-217`) — the lockfile-resolved version, not the semver range, since that is what `npm install` actually places on disk. It is not a committed file, but it is the authoritative local API surface and is reproducible via `npm install`.
- **Deliberately not done:** `superpowers:writing-plans` was not invoked and no step-by-step task breakdown exists, because #81 scopes implementation out. The implementation plan belongs to follow-up issue (2), after Phase 0 and D1–D5 and D7 land (and D6, if a hook route was selected).

---

## 12. Addendum — D4 workspace-path resolution and test cases (added 2026-07-31, issue #86 finding 5)

This addendum resolves an omission flagged in review: §5 D4's "relative paths resolved against the workspace file's directory" did not define what "the workspace file's directory" means when `vscode.workspace.workspaceFile` is `undefined` — which the API contract says happens "when no workspace is opened" and, when a workspace *is* untitled, returns an `untitled:`-scheme URI rather than a filesystem path (`node_modules/@types/vscode/index.d.ts:13840-13873`, package version `1.115.0` per `package-lock.json:579`). That confirms the untitled-multi-root and no-workspace-at-all rows below directly. The JSDoc alone does not use the words "single-folder window," so `unverified:` that a single opened folder falls under "no workspace is opened" for this specific property rather than under "a workspace is opened" (VS Code's user-facing docs use "workspace" loosely enough to cover a single folder too — `https://code.visualstudio.com/docs/editor/workspaces`, fetched 2026-07-31); community corroboration for the narrower API reading exists (e.g. `eclipse-theia/theia#8994`, a Theia issue observing the same `workspaceFile`-undefined-in-single-folder-mode behavior in a VS Code-API-compatible product, fetched 2026-07-31) but no first-party Microsoft statement was found pinning down this exact case.

**Base-path resolution by scenario:**

| Scenario | `workspaceFile` | Base path for a relative `sharedConfigPath` |
| --- | --- | --- |
| Saved multi-root workspace (`.code-workspace` file) | Defined, `file://` scheme | The `.code-workspace` file's own directory — `path.dirname(workspaceFile.fsPath)` |
| Untitled (unsaved) multi-root workspace | Defined, `untitled:` scheme, **no filesystem path** | Falls back to the first workspace folder — `workspace.workspaceFolders[0].uri.fsPath` — because the `untitled:` URI has no usable `fsPath` |
| Single-folder window | `undefined` (`unverified:` — see caveat above) | The single opened folder — `workspace.workspaceFolders[0].uri.fsPath` |
| No folder open at all (empty window) | `undefined`, and `workspace.workspaceFolders` is also `undefined` | No base path exists; skip injection and log — already specified at §5 D2's "no workspace/folder is open at all" case |

**Test cases this table implies** (descriptions, not implementations — this is a planning document; concrete tests belong to the implementation issue in §10, item 2):

1. **Saved multi-root workspace.** Mock `workspace.workspaceFile` as a `file://` URI pointing at a `.code-workspace` path; assert the resolved base directory equals that file's parent directory, and that a relative `sharedConfigPath` value resolves against it correctly, including a path containing spaces (NFR4).
2. **Untitled multi-root workspace.** Mock `workspace.workspaceFile` as an `untitled:` URI and `workspace.workspaceFolders` with two or more entries; assert the implementation does not attempt to resolve a filesystem path from the `untitled:` URI, and instead falls back to the first workspace folder's path.
3. **Single-folder window.** Mock `workspace.workspaceFile` as `undefined` and `workspace.workspaceFolders` with exactly one entry; assert the base path resolves to that folder.
4. **No workspace open.** Mock both `workspace.workspaceFile` and `workspace.workspaceFolders` as `undefined`; assert the injection no-ops, logs at `debugLog` level (consistent with D2 and D7's failure-behaviour table), and does not throw.

This addendum does not change D3's mechanism choice or D6/D7's route-conditional questions — it only fills in the D4 base-path gap flagged by review, consistent with not resolving the underlying design question here.
