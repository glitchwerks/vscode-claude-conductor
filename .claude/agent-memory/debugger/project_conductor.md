---
name: vscode-claude-conductor project notes
description: Key facts about the claude-conductor VS Code extension codebase for the debugger agent
type: project
---

# vscode-claude-conductor project notes for the debugger agent

TypeScript VS Code extension. Test runner is vitest (not jest). Tests live in `test/**/*.test.ts`. The vscode module is mocked at `test/mocks/vscode.ts`.

**fs mocking**: use `vi.mock("fs")` at module level (ESM). `vi.spyOn(fs, "existsSync")` fails with "Cannot redefine property" in ESM — always use `vi.mock("fs")` then `vi.mocked(fs.existsSync).mockImplementation(...)`.

**Why**: ESM module namespaces are not configurable; spy-on fails on direct named exports from Node built-ins.
**How to apply**: Any test that needs to control `fs.existsSync`, `fs.statSync`, `fs.readdirSync`, etc. needs a `vi.mock("fs")` call present somewhere in the file. Vitest 4.1.5 hoists `vi.mock()` calls to the top of the module, ahead of all static imports, as part of its transform — regardless of where the call appears in source order. So `import * as fs from "fs"` may legally appear *before* the `vi.mock("fs")` call as written in the file; hoisting still applies the mock before that import is resolved at runtime. Don't rely on writing the `vi.mock()` call first in the file — rely on it being present anywhere in the file.
