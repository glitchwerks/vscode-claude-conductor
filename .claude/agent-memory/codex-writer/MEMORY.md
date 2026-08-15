# Codex-writer agent memory index

- [Codex companion invocation](codex_companion_invocation.md) — use `--cwd`/`--prompt-file` on codex-companion.mjs, `npm --prefix` (plus a worktree-qualified `-p` path for `tsc`) for npm/tsc, to avoid chained-cd
- [Codex companion background polling](codex_companion_background_polling.md) — foreground `task --write` can auto-move to background at 120s even for small fixes; poll the specific job id via `result <job-id> --json --cwd <dir>` until terminal, not `status --all` or a bare `result --json`
