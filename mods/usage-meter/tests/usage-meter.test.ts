import { expect, test } from 'claude-code/testing'
import { statusText } from '../hooks/register'

// A command typed at the prompt of an interactive terminal session.
const run = (command: string, args: string) => ({ command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } })

const usage = {
  context: { window: 200_000, tokens: 84_000, percent: 42 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 81, resetsAt: '2026-10-01T20:00:00Z' },
    { kind: 'seven_day', percentUsed: 23 },
  ],
  cost: { usd: 3.1 },
}

test('status text names context, each plan window and cost', () => {
  expect(statusText(usage)).toBe('ctx 42% · 5h 81% · 7d 23% · $3.10')
  expect(statusText({ context: { window: 200_000 }, rateLimits: [] })).toBe('')
})

test('session.measure sets the status line and toasts a crossed threshold once', async ($, on) => {
  const status: unknown[] = []
  const toasts: unknown[] = []
  on('ui.status', (_$, e) => (status.push(e), { value: undefined }))
  on('ui.toast', (_$, e) => (toasts.push(e), { value: undefined }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  await $.session.measure({ ...usage, changed: ['context', 'rateLimits', 'cost'] })
  await $.session.measure({ ...usage, changed: ['context'] })

  expect(JSON.stringify(status)).toContain('ctx 42% · 5h 81% · 7d 23% · $3.10')
  expect(toasts.length).toBe(1)
  expect(JSON.stringify(toasts)).toContain('5h plan limit at 81%')
})

test('/usage-meter reports every reading with reset times', async ($, on) => {
  on('session.usage', () => ({ value: { ...usage, startedAt: 0 } }))
  on('clock.now', () => ({ value: Date.parse('2026-10-01T18:30:00Z') }))

  const answer = await $.command.run(run('usage-meter', ''))

  expect(answer.text).toContain('context: 42% of 200,000 tokens (84,000 used)')
  expect(answer.text).toContain('5h limit: 81% used (resets in 1h 30m)')
  expect(answer.text).toContain('7d limit: 23% used')
  expect(answer.text).toContain('$3.10')
})
