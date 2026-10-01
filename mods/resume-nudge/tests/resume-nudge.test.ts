import { expect, mock, test } from 'claude-code/testing'
import { cutOff, RESUME_TEXT } from '../hooks/register'

// A command typed at the prompt of an interactive terminal session.
const run = (command: string, args: string) => ({ command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } })

const answered = { role: 'assistant' as const, text: 'All set.', toolUses: [] }
const inFlight = { role: 'assistant' as const, text: '', toolUses: [{ tool_use_id: 't1', tool: 'Bash', input: { command: 'pnpm build' } }] }
const resultBack = { role: 'user' as const, text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'ok', result: 'ok' }] }
const escaped = { role: 'user' as const, text: '[Request interrupted by user]', toolUses: [] }
const prompt = { role: 'user' as const, text: 'fix the header', toolUses: [] }

test('classifies where a conversation stopped', () => {
  expect(cutOff([]).isCut).toBe(false)
  expect(cutOff([prompt, answered]).isCut).toBe(false)
  expect(cutOff([prompt, escaped]).isCut).toBe(false)
  expect(cutOff([prompt, inFlight]).isCut).toBe(true)
  expect(cutOff([prompt, inFlight, resultBack]).isCut).toBe(true)
  expect(cutOff([answered, prompt]).isCut).toBe(true)
})

test('a cut-off session gets the pick-up prompt drafted, never sent', async ($, on) => {
  const filled: unknown[] = []
  let submitted = 0
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.messages', () => ({ value: [prompt, inFlight] }))
  on('prompt.fill', (_$, e) => (filled.push(e), { isFilled: true }))
  on('prompt.submit', () => (submitted++, { text: '' }))
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  expect(JSON.stringify(filled)).toContain('The Mac restarted')
  expect(submitted).toBe(0)
})

test('a finished session is left alone, and /resume-here says so', async ($, on) => {
  let filled = 0
  let submitted = 0
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.messages', () => ({ value: [prompt, answered] }))
  on('prompt.fill', () => (filled++, { isFilled: true }))
  on('prompt.submit', () => (submitted++, { text: '' }))
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const answer = await $.command.run(run('resume-here', ''))

  expect(filled).toBe(0)
  expect(submitted).toBe(0)
  expect(answer.text).toContain('nothing to resume')
})

test('/resume-here sends the prompt only when cut off; check never sends', async ($, on) => {
  const sent: unknown[] = []
  const clock = mock.clock(on)
  on('session.messages', () => ({ value: [prompt, inFlight, resultBack] }))
  on('prompt.submit', (_$, e) => (sent.push(e), { text: '' }))

  const check = await $.command.run(run('resume-here', 'check'))
  expect(check.text).toContain('cut off')
  expect(sent.length).toBe(0)

  await $.command.run(run('resume-here', ''))
  await clock.advance(1)
  expect(sent.length).toBe(1)
  expect(JSON.stringify(sent)).toContain(RESUME_TEXT.slice(0, 30))
})
