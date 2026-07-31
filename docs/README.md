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

The two pre-#84 documents predate the header-line convention in
[`sdd-workflow.md`](sdd-workflow.md): the shared-workspace plan's own
`**Status:**` line still reads `DECISION DOCUMENT`, and neither it nor the
foundational spec carries a `**Type:**` line yet. The Type and Status values
above are assigned by this index in the current vocabulary; retrofitting the
header lines is tracked as open question 6 in the SDD formalization plan
(`docs/plans/2026-07-30-formalize-spec-driven-development.md` § 8).

## Research — external prior art

Directory: `research/`

| Document | What it surveyed |
|---|---|
| [`2026-07-29-shared-workspace-config-injection.md`](research/2026-07-29-shared-workspace-config-injection.md) | Mechanisms for pushing a shared config into every Claude Code CLI session. Feeds the #81 scoping decision. |
| [`2026-07-29-vscode-claude-conductor-landscape-survey.md`](research/2026-07-29-vscode-claude-conductor-landscape-survey.md) | VS Code and Claude Code CLI capabilities plus competing extensions. |

Research is an **input** to a spec, never a decision on its own. A ranked
shortlist reads like a recommendation and is not one.
