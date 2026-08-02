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
| [`2026-07-29-shared-workspace-config-injection.md`](plans/2026-07-29-shared-workspace-config-injection.md) | scoping-decision | UNDER REVIEW — 7 decision points and a 3-probe empirical gate unanswered; **no code should be written from it yet** | #81 |

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

Research is an **input** to a spec, never a decision on its own. A ranked
shortlist reads like a recommendation and is not one.
