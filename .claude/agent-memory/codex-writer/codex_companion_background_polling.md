---
name: codex-companion-background-polling
description: A foreground `task --write` call in this environment auto-moved to background after 120s; poll status --all --json with the same --cwd until running is empty, then call result --json
metadata:
  type: project
---

Ran `codex-companion.mjs task --write --cwd <worktree> --prompt-file
<file>` in the foreground for a small, single-function bug fix (expected
under 2 minutes per the foreground/background threshold). The Bash tool
itself timed out the call at 120s and silently moved it to a background job
(job id printed to stdout), rather than the call failing. This can happen
even for scoped, bounded-looking tasks — Codex's own reasoning/tool-call loop
took ~3 minutes end to end here.

Recovery: poll `codex-companion.mjs status --all --json --cwd <worktree>`
(same `--cwd` as the original call — needed to find the right job queue) with
a wait-loop until the `"running": []` array is empty, then fetch the finished
output with `codex-companion.mjs result --json --cwd <worktree>`. The `result`
JSON's `storedJob.result.rawOutput` / `touchedFiles` fields are what to trust
— cross-check `touchedFiles` against `git status --porcelain -uall` on disk
per the harness's "trust the disk, not Codex's narrative" rule, don't take
the summary at face value.

**Where a completed job actually lands in the status JSON.** Don't write a
poll loop that only checks `running` + `recent` arrays for the job id — a
job that just finished shows up under the separate `latestFinished` object
key (singular, not an array), and in one observed run `recent` stayed `[]`
the whole time even after completion. A loop matching only `running`/`recent`
reports `notfound` forever even though `status --all --json` clearly shows
`"status": "completed"` under `latestFinished`. Check `latestFinished.id ==
<job-id>` as a third match target, or just fetch `result <job-id> --json`
directly once `running` is empty instead of trying to locate the job by id
in a specific array first.

See [[codex-companion-invocation]] for the `--cwd`/`--prompt-file` flags used
in this same call.
