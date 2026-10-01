import type { Register } from 'claude-code'

import { analyze, paneLines, reportMarkdown } from './analyze'
import type { Candidate, Scan } from './analyze'

const PANE = 'mod-scout'
const STORE_KEY = 'mod-scout:last'
const HELP = [
  'mod-scout: finds the mods you would use most, from how you actually use Claude Code.',
  '',
  '/mod-scout            scan the last N days of transcripts, write a report, open the pane',
  '/mod-scout show       open the pane from the last scan (no rescan)',
  '/mod-scout design 3   hand the report to Claude: design the top 3 with the design-mods skill, ask before building',
  '/mod-scout help       this text',
  '',
  'Options (/plugin configure mod-scout): days (default 14), exclude (project substrings to skip),',
  'examples (keep short prompt snippets in the report; off for a report you will share).',
  'Report: ~/.claude/mod-scout/report-<date>.md. Nothing leaves the machine.',
].join('\n')

type Last = { at: string; report: string; json: string; sessions: number; candidates: Candidate[] }

// Module state mirrors $.store so the pane survives a reload.
let last: Last | undefined

function designPrompt(l: Last, n: number): string {
  return [
    `Use the mod-scout plugin's design-mods skill (/mod-scout:design-mods) on ${l.report}.`,
    `Design the top ${n} mod candidates: for each, write the spec the skill asks for (purpose, evidence, hooks and API calls, gates, failure modes, tests, uninstall), say which should NOT be mods and why, then stop and ask me which to build.`,
  ].join(' ')
}

export const register: Register = (on, options) => {
  const days = Number(options.days ?? 14) || 14
  const exclude = String(options.exclude ?? '')
  const examples = options.examples === undefined ? true : options.examples === true || options.examples === 'true'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mod-scout',
      description: 'Scan your recent sessions and rank the mods you would use most',
      argumentHint: '[show | design <n> | help]',
    })
    const saved = (await $.store.get(STORE_KEY)) as Last | undefined
    if (saved && Array.isArray(saved.candidates)) last = saved
    return next(e)
  })

  on('command.run', { command: 'mod-scout' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)

    if (verb === 'help') return { text: HELP }

    if (verb === 'show') {
      if (!last) return { text: 'mod-scout: no scan yet. Run /mod-scout first.' }
      const opened = await $.ui.open({ id: PANE, title: 'mod-scout' })
      return { text: opened.isPlaced ? `mod-scout: pane opened (${last.candidates.length} candidates from ${last.at.slice(0, 10)}).` : `mod-scout: ${paneLines(last.candidates, 100, last.at).join('\n')}` }
    }

    if (verb === 'design') {
      if (!last) return { text: 'mod-scout: no scan yet. Run /mod-scout first.' }
      const n = Math.min(10, Math.max(1, Number(arg) || 3))
      const l = last
      // A submit from inside command.run would wait on the turn this hook holds; send it after.
      $.clock.after(0, () => {
        $.prompt.submit({ text: designPrompt(l, n), asUser: true }).catch(err => $.ui.toast(`mod-scout: could not send the design prompt: ${String(err)}`))
      })
      return { text: `mod-scout: asking Claude to design the top ${n} from ${l.report}.` }
    }

    // Scan.
    const home = (await $.env.get('HOME')) ?? '~'
    const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
    // MOD_SCOUT_DIR moves the report somewhere else (a sandbox, a CI run).
    const dir = (await $.env.get('MOD_SCOUT_DIR')) || `${home}/.claude/mod-scout`
    const json = `${dir}/scan-${day}.json`
    const report = `${dir}/report-${day}.md`
    $.ui.toast(`mod-scout: scanning the last ${days} days of transcripts…`, { timeoutMs: 8000 })
    const argv = ['node', `${$.plugin.root}/scripts/scan.mjs`, '--root', `${home}/.claude/projects`, '--days', String(days), '--out', json, '--examples', examples ? '1' : '0']
    if (exclude) argv.push('--exclude', exclude)
    let ran
    try {
      ran = await $.process.run(argv, { timeoutMs: 600_000 })
    } catch (err) {
      return { text: `mod-scout: could not run the scanner (${String(err)}). It needs Node 18+ on PATH.` }
    }
    if (ran.exitCode !== 0) return { text: `mod-scout: scanner failed (exit ${ran.exitCode}).\n${ran.stderr.slice(-800)}` }

    const scan = JSON.parse(await $.fs.read(json)) as Scan
    const candidates = analyze(scan)
    await $.fs.write(report, reportMarkdown(scan, candidates, { json }))
    last = { at: scan.generatedAt, report, json, sessions: scan.sessionsScanned, candidates }
    // The store is a convenience (pane after reload); a read-only store must not lose the report.
    await $.store.set(STORE_KEY, last).catch(err => $.ui.toast(`mod-scout: could not save the scan (${String(err)}); the report is on disk.`))

    const opened = await $.ui.open({ id: PANE, title: 'mod-scout' })
    const top = candidates.slice(0, 5).map((c, i) => `${i + 1}. [${c.score}] ${c.title}${c.gate ? ' ⚠ gate' : ''}  (${c.container}; ${c.evidence})`)
    return {
      text: [
        `mod-scout: ${scan.sessionsScanned} sessions, ${scan.prompts.total} prompts, ${days} days. ${candidates.length} candidates. Report: ${report}`,
        ...top,
        opened.isPlaced ? 'Full list in the pane. `/mod-scout design 3` to have Claude design the top three.' : '`/mod-scout design 3` to have Claude design the top three.',
      ].join('\n'),
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    if (!last) return <Text dimColor>No scan yet. Run /mod-scout.</Text>
    const lines = paneLines(last.candidates, width, last.at)
    return (
      <Box flexDirection="column">
        {lines.map((line, i) => (
          <Text key={String(i)} dimColor={i > 0 && line.startsWith('     ')}>{line || ' '}</Text>
        ))}
      </Box>
    )
  })
}
