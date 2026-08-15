---
name: codex-companion-background-polling
description: A foreground `task --write` call in this environment auto-moved to background after 120s; poll `result <job-id> --json --cwd <worktree>` for the specific job id until it reaches a terminal state, not `status --all` or a bare `result --json`
metadata:
  type: project
---

# Recovering a codex-companion job that moved to background

Ran `codex-companion.mjs task --write --cwd <worktree> --prompt-file
<file>` in the foreground for a small, single-function bug fix (expected
under 2 minutes per the foreground/background threshold). The Bash tool
itself timed out the call at 120s and silently moved it to a background job
(job id printed to stdout), rather than the call failing. This can happen
even for scoped, bounded-looking tasks — Codex's own reasoning/tool-call loop
took ~3 minutes end to end here.

Recovery: poll the *specific job id* printed to stdout by the original
`task --write` call — `codex-companion.mjs result <job-id> --json --cwd
<worktree>` (same `--cwd` as the original call) — in a wait-loop until that
call's own status field reaches a terminal state (`completed`/`failed`, not
`running`/`notfound`). Do not poll `status --all --json`: it lists every job
in the queue, including unrelated ones, so waiting on its `"running": []`
array going empty can hang indefinitely on a different, still-running job.
Do not call `result --json` with no id either: with no id it returns the
*latest finished* job, which may not be the one this call started. Once the
targeted `result <job-id> --json` call reports a terminal state, its
`storedJob.result.rawOutput` / `touchedFiles` fields are what to trust —
cross-check `touchedFiles` against `git status --porcelain -uall` on disk per
the harness's "trust the disk, not Codex's narrative" rule, don't take the
summary at face value.

**Where a completed job actually lands in the status JSON, if you do fall
back to `status --all`.** Don't write a poll loop that only checks `running`
+ `recent` arrays for the job id — a job that just finished shows up under
the separate `latestFinished` object key (singular, not an array), and in
one observed run `recent` stayed `[]` the whole time even after completion.
A loop matching only `running`/`recent` reports `notfound` forever even
though `status --all --json` clearly shows `"status": "completed"` under
`latestFinished`. This is a second reason to prefer polling `result
<job-id> --json` directly by id over trying to locate the job inside
`status --all`'s arrays.

See [[codex-companion-invocation]] for the `--cwd`/`--prompt-file` flags used
in this same call.
