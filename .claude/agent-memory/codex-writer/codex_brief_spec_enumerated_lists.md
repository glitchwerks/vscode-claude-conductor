---
name: codex-brief-spec-enumerated-lists
description: When a spec enumerates a fixed list of required edits (e.g. "N stale comments to correct"), copy the full enumeration into the Codex brief verbatim rather than summarizing a subset from memory/skim — Codex will correctly halt on a self-detected gap and burn a full round-trip
metadata:
  type: project
---

# Copy spec enumerations into the Codex brief in full

On issue #127 (session-tab default grouping), the spec's § 2.7 "Source
comments that go stale on the same commit" enumerated **three** doc comments
that needed correcting in the same commit as the behavioral change. The first
brief to `codex-companion.mjs task` only carried two of the three (missed the
`_handleTerminalClose` comment at the time) — a summarization slip while
composing the prompt from a partial re-read of the spec, not a deliberate
scope cut.

Codex did the right thing: it read the actual spec section itself (its own
tool calls fetched `docs/specs/...` directly), found the third item, noticed
the brief's list disagreed with the spec's list, and **stopped with zero file
edits** to ask which was authoritative rather than guessing. That is the
correct behavior for a genuine ambiguity, but this wasn't one — the spec is
the source of truth and was unambiguous; the brief was just incomplete. The
result was a full wasted job round-trip (~1m45s) before a corrected re-brief
produced the real implementation.

**How to apply:** when a spec section says "there are N things to change" (a
numbered or bulleted list gating an edit), pull the FULL list into the Codex
prompt by direct quote/paraphrase of each item, not a remembered subset —
re-read that exact section immediately before composing the brief rather than
relying on an earlier skim. This is cheap insurance: the cost of over-quoting
a spec's enumerated list is a few extra lines in the prompt; the cost of
under-quoting it is a full extra Codex round-trip when Codex (correctly)
refuses to guess on a countable, spec-stated requirement.

This is a natural complement to [[codex-companion-background-polling]] and
[[codex-companion-invocation]] — those cover the mechanics of the dispatch
call; this covers a content-composition failure mode on the brief itself.
