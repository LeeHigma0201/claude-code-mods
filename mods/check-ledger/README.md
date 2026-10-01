# check-ledger

Keeps the evidence behind the CLAUDE.md status words: which real checks ran, whether they passed, and which
files changed after the last pass.

- **Real check** means the repo's tests, type-checker, build, linter or validator: `pnpm test|typecheck|build|lint`,
  `vitest`, `jest`, `pytest`, `tsc`, `cargo`/`go`/`swift` test/build, `eslint`, `claude plugin test|validate`,
  and similar. Syntax-only checks (`bash -n`, `node --check`, `json.tool`), `--help` and `--version` don't count.
  The outcome comes from the Bash call's own error flag.
- **Status line:** `✓ pnpm run typecheck · 2 files unchecked`, or `✗ pnpm test`.
- **`/evidence`**: the last 10 checks, the files edited after the last passing check, and the strongest word
  the ledger supports: `tested` (every edit has a passing check after it) or `implemented locally`.
- **`evidence` tool** (`mcp__check-ledger__evidence`): the same report for Claude to read before it says
  "tested". The tool needs a local listener. Where that is refused (a sandboxed launch) it logs one line,
  and `/evidence` and the status line still work.

Limits: the ledger lives in the module and restarts on a reload or a new session. It only sees calls made
in this session, including its subagents. It observes; it never blocks or changes a call.

Hooks: `session.start`, `tool.call` (Bash and edit tools, passed through unchanged), `command.run`. Calls:
`$.command.register`, `$.tool.register`, `$.ui.status`, `$.ui.log`, `$.clock.now`.

Test: `claude plugin test .` (3 tests).
