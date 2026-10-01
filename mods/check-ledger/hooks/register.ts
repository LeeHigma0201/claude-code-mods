import type { Register } from 'claude-code'

// A command counts as a real check when it runs the repo's tests, type-checker, build,
// linter or validator. Syntax-only checks (bash -n, node --check, json.tool) do not count.
const CHECK =
  /\b(?:(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|typecheck|type-check|build|lint|check|validate|verify|e2e)(?::\S+)?\b|vitest|jest|playwright\s+test|pytest|python3?\s+-m\s+pytest|tsc\b(?!.*--version)|cargo\s+(?:test|build|clippy)|go\s+(?:test|build|vet)|swift\s+(?:test|build)|xcodebuild\b.*\b(?:test|build)\b|node\s+--test|eslint|ruff\s+check|mypy|claude\s+plugin\s+(?:test|validate))/i
const NOT_A_CHECK = /\b(?:bash|sh|zsh)\s+-n\b|node\s+--check|json\.tool|--dry-run|--help|--version/i
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export type Check = { command: string; outcome: 'pass' | 'fail' | 'denied'; at: number; seq: number }
export type Change = { file: string; at: number; seq: number }

export type Ledger = { checks: Check[]; changes: Change[]; seq: number }

export function newLedger(): Ledger {
  return { checks: [], changes: [], seq: 0 }
}

export function isCheck(command: string): boolean {
  return CHECK.test(command) && !NOT_A_CHECK.test(command)
}

export function shortCommand(command: string): string {
  const one = command.replace(/\s+/g, ' ').trim()
  return one.length > 60 ? `${one.slice(0, 57)}...` : one
}

export function recordCheck(l: Ledger, command: string, outcome: Check['outcome'], at: number): void {
  l.checks.push({ command: shortCommand(command), outcome, at, seq: ++l.seq })
  if (l.checks.length > 200) l.checks.shift()
}

export function recordChange(l: Ledger, file: string, at: number): void {
  l.changes = l.changes.filter(c => c.file !== file)
  l.changes.push({ file, at, seq: ++l.seq })
}

function lastPass(l: Ledger): Check | undefined {
  return [...l.checks].reverse().find(c => c.outcome === 'pass')
}

// Files changed after the last passing check (all changes when nothing has passed).
export function unchecked(l: Ledger): Change[] {
  const pass = lastPass(l)
  return l.changes.filter(c => !pass || c.seq > pass.seq)
}

// The strongest word in the CLAUDE.md status vocabulary the ledger alone supports.
export function supportedStatus(l: Ledger): string {
  if (l.changes.length === 0) return l.checks.length ? 'no edits this session; checks ran' : 'no edits or checks this session'
  const last = l.checks.at(-1)
  if (last && last.outcome === 'fail') return 'implemented locally (latest check failed)'
  return unchecked(l).length === 0 ? 'tested (every edit has a passing check after it)' : 'implemented locally (edits after the last passing check)'
}

export function statusText(l: Ledger): string | undefined {
  if (!l.checks.length && !l.changes.length) return undefined
  const last = l.checks.at(-1)
  const open = unchecked(l).length
  const head = last ? `${last.outcome === 'pass' ? '✓' : '✗'} ${last.command.slice(0, 28)}` : 'no checks yet'
  return open ? `${head} · ${open} file${open === 1 ? '' : 's'} unchecked` : head
}

function ago(ms: number): string {
  const m = Math.round(ms / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`
}

export function reportText(l: Ledger, now: number): string {
  const lines = [`Check ledger: supports "${supportedStatus(l)}"`]
  lines.push('', 'Checks (latest last):')
  if (!l.checks.length) lines.push('- none recorded')
  for (const c of l.checks.slice(-10)) lines.push(`- ${c.outcome.toUpperCase()} \`${c.command}\` (${ago(now - c.at)})`)
  const open = unchecked(l)
  lines.push('', `Files changed after the last passing check: ${open.length}`)
  for (const c of open.slice(-15)) lines.push(`- ${c.file}`)
  if (open.length > 15) lines.push(`- ...and ${open.length - 15} more`)
  lines.push('', 'Recorded since this mod loaded; a check that ran in another session or a subagent shell outside this session is not here.')
  return lines.join('\n')
}

// Module state: a reload starts a fresh ledger, which the report says.
const ledger = newLedger()

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'evidence', description: 'Which checks ran and which edits came after them' })
    // The tool needs a local listener; where that is refused (a sandboxed launch) the
    // ledger, status line and /evidence still work.
    await $.tool
      .register({
        name: 'evidence',
        description:
          'Read-only. Returns the checks (tests, type-check, build, lint) run in this session with pass/fail, the files edited after the last passing check, and the strongest status word that evidence supports. Call it before reporting a change as tested.',
        inputSchema: { type: 'object', properties: {} },
      })
      .catch(err => $.ui.log(`check-ledger: evidence tool not registered (${String(err)}); /evidence still works`))
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isCheck(e.command)) return next(e)
    const ran = await next(e)
    const outcome = ran.deny !== undefined ? 'denied' : ran.isError ? 'fail' : 'pass'
    recordCheck(ledger, e.command, outcome, await $.clock.now())
    $.ui.status(statusText(ledger))
    return ran
  })

  on('tool.call', async ($, e, next) => {
    if (!EDIT_TOOLS.has(String(e.tool))) return next(e)
    const ran = await next(e)
    const input = e as unknown as { file_path?: string; notebook_path?: string }
    const file = input.file_path ?? input.notebook_path
    if (file && ran.deny === undefined && !ran.isError) {
      recordChange(ledger, file, await $.clock.now())
      $.ui.status(statusText(ledger))
    }
    return ran
  })

  on('tool.call', { tool: 'mcp__check-ledger__evidence' }, async $ => ({ result: reportText(ledger, await $.clock.now()) }))

  on('command.run', { command: 'evidence' }, async $ => ({ text: reportText(ledger, await $.clock.now()) }))
}
