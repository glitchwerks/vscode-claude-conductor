---
title: Shared workspace-level config injection into every Conductor-launched session
touches:
  - src/sessionManager.ts
  - src/config.ts
  - src/sharedConfig.ts
  - package.json
  - README.md
  - test/mocks/vscode.ts
  - test/sharedConfig.test.ts
  - test/sessionManager.sharedConfig.test.ts
  - docs/specs/2026-08-09-shared-workspace-config-injection.md
  - docs/plans/2026-07-29-shared-workspace-config-injection.md
  - docs/specs/2026-07-29-foundational-project-spec.md
  - docs/README.md
skills_relevant:
  - powershell
  - simplicity-first
---

# Shared workspace-level config injection

**Tracking issue:** [#81 "Spike: shared workspace-level config (CLAUDE.md-equivalent) injected into every session"](https://github.com/glitchwerks/vscode-claude-conductor/issues/81) — verified open, labels `enhancement` + `pathfinding`, no milestone, body fetched 2026-08-09.
**Type:** feature-spec
**Status:** ACCEPTED — §5.1 and §5.2 were answered on 2026-08-09, both matching this document's recommendations (refuse a global-scope-only value; accept R1's access-grant price). Revised the same day to close a `project-reviewer` pass (one BLOCKING, seven CONCERN, two NIT findings); see §5.8 for what changed. §5.6's pre-implementation confirmations remain unrun and are the implementer's first task.

**Prior inputs consumed (not re-derived):**
- Scoping decision: `docs/plans/2026-07-29-shared-workspace-config-injection.md` (UNDER REVIEW; its §2 verified facts are the foundation for §1 below and are re-verified against current source here, because the file moved between 2026-07-29 and today)
- Prior-art research: `docs/research/2026-07-29-shared-workspace-config-injection.md`
- Foundational spec: `docs/specs/2026-07-29-foundational-project-spec.md` §2.7.2

---

## 1. Problem

Conductor launches one terminal per folder, each with its own `cwd`, each running an independent `claude` invocation (`src/sessionManager.ts:L120-L134`). There is no shared process and no shared Claude session, so a "shared config" must be applied **N times, once per launched session** — there is no single place to put it once. That constraint drives the whole design.

Issue #81 asks for a single `CLAUDE.md`-equivalent body of conventions to reach every session Conductor launches from one VS Code workspace, layered **on top of** each folder's own `CLAUDE.md`, so a workspace becomes a coherent collection of sessions across folders, worktrees, and unrelated repos (#81 body, fetched 2026-08-09).

Nothing in Claude Code provides this natively. Its documented `CLAUDE.md` scope table has exactly four tiers — managed policy, user (`~/.claude/CLAUDE.md`), project (`./CLAUDE.md` or `./.claude/CLAUDE.md`), local (`./CLAUDE.local.md`) — and no workspace tier (`https://code.claude.com/docs/en/memory` § Choose where to put CLAUDE.md files, fetched 2026-08-09). "Workspace" is a VS Code concept; Claude Code has no awareness of it. A request for exactly this behaviour in Anthropic's own VS Code extension was closed `not_planned` (`docs/research/2026-07-29-shared-workspace-config-injection.md:L99-L106`, citing `anthropics/claude-code#57243`).

This spec references `docs/specs/2026-07-29-foundational-project-spec.md` for the project's premise and does not restate it.

### 1.1 What changed since the scoping plan

The plan doc gated all mechanism selection behind a three-probe empirical Phase 0 (`docs/plans/2026-07-29-shared-workspace-config-injection.md:L88-L112`). Re-reading the primary documentation on 2026-08-09 dissolves that gate:

- **P1 (does the upward `CLAUDE.md` walk cross a git worktree boundary?) is decision-irrelevant.** The mechanism selected below is uniform across nested worktrees, sibling worktrees, and unrelated repos; P1's answer changes only a sentence of README guidance, not any code path. #81's own body names "entirely separate repos" as in scope, and that case needs injection whatever the walk does. Separately, the walk is documented as purely filesystem-based with no git-boundary carve-out — *"Across the directory tree, content is ordered from the filesystem root down to your working directory"* (`https://code.claude.com/docs/en/memory` § How CLAUDE.md files load, fetched 2026-08-09) — and the page documents its exclusion mechanisms (`claudeMdExcludes`) explicitly where they exist. `unverified:` that an intervening git worktree boundary does not terminate the walk; this remains a documentation claim to confirm before the README's zero-config sentence ships (§5.6).
- **P2 (does `--add-dir` prompt per session?) is doc-supported, not doc-proven.** *"Files in additional directories follow the same permission rules as the original working directory: they become readable without prompts, and file editing permissions follow the current permission mode"* (`https://code.claude.com/docs/en/permissions` § Working directories, fetched 2026-08-09). The documented workspace-trust dialog is scoped to allow rules and additional directories supplied by a **repository's own settings files**, not to a CLI-supplied `--add-dir` (`https://code.claude.com/docs/en/permissions` § Project allow rules and workspace trust, fetched 2026-08-09), and Anthropic documents approval dialogs where they exist — the external-`@import` warning is proof (`https://code.claude.com/docs/en/memory` § Import additional files, fetched 2026-08-09). This is inference from documented absence on the one fact that would kill the chosen route, so it is carried as a **pre-implementation confirmation** (§5.6), not a blocker on accepting this spec.
- **P3 (effective precedence vs. a per-folder `CLAUDE.md`) was ill-posed and is replaced.** The docs state the outcome directly: *"if two rules contradict each other, Claude may pick one arbitrarily"* and *"Claude treats them as context, not enforced configuration"* (`https://code.claude.com/docs/en/memory` § Write effective instructions and § CLAUDE.md vs auto memory, fetched 2026-08-09). A conflict probe therefore measures a coin flip. The testable property is **loading**, not winning: `/context` lists what actually loaded under **Memory files** (`https://code.claude.com/docs/en/memory` § Set up a project CLAUDE.md and § Troubleshoot memory issues, fetched 2026-08-09), and the `InstructionsLoaded` hook *"log[s] exactly which instruction files are loaded, when they load, and why"* (same page, § Troubleshoot memory issues). Every requirement below is written against loading.

---

## 2. Requirements

### 2.0 Chosen mechanism

**Route R1** — set `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` in the terminal's environment and append `--add-dir "<shared-config-dir>"` to the dispatched command.

Rationale, in order of weight:

1. **It is the only route that loads content at the real `CLAUDE.md` tier.** The permissions doc's table of what `--add-dir` directories contribute lists *"[CLAUDE.md] files, `.claude/rules/`, and `CLAUDE.local.md` — Only when `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` is set"* (`https://code.claude.com/docs/en/permissions` § Additional directories grant file access, not configuration, fetched 2026-08-09). `--append-system-prompt-file` loads at system-prompt scope instead, which is a different tier from `CLAUDE.md` — the latter is *"delivered as a user message after the system prompt, not as part of the system prompt itself"* (`https://code.claude.com/docs/en/memory` § Troubleshoot memory issues, fetched 2026-08-09).
2. **It is the only route with a first-party, non-model-mediated load receipt.** `/context` § Memory files and the `InstructionsLoaded` hook report loading directly (§1.1, P3). The other routes can only be checked by asking the model to echo a nonce, which is model-mediated and therefore weaker evidence.
3. **It touches no global state.** Unlike a globally-installed `SessionStart` hook, it never writes `~/.claude/settings.json`, so it cannot disturb Conductor's existing three hooks and does not force the `HOOK_MARKER` generalization (`src/hookInstaller.ts:L9`, single hardcoded marker consumed at `:L111`, `:L137`, `:L175`, `:L236`) that a second hook script would require.
4. **Its documented per-session approval risk did not materialise** (§1.1, P2).

Its price was put to the user rather than assumed away, and was **accepted on 2026-08-09** — see §5.2.

**Rejected, retained only as the K5 contingency:** `--append-system-prompt-file <path>` (route R2 in the plan doc). It grants no file access and is first-party-endorsed for scripted invocation, but loads at a different tier and has no load receipt. With §5.2 answered "accept," the only surviving path back to R2 is §5.6 confirmation 1 failing — i.e. `--add-dir` turning out to prompt per session. If that happens the setting changes from a directory to a file and §2.1, §2.2, and §2.7 need rewriting, so run that confirmation **before** writing code, not after.

**Rejected outright:** both hook routes (plan doc R3/R4). R3 mutates global settings and triggers the single-marker defect above; R4 avoids that but is the most moving parts of any route for the least tier benefit, and `claudeMd` cannot be set through it — *"Setting `claudeMd` in user, project, or local settings has no effect"* (`https://code.claude.com/docs/en/memory` § Deploy organization-wide CLAUDE.md, fetched 2026-08-09).

**One shape constraint that closes off a cleaner design.** There is no environment variable that adds directories — the only directory-related variable documented is `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`, which only *enables memory loading from* directories added by `--add-dir` (`https://code.claude.com/docs/en/env-vars`, fetched 2026-08-09). A CLI argument is therefore unavoidable, and so is appending it to the user's `claudeCommand` string: the `executeCommand(executable, args)` overload cannot be used with an argument-bearing user string, and the `sendText` fallback path (`src/sessionManager.ts:L190`) has no args form at all (`docs/plans/2026-07-29-shared-workspace-config-injection.md:L48-L56`).

### 2.1 The setting

One new property, `claudeConductor.sharedConfigDir`, declared alongside the existing six (`package.json:L239-L276`; none of the six declares a `scope`).

- **Type** `string`, default `""`.
- **`"scope": "window"` declared explicitly**, not inherited. This is the documented default when `scope` is omitted, but the semantics are load-bearing here, so state them.
- **A directory, not a file.** `--add-dir` *"Validates each path exists as a directory"* (`https://code.claude.com/docs/en/cli-reference`, fetched 2026-08-09), so pointing it at a file fails. This is a deliberate departure from the plan doc's provisional name `sharedConfigPath` (`docs/plans/2026-07-29-shared-workspace-config-injection.md:L199`), which invites exactly that mistake.
- The directory is expected to contain `CLAUDE.md`, `.claude/CLAUDE.md`, and/or `.claude/rules/*.md` — the file set the env var causes to load (§2.0, citation 1).

### 2.2 Functional requirements

| # | Requirement | Testable as |
|---|---|---|
| FR1 | Applies to every session Conductor launches while the setting is workspace-scoped and valid, regardless of whether the folder is a nested worktree, a sibling worktree, or an unrelated repo with no common ancestor | Launch one session per category; in each, `/context` lists the shared directory's `CLAUDE.md` under **Memory files** |
| FR2 | Layers additively — the folder's own `CLAUDE.md` still loads | Launch in a folder that has its own `CLAUDE.md`; `/context` lists **both** files under **Memory files** |
| FR3 | Uses only documented Claude Code mechanisms | Review: every mechanism cites a `code.claude.com/docs` URL (§2.0) |
| FR4 | Writes nothing to `~/.claude/settings.json` and does not alter Conductor's existing `Notification` / `UserPromptSubmit` / `Stop` hook install | `test/hookInstaller.test.ts` passes unchanged; no new write path to that file exists in the diff |
| FR5 | Injects **only** when `inspect()` reports a `workspaceValue` or `workspaceFolderValue` for the setting. A value present only as `globalValue` does not inject | Unit test: stub `inspect()` returning `{globalValue: "/x"}` only → dispatched string unchanged, no `env` passed, one log line naming the reason. Requires extending `WorkspaceConfigurationStub` (`test/mocks/vscode.ts:L157-L163`), which currently exposes only `get` and `update` |
| FR6 | With the setting unset, behaviour is byte-identical to today | Two assertions: (a) the string passed to `executeCommand` / `sendText` equals `getClaudeCommand()`'s value exactly, (b) the object passed to `createTerminal` has no `env` key. Both expressible against the existing mock (`test/mocks/vscode.ts:L216`) |
| FR7 | Pre-validate that the resolved path exists **and is a directory** — `fs.statSync(resolved).isDirectory()`, not `fs.existsSync(resolved)` — before appending `--add-dir`. If the stat throws, or the target is a file, skip injection, log, and launch the session normally. The pre-flight is **skipped entirely for a UNC shared-config directory** per §2.7 | Three unit tests: a non-existent path → dispatched string unchanged, `WARN:` logged, `createTerminal` still called; a path that resolves to a **file** → same outcome, i.e. never passed to `--add-dir`; a UNC path → no `statSync` call, injection proceeds. `existsSync` is insufficient because it returns `true` for a file, and `--add-dir` *"Validates each path exists as a directory"* (`https://code.claude.com/docs/en/cli-reference`, fetched 2026-08-09) — a file would abort the session at startup rather than degrade. This is mandatory, not defensive |
| FR8 | Resolve the configured value to an absolute path: expand a leading `~`, and resolve a relative value against the workspace base directory defined in §2.5 | Four unit tests, one per row of §2.5's table. Requires adding `workspaceFile` to the `workspace` mock (`test/mocks/vscode.ts:L251-L265`), which currently has only `workspaceFolders` |
| FR9 | Never refuse to launch. Every case in which the shared config does not reach a session is logged to the Conductor output channel, and the first *misconfiguration* per window also raises one non-modal notification. The exhaustive case list, its log levels, and which cases consume the notification are in §2.2.1 — that table is the requirement, not an illustration | One unit test per row of §2.2.1, each asserting the log text and whether `showWarningMessage` fired. Every row except S5 asserts `createTerminal` was still called; S5 asserts it was **not**, because that row is the reuse branch |
| FR10 | A session that is **reused** rather than created is logged when a valid shared config is configured, because Conductor cannot retrofit environment or arguments onto a terminal it already created | §2.2.1 row S5. Unit test: `reuseExistingTerminal` true, an existing session for the folder, a valid `sharedConfigDir` → `focusSession` is called, `createTerminal` is **not**, and one `WARN:` line naming the folder and telling the user to close and relaunch is written |

#### 2.2.1 Skip and notice cases (FR9, FR10)

`src/output.ts` exports exactly two logging functions, `log` (`src/output.ts:L17`) and `debugLog` (`src/output.ts:L27`); there is no `warn` and none is added — a grep of `src/` for `warn` returns nothing on 2026-08-09. **"WARN" below therefore means `log()` with a literal `WARN:` prefix inside the message**, alongside the existing bracketed-tag convention (`log("[launch] skipping — cwd does not exist: …")`, `src/sessionManager.ts:L102`). `output.ts` is consequently **not** in `touches:`.

The notification is reserved for **misconfiguration** — "the value you set cannot be used" — and is deliberately not raised for cases where the setting is absent or was simply not applicable to this launch. Sharing the channel between those two meanings would devalue it. It is a non-modal `vscode.window.showWarningMessage`, and it does **not** consult `claudeConductor.enableNotifications` (`src/config.ts:L18-L20`): that setting governs idle-session notifications specifically — *"Show notifications when a session is waiting"* (`docs/specs/2026-07-29-foundational-project-spec.md:L122` citing `package.json:L161-165`) — and silencing a misconfiguration warning is not what a user turning it off is asking for.

| # | Case | Log level | Consumes the one-per-window notification? |
|---|---|---|---|
| S1 | Setting unset or empty | `debugLog` | No — nothing is misconfigured |
| S2 | Value present only as `globalValue` (FR5) | `log` | Yes — the user set a value that will not be used |
| S3 | Resolved path missing, or present but not a directory (FR7) | WARN | Yes |
| S4 | Resolved path contains a refused character (NFR4) — the message names the exact offending character | WARN | Yes |
| S5 | Session **reused**, and the resolution succeeded (FR10) | WARN | **No** — the setting is valid; this terminal simply predates it. Message: the shared config is not active in this terminal because it was created before / without it; close the tab and relaunch to pick it up |
| S6 | The value is **relative** and no folder is open, so §2.5 has no base to resolve it against (§2.5 row 4). An absolute or `~`-prefixed value needs no base and is unaffected | `debugLog` | No |
| S0 | **Not a skip** — injection succeeded. One `debugLog` naming the resolved directory, matching the existing `[dispatch]` / `[launch]` tag convention | `debugLog` | No |

S0 exists because without it the output channel can answer "why didn't it inject?" but not "did it inject?", and only `/context` inside the session could — a needless asymmetry for one line of code.

Two properties of S5 that the implementation must preserve:

- **It is gated on the resolution being non-null.** If the setting is unset (S1) or invalid (S2/S3/S4), the reuse branch must not claim "this terminal predates your config" — that would be false. The reuse branch logs S5 only when the same resolution that *would* have been injected came back non-null.
- **It logs on every occurrence, not once per window.** The output channel is cheap, and the user's question ("why didn't my shared config apply here?") is per-launch.

### 2.3 Non-functional requirements

| # | Requirement | Rationale / source |
|---|---|---|
| NFR1 | Correct on PowerShell, `cmd.exe`, Bash, and Zsh | A POSIX `VAR=value cmd` prefix is invalid PowerShell, and PowerShell is VS Code's documented Windows default profile (`docs/plans/2026-07-29-shared-workspace-config-injection.md:L58-L62`) |
| NFR2 | The env var is delivered through `createTerminal({ env })` and **never** as a command-string prefix. `strictEnv` must be left unset | `TerminalOptions.env` exists and is currently unused (`node_modules/@types/vscode/index.d.ts:L12490-L12492`; `createTerminal` today passes only `name`/`cwd`/`iconPath`/`color`, `src/sessionManager.ts:L120-L125`). `strictEnv` defaults to false, meaning *"the environment will be based on the window's environment"*; setting it true means *"the complete environment must be provided as nothing will be inherited"* (`:L12494-L12501`) — which would strip `PATH` and break `claude` resolution, a failure this repo has already paid for once (commit `01229c2`, "fix: resolve node binary via PATH/common-paths instead of hardcoded Program Files path") |
| NFR3 | Correct across all three dispatch paths | Shell-integration fast path (`src/sessionManager.ts:L151-L155`), slow path (`:L158-L180`), and `sendText` delay fallback (`:L186-L190`) are all live |
| NFR4 | **Quoting rule, stated concretely:** the resolved path is emitted wrapped in double quotes. If it contains any of `"`, `` ` ``, `$`, `%`, or a newline, injection is skipped and logged per §2.2.1 row S4 — **except** that `$` is permitted in a UNC path, per the single carve-out in §2.7 | Double quotes handle spaces identically in PowerShell, `cmd.exe`, Bash, and Zsh; the five excluded characters are the ones whose meaning differs between them. `"` terminates the wrapper everywhere; `` ` `` is PowerShell's escape character; `$` interpolates in PowerShell, Bash, and Zsh. `%` is the `cmd.exe` case and is easy to miss because it is legal in Windows paths — *"To substitute variable values in the command line or scripts, enclose the variable name in percent signs (%VariableName%)"*, and `%` is absent from the same page's list of characters that quotation marks handle (`https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd`, fetched 2026-08-09). Whether double quotes suppress `%` expansion in every `cmd.exe` invocation path is settled by §5.6 confirmation 4 before implementation, not carried as a permanent unknown; if that check shows quoting is sufficient, `%` may be dropped from the refused set. `sendText` sends raw text to an unknown shell (`src/sessionManager.ts:L190`) and the args-array overload is unavailable, so a per-shell quoter is not buildable — refusing a fixed character set is. Testable: one test per character asserting skip-and-log naming that character; one test asserting a path with spaces is wrapped; one test asserting `\\\\server\\C$\\shared` is **not** refused |
| NFR5 | Arguments are appended to the end of the `claudeCommand` string. A `claudeCommand` whose value ends in a positional argument is **documented as unsupported** with this feature, not silently handled | `claudeCommand` is a free-form string (`package.json:L242-L246`, `src/config.ts:L10-L12`) with nothing constraining it to a bare executable. See §5.4 |
| NFR6 | The design is expressed as "environment and arguments supplied at spawn time," not "a string appended at one call site" | #44 (open, `enhancement` + `pathfinding`, no milestone, fetched 2026-08-09) would replace `createTerminal` + shell dispatch with a directly-spawned process. An env+args design ports; a dispatch-string design is rewritten |
| NFR7 | No new persisted data model. "Which workspace" is answered by VS Code's own settings-scope machinery, nothing else | There is no persisted workspace entity to key off today (`docs/plans/2026-07-29-shared-workspace-config-injection.md:L64-L70`) |
| NFR8 | Any file-access grant the chosen route inherently carries is disclosed in the README before first use | The existing hook-install consent prompt is the precedent (`src/hookInstaller.ts`, consent flow cited at `docs/specs/2026-07-29-foundational-project-spec.md:L78`) |

### 2.4 Why `inspect()` and not `get()`

`get()` returns an **effective** value computed by overriding in the order `defaultValue` → `globalValue` → `workspaceValue` → `workspaceFolderValue` → language values (`node_modules/@types/vscode/index.d.ts:L6772-L6781`, `@types/vscode@1.115.0` per `package-lock.json:L578-L584`). A value set only in user settings is therefore indistinguishable from a workspace-scoped one, which would silently produce the machine-global behaviour FR5 forbids. `inspect<T>(section)` returns the per-scope fields separately — `key`, `defaultValue`, `globalValue`, `workspaceValue`, `workspaceFolderValue`, and language variants (`:L6867-L6892`) — and is the only API that can make the distinction.

**Where the `inspect()` call lives (`config.ts` ↔ `sharedConfig.ts` contract).** `src/config.ts` is a flat one-getter-per-setting module built entirely on `get()` (`src/config.ts:L6-L35`), and each getter returns a plain value. An `inspect()`-based getter would have to return a VS Code-typed scope record, leaking `vscode` API shapes into every caller of `config.ts`. So:

- **`src/config.ts` gains exactly one thing: `export` on the existing `SECTION` constant** (`src/config.ts:L4`, currently module-private). No new getter for this setting.
- **`src/sharedConfig.ts` calls `vscode.workspace.getConfiguration(SECTION).inspect<string>("sharedConfigDir")` itself**, importing `SECTION` from `./config`. All scope discrimination stays in the one module that needs it, and `config.ts`'s pattern stays uniform.

`sharedConfig.ts` therefore imports `vscode` (like `src/output.ts:L1` does) and is "pure" in the sense that matters here — no injected `ExtensionContext`, no `SessionManager` state, everything it reads is a module-level API call it can be given a stub for.

### 2.5 Path resolution base (FR8)

A leading `~` expands to the home directory, matching the existing `getExtraFolders()` precedent (`src/config.ts:L22-L26`). An absolute value is used as-is. A relative value resolves against the base below.

This table is reproduced from `docs/plans/2026-07-29-shared-workspace-config-injection.md` § 12 rather than cited into it, so FR8 stays checkable if that plan is ever removed under the plan-lifecycle convention. **The `unverified:` marker the plan attaches to row 3 is carried forward here, not dropped.**

| Scenario | `vscode.workspace.workspaceFile` | Base for a relative value |
|---|---|---|
| Saved multi-root workspace (`.code-workspace` file) | Defined, `file://` scheme | `path.dirname(workspaceFile.fsPath)` — the `.code-workspace` file's own directory |
| Untitled (unsaved) multi-root workspace | Defined, `untitled:` scheme, no filesystem path | `workspace.workspaceFolders[0].uri.fsPath` — the `untitled:` URI has no usable `fsPath` |
| Single-folder window | `undefined` — **`unverified:`** see below | `workspace.workspaceFolders[0].uri.fsPath` |
| No folder open at all | `undefined`, and `workspaceFolders` is also `undefined` | None exists; skip injection and log per FR9 |

Rows 1, 2, and 4 follow directly from the API contract: `workspaceFile` is `undefined` "when no workspace is opened" and returns an `untitled:`-scheme URI for an unsaved workspace (`node_modules/@types/vscode/index.d.ts:L13841-L13873`, `@types/vscode@1.115.0`).

**Row 3 is `unverified:`.** The JSDoc never uses the phrase "single-folder window," so whether one opened folder counts as "no workspace is opened" for this property is not settled by first-party documentation; the plan doc found only community corroboration (a Theia issue) and no Microsoft statement (`docs/plans/2026-07-29-shared-workspace-config-injection.md:L315`). It is cheap to settle — read `vscode.workspace.workspaceFile` once in a debug session with a single folder open — and is listed as the third pre-implementation confirmation in §5.6. **The implementation must not depend on row 3 being right:** derive the base from `workspaceFile` when it yields a filesystem path and fall back to `workspaceFolders[0]` otherwise, which produces the correct answer for row 3 either way.

### 2.6 Call architecture — one resolution, two seams

The feature has two injection seams: `createTerminal({ env })` (`src/sessionManager.ts:L120-L125`) and the dispatched command string (`src/sessionManager.ts:L147-L191`). They must be driven by **one** resolution computed **once**, or they can disagree — an env var set with no `--add-dir` does nothing, and `--add-dir` without the env var grants file access while loading no memory files (§2.0, citation 1). That is the worst outcome available and it is silent.

**Contract.**

```ts
// src/sharedConfig.ts
export interface SharedConfigInjection {
  env: Record<string, string>; // { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1" }
  args: string;                // `--add-dir "<resolved>"`
}
export function resolveSharedConfig(): SharedConfigInjection | null;
export function resetNotificationState(): void; // test-only, see below
```

`null` means "do not inject" and covers every row of §2.2.1 except S5; `resolveSharedConfig` performs its own logging and notification before returning `null`, so callers branch on the value only.

**Wiring, in this order, inside `launchSession()`:**

1. The existing missing-cwd guard (`src/sessionManager.ts:L100-L109`) — unchanged, still first.
2. `const shared = resolveSharedConfig();` — **exactly one call site in the whole extension.**
3. The existing reuse short-circuit (`src/sessionManager.ts:L111-L117`) — unchanged except that, when it is about to `focusSession` and `shared !== null`, it emits §2.2.1 row S5 first.
4. `createTerminal({ …existing four options, ...(shared ? { env: shared.env } : {}) })` — the `env` key must be **absent**, not `undefined`, when `shared` is `null` (FR6 asserts on the object shape).
5. `await this._dispatchClaudeCommand(terminal, shared?.args);`

**Step 1 before step 2 is a hard ordering requirement, not a style preference.** `test/addFolderPrompt.stale.test.ts:L71` replaces `workspace.getConfiguration` with an inline `{ get, update }` object literal that has no `inspect`, and calls `launchSession(PATH_A)` at `:L188` with a deleted cwd. That test passes unmodified **only because** the missing-cwd guard returns before any shared-config code runs. Hoisting step 2 above step 1 breaks it. See §2.8.

**`_dispatchClaudeCommand` signature.** Today it is `private async _dispatchClaudeCommand(terminal: vscode.Terminal): Promise<void>` (`src/sessionManager.ts:L147`) with no field for extra arguments. It gains one optional parameter:

```ts
private async _dispatchClaudeCommand(terminal: vscode.Terminal, extraArgs?: string): Promise<void>
```

and the single existing `const cmd = getClaudeCommand();` at `:L148` becomes the one place the arguments are appended. That one change covers all three dispatch paths at once — `cmd` is consumed unmodified at `:L153` (fast path), `:L176` (slow path), and `:L190` (`sendText` fallback) — which is how NFR3 is satisfied without touching three call sites.

**Notification state (FR9 / §2.2.1).** "First misconfiguration per window" is held in a **module-level `let` in `src/sharedConfig.ts`**, not `ExtensionContext.workspaceState`. A module-level boolean has exactly window lifetime, which is the required semantics, and it keeps `sharedConfig.ts` free of an injected `ExtensionContext` dependency (§2.4). Its cost is that Vitest shares module state across test cases in a file, so the module also exports `resetNotificationState()` for `beforeEach` to call. That export exists for tests and is documented as such in its doc comment — it is the deliberate price of the simpler state store, not an accident.

### 2.7 UNC shared-config directories — one carve-out, stated once

UNC paths are first-class in this repo, not an edge case: `isLikelyNetworkPath` matches both `\\server\share` and `//server/share` (`src/networkPath.ts:L6-L8`), `launchSession` uses it to **skip** the synchronous existence pre-flight because *"sync existsSync can hang on SMB timeouts"* (`src/sessionManager.ts:L98-L109`), and a UNC `folderPath` is passed to `createTerminal` raw rather than normalised (`:L122`). A shared config directory may reasonably live on a share.

Two rules above would otherwise misfire on such a path, and both are carved out together:

1. **NFR4's `$` refusal.** Windows administrative shares are literally `\\server\C$\...`, so refusing `$` outright would reject the most common UNC form. **When the resolved path begins with `\\` or `//` (i.e. `isLikelyNetworkPath` returns true), `$` is allowed.** The other four refused characters still apply — the reasoning for `"`, `` ` ``, `%`, and newline is unchanged by the path being UNC.
2. **FR7's `statSync` pre-flight.** Running it on a UNC path reintroduces exactly the SMB-timeout hang the repo already removed from this function. **The pre-flight is skipped for UNC paths**, reusing `isLikelyNetworkPath` rather than a second predicate.

**The combined consequence, stated plainly:** for a UNC shared-config directory Conductor validates neither directory-ness nor the PowerShell/Bash `$` risk. A wrong value therefore surfaces as `--add-dir` aborting the session at startup rather than as a logged skip — K2, accepted here for the same reason it is accepted for the session `cwd` at `:L98-L109`. The README's disclosure (NFR8) says so.

`unverified:` that `--add-dir` accepts a UNC path at all. The CLI reference states only that it *"Validates each path exists as a directory"* (`https://code.claude.com/docs/en/cli-reference`, fetched 2026-08-09) and says nothing about UNC. This is not promoted to a §5.6 confirmation: it affects only users whose shared config lives on a network share, and its failure mode is the already-accepted K2 one.

### 2.8 Impact on existing tests

`test/mocks/vscode.ts`'s `WorkspaceConfigurationStub` exposes only `get` and `update` (`test/mocks/vscode.ts:L157-L163`) and is what `workspace.getConfiguration` returns by default (`:L254`). The moment `resolveSharedConfig()` runs inside `launchSession`, any test whose config object lacks `inspect` throws `inspect is not a function`.

**Resolution: add `inspect()` to `WorkspaceConfigurationStub`**, returning `{ key: section }` — the `key` field is required by the API contract (`node_modules/@types/vscode/index.d.ts:L6867-L6892`) and every scope-value field is absent, which is exactly §2.2.1 row S1, "no injection." Existing tests then pass **unmodified**, and no existing `sessionManager.*.test.ts` file enters `touches:`.

That claim was checked, not assumed, on 2026-08-09:

- `test/sessionManager.launchResult.test.ts` (`launchSession` at `:L32`, `:L40`, `:L50`) and `test/sessionManager.uncPosix.test.ts` (`:L66`, `:L92`) call the real `launchSession` and **do not** override `getConfiguration` — they get the default stub, so the `inspect()` addition covers them.
- The three files that *do* override `getConfiguration` with an inline `{ get, update }` literal are `test/debugLog.test.ts:L33`,`:L47`,`:L64` (never calls `launchSession`), `test/sessionManager.debugLog.test.ts:L24` (drives `_handleTerminalClose`, never calls `launchSession`), and `test/addFolderPrompt.stale.test.ts:L71` (calls `launchSession` at `:L188`, but with a deleted cwd, so it returns at the guard — see §2.6's ordering requirement).
- Every other suite that involves `launchSession` stubs `SessionManager.prototype.launchSession` itself (`test/extension.openHere.test.ts:L148` and following, `test/extension.commandArgs.test.ts:L232`), so the real body never runs.

---

## 3. Scope boundaries

### In scope for the implementation issue

- One new setting: a `package.json` property, plus `export` on the existing `SECTION` constant in `src/config.ts:L4`. **No new `config.ts` getter** — the `inspect()` call lives in `sharedConfig.ts` (§2.4).
- A new module, `src/sharedConfig.ts`, resolving the setting to either an injection record or `null`-with-a-logged-reason (§2.6). It follows the single-purpose, unit-testable precedent of `src/projectGrouping.ts` and `src/workspaceMatch.ts`, though unlike those two it does read `vscode` and `fs`; "pure" here means no injected extension state, not no I/O.
- Wiring at the two existing seams from one resolution, in the order fixed by §2.6: `createTerminal({ env })` (`src/sessionManager.ts:L120-L125`) and the dispatched string (`src/sessionManager.ts:L147-L191`), the latter via a new optional `extraArgs` parameter on `_dispatchClaudeCommand` (`:L147`).
- One log line on the reuse short-circuit (`src/sessionManager.ts:L111-L117`), FR10.
- Extending `test/mocks/vscode.ts` with `inspect` on the config stub (`:L157-L163`) and `workspaceFile` on the `workspace` object (`:L251-L265`) — both verified absent, FR5/FR8/§2.8.
- Tests for every FR/NFR row above and every §2.2.1 row, in two new files: `test/sharedConfig.test.ts` (resolution logic) and `test/sessionManager.sharedConfig.test.ts` (wiring, ordering, and the reuse branch).
- README: the setting, the recommended shared-directory layout, the NFR8 disclosure, the adopted-session gap, the reuse-branch behaviour (FR10), the UNC carve-out's consequence (§2.7), and the NFR5 unsupported case.
- The four documentation edits in §5.7 — this spec's own status line, the plan's status line, the foundational spec's §2.7.2, and `docs/README.md` — all four of which are in `touches:` and were applied when this spec was accepted.

### Explicitly out of scope

- **Adopted / externally-launched sessions.** Conductor cannot set the environment or arguments of a terminal it did not create, so this feature is structurally impossible for `source: "adopted"` sessions. That is a permanent capability gap to document, not a bug — #33's territory (open, milestone v1.4.0 per `docs/plans/2026-07-29-shared-workspace-config-injection.md:L230`, verified 2026-07-29 by that document).
- Sessions launched outside Conductor entirely.
- Any change to `ActiveSession`, close detection, or the session-state schema (#68's territory).
- Per-folder shared configs inside one multi-root workspace — the accepted consequence of `"scope": "window"`. Per-root would require `"scope": "resource"` and a redesign. See §5.5.
- Authoring or templating the shared config's content. Conductor points at a directory the user writes.
- Syncing the shared config across machines.
- Generalizing `HOOK_MARKER` — not needed under R1, and should be co-designed with the #68 follow-up if a hook is ever added.

---

## 4. Risks

| # | Risk | What would have to be true | Mitigation |
|---|---|---|---|
| K1 | `--add-dir` silently expands Claude's capabilities beyond memory files: skills in `<shared>/.claude/skills/` load *"with live reload"* and subagents in `<shared>/.claude/agents/` load, independent of the memory env var (`https://code.claude.com/docs/en/permissions` § Additional directories grant file access, not configuration, fetched 2026-08-09) | The user's shared directory contains a `.claude/skills/` or `.claude/agents/` folder | Folded into §5.2 as part of the decision, and documented in the README. Recommend a dedicated shared directory containing only `CLAUDE.md` and `.claude/rules/` |
| K2 | A stale, mistyped, or file-not-directory path aborts the session at startup rather than degrading | FR7's pre-flight is skipped or regresses — **or the path is UNC, where the pre-flight is deliberately skipped (§2.7)** | FR7 is a hard requirement with three tests; the existing guard at `src/sessionManager.ts:L100-L109` is the pattern to follow, including its UNC exemption. For UNC the risk is accepted, not mitigated, and disclosed in the README |
| K3 | A user-scope value silently produces machine-global behaviour | FR5's `inspect()` gate is bypassed or `get()` is used | FR5 + its dedicated test; §2.4 records why |
| K4 | An appended flag produces an invalid invocation against a non-default `claudeCommand` | The user's `claudeCommand` ends in a positional argument | NFR5 documents it as unsupported. Severity depends on §5.4 |
| K5 | P2's inference is wrong and each session shows an approval dialog | `--add-dir` prompts on first use of a novel directory despite no documentation of it | §5.6's pre-implementation confirmation, run before any code is written. If it fails, the fallback in §2.0 becomes the route and §5.2 is moot |
| K6 | `--add-dir` grants read/edit access to the shared directory; if that directory sits inside one repo, cross-repo file access follows | The user places the shared config inside a working repo | §5.3; recommend a standalone directory |
| K7 | The feature "works" — content demonstrably loads — but adherence is inconsistent | Shared and per-folder instructions conflict | Not fixable by this design. The docs state it plainly (§1.1, P3). Set the expectation in the README rather than promising precedence |
| K8 | #44 returns "go" and invalidates the implementation | A dispatch-string-shaped design is built instead of an env+args-shaped one | NFR6 |
| K9 | Half the injection lands: the env var is set but `--add-dir` is not appended, or the reverse. The first silently loads nothing; the second grants file access while loading nothing — both look like success | The two seams are driven by two separate resolutions that can disagree | §2.6's single-call-site rule, plus a test asserting `env` and `args` are either both present or both absent |
| K10 | The user sets `sharedConfigDir`, relaunches a folder, and gets a reused terminal with no injection and no indication why — concluding the feature is broken | `reuseExistingTerminal` is `true` (the default, `src/config.ts:L14-L16`) and a session for that folder already exists | FR10 / §2.2.1 row S5. The reuse branch cannot be fixed — Conductor cannot retrofit env or args onto an existing terminal — so the requirement is that it be **legible**, not silent |

---

## 5. Decisions and open questions

### 5.1 ✅ **RESOLVED (2026-08-09)** — refuse a user-scope-only value

FR5 **refuses** to inject when the setting exists only at global scope, and logs the reason (§2.2.1 row S2). The alternative considered and rejected was to honour it with a warning ("one shared config for all my workspaces" as a convenience default).

**Answered in favour of the recommendation: refuse.** #81's own framing is that a workspace is the unit, and the research pass treated machine-global scope as a stated non-goal (`docs/research/2026-07-29-shared-workspace-config-injection.md:L13`). Refusing is also the only behaviour that is unambiguous to test. Settled — do not reopen without a new issue.

### 5.2 ✅ **RESOLVED (2026-08-09)** — R1's price is accepted

Choosing R1 buys the real `CLAUDE.md` tier and a first-party load receipt. It costs two things, both documented, and both are accepted:

1. **Read and edit access** to the shared directory for every Conductor-launched session (`https://code.claude.com/docs/en/permissions` § Working directories, fetched 2026-08-09).
2. **Automatic adoption of any skills and subagents** the shared directory happens to contain, under `.claude/skills/` and `.claude/agents/` — this is not gated by the memory env var and applies whenever `--add-dir` is used (K1).

**Answered in favour of the recommendation: accept.** R1 stands as the route, the setting stays a directory (§2.1), and the `--append-system-prompt-file` fallback is retired except for the K5 contingency in §5.6. Both costs are disclosed in the README per NFR8. Settled — do not reopen without a new issue.

### 5.3 Where should the shared config live?

Inside one of the repos (git-tracked, shareable with teammates) or outside all of them (avoids K6's cross-repo access)? These pull in opposite directions.

**Recommendation:** a standalone directory outside every repo, e.g. `~/claude-workspaces/<name>/`, documented as the recommended layout. Teams that want it tracked can keep it in its own small repo.

### 5.4 Do you actually run a non-default `claudeCommand`?

If the answer is "no, it is `claude`," K4 drops from Medium to Low and NFR5's documented-unsupported case is theoretical. If yes, say what the value is — it may change NFR5 from "document it" to "handle it."

### 5.5 Is one shared config per VS Code window enough?

`"scope": "window"` gives exactly one. Several independent scopes in one window would require a new persisted grouping model, new UI, and a new failure mode (a folder in two groups).

**Recommendation:** yes, one is enough; defer the grouping model until a concrete need exists.

### 5.6 Pre-implementation confirmations (not blockers on ACCEPTED)

Four cheap checks, all to be run by the implementer before writing code, with results recorded as a comment on the implementation issue. None blocked accepting this spec; K5 is the one that could still change the route.

1. **`--add-dir` prompting (K5, high value).** Run `claude --add-dir <novel-dir>` in two different folders in quick succession, where `<novel-dir>` has never been added before. **Pass:** no approval or trust dialog appears in either session. **Fail:** a dialog appears — the fallback route in §2.0 becomes the recommendation and §5.2 becomes moot.
2. **Worktree walk (§1.1 P1, low value — affects one README sentence).** Put a nonce in `<repo-root>/CLAUDE.md`, start `claude` in `<repo-root>/.worktrees/<branch>`, run `/context`. **Pass:** the root `CLAUDE.md` is listed under **Memory files** — the README may say worktree sessions need no configuration. **Fail:** omit that sentence. No code changes either way.
3. **`workspaceFile` in a single-folder window (§2.5 row 3, low value — settles an inherited `unverified:`).** In the Extension Development Host with exactly one folder open, read `vscode.workspace.workspaceFile`. **Either result is fine** — §2.5's fallback ordering is correct both ways — but recording the observed value lets the `unverified:` marker be removed instead of propagated a third time.
4. **`%` under `cmd.exe` (NFR4, low value — may shrink the refused character set).** Create a directory whose name contains a literal `%` (e.g. `C:\tmp\100%done`), open a `cmd.exe` terminal, and run `echo "C:\tmp\100%done"` and then `claude --add-dir "C:\tmp\100%done"`. **Pass (quotes suppress expansion):** the literal path is echoed and `--add-dir` accepts it — `%` may be dropped from NFR4's refused set, and the corresponding §2.2.1 row S4 test for `%` is removed with it. **Fail:** `%` stays refused, as written. This replaces the permanent `unverified:` the first revision of this spec carried on NFR4; it costs one terminal command and either way the answer is recorded, not inherited.

### 5.7 Flip to ACCEPTED — **executed 2026-08-09**

§5.1 and §5.2 were both answered in favour of this document's recommendations, so no R2 rewrite was needed and the sequence below was run as written, in one commit:

1. ✅ This document's `**Status:**` line changed to ACCEPTED.
2. ✅ Same-line-substituted the `**Status:**` line of `docs/plans/2026-07-29-shared-workspace-config-injection.md` (its line 20) to SUPERSEDED. **Same-line substitution only** — that file is cited by line number from `docs/specs/2026-07-29-foundational-project-spec.md` in roughly a dozen places, and an inserted or removed line silently redirects all of them.
3. ✅ Same-line-substituted `docs/specs/2026-07-29-foundational-project-spec.md` §2.7.2's line 222, whose `docs/plans/…:L20` citation supported the claim that #81 is "a decision document, not an implementation plan" — a claim step 2 falsifies. The replacement line states the claim historically and points the governing-artifact claim at this spec. The foundational spec is itself cited by line number, so this too was a same-line substitution with no reflow.
4. ✅ Updated `docs/README.md` — both table rows and the prose paragraph below the plans table, whose premise ("a draft spec cannot supersede a live plan") this flip voids. `docs/README.md` is cited by path only, never by line, so it was reflowed freely.

The sequence was deliberately deferred to the moment it became correct: a DRAFT spec cannot supersede a live plan.

### 5.8 Revision log

**Rev 1 (2026-08-09, DRAFT).** Initial spec.

**Rev 2 (2026-08-09, ACCEPTED).** Closed §5.1 and §5.2 with the user's answers, and addressed a `project-reviewer` pass:

| Finding | Where it landed |
|---|---|
| BLOCKING — the reuse short-circuit injects nothing and logs nothing | New FR10 and §2.2.1 row S5; new K10; §2.6 wiring step 3. FR9's old "in all four cases `createTerminal` is still called" claim was false for this branch and is gone |
| `config.ts` ↔ `sharedConfig.ts` contract undefined | §2.4's new subsection: `SECTION` becomes an export, `sharedConfig.ts` owns the `inspect()` call |
| `_dispatchClaudeCommand` call architecture unspecified | New §2.6, including the `SharedConfigInjection` return type and the `extraArgs?` parameter |
| NFR4's `$` refusal breaks UNC admin shares | New §2.7, one carve-out covering both `$` and the `statSync` skip |
| FR7 checks existence, not directory-ness | FR7 rewritten around `statSync(...).isDirectory()`, plus the file-not-directory test |
| Notification state store unnamed | §2.6's final paragraph: module-level `let` plus `resetNotificationState()` |
| §5.7 edits three files absent from `touches:` | All three added, plus this spec itself |
| Existing `sessionManager.*` tests will break | New §2.8: add `inspect()` to the mock stub; verified no existing test file needs changing, given §2.6's ordering requirement |
| NIT — NFR4's `%` uncertainty is permanent | Moved to §5.6 confirmation 4 |
| NIT — FR9's "warn" is ambiguous | §2.2.1's preamble: `log()` with a `WARN:` prefix; `output.ts` unchanged and not in `touches:` |

**Also changed in Rev 2, not finding-driven.** Four author judgment calls, listed so a Rev 1 → Rev 2 diff holds no surprises:

1. **K9 added** — the two seams landing out of step (env without `--add-dir`, or the reverse). Surfaced while writing §2.6; the "`--add-dir` without the env var" half grants file access while loading nothing, which is worse than not shipping.
2. **§2.2.1 row S6 tightened** to relative values only. Rev 1's FR9 said "no workspace open → `debugLog`" unconditionally, which would have skipped a perfectly good absolute or `~`-prefixed path in a no-folder window.
3. **§2.2.1 row S0 added** — a `debugLog` on the success path, so the output channel can answer "did it inject?" and not only "why didn't it?"
4. **`enableNotifications` carve-out stated** in §2.2.1. `claudeConductor.enableNotifications` governs idle-session toasts specifically; without an explicit ruling an implementer would reasonably have gated the misconfiguration warning behind it.

---

## Verification note

Repo claims were read on 2026-08-09 against the working tree at `main` (most recent commit `c65db06`, "feat: add 'Open Claude Here' Explorer context-menu command pair (#109)"), with the untracked `docs/plans/2026-08-08-session-pane-grouping.md` and `docs/research/2026-08-08-session-pane-grouping.md` present and unrelated to this work. Every `src/` and `package.json` line number in this document was re-read at those exact lines rather than carried forward from the 2026-07-29 plan doc — the file moved (`_dispatchClaudeCommand` is now at `:L147-L191`, previously cited as `:L114-L166`; `HOOK_MARKER` is at `src/hookInstaller.ts:L9`, previously cited as `:L8`), so the plan's citations to `src/` are stale and were not reused.

`node_modules/@types/vscode/index.d.ts` citations reference `@types/vscode@1.115.0`, the version the lockfile resolves (`package-lock.json:L578-L584`). It is not a committed file but is the authoritative local API surface and is reproducible via `npm install`.

**Tooling unavailable to the author of this document:** `Bash` and the `mcp__github__*` tools. GitHub state (#81, #103, #44, #110, and the `v1.6.0` milestone) was verified by `WebFetch` against public github.com URLs on 2026-08-09; commit `c65db06` is cited from the session's git-status snapshot, not from `git log`, so `unverified:` that it is the tip of `origin/main` right now. No probe was executed and none is claimed as executed — all four of §5.6's checks are unrun.

**Rev 2 additions.** Every `test/` line number in §2.8 and §2.6 was read at those exact lines on 2026-08-09, as were `src/output.ts:L1-L32` (two exported functions, no `warn`), `src/networkPath.ts:L6-L8`, `src/config.ts:L4` (`SECTION`, module-private), and `node_modules/@types/vscode/index.d.ts:L6867-L6892` (the `inspect()` return shape). The "no `warn` anywhere in `src/`" claim is from a case-insensitive `warn` search over `src/` returning zero matches on 2026-08-09; it is a negative result over the tree as it stands, not a guarantee about future files.

**Claims deliberately left unverified:** that Claude Code's upward `CLAUDE.md` walk crosses a git worktree boundary (§1.1, P1); that `--add-dir` shows no approval dialog for a novel directory (§1.1, P2 — documented absence, not a documented guarantee); that `--add-dir` accepts a UNC path at all (§2.7); that double quotes suppress `%` expansion in every `cmd.exe` invocation path (NFR4 — now scheduled as §5.6 confirmation 4 rather than carried); that a non-default `claudeCommand` accepts flags appended in trailing position (NFR5, §5.4).
