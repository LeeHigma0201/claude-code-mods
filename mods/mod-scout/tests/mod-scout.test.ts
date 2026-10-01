import { expect, mock, test } from 'claude-code/testing'
import { analyze, paneLines, reportMarkdown } from '../hooks/analyze'
import { scan } from './fixture'

const run = (args: string) => ({ command: 'mod-scout', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } })
const PANE = {
  plugin: 'mod-scout',
  component: 'Pane',
  requestId: 'mod-scout',
  viewport: { columns: 100, rows: 30 },
  props: { title: 'mod-scout', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('analyze ranks the ledger and meter first and gates the deploy macro', () => {
  const c = analyze(scan)
  const ids = c.map(x => x.id)
  expect(ids.slice(0, 2)).toEqual(['check-ledger', 'usage-meter'])
  expect(ids).toContain('deploy-preflight')
  expect(ids).toContain('resume-nudge')
  expect(ids).toContain('denial-preflight')
  expect(ids).toContain('opening-ritual')
  expect(ids).toContain('tool-errors:WebFetch')
  expect(ids).not.toContain('macro:one-off-thing')
  // Sent as the only prompt of 21 sessions: a script types it, so it is not a macro and not the opening ritual.
  expect(ids.some(id => id.startsWith('macro:do-not-use'))).toBe(false)
  const scripted = c.find(x => x.id === 'scripted-prompts')!
  expect(scripted.container).toBe('not a mod')
  expect(scripted.evidence).toContain('21/21 single-prompt sessions')
  expect(c.find(x => x.id === 'opening-ritual')!.evidence).toContain('read resume here')
  const deploy = c.find(x => x.id.startsWith('macro:push-this'))!
  expect(deploy.gate).toContain('production deploy')
  expect(deploy.reliability).toBe(1)
  const correction = c.find(x => x.id === 'correction-loop')!
  expect(correction.container).toBe('skill')
  for (const x of c) expect(x.score).toBe(x.value * x.reliability)
})

test('the report carries the table, designs, gates and signals', () => {
  const md = reportMarkdown(scan, analyze(scan), { json: '/x/scan.json' })
  expect(md).toContain('# mod-scout report, 2026-10-01')
  expect(md).toContain('| 1 | Check ledger')
  expect(md).toContain('production deploy: annotate or ask only')
  expect(md).toContain('## Not mods')
  expect(md).toContain('Verify follow-ups: 57')
  expect(md).toContain('/mod-scout design 3')
  expect(paneLines(analyze(scan), 60, scan.generatedAt)[1]!.length <= 60).toBe(true)
})

test('/mod-scout scans, writes the report, saves the result and opens the pane', async ($, on) => {
  const written: Record<string, string> = {}
  const saved = new Map<string, unknown>()
  const argvs: string[][] = []
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/j' : undefined }))
  on('clock.now', () => ({ value: Date.parse('2026-10-01T19:05:00Z') }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', (_$, e) => {
    argvs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '{"sessions":120}\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', () => ({ value: JSON.stringify(scan) }))
  on('fs.write', (_$, e) => {
    written[e.path] = e.text
    return { value: undefined }
  })
  on('store.set', (_$, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const answer = await $.command.run(run(''))

  expect(answer.text).toContain('120 sessions, 800 prompts, 14 days')
  expect(answer.text).toContain('1. [9] Check ledger')
  expect(argvs[0]![0]).toBe('node')
  expect(argvs[0]!.join(' ')).toContain('--root /home/j/.claude/projects --days 14 --out /home/j/.claude/mod-scout/scan-2026-10-01.json')
  expect(written['/home/j/.claude/mod-scout/report-2026-10-01.md']).toContain('## Mod candidates')
  expect(saved.has('mod-scout:last')).toBe(true)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Check ledger/ })).toBeDefined()
    await ui.unmount()
  }
})

test('options change the scanner arguments', { options: { days: 30, exclude: 'private-project', examples: false } }, async ($, on) => {
  const argvs: string[][] = []
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/j' : undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', (_$, e) => {
    argvs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', () => ({ value: JSON.stringify(scan) }))
  on('fs.write', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'narrow' } }))

  await $.command.run(run(''))
  const line = argvs[0]!.join(' ')
  expect(line).toContain('--days 30')
  expect(line).toContain('--examples 0')
  expect(line).toContain('--exclude private-project')
})

test('a scanner failure is reported, nothing written', async ($, on) => {
  let writes = 0
  on('env.get', () => ({ value: '/home/j' }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.write', () => (writes++, { value: undefined }))

  const answer = await $.command.run(run(''))
  expect(answer.text).toContain('scanner failed (exit 1)')
  expect(answer.text).toContain('boom')
  expect(writes).toBe(0)
})

test('design sends one prompt naming the report and the skill; help and show never submit', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/j' : undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => ({ value: JSON.stringify(scan) }))
  on('fs.write', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.submit', (_$, e) => (sent.push(e.text), { text: e.text }))

  const before = await $.command.run(run('design 2'))
  expect(before.text).toContain('no scan yet')

  await $.command.run(run(''))
  const help = await $.command.run(run('help'))
  expect(help.text).toContain('/mod-scout design 3')
  const show = await $.command.run(run('show'))
  expect(show.text).toContain('pane opened')
  await clock.advance(1)
  expect(sent.length).toBe(0)

  const design = await $.command.run(run('design 2'))
  expect(design.text).toContain('design the top 2')
  await clock.advance(1)
  expect(sent.length).toBe(1)
  expect(sent[0]).toContain('/home/j/.claude/mod-scout/report-1970-01-01.md')
  expect(sent[0]).toContain('/mod-scout:design-mods')
  expect(sent[0]).toContain('ask me which to build')
})
