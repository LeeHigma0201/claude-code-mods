import { expect, test } from 'claude-code/testing'
import { isCheck } from '../hooks/register'

// A command typed at the prompt of an interactive terminal session.
const run = (command: string, args: string) => ({ command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } })

test('only real checks count', () => {
  for (const c of ['pnpm run typecheck', 'pnpm test', 'npm run build', 'npx vitest run', 'python3 -m pytest -q', 'claude plugin test ./x', 'cd app && pnpm lint'])
    expect(isCheck(c)).toBe(true)
  for (const c of ['bash -n script.sh', 'node --check a.mjs', 'git status', 'ls', 'pnpm install', 'tsc --version', 'python3 -m json.tool a.json'])
    expect(isCheck(c)).toBe(false)
})

test('an edit after the last passing check is reported as unchecked', async ($, on) => {
  let exitFails = false
  on('tool.call', () => (exitFails ? { result: 'boom', isError: true } : { result: 'ok' }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('ui.status', () => ({ value: undefined }))

  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'pnpm run typecheck' })
  let report = await $.command.run(run('evidence', ''))
  expect(report.text).toContain('supports "tested')
  expect(report.text).toContain('PASS `pnpm run typecheck` (just now)')

  await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts', content: 'x' })
  report = await $.command.run(run('evidence', ''))
  expect(report.text).toContain('supports "implemented locally (edits after the last passing check)"')
  expect(report.text).toContain('- /repo/b.ts')
  expect(report.text).not.toContain('- /repo/a.ts')

  exitFails = true
  await $.tool.call({ tool: 'Bash', command: 'pnpm test' })
  report = await $.command.run(run('evidence', ''))
  expect(report.text).toContain('latest check failed')
  expect(report.text).toContain('FAIL `pnpm test`')
})

test('Claude can read the ledger through the evidence tool', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.status', () => ({ value: undefined }))
  const answer = await $.tool.call({ tool: 'mcp__check-ledger__evidence' })
  expect(JSON.stringify(answer)).toContain('no edits or checks this session')
})
