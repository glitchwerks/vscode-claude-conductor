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
number, specifically to stop the fragility from recurring. #94 later distilled
that section to just the four cited quotes and removed the heading; the
citations now point at the original v1 design spec and git history rather than
a heading anchor, but the same discipline — don't let a restructure silently
break a citation — is what both changes preserved. Prefer a heading anchor
(or, once that heading is gone, an explicit git-history pointer) over a line
number wherever a citation might otherwise outlive a future edit.

## Document shapes

Frontmatter contract, header lines, section templates, and the status vocabulary:
[`docs/sdd-workflow.md`](docs/sdd-workflow.md). Read it before writing your first
spec; you will not need it again after that.

## Build and test

```bash
npm install                                    # install dependencies
npm test                                       # run tests once
npm run test:watch                             # watch mode
npm run lint                                   # tsc --noEmit against the main tsconfig
npx tsc --noEmit -p tsconfig.test.json         # typecheck against the test tsconfig (separate CI job)
npm run compile                                # tsc -p ./
```

Unit tests only — the `vscode` module is mocked, so no VS Code instance is
needed. CI runs lint, typecheck, test, and compile as four separate jobs on every
PR and push to `main`. Lint and typecheck run against different tsconfigs
(main vs. test) and can disagree — run both locally before pushing.

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
