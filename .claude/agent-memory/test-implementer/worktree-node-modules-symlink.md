---
name: worktree-node-modules-symlink
description: ln -s of node_modules into a git worktree silently full-copies instead of linking on this host — don't rely on it, and remember worktrees need their own npm install
metadata:
  type: project
---

# Worktree node_modules must not be symlinked on this host

On this Windows host (Git Bash), `ln -s <main-checkout>/node_modules
<worktree>/node_modules` does **not** create a symlink or NTFS junction — it
silently performs a full recursive **copy** (confirmed via differing inodes
between the two paths, and `fsutil reparsepoint query` reporting "not a
reparse point" on the result). `ls -la` and `git status` don't reveal this;
only comparing inode numbers (`stat -c "%i" <file-in-each-tree>`) or
`fsutil reparsepoint query` does.

**Why this matters:** it's slow (~120MB copy for this repo, taking real time)
and it's a trap for cleanup — a plain `rm -f` fails (it's a directory), `rmdir`
fails with ENOTEMPTY (real content, not a reparse point), and `cmd.exe` /c
in this environment doesn't run commands at all (it just prints the version
banner and drops to an interactive-looking prompt — invoking `cmd.exe` from
this harness is not usable for one-off Windows commands). The only clean
removal path that worked was `rm -rf` after confirming via inode comparison
that the copy is fully independent of the original (safe to delete without
risking the main checkout's node_modules).

**How to apply:** in `.worktrees/<branch>/` worktrees in this repo (or any
Windows-host repo using the same convention, see
[[../../../CLAUDE.md]] § Worktrees), don't try to shortcut dependency
install by symlinking node_modules from the main checkout. Either run
`npm install` in the worktree directly, or — if you only need to *run* tests
once without installing (e.g. as test-implementer confirming red/green) —
invoke the main checkout's binaries directly against the worktree via
`--root`/`-p` flags instead of `cd`-ing into the worktree, e.g.:

```bash
node "<main-checkout>/node_modules/vitest/vitest.mjs" run \
  --config "<worktree>/vitest.config.ts" --root "<worktree>"
node "<main-checkout>/node_modules/typescript/bin/tsc" --noEmit \
  -p "<worktree>/tsconfig.test.json"
```

This avoids the copy entirely and leaves the worktree's own `node_modules`
absent — which the next agent (code-implementer) must account for by running
`npm install` in the worktree before it can run `npm test` directly there.
