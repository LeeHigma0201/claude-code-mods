// Turns a scan (facts about how Claude Code was used) into ranked mod candidates.
// Pure functions: no `$`, so tests run them on fixtures and the pane reads their output.

// solo: how many of those sessions had this as their only prompt (a script sent it, nobody typed it).
export type Cluster = { key: string; count: number; sessions: number; solo?: number; example: string; gate: boolean }
export type Scan = {
  generatedAt: string
  days: number
  sessionsScanned: number
  prompts: { total: number; clusters: Cluster[]; openings: Cluster[] }
  followups: { verify: number; correction: number; verifyExamples: string[]; correctionExamples: string[] }
  tools: { byName: Record<string, { calls: number; errors: number }>; bashFamilies: Record<string, number> }
  denials: { permission: number; hookBlock: number; byTool: Record<string, number> }
  sessions: {
    interrupted: number; cutOff: number; compactions: number; continuedFromSummary: number; remoteControl: number
    usageLimitHits: number; modelSwitches: number; long: number; withSubagents: number; slashCommands: Record<string, number>
  }
  models: Record<string, number>
  projects: { name: string; sessions: number; prompts: number }[]
}

export type Container = 'mod' | 'settings hook' | 'skill' | 'scheduled task' | 'not a mod'
export type Candidate = {
  id: string
  title: string
  evidence: string
  value: 1 | 2 | 3
  reliability: 1 | 2 | 3
  score: number
  container: Container
  hooks: string[]
  api: string[]
  gate?: string
  sketch: string
}

const GATE_WORDS = /\b(push|deploy|prod(uction)?|publish|post|tweet|send|email|outreach|pay|refund|invoice|stripe|legal|court|custody|case[- ]file|credential|password|token)\b/i

function tier(n: number, low: number, high: number): 1 | 2 | 3 {
  return n >= high ? 3 : n >= low ? 2 : 1
}
// Sent by a script: in (nearly) every session it appears in, it was the only prompt.
function isScripted(c: Cluster): boolean {
  return (c.solo ?? 0) >= 2 && (c.solo ?? 0) >= c.sessions * 0.8
}
function make(c: Omit<Candidate, 'score'>): Candidate {
  return { ...c, score: c.value * c.reliability }
}
function sum(fams: Record<string, number>, test: RegExp): number {
  return Object.entries(fams).filter(([k]) => test.test(k)).reduce((n, [, v]) => n + v, 0)
}
function gateFor(text: string): string | undefined {
  const m = GATE_WORDS.exec(text)
  if (!m) return undefined
  const w = m[1]!.toLowerCase()
  if (/push|deploy|prod/.test(w)) return 'production deploy: annotate or ask only; never approve the call'
  if (/publish|post|tweet|send|email|outreach/.test(w)) return 'public posting/outreach: draft only; the send stays a human yes'
  if (/pay|refund|invoice|stripe/.test(w)) return 'money: read-only'
  if (/legal|court|custody|case/.test(w)) return 'legal/case data: keep out of shared reports; prefer a repo git hook'
  return 'credentials: never read or display them'
}

export function analyze(scan: Scan): Candidate[] {
  const out: Candidate[] = []
  const S = Math.max(1, scan.sessionsScanned)
  const fam = scan.tools.bashFamilies

  // 1. Prompts typed again and again: each is a /command a mod can register (no Claude turn to
  //    type it) or a prompt.submit macro. Reliability is high when the text is stable.
  const scripted: Cluster[] = []
  for (const c of scan.prompts.clusters.slice(0, 8)) {
    if (c.count < 3 || c.sessions < 2) continue
    if (isScripted(c)) { scripted.push(c); continue }
    out.push(make({
      id: `macro:${c.key.replace(/\s+/g, '-').slice(0, 30)}`,
      title: `/command for "${c.key}…"`,
      evidence: `typed ${c.count} times in ${c.sessions} sessions${c.example ? `; e.g. "${c.example}"` : ''}`,
      value: tier(c.count, 5, 15),
      reliability: c.gate ? 1 : 3,
      container: 'mod',
      hooks: ['session.start', 'command.run'],
      api: ['$.command.register', '$.prompt.submit (on $.clock.after, never inside command.run)'],
      gate: c.gate ? gateFor(c.key + ' ' + c.example) : undefined,
      sketch: `Register /${c.key.split(' ').slice(0, 2).join('-')} that submits the full prompt text with the current cwd and branch filled in, so the ritual is one command instead of retyped prose.`,
    }))
  }

  if (scripted.length) {
    out.push(make({
      id: 'scripted-prompts',
      title: 'One-shot prompts a script already sends (not a habit to automate)',
      evidence: scripted.map(c => `"${c.key}…" ${c.solo}/${c.sessions} single-prompt sessions`).join('; '),
      value: 1,
      reliability: 3,
      container: 'not a mod',
      hooks: [],
      api: [],
      sketch: 'These arrive as the only prompt of a session, so a harness or cron sends them; a /command would save nobody a keystroke. Tune the script that sends them instead.',
    }))
  }

  // 2. The same opening prompt: a session.start hook can draft it.
  const open = scan.prompts.openings.find(c => !isScripted(c))
  if (open && open.count >= 3 && open.sessions >= 3) {
    out.push(make({
      id: 'opening-ritual',
      title: 'Session-start draft of the usual opening prompt',
      evidence: `${open.count} sessions opened with "${open.key}…"`,
      value: tier(open.count, 5, 12),
      reliability: 2,
      container: 'mod',
      hooks: ['session.start'],
      api: ['$.prompt.fill', '$.session.cwd'],
      gate: open.gate ? gateFor(open.key + ' ' + open.example) : undefined,
      sketch: 'On session.start, if the project matches, fill the prompt box with the opening text (never submit). Enter sends it; anything else replaces it.',
    }))
  }

  // 3. "Did you verify?" follow-ups: a ledger of real checks beats memory.
  if (scan.followups.verify >= 5) {
    out.push(make({
      id: 'check-ledger',
      title: 'Check ledger: which tests/type-checks ran, which edits came after',
      evidence: `${scan.followups.verify} verify-style follow-ups; ${sum(fam, /\b(test|typecheck|type-check|build|lint|vitest|jest|pytest|tsc)\b/)} test/typecheck/build commands`,
      value: tier(scan.followups.verify, 10, 40),
      reliability: 3,
      container: 'mod',
      hooks: ['tool.call (Bash, Edit, Write)', 'command.run'],
      api: ['$.ui.status', '$.tool.register (an evidence tool Claude reads before claiming tested)'],
      sketch: 'Observe Bash calls that are real checks and record pass/fail; record edits; report the files changed after the last passing check and the strongest status word the evidence supports. (Built in claude-mods as check-ledger.)',
    }))
  }

  // 4. Corrections ("no, wrong, still broken"): usually a prompt/skill problem, not a mod.
  if (scan.followups.correction >= 8) {
    out.push(make({
      id: 'correction-loop',
      title: 'Correction loop: tighten the skill or CLAUDE.md rule, not a mod',
      evidence: `${scan.followups.correction} correction follow-ups${scan.followups.correctionExamples[0] ? `; e.g. "${scan.followups.correctionExamples[0]}"` : ''}`,
      value: 2,
      reliability: 1,
      container: 'skill',
      hooks: [],
      api: [],
      sketch: 'Read the correction examples, group them by root cause, and fix the instruction that let it happen. A prompt.submit hook that appends reminders would paper over it.',
    }))
  }

  // 5. Permission denials and hook blocks by tool: annotate before the prompt appears.
  if (scan.denials.permission + scan.denials.hookBlock >= 5) {
    const top = Object.entries(scan.denials.byTool).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ')
    out.push(make({
      id: 'denial-preflight',
      title: 'Pre-flight note on tool calls that keep getting denied',
      evidence: `${scan.denials.permission} permission denials, ${scan.denials.hookBlock} hook blocks (${top || 'by tool unknown'})`,
      value: tier(scan.denials.permission + scan.denials.hookBlock, 10, 30),
      reliability: 2,
      container: 'mod',
      hooks: ['tool.call'],
      api: ['$.ui.notice (a line under the permission dialog)', '$.ui.status'],
      sketch: 'On tool.call for the tools above, add a notice naming the rule that usually denies this and what would pass instead. Never approve or answer the call; the permission prompt stays as is.',
    }))
  }

  // 6. Pushes and deploys: show branch, HEAD and dirty state before the yes.
  const pushes = sum(fam, /^git push/)
  const deploys = sum(fam, /^(vercel|firebase deploy|eas|netlify|fly|wrangler)/)
  if (pushes + deploys >= 5) {
    out.push(make({
      id: 'deploy-preflight',
      title: 'Push/deploy preflight: branch, HEAD, dirty files, last check, in the dialog',
      evidence: `${pushes} git push and ${deploys} deploy-family commands`,
      value: tier(pushes + deploys, 20, 100),
      reliability: 2,
      container: 'mod',
      hooks: ['tool.call (Bash matching push/deploy)'],
      api: ['$.process.run (git status/branch)', '$.ui.notice'],
      gate: 'production deploy: annotate or ask only; never approve the call',
      sketch: 'Before the permission prompt, run git branch/status in the command\'s cwd and show "branch X, HEAD abc123, 3 dirty files, last typecheck PASS 4m ago" under the dialog. Add nothing else; the decision is the human\'s.',
    }))
  }

  // 7. Live checks by curl: a last-status strip.
  const curls = sum(fam, /^curl/)
  if (curls >= 20) {
    out.push(make({
      id: 'live-check-strip',
      title: 'Live-check strip: last URL checked and its status code',
      evidence: `${curls} curl commands`,
      value: 2,
      reliability: 3,
      container: 'mod',
      hooks: ['tool.call (Bash matching curl)'],
      api: ['$.ui.status'],
      sketch: 'After a curl Bash call returns, parse the status line and show "example.com 200 · 12s ago" in the status line, so "is it live" has a visible answer.',
    }))
  }

  // 8. Usage limits and compaction pressure.
  if (scan.sessions.usageLimitHits >= 1 || scan.sessions.compactions + scan.sessions.continuedFromSummary >= 10) {
    out.push(make({
      id: 'usage-meter',
      title: 'Usage meter: context %, 5h/7d plan windows, cost',
      evidence: `${scan.sessions.usageLimitHits} usage-limit mentions, ${scan.sessions.compactions} compactions, ${scan.sessions.continuedFromSummary} continued-from-summary starts`,
      value: tier(scan.sessions.usageLimitHits * 5 + scan.sessions.compactions, 10, 40),
      reliability: 3,
      container: 'mod',
      hooks: ['session.measure', 'command.run'],
      api: ['$.session.usage', '$.ui.status', '$.ui.toast'],
      sketch: 'Status line with context fill and plan-window percentages; a toast at 80% and 95%; a /command for Remote Control where the status line is not drawn. (Built in claude-mods as usage-meter.)',
    }))
  }

  // 9. Sessions cut off mid-turn.
  if (scan.sessions.cutOff >= 3) {
    out.push(make({
      id: 'resume-nudge',
      title: 'Resume nudge: draft the pick-up prompt after a cut-off',
      evidence: `${scan.sessions.cutOff} of ${S} sessions ended mid-turn (unanswered prompt, tool result or pending tool call)`,
      value: tier(scan.sessions.cutOff, 5, 20),
      reliability: 2,
      container: 'mod',
      hooks: ['session.start', 'command.run'],
      api: ['$.session.messages', '$.prompt.fill'],
      sketch: 'On session.start read the last message; if the turn never finished, fill the prompt box with the standard pick-up text. Send only on Enter or an explicit /command. (Built in claude-mods as resume-nudge.)',
    }))
  }

  // 10. Model switching: show model and effort where the eye already is.
  if (scan.sessions.modelSwitches >= 3 || Object.keys(scan.models).length >= 3) {
    out.push(make({
      id: 'model-strip',
      title: 'Model and effort in the status line',
      evidence: `${scan.sessions.modelSwitches} in-session model switches across ${Object.keys(scan.models).length} models`,
      value: 2,
      reliability: 3,
      container: 'mod',
      hooks: ['session.start', 'turn.step (observe)'],
      api: ['$.session.model', '$.ui.status'],
      sketch: 'Show "opus · medium" in the status line and update it on a switch. Fold into the usage meter rather than a separate mod.',
    }))
  }

  // 11. Tools with a high error rate.
  for (const [name, t] of Object.entries(scan.tools.byName)) {
    if (t.calls >= 20 && t.errors / t.calls >= 0.2) {
      out.push(make({
        id: `tool-errors:${name}`,
        title: `${name} fails ${Math.round((100 * t.errors) / t.calls)}% of the time: annotate or pre-check`,
        evidence: `${t.errors} errors in ${t.calls} calls`,
        value: tier(t.errors, 10, 50),
        reliability: 2,
        container: 'mod',
        hooks: [`tool.call (${name})`],
        api: ['$.ui.notice', 'next(e) with corrected arguments only when the fix is mechanical'],
        sketch: `Read the common error texts for ${name} first. If the fix is mechanical (a flag, a path form), rewrite the call; otherwise show a notice with the usual cause.`,
      }))
    }
  }

  // 12. Remote Control sessions: a design rule for every mod, not a mod.
  if (scan.sessions.remoteControl >= 2) {
    out.push(make({
      id: 'mobile-rule',
      title: 'Design rule: every mod needs a /command text form for Remote Control',
      evidence: `${scan.sessions.remoteControl} sessions driven from a phone`,
      value: 2,
      reliability: 3,
      container: 'not a mod',
      hooks: [],
      api: [],
      sketch: 'Panes and status lines are not drawn on the phone. Give every mod a /command that answers in text, and say so in its README.',
    }))
  }

  // 13. Heavily used slash commands that are skills: stay skills unless they need state or UI.
  const topSkill = Object.entries(scan.sessions.slashCommands).filter(([k]) => !/^(clear|compact|resume|help|plugin|login|model|cost|config|status|init|exit|quit|diff|context|memory|mcp)$/.test(k)).sort((a, b) => b[1] - a[1])[0]
  if (topSkill && topSkill[1] >= 10) {
    out.push(make({
      id: `skill:${topSkill[0]}`,
      title: `/${topSkill[0]} stays a skill unless it needs state, UI or a no-turn command`,
      evidence: `run ${topSkill[1]} times`,
      value: 1,
      reliability: 3,
      container: 'skill',
      hooks: [],
      api: [],
      sketch: 'A mod earns its place when something must persist across hooks, draw live, or run without a Claude turn. Otherwise the skill is cheaper to maintain.',
    }))
  }

  return out.sort((a, b) => b.score - a.score || b.value - a.value)
}

export function reportMarkdown(scan: Scan, cands: Candidate[], paths: { json: string }): string {
  const L: string[] = []
  const day = scan.generatedAt.slice(0, 10)
  L.push(`# mod-scout report, ${day}`, '')
  L.push(`Scanned ${scan.sessionsScanned} sessions, ${scan.prompts.total} human prompts, last ${scan.days} days. Raw signals: \`${paths.json}\`.`, '')
  L.push('Scores are value × reliability (1–3 each; 9 is best). "Gate" marks a candidate that touches money, posting, legal data or production deploys: it may only annotate, draft or ask, never approve or send.', '')
  L.push('## Mod candidates', '', '| # | Candidate | Score | Container | Evidence | Gate |', '|---|---|---|---|---|---|')
  cands.forEach((c, i) => L.push(`| ${i + 1} | ${c.title} | ${c.score} | ${c.container} | ${c.evidence} | ${c.gate ?? ''} |`))
  L.push('', '## Designs', '')
  for (const c of cands.filter(c => c.container === 'mod')) {
    L.push(`### ${c.title}`, '', `- Evidence: ${c.evidence}`, `- Hooks: ${c.hooks.join(', ') || 'none'}`, `- API: ${c.api.join(', ') || 'none'}`)
    if (c.gate) L.push(`- Gate: ${c.gate}`)
    L.push(`- Sketch: ${c.sketch}`, '')
  }
  const rest = cands.filter(c => c.container !== 'mod')
  if (rest.length) {
    L.push('## Not mods', '')
    for (const c of rest) L.push(`- **${c.title}** (${c.container}): ${c.sketch}`)
    L.push('')
  }
  L.push('## Signals', '')
  L.push(`- Verify follow-ups: ${scan.followups.verify}; corrections: ${scan.followups.correction}`)
  L.push(`- Denials: ${scan.denials.permission} permission, ${scan.denials.hookBlock} hook`)
  L.push(`- Sessions: ${scan.sessions.cutOff} cut off, ${scan.sessions.interrupted} interrupted by Esc, ${scan.sessions.compactions} compactions, ${scan.sessions.continuedFromSummary} continued from summary, ${scan.sessions.remoteControl} on Remote Control, ${scan.sessions.long} long (40+ prompts), ${scan.sessions.withSubagents} with subagents`)
  L.push(`- Models: ${Object.entries(scan.models).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}; ${scan.sessions.modelSwitches} switches`)
  L.push('', '### Repeated prompts (first six words)', '')
  for (const c of scan.prompts.clusters.slice(0, 15)) L.push(`- ${c.count}× in ${c.sessions} sessions: "${c.key}"${c.gate ? ' (gate)' : ''}`)
  L.push('', '### Bash families', '')
  for (const [k, v] of Object.entries(scan.tools.bashFamilies).slice(0, 25)) L.push(`- ${v} ${k}`)
  L.push('', '### Tools', '')
  for (const [k, t] of Object.entries(scan.tools.byName).slice(0, 15)) L.push(`- ${k}: ${t.calls} calls, ${t.errors} errors`)
  L.push('', '### Slash commands', '')
  for (const [k, v] of Object.entries(scan.sessions.slashCommands).slice(0, 15)) L.push(`- ${v} /${k}`)
  L.push('', '## Next', '', 'Run `/mod-scout design 3` and Claude designs the top three with the bundled mod-scout skill, then asks before building.', '')
  return L.join('\n')
}

export function paneLines(cands: Candidate[], width: number, scannedAt: string): string[] {
  const w = Math.max(30, width)
  const lines = [`mod-scout · ${scannedAt.slice(0, 16).replace('T', ' ')}`.slice(0, w)]
  cands.slice(0, 12).forEach((c, i) => {
    const gate = c.gate ? ' ⚠' : ''
    lines.push(`${String(i + 1).padStart(2)}. [${c.score}] ${c.title}${gate}`.slice(0, w))
    lines.push(`     ${c.container} · ${c.evidence}`.slice(0, w))
  })
  lines.push(''.padEnd(0), '/mod-scout design 3 · /mod-scout show · /mod-scout help'.slice(0, w))
  return lines
}
