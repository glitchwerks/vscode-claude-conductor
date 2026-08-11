---
name: vscode-claude-conductor project notes
description: Key facts about the claude-conductor VS Code extension codebase for the debugger agent
type: project
---

TypeScript VS Code extension. Test runner is vitest (not jest). Tests live in `test/**/*.test.ts`. The vscode module is mocked at `test/mocks/vscode.ts`.

**fs mocking**: use `vi.mock("fs")` at module level (ESM). `vi.spyOn(fs, "existsSync")` fails with "Cannot redefine property" in ESM — always use `vi.mock("fs")` then `vi.mocked(fs.existsSync).mockImplementation(...)`.

**Why**: ESM module namespaces are not configurable; spy-on fails on direct named exports from Node built-ins.
**How to apply**: Any test that needs to control `fs.existsSync`, `fs.statSync`, `fs.readdirSync`, etc. must start with `vi.mock("fs")` before all imports.
