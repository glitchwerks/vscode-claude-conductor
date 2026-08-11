# test-implementer memory index

- [Worktree node_modules symlink trap](worktree-node-modules-symlink.md) — `ln -s` silently full-copies node_modules on this host; run vitest/tsc against the worktree via `--root`/`-p` instead, or `npm install` in the worktree.
