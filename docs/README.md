# Documentation index

Every document in `docs/`, what it covers, and — for specs and plans, which
carry a status vocabulary — its current status. Add a row when you add a
document.

New here? Read [`sdd-workflow.md`](sdd-workflow.md) first — it explains the
document types, why the folder names look the way they do, and what a spec needs
to contain.

## Process documents

This index does not carry a row for itself (`docs/README.md`) — that is a
stated exception, not a gap.

| Document | What it covers |
|---|---|
| [`sdd-workflow.md`](sdd-workflow.md) | Spec-Driven Development: document types, section templates, frontmatter contract, citation rules. |
| [`release-strategy.md`](release-strategy.md) | Odd/even minor version convention for stable vs pre-release marketplace channels, and how to cut a release. |

## Specs — what we are building and why

Directory: `specs/`

| Document | Type | Status | Issue |
|---|---|---|---|
| [`2026-07-29-foundational-project-spec.md`](specs/2026-07-29-foundational-project-spec.md) | foundational-spec | ACCEPTED | #82 |
| [`2026-04-28-75-favorites-design.md`](specs/2026-04-28-75-favorites-design.md) | feature-spec | ACCEPTED | #75 |
| [`2026-08-04-workspace-folder-launcher-design.md`](specs/2026-08-04-workspace-folder-launcher-design.md) | feature-spec | ACCEPTED | #103 |
| [`2026-08-07-explorer-open-claude-here.md`](specs/2026-08-07-explorer-open-claude-here.md) | feature-spec | ACCEPTED | #107 |
| [`2026-08-09-shared-workspace-config-injection.md`](specs/2026-08-09-shared-workspace-config-injection.md) | feature-spec | ACCEPTED — §5.1 and §5.2 answered; four pre-implementation confirmations in §5.6 remain unrun | #81 |
| [`2026-08-15-hook-self-heal-reliability.md`](specs/2026-08-15-hook-self-heal-reliability.md) | feature-spec | ACCEPTED — both §5 open questions resolved in review (Resolutions 1 and 2); ready for implementation | #128 |
| [`2026-08-15-session-tab-default-grouping.md`](specs/2026-08-15-session-tab-default-grouping.md) | feature-spec | ACCEPTED (Rev 5) — the mechanism is a **stateless best-effort placement heuristic** (join the group holding the most `claude · `-labelled tabs, else `Beside`), unchanged since Rev 3, which removed ownership tracking rather than repairing it after two review passes broke it on the same root cause: the stable Tab API exposes no creator identity. Rev 4 closed every design question (OQ-1…OQ-9, answered by the repo owner 2026-08-15). **Rev 5: the § 2.5.1 probe session ran and P-LABEL — the sole hard gate — PASSED**, along with all three informative checks (P6, P-PLACE, P-REVEAL); full results at [#127 comment `5305122522`](https://github.com/glitchwerks/vscode-claude-conductor/issues/127#issuecomment-5305122522). **Approved for implementation.** | #127 |

The foundational spec is the durable anchor: problem statement, audience,
feature inventory, and roadmap. Per-feature specs reference it rather than
restating it. It previously carried, in its § 1.6, the full v1
session-manager design originally recorded in a separate
`2026-04-14-session-manager-v1-design.md` file — folded in and the original
deleted as part of #84 (D3). #94 distilled that section down to the four
load-bearing quotes §1.3 and §1.5 actually cited, inlined them at those
citation sites, and removed the rest (superseded by the § 2 inventory above);
the full verbatim v1 design remains recoverable via git history. There is no
separate row because the standalone document was deleted after its content
was folded into the foundational spec.

## Plans — decisions and steps

Directory: `plans/`

| Document | Type | Status | Issue |
|---|---|---|---|
| [`2026-07-29-shared-workspace-config-injection.md`](plans/2026-07-29-shared-workspace-config-injection.md) | scoping-decision | SUPERSEDED by [`specs/2026-08-09-shared-workspace-config-injection.md`](specs/2026-08-09-shared-workspace-config-injection.md) — **do not implement from it** | #81 |
| [`2026-08-08-session-pane-grouping.md`](plans/2026-08-08-session-pane-grouping.md) | scoping-decision | SUPERSEDED by [`specs/2026-08-15-session-tab-default-grouping.md`](specs/2026-08-15-session-tab-default-grouping.md) — **do not implement from it**; D1 and D7 are superseded rather than resolved, D4's retest is superseded by the spec's redefined gate (§ 2.2.1 / OQ-6), not run | #110 |

The shared-workspace-config plan was flipped from UNDER REVIEW to SUPERSEDED on
2026-08-09, when
[`specs/2026-08-09-shared-workspace-config-injection.md`](specs/2026-08-09-shared-workspace-config-injection.md)
was accepted — the spec resolves the plan's seven decision points, dissolves its
three-probe Phase 0 gate, and selects route R1. The flip sequence, including the
same-line-substitution constraint it had to respect, is recorded in the spec's
§5.7.

The plan is **retained rather than deleted**, an intentional exception to the
plan-lifecycle convention: its §2 verified facts are cited by line number from
the foundational spec, and its §12 records the `unverified:` provenance behind
the spec's §2.5 path-resolution table (the table itself is reproduced in the
spec, so the spec stays checkable independently). Its `src/` citations are
stale — the spec re-read every one of them — so treat the plan as historical
evidence, not as a source of file:line facts.

The SDD formalization plan (`docs/plans/2026-07-30-formalize-spec-driven-development.md`,
#84) has been deleted per the plan-lifecycle convention — #84 is closed and merged
(PR #85), and its durable content (the D1 rename rationale, the CLAUDE.md and
sdd-workflow.md it produced) already lives in this repo. No row remains for it here.

The shared-workspace plan was retrofitted with its own `**Type:**` and a valid
`**Status:**` value under #86, so it now conforms to the header-line convention
in [`sdd-workflow.md`](sdd-workflow.md) and its Type/Status values above are
read directly from its header rather than assigned by this index. The
foundational spec (see the Specs table above) was retrofitted with a
`**Type:**` line the same way under #87, so both pre-#84 documents now conform
and no spec or plan in this repo still predates the header-line convention.

## Research — external prior art

Directory: `research/`

| Document | What it surveyed |
|---|---|
| [`2026-07-29-shared-workspace-config-injection.md`](research/2026-07-29-shared-workspace-config-injection.md) | Mechanisms for pushing a shared config into every Claude Code CLI session. Feeds the #81 scoping decision. |
| [`2026-07-29-vscode-claude-conductor-landscape-survey.md`](research/2026-07-29-vscode-claude-conductor-landscape-survey.md) | VS Code and Claude Code CLI capabilities plus competing extensions. |
| [`2026-08-08-session-pane-grouping.md`](research/2026-08-08-session-pane-grouping.md) | Whether an extension can default-group its own tabs into one pane (à la the built-in Terminal panel) while keeping native drag-out behavior; surveys `TerminalLocation`/`ViewColumn`/`tabGroups` API and Anthropic's own Claude Code extension as prior art. |

Research is an **input** to a spec, never a decision on its own. A ranked
shortlist reads like a recommendation and is not one.
