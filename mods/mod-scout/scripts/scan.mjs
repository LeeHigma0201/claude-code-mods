#!/usr/bin/env node
// mod-scout scanner: reads Claude Code session transcripts and writes aggregate usage
// signals as JSON. Facts only; the mod's analyze.ts turns them into mod candidates.
//
//   node scan.mjs --root ~/.claude/projects --days 14 --out ~/.claude/mod-scout/scan.json
//                 [--exclude private-project,secret] [--examples 1|0]
//
// Streams each .jsonl line by line (transcripts run to hundreds of MB). Subagent transcripts
// are skipped. Prompt text is kept only as short, truncated examples, and only when
// --examples is on. Node 18+, no dependencies.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'

const args = parseArgs(process.argv.slice(2))
const ROOT = expand(args.root ?? '~/.claude/projects')
const DAYS = Number(args.days ?? 14)
const OUT = expand(args.out ?? '~/.claude/mod-scout/scan.json')
const EXCLUDE = (args.exclude ?? '').split(',').map(s => s.trim()).filter(Boolean)
const EXAMPLES = args.examples !== '0' && args.examples !== 'false'
const MAX_LINE = 2_000_000 // bytes; longer lines are images or pasted blobs
const EXAMPLE_LEN = 110
const since = Date.now() - DAYS * 86_400_000

function parseArgs(list) {
  const out = {}
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (a.startsWith('--')) out[a.slice(2)] = list[i + 1] && !list[i + 1].startsWith('--') ? list[++i] : 'true'
  }
  return out
}
function expand(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

// Patterns. Keep them readable: the report quotes which one fired.
const VERIFY = /\b(verify|did you (check|test|verify|run)|is (it|this|that) (live|deployed|actually|really)|prove it|actually work)/i
const CORRECTION = /^(no[,.!]|wrong|that'?s (not|wrong)|you didn'?t|still (not|broken|wrong|doesn'?t)|didn'?t work|try again|not what i|undo that)/i
const INTERRUPTED = /^\[Request interrupted by user/
const USAGE_LIMIT = /usage limit|rate limit|out of (usage|credits)|hit my limit/i
const REMOTE = /remote control|from (my|his|her|their) phone|via dispatch/i
const CONTINUED = /^This session is being continued/
const GATE = /\b(push|deploy|prod(uction)?|publish|post( it|ing)?|tweet|send|email|outreach|pay|refund|invoice|stripe|legal|court|custody|case[- ]file|credential|password|token)\b/i
const SKIP_PROMPT = /^(<|\[|Caveat:|This session is being continued)/
// Shell plumbing says nothing about what a mod could do; it is left out of the families.
const SHELL_NOISE = new Set(['echo', 'cd', 'export', 'for', 'while', 'if', 'cat', 'ls', 'sed', 'grep', 'rg', 'tail', 'head', 'mkdir', 'printf', 'wc', 'sort', 'awk', 'cut', 'tr', 'xargs', 'find', 'set', 'true', 'test', 'date', 'sleep', 'touch', 'cp', 'mv', 'rm', 'pwd', 'which', 'env', 'source', 'eval', 'exit', 'read', 'uniq', 'diff', 'stat', 'du', 'df', 'ps', 'kill', 'lsof', 'chmod', 'ln', 'basename', 'dirname', 'jq', 'tee', 'less', 'more', 'file', 'shasum', 'md5', 'base64', 'open', 'say'])
const FAMILY_HEADS = new Set(['git', 'pnpm', 'npm', 'yarn', 'npx', 'bun', 'node', 'python3', 'python', 'claude', 'vercel', 'gh', 'docker', 'cargo', 'go', 'swift', 'xcodebuild', 'firebase', 'supabase', 'eas', 'brew', 'make', 'pip', 'pip3', 'uv', 'open', 'osascript', 'ffmpeg'])

const stats = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  days: DAYS,
  excluded: EXCLUDE,
  sessionsScanned: 0,
  sessionsSkipped: 0,
  bytes: 0,
  projects: {},
  prompts: { total: 0, clusters: {}, openings: {} },
  followups: { verify: 0, correction: 0, verifyExamples: [], correctionExamples: [] },
  tools: { byName: {}, bashFamilies: {} },
  denials: { permission: 0, hookBlock: 0, byTool: {} },
  sessions: { interrupted: 0, cutOff: 0, compactions: 0, continuedFromSummary: 0, remoteControl: 0, usageLimitHits: 0, modelSwitches: 0, long: 0, withSubagents: 0, slashCommands: {} },
  models: {},
}

function bump(map, key, n = 1) {
  map[key] = (map[key] ?? 0) + n
}
function normalize(text) {
  return text.toLowerCase().replace(/https?:\/\/\S+/g, 'url').replace(/[^a-z0-9\s/]/g, ' ').replace(/\s+/g, ' ').trim()
}
function clusterKey(text) {
  const words = normalize(text).split(' ')
  return words.length >= 3 ? words.slice(0, 6).join(' ') : null
}
function addCluster(map, key, session, text) {
  const c = (map[key] ??= { count: 0, sessions: new Set(), solo: 0, example: '', gate: false })
  c.count++
  c.sessions.add(session)
  if (!c.example && EXAMPLES) c.example = text.replace(/\s+/g, ' ').slice(0, EXAMPLE_LEN)
  if (GATE.test(text)) c.gate = true
}
function bashFamily(cmd) {
  let c = cmd.replace(/^\s*(cd\s+\S+\s*(&&|;)\s*)+/, '').replace(/^\s*([A-Z_]+=\S+\s+)+/, '').trim()
  const tokens = c.split(/\s+/)
  let head = tokens[0] ?? ''
  if (!head) return null
  head = head.replace(/^.*\//, '').replace(/^["']|["']$/g, '')
  if (SHELL_NOISE.has(head) || /^[(\[{$]/.test(head)) return null
  if (!FAMILY_HEADS.has(head)) return /^[\w.-]{1,24}$/.test(head) ? head : null
  let i = 1
  if (head === 'git' && tokens[i] === '-C') i += 2
  while (tokens[i] && tokens[i].startsWith('-')) i++
  const sub = tokens[i]?.replace(/^.*\//, '') ?? ''
  if (!sub) return head
  if ((head === 'pnpm' || head === 'npm' || head === 'yarn' || head === 'bun') && sub === 'run') return `${head} ${tokens[i + 1] ?? 'run'}`
  if (head === 'python3' || head === 'python' || head === 'node') {
    if (sub.startsWith('<<') || sub === '-' || sub === '-c' || sub === '-e') return `${head} inline`
    const base = sub.startsWith('-') ? sub : path.basename(sub).replace(/["']/g, '')
    return base ? `${head} ${base}` : `${head} inline`
  }
  return `${head} ${sub}`
}
function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(b => b && b.type === 'text').map(b => b.text ?? '').join(' ')
}
function pushExample(list, text) {
  if (EXAMPLES && list.length < 5) list.push(text.replace(/\s+/g, ' ').slice(0, EXAMPLE_LEN))
}

async function scanFile(file, project) {
  const session = path.basename(file, '.jsonl')
  const s = { prompts: 0, lastRole: null, lastHadPendingTool: false, pendingTools: new Set(), lastUserWasResult: false, lastUserText: '', model: null, first: true, agents: false }
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    if (line.length > MAX_LINE || !line.startsWith('{')) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (o.isSidechain) continue
    const t = o.type
    const m = o.message
    if (t === 'summary') continue
    if (o.isCompactSummary) { stats.sessions.compactions++; continue }
    if (t === 'user' && m) {
      const content = m.content
      const results = Array.isArray(content) ? content.filter(b => b && b.type === 'tool_result') : []
      if (results.length) {
        for (const r of results) {
          s.pendingTools.delete(r.tool_use_id)
          const txt = typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? '')
          const tool = s.toolById?.[r.tool_use_id]
          if (r.is_error && tool) bump((stats.tools.byName[tool] ??= { calls: 0, errors: 0 }), 'errors')
          if (/Permission (for this action was|to use \S+ has been) denied|denied by the Claude Code auto mode classifier|User rejected|The user doesn't want/i.test(txt)) {
            stats.denials.permission++
            if (tool) bump(stats.denials.byTool, tool)
          } else if (/hook (blocked|denied|prevented)|blocked by .*hook|PreToolUse.*(block|deny)/i.test(txt)) {
            stats.denials.hookBlock++
            if (tool) bump(stats.denials.byTool, tool)
          }
        }
        s.lastRole = 'user'; s.lastUserWasResult = true
        continue
      }
      const text = textOf(content).trim()
      const cmd = /<command-name>\/?([\w:-]+)<\/command-name>/.exec(text)
      if (cmd) { bump(stats.sessions.slashCommands, cmd[1]); continue }
      if (o.isMeta || !text) continue
      if (INTERRUPTED.test(text)) { stats.sessions.interrupted++; s.lastRole = 'user'; s.lastUserWasResult = false; s.lastUserText = text; continue }
      if (CONTINUED.test(text)) { stats.sessions.continuedFromSummary++; continue }
      if (SKIP_PROMPT.test(text) || text.length > 2500) continue
      s.prompts++
      stats.prompts.total++
      if (REMOTE.test(text)) s.remote = true
      if (USAGE_LIMIT.test(text)) stats.sessions.usageLimitHits++
      const key = clusterKey(text)
      if (key) {
        addCluster(stats.prompts.clusters, key, session, text)
        if (s.first) addCluster(stats.prompts.openings, key, session, text)
        ;(s.keys ??= new Set()).add(key)
      }
      if (!s.first) {
        if (VERIFY.test(text)) { stats.followups.verify++; pushExample(stats.followups.verifyExamples, text) }
        if (CORRECTION.test(text)) { stats.followups.correction++; pushExample(stats.followups.correctionExamples, text) }
      }
      s.first = false
      s.lastRole = 'user'; s.lastUserWasResult = false; s.lastUserText = text
      continue
    }
    if (t === 'assistant' && m) {
      // Synthetic rows and the small helper model are not the session's model.
      if (m.model && m.model !== '<synthetic>' && !/haiku/.test(m.model)) {
        bump(stats.models, m.model)
        if (s.model && s.model !== m.model) stats.sessions.modelSwitches++
        s.model = m.model
      }
      const content = Array.isArray(m.content) ? m.content : []
      for (const b of content) {
        if (!b || b.type !== 'tool_use') continue
        const name = b.name ?? 'unknown'
        bump((stats.tools.byName[name] ??= { calls: 0, errors: 0 }), 'calls')
        ;(s.toolById ??= {})[b.id] = name
        s.pendingTools.add(b.id)
        if (name === 'Agent' || name === 'Task') s.agents = true
        if (name === 'Bash' && b.input && typeof b.input.command === 'string') {
          const fam = bashFamily(b.input.command)
          if (fam) bump(stats.tools.bashFamilies, fam)
        }
      }
      s.lastRole = 'assistant'
    }
  }
  if (s.prompts === 0) { stats.sessionsSkipped++; return }
  stats.sessionsScanned++
  // A session with exactly one prompt is usually a script or harness sending it, not a person typing.
  if (s.prompts === 1 && s.keys) {
    for (const k of s.keys) { stats.prompts.clusters[k].solo++; if (stats.prompts.openings[k]) stats.prompts.openings[k].solo++ }
  }
  const p = (stats.projects[project] ??= { sessions: 0, prompts: 0 })
  p.sessions++; p.prompts += s.prompts
  if (s.prompts >= 40) stats.sessions.long++
  if (s.agents) stats.sessions.withSubagents++
  if (s.remote) stats.sessions.remoteControl++
  // Cut off: the last thing that happened was a prompt or tool result Claude never answered,
  // or a tool call that never returned. An Esc interrupt is a stop, not a cut-off.
  const cut = (s.lastRole === 'user' && !INTERRUPTED.test(s.lastUserText)) || (s.lastRole === 'assistant' && s.pendingTools.size > 0)
  if (cut) stats.sessions.cutOff++
}

function* walk(dir) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'subagents') yield* walk(full) }
    else if (e.name.endsWith('.jsonl')) yield full
  }
}

function finish(map, limit) {
  return Object.entries(map)
    .map(([key, c]) => ({ key, count: c.count, sessions: c.sessions.size, solo: c.solo, example: c.example, gate: c.gate }))
    .filter(c => c.count >= 2)
    .sort((a, b) => b.count - a.count || b.sessions - a.sessions)
    .slice(0, limit)
}

const t0 = Date.now()
const files = []
for (const dir of fs.existsSync(ROOT) ? fs.readdirSync(ROOT) : []) {
  const project = dir.replace(/^-/, '').replace(/-/g, '/')
  if (EXCLUDE.some(x => project.includes(x) || dir.includes(x))) continue
  for (const f of walk(path.join(ROOT, dir))) {
    let st
    try { st = fs.statSync(f) } catch { continue }
    if (st.mtimeMs < since) continue
    files.push({ f, project, size: st.size })
  }
}
let done = 0
for (const { f, project, size } of files) {
  stats.bytes += size
  try { await scanFile(f, project) } catch (err) { process.stderr.write(`skip ${f}: ${err.message}\n`) }
  if (++done % 50 === 0) process.stderr.write(`mod-scout: ${done}/${files.length} transcripts\n`)
}

const result = {
  ...stats,
  prompts: { total: stats.prompts.total, clusters: finish(stats.prompts.clusters, 40), openings: finish(stats.prompts.openings, 15) },
  projects: Object.entries(stats.projects).sort((a, b) => b[1].sessions - a[1].sessions).slice(0, 25).map(([name, v]) => ({ name, ...v })),
  tools: {
    byName: Object.fromEntries(Object.entries(stats.tools.byName).sort((a, b) => b[1].calls - a[1].calls).slice(0, 40)),
    bashFamilies: Object.fromEntries(Object.entries(stats.tools.bashFamilies).sort((a, b) => b[1] - a[1]).slice(0, 60)),
  },
  sessions: { ...stats.sessions, slashCommands: Object.fromEntries(Object.entries(stats.sessions.slashCommands).sort((a, b) => b[1] - a[1]).slice(0, 30)) },
  elapsedMs: Date.now() - t0,
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(result, null, 1))
process.stdout.write(JSON.stringify({ out: OUT, sessions: result.sessionsScanned, prompts: result.prompts.total, bytes: result.bytes, elapsedMs: result.elapsedMs }) + '\n')
