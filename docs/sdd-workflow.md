# Spec-Driven Development in this repo

This document defines the document types, section templates, and status
vocabulary that `CLAUDE.md` refers to. `CLAUDE.md` carries the rules; this
carries the shapes.

Nothing here requires a particular tool. If you have the `superpowers` plugin
installed it will produce documents in these shapes for you; if you don't, write
them by hand.

## The pipeline

```text
research  →  scoping decision  →  spec  →  implementation plan  →  code
(optional)   (optional*)          (required for behaviour changes)
```

\* Required, not optional, for pathfinding spikes whose output is a
recommendation or decision — see below.

Only the spec is mandatory, and only for the changes `CLAUDE.md` § Spec-Driven
Development lists. The scoping decision is also mandatory, but only for
pathfinding spikes as described below (#92). Research and the implementation
plan remain optional, for work that needs them.

**Pathfinding spikes that produce a recommendation require a scoping-decision
plan doc.** An issue whose entire deliverable is a recommendation or decision —
posted as a PR comment, not shipped code — must have a companion
`docs/plans/YYYY-MM-DD-<slug>.md` scoping-decision document recording that
recommendation, matching #81's shape. The dividing line: does the spike
produce a recommendation or decision that someone needs to read and act on
later? If yes, that recommendation belongs in a plan doc, not buried in a PR
comment thread. A spike whose output is purely diagnostic — root cause found,
fix carved out to a follow-up issue, nothing left to decide — remains exempt,
as #68 is. This applies going forward, to any spike that has not yet posted
its recommendation, including currently-open ones; already-closed spikes are
not revisited.

**Research is an input, never a decision.** A ranked shortlist of prior art reads
like a recommendation and is not one. Every finding a spec relies on must be
re-stated in the spec with its own citation.

## Document types

| Type | Path | Purpose | Frontmatter |
|---|---|---|---|
| `research` | `docs/research/YYYY-MM-DD-<slug>.md` | External prior art: what already exists outside this repo. | None (see below) |
| `scoping-decision` | `docs/plans/YYYY-MM-DD-<slug>.md` | Open decisions with options and consequences, written when a spec cannot yet be finalised — required, not optional, for a pathfinding spike whose output is a recommendation (#92). Not an implementation plan. | Required |
| `foundational-spec` | `docs/specs/YYYY-MM-DD-<slug>.md` | The durable project-wide problem statement, audience, and inventory. There is exactly one, and per-feature specs reference it rather than restating it. | Required |
| `feature-spec` | `docs/specs/YYYY-MM-DD-<slug>.md` | What one feature must do and why. Requirements, not steps. | Required |
| `implementation-plan` | `docs/plans/YYYY-MM-DD-<slug>.md` | Ordered, executable steps derived from an accepted spec. | Required |

Specs and plans share directories with each other by type, not by lifecycle:
`specs/` holds "what and why", `plans/` holds "which decisions" and "which
steps". Declare which one a document is in its `**Type:**` line.

**Standing process documents (`docs/<name>.md`, e.g. this file and
`docs/release-strategy.md`) intentionally have no entry in the table above.**
`CLAUDE.md`'s own "Where documents live" table names that fourth kind, and
issue #87 resolved whether to add a sixth type value for it. The answer
is no: every spec and plan type in the table above is a value that appears in a document's
`**Type:**` header line, and that header line is part of a larger contract —
the three-key frontmatter (`touches:`, `skills_relevant:`) plus a
`**Tracking issue:**` and `**Status:**` line that moves through a lifecycle
(DRAFT → ACCEPTED, etc.). Process documents carry none of that: no frontmatter,
no tracked issue driving their content, no draft/accepted lifecycle — they are
standing references that get updated in place. Adding a sixth type value
without also requiring the header-line and frontmatter contract behind it
would be cosmetic; requiring the full contract would force two documents that
don't have a lifecycle to fake one. `docs/README.md`'s separate "Process
documents" table (`Document` / `What it covers`, no `Type`/`Status` columns)
already reflects this distinction correctly and is the resolution, not a
side-step pending a real answer.

## Why the paths are fixed

`docs/specs/`, `docs/plans/`, and `docs/research/` are not cosmetic. All three
are path-glob routing triggers for the maintainer's agent harness, but they
route to different consumers, and as of #84 (D1) not all of them still fire.
`docs/research/`'s trigger is intact and dispatches the `researcher` agent for
external prior-art documents — that is unaffected by anything below. The
*automatic-review* triggers, for `project-reviewer` and
`architectural-review-for-plans`, were keyed to the pre-rename
`docs/superpowers/specs/` and `docs/superpowers/plans/` paths and do not match
the current `docs/specs/`/`docs/plans/` paths at all. A contributor who wants
architectural review on a new spec or plan must invoke `project-reviewer` or
`architectural-review-for-plans` explicitly (see `CLAUDE.md` § Where documents
live for the same rule stated at always-loaded-context length).

**A rename fails silently.** There is no error, no warning, and no log line —
specs and plans under a renamed directory simply stop being reviewed
automatically. This already happened once: `docs/specs/` and `docs/plans/`
were `docs/superpowers/specs/` and `docs/superpowers/plans/` before Issue `#84`
renamed them for contributor legibility — a deliberate, accepted decision (D1)
that knowingly traded away the automatic-review trigger for
`project-reviewer` and `architectural-review-for-plans`. Nothing in this repo
restores that routing. `docs/research/` was **not** renamed (D4), so its
routing trigger is intact and still fires automatically. **Do not rename these
paths again** — the cost was paid once, on purpose; paying it twice buys
nothing.

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

**Both pre-#84 documents have been retrofitted and now conform.** The
shared-workspace-config-injection plan
(`docs/plans/2026-07-29-shared-workspace-config-injection.md`) was retrofitted
with a `**Type:**` line and a valid `**Status:**` value under #86. Its
sibling, the foundational spec
(`docs/specs/2026-07-29-foundational-project-spec.md`), carried a
`**Tracking issue:**` and a `**Status:**` line but no `**Type:**` line until
issue #87 added one. No document in this repo predates the header-line schema
anymore.

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

Every factual or judgement claim in a spec, plan, or research document must
cite a verifiable source, inline, at the point of the claim.

| Claim about | Cite as | Verify by |
|---|---|---|
| This repo | `src/config.ts:L22-L26` | Reading those exact lines |
| A GitHub issue or PR | `#84 (open, fetched 2026-07-30)` | Fetching it |
| An external page | URL plus `(fetched YYYY-MM-DD)` | Fetching it |
| A commit | the SHA | `git log <sha>` |

**Exception: the foundational spec.** The table above is the default for every
`scoping-decision`, `feature-spec`, and `implementation-plan` — documents that
lock their citations at `ACCEPTED` and legitimately benefit from a dated
snapshot. `docs/specs/2026-07-29-foundational-project-spec.md` is the one
`foundational-spec` ("There is exactly one," continuously maintained, never
locked) and is the sole exception: its repo and GitHub issue/PR citations omit
the fetch-date and commit SHA, keeping only the path/line or the issue/PR
number and state, because git and live GitHub queries already track when
something was true and a hand-written date would only drift from that
silently (#94). External URL citations in that document still carry
`(fetched YYYY-MM-DD)` — git does not track drift on pages it doesn't host, so
that stamp still earns its keep there. For the same reason, that document
carries no `## Verification note` section (see the spec template above): that
section records a point-in-time read, which is exactly what a continuously
maintained document should not imply about itself. This carve-out applies to that one
document; every other spec and plan in this repo follows the table as
written. The same carve-out applies to the foundational spec's own
`**Tracking issue:**` header line (§ Header lines above): the `— verified
<open|closed>, body fetched <YYYY-MM-DD>` template is the default for every
other spec and plan, but on the foundational spec that line drops both
`verified` and the dated `body fetched` clause for the same reason — a live
GitHub query already tells you the current state, and a hand-written date
only drifts from it. `CLAUDE.md § Citing sources` states the general rule
("its number, its state, and the date you checked") that this document
elaborates; where the two appear to disagree on the foundational spec
specifically, this carve-out is the authoritative elaboration, not a
contradiction of CLAUDE.md's default.

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

Issue `#94` distilled that further. The bulk of §1.6 — the Activity Bar/Sidebar spec,
Quick-Pick Launcher, Terminal-as-Editor-Tab design, Status Bar, Active Session
Detection, Terminal Link Provider, Keyboard Navigation, the old configuration
schema, Extension Activation, the commands table, and the file structure — was
superseded by §2's current-state inventory and added nothing but drift risk.
The four load-bearing quotes §1.3 and §1.5 actually cited were inlined
directly at their citation sites instead of pointing at a section, and the
rest of §1.6 — along with the §1.6 heading itself — was removed. The
foundational spec no longer has a §1.6; the full verbatim v1 design remains
recoverable from this file's git history and from the commit that originally
folded in the deleted `2026-04-14-session-manager-v1-design.md`.

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
