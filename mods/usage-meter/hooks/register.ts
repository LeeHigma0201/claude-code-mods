import type { Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

// Plan-limit percentages that raise a one-time toast per window.
const THRESHOLDS = [80, 95]
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

type Usage = { context: SessionContextUsage; rateLimits: SessionRateLimit[]; cost?: SessionCost }

// Toasts already shown, keyed by window, reset time and threshold.
const warned = new Set<string>()

export function label(kind: string): string {
  return LABELS[kind] ?? kind
}

export function statusText(u: Usage): string {
  const parts: string[] = []
  if (u.context.percent !== undefined) parts.push(`ctx ${u.context.percent}%`)
  for (const r of u.rateLimits) parts.push(`${label(r.kind)} ${r.percentUsed}%`)
  if (u.cost) parts.push(`$${u.cost.usd.toFixed(2)}`)
  return parts.join(' · ')
}

function resetIn(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const h = Math.floor(ms / 3_600_000)
  const m = Math.round((ms % 3_600_000) / 60_000)
  return h >= 24 ? ` (resets in ${Math.floor(h / 24)}d ${h % 24}h)` : ` (resets in ${h}h ${m}m)`
}

export function reportText(u: Usage, now: number): string {
  const lines = ['Usage meter']
  const ctx = u.context
  lines.push(
    ctx.percent === undefined
      ? `- context: no reading yet (window ${ctx.window.toLocaleString('en-US')} tokens)`
      : `- context: ${ctx.percent}% of ${ctx.window.toLocaleString('en-US')} tokens (${(ctx.tokens ?? 0).toLocaleString('en-US')} used)`,
  )
  if (u.rateLimits.length === 0) lines.push('- plan limits: no reading yet (none reported, or not on a subscription)')
  for (const r of u.rateLimits) lines.push(`- ${label(r.kind)} limit: ${r.percentUsed}% used${resetIn(r.resetsAt, now)}`)
  lines.push(u.cost ? `- session cost (API-equivalent, not subscription usage): $${u.cost.usd.toFixed(2)}` : '- session cost: not tracked here')
  return lines.join('\n')
}

// Thresholds crossed for the first time this module load.
export function newWarnings(limits: SessionRateLimit[]): string[] {
  const out: string[] = []
  for (const r of limits) {
    for (const t of THRESHOLDS) {
      const key = `${r.kind}|${r.resetsAt ?? ''}|${t}`
      if (r.percentUsed >= t && !warned.has(key)) {
        warned.add(key)
        out.push(`${label(r.kind)} plan limit at ${r.percentUsed}%`)
      }
    }
  }
  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-meter',
      description: 'Show context fill, plan-limit windows and session cost',
    })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    $.ui.status(statusText(e) || undefined)
    for (const w of newWarnings(e.rateLimits)) $.ui.toast(w)
    return next(e)
  })

  on('command.run', { command: 'usage-meter' }, async $ => {
    const u = await $.session.usage()
    return { text: reportText(u, await $.clock.now()) }
  })
}
