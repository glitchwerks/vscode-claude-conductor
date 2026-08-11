---
name: codex-companion-invocation
description: How to invoke codex-companion.mjs and npm/tsc against a worktree without violating the no-chained-cd rule
metadata:
  type: project
---

The Bash tool in this environment blocks chaining `cd <dir> && <cmd>` (and
similar with `;`/`||`), and this project's worktrees live at
`.worktrees/<branch>/`. Two flags avoid ever needing a directory change:

- `codex-companion.mjs` (all subcommands: `task`, `status`, `result`, `review`,
  etc.) accepts `--cwd <path>` / `-C <path>` to target a specific worktree.
  Always pass it explicitly — omitting it defaults to the shell's current cwd,
  which is not necessarily the target worktree and can silently report on the
  wrong repo's job queue (`status --all` returned the main checkout's empty
  queue once before `--cwd` was added).
- `codex-companion.mjs task` also accepts `--prompt-file <path>` (resolved
  relative to `--cwd`). Use this instead of embedding the prompt text as a
  shell argument — it sidesteps the injection-safety heredoc dance entirely
  when the prompt is available as a file (which it always is here, since the
  brief calls for writing it to `.tmp/codex-prompt.*` first anyway).
- For `npm` commands (`lint`, `test`, `compile`) against a worktree, use
  `npm --prefix <worktree-path> run <script>` or
  `npm --prefix <worktree-path> exec -- <bin> <args>` (for `tsc` calls not
  wrapped in a package.json script, e.g. `npx tsc --noEmit -p
  tsconfig.test.json`). Both avoid any `cd`.

See [[codex-companion-background-polling]] for the foreground-command-moves-
to-background behavior observed with `task --write` on a ~3 minute run.
