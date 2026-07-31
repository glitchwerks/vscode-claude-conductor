# Shared workspace config-injection mechanisms for Claude Code CLI sessions

## Idea

A shared session config (a single `CLAUDE.md`-equivalent context) that gets injected into every Claude Code CLI session vscode-claude-conductor launches from folders belonging to the same VS Code workspace, layered on top of whatever per-folder `CLAUDE.md` already exists in each session's own directory.

## Requirements

1. Must apply consistently to every Claude Code CLI session Conductor launches from the same VS Code workspace, regardless of whether the launched folder is a nested worktree (e.g. `.worktrees/<branch>` under a shared repo root), a sibling worktree, or an entirely separate repo with no common filesystem ancestor.
2. Must layer on top of (not replace) each session's own per-folder `CLAUDE.md` discovery — additive, not overriding.
3. Must be a documented/native Claude Code mechanism or a well-established community pattern — not a candidate that requires reverse-engineering an undocumented file format or patching the CLI.
4. Must not silently break or require exclusive ownership of Conductor's existing hook installation (`Notification`/`UserPromptSubmit`/`Stop` hooks appended into `~/.claude/settings.json` by `hookInstaller.ts`) — a candidate that assumes it owns the whole `hooks` object, or the whole `SessionStart` chain, is a deal-breaker unless it composes with additive per-event-type arrays the way `hookInstaller.ts` already does.
5. Must scope to "this VS Code workspace" specifically — a mechanism that is global to the whole machine (e.g. `~/.claude/CLAUDE.md`) does not satisfy "one workspace = one shared config," since a user may have several unrelated Conductor-managed workspaces open across sessions or machines.

## Search axes used

- **Direct synonyms** — "Claude Code CLAUDE.md workspace shared config multiple directories", "`--append-system-prompt`", "`CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`"
- **Problem-shape synonyms** — "multi-repo monorepo shared instructions", "org-wide CLAUDE.md", "team-level CLAUDE.md layering", "workspace-level shared instructions"
- **Adjacent domains** — multi-agent orchestration tools that already run several Claude Code (or equivalent) instances against one problem and need shared conventions across them (Anthropic's own "agent teams," `claude-squad`, `oh-my-claudecode`)
- **Vendor-specific phrasing** — `code.claude.com/docs` (`memory`, `cli-reference`, `hooks`, `agent-teams`), VS Code `multi-root-workspaces` docs, `.code-workspace` / `terminal.integrated.env` settings
- **Negative axes** — generic "AI shared memory / vector DB / RAG" tools (out of scope — this is static instruction text, not retrieval); generic prompt-management SaaS unrelated to the Claude Code CLI specifically; VS Code extensions that only manage terminal *layout* (opening/naming terminals per folder) with no config-injection behavior

## Native precedence model (direct answer to research question 1)

`https://code.claude.com/docs/en/memory` (fetched 2026-07-29) documents a four-tier scope table for `CLAUDE.md`, listed "in load order, from broadest scope to most specific, so a project instruction appears in context after a user instruction":

| Scope | Location | Shared with |
| --- | --- | --- |
| Managed policy | `/etc/claude-code/CLAUDE.md` (Linux/WSL), `/Library/Application Support/ClaudeCode/CLAUDE.md` (macOS), `C:\Program Files\ClaudeCode\CLAUDE.md` (Windows) | All users on the machine |
| User instructions | `~/.claude/CLAUDE.md` | Just the user, all projects |
| Project instructions | `./CLAUDE.md` or `./.claude/CLAUDE.md` | Team, via source control |
| Local instructions | `./CLAUDE.local.md` | Just the user, current project |

There is no fifth, workspace-scoped tier in this table — "workspace" as a concept does not exist natively in Claude Code's own precedence model at all; it is purely a VS Code-side grouping concept. This is the direct, sourced answer to research question 1: no native "workspace-level CLAUDE.md" tier exists, but three adjacent, genuinely same-tier or near-same-tier mechanisms do (findings #1-3 below), and none of them are keyed to VS Code workspace identity specifically.

## Shortlist (ranked by expected value)

### 1. `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` + `--add-dir` — real `CLAUDE.md`-tier loading from an arbitrary shared directory

- **URL:** `https://code.claude.com/docs/en/memory#load-from-additional-directories` (fetched 2026-07-29)
- **Relevance:** the strongest single candidate against four of the five requirements, with requirement 5 only reachable indirectly. Quoting directly: "The `--add-dir` flag gives Claude access to additional directories outside your main working directory... To also load memory files from additional directories, set the `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` environment variable: `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude --add-dir ../shared-config`. This loads `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`, and `CLAUDE.local.md` from the additional directory." This is per-invocation and ancestry-independent (requirement 1 — works for entirely unrelated repos, not just nested ones, because Conductor already constructs the dispatched command per session), loads real `CLAUDE.md`/`.claude/rules/` content at the documented additional-directory tier rather than a different precedence tier (requirement 2/3), and has no hook interaction at all (requirement 4 is a non-issue). Requirement 5 (workspace-scoping) is **not** satisfied by the mechanism itself — being per-invocation is a necessary precondition, not the same thing as being workspace-scoped. The flag carries no VS Code workspace identity of its own; it only becomes workspace-scoped once Conductor resolves which shared directory corresponds to the current `.code-workspace` and supplies that specific path on each invocation.
- **Maturity:** documented, current, on the same primary memory page as findings #1's sibling material below.
- **Worth borrowing:** none prescribed here — the mechanism itself (env var + flag on the dispatched command) is the candidate; how it's wired into `sessionManager.ts`'s dispatch is a planning decision.
- **What to avoid:** the CLI reference's own `--add-dir` description warns "Grants file access; most `.claude/` configuration is not discovered from these directories" — this mechanism grants Claude read/edit access to the shared directory itself, a larger footprint than a config file the CLI can't otherwise touch. Whether that tradeoff is acceptable is a planning-time judgment call, not resolved by this research pass.
- **Lift effort:** drop-in (env var + one more CLI flag on the already-existing dispatch command).

### 2. Claude Code's native upward directory-tree walk of `CLAUDE.md`, plus two adjacent sharing primitives on the same doc page

- **URL:** `https://code.claude.com/docs/en/memory` (fetched 2026-07-29), sections "How CLAUDE.md files load", "Share rules across projects with symlinks", and "Import additional files"
- **Relevance:** addresses requirements 1 (partially) and 2 (fully, by design) with zero extension code. Quoting the doc directly: "Claude Code reads CLAUDE.md files by walking up the directory tree from your current working directory, checking each directory along the way... All discovered files are concatenated into context rather than overriding each other." Since Conductor's worktrees live at `.worktrees/<branch>` under the main repo root (per the repo's own `CLAUDE.md` convention), a `CLAUDE.md` placed at the repo root is already picked up automatically by every worktree session's native directory walk — no injection mechanism needed for that specific case. Two more mechanisms on the same page strengthen this: `.claude/rules/` supports symlinks ("`ln -s ~/shared-claude-rules .claude/rules/shared`"), with rules lacking `paths` frontmatter loading "with the same priority as `.claude/CLAUDE.md`" — a same-tier, cross-project sharing primitive; and for worktrees specifically, "To share personal instructions across worktrees, import a file from your home directory instead: `@~/.claude/my-project-instructions.md`" — a documented, native worktree-sharing pattern using the `@path` import syntax. Neither of the two symlink/import mechanisms addresses requirement 1's "entirely different repos with no common ancestor" case, nor requirement 5's scoping (a shared ancestor `CLAUDE.md`, or a symlinked rule, is scoped to that filesystem/project location, not explicitly to "this VS Code workspace" — two unrelated Conductor workspaces could accidentally share an ancestor or a symlink target).
- **Maturity:** current, documented, versioned page (no version-gate note on the directory-walk behavior itself, implying long-stable).
- **Worth borrowing:** none prescribed here — the mechanisms (ancestor `CLAUDE.md` placement, `.claude/rules/` symlinks, `@~/.claude/...` worktree imports) are documented conventions to evaluate against the worktree-sibling and cross-project-symlink cases specifically, before building any injection mechanism.
- **What to avoid:** the `@path` import mechanism triggers an approval dialog the first time an external import (one resolving outside the working directory) is encountered in a project — relevant if this pattern is proposed as a user-facing convention rather than something Conductor sets up silently. None of these three mechanisms generalizes to the "different repos, no common ancestor, no symlink" scenario.
- **Lift effort:** drop-in (filesystem/symlink conventions, not code).

### 3. `--append-system-prompt-file <path>` / `--append-system-prompt` CLI flags

- **URL:** `https://code.claude.com/docs/en/cli-reference#system-prompt-flags` (fetched 2026-07-29)
- **Relevance:** addresses requirement 1 fully (works regardless of directory nesting — a pure CLI flag Conductor already controls when constructing the dispatched command) and requirement 2 (appends rather than replaces the default system prompt). The docs make an explicit, first-party endorsement of exactly Conductor's invocation shape: "For instructions you want at the system prompt level, use `--append-system-prompt`. This must be passed every invocation, so it's better suited to scripts and automation than interactive use." Requirement 5 (workspace-scoping) is again only indirectly reachable: the flag is per-invocation and touches no global state, which is a precondition for scoping, but the flag itself has no notion of "this VS Code workspace" — that identity would have to come from Conductor deciding, per session, which shared content to pass on the flag.
- **Maturity:** documented, current CLI flag; a companion `--append-subagent-system-prompt` flag was added at v2.1.205, evidence of active investment in this flag family.
- **Worth borrowing:** the flag exists on the dispatched `claude` command Conductor already constructs; how (or whether) to wire it in is a planning decision, not prescribed here.
- **What to avoid:** this content loads at **system-prompt scope**, which is a different precedence tier than `CLAUDE.md` (loaded as a user message per the memory doc's troubleshooting section: "CLAUDE.md content is delivered as a user message after the system prompt, not as part of the system prompt itself"). Treat "shared config via this flag" and "a literal shared CLAUDE.md" as distinct design options, not equivalents — no source found describing how the two interact if both are present for the same session.
- **Lift effort:** drop-in (a flag on the already-existing dispatch command).

### 4. `SessionStart` hook with `additionalContext`

- **URL:** `https://code.claude.com/docs/en/hooks` (fetched 2026-07-29)
- **Relevance:** a second native mechanism for the same goal, this time hook-based. A `SessionStart`-event hook (matcher `startup`/`resume`/`clear`/`compact`/`fork`) can return `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`, and Claude Code "wraps the string in a system reminder and inserts it into the conversation" at session start. This composes with requirement 4: hooks are additive arrays per event type in `settings.json` — confirmed directly by reading `hookInstaller.ts`'s own `installHooks()` (`hookInstaller.ts:139-170`, `appendHook` pushes one more entry onto `hooks[eventType]`) and `removeHooks()` (`hookInstaller.ts:175-197`, filters only entries containing its own marker) — so adding one more `SessionStart` entry is the same additive pattern already in use, not a conflicting ownership claim.
- **Maturity:** documented, current. `additionalContext` support is also listed for `Setup`, `SubagentStart`, `UserPromptSubmit`, `UserPromptExpansion`, `PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`PostToolBatch`, and `Stop`/`SubagentStop` — a broad, stable pattern, not a one-off.
- **Worth borrowing:** the additive per-event-type array pattern already used by `hookInstaller.ts`'s `appendHook` is the same shape a `SessionStart` entry would take — noted as a compatibility fact, not a prescribed edit.
- **What to avoid:** requirement 5's workspace-scoping is **not** free here. A hook installed the way `hookInstaller.ts` currently installs its other three hooks is global — it fires for every Claude Code session on the machine, Conductor-launched or not. The hook script would need to read a workspace-identifying signal (e.g., an env var) to know which shared file to inject, and to no-op when that signal is absent, or it leaks shared-config content into unrelated sessions.
- **Lift effort:** adapt-pattern.

### 5. `--settings <path-or-inline-JSON>` CLI flag, as a scoping companion to #4

- **URL:** `https://code.claude.com/docs/en/cli-reference` (fetched 2026-07-29)
- **Relevance:** "Path to a settings JSON file or an inline JSON string. Values you set here override the same keys in your `settings.json` files for this session." This lets Conductor pass a per-invocation settings overlay (e.g., a workspace-scoped `SessionStart` hook entry) without permanently mutating the global `~/.claude/settings.json` the way `hookInstaller.ts` currently does for its idle/active/stop hooks — resolving requirement 5 more cleanly than global-hook-plus-env-var-gating (finding #4 alone).
- **Maturity:** documented, current.
- **Worth borrowing:** the option to scope a hook overlay to a single invocation rather than adding permanent global state — a design tradeoff to weigh, not a prescribed edit.
- **What to avoid:** the `claudeMd` settings key exists (see the native precedence model discussion above) but is explicitly documented as honored **only** in managed/policy settings — "Setting `claudeMd` in user, project, or local settings has no effect" — so this flag cannot be used to inject `CLAUDE.md`-equivalent text directly via a `claudeMd` key; any content carried this way would have to be a hook definition (composing with finding #4), not literal memory-file text.
- **Lift effort:** adapt-pattern.

### 6. Anthropic's own "agent teams" feature — closest first-party analogue, and a direct negative finding

- **URL:** `https://code.claude.com/docs/en/agent-teams` (fetched 2026-07-29; page states "as of v2.1.178," experimental, opt-in via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)
- **Relevance:** this is Anthropic's closest first-party feature to "multiple concurrent Claude Code instances working on one problem, staying aligned on shared conventions" (research question 3), and its architecture section is a direct negative finding for the idea: there is no team-level or shared-instructions component anywhere in the documented architecture (team config, task list, mailbox). The page states explicitly: "**`CLAUDE.md` works normally**: teammates read `CLAUDE.md` files from their working directory. Use this to provide project-specific guidance to all teammates." No `.claude/teams/` shared-CLAUDE.md object is recognized — the same page notes "A file like `.claude/teams/teams.json` in your project directory is not recognized as configuration; Claude treats it as an ordinary file."
- **Maturity:** experimental, explicitly disabled by default, with documented limitations (no session-resumption for in-process teammates, no nested teams).
- **Worth borrowing:** none directly — no shared-config mechanism exists to borrow. Confirms the gap from the vendor's own most closely-related feature.
- **What to avoid:** don't conflate this with Conductor's model — teammates share one CLI session/process; Conductor's model is separate terminals each running an independent `claude` invocation. Not a substitute architecture to adopt wholesale.
- **Lift effort:** n/a — informational.

### 7. `smtg-ai/claude-squad` — actively-maintained multi-agent terminal orchestrator, confirms the gap further

- **URL:** `https://github.com/smtg-ai/claude-squad` (README fetched 2026-07-29 via `mcp__github__get_file_contents`, blob sha `5c13a39a8e7e65ee05280feba5ac781d899b77a3`)
- **Relevance:** actively maintained (CI badge, tagged releases), manages multiple Claude Code/Codex/Gemini/Aider instances each in an isolated git worktree via tmux — structurally the closest non-Anthropic competitor to "orchestrate several Claude Code instances across isolated workspaces." Its documented "Configuration" section covers only `default_program` / `profiles` (which shell command launches each instance); nothing addresses shared `CLAUDE.md`/config across instances.
- **Maturity:** active — CI, semantic releases, Homebrew distribution.
- **Worth borrowing:** its `profiles` array (named launch-command variants in one JSON config file) is a reusable idea if Conductor ever wants per-workspace-defined launch commands, unrelated to config-sharing itself.
- **What to avoid:** AGPL-3.0 license — any code (not just the pattern) borrowed from this project would carry copyleft obligations.
- **Lift effort:** study-only.

### 8. `anthropics/claude-code#57243` — direct evidence Anthropic will not solve this upstream in the IDE extension

- **URL:** `https://github.com/anthropics/claude-code/issues/57243` "Support claude config in all workspace folders and workspace file directory (multi-root workspaces)" (fetched via `mcp__github__get_issue`, 2026-07-29; filed 2026-05-08, closed 2026-06-21, `state_reason: not_planned`)
- **Relevance:** a user filed exactly this request against the official Claude Code VS Code extension — "In multi-root VS Code workspaces, Claude Code only scans the first/primary workspace folder for claude config such as claude.md, `.mcp.json`, commands" — and it was closed not-planned. Hard evidence that a VS Code extension solving requirements 1/5 is not duplicating planned Anthropic work.
- **Maturity:** closed issue, `not_planned`.
- **Worth borrowing:** nothing code-level; useful citation for the "no prior art / no upstream plan" gap.
- **What to avoid:** this issue is about the official extension's own **project-file scanning within a multi-root `.code-workspace`**, a different code path from the CLI's cwd-based directory walk (finding #2), `--add-dir` (finding #1), or CLI flags (findings #3-5). Conductor's terminal-per-folder launch model (each terminal's cwd is the folder itself, not the workspace root) already sidesteps this specific limitation by construction.
- **Lift effort:** n/a.

### 9. `anthropics/claude-code#45643` — community proposal converges on "borrow VS Code's own `.code-workspace` shape"

- **URL:** `https://github.com/anthropics/claude-code/issues/45643` "[FEATURE] Persist --add-dir workspace configuration (.claude-workspace file)" (fetched via `mcp__github__get_issue`, 2026-07-29; filed 2026-04-09, closed 2026-04-12 as `duplicate`)
- **Relevance:** proposes a portable, checked-in `.claude-workspace` file persisting multi-directory config, explicitly modeled on VS Code's own file: "similar to how VS Code's `.code-workspace` files persist multi-root workspace configurations" (quoted directly from the issue body). Shows the community independently converging on "reuse the VS Code workspace-file concept" as the right shape, though this specific issue was closed as a duplicate of an earlier thread not fetched in this pass.
- **Maturity:** closed as duplicate — not shipped functionality, nothing to depend on.
- **Worth borrowing:** the proposed shape (`{"directories":[{"path":"../frontend"}, ...]}`, relative paths, auto-detected in cwd) as conceptual design inspiration for what a Conductor-side "workspace shared config" manifest could look like.
- **What to avoid:** treating this as available today — it's a rejected/superseded proposal, not an implemented flag. The issue body also independently corroborates finding #1's `--add-dir` + `CLAUDE.md` gap: "Per-directory CLAUDE.md — each added directory's CLAUDE.md should be respected (this is already a gap with `--add-dir` today)."
- **Lift effort:** study-only.

### 10. Manufactured-common-ancestor `CLAUDE.md` layering pattern (community blog) — excluded from the ranked shortlist

- **Excluded from ranking:** this finding's only source is a single unverified blog fetch (see below), not a documented mechanism or a primary/verifiable dated source the way findings #1-9 and #11-12 are. It is retained here as an unverified lead for context, not as a ranked, actionable candidate — do not weight it alongside the sourced findings above when making a design decision.
- **URL:** `https://karun.me/blog/2026/03/26/structuring-claude-code-for-multi-repo-workspaces/` (fetched 2026-07-29 via `WebFetch`; content below is the fetch tool's own summarization, not independently re-verified line-by-line — treat quoted implementation detail as `unverified: paraphrased by fetch tool`)
- **Relevance:** a community-documented pattern that manufactures a shared filesystem ancestor for otherwise-separate repos, relying entirely on finding #2's native directory walk rather than any tool: a "bootstrap" repo checkout serves as the common parent directory, with org-/team-level `CLAUDE.md` files at intermediate levels (`workspace/CLAUDE.md`, `workspace/orders/CLAUDE.md`), and individual product repos cloned as gitignored children underneath, using a negated `.gitignore` pattern (`orders/*` plus `!orders/CLAUDE.md`) so the shared file is still tracked. This addresses requirement 1's "entirely separate repos" case specifically — squarely the scenario in the idea statement — with zero injection code, but the pattern itself is unverified beyond the single fetch summary above.
- **Maturity:** unverified — single blog post, no repo/tool artifact to assess for activity or license.
- **Worth borrowing:** the "manufactured common ancestor + gitignore-negation to track only the shared file" pattern as design inspiration for a folder-layout convention, rather than code to integrate.
- **What to avoid:** only works if Conductor (or the user) controls where each folder is cloned relative to the others; doesn't help if a workspace mixes folders from pre-existing, unrelated filesystem locations the user doesn't want to relocate.
- **Lift effort:** study-only.

### 11. VS Code `terminal.integrated.env.<platform>` workspace-scoped setting

- **URL:** `https://code.visualstudio.com/docs/terminal/profiles` and corroborating issues `https://github.com/microsoft/vscode/issues/68032`, `https://github.com/microsoft/vscode/issues/34337` (surfaced via `WebSearch`, 2026-07-29 — not independently re-fetched against the live issue tracker in this pass)
- **Relevance:** native VS Code mechanism to inject environment variables into every integrated terminal opened under a workspace/folder scope, with `${workspaceFolder}` variable substitution — addresses requirement 5 (workspace-scoped, not machine-global) as a way to hand every terminal a "which shared config applies here" signal. Conductor already creates its terminals via `vscode.window.createTerminal({...})` in `sessionManager.ts`, which gives it an alternate, extension-owned way to set an equivalent env var at creation time without requiring the user to hand-author `.code-workspace` settings — this finding mainly matters if the goal extends to terminals *not* launched by Conductor.
- **Maturity:** stable, long-standing VS Code setting; `#68032` and `#34337` are old-vintage issues whose current-open status was not re-verified in this pass.
- **Worth borrowing:** the pattern of using workspace-scoped terminal env as a "which workspace am I in" signal, if the scope ever needs to extend to terminals Conductor didn't itself create.
- **What to avoid:** `#68032` (unverified current status) reports a VS Code trust prompt ("workspace wants to modify your terminal shell env") when `terminal.integrated.env` is used — a real UX friction point only if users are asked to hand-configure this themselves; the extension's own terminal-creation path is a separate trust boundary, already exercised by the existing hook-install consent flow.
- **Lift effort:** adapt-pattern / study-only, depending on scope decision.

### 12. `autoMemoryDirectory` and auto memory — an adjacent, Claude-authored shared-context channel (not user instructions)

- **URL:** `https://code.claude.com/docs/en/memory#storage-location` and `#auto-memory` (fetched 2026-07-29)
- **Relevance:** auto memory is a second, distinct persistence system alongside `CLAUDE.md`. Per the doc: "Each project gets its own memory directory at `~/.claude/projects/<project>/memory/`. The `<project>` path is derived from the git repository, so all worktrees and subdirectories within the same repo share one auto memory directory." This means worktree sessions of one repo already share a memory directory natively, addressing a slice of requirement 1 for that case, but for a different kind of content than requirement 2 asks for — this is "learnings and patterns Claude writes itself," not "instructions you write." Separately, `autoMemoryDirectory` is settable "from any settings scope: user, project, local, policy, or `--settings`", giving a per-invocation override similar in shape to finding #5.
- **Maturity:** documented, current; explicitly "machine-local... not shared across machines or cloud environments."
- **Worth borrowing:** none directly for this idea — flagged because it's easy to conflate with `CLAUDE.md` sharing and isn't the same mechanism.
- **What to avoid:** don't treat auto memory as a substitute for a shared *instructions* file — its content is Claude-authored and not guaranteed to contain the conventions a shared `CLAUDE.md` would.
- **Lift effort:** n/a — informational, boundary-clarifying finding.

## No prior art found

- **A mechanism keyed to VS Code workspace identity specifically.** Every candidate found (findings #1-5, #10-11) is keyed to a filesystem path, a per-invocation flag, or a machine-global scope — none is keyed to "this `.code-workspace` file" as a first-class identity the way, say, VS Code's own workspace-scoped settings are. Anthropic's own IDE-extension issue tracker shows a user asked for exactly this in the official extension (finding #8, `#57243`) and it was closed not-planned; the CLI itself has no `.code-workspace`-aware behavior at all. This is the residual gap, not "no same-tier mechanism exists" — finding #1 (`CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` + `--add-dir`) is a real, same-tier, ancestry-independent mechanism; what it lacks is workspace-identity awareness, which would have to come from Conductor's own bookkeeping (e.g., which shared-config path corresponds to which `.code-workspace` file), not from Claude Code itself. Searched: `code.claude.com/docs` (`memory`, `cli-reference`, `agent-teams`, `hooks`), GitHub issue search on `anthropics/claude-code`.
- **A mechanism that layers shared content at the exact same precedence tier as a project `CLAUDE.md`, with zero additional file-access grant.** Finding #1 gets closest (real `CLAUDE.md`/`.claude/rules/` tier) but grants Claude file access to the shared directory as a side effect of `--add-dir`. Findings #3 (system-prompt tier) and #4 (system-reminder-wrapped tier) avoid the extra file-access grant but load at a different precedence tier than `CLAUDE.md` itself. No candidate combines "exact `CLAUDE.md` tier" with "no extra access grant" — this is a genuine design tradeoff for the implementer to resolve, not one prior art hands over pre-solved.
- **Any actively-maintained third-party VS Code extension whose entire purpose is "inject one shared config into every terminal spawned across a multi-root workspace."** Searches surfaced generic terminal-management extensions (`jscheffner/vscode-workspace-terminals`, the `workspace-terminals` Marketplace listing, `ariassd/vscode-load-terminals`) that open/name terminals per folder, but none that inject shared env/config content into them — none were close enough to shortlist.

## Recommended handoff

- `project-planner` — several viable native mechanisms exist for the injection itself, each with a different tradeoff: `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` + `--add-dir` (finding #1, real `CLAUDE.md` tier, grants file access), `--append-system-prompt-file` (finding #3, system-prompt tier, no extra access), and a `SessionStart` hook plus a `--settings` overlay (findings #4-5, system-reminder tier, composes with existing hook-additive pattern). The planner should treat "which mechanism, and which precedence tier the shared config should load at" as an open design decision, and should evaluate it against Conductor's existing terminal-creation and dispatch code paths in `sessionManager.ts` rather than against VS Code's `terminal.integrated.env` (finding #11), which is a secondary option only relevant if scope extends beyond Conductor-created terminals.
- `user` — decide whether the "different worktrees of the same repo" case (finding #2, free via Claude Code's native directory walk plus the `.claude/rules/` symlink and worktree-import patterns on the same doc page, all with zero extension code) is in scope for a first cut, versus building the full injection mechanism (findings #1, #3-5) needed for "entirely different repos with no common ancestor" from day one. The two cases have very different lift.
- `user` — the manufactured-common-ancestor pattern (finding #10, excluded from the ranked shortlist — single unverified blog source) is a zero-code alternative worth considering for repos whose clone location Conductor or the user controls, but should be independently re-verified before being recommended as a documented convention, since its only source is an unverified fetch summary.

## Open questions

- Whether `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` + `--add-dir` (finding #1) triggers a trust/approval prompt per session — Conductor spawns multiple sessions at once when launching several folders together, so if each session's first invocation of a new `--add-dir` target prompts for approval, that could mean N approval prompts in quick succession. Not resolved by the memory or CLI-reference pages fetched; would need an empirical check.
- Whether `--append-system-prompt-file` content composes cleanly with each folder's own project `CLAUDE.md` when both are present, or whether one is expected to functionally supersede the other in practice — not resolved by either docs page fetched; they describe the flag and the `CLAUDE.md` load order as two separate features without describing their interaction.
- Whether the `SessionStart` hook's `additionalContext` (wrapped in a "system reminder" per the hooks doc) is treated with the same adherence weight as a real `CLAUDE.md` file — the hooks doc documents the mechanism but makes no adherence claim either way.
- The current, non-duplicate canonical issue that `anthropics/claude-code#45643` (finding #9) was closed in favor of was not identified or fetched in this pass — worth reading before treating "no built-in `.claude-workspace` file" as a settled, final answer, since the canonical thread may carry more recent maintainer commentary.
- Whether the VS Code `terminal.integrated.env` trust-prompt friction (`microsoft/vscode#68032`, finding #11) is still open as of today — surfaced only via a `WebSearch` summary, not independently re-fetched against the live issue tracker.
