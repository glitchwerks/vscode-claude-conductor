---
title: Formalize Spec-Driven Development — doc conventions, docs index, and a project-level CLAUDE.md
touches:
  - CLAUDE.md
  - docs/sdd-workflow.md
  - docs/README.md
  - README.md
  - docs/superpowers/specs/2026-07-29-foundational-project-spec.md (renamed to docs/specs/, D1; content modified — D3 fold-in + OQ6 resolution)
  - docs/superpowers/specs/2026-04-14-session-manager-v1-design.md (deleted — D3; content folded into the foundational spec above)
  - docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md (renamed to docs/plans/, D1; no content change)
  - docs/superpowers/plans/2026-07-30-formalize-spec-driven-development.md (this file; renamed to docs/plans/, D1)
skills_relevant:
  - agent-authoring
  - simplicity-first
---

# Formalize Spec-Driven Development — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Tracking issue:** [#84 "Formalize Spec-Driven Development: consolidate spec docs, wire CLAUDE.md to enforce SDD workflow"](https://github.com/cbeaulieu-gt/vscode-claude-conductor/issues/84) — verified **open**, no labels, no milestone, opened by `cbeaulieu-gt` on 2026-07-31; body fetched 2026-07-30 from the public issue page.

**Type:** implementation-plan (with a decision-points section, §2; D1–D7 confirmed by the user on 2026-07-31)
**Status:** DRAFT — awaiting execution of the task sequence below. Decision points D1–D7 in §2 are confirmed; two of them (D1, D3) reverse this plan's original recommendation, and their consequences have been propagated through the rest of this document.

**Prior inputs consumed (not re-derived):**

- Pre-run in-repo Explore map, embedded in the dispatch brief. Every claim below was re-verified against the source at the cited lines on 2026-07-30 at commit `baacee0`.
- `docs/superpowers/specs/2026-07-29-foundational-project-spec.md` — the existing foundational spec, whose §3 open question 6 this plan resolves.

**Citation convention.** Every claim cites a verifiable source per the `Cite Sources in Planning Artifacts` convention this plan proposes to codify. Repo claims cite `path:Lx-Ly`. Harness claims (files under `~/.claude/`) cite absolute paths and are flagged as **not repo-verifiable by other contributors** — they are machine-local to the maintainer. Anything unverified is prefixed `unverified:`.

**Post-Task-2 citation caveat.** Line-number citations into `docs/superpowers/specs/2026-07-29-foundational-project-spec.md` made elsewhere in this plan (§2.2, §3.2, §9) were read before Task 2 (§5) inserts the D3 fold-in content. That insertion shifts every line after the insertion point, so those citations describe the *pre-Task-2* file. They are not re-derived line-by-line throughout this document — re-locate by content (heading or quoted text), not by the stated line number, for anything read after Task 2 has run.

---

**Goal:** Make Spec-Driven Development an enforced, contributor-legible convention in this repo by adding a project-level `CLAUDE.md`, a `docs/sdd-workflow.md` conventions document, and a `docs/README.md` index — and, per the confirmed D1/D3 decisions, by renaming `docs/superpowers/{specs,plans}/` to `docs/{specs,plans}/` and folding the historical `2026-04-14-session-manager-v1-design.md` into the foundational spec.

**Architecture:** Three new markdown files, one directory rename, and a content fold-in. `CLAUDE.md` carries short, always-loaded rules (when a spec is required, where documents live, the citation requirement) and points at `docs/sdd-workflow.md` for the section templates that do not belong in every session's context. `docs/README.md` is the human-facing index that supplies contributor legibility on top of the rename, rather than instead of it. `docs/superpowers/specs/` and `docs/superpowers/plans/` are renamed to `docs/specs/` and `docs/plans/` (D1, confirmed) — a deliberate, accepted break of the routing dependency described in §3.1. `docs/research/` is unaffected (D4, confirmed) and remains a load-bearing routing path.

**Tech Stack:** Markdown only. No TypeScript, no test-suite changes, no `src/` edits.

## Global Constraints

- **Do not touch `src/`.** #84 is documentation and process work.
- **Relocate `docs/superpowers/specs/` and `docs/superpowers/plans/` to `docs/specs/` and `docs/plans/` (D1, confirmed).** This is the one exception to "do not relocate" below: it is a deliberate, accepted tradeoff that silently breaks the `project-reviewer` and `architectural-review-for-plans` auto-routing described in §2.1/§3.1. **Do not relocate anything else** — `docs/research/` (D4, confirmed) and every individual document's identity beyond this one folder move stay exactly where they are.
- **Fold `docs/specs/2026-04-14-session-manager-v1-design.md`'s content into the foundational spec, then delete the original file (D3, confirmed).** The four citing lines in the foundational spec (originally `:L59`, `:L61`, `:L80`, `:L83`) must be rewritten to reference the new location **by heading anchor, not by `path:L###`** — citing the fold-in target by line number would recreate, against the same file, exactly the fragility this constraint used to protect against. **The four quoted passages must be carried over verbatim, character-for-character.** The historical file is a record of what was decided in April; paraphrasing it while integrating misrepresents what was known at the time (§2.3).
- **The OQ6 resolution edit (Task 7) must be a strictly same-line substitution.** No inserted lines, no removed lines, no reflow. This is narrower than the constraint used to be: Task 2's D3 fold-in necessarily inserts substantial new content into the same file and is exempt from this same-line rule (nothing outside this plan cites the foundational spec by line today — confirmed in §3.2 — so a larger insertion there is safe). Locate the OQ6 line by content match (grep), not by an assumed line number, because Task 2 runs first and shifts it.
- **`CLAUDE.md` must be fully self-contained.** No `@<path>` import directives (D5, §2.5).
- **`CLAUDE.md` must not name the GitHub repo owner in prose.** The git remote is `cbeaulieu-gt/vscode-claude-conductor.git` (`.git/config:L9`), while branch metadata in the same file records PR ownership under both `cbeaulieu-gt` and `glitchwerks` (`.git/config:L19-L20`, `L25-L26`) — an account rename with a live redirect. Existing docs use `cbeaulieu-gt`; citations in this plan match that. `CLAUDE.md` prose should avoid the owner entirely.
- **The executing agent needs `Bash`.** This plan requires `git`, `npm`, and worktree operations that the planning dispatch did not have.

---

## 1. What #84 actually asks for

#84's acceptance criteria are three (issue body, fetched 2026-07-30):

1. Formalized spec document structure decided **and documented**
2. Existing spec/plan docs migrated **or consolidated**
3. Project-level `CLAUDE.md` created/updated to enforce SDD workflow

AC-1's "and documented" is why this plan produces two files rather than one: the *decision* lands in `CLAUDE.md` as rules; the *documentation of the structure* lands in `docs/sdd-workflow.md` as templates. AC-2 is satisfied two ways at once, per the confirmed D1/D3 decisions: an actual folder migration (`docs/superpowers/{specs,plans}/` → `docs/{specs,plans}/`, D1) plus a genuine content consolidation of the historical session-manager design into the foundational spec (D3) — not merely an index-by-reference, which was the original recommendation before both decisions were reversed. `docs/README.md` still provides the index (Task 6), but it is no longer AC-2's primary mechanism.

---

## 2. Decision points

Each originally carried a recommendation. **D1–D7 are now confirmed** (user, 2026-07-31); two of them — D1 and D3 — reverse this plan's original recommendation, and their consequences are propagated through §3 onward.

### D1 — Where do spec and plan documents live? **DECISION (confirmed 2026-07-31): rename `docs/superpowers/specs/` → `docs/specs/` and `docs/superpowers/plans/` → `docs/plans/`.**

"superpowers" names the *tool* that produced the documents, not the content, and `docs/release-strategy.md` already sits at `docs/` root with no tool namespace. The migration cost is trivial — exactly one committed file referenced those paths at all as of this plan's original recon (`docs/superpowers/specs/2026-07-29-foundational-project-spec.md`, per a repo-wide grep for `docs/superpowers` excluding `node_modules/`; this plan file itself is the second).

**The original recommendation below was to keep the paths unchanged**, because the paths are dispatch-routing triggers, not decoration. **The user considered that evidence and rejected the recommendation anyway**, accepting the rename's cost explicitly rather than by oversight. Restated for the record:

| Path | Consumer | Evidence |
|---|---|---|
| `docs/superpowers/specs/*.md` | `project-reviewer` agent `path_globs` — "Primary routing signal: any task referencing a spec/plan file under these paths should route here automatically" | `C:\Users\chris\.claude\agents\project-reviewer.md:L23-L27` |
| `docs/superpowers/plans/*.md` | same | `C:\Users\chris\.claude\agents\project-reviewer.md:L23-L27` |
| `docs/research/*.md`, `docs/research/**/*.md` | `researcher` agent `path_globs`; the agent is also hard-coded to write to `docs/research/<YYYY-MM-DD>-<slug>.md` | `C:\Users\chris\.claude\agents\researcher.md:L69-L73`, `L159` |
| `docs/superpowers/specs/*.md`, `docs/superpowers/plans/*.md` | `architectural-review-for-plans` skill — "**Automatically** on every `project-planner` agent return that produces a `docs/superpowers/specs/*.md` or `docs/superpowers/plans/*.md` file" | `C:\Users\chris\.claude\skills\architectural-review-for-plans\SKILL.md:L33-L36` |

`docs/research/*.md` is unaffected by this decision — D4 (confirmed separately, §2.4) leaves it in place, so its trigger stays intact.

**What the confirmed decision accepts, explicitly:**

- **A project `CLAUDE.md` cannot override the break.** These globs are consumed by the router *before* any agent is dispatched. `CLAUDE.md` is instruction context for an agent that is already running; it is not an input to the dispatch matcher. Renaming the directory does not just risk this outcome — it *causes* it, immediately and permanently, until the harness-side globs are updated (outside this repo's control; §7 R2).
- **The failure is silent, by design of the matching mechanism.** Path-glob matching uses Python `fnmatch`, which does not match a path against a pattern whose directory prefix differs. After the rename, a new spec or plan under `docs/specs/` or `docs/plans/` produces no error, no warning, and no log line — it simply does not route to `project-reviewer` or trigger `architectural-review-for-plans` automatically. Anyone who expects that automation must now request the review manually.

Contributor legibility was the argument for accepting this cost. `docs/README.md` (Task 6) adds a second, independent legibility layer on top of the rename, rather than substituting for it.

*Considered and rejected as an alternative:* shipping a repo-local `.claude/agents/project-reviewer.md` override with rewritten globs. Project-local agents do merge into the dispatch catalog and override same-named user-global entries, so this would work mechanically — but it means the repo vendors and must maintain a full copy of a 3rd-party agent definition to win a cosmetic rename. **The user confirmed no such override will be vendored**; the routing degradation stands as an accepted, permanent tradeoff, not a defect to be worked around later. (Mechanism per `C:\Users\chris\.claude\skills\agent-authoring\SKILL.md` § 3, "Project-local agents and skills are automatically merged into the catalog".)

### D2 — One living spec, or per-feature specs? **DECISION (confirmed 2026-07-31, as recommended): per-feature specs anchored by the foundational spec.**

This resolves `docs/superpowers/specs/2026-07-29-foundational-project-spec.md:L254` (§3, open question 6), which asks the question and does not answer it.

The foundational spec is already written for the per-feature reading. It calls itself *"the **seed** of the project spec, not the whole spec"* and states that *"Each feature is a future spec's subject, not this one's"* (`docs/superpowers/specs/2026-07-29-foundational-project-spec.md:L22`, `L24`). It was merged in that shape via PR #83 (per #84's issue body, fetched 2026-07-30). Choosing "one living spec" would require restructuring §2 of a document that just landed.

Two structural arguments beyond precedent:

- A single growing file conflicts with per-issue branching: two concurrent features editing one document means routine merge conflicts on prose.
- A per-feature spec can be reviewed and accepted at feature granularity. A living document has no reviewable unit — "approve the diff" is not the same as "approve the spec."

**Consequence for `docs/sdd-workflow.md`:** the foundational spec is the durable anchor for problem statement, audience, and inventory. Per-feature specs reference it rather than restating it.

### D3 — What happens to `2026-04-14-session-manager-v1-design.md`? **DECISION (confirmed 2026-07-31): fold its content into the foundational spec, then delete the original file.**

It predates the current convention: no frontmatter, no citations, plain narrative (`docs/superpowers/specs/2026-04-14-session-manager-v1-design.md:L1-L17`).

**The original recommendation was the opposite** — leave the file byte-identical and record its status in `docs/README.md` — because the foundational spec cites this file by line number at four places (`docs/superpowers/specs/2026-07-29-foundational-project-spec.md:L59`, `L61`, `L80`, `L83`, pointing at `:L15`, `:L16`, `:L168-169`, and `:L171`), and prepending or reformatting the historical file would shift every one of those citations silently — they would still *look* valid and now point at the wrong text, worse than a broken link. Reformatting the body to add citations was judged worse still: the file is a *record of what was decided in April*, and retrofitting present-day evidence onto a historical decision misrepresents what was known at the time.

**Correction found during Task 2's execution:** the `:L171` citation above was already off by one before this plan was written — the phrase it backs ("Multi-window session tracking") sits at the historical file's `:L170`; `:L171` is the next bullet ("Workspace/multi-root folder support in tree view"). This is a pre-existing citation bug in the foundational spec (not introduced by this plan), and it is exactly the silent-drift failure mode D3 is choosing to resolve rather than merely protect against. Task 2's fold-in carries both bullets into §1.6 regardless, so the wrong-line-number citation is moot once the citing line is rewritten to a heading anchor instead of a line number.

**The user considered that reasoning and rejected the recommendation anyway**, choosing integration over exemption and accepting the one-time citation-rewrite cost as a deliberate migration rather than a permanent exemption.

**New task requirement this decision adds (Task 2, §5):** whoever executes this plan must, in one commit:

(a) **Fold the 2026-04-14 file's content into the foundational spec — not into a new per-feature spec.** The historical file records the v1 session-manager design. Per D2's per-feature-anchored-by-foundational structure, the durable home for a historical design record is the foundational document itself: promoting a pre-convention narrative file to `feature-spec` status would misrepresent it as freshly authored under the current template, when it is instead being preserved as evidence of what the project decided in April. This choice is explicit, not a default reached by process of elimination.
(b) **Delete the original file** (`docs/specs/2026-04-14-session-manager-v1-design.md`, post-D1-rename) in the same commit.
(c) **Rewrite the four citing lines** (originally `docs/specs/2026-07-29-foundational-project-spec.md:L59`, `L61`, `L80`, `L83`) to reference the new location **by heading anchor** (e.g. "§1.6 — v1 design record, this document"), **not** by `path:L###`. Citing the fold-in target by line number would recreate, against the same file citing itself, exactly the fragility this decision is meant to resolve. **The four quoted passages must be carried over verbatim, character-for-character** — see Global Constraints.
(d) **Verify no other file in the repo cites the old file by line number** — re-run the repo-wide grep this plan's own recon already ran once for `docs/superpowers/specs/2026-04-14-session-manager-v1-design.md` (§3.2), rescoped to its post-rename path `docs/specs/2026-04-14-session-manager-v1-design.md`.

`docs/sdd-workflow.md` (Task 3) records that this fold-in happened and why, so a future reader understands the historical passages are quoted verbatim rather than freshly written. `docs/README.md` (Task 6) no longer carries a separate row for this file — its content is now part of the foundational spec's row.

### D4 — Are `docs/research/` docs in scope? **DECISION (confirmed 2026-07-31, as recommended): documented in the convention, not migrated or reformatted.**

They are already in a clean, non-tool-namespaced location. Moving them would break `researcher`'s `path_globs` and its hard-coded write path (`C:\Users\chris\.claude\agents\researcher.md:L69-L73`, `L159`) for the same silent-failure reason as D1.

Both existing research docs open with a `# ` heading and no YAML frontmatter (`docs/research/2026-07-29-shared-workspace-config-injection.md:L1`, `docs/research/2026-07-29-vscode-claude-conductor-landscape-survey.md:L1`). `docs/sdd-workflow.md` should therefore **describe** the research format as observed — Idea / Requirements / Search axes / ranked shortlist with fixed per-finding fields / No prior art found / Recommended handoff / Open questions — and **not mandate frontmatter**, because the producing agent does not emit it. Mandating a field the tool never writes creates a convention that is violated on day one.

Research is explicitly **an input to a spec, never a decision on its own.** That should be stated, because a ranked shortlist reads like a recommendation.

### D5 — Self-contained `CLAUDE.md`, or `@` imports of shared standards? **DECISION (confirmed 2026-07-31, as recommended): fully self-contained.**

The maintainer's global config uses `@C:\Users\chris\.claude\standards\<name>.md` import directives. Those are absolute Windows paths on one machine. They resolve for the maintainer and for nobody else — not another contributor, not CI, not a fresh clone.

This is also the honest framing of a detail worth recording as **motivation, not a defect**: `docs/superpowers/specs/2026-07-29-foundational-project-spec.md:L28` cites "`CLAUDE.md § Cite Sources in Planning Artifacts`". That citation is *valid* — it refers to the maintainer's global `~/.claude/CLAUDE.md`, which does carry that section. It is not a broken reference. But a project spec citing a section that exists only in one person's home directory is exactly the portability gap a project-level `CLAUDE.md` closes.

**Consequence:** the citation rules must be written out inline in the project `CLAUDE.md`, not imported. Keep them to the short form (the three citation shapes + the `unverified:` fallback); the long-form rationale is not needed in always-loaded context. After Task 4 writes `CLAUDE.md`, that citation resolves against a file in the repo.

### D6 — Does `CLAUDE.md` depend on the `superpowers` plugin? **DECISION (confirmed 2026-07-31, as recommended): no — describe the workflow tool-neutrally, mention the skills as optional accelerators.**

`superpowers:brainstorming` and `superpowers:writing-plans` are plugin-provided. A contributor without that plugin installed cannot follow a process that names them as required steps, and a `CLAUDE.md` with unfollowable steps is a `CLAUDE.md` that gets ignored wholesale.

Write the workflow as *what to produce* (a spec with these sections, a plan with these sections). Name the skills once, in an "Optional tooling" section, as things that help if present.

*Note the relationship to D1, updated:* this plan originally argued the **paths** must stay harness-compatible because the harness reads them mechanically, while the **prose** must stay tool-neutral because humans read it. D1 has since been confirmed as a deliberate rename that knowingly severs that harness compatibility (§2.1) — so the first half of that asymmetry no longer holds as a constraint, only as a cost the user chose to pay. The second half is unaffected: D6 is about human-legible prose, which stays tool-neutral regardless of what the harness does with paths. `docs/sdd-workflow.md` should still explain *why* the paths were fixed as of #84's rename, not just assert the new names.

### D7 — What triggers the spec requirement? **DECISION (confirmed 2026-07-31, as recommended): a three-tier trigger.**

An unanswered threshold makes the whole `CLAUDE.md` unenforceable, so this ships with a default rather than as an open question.

**Spec required:**
- adds or removes a user-visible feature, command, setting, keybinding, or UI surface
- changes existing user-visible behaviour, including a default value
- changes how the extension interacts with `~/.claude/` — hook installation, state files, or global settings

**Spec not required:**
- a bug fix that restores documented behaviour, where an issue already describes the defect
- a refactor with no behavioural change
- documentation, test, build, CI, or dependency-only changes

The third "spec required" bullet is deliberately specific to this project rather than generic. Mutating a file the extension does not own is the design property the foundational spec calls out as *"a permanent requirement of this design, not a first-run nicety"* (`docs/specs/2026-07-29-foundational-project-spec.md:L74`, citing `src/hookInstaller.ts:L6`, `L244-250`). Changes to that surface deserve a spec even when they look small.

**The user considered the process-cost tradeoff and confirmed the threshold as recommended anyway**: a stricter threshold slows small changes, a looser one lets behaviour drift in unreviewed, and the three-tier split above is the accepted balance.

---

## 3. Verified facts

### 3.1 The routing dependency (risk knowingly accepted per D1)

Covered in the D1 table above. Restated once because everything else follows from it: **four separate harness triggers key off the exact strings `docs/superpowers/specs/`, `docs/superpowers/plans/`, and `docs/research/`.** None of them is repo-tracked; all of them are silent on mismatch. D1's confirmed rename deliberately severs the first two of those three triggers; `docs/research/` is untouched (D4) and its trigger stays intact.

### 3.2 Line-citation fragility

- `docs/superpowers/specs/2026-04-14-session-manager-v1-design.md` **was** cited by line from four places in the foundational spec (`:L59`, `:L61`, `:L80`, `:L83`). Per D3 (confirmed), this fragility is being resolved rather than protected: the file's content is folded into the foundational spec and the file itself deleted (Task 2), and the four citing lines are rewritten to a heading anchor instead of a line number, so this specific fragility does not recur.
- `docs/superpowers/specs/2026-07-29-foundational-project-spec.md` is cited by line from nothing else in the repo today (grep of `docs/` for its basename returns only self-references). Its lines were safe to shift on that basis alone — and now **do** shift: Task 2's D3 fold-in inserts substantial content. Task 7's OQ6 edit (previously assumed to sit at a fixed `:L254`) must locate its target line by content grep, not by an assumed line number, because Task 2 runs first.
- `docs/superpowers/plans/2026-07-29-shared-workspace-config-injection.md` is cited by line from the foundational spec at `:L52` (citing `:L67`) and `:L119` (citing `:L199`). **Do not shift *its* lines** — D1's rename changes only its path prefix (`docs/superpowers/plans/` → `docs/plans/`); the cited line numbers inside it (`:L67`, `:L199`) are unaffected by a `git mv`, so the foundational spec's citations into it need only a path-prefix update, not a line-number rewrite. No task in this plan edits that file's content.

### 3.3 There is no project-level `CLAUDE.md` today

Confirmed by the pre-run Explore recon (root, subdirectories, `.github/`, worktrees). `.claude/` exists at repo root but is untracked (`git status` reports `?? .claude/`) and holds only `agent-memory/` and `settings.local.json`; `.gitignore:L5` ignores `settings.local.json` specifically, not the whole directory. This is the literal gap AC-3 addresses.

### 3.4 `docs/` has no index today

`docs/` contains exactly five markdown files: `release-strategy.md`, two under `research/`, one under `superpowers/plans/` (→ `plans/` after Task 1), two under `superpowers/specs/` (→ `specs/` after Task 1, one of which — the 2026-04-14 historical file — is then deleted by Task 2). There is no README, index, or table of contents. Clean slate — nothing to reconcile.

### 3.5 README already has the right hook for a link

`README.md:L124` opens `## Contributing / Development`, and `README.md:L140` already carries a `**Releases**` line linking `docs/release-strategy.md`. A parallel `**Specs**` line is the natural, precedent-following placement.

### 3.6 Build and test commands (for `CLAUDE.md`'s short build section)

From `package.json:L205-L214`: `compile` = `tsc -p ./`; `lint` = `tsc --noEmit`; `test` = `vitest run`; `test:watch` = `vitest`; `package` = `npm run compile && vsce package --no-dependencies`.

CI runs four separate jobs — Lint (`npm run lint`), Typecheck (`npx tsc --noEmit -p tsconfig.test.json`), Test (`npm test`), Compile (`npm run compile`) — at `.github/workflows/ci.yml:L11-L63`. Lint and Typecheck are genuinely distinct: they run against different tsconfigs. `README.md:L136`'s claim that "CI runs lint, typecheck, tests, and compile" is **accurate**; it is not a documentation discrepancy.

---

## 4. File structure

| File | Action | Responsibility | Approx. size |
|---|---|---|---|
| `CLAUDE.md` | Create | Always-loaded rules: when a spec is required, where documents live, the citation requirement, the "never relocate again" warning, build commands, scope boundary. **Rules only — no templates.** | ~1 page |
| `docs/sdd-workflow.md` | Create | The documented structure: the four document types, their section templates, the frontmatter contract, the historical fold-in record, and why the paths are fixed. | ~2-3 pages |
| `docs/README.md` | Create | Index of every spec, plan, and research doc with type and status. The contributor-legibility payoff on top of the D1 rename. | ~1 page |
| `README.md` | Modify (`:L140` area) | One added line in § Contributing / Development linking `docs/sdd-workflow.md`, parallel to the existing `**Releases**` line. | 1-2 lines |
| `docs/superpowers/specs/` → `docs/specs/` | **Rename (Task 1, D1)** | Directory rename; carries both spec files across via `git mv`. | n/a |
| `docs/superpowers/plans/` → `docs/plans/` | **Rename (Task 1, D1)** | Directory rename; carries both plan files across via `git mv`, including this plan file itself. | n/a |
| `docs/specs/2026-07-29-foundational-project-spec.md` (post-rename) | Modify (Task 2: D3 fold-in, content grows; Task 7: OQ6 resolution, same-line) | Absorbs the 2026-04-14 historical design content by heading anchor; separately marks §3 open question 6 as resolved by #84. | +~1 page (fold-in), +1 line (OQ6) |
| `docs/specs/2026-04-14-session-manager-v1-design.md` (post-rename) | **Delete (Task 2, D3)** | Content folded into the foundational spec above; original file removed in the same commit as the fold-in. | -1 file |
| `docs/plans/2026-07-30-formalize-spec-driven-development.md` (post-rename) | Create (already written; committed in Task 0), then carried across by Task 1's rename | This plan. Declared in `touches:` because it is part of the change set. Subject to §8 question 5 (delete after merge?). | this file |

**Why `CLAUDE.md` and `docs/sdd-workflow.md` are separate files.** `CLAUDE.md` loads into every session's context on this repo. Section templates are reference material consulted when writing one document, not context needed on every turn. Splitting them keeps the always-loaded file short enough to actually be read, and matches the shape of the maintainer's own global config (short rules + pointers to standards files). `docs/release-strategy.md` is the in-repo precedent for a `docs/`-root process document.

---

## 5. Tasks

**Adaptation note.** `superpowers:writing-plans` is TDD-shaped, and this is a documentation change with no test harness — there is no failing test to write for a markdown file. Each task therefore ends with a **concrete verification command** whose output the implementer must read before committing, in place of a red/green cycle. Do not skip them; they are the only gate this change has.

### Task 0: Branch and worktree setup

**Files:** none (git state only)

- [ ] **Step 1: Confirm you are not about to commit to `main`**

```bash
git -C I:/ai/claude/vscode-claude-conductor branch --show-current
```

Expected: `main`. If it is anything else, stop and ask — this plan assumes a fresh branch off `main`.

- [ ] **Step 2: Confirm local `main` is not diverged, then fast-forward**

```bash
git -C I:/ai/claude/vscode-claude-conductor rev-list --left-right --count main...origin/main
git -C I:/ai/claude/vscode-claude-conductor pull --ff-only origin main
```

Expected: the count's left number is `0` (local `main` has no commits the remote lacks). If it is non-zero, stop — a plain `git pull` would merge onto `main`, which is a commit-to-main violation.

- [ ] **Step 3: Create the worktree**

`.worktrees/` is already gitignored (`.gitignore:L4`), so no ignore-rule prep is needed.

```bash
git -C I:/ai/claude/vscode-claude-conductor worktree add .worktrees/84-formalize-sdd -b 84-formalize-sdd
```

- [ ] **Step 4: Move this plan file into the worktree**

This plan was written into the main checkout as an untracked file. It must live on the feature branch, not on `main`.

```bash
mv I:/ai/claude/vscode-claude-conductor/docs/superpowers/plans/2026-07-30-formalize-spec-driven-development.md \
   I:/ai/claude/vscode-claude-conductor/.worktrees/84-formalize-sdd/docs/superpowers/plans/
git -C I:/ai/claude/vscode-claude-conductor/.worktrees/84-formalize-sdd status --short
```

Expected: the plan file appears as untracked (`??`) in the worktree, and `git -C I:/ai/claude/vscode-claude-conductor status --short` no longer lists it.

- [ ] **Step 5: Commit the plan**

```bash
git -C I:/ai/claude/vscode-claude-conductor/.worktrees/84-formalize-sdd add docs/superpowers/plans/2026-07-30-formalize-spec-driven-development.md
git -C I:/ai/claude/vscode-claude-conductor/.worktrees/84-formalize-sdd commit -m "docs: add SDD formalization plan (#84)"
```

**All remaining tasks operate inside `I:/ai/claude/vscode-claude-conductor/.worktrees/84-formalize-sdd/`.** Paths below are relative to that root.

---

### Task 1: Rename `docs/superpowers/{specs,plans}/` → `docs/{specs,plans}/` (D1)

**Files:**
- Rename: `docs/superpowers/specs/` → `docs/specs/` (carries both files it contains)
- Rename: `docs/superpowers/plans/` → `docs/plans/` (carries both files it contains, including this plan file)
- Modify: `docs/specs/2026-07-29-foundational-project-spec.md` — path-prefix-only fix for its own `touches:` self-reference and its citations into `2026-07-29-shared-workspace-config-injection.md`. **Not** the four historical-file citations — those are fully rewritten in Task 2, not path-prefixed here.

**Interfaces:**
- Produces: the `docs/specs/` and `docs/plans/` paths every later task in this plan writes against. Must run before Task 2 (D3 fold-in) and Task 3 (`docs/sdd-workflow.md`), both of which write content referencing the new paths.

This is D1's confirmed decision, made mechanical. The routing-degradation consequence (§2.1) already happened the moment this task's `git mv` lands — there is no separate "point of no return" step.

- [x] **Step 1: Rename both directories with `git mv`**

```bash
git mv docs/superpowers/specs docs/specs
git mv docs/superpowers/plans docs/plans
git status --short
```

Expected: four renames (`R`), one per file that was under either directory — both spec files and both plan files (including this plan, now at `docs/plans/2026-07-30-formalize-spec-driven-development.md`).

- [x] **Step 2: Fix path-prefix references inside the foundational spec**

The only tracked files anywhere in the repo that reference `docs/superpowers` are the foundational spec and this plan file (per the repo-wide grep in §2.1). Fix the foundational spec's references that are plain path prefixes (not the four historical-file citations, which Task 2 rewrites completely):

```bash
grep -n 'docs/superpowers' docs/specs/2026-07-29-foundational-project-spec.md
```

Replace every `docs/superpowers/plans/` with `docs/plans/`, and the frontmatter's own `docs/superpowers/specs/2026-07-29-foundational-project-spec.md` self-reference with `docs/specs/2026-07-29-foundational-project-spec.md`. These are path-prefix substitutions only — none of the cited line numbers (e.g. `:L67`, `:L199` into the shared-workspace-config-injection plan) change, because a `git mv` does not alter a file's internal line numbers.

- [x] **Step 3: Verify no stale path references remain outside this plan file**

```bash
git grep -n 'superpowers/' -- ':!docs/plans/2026-07-30-formalize-spec-driven-development.md'
```

Expected: exactly the four historical-file citations Step 2 deliberately left alone (`docs/specs/2026-07-29-foundational-project-spec.md:L59,L61,L80,L83`, each citing `docs/superpowers/specs/2026-04-14-session-manager-v1-design.md`) — Task 2 rewrites these to a heading anchor rather than path-prefixing them, so they still read `docs/superpowers/` until that task runs. (This plan file itself is excluded because it legitimately narrates the *old* path in past tense while describing the D1/D3 decisions — that is history, not a live reference. Anything else in the repo must be clean; if this grep turns up more than those four lines, find and fix it before committing.)

- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: rename docs/superpowers/{specs,plans} to docs/{specs,plans} (#84, D1)"
```

---

### Task 2: Fold the historical v1 design into the foundational spec, then delete it (D3)

**Files:**
- Modify: `docs/specs/2026-07-29-foundational-project-spec.md` — insert the folded content; rewrite the four historical citations (originally `:L59`, `:L61`, `:L80`, `:L83`) to a heading anchor
- Delete: `docs/specs/2026-04-14-session-manager-v1-design.md`

**Interfaces:**
- Consumes: D3 (§2.3); Task 1's rename (this task operates on the post-rename paths and must run after it).
- Produces: the foundational spec's line count grows. Task 7 (OQ6 resolution) must locate its edit point by content grep, not by an assumed line number, because this task runs first and shifts it (§3.2).

This is the task the Global Constraints' verbatim-quote rule governs: the four passages being folded in must be copied character-for-character, not paraphrased.

- [x] **Step 1: Read the exact passages being folded in, before touching anything**

```bash
sed -n '15,17p;168,171p' docs/specs/2026-04-14-session-manager-v1-design.md
```

Copy these lines verbatim into the new subsection in Step 2 — do not retype from memory or summarize.

**Bug found during execution, resolved by widening scope rather than narrowing it:** the sed range above spans two of the four citing lines' targets (`:L15`, `:L16`) plus a *superset* of the other two (`:L168-169`, `:L171` — but `:L171`'s cited phrase, "Multi-window session tracking," actually lives at `:L170`; see the D3 correction note in §2 and the off-by-one this step's own range happens to route around by grabbing 168-171 as one block). Reading Step 1's range in isolation and this step's phrasing ("the verbatim passages") both under-specify what "content" means relative to D3(a)'s "fold its content in" and the file-structure table's "absorbs the historical content" framing. Resolved (confirmed via `advisor`): fold in the **entire** historical file, verbatim, as a blockquote — not just the four cited passages — so the delete-after-fold in Step 4 is lossless per this project's own extract-before-deletion standard, and so the off-by-one above is moot rather than silently perpetuated in a partial quote.

- [x] **Step 2: Insert a new subsection into the foundational spec**

Added `### 1.6 Historical record: the v1 session-manager design` immediately after §1.5 ("Acknowledged boundaries of the problem being solved"), containing a one-sentence frame ("Folded in from `2026-04-14-session-manager-v1-design.md` per #84 (D3); quoted verbatim, not restated") followed by the **entire** original file, verbatim, as a `> `-prefixed blockquote (see Step 1's note on why the scope widened from "the four passages" to "the whole file"). Verified byte-identical to `git show HEAD:docs/specs/2026-04-14-session-manager-v1-design.md` (pre-deletion) via a scripted diff, not eyeballing — the file contains em-dashes, `·`, `⚡`, and box-drawing characters that a visual verbatim check would not reliably catch.

- [x] **Step 3: Rewrite the four citing lines to the new heading anchor**

Located the four lines that cited the historical file by path and line number (`:L59`, `:L61`, `:L80`, `:L83`, still on the pre-rename `docs/superpowers/specs/...` path per Task 1's deliberate exemption) and replaced each `docs/superpowers/specs/2026-04-14-session-manager-v1-design.md:L##` citation with `§1.6, this document`. Did not cite the new location by line number.

- [x] **Step 4: Delete the original file**

```bash
git rm docs/specs/2026-04-14-session-manager-v1-design.md
```

- [x] **Step 5: Verify no other file in the repo still cites the deleted file by line number**

```bash
git grep -nE 'session-manager-v1-design\.md:L' -- ':!docs/plans/2026-07-30-formalize-spec-driven-development.md'
```

Empty output (the discriminating gate — the bare-basename form of this grep always hits this plan's historical narrative and §1.6's frame sentence, so it cannot be the pass condition by itself). Confirmed clean.

- [x] **Step 6: Verify the diff shows a genuine insertion, not a same-line substitution**

```bash
git diff --numstat docs/specs/2026-07-29-foundational-project-spec.md
```

Result: 180 insertions, 4 deletions. Well in excess — the fold-in adds the full historical file as a blockquote. This is deliberately **not** the same-line-substitution discipline Task 7 uses — nothing else in the repo cites this file by line today (§3.2), so a larger insertion here is safe.

- [x] **Step 7: Commit the fold-in and the deletion together**

```bash
git add -A
git commit -m "docs: fold 2026-04-14 session-manager v1 design into foundational spec, delete original (#84, D3)"
```

---

### Task 3: Write `docs/sdd-workflow.md`

**Files:**
- Create: `docs/sdd-workflow.md`

**Interfaces:**
- Produces: the canonical section templates and the four document-type definitions. Task 4 (`CLAUDE.md`) links to this file by path and must not duplicate its templates. Task 5 (`README.md`) links to it. Task 6 (`docs/README.md`) uses its Type and Status vocabularies.

Do this task after Tasks 1–2: `docs/sdd-workflow.md` documents the paths and the fold-in as they now exist, not as they were originally recommended.

- [x] **Step 1: Create the file with this content**

````markdown
# Spec-Driven Development in this repo

This document defines the document types, section templates, and status
vocabulary that `CLAUDE.md` refers to. `CLAUDE.md` carries the rules; this
carries the shapes.

Nothing here requires a particular tool. If you have the `superpowers` plugin
installed it will produce documents in these shapes for you; if you don't, write
them by hand.

## The pipeline

```
research  →  scoping decision  →  spec  →  implementation plan  →  code
(optional)   (optional)           (required for behaviour changes)
```

Only the spec is mandatory, and only for the changes `CLAUDE.md` § Spec-Driven
Development lists. The other three stages exist for work that needs them.

**Research is an input, never a decision.** A ranked shortlist of prior art reads
like a recommendation and is not one. Every finding a spec relies on must be
re-stated in the spec with its own citation.

## Document types

| Type | Path | Purpose | Frontmatter |
|---|---|---|---|
| `research` | `docs/research/YYYY-MM-DD-<slug>.md` | External prior art: what already exists outside this repo. | None (see below) |
| `scoping-decision` | `docs/plans/YYYY-MM-DD-<slug>.md` | Open decisions with options and consequences, written when a spec cannot yet be finalised. Not an implementation plan. | Required |
| `foundational-spec` | `docs/specs/YYYY-MM-DD-<slug>.md` | The durable project-wide problem statement, audience, and inventory. There is exactly one, and per-feature specs reference it rather than restating it. | Required |
| `feature-spec` | `docs/specs/YYYY-MM-DD-<slug>.md` | What one feature must do and why. Requirements, not steps. | Required |
| `implementation-plan` | `docs/plans/YYYY-MM-DD-<slug>.md` | Ordered, executable steps derived from an accepted spec. | Required |

Specs and plans share directories with each other by type, not by lifecycle:
`specs/` holds "what and why", `plans/` holds "which decisions" and "which
steps". Declare which one a document is in its `**Type:**` line.

## Why the paths are fixed

`docs/specs/`, `docs/plans/`, and `docs/research/` are not cosmetic. They are
path-glob routing triggers for the maintainer's agent harness — a spec written
under one of those paths is automatically routed to architectural review; one
written elsewhere is not.

**A rename fails silently.** There is no error, no warning, and no log line —
specs and plans under a renamed directory simply stop being reviewed
automatically. This already happened once: these two directories were
`docs/superpowers/specs/` and `docs/superpowers/plans/` before #84, and #84
renamed them for contributor legibility — a deliberate, accepted decision (D1)
that knowingly traded away the automatic-review trigger for `project-reviewer`
and `architectural-review-for-plans`. Nothing in this repo restores that
routing; a contributor who wants architectural review on a new spec or plan
must request it explicitly. `docs/research/` was **not** renamed (D4) and its
routing trigger is intact. **Do not rename these paths again** — the cost was
paid once, on purpose; paying it twice buys nothing.

## Frontmatter contract

Specs and plans open with exactly these three YAML keys:

```yaml
---
title: <short human-readable title>
touches:
  - <path or glob the document affects>
skills_relevant:
  - <skill name, no plugin prefix>
---
```

- **`touches:`** — every file, glob, or directory the document proposes to
  create, modify, or remove. Be specific: `src/sessionManager.ts`, not `src/**`.
  Under-declaring is a defect a reviewer will flag.
- **`skills_relevant:`** — tech-specific skills a reviewer needs to judge fit
  with existing conventions.

**Do not add a fourth key.** Type and status go in the prose header lines below,
not in frontmatter. The three-key shape is a contract with the review tooling.

## Header lines

Immediately after the `# Title`, every spec and plan carries:

```markdown
**Tracking issue:** [#N "<issue title>"](<url>) — verified <open|closed>, body fetched <YYYY-MM-DD>.
**Type:** feature-spec | foundational-spec | scoping-decision | implementation-plan
**Status:** DRAFT | UNDER REVIEW | ACCEPTED | SUPERSEDED BY <path> | HISTORICAL
```

**Type and status are different things** and both are required. Type never
changes; status does. Writing only `Status: DECISION DOCUMENT` conflates them and
leaves the lifecycle state unrecorded.

If the document consumed prior work, add:

```markdown
**Prior inputs consumed (not re-derived):**
- <path to research doc, prior spec, or Explore map>
```

## Spec template

```markdown
## 1. Problem
What breaks today, for whom, and why the current state is not acceptable.
Reference the foundational spec rather than restating the project's premise.

## 2. Requirements
Numbered and testable. FR-n for functional, NFR-n for non-functional.
A requirement a reviewer cannot check is not a requirement.

## 3. Scope boundaries
Explicitly in scope / explicitly out of scope. Out-of-scope items name where
they go instead (a follow-up issue, a later milestone, or "not planned").

## 4. Risks
What could go wrong, and what would have to be true for it to go wrong.

## 5. Open questions
Numbered. Mark anything needing a decision from the user or a technical expert
with ⚠️ **Confirmation needed**. Do not silently resolve an architectural
question by writing the rest of the document around one answer.

## Verification note
When the repo claims were read, at which commit, and what tooling was
unavailable to the author.
```

A `scoping-decision` document adds a **Decision points** section before
Requirements: one subsection per decision, each with the options, the
consequences of each, and a recommendation. An `implementation-plan` adds a
**Tasks** section of checkbox steps with exact paths and runnable commands.

## Citing sources

Every factual or judgement claim that drives a decision must cite a verifiable
source, inline, at the point of the claim.

| Claim about | Cite as | Verify by |
|---|---|---|
| This repo | `src/config.ts:L22-L26` | Reading those exact lines |
| A GitHub issue or PR | `#84 (open, fetched 2026-07-30)` | Fetching it |
| An external page | URL plus `(fetched YYYY-MM-DD)` | Fetching it |
| A commit | the SHA | `git log <sha>` |

**Verify before you write the claim, not after.** A post-hoc pass normalises
errors ("the citation backs the sentence I already wrote") instead of catching
them.

If you cannot verify a claim: drop it if nothing depends on it; prefix it
`unverified:` if it is useful context; stop and ask if something downstream
depends on it. **Never** soften an unverifiable claim into vaguer prose to escape
the requirement — "the API is fast" → "the API performs adequately" hides the gap
rather than closing it.

**Files under `~/.claude/` are not repo-verifiable.** They are machine-local to
the maintainer. Cite them with the absolute path and say so.

## Research document shape

Research documents are written by tooling that does not emit frontmatter, so they
have none. Observed and expected shape:

```markdown
# <Title>

## Idea
## Requirements
## Search axes used
## Shortlist (ranked by expected value)
### N. <finding>
    URL / Relevance / Maturity / Worth borrowing / What to avoid / Lift effort
## No prior art found
## Recommended handoff
## Open questions
```

## Historical content folded into the foundational spec

`2026-04-14-session-manager-v1-design.md` predated this convention — no
frontmatter, no header lines, no citations — and recorded the v1
session-manager design. As of #84 (D3), its content was folded verbatim into
`docs/specs/2026-07-29-foundational-project-spec.md` §1.6, and the original
file was deleted. The fold-in exists because that file was cited by line
number from four places in the foundational spec; rather than keep
maintaining a separate pre-convention file under permanent no-edit protection,
the content now lives inside the document that was already citing it, and
those four citations were rewritten to reference `§1.6` by heading instead of
by line number.

The general rule this illustrates still applies to any future case: **when a
document is cited by line number, edits to it must be same-line
substitutions.** No inserted lines, no removed lines, no reflow. If a real
restructure is needed, update every citing reference in the same commit — or,
as #84 did here, fold the content into the citing document and switch the
citation to a heading anchor.

## Optional tooling

If the `superpowers` plugin is installed:

- `superpowers:brainstorming` — shape a vague idea before writing the spec.
- `superpowers:writing-plans` — produce the implementation plan from an accepted
  spec.

Neither is required. Everything above can be done by hand.
````

- [x] **Step 2: Verify the file exists and has no unresolved placeholders**

```bash
grep -nE 'TBD|TODO|FIXME|<fill|XXX' docs/sdd-workflow.md
```

Expected: no output. (The `<slug>`, `<path>`, `<name>` angle-bracket tokens are intentional template placeholders and are not matched by this pattern.)

- [x] **Step 3: Verify every repo path named in the file actually exists**

```bash
grep -oE 'docs/[A-Za-z0-9._/-]+\.md' docs/sdd-workflow.md | sort -u | while read -r p; do
  test -e "$p" && echo "OK   $p" || echo "MISS $p"
done
```

**Correction found during Task 3's execution:** the sentence this replaces claimed the expected output would include a `docs/README.md` row. It does not — `docs/sdd-workflow.md`'s content never names `docs/README.md` (that reference lives in Task 4's `CLAUDE.md` content, not this file), so the grep pattern has nothing to match there. Expected: exactly one line, `OK   docs/specs/2026-07-29-foundational-project-spec.md` — the only concrete repo path this file names. The `docs/research/YYYY-MM-DD-<slug>.md`-shaped template paths in the document-types table do not match the pattern (the `<slug>` placeholder's angle bracket breaks the character class before `.md` is reached), so they produce no row at all — this is expected, not a gap. If any row *is* produced and reads `MISS`, the filename is wrong — fix it before committing.

- [x] **Step 4: Commit**

```bash
git add docs/sdd-workflow.md
git commit -m "docs: define SDD document types, templates, and citation rules (#84)"
```

---

### Task 4: Write the project-level `CLAUDE.md`

**Files:**
- Create: `CLAUDE.md` (repo root)

**Interfaces:**
- Consumes: the document-type table, path list, and status vocabulary from `docs/sdd-workflow.md` (Task 3). Link to it; do not restate the templates.
- Produces: the rule surface. Task 5's README line and Task 6's index both assume `CLAUDE.md` exists at repo root.

**D7 confirmed (§2.7, 2026-07-31, as recommended):** the spec-required threshold used in Step 1's `CLAUDE.md` content below implements that decision; no further confirmation is needed before starting this task.

- [ ] **Step 1: Create the file with this content**

```markdown
# Claude Conductor — project conventions

A VS Code extension that orchestrates multiple Claude Code CLI sessions as editor
tabs. TypeScript, Vitest, esbuild-free (`tsc` only).

**What this file is.** Project-specific rules for working in this repo. It
deliberately does **not** restate git, branching, or pull-request conventions —
bring your own. It is self-contained: no imports, no machine-local paths, nothing
that only resolves on one contributor's laptop.

## Spec-Driven Development

Changes that alter what the extension *does* get a written spec before they get
code.

**A spec is required when the change:**

- adds or removes a user-visible feature, command, setting, keybinding, or UI surface;
- changes existing user-visible behaviour, including a default value;
- changes how the extension interacts with `~/.claude/` — hook installation,
  state files, or the user's global settings.

That third case looks small and isn't. Conductor mutates a file it does not own,
which is why hook installation is gated behind explicit consent. Changes on that
surface get a spec even when the diff is three lines.

**A spec is not required for:**

- a bug fix that restores documented behaviour, where an issue already describes
  the defect;
- a refactor with no behavioural change;
- documentation, test, build, CI, or dependency-only changes.

**When in doubt, write the spec.** A short spec costs minutes. An unspecified
behaviour change costs a design argument during code review, after the code is
already written.

The spec lands and is reviewed **before** implementation starts. Opening an issue
is not the same as having a spec, and neither is permission to start coding.

## Where documents live

| Kind | Location |
|---|---|
| Spec (what and why) | `docs/specs/YYYY-MM-DD-<slug>.md` |
| Scoping decision / implementation plan | `docs/plans/YYYY-MM-DD-<slug>.md` |
| External prior-art research | `docs/research/YYYY-MM-DD-<slug>.md` |
| Standing process document | `docs/<name>.md` |

`docs/README.md` indexes all of them with type and status. **Add a row when you
add a document.**

**Never relocate or rename `docs/specs/`, `docs/plans/`, or `docs/research/` again.**
Those exact paths are routing triggers for the spec-review tooling. #84 already
renamed `docs/superpowers/specs/` and `docs/superpowers/plans/` to their current
names — a deliberate, one-time tradeoff that silently disabled automated review
for anything under the new paths, with no error and no warning. That cost was
paid once, on purpose; do not pay it again. If the naming still bothers you,
that is what `docs/README.md` is for. Rationale:
[`docs/sdd-workflow.md`](docs/sdd-workflow.md) § Why the paths are fixed.

Do not write planning documents to the repository root. `docs/` or a
subdirectory, always.

## Citing sources

Every factual or judgement claim in a spec, plan, or research document must cite
a verifiable source, inline:

- a claim about this repo → `path/to/file.ts:L42-L55`, read at those exact lines
- a claim about a GitHub issue or PR → its number, its state, and the date you checked
- a claim about anything external → the URL plus `(fetched YYYY-MM-DD)`

Verify **before** writing the claim, not in a cleanup pass. If you cannot verify
it, drop it or prefix it `unverified:`. Never reword an unverifiable claim into
something vaguer to slip past this rule.

**When a document is cited by line number, edits to it must be same-line
substitutions.** No inserted lines, no removed lines, no reflow — shifted lines
silently redirect other documents' citations to the wrong text. #84 hit this
once: the v1 session-manager design was folded into the foundational spec and
its four line-citations rewritten to a heading anchor rather than a line
number, specifically to stop the fragility from recurring. Prefer a heading
anchor over a line number wherever a citation might otherwise outlive a future
edit.

## Document shapes

Frontmatter contract, header lines, section templates, and the status vocabulary:
[`docs/sdd-workflow.md`](docs/sdd-workflow.md). Read it before writing your first
spec; you will not need it again after that.

## Build and test

```bash
npm install         # install dependencies
npm test            # run tests once
npm run test:watch  # watch mode
npm run lint        # tsc --noEmit against the main tsconfig
npm run compile     # tsc -p ./
```

Unit tests only — the `vscode` module is mocked, so no VS Code instance is
needed. CI runs lint, typecheck, test, and compile as four separate jobs on every
PR and push to `main`.

**Always add or update tests when changing behaviour.** New behaviour gets a test
for the new path; a bug fix gets a regression test that would have failed before
the fix.

## Release channel

This extension uses the VS Code marketplace odd/even minor convention for
stable versus pre-release channels. Read
[`docs/release-strategy.md`](docs/release-strategy.md) before touching the
version in `package.json` — the publish scripts enforce the convention and will
refuse a mismatched channel.

## Optional tooling

If you have the `superpowers` plugin installed, `superpowers:brainstorming` helps
shape a vague idea before the spec, and `superpowers:writing-plans` turns an
accepted spec into an implementation plan. Neither is required — the workflow in
`docs/sdd-workflow.md` is tool-neutral.
```

- [ ] **Step 2: Verify no machine-local paths or import directives leaked in**

```bash
grep -nE '@[A-Za-z]:\\|C:\\Users|~/\.claude/standards|^@' CLAUDE.md
```

Expected: no output. A hit means D5 was violated — a path that resolves for one machine only.

- [ ] **Step 3: Verify every linked repo path resolves**

```bash
grep -oE '\]\(([A-Za-z0-9._/-]+)\)' CLAUDE.md | sed -E 's/^\]\((.*)\)$/\1/' | sort -u | while read -r p; do
  test -e "$p" && echo "OK   $p" || echo "MISS $p"
done
```

Expected: all `OK`. `docs/sdd-workflow.md` exists from Task 3; `docs/release-strategy.md` already exists.

- [ ] **Step 4: Verify the build commands match `package.json`**

```bash
grep -nE '"(compile|lint|test|test:watch)":' package.json
```

Expected: `compile` = `tsc -p ./`, `lint` = `tsc --noEmit`, `test` = `vitest run`, `test:watch` = `vitest`. If any differs, fix `CLAUDE.md` — do not "fix" `package.json`.

- [ ] **Step 5: Fresh-eyes read**

Read `CLAUDE.md` top to bottom as a contributor who has never seen this repo.
Check: does any rule contradict another? Is every "never" actually inviolable
(there are exactly two — never relocate `docs/specs/`, `docs/plans/`, or
`docs/research/` again after the one accepted #84 rename, and never cite a
document by line number without keeping the citing and cited edits in the same
commit — both cause silent, hard-to-detect damage)? Is anything unfollowable
without a plugin installed?

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add project-level CLAUDE.md enforcing spec-driven development (#84)"
```

---

### Task 5: Link the workflow from `README.md`

**Files:**
- Modify: `README.md:L140` area (§ Contributing / Development)

**Interfaces:**
- Consumes: `docs/sdd-workflow.md` from Task 3.

- [ ] **Step 1: Read the current section**

```bash
sed -n '124,145p' README.md
```

Expected: `## Contributing / Development` at line 124, the `**Releases**` line at 140, `## Source` at 142.

- [ ] **Step 2: Insert a parallel `**Specs**` line immediately before the `**Releases**` line**

Add exactly this, followed by a blank line, so it sits above `**Releases**`:

```markdown
**Specs** — behaviour changes are spec-driven: a written spec lands and is reviewed before implementation. See [CLAUDE.md](CLAUDE.md) for when a spec is required and [docs/sdd-workflow.md](docs/sdd-workflow.md) for the document templates.
```

Do not restate the spec-required list here; it lives in `CLAUDE.md` and must have exactly one home.

- [ ] **Step 3: Verify placement and that nothing else moved**

```bash
git diff --stat README.md
grep -nE '^\*\*(Specs|Releases)\*\*' README.md
```

Expected: `1 file changed, 2 insertions(+)` and zero deletions. `**Specs**` appears immediately above `**Releases**`. If deletions is non-zero, something was overwritten — revert and redo.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: link SDD workflow from README contributing section (#84)"
```

---

### Task 6: Write `docs/README.md`, the document index

**Files:**
- Create: `docs/README.md`

**Interfaces:**
- Consumes: the Type and Status vocabularies from `docs/sdd-workflow.md` (Task 3); the post-rename paths from Task 1; the deletion of the historical file from Task 2.
- Produces: the contributor-legibility payoff `docs/README.md` still buys on top of the D1 rename — plain-English labels distinct from folder names.

This is the task that makes D1's tradeoff easier to live with, not the thing
that avoids the tradeoff. Write it properly — plain English labels, not path
names. Run this task after Task 2: the historical file is gone by then, and
this index must not carry a dangling row for it.

- [ ] **Step 1: Create the file with this content**

```markdown
# Documentation index

Everything in `docs/`, what it is, and whether it is current. Add a row when you
add a document.

New here? Read [`sdd-workflow.md`](sdd-workflow.md) first — it explains the
document types, why the folder names look the way they do, and what a spec needs
to contain.

## Process documents

| Document | What it covers |
|---|---|
| [`sdd-workflow.md`](sdd-workflow.md) | Spec-Driven Development: document types, section templates, frontmatter contract, citation rules. |
| [`release-strategy.md`](release-strategy.md) | Odd/even minor version convention for stable vs pre-release marketplace channels, and how to cut a release. |

## Specs — what we are building and why

Directory: `specs/`

| Document | Type | Status | Issue |
|---|---|---|---|
| [`2026-07-29-foundational-project-spec.md`](specs/2026-07-29-foundational-project-spec.md) | foundational-spec | DRAFT | #82 |

The foundational spec is the durable anchor: problem statement, audience,
feature inventory, and roadmap. Per-feature specs reference it rather than
restating it. It also carries, in its § 1.6, the v1 session-manager design
originally recorded in a separate `2026-04-14-session-manager-v1-design.md`
file — folded in and the original deleted as part of #84 (D3). There is no
separate row for that content; it is part of this document now.

## Plans — decisions and steps

Directory: `plans/`

| Document | Type | Status | Issue |
|---|---|---|---|
| [`2026-07-29-shared-workspace-config-injection.md`](plans/2026-07-29-shared-workspace-config-injection.md) | scoping-decision | DRAFT — 7 decision points and a 3-probe empirical gate unanswered; **no code should be written from it yet** | #81 |
| [`2026-07-30-formalize-spec-driven-development.md`](plans/2026-07-30-formalize-spec-driven-development.md) | implementation-plan | DRAFT | #84 |

## Research — external prior art

Directory: `research/`

| Document | What it surveyed |
|---|---|
| [`2026-07-29-shared-workspace-config-injection.md`](research/2026-07-29-shared-workspace-config-injection.md) | Mechanisms for pushing a shared config into every Claude Code CLI session. Feeds the #81 scoping decision. |
| [`2026-07-29-vscode-claude-conductor-landscape-survey.md`](research/2026-07-29-vscode-claude-conductor-landscape-survey.md) | VS Code and Claude Code CLI capabilities plus competing extensions. |

Research is an **input** to a spec, never a decision on its own. A ranked
shortlist reads like a recommendation and is not one.
```

- [ ] **Step 2: Verify every link resolves**

```bash
grep -oE '\]\(([A-Za-z0-9._/-]+)\)' docs/README.md | sed -E 's/^\]\((.*)\)$/\1/' | sort -u | while read -r p; do
  test -e "docs/$p" && echo "OK   $p" || echo "MISS $p"
done
```

Expected: all `OK`. Links are relative to `docs/`, hence the `docs/` prefix in the test.

- [ ] **Step 3: Verify the index covers every markdown file under `docs/`**

No temp files — use process substitution so nothing is written outside the repo:

```bash
diff <(find docs -name '*.md' -not -name 'README.md' | sed 's|^docs/||' | sort) \
     <(grep -oE '\]\(([A-Za-z0-9._/-]+\.md)\)' docs/README.md | sed -E 's/^\]\((.*)\)$/\1/' | sort -u)
```

Expected: no output. A line prefixed `<` is a document present on disk but missing from the index — add it.

- [ ] **Step 4: Commit**

```bash
git add docs/README.md
git commit -m "docs: add documentation index with type and status per document (#84)"
```

---

### Task 7: Resolve open question 6 in the foundational spec

**Files:**
- Modify: `docs/specs/2026-07-29-foundational-project-spec.md`, at whatever line OQ6 sits on after Task 2's fold-in — **same-line substitution only**

**Interfaces:**
- Consumes: D2 (§2.2, confirmed), which decides the answer; Task 2's fold-in, which shifted this document's line numbers, so this task locates its target by content, not by an assumed line number.

**D2 is already confirmed** (§2.2: per-feature specs anchored by the foundational spec). This task implements that confirmed decision — it is not conditional on a pending answer the way it was originally drafted.

Resolving the question in a new file would leave the OQ6 line still reading as
open, so a future reader would re-litigate it.

- [ ] **Step 1: Locate the current line by content, not by line number**

Task 2 (D3 fold-in) ran before this task and inserted content earlier in the
file, so the line that was `:L254` before Task 2 is not `:L254` now. Find it by
grep instead:

```bash
grep -n '^6\. \*\*Does "Spec-Driven Development"' docs/specs/2026-07-29-foundational-project-spec.md
```

Expected: exactly one match, a line beginning `6. **Does "Spec-Driven Development" here mean a spec per feature, or one living spec?**`. Note the line number it reports and use that number (not `254`) in Step 2's verification.

- [ ] **Step 2: Replace that single line with this single line**

```markdown
6. **RESOLVED (#84): per-feature specs anchored by this foundational spec.** ~~Does "Spec-Driven Development" here mean a spec per feature, or one living spec?~~ This document remains the durable foundation; per-feature specs reference it rather than restating it. The convention is documented at `docs/sdd-workflow.md`. No restructure of §2 is needed.
```

- [ ] **Step 3: Verify the diff is exactly one line replaced**

```bash
git diff --numstat docs/specs/2026-07-29-foundational-project-spec.md
```

Expected: `1	1	docs/specs/2026-07-29-foundational-project-spec.md` — one line added, one removed, which is what "same-line substitution" means and proves the file's line count is unchanged from this edit specifically (Task 2's earlier fold-in already changed the line count once; this step only checks that *this* edit didn't change it again). Any other numbers mean lines were inserted or removed; redo the edit as a single-line replacement.

(Do **not** verify this with a `git stash` / `wc -l` / `git stash pop` dance. If the `pop` fails, an unattended executor is left with the edit stranded in the stash and the file reverted. `--numstat` proves the same thing with no mutation.)

- [ ] **Step 4: Commit**

```bash
git add docs/specs/2026-07-29-foundational-project-spec.md
git commit -m "docs: resolve foundational spec OQ6 — per-feature specs (#84)"
```

---

### Task 8: Final verification and PR

**Files:** none (verification only)

- [ ] **Step 1: Confirm `src/` is untouched**

```bash
git diff --stat main...HEAD -- src/
```

Expected: no output. Any output means a Global Constraint was violated.

- [ ] **Step 2: Confirm the historical file no longer exists and no stray citation into it survives**

```bash
test ! -e docs/specs/2026-04-14-session-manager-v1-design.md && echo "DELETED as expected"
git grep -n 'session-manager-v1-design'
```

Expected: `DELETED as expected`, and the grep's only hits are the foundational spec's own § 1.6 self-reference and this plan file's historical narrative — no other file, and no hit anywhere carrying a `:L##` citation into the deleted path.

- [ ] **Step 3: Confirm the full change set**

```bash
git diff --stat main...HEAD
```

Expected: no remaining file under `docs/superpowers/`; `docs/specs/2026-04-14-session-manager-v1-design.md` shows as deleted; `docs/specs/2026-07-29-foundational-project-spec.md` and `docs/plans/2026-07-29-shared-workspace-config-injection.md` and `docs/plans/2026-07-30-formalize-spec-driven-development.md` (this file) show as renames from their `docs/superpowers/` originals, with the foundational spec additionally showing content changes (Task 2's fold-in, Task 7's OQ6 resolution); plus three new files (`CLAUDE.md`, `docs/sdd-workflow.md`, `docs/README.md`) and one modified file (`README.md`). Nothing else.

- [ ] **Step 4: Confirm CI still passes**

Nothing here touches TypeScript, but run it — a stray edit is cheaper to find now.

```bash
npm ci && npm run lint && npm test
```

Expected: all pass.

- [ ] **Step 5: Artifact-persistence audit**

Every file referenced by a committed file must itself be committed.

```bash
git ls-files 'docs/**' 'CLAUDE.md' 'README.md' | xargs grep -ohE '\]\(([A-Za-z0-9._/-]+\.md)\)' | sed -E 's/^\]\((.*)\)$/\1/' | sort -u
```

Cross-check each result against `git ls-files`. A referenced-but-uncommitted file vanishes silently while CI stays green.

- [ ] **Step 6: Push and open the PR**

Body must include `Closes #84` so the issue auto-closes on merge, and must end with the Claude attribution line.

```bash
git push -u origin 84-formalize-sdd
```

- [ ] **Step 7: Clean up the worktree after merge**

Use the `clean-gone` skill (hyphen). Do not invoke `commit-commands:clean_gone`.

---

## 6. Scope boundaries

**In scope:**
- Deciding and documenting the spec-document structure (AC-1).
- Resolving the migrate-or-consolidate question with an actual folder rename (D1) plus a genuine content fold-in (D3) and a supporting index (AC-2).
- Creating the project-level `CLAUDE.md` (AC-3).
- Resolving exactly one open question in the foundational spec: §3 OQ 6.

**Out of scope — and where each goes instead:**

| Item | Why out | Where it goes |
|---|---|---|
| The foundational spec's **other six** open questions (§3 OQ 1-5, 7) — audience definition, discrepancy scope, the D-1 version-floor direction, roadmap ranking, PR #77's fate, re-obtaining #81's reviewer findings | Each is a substantive product or process decision unrelated to document structure. Bundling them would make #84 unreviewable. | Follow-up issue, §8 item 1 |
| Correcting documentation discrepancies D-1 through D-4 (`docs/specs/2026-07-29-foundational-project-spec.md` § 2.6, post-rename; line numbers shift after Task 2's fold-in — locate by heading, not by the pre-Task-2 `:L185-L190`) | Touches `README.md`, `package.json`, and `src/` — a behaviour-adjacent change that this doc-only PR should not smuggle in. | Follow-up issue, §8 item 2 |
| Writing any per-feature spec | The convention has to exist first. | Naturally, as features are picked up |
| Advancing #81's shared-config work | Blocked on its own Phase-0 probes (`docs/plans/2026-07-29-shared-workspace-config-injection.md:L20`). | #81 |
| Any change under `src/` | #84 is documentation and process. | n/a |
| Adding `.claude/` and `.tmp/` to `.gitignore` | Real gap — `.gitignore:L5` ignores only `.claude/settings.local.json`, so `.claude/agent-memory/` and `.tmp/` show as untracked and are commit-able by accident. But it is a housekeeping change unrelated to SDD. | Follow-up issue, §8 item 3 |
| A CI check that enforces the spec requirement mechanically | Would need a heuristic for "is this PR a behaviour change", which is exactly the judgement call D7 assigns to a human. Premature before the convention has been used. | §8 item 4, only if the convention proves to be ignored |

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **The #84 rename (D1, confirmed) silently degrades `project-reviewer` and `architectural-review-for-plans` auto-routing for every spec/plan written under the new paths, with no error surfacing.** This is not a hypothetical future mistake — the risk is live from the moment Task 1 lands: it was a known, accepted tradeoff, not an oversight, but any contributor who assumes automatic architectural review still happens will be wrong. | Documented in `CLAUDE.md` (always loaded) *and* `docs/sdd-workflow.md` § Why the paths are fixed, both stating plainly that the automation no longer fires and why. Until/unless the harness-side globs are updated (outside this repo's control — R2), anyone writing a new spec or plan should manually invoke `project-reviewer` or the `architectural-review-for-plans` skill rather than assume it happens for them. |
| R2 | **The harness paths change upstream**, orphaning the convention further. The triggers live in the maintainer's `~/.claude/`, outside this repo — nothing here can detect a change. | `docs/sdd-workflow.md` states *why* the paths were fixed rather than just asserting them, so a future reader can re-derive whether the reason still holds. Accepted risk; there is no in-repo way to pin it. |
| R3 | **`CLAUDE.md` becomes a dumping ground** and stops being read. | The file states its own scope boundary ("does not restate general git/PR conventions") and pushes templates to `docs/sdd-workflow.md`. Reviewers should reject additions that belong in the workflow doc. |
| R4 | **D7's threshold proves wrong in practice** — too strict and small changes stall, too loose and behaviour drifts unreviewed. | The threshold is one section of one file; revising it is cheap. Revisit after roughly five specs have been written against it. |
| R5 | **The `docs/README.md` index goes stale**, which is worse than no index because it looks authoritative. | Task 6 Step 3 gives a one-line `diff` check that catches missing rows. `CLAUDE.md` says "add a row when you add a document." *unverified:* whether a pre-commit or CI check for this is worth the maintenance — not evaluated. |
| R6 | **Contributors without the `superpowers` plugin cannot follow the process.** | D6: the workflow is tool-neutral; skills are named once as optional accelerators. Verified by Task 4 Step 5's fresh-eyes read. |

---

## 8. Open questions

1. **Should the remaining six open questions in the foundational spec be closed out in a follow-up, or left standing?** They have been open since 2026-07-29. Several (OQ 3, the version-floor direction) are blocking a real correction. ⚠️ **Confirmation needed.**
2. **Should `docs/README.md` carry an `Accepted` status for the foundational spec?** It currently reads `DRAFT — awaiting user review` (`docs/specs/2026-07-29-foundational-project-spec.md`, header lines — the exact line number shifts after Task 2's fold-in) despite having been merged via PR #83. A merged-but-still-DRAFT document is ambiguous: is the DRAFT stale, or is review genuinely outstanding? Task 6 records `DRAFT` faithfully rather than guessing. ⚠️ **Confirmation needed** — and if the answer is "it's accepted", that is a second same-line edit to add to Task 7.
3. **Should `AGENTS.md` be added as a pointer to `CLAUDE.md`?** Other agentic tools read `AGENTS.md` rather than `CLAUDE.md`. A two-line pointer file would make the conventions portable across tools at near-zero cost. Not included because #84 names only `CLAUDE.md`, and adding an unasked-for file to the repo root is a decision the maintainer should make.
4. **Is `superpowers` the right long-term home for these documents at all,** given D1 shows the repo is now shaped around one contributor's harness? The alternative — the harness adapts to the repo — is a change to `~/.claude/agents/project-reviewer.md` and `~/.claude/agents/researcher.md`, outside this repo's control. Worth raising if the repo ever takes outside contributors.
5. **Should the plan file be deleted after #84 merges,** per the plan-lifecycle convention? Task 4 indexes it in `docs/README.md`, which would become a dangling link on deletion. Recommendation: delete the plan and drop its index row in the same commit, after extracting the D1 rationale — which is already extracted into `docs/sdd-workflow.md` § Why the paths are fixed, so nothing is lost. ⚠️ **Confirmation needed.**
6. **Gap found during Task 3's execution: the Type/Status vocabulary `docs/sdd-workflow.md` defines has two holes neither Task 4 nor Task 7 currently closes.** (a) The five document types in `docs/sdd-workflow.md` § Document types are all scoped under `docs/{specs,plans,research}/`, but Task 4's `CLAUDE.md` content adds a sixth row — "Standing process document | `docs/<name>.md`" — for files like `docs/release-strategy.md` and `docs/sdd-workflow.md` itself, which `docs/sdd-workflow.md`'s own table does not define a type for. Task 6's index-completeness check (§5, Task 6 Step 3) requires every `docs/**/*.md` file to appear in `docs/README.md` with a type, so both of those files need one. (b) `docs/sdd-workflow.md` § Header lines states `**Type:**` is required on "every spec and plan", but the existing foundational spec (`docs/specs/2026-07-29-foundational-project-spec.md:L14-L18`) and the existing shared-workspace-config-injection plan (`docs/plans/2026-07-29-shared-workspace-config-injection.md:L18-L20`) both carry `**Tracking issue:**` and `**Status:**` but no `**Type:**` line — confirmed by direct read, not inferred. Task 7 is constrained to a strictly same-line substitution and cannot add a line to the foundational spec, so neither existing document in `docs/specs/`/`docs/plans/` currently satisfies the convention `docs/sdd-workflow.md` asserts. This is the same failure mode D4 warns against (a convention violated on day one). Neither gap is fixed by this dispatch — it is out of Task 3's scope and is recorded here for whoever executes Task 4, Task 6, or Task 7 to resolve (either add a sixth document type plus retrofit the two missing `**Type:**` lines as an explicit same-line-safe addendum, or narrow `docs/sdd-workflow.md`'s "both are required" claim to documents created after #84). ⚠️ **Confirmation needed.**

---

## 9. Proposed follow-up issues

**None of these has been created.** This dispatch had no `Bash` and no `mcp__github__*` tools, so no GitHub state could be read or written. The router or user must file them.

Recommend grouping under a new milestone, e.g. **"Documentation and process"**, created at planning time per the issue-tracking convention.

1. **"Close out the remaining open questions in the foundational project spec"** — OQ 1-5 and 7, `docs/specs/2026-07-29-foundational-project-spec.md` § 3 (post-rename; exact line numbers shift after Task 2's fold-in — locate by the "§3. Open questions" heading, not by the pre-Task-2 `:L249-L255`). Label `documentation`. Depends on nothing; blocks item 2 (OQ 3 decides D-1's direction).
2. **"Correct documentation discrepancies D-1 through D-4"** — from the same spec, § 2.6 (post-rename; do not rely on the pre-Task-2 `:L185-L190`). Touches `README.md`, possibly `package.json:L9`, `src/stateWatcher.ts:L22`, `src/hookInstaller.ts:L302-303`. Blocked by item 1's answer to OQ 3.
3. **"Ignore `.claude/` and `.tmp/` in `.gitignore`"** — `.gitignore:L5` ignores only `.claude/settings.local.json`. Small, independent, no dependencies.
4. **"Evaluate whether the SDD convention needs mechanical enforcement"** — only after the convention has been used for several features. Deliberately deferred; premature automation of a judgement call is worse than the judgement call.

**Also required of the router or user (not issues):**

- Post a comment on #84 recording the D1 outcome — that the folder rename was **accepted**, along with its explicitly-accepted consequence (silent degradation of `project-reviewer`/`architectural-review-for-plans` auto-routing for future specs and plans under the new paths, per §2.1) — so the decision is durable even if this plan file is later deleted per §8 question 5.
- Tick #84's acceptance criteria when the PR merges, or confirm they auto-resolve via `Closes #84`.

---

## 10. Quality-check notes and honesty ledger

- **Tooling unavailable to this dispatch:** `Bash`, `mcp__github__*`, and `Write`-to-GitHub of any kind. Issue #84's state was obtained by fetching its public page on 2026-07-30, not through the API. No issue was created, no comment posted, no acceptance criterion ticked.
- **Repo claims** were read at the cited lines on 2026-07-30 at commit `baacee0`.
- **Harness claims are not repo-verifiable.** The four routing triggers in §2.1 and §3.1 cite files under `C:\Users\chris\.claude\` — the maintainer's machine-local agent and skill definitions. They were read directly at the cited lines, but no other contributor and no CI job can verify them. This is itself part of R2.
- **Checked and found *not* to be a defect:** `README.md:L136` claims CI runs "lint, typecheck, tests, and compile". `package.json:L209` defines `lint` as `tsc --noEmit`, which looks like a duplicate of typecheck — but `.github/workflows/ci.yml:L21-L36` shows the two jobs run against *different* tsconfigs (main vs `tsconfig.test.json`). The README is accurate. Recorded here so the next reader does not re-investigate.
- **Checked and found *not* to be a defect:** the foundational spec's citation of `CLAUDE.md § Cite Sources in Planning Artifacts` at `:L28` resolves against the maintainer's global config, which does carry that section. It is a portability gap, not a broken reference — see D5.
- **`unverified:`** whether the `project-reviewer` agent actively rejects or flags a fourth frontmatter key. `docs/sdd-workflow.md`'s "do not add a fourth key" rule rests on the documented three-key contract plus the fact that two proposed fourth keys (`confidence:`, `change_scope:`) were explicitly rejected for v1 — not on observed rejection behaviour. The rule is right either way; the stated reason is the weaker part.
- **`unverified:`** whether a CI or pre-commit check for `docs/README.md` staleness is worth its maintenance cost (R5). Not evaluated.
- **No longer accurate as originally written; superseded by the D1/D3 confirmations:** this entry originally read "no consolidation of document *content*... §2.1 argues migration is actively harmful and §4 delivers consolidation-by-index instead." Both halves are now false. The user confirmed D1 (folder migration) and D3 (content consolidation of the historical file into the foundational spec) — see §2.1, §2.3, and §4. AC-2 is now satisfied by an actual migration plus a genuine content fold-in, not by an index standing in for both. `docs/README.md` (Task 6) still exists, but as a supporting index rather than AC-2's primary mechanism.
- **Deliberately not done:** the `init` skill was not used to generate `CLAUDE.md`. It produces a codebase-documentation file, which is the wrong shape here — the codebase facts already live in the foundational spec with citations, and duplicating them into always-loaded context would create two sources of truth that drift.
